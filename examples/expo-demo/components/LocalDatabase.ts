import * as SQLite from "expo-sqlite";

import type { SubmissionData, SubmissionValidationResult, WhoVaDraft } from "@drguptavivek/who-2022-va";

export type UserRole = "admin" | "data-entry";

export interface RegisteredUser {
  userId: string;
  name: string;
  email: string;
  role: UserRole;
  partnerSite: string;
  siteAssigned: string;
  authKey: string;
  createdAt: string;
}

export interface LoginPayload {
  email: string;
  password: string;
}

export interface CaseEntryData {
  district: string;
  block: string;
  villages: string;
  phc: string;
  subcentre: string;
  uid: string;
  date: string;
  householdHeadName: string;
  deceasedFullName: string;
  deceasedSex: "female" | "male" | "undetermined";
  deceasedHouseAddress: string;
  pinCode: string;
  deathDate: string;
  ageAtDeath: number;
}

export interface StoredCaseEntry {
  uid: string;
  userId: string;
  caseEntry: CaseEntryData;
  whoVaData: SubmissionData;
  updatedAt: string;
}

export interface CompletedSubmission {
  id: string;
  completedAt: string;
  result: SubmissionValidationResult;
  syncStatus: "pending" | "pushed";
  authKey?: string;
  caseEntry?: CaseEntryData;
  userId?: string;
}

type Database = SQLite.SQLiteDatabase;

interface DraftRow {
  id: string;
  created_at: string;
  updated_at: string;
  payload: string;
}

interface CompletedSubmissionRow {
  id: string;
  completed_at: string;
  payload: string;
  sync_status: "pending" | "pushed";
  auth_key?: string | null;
  case_entry?: string | null;
  user_id?: string | null;
}

interface UserRow {
  user_id: string;
  name: string;
  email: string;
  role: UserRole;
  partner_site: string;
  site_assigned: string;
  password_hash?: string;
  auth_key: string;
  created_at: string;
}

interface CaseEntryRow {
  uid: string;
  user_id: string;
  case_entry: string;
  who_va_data: string;
  updated_at: string;
}

let databasePromise: Promise<Database> | undefined;

async function openDatabase(): Promise<Database> {
  databasePromise ??= SQLite.openDatabaseAsync("who-va-2022.db");
  return databasePromise;
}

function decodeJson<T>(value: string, label: string): T {
  try {
    return JSON.parse(value) as T;
  } catch (error) {
    throw new Error(`Could not decode saved ${label}: ${(error as Error).message}`);
  }
}

