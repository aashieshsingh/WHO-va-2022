import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { createWhoVaInitialDataFromPrefill } from "@drguptavivek/who-2022-va";
import type { SubmissionData, SubmissionValidationResult, WhoVaDraft, WhoVaDraftStore } from "@drguptavivek/who-2022-va";

import {
  createEntryUid,
  initializeLocalDatabase,
  listCaseEntries,
  listCompletedSubmissions,
  listDrafts,
  listUsers,
  loadCurrentUser,
  loadDraft,
  loginOnlineUser,
  logoutCurrentUser,
  removeDraft,
  saveCaseEntry,
  saveCompletedSubmission,
  saveDraft,
  validateCaseEntryData,
  type CaseEntryData,
  type CompletedSubmission,
  type LoginPayload,
  type RegisteredUser,
  type StoredCaseEntry
} from "./LocalDatabase";
import { pushLocalDataToServer, type PushResult } from "./ServerSync";
export type { CaseEntryData, CompletedSubmission, RegisteredUser, StoredCaseEntry } from "./LocalDatabase";

interface DemoState {
  completed: CompletedSubmission[];
  cases: StoredCaseEntry[];
  currentUser: RegisteredUser | undefined;
  draftStore: WhoVaDraftStore;
  drafts: WhoVaDraft[];
  isDatabaseReady: boolean;
  latestDraft: WhoVaDraft | undefined;
  lastUpdate: string;
  newFormKey: number;
  users: RegisteredUser[];
  addCompleted(result: SubmissionValidationResult): void;
  beginNewInterview(): void;
  getDraft(id: string | undefined): WhoVaDraft | undefined;
  login(payload: LoginPayload, apiBaseUrl?: string): Promise<void>;
  logout(): Promise<void>;
  pushToServer(apiBaseUrl?: string): Promise<PushResult>;
  saveCase(caseEntry: CaseEntryData): Promise<StoredCaseEntry>;
  setLastUpdate(message: string): void;
}

const API_BASE_URL = process.env.EXPO_PUBLIC_WHO_VA_API_URL ?? "http://127.0.0.1:5173";

const DemoStateContext = createContext<DemoState | undefined>(undefined);

export function countAnswers(draft: WhoVaDraft): number {
  return Object.values(draft.data).filter((value) => value !== undefined && value !== null && value !== "")
    .length;
}

export function formatDateTime(value: string): string {
  return new Date(value).toLocaleString();
}

