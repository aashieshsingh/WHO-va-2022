import {
  createInsecureWhoVaBrowserDefaults,
  defineWhoVaElement,
  type WhoVaFormElement
} from "../src/web-component.js";
import { WHO_VA_2022_LANGUAGES } from "../src/instrument-loader.js";
import { createWhoVaInitialDataFromPrefill } from "../src/prefill.js";

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
  form.draftStore = insecureDemoDefaults.draftStore;
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
let currentCaseEntry: CaseEntryData | undefined;
let currentWhoVaData: Record<string, unknown> | undefined;

const createEntryUid = () => {
  const randomPart = crypto.getRandomValues(new Uint32Array(1))[0].toString(36).padStart(7, "0");
  return `VA-${Date.now().toString(36).toUpperCase()}-${randomPart.toUpperCase()}`;
};

const setVisibleStep = (step: "picker" | "entry" | "instrument") => {
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

const renderSelectedEntrySummary = () => {
  const selected = selectedStoredCaseEntry();
  for (const button of startSelectedEntries) button.disabled = !selected;
  if (!selectedEntryOutput) return;

  if (!selected) {
    selectedEntryOutput.hidden = true;
    selectedEntryOutput.textContent = "";
    return;
  }

  const entry = selected.caseEntry;
  selectedEntryOutput.hidden = false;
  selectedEntryOutput.textContent = [
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
  if (!entryOutput) return;
  entryOutput.hidden = false;
  entryOutput.textContent = typeof value === "string" ? value : JSON.stringify(value, null, 2);
};

const applyCaseEntryToInstrument = (caseEntry: CaseEntryData, whoVaData: Record<string, unknown>) => {
  currentCaseEntry = caseEntry;
  currentWhoVaData = whoVaData;
  form?.setAttribute("draft-id", caseEntry.uid);
  form?.setData(whoVaData);
  setVisibleStep("instrument");
  whoVaShell?.scrollIntoView({ block: "start" });
};

const saveFormEntry = async (payload: SaveFormEntryPayload): Promise<SavedFormEntry> => {
  const response = await fetch("/api/form-entries", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  const responseText = await response.text();
  let body: { ok: boolean; saved?: SavedFormEntry; error?: string } | undefined;
  try {
    body = responseText ? (JSON.parse(responseText) as { ok: boolean; saved?: SavedFormEntry; error?: string }) : undefined;
  } catch {
    throw new Error(
      `The save API returned a non-JSON response. Open the DB-backed demo server, not the plain Vite server. Status: ${response.status}.`
    );
  }
  if (!response.ok || !body?.ok || !body.saved) {
    throw new Error(body?.error ?? "The entry could not be saved");
  }
  return body.saved;
};

deceasedEntrySelect?.addEventListener("change", renderSelectedEntrySummary);

newCaseEntry?.addEventListener("click", () => {
  clearEntryFormValues();
  setVisibleStep("entry");
  entryShell?.scrollIntoView({ block: "start" });
});

for (const button of startSelectedEntries) {
  button.addEventListener("click", () => {
    const selected = selectedStoredCaseEntry();
    if (!selected) return;
    fillCaseEntryForm(selected.caseEntry);
    applyCaseEntryToInstrument(selected.caseEntry, selected.whoVaData);
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
      renderDeceasedDropdown();
      if (deceasedEntrySelect) deceasedEntrySelect.value = entry.uid;
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
setVisibleStep("picker");
