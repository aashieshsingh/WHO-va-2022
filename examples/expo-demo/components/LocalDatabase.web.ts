import type { SubmissionValidationResult, WhoVaDraft } from "@drguptavivek/who-2022-va";

export interface CompletedSubmission {
  id: string;
  completedAt: string;
  result: SubmissionValidationResult;
  syncStatus: "pending" | "pushed";
}

const DRAFTS_KEY = "who-va-2022:expo-demo:drafts";
const COMPLETED_KEY = "who-va-2022:expo-demo:completed";

function readJson<T>(key: string, fallback: T): T {
  const value = globalThis.localStorage?.getItem(key);
  return value ? (JSON.parse(value) as T) : fallback;
}

function writeJson<T>(key: string, value: T): void {
  globalThis.localStorage?.setItem(key, JSON.stringify(value));
}

export async function initializeLocalDatabase(): Promise<void> {
  readJson<WhoVaDraft[]>(DRAFTS_KEY, []);
  readJson<CompletedSubmission[]>(COMPLETED_KEY, []);
}

export async function listDrafts(): Promise<WhoVaDraft[]> {
  return readJson<WhoVaDraft[]>(DRAFTS_KEY, []).sort(
    (left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime()
  );
}

export async function loadDraft(id: string): Promise<WhoVaDraft | undefined> {
  return (await listDrafts()).find((draft) => draft.id === id);
}

export async function saveDraft(draft: WhoVaDraft): Promise<void> {
  const drafts = (await listDrafts()).filter((savedDraft) => savedDraft.id !== draft.id);
  writeJson(DRAFTS_KEY, [draft, ...drafts]);
}

export async function removeDraft(id: string): Promise<void> {
  writeJson(
    DRAFTS_KEY,
    (await listDrafts()).filter((draft) => draft.id !== id)
  );
}

export async function listCompletedSubmissions(): Promise<CompletedSubmission[]> {
  return readJson<CompletedSubmission[]>(COMPLETED_KEY, []).sort(
    (left, right) => new Date(right.completedAt).getTime() - new Date(left.completedAt).getTime()
  );
}

export async function saveCompletedSubmission(submission: CompletedSubmission): Promise<void> {
  const submissions = (await listCompletedSubmissions()).filter((saved) => saved.id !== submission.id);
  writeJson(COMPLETED_KEY, [submission, ...submissions]);
}

export async function markCompletedSubmissionPushed(id: string): Promise<void> {
  writeJson(
    COMPLETED_KEY,
    (await listCompletedSubmissions()).map((submission) =>
      submission.id === id ? { ...submission, syncStatus: "pushed" } : submission
    )
  );
}
