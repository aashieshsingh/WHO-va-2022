import type { SubmissionData, WhoVaDraft } from "@drguptavivek/who-2022-va";

import {
  markCompletedSubmissionPushed,
  type CaseEntryData,
  type CompletedSubmission,
  type RegisteredUser,
  type StoredCaseEntry
} from "./LocalDatabase";

interface SaveFormEntryPayload {
  uid: string;
  userId: string;
  authKey: string;
  caseEntry: CaseEntryData;
  whoVaData: SubmissionData;
  status: "completed";
  submission?: SubmissionData;
  validationIssues?: unknown[];
}

export interface PushResult {
  pushed: number;
  skipped: number;
  failed: number;
  errors: string[];
}

function normalizeApiBaseUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;
  return /^https?:\/\//iu.test(trimmed) ? trimmed : `http://${trimmed}`;
}

async function readJsonResponse<T extends { error?: string }>(response: Response): Promise<T> {
  const responseText = await response.text();
  try {
    return responseText ? (JSON.parse(responseText) as T) : ({} as T);
  } catch {
    throw new Error(
      `Server returned non-JSON while pushing data. Status: ${response.status}. Response: ${responseText || "empty"}`
    );
  }
}

async function pushFormEntry(apiBaseUrl: string, payload: SaveFormEntryPayload): Promise<void> {
  const url = `${normalizeApiBaseUrl(apiBaseUrl).replace(/\/$/u, "")}/api/form-entries`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  const body = await readJsonResponse<{ ok: boolean; error?: string }>(response);
  if (!response.ok || !body.ok) {
    throw new Error(body.error ?? `Push failed for ${payload.uid}. Status: ${response.status}.`);
  }
}

function caseUidFromCompleted(submission: CompletedSubmission): string | undefined {
  const caseUid = submission.result.data.__caseUid;
  return typeof caseUid === "string" ? caseUid : submission.caseEntry?.uid;
}

function buildCompletedPayload(
  user: RegisteredUser,
  entry: StoredCaseEntry,
  submission: CompletedSubmission,
  draft?: WhoVaDraft
): SaveFormEntryPayload {
  return {
    uid: entry.uid,
    userId: user.userId,
    authKey: user.authKey,
    caseEntry: entry.caseEntry,
    whoVaData: draft?.data ?? entry.whoVaData,
    status: "completed",
    submission: submission.result.data,
    validationIssues: submission.result.issues
  };
}

export async function pushLocalDataToServer({
  apiBaseUrl,
  cases,
  completed,
  currentUser,
  drafts
}: {
  apiBaseUrl: string;
  cases: StoredCaseEntry[];
  completed: CompletedSubmission[];
  currentUser: RegisteredUser | undefined;
  drafts: WhoVaDraft[];
}): Promise<PushResult> {
  if (!currentUser?.userId || !currentUser.authKey) {
    throw new Error("Login with an online user before pushing mobile data.");
  }

  const result: PushResult = { pushed: 0, skipped: 0, failed: 0, errors: [] };
  const casesByUid = new Map(cases.map((entry) => [entry.uid, entry]));
  const draftsById = new Map(drafts.map((draft) => [draft.id, draft]));

  for (const submission of completed.filter((entry) => entry.syncStatus === "pending")) {
    const uid = caseUidFromCompleted(submission);
    const caseEntry = uid ? casesByUid.get(uid) : undefined;
    if (!uid || !caseEntry || caseEntry.userId !== currentUser.userId || !submission.result.valid) {
      result.skipped += 1;
      continue;
    }
    try {
      await pushFormEntry(apiBaseUrl, buildCompletedPayload(currentUser, caseEntry, submission, draftsById.get(uid)));
      await markCompletedSubmissionPushed(submission.id);
      result.pushed += 1;
    } catch (error) {
      result.failed += 1;
      result.errors.push((error as Error).message);
    }
  }

  return result;
}
