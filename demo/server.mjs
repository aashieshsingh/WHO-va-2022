import { randomBytes, scryptSync } from "node:crypto";
import { createServer as createHttpServer } from "node:http";

import { createServer as createViteServer } from "vite";

import { createPostgresPool } from "./db.mjs";
import { runMigrations } from "./migrate.mjs";

const PORT = Number(process.env.PORT ?? 5173);
const pool = createPostgresPool();

const corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "DELETE,GET,POST,OPTIONS",
  "access-control-allow-headers": "content-type"
};

async function readJsonBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    ...corsHeaders
  });
  response.end(JSON.stringify(body));
}

const partnerSites = new Set(["AIIMS", "ICMR", "WHO Collaborating Centre"]);
const assignedSites = new Set(["Bhopal", "Delhi", "Mumbai", "Pune"]);
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;

function generatedUserId(name) {
  const initials = name
    .split(/\s+/u)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "U")
    .join("")
    .padEnd(2, "U");
  return `USR-${initials}-${Date.now().toString(36).toUpperCase()}-${randomBytes(3).toString("hex").toUpperCase()}`;
}

function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `scrypt:${salt}:${hash}`;
}

function badRequest(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function validateUserRegistration(payload) {
  const name = typeof payload.name === "string" ? payload.name.trim() : "";
  const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";
  const partnerSite = typeof payload.partnerSite === "string" ? payload.partnerSite.trim() : "";
  const siteAssigned = typeof payload.siteAssigned === "string" ? payload.siteAssigned.trim() : "";
  const password = typeof payload.password === "string" ? payload.password : "";

  if (!characterOnlyPattern.test(name))
    throw badRequest("Name accepts letters only. Spaces are allowed between words.");
  if (!emailPattern.test(email)) throw badRequest("A valid email is required");
  if (!partnerSites.has(partnerSite)) throw badRequest("Select a valid partner site");
  if (!assignedSites.has(siteAssigned)) throw badRequest("Select a valid assigned site");
  if (password.length < 8) throw badRequest("Password must be at least 8 characters");

  return { name, email, partnerSite, siteAssigned, password };
}

async function ensureUsersTable() {
  await pool.query(`
    create table if not exists who_va_users (
      user_id text primary key,
      name text not null,
      email text not null unique,
      partner_site text not null,
      site_assigned text not null,
      password_hash text not null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `);
  await pool.query("create index if not exists who_va_users_partner_site_idx on who_va_users (partner_site)");
  await pool.query(
    "create index if not exists who_va_users_site_assigned_idx on who_va_users (site_assigned)"
  );
}

async function registerUser(payload) {
  await ensureUsersTable();
  const user = validateUserRegistration(payload);
  try {
    const result = await pool.query(
      `
        insert into who_va_users (
          user_id,
          name,
          email,
          partner_site,
          site_assigned,
          password_hash
        )
        values ($1, $2, $3, $4, $5, $6)
        returning user_id, name, email, partner_site, site_assigned, created_at
      `,
      [
        generatedUserId(user.name),
        user.name,
        user.email,
        user.partnerSite,
        user.siteAssigned,
        hashPassword(user.password)
      ]
    );
    const saved = result.rows[0];
    return {
      userId: saved.user_id,
      name: saved.name,
      email: saved.email,
      partnerSite: saved.partner_site,
      siteAssigned: saved.site_assigned,
      createdAt: saved.created_at
    };
  } catch (error) {
    if (error?.code === "23505") throw badRequest("A user with this email is already registered");
    throw error;
  }
}
const characterOnlyCaseEntryFields = {
  district: "District",
  block: "Block",
  villages: "Villages",
  phc: "Phc",
  subcentre: "Subcentre",
  householdHeadName: "Name of head of the Household",
  deceasedFullName: "Full name of the deceased"
};

const characterOnlyPattern = /^[A-Za-z]+(?: [A-Za-z]+)*$/;

function validateCaseEntry(caseEntry) {
  for (const [field, label] of Object.entries(characterOnlyCaseEntryFields)) {
    const value = typeof caseEntry[field] === "string" ? caseEntry[field].trim() : "";
    caseEntry[field] = value;
    if (!characterOnlyPattern.test(value)) {
      const error = new Error(`${label} accepts letters only. Spaces are allowed between words.`);
      error.statusCode = 400;
      throw error;
    }
  }
}

async function ensureDraftTable() {
  await pool.query(`
    create table if not exists who_va_drafts (
      id text primary key,
      draft jsonb not null,
      instrument_id text not null,
      instrument_version text not null,
      current_section text not null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `);
  await pool.query("create index if not exists who_va_drafts_updated_at_idx on who_va_drafts (updated_at)");
}
function validateDraft(draft) {
  if (!draft || typeof draft !== "object" || Array.isArray(draft)) {
    const error = new Error("draft must be an object");
    error.statusCode = 400;
    throw error;
  }
  for (const field of ["id", "instrumentId", "instrumentVersion", "currentSection"]) {
    if (typeof draft[field] !== "string" || draft[field].trim() === "") {
      const error = new Error(`draft.${field} is required`);
      error.statusCode = 400;
      throw error;
    }
  }
  return draft;
}

async function saveDraft(payload) {
  await ensureDraftTable();
  const draft = validateDraft(payload.draft ?? payload);
  const result = await pool.query(
    `
      insert into who_va_drafts (
        id,
        draft,
        instrument_id,
        instrument_version,
        current_section
      )
      values ($1, $2::jsonb, $3, $4, $5)
      on conflict (id) do update set
        draft = excluded.draft,
        instrument_id = excluded.instrument_id,
        instrument_version = excluded.instrument_version,
        current_section = excluded.current_section,
        updated_at = now()
      returning id, instrument_id, instrument_version, current_section, created_at, updated_at
    `,
    [draft.id, JSON.stringify(draft), draft.instrumentId, draft.instrumentVersion, draft.currentSection]
  );

  return result.rows[0];
}

async function loadDraft(id) {
  await ensureDraftTable();
  const result = await pool.query("select draft from who_va_drafts where id = $1", [id]);
  return result.rows[0]?.draft;
}

async function removeDraft(id) {
  await ensureDraftTable();
  await pool.query("delete from who_va_drafts where id = $1", [id]);
}
async function saveFormEntry(payload) {
  const uid = typeof payload.uid === "string" ? payload.uid.trim() : "";
  if (!uid) {
    const error = new Error("uid is required");
    error.statusCode = 400;
    throw error;
  }

  const status = payload.status === "completed" ? "completed" : "case-entry";
  const caseEntry = payload.caseEntry && typeof payload.caseEntry === "object" ? payload.caseEntry : {};
  validateCaseEntry(caseEntry);
  const whoVaData = payload.whoVaData && typeof payload.whoVaData === "object" ? payload.whoVaData : {};
  const submission = payload.submission && typeof payload.submission === "object" ? payload.submission : null;
  const validationIssues = Array.isArray(payload.validationIssues) ? payload.validationIssues : [];

  const result = await pool.query(
    `
      insert into who_va_form_entries (
        uid,
        case_entry,
        who_va_prefill,
        submission,
        validation_issues,
        status,
        completed_at
      )
      values ($1, $2::jsonb, $3::jsonb, $4::jsonb, $5::jsonb, $6, case when $6 = 'completed' then now() else null end)
      on conflict (uid) do update set
        case_entry = excluded.case_entry,
        who_va_prefill = excluded.who_va_prefill,
        submission = coalesce(excluded.submission, who_va_form_entries.submission),
        validation_issues = excluded.validation_issues,
        status = excluded.status,
        completed_at = case when excluded.status = 'completed' then now() else who_va_form_entries.completed_at end,
        updated_at = now()
      returning id, uid, status, created_at, updated_at, completed_at
    `,
    [
      uid,
      JSON.stringify(caseEntry),
      JSON.stringify(whoVaData),
      submission ? JSON.stringify(submission) : null,
      JSON.stringify(validationIssues),
      status
    ]
  );

  return result.rows[0];
}

await runMigrations(pool);

const vite = await createViteServer({
  root: "demo",
  server: { middlewareMode: true },
  appType: "spa"
});

const server = createHttpServer(async (request, response) => {
  try {
    if (request.method === "OPTIONS" && request.url?.startsWith("/api/")) {
      response.writeHead(204, corsHeaders);
      response.end();
      return;
    }

    const url = new URL(request.url ?? "/", "http://127.0.0.1");

    if (url.pathname === "/api/health" && request.method === "GET") {
      await pool.query("select 1");
      sendJson(response, 200, { ok: true, database: process.env.PGDATABASE ?? "whova" });
      return;
    }

    if (url.pathname === "/api/form-entries" && request.method === "POST") {
      const saved = await saveFormEntry(await readJsonBody(request));
      sendJson(response, 200, { ok: true, saved });
      return;
    }

    if (url.pathname === "/api/users" && request.method === "POST") {
      const user = await registerUser(await readJsonBody(request));
      sendJson(response, 200, { ok: true, user });
      return;
    }

    if (url.pathname === "/api/drafts" && request.method === "POST") {
      const saved = await saveDraft(await readJsonBody(request));
      sendJson(response, 200, { ok: true, saved });
      return;
    }

    if (url.pathname.startsWith("/api/drafts/") && request.method === "GET") {
      const id = decodeURIComponent(url.pathname.slice("/api/drafts/".length));
      const draft = await loadDraft(id);
      if (!draft) {
        sendJson(response, 404, { ok: false, error: "Draft not found" });
        return;
      }
      sendJson(response, 200, { ok: true, draft });
      return;
    }

    if (url.pathname.startsWith("/api/drafts/") && request.method === "DELETE") {
      const id = decodeURIComponent(url.pathname.slice("/api/drafts/".length));
      await removeDraft(id);
      sendJson(response, 200, { ok: true });
      return;
    }

    vite.middlewares(request, response);
  } catch (error) {
    console.error(error);
    const statusCode = Number(error?.statusCode ?? 500);
    sendJson(response, statusCode, {
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`WHO VA demo with Postgres saving: http://127.0.0.1:${PORT}`);
});

process.on("SIGINT", async () => {
  await vite.close();
  await pool.end();
  server.close(() => process.exit(0));
});