async function addColumnIfMissing(database: Database, table: string, column: string, definition: string): Promise<void> {
  const columns = await database.getAllAsync<{ name: string }>(`PRAGMA table_info(${table})`);
  if (columns.some((candidate) => candidate.name === column)) return;
  await database.execAsync(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

export async function initializeLocalDatabase(): Promise<void> {
  const database = await openDatabase();
  await database.execAsync(`
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS drafts (
      id TEXT PRIMARY KEY NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      payload TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS completed_submissions (
      id TEXT PRIMARY KEY NOT NULL,
      completed_at TEXT NOT NULL,
      payload TEXT NOT NULL,
      sync_status TEXT NOT NULL DEFAULT 'pending',
      user_id TEXT,
      auth_key TEXT,
      case_entry TEXT,
      pushed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS users (
      user_id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      role TEXT NOT NULL,
      partner_site TEXT NOT NULL,
      site_assigned TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      auth_key TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS current_user (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      user_id TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS case_entries (
      uid TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL,
      case_entry TEXT NOT NULL,
      who_va_data TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_drafts_updated_at
      ON drafts(updated_at DESC);

    CREATE INDEX IF NOT EXISTS idx_completed_submissions_sync_status
      ON completed_submissions(sync_status, completed_at DESC);

    CREATE INDEX IF NOT EXISTS idx_case_entries_updated_at
      ON case_entries(updated_at DESC);
  `);
  await addColumnIfMissing(database, "completed_submissions", "user_id", "TEXT");
  await addColumnIfMissing(database, "completed_submissions", "auth_key", "TEXT");
  await addColumnIfMissing(database, "completed_submissions", "case_entry", "TEXT");
}

function createLocalId(prefix: string): string {
  const random = Math.random().toString(36).slice(2, 10).toUpperCase();
  return `${prefix}-${Date.now().toString(36).toUpperCase()}-${random}`;
}

function userFromRow(row: UserRow): RegisteredUser {
  return {
    userId: row.user_id,
    name: row.name,
    email: row.email,
    role: row.role,
    partnerSite: row.partner_site,
    siteAssigned: row.site_assigned,
    authKey: row.auth_key,
    createdAt: row.created_at
  };
}

function hashPassword(password: string, email: string): string {
  let hash = 2166136261;
  const source = `${email.trim().toLowerCase()}:${password}`;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `local-fnv:${(hash >>> 0).toString(16)}`;
}

async function cacheServerUser(user: RegisteredUser, password: string): Promise<void> {
  const database = await openDatabase();
  await database.runAsync(
    `
      INSERT INTO users (
        user_id, name, email, role, partner_site, site_assigned, password_hash, auth_key, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        name = excluded.name,
        email = excluded.email,
        role = excluded.role,
        partner_site = excluded.partner_site,
        site_assigned = excluded.site_assigned,
        password_hash = excluded.password_hash,
        auth_key = excluded.auth_key
    `,
    user.userId,
    user.name,
    user.email,
    user.role,
    user.partnerSite,
    user.siteAssigned,
    hashPassword(password, user.email),
    user.authKey,
    user.createdAt
  );
}

export async function loginCachedUser(data: LoginPayload): Promise<RegisteredUser> {
  const database = await openDatabase();
  const email = data.email.trim().toLowerCase();
  const row = await database.getFirstAsync<UserRow>(
    `
      SELECT user_id, name, email, role, partner_site, site_assigned, password_hash, auth_key, created_at
      FROM users
      WHERE lower(email) = ?
    `,
    email
  );

  if (!row?.auth_key || !row.password_hash || row.password_hash !== hashPassword(data.password, row.email)) {
    throw new Error("No matching local login found. First login must be online.");
  }

  await setCurrentUser(row.user_id);
  return userFromRow(row);
}

export async function listUsers(): Promise<RegisteredUser[]> {
  const database = await openDatabase();
  const rows = await database.getAllAsync<UserRow>(
    `
      SELECT user_id, name, email, role, partner_site, site_assigned, password_hash, auth_key, created_at
      FROM users
      ORDER BY name ASC, email ASC
    `
  );
  return rows.map(userFromRow);
}

function normalizeApiBaseUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;
  return /^https?:\/\//iu.test(trimmed) ? trimmed : `http://${trimmed}`;
}

export async function loginOnlineUser(data: LoginPayload, apiBaseUrl: string): Promise<RegisteredUser> {
  const url = `${normalizeApiBaseUrl(apiBaseUrl).replace(/\/$/u, "")}/api/login`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(data)
    });
  } catch (error) {
    try {
      return await loginCachedUser(data);
    } catch (localError) {
      throw new Error(
        `Could not reach login server at ${url}. ${(localError as Error).message} Check server, IP address, Wi-Fi, and firewall.`
      );
    }
  }

  const responseText = await response.text();
  let body: { ok: boolean; user?: RegisteredUser; error?: string };
  try {
    body = responseText ? (JSON.parse(responseText) as { ok: boolean; user?: RegisteredUser; error?: string }) : { ok: false };
  } catch {
    const preview = responseText.trim().slice(0, 80);
    throw new Error(
      `Login server at ${url} did not return JSON. Check that Server URL points to the WHO VA demo API, not the Expo app or another web page.${preview ? ` Response started with: ${preview}` : ""}`
    );
  }
  if (!response.ok || !body.ok || !body.user?.authKey) {
    throw new Error(body.error ?? "Online login failed.");
  }
  await cacheServerUser(body.user, data.password);
  await setCurrentUser(body.user.userId);
  return body.user;
}
export async function setCurrentUser(userId: string): Promise<void> {
  const database = await openDatabase();
  await database.runAsync(
    "INSERT INTO current_user (id, user_id) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET user_id = excluded.user_id",
    userId
  );
}

export async function loadCurrentUser(): Promise<RegisteredUser | undefined> {
  const database = await openDatabase();
  const row = await database.getFirstAsync<UserRow>(
    `
      SELECT users.user_id, name, email, role, partner_site, site_assigned, auth_key, created_at
      FROM current_user
      JOIN users ON users.user_id = current_user.user_id
      WHERE current_user.id = 1
    `
  );
  return row ? userFromRow(row) : undefined;
}

export async function logoutCurrentUser(): Promise<void> {
  const database = await openDatabase();
  await database.runAsync("DELETE FROM current_user WHERE id = 1");
}

export async function listDrafts(): Promise<WhoVaDraft[]> {
  const database = await openDatabase();
  const rows = await database.getAllAsync<DraftRow>(
    "SELECT id, created_at, updated_at, payload FROM drafts ORDER BY updated_at DESC"
  );
  return rows.map((row) => decodeJson<WhoVaDraft>(row.payload, `draft ${row.id}`));
}

export async function loadDraft(id: string): Promise<WhoVaDraft | undefined> {
  const database = await openDatabase();
  const row = await database.getFirstAsync<DraftRow>(
    "SELECT id, created_at, updated_at, payload FROM drafts WHERE id = ?",
    id
  );
  return row ? decodeJson<WhoVaDraft>(row.payload, `draft ${row.id}`) : undefined;
}

export async function saveDraft(draft: WhoVaDraft): Promise<void> {
  const database = await openDatabase();
  await database.runAsync(
    `
      INSERT INTO drafts (id, created_at, updated_at, payload)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        updated_at = excluded.updated_at,
        payload = excluded.payload
    `,
    draft.id,
    draft.createdAt,
    draft.updatedAt,
    JSON.stringify(draft)
  );
}

export async function removeDraft(id: string): Promise<void> {
  const database = await openDatabase();
  await database.runAsync("DELETE FROM drafts WHERE id = ?", id);
}

