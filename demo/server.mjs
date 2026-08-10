import { createServer as createHttpServer } from "node:http";

import { createServer as createViteServer } from "vite";

import { createPostgresPool } from "./db.mjs";
import { runMigrations } from "./migrate.mjs";

const PORT = Number(process.env.PORT ?? 5173);
const pool = createPostgresPool();

const corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,OPTIONS",
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

    if (request.url === "/api/health" && request.method === "GET") {
      await pool.query("select 1");
      sendJson(response, 200, { ok: true, database: process.env.PGDATABASE ?? "whova" });
      return;
    }

    if (request.url === "/api/form-entries" && request.method === "POST") {
      const saved = await saveFormEntry(await readJsonBody(request));
      sendJson(response, 200, { ok: true, saved });
      return;
    }

    vite.middlewares(request, response);
  } catch (error) {
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
