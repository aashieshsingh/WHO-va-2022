import { randomBytes, timingSafeEqual, scryptSync } from "node:crypto";
import { createServer as createHttpServer } from "node:http";

import { createServer as createViteServer } from "vite";

import { createPostgresPool } from "./db.mjs";
import { runMigrations } from "./migrate.mjs";

const PORT = Number(process.env.PORT ?? 5173);
const HOST = process.env.HOST ?? "0.0.0.0";
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
const userRoles = new Set(["admin", "data-entry"]);
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

function generatedAuthKey() {
  return `AUTH-${randomBytes(24).toString("hex").toUpperCase()}`;
}

function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `scrypt:${salt}:${hash}`;
}

function verifyPassword(password, storedHash) {
  const [scheme, salt, hash] = String(storedHash).split(":");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "hex");
  const actual = scryptSync(password, salt, expected.length);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function badRequest(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

const formEntryStatuses = new Set(["case-entry", "completed"]);

function validateUserRegistration(payload) {
  const name = typeof payload.name === "string" ? payload.name.trim() : "";
  const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";
  const role = typeof payload.role === "string" ? payload.role.trim() : "";
  const partnerSite = typeof payload.partnerSite === "string" ? payload.partnerSite.trim() : "";
  const siteAssigned = typeof payload.siteAssigned === "string" ? payload.siteAssigned.trim() : "";
  const password = typeof payload.password === "string" ? payload.password : "";

  if (!characterOnlyPattern.test(name))
    throw badRequest("Name accepts letters only. Spaces are allowed between words.");
  if (!emailPattern.test(email)) throw badRequest("A valid email is required");
  if (!userRoles.has(role)) throw badRequest("Select a valid role");
  if (!partnerSites.has(partnerSite)) throw badRequest("Select a valid partner site");
  if (!assignedSites.has(siteAssigned)) throw badRequest("Select a valid assigned site");
  if (password.length < 8) throw badRequest("Password must be at least 8 characters");

  return { name, email, role, partnerSite, siteAssigned, password };
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
  await pool.query(
    "alter table who_va_users add column if not exists role text not null default 'data-entry'"
  );
  await pool.query("alter table who_va_users add column if not exists auth_key text");
  await pool.query("update who_va_users set auth_key = $1 where auth_key is null", [generatedAuthKey()]);
  await pool.query("alter table who_va_users alter column auth_key set not null");
  await pool.query("create index if not exists who_va_users_partner_site_idx on who_va_users (partner_site)");
  await pool.query(
    "create index if not exists who_va_users_site_assigned_idx on who_va_users (site_assigned)"
  );
  await pool.query("create index if not exists who_va_users_role_idx on who_va_users (role)");
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
          role,
          partner_site,
          site_assigned,
          password_hash,
          auth_key
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8)
        returning user_id, name, email, role, partner_site, site_assigned, auth_key, created_at
      `,
      [
        generatedUserId(user.name),
        user.name,
        user.email,
        user.role,
        user.partnerSite,
        user.siteAssigned,
        hashPassword(user.password),
        generatedAuthKey()
      ]
    );
    const saved = result.rows[0];
    return {
      userId: saved.user_id,
      name: saved.name,
      email: saved.email,
      role: saved.role,
      partnerSite: saved.partner_site,
      siteAssigned: saved.site_assigned,
      authKey: saved.auth_key,
      createdAt: saved.created_at
    };
  } catch (error) {
    if (error?.code === "23505") throw badRequest("A user with this email is already registered");
    throw error;
  }
}
async function loginUser(payload) {
  await ensureUsersTable();
  const identifier = typeof payload.email === "string" ? payload.email.trim() : "";
  const normalizedEmail = identifier.toLowerCase();
  const password = typeof payload.password === "string" ? payload.password : "";
  if (!identifier || !password) throw badRequest("Email or user ID and password are required");

  const result = await pool.query(
    `
      select user_id, name, email, role, partner_site, site_assigned, password_hash, auth_key, created_at
      from who_va_users
      where email = $1 or user_id = $2
    `,
    [normalizedEmail, identifier]
  );
  const saved = result.rows[0];
  if (!saved || !verifyPassword(password, saved.password_hash)) throw badRequest("Invalid email/user ID or password");
  return {
    userId: saved.user_id,
    name: saved.name,
    email: saved.email,
    role: saved.role,
    partnerSite: saved.partner_site,
    siteAssigned: saved.site_assigned,
      authKey: saved.auth_key,
      createdAt: saved.created_at
  };
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

const allowedCaseEntrySexValues = new Set(["female", "male", "undetermined"]);

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

  if (!allowedCaseEntrySexValues.has(caseEntry.deceasedSex)) {
    const error = new Error("Select a valid sex of the deceased.");
    error.statusCode = 400;
    throw error;
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
async function listFormEntries() {
  const result = await pool.query(
    `
      select id, uid, user_id, status, created_at, updated_at, completed_at, case_entry, who_va_prefill
      from who_va_form_entries
      order by updated_at desc
      limit 100
    `
  );

  return result.rows.map((row) => ({
    id: row.id,
    uid: row.uid,
    userId: row.user_id,
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
    completed_at: row.completed_at,
    caseEntry: row.case_entry,
    whoVaData: row.who_va_prefill
  }));
}


async function verifyUserAuthKey(userId, authKey) {
  if (!userId || !authKey) throw badRequest("userId and authKey are required for authenticated form entry pushes");
  await ensureUsersTable();
  const result = await pool.query(
    "select 1 from who_va_users where user_id = $1 and auth_key = $2",
    [userId, authKey]
  );
  if (!result.rows[0]) throw badRequest("Invalid user auth key");
}
async function loadUserByAuthKey(userId, authKey) {
  if (!userId || !authKey) throw badRequest("userId and authKey are required");
  await ensureUsersTable();
  const result = await pool.query(
    `
      select user_id, name, email, role, partner_site, site_assigned, auth_key, created_at
      from who_va_users
      where user_id = $1 and auth_key = $2
    `,
    [userId, authKey]
  );
  const saved = result.rows[0];
  if (!saved) throw badRequest("Invalid user auth key");
  return {
    userId: saved.user_id,
    name: saved.name,
    email: saved.email,
    role: saved.role,
    partnerSite: saved.partner_site,
    siteAssigned: saved.site_assigned,
    authKey: saved.auth_key,
    createdAt: saved.created_at
  };
}

async function listUserDashboard(userId, authKey) {
  await ensureDraftTable();
  const requester = await loadUserByAuthKey(userId, authKey);
  const params = requester.role === "admin" ? [] : [requester.userId];
  const userFilter = requester.role === "admin" ? "" : "where f.user_id = $1";
  const result = await pool.query(
    `
      select
        f.id,
        f.uid,
        f.user_id,
        f.status,
        f.created_at,
        f.updated_at,
        f.completed_at,
        f.case_entry,
        f.who_va_prefill,
        u.name as user_name,
        u.email as user_email,
        u.role as user_role,
        u.partner_site,
        u.site_assigned,
        d.id as draft_id,
        d.current_section as draft_section,
        d.updated_at as draft_updated_at
      from who_va_form_entries f
      left join who_va_users u on u.user_id = f.user_id
      left join who_va_drafts d on d.id = f.uid
      ${userFilter}
      order by coalesce(f.completed_at, d.updated_at, f.updated_at) desc
      limit 250
    `,
    params
  );

  const usersById = new Map();
  for (const row of result.rows) {
    const dashboardStatus =
      row.status === "completed" || row.completed_at ? "final" : row.draft_id ? "drafted" : "pending";
    const ownerId = row.user_id ?? "unassigned";
    const owner = usersById.get(ownerId) ?? {
      userId: ownerId,
      name: row.user_name ?? "Unassigned",
      email: row.user_email ?? "",
      role: row.user_role ?? "",
      partnerSite: row.partner_site ?? "",
      siteAssigned: row.site_assigned ?? "",
      counts: { pending: 0, drafted: 0, final: 0 },
      forms: []
    };
    owner.counts[dashboardStatus] += 1;
    owner.forms.push({
      id: row.id,
      uid: row.uid,
      status: dashboardStatus,
      sourceStatus: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      completedAt: row.completed_at,
      draftId: row.draft_id,
      draftSection: row.draft_section,
      draftUpdatedAt: row.draft_updated_at,
      caseEntry: row.case_entry,
      whoVaData: row.who_va_prefill
    });
    usersById.set(ownerId, owner);
  }

  return { requester, users: [...usersById.values()] };
}

async function saveFormEntry(payload) {
  const uid = typeof payload.uid === "string" ? payload.uid.trim() : "";
  if (!uid) {
    const error = new Error("uid is required");
    error.statusCode = 400;
    throw error;
  }

  const userId = typeof payload.userId === "string" && payload.userId.trim() ? payload.userId.trim() : null;
  const requestedStatus = typeof payload.status === "string" ? payload.status.trim() : "case-entry";
  const status = formEntryStatuses.has(requestedStatus) ? requestedStatus : "case-entry";
  const authKey = typeof payload.authKey === "string" && payload.authKey.trim() ? payload.authKey.trim() : null;
  if (authKey || status === "completed") await verifyUserAuthKey(userId, authKey);
  const caseEntry = payload.caseEntry && typeof payload.caseEntry === "object" ? payload.caseEntry : {};
  validateCaseEntry(caseEntry);
  const whoVaData = payload.whoVaData && typeof payload.whoVaData === "object" ? payload.whoVaData : {};
  const submission = payload.submission && typeof payload.submission === "object" ? payload.submission : null;
  const validationIssues = Array.isArray(payload.validationIssues) ? payload.validationIssues : [];

  const previousResult = await pool.query(
    `
      select uid, user_id, case_entry, who_va_prefill, submission, validation_issues, status, completed_at
      from who_va_form_entries
      where uid = $1
    `,
    [uid]
  );
  const previous = previousResult.rows[0];
  if (previous?.user_id && userId && previous.user_id !== userId) {
    throw badRequest(`Entry ${uid} belongs to another user and cannot be overwritten by ${userId}`);
  }
  const shouldArchivePrevious =
    status === "completed" &&
    previous &&
    (previous.status === "completed" || previous.completed_at || previous.submission != null);
  if (shouldArchivePrevious) {
    await pool.query(
      `
        insert into who_va_recorded_data (
          entry_uid,
          user_id,
          snapshot_type,
          case_entry,
          who_va_prefill,
          submission,
          validation_issues
        )
        values ($1, $2, 'before_update', $3::jsonb, $4::jsonb, $5::jsonb, $6::jsonb)
      `,
      [
        uid,
        previous.user_id,
        JSON.stringify(previous.case_entry ?? {}),
        JSON.stringify(previous.who_va_prefill ?? {}),
        JSON.stringify(previous.submission ?? {}),
        JSON.stringify(previous.validation_issues ?? [])
      ]
    );
  }

  const result = await pool.query(
    `
      insert into who_va_form_entries (
        uid,
        user_id,
        case_entry,
        who_va_prefill,
        submission,
        validation_issues,
        status,
        completed_at
      )
      values ($1, $2, $3::jsonb, $4::jsonb, $5::jsonb, $6::jsonb, $7, case when $7 = 'completed' then now() else null end)
      on conflict (uid) do update set
        user_id = coalesce(excluded.user_id, who_va_form_entries.user_id),
        case_entry = excluded.case_entry,
        who_va_prefill = excluded.who_va_prefill,
        submission = coalesce(excluded.submission, who_va_form_entries.submission),
        validation_issues = excluded.validation_issues,
        status = case
          when who_va_form_entries.status = 'completed' and excluded.status <> 'completed' then who_va_form_entries.status
          else excluded.status
        end,
        completed_at = case
          when excluded.status = 'completed' then now()
          else who_va_form_entries.completed_at
        end,
        updated_at = now()
      returning id, uid, user_id, status, created_at, updated_at, completed_at
    `,
    [
      uid,
      userId,
      JSON.stringify(caseEntry),
      JSON.stringify(whoVaData),
      submission ? JSON.stringify(submission) : null,
      JSON.stringify(validationIssues),
      status
    ]
  );

  const saved = result.rows[0];

  return {
    ...saved,
    archivedPrevious: Boolean(shouldArchivePrevious),
    recordedSnapshot: Boolean(shouldArchivePrevious)
  };
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

    if (url.pathname === "/api/form-entries" && request.method === "GET") {
      const entries = await listFormEntries();
      sendJson(response, 200, { ok: true, entries });
      return;
    }

    if (url.pathname === "/api/form-entries" && request.method === "POST") {
      const saved = await saveFormEntry(await readJsonBody(request));
      sendJson(response, 200, { ok: true, saved });
      return;
    }

    if (url.pathname === "/api/dashboard" && request.method === "GET") {
      const dashboard = await listUserDashboard(url.searchParams.get("userId"), url.searchParams.get("authKey"));
      sendJson(response, 200, { ok: true, ...dashboard });
      return;
    }

    if (url.pathname === "/api/users" && request.method === "POST") {
      const user = await registerUser(await readJsonBody(request));
      sendJson(response, 200, { ok: true, user });
      return;
    }

    if (url.pathname === "/api/login" && request.method === "POST") {
      const user = await loginUser(await readJsonBody(request));
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

server.listen(PORT, HOST, () => {
  console.log(`WHO VA demo with Postgres saving: http://${HOST}:${PORT}`);
});

process.on("SIGINT", async () => {
  await vite.close();
  await pool.end();
  server.close(() => process.exit(0));
});