export function DemoStateProvider({ children }: { children: ReactNode }) {
  const [isDatabaseReady, setIsDatabaseReady] = useState(false);
  const [lastUpdate, setLastUpdate] = useState("Opening local database");
  const [drafts, setDrafts] = useState<WhoVaDraft[]>([]);
  const [completed, setCompleted] = useState<CompletedSubmission[]>([]);
  const [cases, setCases] = useState<StoredCaseEntry[]>([]);
  const [currentUser, setCurrentUser] = useState<RegisteredUser | undefined>(undefined);
  const [newFormKey, setNewFormKey] = useState(0);
  const [users, setUsers] = useState<RegisteredUser[]>([]);
  const [serverApiBaseUrl, setServerApiBaseUrl] = useState(API_BASE_URL);

  const refreshLocalData = useCallback(async () => {
    const [savedDrafts, savedCompleted, savedCases, savedUsers] = await Promise.all([
      listDrafts(),
      listCompletedSubmissions(),
      listCaseEntries(),
      listUsers()
    ]);
    setDrafts(savedDrafts);
    setCompleted(savedCompleted);
    setCases(savedCases);
    setUsers(savedUsers);
  }, []);

  useEffect(() => {
    let isMounted = true;

    void initializeLocalDatabase()
      .then(async () => {
        const savedUser = await loadCurrentUser();
        if (isMounted) setCurrentUser(savedUser);
        await refreshLocalData();
      })
      .then(() => {
        if (!isMounted) return;
        setIsDatabaseReady(true);
        setLastUpdate("Local SQLite storage ready");
      })
      .catch((error: unknown) => {
        if (!isMounted) return;
        setLastUpdate(`Local database failed: ${(error as Error).message}`);
      });

    return () => {
      isMounted = false;
    };
  }, [refreshLocalData]);

  const draftStore = useMemo<WhoVaDraftStore>(() => {
    return {
      async save(draft) {
        setDrafts((current) =>
          [draft, ...current.filter((savedDraft) => savedDraft.id !== draft.id)].sort(
            (left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime()
          )
        );
        await saveDraft(draft);
        await refreshLocalData();
      },
      async load(id) {
        return loadDraft(id);
      },
      async remove(id) {
        await removeDraft(id);
        await refreshLocalData();
      }
    };
  }, [refreshLocalData]);

  const value = useMemo<DemoState>(
    () => ({
      addCompleted(result) {
        setLastUpdate(`Submission ready with ${Object.keys(result.data).length} answers`);
        const matchingCase = cases.find((entry) => entry.uid === result.data.__caseUid);
        const submission: CompletedSubmission = {
          completedAt: new Date().toISOString(),
          id: `completed-${Date.now()}`,
          result,
          syncStatus: "pending",
          userId: currentUser?.userId,
          authKey: currentUser?.authKey,
          caseEntry: matchingCase?.caseEntry
        };
        setCompleted((current) => [submission, ...current]);
        void saveCompletedSubmission(submission)
          .then(refreshLocalData)
          .catch((error: unknown) => {
            setLastUpdate(`Local submission save failed: ${(error as Error).message}`);
          });
        console.log("validated submission saved locally", result);
      },
      beginNewInterview() {
        setNewFormKey((current) => current + 1);
        setLastUpdate("New interview started");
      },
      completed,
      cases,
      currentUser,
      draftStore,
      drafts,
      getDraft(id) {
        if (!id) return undefined;
        return drafts.find((draft) => draft.id === id);
      },
      isDatabaseReady,
      async login(payload, apiBaseUrl) {
        const targetApiBaseUrl = apiBaseUrl?.trim() || API_BASE_URL;
        const user = await loginOnlineUser(payload, targetApiBaseUrl);
        setServerApiBaseUrl(targetApiBaseUrl);
        setCurrentUser(user);
        setLastUpdate(`Signed in as ${user.name}`);
        await refreshLocalData();
      },
      async logout() {
        await logoutCurrentUser();
        setCurrentUser(undefined);
        setLastUpdate("Signed out");
      },
      async pushToServer(apiBaseUrl) {
        const result = await pushLocalDataToServer({
          apiBaseUrl: apiBaseUrl?.trim() || serverApiBaseUrl,
          cases,
          completed,
          currentUser,
          drafts
        });
        await refreshLocalData();
        const messageParts = [`Pushed ${result.pushed} entries`];
        if (result.skipped) messageParts.push(`${result.skipped} skipped`);
        if (result.failed) messageParts.push(`${result.failed} failed`);
        setLastUpdate(messageParts.join(", "));
        return result;
      },
      latestDraft: drafts[0],
      lastUpdate,
      newFormKey,
      users,
      async saveCase(caseEntry) {
        if (!currentUser) throw new Error("Login before saving case data.");
        const validationError = validateCaseEntryData(caseEntry);
        if (validationError) throw new Error(validationError);
        const whoVaData = createWhoVaDataFromCaseEntry(caseEntry);
        const stored: StoredCaseEntry = {
          uid: caseEntry.uid,
          userId: currentUser.userId,
          caseEntry,
          whoVaData,
          updatedAt: new Date().toISOString()
        };
        await saveCaseEntry(stored);
        await refreshLocalData();
        setLastUpdate(`Case saved: ${caseEntry.deceasedFullName}`);
        return stored;
      },
      setLastUpdate
    }),
    [
      cases,
      completed,
      currentUser,
      draftStore,
      drafts,
      isDatabaseReady,
      lastUpdate,
      newFormKey,
      refreshLocalData,
      serverApiBaseUrl,
      users
    ]
  );

  return <DemoStateContext.Provider value={value}>{children}</DemoStateContext.Provider>;
}

export function emptyCaseEntry(): CaseEntryData {
  return {
    district: "",
    block: "",
    villages: "",
    phc: "",
    subcentre: "",
    uid: createEntryUid(),
    date: new Date().toISOString().slice(0, 10),
    householdHeadName: "",
    deceasedFullName: "",
    deceasedSex: "undetermined",
    deceasedHouseAddress: "",
    pinCode: "",
    deathDate: "",
    ageAtDeath: 0
  };
}

export function createWhoVaDataFromCaseEntry(entry: CaseEntryData): SubmissionData {
  const deceased =
    entry.ageAtDeath >= 12
      ? {
          givenNames: entry.deceasedFullName,
          sex: entry.deceasedSex,
          ageInYears: entry.ageAtDeath,
          dateOfDeath: entry.deathDate
        }
      : {
          givenNames: entry.deceasedFullName,
          sex: entry.deceasedSex,
          dateOfDeath: entry.deathDate
        };
  const whoVaData = createWhoVaInitialDataFromPrefill({
    deceased,
    location: {
      district: entry.district,
      village: entry.villages
    }
  });

  if (entry.ageAtDeath > 0 && entry.ageAtDeath < 12) {
    whoVaData.Id10020 = "no";
    whoVaData.age_group = "child";
    whoVaData.age_child_unit = "years";
    whoVaData.age_child_years = entry.ageAtDeath;
  }

  whoVaData.__caseUid = entry.uid;
  return whoVaData;
}

export function useDemoState(): DemoState {
  const state = useContext(DemoStateContext);
  if (!state) throw new Error("useDemoState must be used inside DemoStateProvider");
  return state;
}
