"use client";

import axios from "axios";
import confetti from "canvas-confetti";
import { AnimatePresence, motion } from "framer-motion";
import {
  CloudUpload,
  Code2,
  Download,
  Eye,
  Loader2,
  Menu,
  Sparkles,
  X,
} from "lucide-react";
import {
  ChangeEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { GeneratingState } from "@/components/GeneratingState";
import { AnimatedCopyButton } from "@/components/prompt/AnimatedCopyButton";
import { PromptHistorySidebar } from "@/components/prompt/PromptHistorySidebar";
import { StreamedCodeDisplay } from "@/components/prompt/StreamedCodeDisplay";
import { StreamingLivePreview } from "@/components/prompt/StreamingLivePreview";
import { ResponseMeta } from "@/components/ResponseMeta";
import { Toast } from "@/components/Toast";
import { downloadGeneratedTsx } from "@/lib/export/download-tsx";
import { detectStreamUnavailableInText } from "@/lib/live-preview";
import {
  PROMPT_HISTORY_MAX_ITEMS,
  PROMPT_HISTORY_STORAGE_KEY,
  loadPromptHistoryFromStorage,
  savePromptHistoryToStorage,
  type PromptHistoryEntry,
} from "@/lib/storage/prompt-history";
import { incrementTotalGenerations, readTotalGenerations } from "@/lib/storage/total-generations";
import { pickRandomSurpriseIdea } from "@/lib/prompt/surprise-ideas";
import { designStyles, type DesignStyle } from "@/lib/validation/generate-request";
import { ApiResponse } from "@/types/generation";

const API_URL = process.env.NEXT_PUBLIC_API_URL?.trim() || "";
const RETRY_DELAYS_MS = [2000, 4000, 8000] as const;
const HISTORY_STORAGE_KEY = "luxegen-recent-history";
const uploadClient = axios.create({
  timeout: 120000,
  headers: { Accept: "application/json" },
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithExponentialBackoff(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
    const response = await fetch(input, init);
    if (response.status !== 503) {
      return response;
    }
    if (attempt < RETRY_DELAYS_MS.length) {
      await sleep(RETRY_DELAYS_MS[attempt]);
    }
  }
  return fetch(input, init);
}

uploadClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (!axios.isAxiosError(error)) {
      return Promise.reject(error);
    }
    const status = error.response?.status;
    const cfg = error.config;
    if (status !== 503 || !cfg) {
      return Promise.reject(error);
    }

    const retries = Number((cfg as { __retryCount?: number }).__retryCount ?? 0);
    if (retries >= RETRY_DELAYS_MS.length) {
      return Promise.reject(error);
    }

    (cfg as { __retryCount?: number }).__retryCount = retries + 1;
    await sleep(RETRY_DELAYS_MS[retries]);
    return uploadClient.request(cfg);
  },
);

function fireSuccessConfetti() {
  confetti({
    particleCount: 120,
    spread: 75,
    startVelocity: 35,
    origin: { y: 0.7 },
    colors: ["#a78bfa", "#818cf8", "#f59e0b", "#34d399"],
  });
}