export async function listCompletedSubmissions(): Promise<CompletedSubmission[]> {
  const database = await openDatabase();
  const rows = await database.getAllAsync<CompletedSubmissionRow>(
    `
      SELECT id, completed_at, payload, sync_status, user_id, auth_key, case_entry
      FROM completed_submissions
      ORDER BY completed_at DESC
    `
  );
  return rows.map((row) => ({
    id: row.id,
    completedAt: row.completed_at,
    result: decodeJson<SubmissionValidationResult>(row.payload, `completed submission ${row.id}`),
    syncStatus: row.sync_status,
    ...(row.user_id ? { userId: row.user_id } : {}),
    ...(row.auth_key ? { authKey: row.auth_key } : {}),
    ...(row.case_entry ? { caseEntry: decodeJson<CaseEntryData>(row.case_entry, `case entry ${row.id}`) } : {})
  }));
}

export async function saveCompletedSubmission(submission: CompletedSubmission): Promise<void> {
  const database = await openDatabase();
  await database.runAsync(
    `
      INSERT INTO completed_submissions (id, completed_at, payload, sync_status, user_id, auth_key, case_entry)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        payload = excluded.payload,
        sync_status = excluded.sync_status,
        user_id = excluded.user_id,
        auth_key = excluded.auth_key,
        case_entry = excluded.case_entry
    `,
    submission.id,
    submission.completedAt,
    JSON.stringify(submission.result),
    submission.syncStatus,
    submission.userId ?? null,
    submission.authKey ?? null,
    submission.caseEntry ? JSON.stringify(submission.caseEntry) : null
  );
}

export async function markCompletedSubmissionPushed(id: string): Promise<void> {
  const database = await openDatabase();
  await database.runAsync(
    "UPDATE completed_submissions SET sync_status = 'pushed', pushed_at = ? WHERE id = ?",
    new Date().toISOString(),
    id
  );
}

export function createEntryUid(): string {
  return createLocalId("VA");
}

export function validateCaseEntryData(caseEntry: CaseEntryData): string | undefined {
  const characterOnlyFields: Array<[keyof CaseEntryData, string]> = [
    ["district", "District"],
    ["block", "Block"],
    ["villages", "Villages"],
    ["phc", "Phc"],
    ["subcentre", "Subcentre"],
    ["householdHeadName", "Name of head of the Household"],
    ["deceasedFullName", "Full name of the deceased"]
  ];
  for (const [field, label] of characterOnlyFields) {
    const value = String(caseEntry[field] ?? "").trim();
    if (!/^[A-Za-z]+(?: [A-Za-z]+)*$/u.test(value)) {
      return `${label} accepts letters only. Spaces are allowed between words.`;
    }
  }
  if (!["female", "male", "undetermined"].includes(caseEntry.deceasedSex)) {
    return "Select a valid sex of the deceased.";
  }
  if (!caseEntry.uid.trim()) return "UID is required.";
  if (!caseEntry.date) return "Entry date is required.";
  if (!caseEntry.deceasedHouseAddress.trim()) return "House address of the deceased is required.";
  if (!/^[0-9]{6}$/u.test(caseEntry.pinCode.trim())) return "Pin code must be exactly 6 digits.";
  if (!caseEntry.deathDate) return "Death date is required.";
  if (!Number.isInteger(caseEntry.ageAtDeath) || caseEntry.ageAtDeath < 0 || caseEntry.ageAtDeath > 130) {
    return "Age at the time of death must be a whole number from 0 to 130.";
  }
  return undefined;
}

export async function saveCaseEntry(entry: StoredCaseEntry): Promise<void> {
  const validationError = validateCaseEntryData(entry.caseEntry);
  if (validationError) throw new Error(validationError);
  const database = await openDatabase();
  await database.runAsync(
    `
      INSERT INTO case_entries (uid, user_id, case_entry, who_va_data, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(uid) DO UPDATE SET
        user_id = excluded.user_id,
        case_entry = excluded.case_entry,
        who_va_data = excluded.who_va_data,
        updated_at = excluded.updated_at
    `,
    entry.uid,
    entry.userId,
    JSON.stringify(entry.caseEntry),
    JSON.stringify(entry.whoVaData),
    entry.updatedAt
  );
}

export async function listCaseEntries(): Promise<StoredCaseEntry[]> {
  const database = await openDatabase();
  const rows = await database.getAllAsync<CaseEntryRow>(
    "SELECT uid, user_id, case_entry, who_va_data, updated_at FROM case_entries ORDER BY updated_at DESC"
  );
  return rows.map((row) => ({
    uid: row.uid,
    userId: row.user_id,
    caseEntry: decodeJson<CaseEntryData>(row.case_entry, `case entry ${row.uid}`),
    whoVaData: decodeJson<SubmissionData>(row.who_va_data, `WHO VA prefill ${row.uid}`),
    updatedAt: row.updated_at
  }));
}

export async function loadCaseEntry(uid: string): Promise<StoredCaseEntry | undefined> {
  return (await listCaseEntries()).find((entry) => entry.uid === uid);
}
