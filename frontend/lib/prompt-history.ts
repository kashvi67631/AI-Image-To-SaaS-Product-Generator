const STORAGE_KEY = "luxegen-prompt-history";
const PROJECT_COUNT_KEY = "luxegen-total-projects";
const MAX_ITEMS = 40;

function parseStored(raw: string | null): string[] {
  if (!raw) {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((x): x is string => typeof x === "string" && x.trim().length > 0);
  } catch {
    return [];
  }
}

export function loadPromptHistory(): string[] {
  if (typeof window === "undefined") {
    return [];
  }
  try {
    return parseStored(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return [];
  }
}

/** Adds prompt to front; de-dupes; caps length. Returns the new list. */
export function appendPromptHistory(prompt: string): string[] {
  const trimmed = prompt.trim();
  if (!trimmed || typeof window === "undefined") {
    return loadPromptHistory();
  }
  const prev = loadPromptHistory().filter((p) => p !== trimmed);
  const next = [trimmed, ...prev].slice(0, MAX_ITEMS);
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* quota or private mode */
  }
  return next;
}

export function loadTotalProjectsCreated(): number {
  if (typeof window === "undefined") {
    return 0;
  }
  try {
    const raw = window.localStorage.getItem(PROJECT_COUNT_KEY);
    const n = raw ? Number.parseInt(raw, 10) : 0;
    return Number.isFinite(n) && n >= 0 ? n : 0;
  } catch {
    return 0;
  }
}

/** Increments each time the user starts a generation from the home flow. */
export function incrementTotalProjectsCreated(): number {
  if (typeof window === "undefined") {
    return loadTotalProjectsCreated();
  }
  const next = loadTotalProjectsCreated() + 1;
  try {
    window.localStorage.setItem(PROJECT_COUNT_KEY, String(next));
  } catch {
    /* quota or private mode */
  }
  return next;
}