function formatDesignStyleLabel(style: DesignStyle): string {
  return style
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function createClientId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 10)}`;
}

function isUnavailableResponse(status: number, bodyText: string): boolean {
  if (status === 503) {
    return true;
  }
  const t = bodyText.toUpperCase();
  return (
    t.includes("UNAVAILABLE") ||
    t.includes("HIGH DEMAND") ||
    t.includes('"STATUS":"UNAVAILABLE"') ||
    t.includes("SERVICE UNAVAILABLE") ||
    /(?:STATUS\s*(?:CODE)?|CODE)\s*:?\s*503\b/i.test(bodyText)
  );
}

/** Covers thrown errors that carry HTTP status (e.g. some clients use `response.status`). */
function getThrownErrorHttpStatus(err: unknown): number | undefined {
  if (!err || typeof err !== "object") {
    return undefined;
  }
  const e = err as Record<string, unknown>;
  if (typeof e.status === "number" && Number.isFinite(e.status)) {
    return e.status;
  }
  const res = e.response;
  if (res && typeof res === "object") {
    const s = (res as { status?: unknown }).status;
    if (typeof s === "number" && Number.isFinite(s)) {
      return s;
    }
  }
  return undefined;
}

export function DesignerWorkspace() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string>("");
  const [response, setResponse] = useState<ApiResponse | null>(null);
  const [fileName, setFileName] = useState<string>("");
  const [showCopiedToast, setShowCopiedToast] = useState(false);
  const [showErrorToast, setShowErrorToast] = useState(false);
  const [errorToastMessage, setErrorToastMessage] = useState("");
  const [history, setHistory] = useState<
    { id: string; componentName: string; createdAt: string; response: ApiResponse }[]
  >([]);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);

  const [promptDraft, setPromptDraft] = useState("");
  const [refinementDraft, setRefinementDraft] = useState("");
  const [designStyle, setDesignStyle] = useState<DesignStyle>("luxury-minimal");
  const [generateLoading, setGenerateLoading] = useState(false);
  const [streamedPromptCode, setStreamedPromptCode] = useState("");
  const [promptError, setPromptError] = useState("");
  const [showDeployToast, setShowDeployToast] = useState(false);
  const [promptHistory, setPromptHistory] = useState<PromptHistoryEntry[]>([]);
  const [activePromptHistoryId, setActivePromptHistoryId] = useState<string | null>(null);
  const [promptHistoryOpen, setPromptHistoryOpen] = useState(false);
  const skipInitialPromptHistorySave = useRef(true);
  const [totalGenerations, setTotalGenerations] = useState(0);
  const [serverBusy, setServerBusy] = useState(false);
  const [forceRenderPreview, setForceRenderPreview] = useState(false);
  const [showCapacityToast, setShowCapacityToast] = useState(false);
  const [workspaceView, setWorkspaceView] = useState<"split" | "preview" | "code">("split");
  const lastGenerateArgsRef = useRef<{
    prompt: string;
    previousCode?: string;
  } | null>(null);
  const capacityRetryCountRef = useRef(0);
  const capacityRetryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const raw = localStorage.getItem(HISTORY_STORAGE_KEY);
    if (!raw) {
      return;
    }
    try {
      const parsed = JSON.parse(raw) as {
        id: string;
        componentName: string;
        createdAt: string;
        response: ApiResponse;
      }[];
      setHistory(parsed);
    } catch {
      localStorage.removeItem(HISTORY_STORAGE_KEY);
    }
  }, []);

  useEffect(() => {
    localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(history));
  }, [history]);

  useEffect(() => {
    setPromptHistory(loadPromptHistoryFromStorage());
  }, []);

  useEffect(() => {
    if (skipInitialPromptHistorySave.current) {
      skipInitialPromptHistorySave.current = false;
      return;
    }
    savePromptHistoryToStorage(promptHistory);
  }, [promptHistory]);

  useEffect(() => {
    console.log("[upload] API_URL in use:", API_URL);
  }, []);

  useEffect(() => {
    setTotalGenerations(readTotalGenerations());
  }, []);

  useEffect(() => {
    return () => {
      if (capacityRetryTimeoutRef.current) {
        clearTimeout(capacityRetryTimeoutRef.current);
        capacityRetryTimeoutRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    function onGlobalUploadShortcut(event: KeyboardEvent) {
      const isUploadShortcut =
        event.key.toLowerCase() === "u" && (event.metaKey || event.ctrlKey);
      if (!isUploadShortcut) {
        return;
      }
      event.preventDefault();
      if (isLoading) {
        console.log("[upload] shortcut ignored: generation in progress");
        return;
      }
      uploadInputRef.current?.click();
    }

    window.addEventListener("keydown", onGlobalUploadShortcut);
    return () => window.removeEventListener("keydown", onGlobalUploadShortcut);
  }, [isLoading]);

  async function executePromptGenerate(
    options?: { prompt?: string; previousCode?: string },
    flags?: { isAutoRetry?: boolean },
  ): Promise<void> {
    const isAutoRetry = flags?.isAutoRetry ?? false;

    if (!isAutoRetry) {
      if (generateLoading) {
        return;
      }
      if (capacityRetryTimeoutRef.current) {
        clearTimeout(capacityRetryTimeoutRef.current);
        capacityRetryTimeoutRef.current = null;
      }
      capacityRetryCountRef.current = 0;
      setPromptError("");
      setServerBusy(false);
      setStreamedPromptCode("");
    }

    setGenerateLoading(true);
    let streamReader: ReadableStreamDefaultReader<Uint8Array> | null = null;

    try {
      const effectivePrompt =
        (isAutoRetry && lastGenerateArgsRef.current
          ? lastGenerateArgsRef.current.prompt
          : options?.prompt) ?? promptDraft.trim();
      const previousCode =
        isAutoRetry && lastGenerateArgsRef.current
          ? lastGenerateArgsRef.current.previousCode
          : options?.previousCode;

      lastGenerateArgsRef.current = {
        prompt: effectivePrompt,
        previousCode,
      };

      const res = await fetchWithExponentialBackoff("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: effectivePrompt,
          designStyle,
          previousCode,
        }),
      });

      if (!res.ok) {
        const errorBodyText = await res.text();
        if (res.status === 503 || isUnavailableResponse(res.status, errorBodyText)) {
          setStreamedPromptCode("");
          setServerBusy(true);
          setPromptError(
            "Gemini API is busy after retries (2s, 4s, 8s). Please try again shortly.",
          );
          return;
        }
        let message = `Request failed (${res.status})`;
        try {
          const data = JSON.parse(errorBodyText) as { error?: string };
          if (data.error) {
            message = data.error;
          }
        } catch {
          if (errorBodyText.trim()) {
            message = errorBodyText.slice(0, 500);
          }
        }
        throw new Error(message);
      }

      const reader = res.body?.getReader();
      if (!reader) {
        throw new Error("No response stream");
      }
      streamReader = reader;

      const decoder = new TextDecoder();
      let accumulated = "";
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }
          accumulated += decoder.decode(value, { stream: true });
          if (detectStreamUnavailableInText(accumulated)) {
            try {
              await reader.cancel();
            } catch {
              /* ignore cancel errors */
            }
            streamReader = null;
            setStreamedPromptCode("");
            setServerBusy(true);
            setPromptError(
              "Gemini API is busy after retries (2s, 4s, 8s). Please try again shortly.",
            );
            return;
          }
          setStreamedPromptCode(accumulated);
        }
      } finally {
        if (streamReader) {
          try {
            streamReader.releaseLock();
          } catch {
            /* already released or cancelled */
          }
          streamReader = null;
        }
      }

      if (accumulated.trim() && detectStreamUnavailableInText(accumulated)) {
        setStreamedPromptCode("");
        setServerBusy(true);
        setPromptError("Gemini API is busy after retries (2s, 4s, 8s). Please try again shortly.");
        return;
      }

      capacityRetryCountRef.current = 0;

      const trimmed = accumulated.trim();
      if (trimmed) {
        console.log("[generate] raw streamed text from API:", trimmed);
      }
      if (trimmed) {
        const id = createClientId();
        const createdAt = new Date().toLocaleString();
        const entry: PromptHistoryEntry = {
          id,
          prompt: effectivePrompt,
          designStyle,
          code: trimmed,
          createdAt,
        };
        setPromptHistory((current) =>
          [entry, ...current].slice(0, PROMPT_HISTORY_MAX_ITEMS),
        );
        setActivePromptHistoryId(id);
        setTotalGenerations(incrementTotalGenerations());
        fireSuccessConfetti();
      }
    } catch (err) {
      console.error("[generate] failed", err);
      const msg = err instanceof Error ? err.message : "Generation failed";
      const thrownStatus = getThrownErrorHttpStatus(err);
      if (
        thrownStatus === 503 ||
        isUnavailableResponse(thrownStatus ?? 0, msg)
      ) {
        setStreamedPromptCode("");
        setServerBusy(true);
        setPromptError("Gemini API is busy after retries (2s, 4s, 8s). Please try again shortly.");
      } else {
        setPromptError(msg);
      }
    } finally {
      setGenerateLoading(false);
    }
  }

  async function handlePromptGenerate(
    options?: { prompt?: string; previousCode?: string },
  ): Promise<void> {
    await executePromptGenerate(options, { isAutoRetry: false });
  }

  function handleServerBusyRetry(): void {
    if (capacityRetryTimeoutRef.current) {
      clearTimeout(capacityRetryTimeoutRef.current);
      capacityRetryTimeoutRef.current = null;
    }
    capacityRetryCountRef.current = 0;
    setShowCapacityToast(false);
    setServerBusy(false);
    const args = lastGenerateArgsRef.current;
    if (!args) {
      void handlePromptGenerate();
      return;
    }
    void handlePromptGenerate({
      prompt: args.prompt,
      previousCode: args.previousCode,
    });
  }

  async function handleRefinementGenerate(): Promise<void> {
    if (!streamedPromptCode.trim() || !refinementDraft.trim() || generateLoading) {
      return;
    }
    await handlePromptGenerate({
      prompt: refinementDraft.trim(),
      previousCode: streamedPromptCode,
    });
    setRefinementDraft("");
  }

  async function uploadImage(file: File): Promise<void> {
    if (isLoading) {
      console.log("[upload] uploadImage skipped: already loading");
      return;
    }
    if (!API_URL) {
      const missingEnvMessage =
        "Image upload API is not configured. Set NEXT_PUBLIC_API_URL in your environment (Vercel Project Settings -> Environment Variables).";
      setError(missingEnvMessage);
      setErrorToastMessage(missingEnvMessage);
      setShowErrorToast(true);
      setTimeout(() => setShowErrorToast(false), 2200);
      return;
    }
    console.log("[upload] starting upload", {
      fileName: file.name,
      size: file.size,
      type: file.type,
      url: API_URL,
    });
    setError("");
    setResponse(null);
    setFileName(file.name);
    setIsLoading(true);

    const formData = new FormData();
    formData.append("image", file);

    try {
      const result = await uploadClient.post<ApiResponse>(API_URL, formData);
      console.log("[upload] success", { status: result.status });
      setResponse(result.data);
      const id = createClientId();
      const createdAt = new Date().toLocaleString();
      setHistory((current) =>
        [
          { id, componentName: result.data.componentName, createdAt, response: result.data },
          ...current,
        ].slice(0, 5),
      );
      setTotalGenerations(incrementTotalGenerations());
      fireSuccessConfetti();
    } catch (err) {
      console.error("[upload] failed", err);
      if (axios.isAxiosError(err)) {
        const backendError = (err.response?.data as { error?: string } | undefined)?.error;
        const msg =
          backendError ??
          (err.code === "ERR_NETWORK"
            ? `Network error while calling ${API_URL}. Check backend server, CORS ALLOWED_ORIGINS, and that it is listening on port 3000.`
            : err.message);
        console.log("[upload] axios error detail", {
          message: err.message,
          code: err.code,
          status: err.response?.status,
          data: err.response?.data,
        });
        setError(msg);
        setErrorToastMessage(msg);
      } else {
        const fallback = "Unexpected error occurred while generating code.";
        setError(fallback);
        setErrorToastMessage(fallback);
      }
      setShowErrorToast(true);
      setTimeout(() => setShowErrorToast(false), 2200);
    } finally {
      setIsLoading(false);
      console.log("[upload] finished (loading cleared)");
    }
  }

  async function handleInputChange(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0];
    console.log("[upload] handleInputChange", { hasFile: Boolean(file) });
    if (!file) {
      return;
    }
    await uploadImage(file);
    event.target.value = "";
  }

  function handleCopySuccess() {
    setShowCopiedToast(true);
    setTimeout(() => setShowCopiedToast(false), 1600);
  }

  function handleExportStreamedTsx() {
    if (!streamedPromptCode.trim()) {
      return;
    }
    downloadGeneratedTsx(streamedPromptCode);
  }

  function handleMockDeployToVercel() {
    setShowDeployToast(true);
    setTimeout(() => setShowDeployToast(false), 2600);
  }

  function handlePromptHistorySelect(id: string) {
    const selected = promptHistory.find((item) => item.id === id);
    if (!selected) {
      return;
    }
    setActivePromptHistoryId(id);
    setStreamedPromptCode(selected.code);
    setPromptDraft(selected.prompt);
    setDesignStyle(selected.designStyle);
    setPromptError("");
  }

  function handleClearPromptHistory() {
    setPromptHistory([]);
    setActivePromptHistoryId(null);
    localStorage.removeItem(PROMPT_HISTORY_STORAGE_KEY);
  }

  return (
    <div className="luxury-grid min-h-screen bg-zinc-100 pb-44 text-zinc-900 dark:bg-[#050505] dark:text-zinc-100">
      <header className="sticky top-0 z-40 border-b border-white/10 bg-white/75 backdrop-blur-xl dark:bg-[#0a0a0c]/80">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-4 md:px-8">
          <div className="flex items-center gap-2">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-zinc-900 text-xs font-bold text-white dark:bg-violet-400 dark:text-zinc-900">
              L
            </span>
            <p className="text-base font-semibold tracking-tight md:text-lg">LuxeGen</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 rounded-full border border-emerald-300/40 bg-emerald-100/70 px-3 py-1.5 text-xs font-medium text-emerald-900 dark:border-emerald-400/30 dark:bg-emerald-500/10 dark:text-emerald-200">
              <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" aria-hidden />
              Gemini 1.5
            </div>
            <button
              type="button"
              onClick={() => setPromptHistoryOpen((current) => !current)}
              className="glass-btn inline-flex h-9 w-9 items-center justify-center rounded-lg text-zinc-700 transition hover:bg-zinc-100/80 dark:text-zinc-200 dark:hover:bg-white/10"
              title="Toggle prompt history"
            >
              {promptHistoryOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
            </button>
          </div>
        </div>
      </header>

      <AnimatePresence>
        {promptHistoryOpen ? (
          <motion.aside
            initial={{ opacity: 0, x: 24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 24 }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
            className="fixed top-16 right-4 z-50 w-[22rem] rounded-2xl border border-white/10 bg-white/80 p-2 shadow-[0_16px_40px_rgba(0,0,0,0.18)] backdrop-blur-xl dark:bg-[#0f0f13]/85"
          >
            <PromptHistorySidebar
              items={promptHistory}
              activeId={activePromptHistoryId}
              onSelect={handlePromptHistorySelect}
              onClear={handleClearPromptHistory}
              formatStyleLabel={formatDesignStyleLabel}
            />
          </motion.aside>
        ) : null}
      </AnimatePresence>

      <div className="mx-auto max-w-[1500px] px-4 py-8 md:px-8">
        <section className="mb-6 text-center">
          <h1 className="mx-auto max-w-4xl text-3xl font-semibold tracking-tight text-zinc-900 md:text-5xl dark:text-zinc-100">
            Luxury Design Workspace
          </h1>
          <p className="mx-auto mt-2 max-w-2xl text-sm text-zinc-600 dark:text-zinc-400">
            Dark glassmorphism dashboard with live streaming preview and code intelligence.
          </p>
          <div className="mx-auto mt-4 inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/60 px-4 py-2 text-xs font-medium text-zinc-700 backdrop-blur-xl dark:bg-white/[0.05] dark:text-zinc-200">
            Total Generations: {totalGenerations}
            <span className="text-zinc-400">|</span>
            Active Projects: {Math.max(1, history.length)}
          </div>
        </section>

        <div className="grid grid-cols-1 gap-5 xl:grid-cols-[340px_minmax(0,1fr)]">
          <aside className="rounded-3xl border border-white/20 bg-white/65 p-5 shadow-[0_18px_48px_rgba(20,20,20,0.16)] backdrop-blur-2xl dark:border-violet-300/20 dark:bg-[#0f0f14]/70">
            <h2 className="mb-4 text-xs font-semibold tracking-[0.18em] text-zinc-500 uppercase dark:text-zinc-400">
              Control Sidebar
            </h2>

            <label className="mb-3 block text-[11px] font-semibold tracking-wide text-zinc-500 uppercase dark:text-zinc-400">
              Design Prompt
            </label>
            <textarea
              id="prompt-draft"
              value={promptDraft}
              onChange={(e) => setPromptDraft(e.target.value)}
              rows={5}
              placeholder="Describe the UI you want..."
              className="glass-input w-full rounded-2xl px-4 py-3 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-amber-400/60 focus:outline-none focus:ring-1 focus:ring-amber-300/40 dark:text-zinc-100 dark:placeholder:text-zinc-500"
            />

            <div className="mt-4 grid grid-cols-1 gap-3">
              <select
                id="design-style"
                value={designStyle}
                onChange={(e) => setDesignStyle(e.target.value as DesignStyle)}
                className="glass-input h-11 rounded-xl px-4 text-sm text-zinc-900 focus:border-amber-400/60 focus:outline-none dark:text-zinc-200"
              >
                {designStyles.map((style) => (
                  <option key={style} value={style}>
                    {formatDesignStyleLabel(style)}
                  </option>
                ))}
              </select>

              <div className="flex items-center gap-2">
                <motion.button
                  type="button"
                  onClick={() => setPromptDraft(pickRandomSurpriseIdea(promptDraft))}
                  disabled={generateLoading}
                  className="glass-btn inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-xl px-3 text-sm font-medium text-violet-900 transition hover:bg-violet-100/70 disabled:cursor-not-allowed disabled:opacity-50 dark:text-violet-100 dark:hover:bg-violet-500/15"
                  whileHover={{ scale: generateLoading ? 1 : 1.02 }}
                  whileTap={{ scale: generateLoading ? 1 : 0.98 }}
                >
                  <Sparkles className="h-4 w-4" aria-hidden />
                  Surprise
                </motion.button>
                <button
                  type="button"
                  onClick={() => uploadInputRef.current?.click()}
                  disabled={isLoading}
                  className="glass-btn inline-flex h-10 w-10 items-center justify-center rounded-xl text-zinc-700 transition hover:bg-zinc-100/80 disabled:cursor-not-allowed disabled:opacity-50 dark:text-zinc-200 dark:hover:bg-white/10"
                  title="Upload image"
                >
                  <CloudUpload className="h-4 w-4" aria-hidden />
                </button>
              </div>

              <motion.button
                type="button"
                onClick={() => void handlePromptGenerate()}
                disabled={generateLoading || !promptDraft.trim()}
                className="glass-btn inline-flex h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold text-amber-950 transition hover:bg-amber-100/70 disabled:cursor-not-allowed disabled:opacity-50 dark:text-amber-100 dark:hover:bg-amber-200/15"
                whileHover={{ scale: generateLoading ? 1 : 1.02 }}
                whileTap={{ scale: generateLoading ? 1 : 0.98 }}
              >
                {generateLoading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
                {generateLoading ? "Generating..." : "Generate"}
              </motion.button>
            </div>

            {streamedPromptCode.trim() ? (
              <div className="mt-5 rounded-2xl border border-white/15 bg-white/50 p-3 dark:bg-white/[0.04]">
                <label
                  htmlFor="refinement-draft"
                  className="mb-2 block text-[11px] font-semibold tracking-wide text-zinc-500 uppercase dark:text-zinc-400"
                >
                  Refine UI
                </label>
                <input
                  id="refinement-draft"
                  type="text"
                  value={refinementDraft}
                  onChange={(e) => setRefinementDraft(e.target.value)}
                  placeholder="Primary button blue kar do"
                  className="glass-input h-10 w-full rounded-xl px-3 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-amber-400/60 focus:outline-none dark:text-zinc-100"
                />
                <motion.button
                  type="button"
                  onClick={() => void handleRefinementGenerate()}
                  disabled={generateLoading || !refinementDraft.trim()}
                  className="glass-btn mt-2 inline-flex h-9 w-full items-center justify-center rounded-xl px-3 text-sm font-medium text-violet-900 transition hover:bg-violet-100/70 disabled:cursor-not-allowed disabled:opacity-50 dark:text-violet-100 dark:hover:bg-violet-500/15"
                  whileHover={{ scale: generateLoading ? 1 : 1.01 }}
                  whileTap={{ scale: generateLoading ? 1 : 0.99 }}
                >
                  {generateLoading ? "Refining..." : "Apply changes"}
                </motion.button>
              </div>
            ) : null}
          </aside>

          <section className="rounded-3xl border border-white/15 bg-white/60 p-4 shadow-[0_18px_48px_rgba(20,20,20,0.14)] backdrop-blur-2xl dark:border-violet-300/20 dark:bg-[#0f0f14]/70 md:p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold tracking-wider text-zinc-700 uppercase dark:text-zinc-300">
                  Workspace Canvas
                </h3>
                <label className="flex cursor-pointer items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400">
                  <input
                    type="checkbox"
                    checked={forceRenderPreview}
                    onChange={(e) => setForceRenderPreview(e.target.checked)}
                    className="rounded border-zinc-300 text-violet-600 focus:ring-violet-500"
                  />
                  Force render
                </label>
              </div>
              <div className="inline-flex items-center gap-1 rounded-xl border border-white/20 bg-white/70 p-1 dark:bg-white/[0.08]">
                <button
                  type="button"
                  onClick={() => setWorkspaceView("preview")}
                  className={`inline-flex h-8 items-center gap-1 rounded-lg px-3 text-xs font-medium ${workspaceView === "preview" ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" : "text-zinc-700 dark:text-zinc-200"}`}
                >
                  <Eye className="h-3.5 w-3.5" />
                  Preview
                </button>
                <button
                  type="button"
                  onClick={() => setWorkspaceView("split")}
                  className={`inline-flex h-8 items-center gap-1 rounded-lg px-3 text-xs font-medium ${workspaceView === "split" ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" : "text-zinc-700 dark:text-zinc-200"}`}
                >
                  Split
                </button>
                <button
                  type="button"
                  onClick={() => setWorkspaceView("code")}
                  className={`inline-flex h-8 items-center gap-1 rounded-lg px-3 text-xs font-medium ${workspaceView === "code" ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" : "text-zinc-700 dark:text-zinc-200"}`}
                >
                  <Code2 className="h-3.5 w-3.5" />
                  Code
                </button>
              </div>
            </div>

            <div
              className={`grid gap-4 ${
                workspaceView === "split"
                  ? "lg:grid-cols-[minmax(0,7fr)_minmax(0,3fr)]"
                  : "grid-cols-1"
              }`}
            >
              {workspaceView !== "code" ? (
                <div className="overflow-hidden rounded-2xl border border-white/20 bg-white/50 p-2 dark:bg-white/[0.03]">
                  <StreamingLivePreview
                    rawCode={streamedPromptCode}
                    serverBusy={serverBusy}
                    onServerBusyRetry={handleServerBusyRetry}
                    forceRender={forceRenderPreview}
                  />
                </div>
              ) : null}

              {workspaceView !== "preview" ? (
                <div className="rounded-2xl border border-white/20 bg-white/55 p-3 dark:bg-white/[0.04]">
                  <div className="mb-3 flex items-center justify-between">
                    <p className="text-xs font-semibold tracking-wider text-zinc-500 uppercase dark:text-zinc-400">
                      Streamed Code
                    </p>
                    <div className="flex items-center gap-2">
                      <AnimatedCopyButton
                        disabled={!streamedPromptCode.trim()}
                        onCopy={async () => {
                          if (!streamedPromptCode.trim()) {
                            throw new Error("empty");
                          }
                          try {
                            await navigator.clipboard.writeText(streamedPromptCode);
                            handleCopySuccess();
                          } catch {
                            setErrorToastMessage("Could not copy to clipboard");
                            setShowErrorToast(true);
                            setTimeout(() => setShowErrorToast(false), 2200);
                            throw new Error("copy failed");
                          }
                        }}
                        className="glass-btn inline-flex min-h-8 items-center gap-2 rounded-lg px-3 py-1.5 text-[11px] font-medium text-zinc-800 transition hover:bg-zinc-50/70 disabled:cursor-not-allowed disabled:opacity-50 dark:text-zinc-200 dark:hover:bg-white/10"
                      />
                      <button
                        type="button"
                        onClick={handleExportStreamedTsx}
                        className="glass-btn inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-[11px] font-medium text-zinc-800 transition hover:bg-amber-50/70 dark:text-zinc-200 dark:hover:bg-amber-200/10"
                      >
                        <Download className="h-3.5 w-3.5" aria-hidden />
                        .tsx
                      </button>
                      <button
                        type="button"
                        onClick={handleMockDeployToVercel}
                        className="glass-btn inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-[11px] font-medium text-zinc-800 transition hover:bg-violet-50/70 dark:text-zinc-200 dark:hover:bg-violet-500/10"
                      >
                        <CloudUpload className="h-3.5 w-3.5" aria-hidden />
                        Deploy
                      </button>
                    </div>
                  </div>
                  <StreamedCodeDisplay code={streamedPromptCode} />
                </div>
              ) : null}
            </div>

            {promptError ? (
              <p className="mt-4 text-sm text-rose-600 dark:text-rose-300">{promptError}</p>
            ) : null}
            {error ? (
              <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-rose-800 dark:border-rose-300/30 dark:bg-rose-950/20 dark:text-rose-200">
                {error}
              </div>
            ) : null}
            {response ? <ResponseMeta response={response} /> : null}
            {isLoading ? <GeneratingState /> : null}
          </section>
        </div>
      </div>

      <input
        ref={uploadInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(event) => void handleInputChange(event)}
      />
      {fileName ? (
        <div className="fixed right-4 bottom-4 z-40 rounded-xl border border-white/20 bg-white/80 px-3 py-2 text-xs text-zinc-700 shadow-lg backdrop-blur-xl dark:bg-[#121217]/85 dark:text-zinc-200">
          Uploaded: {fileName}
        </div>
      ) : null}
      <Toast message="Copied!" show={showCopiedToast} />
      <Toast
        message="Deploy queued — your preview project would go live on Vercel (demo)."
        show={showDeployToast}
      />
      <Toast message={errorToastMessage} show={showErrorToast} variant="error" />
      <Toast
        message="Servers are at capacity, retrying..."
        show={showCapacityToast}
        variant="info"
      />
    </div>
  );
}
