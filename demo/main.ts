import {
  createInsecureWhoVaBrowserDefaults,
  defineWhoVaElement,
  type WhoVaFormElement
} from "../src/web-component.js";
import { WHO_VA_2022_LANGUAGES } from "../src/instrument-loader.js";
import { createWhoVaInitialDataFromPrefill } from "../src/prefill.js";
import type { WhoVaDraft, WhoVaDraftStore } from "../src/types.js";

interface CaseEntryData {
  district: string;
  block: string;
  villages: string;
  phc: string;
  subcentre: string;
  uid: string;
  date: string;
  householdHeadName: string;
  deceasedFullName: string;
  deceasedHouseAddress: string;
  pinCode: string;
  deathDate: string;
  ageAtDeath: number;
}

interface RegisteredUser {
  userId: string;
  name: string;
  email: string;
  partnerSite: string;
  siteAssigned: string;
  createdAt: string;
}

interface RegisterUserPayload {
  name: string;
  email: string;
  partnerSite: string;
  siteAssigned: string;
  password: string;
}

interface LoginPayload {
  email: string;
  password: string;
}

interface SavedFormEntry {
  id: number;
  uid: string;
  status: string;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

interface SaveFormEntryPayload {
  uid: string;
  caseEntry: CaseEntryData;
  whoVaData: Record<string, unknown>;
  status: "case-entry" | "completed";
  submission?: Record<string, unknown>;
  validationIssues?: unknown[];
}

interface StoredCaseEntry {
  uid: string;
  caseEntry: CaseEntryData;
  whoVaData: Record<string, unknown>;
  updatedAt: string;
}

defineWhoVaElement();

const LOCAL_CASE_ENTRIES_KEY = "who-va-demo-case-entries";

const form = document.querySelector<WhoVaFormElement>("#who-va-form");
const language = document.querySelector<HTMLSelectElement>("#language");

if (form) {
  const insecureDemoDefaults = createInsecureWhoVaBrowserDefaults();
  form.platform = insecureDemoDefaults.platform;
}

for (const availableLanguage of WHO_VA_2022_LANGUAGES) {
  const option = document.createElement("option");
  option.value = availableLanguage.locale;
  option.textContent = availableLanguage.label;
  option.selected = availableLanguage.locale === (form?.getAttribute("locale") ?? "en");
  language?.append(option);
}

language?.addEventListener("change", () => {
  form?.setAttribute("locale", language.value);
  document.documentElement.lang = language.value;
});

const loginShell = document.querySelector<HTMLElement>("#login-shell");
const loginForm = document.querySelector<HTMLFormElement>("#login-form");
const loginOutput = document.querySelector<HTMLOutputElement>("#login-output");
const adminShell = document.querySelector<HTMLElement>("#admin-shell");
const adminSummary = document.querySelector<HTMLElement>("#admin-summary");
const adminRegisterUser = document.querySelector<HTMLButtonElement>("#admin-register-user");
const adminOpenDataEntry = document.querySelector<HTMLButtonElement>("#admin-open-data-entry");
const registrationShell = document.querySelector<HTMLElement>("#registration-shell");
const registrationForm = document.querySelector<HTMLFormElement>("#registration-form");
const registrationOutput = document.querySelector<HTMLOutputElement>("#registration-output");
const generatedUserIdInput = document.querySelector<HTMLInputElement>("#generated-user-id");
const showLogin = document.querySelector<HTMLButtonElement>("#show-login");
const showRegistration = document.querySelector<HTMLButtonElement>("#show-registration");
const clearRegistration = document.querySelector<HTMLButtonElement>("#clear-registration");
const casePickerShell = document.querySelector<HTMLElement>("#case-picker-shell");
const deceasedEntrySelect = document.querySelector<HTMLSelectElement>("#deceased-entry-select");
const selectedEntryOutput = document.querySelector<HTMLOutputElement>("#selected-entry-output");
const newCaseEntry = document.querySelector<HTMLButtonElement>("#new-case-entry");
const startSelectedEntries = Array.from(
  document.querySelectorAll<HTMLButtonElement>(".start-selected-entry")
);
const entryShell = document.querySelector<HTMLElement>("#case-entry-shell");
const whoVaShell = document.querySelector<HTMLElement>("#who-va-shell");
const chooseCaseEntry = document.querySelector<HTMLButtonElement>("#choose-case-entry");
const editCaseEntry = document.querySelector<HTMLButtonElement>("#edit-case-entry");
const entryForm = document.querySelector<HTMLFormElement>("#case-entry-form");
const clearCaseEntry = document.querySelector<HTMLButtonElement>("#clear-case-entry");
const uidInput = document.querySelector<HTMLInputElement>("#uid");
const entryOutput = document.querySelector<HTMLOutputElement>("#case-entry-output");
const whoVaOutput = document.querySelector<HTMLOutputElement>("#who-va-output");
let currentCaseEntry: CaseEntryData | undefined;
let currentWhoVaData: Record<string, unknown> | undefined;

const createEntryUid = () => {
  const randomPart = crypto.getRandomValues(new Uint32Array(1))[0].toString(36).padStart(7, "0");
  return `VA-${Date.now().toString(36).toUpperCase()}-${randomPart.toUpperCase()}`;
};

const setVisibleStep = (step: "login" | "registration" | "admin" | "picker" | "entry" | "instrument") => {
  if (loginShell) loginShell.hidden = step !== "login";
  if (registrationShell) registrationShell.hidden = step !== "registration";
  if (adminShell) adminShell.hidden = step !== "admin";
  if (casePickerShell) casePickerShell.hidden = step !== "picker";
  if (entryShell) entryShell.hidden = step !== "entry";
  if (whoVaShell) whoVaShell.hidden = step !== "instrument";
};

const readStoredCaseEntries = (): StoredCaseEntry[] => {
  try {
    const raw = localStorage.getItem(LOCAL_CASE_ENTRIES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is StoredCaseEntry => {
      if (!entry || typeof entry !== "object") return false;
      const candidate = entry as Partial<StoredCaseEntry>;
      return Boolean(candidate.uid && candidate.caseEntry && candidate.whoVaData);
    });
  } catch {
    return [];
  }
};

const writeStoredCaseEntries = (entries: StoredCaseEntry[]) => {
  localStorage.setItem(LOCAL_CASE_ENTRIES_KEY, JSON.stringify(entries));
};

const rememberCaseEntry = (caseEntry: CaseEntryData, whoVaData: Record<string, unknown>) => {
  const entries = readStoredCaseEntries().filter((entry) => entry.uid !== caseEntry.uid);
  entries.unshift({ uid: caseEntry.uid, caseEntry, whoVaData, updatedAt: new Date().toISOString() });
  writeStoredCaseEntries(entries.slice(0, 100));
};

const selectedStoredCaseEntry = () => {
  const uid = deceasedEntrySelect?.value;
  if (!uid) return undefined;
  return readStoredCaseEntries().find((entry) => entry.uid === uid);
};

let pickerStatusMessage: string | undefined;

const renderSelectedEntrySummary = () => {
  const selected = selectedStoredCaseEntry();
  for (const button of startSelectedEntries) button.disabled = !selected;
  if (!selectedEntryOutput) return;

  if (!selected) {
    selectedEntryOutput.hidden = !pickerStatusMessage;
    selectedEntryOutput.textContent = pickerStatusMessage ?? "";
    return;
  }

  const entry = selected.caseEntry;
  selectedEntryOutput.hidden = false;
  selectedEntryOutput.textContent = [
    ...(pickerStatusMessage ? [pickerStatusMessage, ""] : []),
    `UID: ${entry.uid}`,
    `Household head: ${entry.householdHeadName}`,
    `Address: ${entry.deceasedHouseAddress}`,
    `Village: ${entry.villages}`,
    `District: ${entry.district}`,
    `Death date: ${entry.deathDate}`,
    `Age at death: ${entry.ageAtDeath}`
  ].join("\n");
};

const renderDeceasedDropdown = () => {
  if (!deceasedEntrySelect) return;
  const currentValue = deceasedEntrySelect.value;
  const entries = readStoredCaseEntries();
  deceasedEntrySelect.replaceChildren();

  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = entries.length ? "Select deceased name" : "No saved deceased entries";
  deceasedEntrySelect.append(placeholder);

  for (const stored of entries) {
    const option = document.createElement("option");
    option.value = stored.uid;
    option.textContent = `${stored.caseEntry.deceasedFullName} (${stored.uid})`;
    option.selected = stored.uid === currentValue;
    deceasedEntrySelect.append(option);
  }

  renderSelectedEntrySummary();
};

const setDefaultEntryValues = () => {
  if (!entryForm || !uidInput) return;

  uidInput.value = createEntryUid();
  const dateInput = entryForm.elements.namedItem("date") as HTMLInputElement | null;
  if (dateInput && !dateInput.value) {
    dateInput.value = new Date().toISOString().slice(0, 10);
  }
};

const clearEntryFormValues = () => {
  entryForm?.reset();
  window.setTimeout(() => {
    setDefaultEntryValues();
    if (entryOutput) {
      entryOutput.hidden = true;
      entryOutput.textContent = "";
    }
    currentCaseEntry = undefined;
    currentWhoVaData = undefined;
  });
};

const fillCaseEntryForm = (entry: CaseEntryData) => {
  if (!entryForm) return;
  for (const [name, value] of Object.entries(entry)) {
    const control = entryForm.elements.namedItem(name) as HTMLInputElement | HTMLTextAreaElement | null;
    if (control) control.value = String(value);
  }
};

const readCaseEntryData = (sourceForm: HTMLFormElement): CaseEntryData => {
  const formData = new FormData(sourceForm);
  return {
    district: String(formData.get("district") ?? ""),
    block: String(formData.get("block") ?? ""),
    villages: String(formData.get("villages") ?? ""),
    phc: String(formData.get("phc") ?? ""),
    subcentre: String(formData.get("subcentre") ?? ""),
    uid: String(formData.get("uid") ?? ""),
    date: String(formData.get("date") ?? ""),
    householdHeadName: String(formData.get("householdHeadName") ?? ""),
    deceasedFullName: String(formData.get("deceasedFullName") ?? ""),
    deceasedHouseAddress: String(formData.get("deceasedHouseAddress") ?? ""),
    pinCode: String(formData.get("pinCode") ?? ""),
    deathDate: String(formData.get("deathDate") ?? ""),
    ageAtDeath: Number(formData.get("ageAtDeath") ?? 0)
  };
};

const createWhoVaDataFromCaseEntry = (entry: CaseEntryData) => {
  const whoVaData = createWhoVaInitialDataFromPrefill({
    deceased: {
      givenNames: entry.deceasedFullName,
      ...(entry.ageAtDeath >= 12 ? { ageInYears: entry.ageAtDeath } : {}),
      dateOfDeath: entry.deathDate
    },
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

  return whoVaData as Record<string, unknown>;
};

const showEntryOutput = (value: unknown) => {
  const output = whoVaShell?.hidden ? entryOutput : whoVaOutput;
  if (!output) return;
  output.hidden = false;
  output.textContent = typeof value === "string" ? value : JSON.stringify(value, null, 2);
};
const showRegistrationOutput = (value: unknown) => {
  if (!registrationOutput) return;
  registrationOutput.hidden = false;
  registrationOutput.textContent = typeof value === "string" ? value : JSON.stringify(value, null, 2);
};

const usersApiUrl = () => "/api/users";

const readRegistrationData = (sourceForm: HTMLFormElement): RegisterUserPayload => {
  const formData = new FormData(sourceForm);
  return {
    name: String(formData.get("name") ?? "").trim(),
    email: String(formData.get("email") ?? "")
      .trim()
      .toLowerCase(),
    partnerSite: String(formData.get("partnerSite") ?? "").trim(),
    siteAssigned: String(formData.get("siteAssigned") ?? "").trim(),
    password: String(formData.get("password") ?? "")
  };
};

const validateRegistrationData = (data: RegisterUserPayload): string | undefined => {
  if (!/^[A-Za-z]+(?: [A-Za-z]+)*$/u.test(data.name)) {
    return "Name accepts letters only. Spaces are allowed between words.";
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(data.email)) return "Enter a valid email address.";
  if (!data.partnerSite) return "Select a partner site.";
  if (!data.siteAssigned) return "Select an assigned site.";
  if (data.password.length < 8) return "Password must be at least 8 characters.";
  return undefined;
};

const registerUser = async (payload: RegisterUserPayload): Promise<RegisteredUser> => {
  const response = await fetch(usersApiUrl(), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  const body = await readJsonResponse<{ ok: boolean; user?: RegisteredUser; error?: string }>(response);
  if (!response.ok || !body.ok || !body.user) {
    throw new Error(body.error ?? `User could not be registered. Status: ${response.status}.`);
  }
  return body.user;
};
const readLoginData = (sourceForm: HTMLFormElement): LoginPayload => {
  const formData = new FormData(sourceForm);
  return {
    email: String(formData.get("email") ?? "")
      .trim()
      .toLowerCase(),
    password: String(formData.get("password") ?? "")
  };
};

const loginUser = async (payload: LoginPayload): Promise<RegisteredUser> => {
  const response = await fetch("/api/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  const body = await readJsonResponse<{ ok: boolean; user?: RegisteredUser; error?: string }>(response);
  if (!response.ok || !body.ok || !body.user) {
    throw new Error(body.error ?? `Login failed. Status: ${response.status}.`);
  }
  return body.user;
};

const showLoginOutput = (value: unknown) => {
  if (!loginOutput) return;
  loginOutput.hidden = false;
  loginOutput.textContent = typeof value === "string" ? value : JSON.stringify(value, null, 2);
};

const showRolePage = (user: RegisteredUser) => {
  if (user.role === "admin") {
    if (adminSummary) {
      adminSummary.textContent = `Signed in as ${user.name} (${user.email}). Role: Admin.`;
    }
    setVisibleStep("admin");
    adminShell?.scrollIntoView({ block: "start" });
    return;
  }
  renderDeceasedDropdown();
  setVisibleStep("picker");
  casePickerShell?.scrollIntoView({ block: "start" });
};

const applyCaseEntryToInstrument = async (caseEntry: CaseEntryData, whoVaData: Record<string, unknown>) => {
  currentCaseEntry = caseEntry;
  currentWhoVaData = whoVaData;
  form?.setAttribute("draft-id", caseEntry.uid);
  form?.setData(whoVaData);
  setVisibleStep("instrument");
  whoVaShell?.scrollIntoView({ block: "start" });

  try {
    const savedDraft = await dbDraftStore.load(caseEntry.uid);
    if (savedDraft) form?.setData(savedDraft.data);
  } catch (error) {
    console.warn("Could not load saved WHO VA draft", error);
  }
};

const formEntriesApiUrl = () => "/api/form-entries";

const draftsApiUrl = (id?: string) => {
  const base = formEntriesApiUrl().replace(/\/form-entries$/u, "/drafts");
  return id ? `${base}/${encodeURIComponent(id)}` : base;
};

const readJsonResponse = async <T extends { error?: string }>(response: Response): Promise<T> => {
  const responseText = await response.text();
  try {
    const body = responseText ? (JSON.parse(responseText) as T) : ({} as T);
    if (!response.ok && body.error) {
      throw new Error(`${body.error} (HTTP ${response.status})`);
    }
    return body;
  } catch (error) {
    if (error instanceof Error && responseText && responseText.trim().startsWith("{")) throw error;
    throw new Error(
      `The save API returned a non-JSON response. Open the DB-backed demo server, not the plain Vite server. Status: ${response.status}. Response: ${responseText || "empty"}`
    );
  }
};

const dbDraftStore: WhoVaDraftStore = {
  async save(draft) {
    const response = await fetch(draftsApiUrl(), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ draft })
    });
    const body = await readJsonResponse<{ ok: boolean; error?: string }>(response);
    if (!response.ok || !body.ok) {
      throw new Error(body.error ?? `Draft could not be saved. Status: ${response.status}.`);
    }
  },
  async load(id) {
    const response = await fetch(draftsApiUrl(id));
    if (response.status === 404) return undefined;
    const body = await readJsonResponse<{ ok: boolean; draft?: WhoVaDraft; error?: string }>(response);
    if (!response.ok || !body.ok) {
      throw new Error(body.error ?? `Draft could not be loaded. Status: ${response.status}.`);
    }
    return body.draft;
  },
  async remove(id) {
    const response = await fetch(draftsApiUrl(id), { method: "DELETE" });
    const body = await readJsonResponse<{ ok: boolean; error?: string }>(response);
    if (!response.ok || !body.ok) {
      throw new Error(body.error ?? `Draft could not be removed. Status: ${response.status}.`);
    }
  }
};
if (form) form.draftStore = dbDraftStore;

form?.addEventListener("who-va-draft-saved", (event) => {
  const draft = (event as CustomEvent<WhoVaDraft>).detail;
  showEntryOutput(`Draft saved to PostgreSQL: ${draft.id}`);
});

form?.addEventListener("who-va-draft-error", (event) => {
  const error = (event as CustomEvent<Error>).detail;
  showEntryOutput(error instanceof Error ? error.message : String(error));
});

const saveFormEntry = async (payload: SaveFormEntryPayload): Promise<SavedFormEntry> => {
  const response = await fetch(formEntriesApiUrl(), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  const responseText = await response.text();
  let body: { ok: boolean; saved?: SavedFormEntry; error?: string } | undefined;
  try {
    body = responseText
      ? (JSON.parse(responseText) as { ok: boolean; saved?: SavedFormEntry; error?: string })
      : undefined;
  } catch {
    throw new Error(
      `The save API returned a non-JSON response. Open the DB-backed demo server, not the plain Vite server. Status: ${response.status}.`
    );
  }
  if (!response.ok || !body?.ok || !body.saved) {
    throw new Error(
      body?.error ??
        `The entry could not be saved. Status: ${response.status}. Response: ${responseText || "empty"}`
    );
  }
  return body.saved;
};

showLogin?.addEventListener("click", () => {
  setVisibleStep("login");
  loginShell?.scrollIntoView({ block: "start" });
});

adminRegisterUser?.addEventListener("click", () => {
  setVisibleStep("registration");
  registrationShell?.scrollIntoView({ block: "start" });
});

adminOpenDataEntry?.addEventListener("click", () => {
  renderDeceasedDropdown();
  setVisibleStep("picker");
  casePickerShell?.scrollIntoView({ block: "start" });
});

loginForm?.addEventListener("submit", (event) => {
  event.preventDefault();
  void (async () => {
    const submitButton = loginForm.querySelector<HTMLButtonElement>('button[type="submit"]');
    submitButton?.setAttribute("disabled", "true");
    showLoginOutput("Signing in...");
    try {
      const user = await loginUser(readLoginData(loginForm));
      showLoginOutput(`Login successful. Role: ${user.role === "admin" ? "Admin" : "Data entry"}`);
      showRolePage(user);
    } catch (error) {
      showLoginOutput(error instanceof Error ? error.message : String(error));
    } finally {
      submitButton?.removeAttribute("disabled");
    }
  })();
});
showRegistration?.addEventListener("click", () => {
  setVisibleStep("registration");
  registrationShell?.scrollIntoView({ block: "start" });
});

clearRegistration?.addEventListener("click", () => {
  registrationForm?.reset();
  if (generatedUserIdInput) generatedUserIdInput.value = "";
  if (registrationOutput) {
    registrationOutput.hidden = true;
    registrationOutput.textContent = "";
  }
});

registrationForm?.addEventListener("submit", (event) => {
  event.preventDefault();
  void (async () => {
    const submitButton = registrationForm.querySelector<HTMLButtonElement>('button[type="submit"]');
    submitButton?.setAttribute("disabled", "true");
    showRegistrationOutput("Registering user...");

    try {
      const registrationData = readRegistrationData(registrationForm);
      const validationError = validateRegistrationData(registrationData);
      if (validationError) {
        showRegistrationOutput(validationError);
        return;
      }
      const user = await registerUser(registrationData);
      if (generatedUserIdInput) generatedUserIdInput.value = user.userId;
      showRegistrationOutput(
        [
          "Registration successful",
          `User ID: ${user.userId}`,
          `Name: ${user.name}`,
          `Email: ${user.email}`,
          `Partner site: ${user.partnerSite}`,
          `Site assigned: ${user.siteAssigned}`
        ].join("\n")
      );
      window.alert(`Registration successful. User ID: ${user.userId}`);
    } catch (error) {
      showRegistrationOutput(error instanceof Error ? error.message : String(error));
    } finally {
      submitButton?.removeAttribute("disabled");
    }
  })();
});
deceasedEntrySelect?.addEventListener("change", () => {
  pickerStatusMessage = undefined;
  renderSelectedEntrySummary();
});

newCaseEntry?.addEventListener("click", () => {
  pickerStatusMessage = undefined;
  clearEntryFormValues();
  setVisibleStep("entry");
  entryShell?.scrollIntoView({ block: "start" });
});

for (const button of startSelectedEntries) {
  button.addEventListener("click", () => {
    void (async () => {
      const selected = selectedStoredCaseEntry();
      if (!selected) return;
      fillCaseEntryForm(selected.caseEntry);
      await applyCaseEntryToInstrument(selected.caseEntry, selected.whoVaData);
    })().catch((error: unknown) => {
      showEntryOutput(error instanceof Error ? error.message : String(error));
    });
  });
}

clearCaseEntry?.addEventListener("click", clearEntryFormValues);

entryForm?.addEventListener("submit", (event) => {
  event.preventDefault();
  void (async () => {
    const submitButton = entryForm.querySelector<HTMLButtonElement>('button[type="submit"]');
    submitButton?.setAttribute("disabled", "true");
    showEntryOutput("Saving entry to PostgreSQL...");

    try {
      const entry = readCaseEntryData(entryForm);
      const whoVaData = createWhoVaDataFromCaseEntry(entry);
      const saved = await saveFormEntry({
        uid: entry.uid,
        caseEntry: entry,
        whoVaData,
        status: "case-entry"
      });

      rememberCaseEntry(entry, whoVaData);
      window.alert("Case data entry submitted successfully.");
      renderDeceasedDropdown();
      if (deceasedEntrySelect) deceasedEntrySelect.value = entry.uid;
      pickerStatusMessage = `Entry saved successfully for ${entry.deceasedFullName}.`;
      renderSelectedEntrySummary();
      currentCaseEntry = undefined;
      currentWhoVaData = undefined;
      setVisibleStep("picker");
      casePickerShell?.scrollIntoView({ block: "start" });
      showEntryOutput({ saved, caseEntry: entry, whoVaData });
    } catch (error) {
      showEntryOutput(error instanceof Error ? error.message : String(error));
    } finally {
      submitButton?.removeAttribute("disabled");
    }
  })();
});

chooseCaseEntry?.addEventListener("click", () => {
  renderDeceasedDropdown();
  setVisibleStep("picker");
  casePickerShell?.scrollIntoView({ block: "start" });
});

editCaseEntry?.addEventListener("click", () => {
  if (currentCaseEntry) fillCaseEntryForm(currentCaseEntry);
  setVisibleStep("entry");
  entryShell?.scrollIntoView({ block: "start" });
});

form?.addEventListener("who-va-complete", (event) => {
  void (async () => {
    if (!currentCaseEntry || !currentWhoVaData) return;
    const result = (event as CustomEvent).detail as {
      data: Record<string, unknown>;
      issues: unknown[];
    };
    showEntryOutput("Saving completed WHO VA form to PostgreSQL...");
    try {
      const saved = await saveFormEntry({
        uid: currentCaseEntry.uid,
        caseEntry: currentCaseEntry,
        whoVaData: currentWhoVaData,
        status: "completed",
        submission: result.data,
        validationIssues: result.issues
      });
      showEntryOutput({ saved, completed: true });
    } catch (error) {
      showEntryOutput(error instanceof Error ? error.message : String(error));
    }
  })();
});

setDefaultEntryValues();
renderDeceasedDropdown();
setVisibleStep("login");
