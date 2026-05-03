"use client";

import axios from "axios";
import confetti from "canvas-confetti";
import { AnimatePresence, motion, useAnimationControls } from "framer-motion";
import {
  Check,
  CloudUpload,
  Code2,
  Download,
  Eye,
  History,
  Info,
  Loader2,
  Menu,
  Palette,
  Play,
  Plus,
  RefreshCw,
  Settings,
  Sparkles,
  X,
} from "lucide-react";
import {
  ChangeEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { flushSync } from "react-dom";
import { GeneratingState } from "@/components/GeneratingState";
import { AnimatedCopyButton } from "@/components/prompt/AnimatedCopyButton";
import { PromptHistorySidebar } from "@/components/prompt/PromptHistorySidebar";
import { StreamedCodeDisplay } from "@/components/prompt/StreamedCodeDisplay";
import { StreamingLivePreview } from "@/components/prompt/StreamingLivePreview";
import { ResponseMeta } from "@/components/ResponseMeta";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Toast } from "@/components/Toast";
import { luxeSerif } from "@/lib/fonts/luxe-serif";
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
import { IMAGE_UPLOAD_PATH, postImageToReact } from "@/lib/image-to-react-client";
import { ApiResponse } from "@/types/generation";

const LUXE_CRAFTING_MESSAGE = "LuxeGen is crafting your UI…";
type BackendHealthState = "checking" | "ready" | "offline" | "no_gemini";
const BACKOFF_BASE_DELAY_MS = 1000;
const MAX_503_RETRIES = 3;
const HISTORY_STORAGE_KEY = "luxegen-recent-history";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getBackoffDelayMs(retryCount: number): number {
  const exponentialDelay = 2 ** retryCount * BACKOFF_BASE_DELAY_MS;
  const jitterRange = exponentialDelay * 0.2;
  const randomJitter = (Math.random() * 2 - 1) * jitterRange;
  return Math.max(0, Math.round(exponentialDelay + randomJitter));
}

async function fetchWithExponentialBackoff(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  for (let attempt = 0; attempt <= MAX_503_RETRIES; attempt += 1) {
    const response = await fetch(input, init);
    if (response.status !== 503 && response.status !== 429) {
      return response;
    }
    if (attempt < MAX_503_RETRIES) {
      await sleep(getBackoffDelayMs(attempt));
    }
  }
  return fetch(input, init);
}

/** Browser fetch errors (no HTTP response) — log Network vs Timeout distinctly for debugging. */
function logClientGenerateFetchFailure(err: unknown, context: string): void {
  if (!(err instanceof Error)) {
    console.error(`[generate] ${context}`, err);
    return;
  }
  const combined = `${err.name} ${err.message}`.toLowerCase();
  const isNetwork =
    combined.includes("failed to fetch") ||
    combined.includes("networkerror") ||
    combined.includes("network error") ||
    combined.includes("load failed") ||
    combined.includes("econnrefused") ||
    combined.includes("connection refused");
  const isTimeout =
    combined.includes("timeout") ||
    combined.includes("timed out") ||
    err.name === "AbortError" ||
    combined.includes("aborted");
  if (isNetwork) {
    console.error(
      `[generate] Network error (${context}): request did not complete — verify Next (3000), BACKEND_URL / Express (8080), and IPv4 (127.0.0.1).`,
      err,
    );
    return;
  }
  if (isTimeout) {
    console.error(`[generate] Timeout or abort (${context})`, err);
    return;
  }
  console.error(`[generate] Fetch error (${context})`, err);
}

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

export type DesignerWorkspaceProps = {
  /** When set (e.g. from `/generate?prompt=`), fills the prompt and runs generation once per dedupe key. */
  autoRunPrompt?: string;
  /** Dedupe bootstrap: full URL when omitted; incrementing key when embedding from the home hero. */
  autoRunKey?: string | number;
  /** Transparent shell so the home page mesh gradient stays visible behind the workspace. */
  overlayOnHeroGradient?: boolean;
  /** Hero prompt morphs into this fixed bottom bar (shared `layoutId`). */
  useFloatingPromptBar?: boolean;
  /** Must match landing hero `layoutId` for Framer shared layout transition. */
  heroToWorkspaceLayoutId?: string;
  /** Fade/zoom workspace canvas on first entry from the dashboard hero. */
  animateCanvasEntrance?: boolean;
  /** Landing hero image upload — hydrates preview from `sourceCode` once per hydrate key. */
  initialImageResult?: ApiResponse;
  initialImageHydrateKey?: string | number;
};

export function DesignerWorkspace({
  autoRunPrompt,
  autoRunKey,
  overlayOnHeroGradient = false,
  useFloatingPromptBar = false,
  heroToWorkspaceLayoutId,
  animateCanvasEntrance = false,
  initialImageResult,
  initialImageHydrateKey,
}: DesignerWorkspaceProps = {}) {
  const isLuxeWorkingPage = useFloatingPromptBar && overlayOnHeroGradient;
  const [backendHealth, setBackendHealth] = useState<BackendHealthState>(
    isLuxeWorkingPage ? "checking" : "ready",
  );
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
  /** ChatGPT-style left rail when using the floating prompt bar (history only). */
  const [historyMenuOpen, setHistoryMenuOpen] = useState(false);
  const [settingsDrawerOpen, setSettingsDrawerOpen] = useState(false);
  const skipInitialPromptHistorySave = useRef(true);
  const [totalGenerations, setTotalGenerations] = useState(0);
  const [serverBusy, setServerBusy] = useState(false);
  const [forceRenderPreview, setForceRenderPreview] = useState(false);
  const [showCapacityToast, setShowCapacityToast] = useState(false);
  const [workspaceView, setWorkspaceView] = useState<"split" | "preview" | "code">("split");
  const [workspaceVisualEpoch, setWorkspaceVisualEpoch] = useState(0);
  /** Shown after a successful stream completes (luxe workspace); auto-dismisses. */
  const [showGenerationCompleteBadge, setShowGenerationCompleteBadge] =
    useState(false);
  const barPulseControls = useAnimationControls();
  const generateBlockedByBackend =
    isLuxeWorkingPage && backendHealth === "offline";
  const lastGenerateArgsRef = useRef<{
    prompt: string;
    previousCode?: string;
  } | null>(null);
  const capacityRetryCountRef = useRef(0);
  const capacityRetryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const appliedImageHydrateKeyRef = useRef<string | number | undefined>(undefined);

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

  const checkBackendHealth = useCallback(async () => {
    if (!isLuxeWorkingPage) {
      setBackendHealth("ready");
      return;
    }
    setBackendHealth("checking");
    try {
      const res = await fetch("/api/health", { cache: "no-store" });
      const data = (await res.json()) as {
        ok?: boolean;
        model?: string;
        proxyBase?: string;
        error?: string;
        message?: string;
      };
      if (res.ok && data.ok !== false) {
        if (process.env.NODE_ENV === "development") {
          const baseLabel = data.proxyBase ?? "BACKEND_URL";
          console.info(
            `[Luxegen] Health: OK — proxy → ${baseLabel} (model: ${String(data.model ?? "unknown")})`,
          );
        }
        setBackendHealth("ready");
        return;
      }
      if (res.status === 503) {
        setBackendHealth("no_gemini");
        return;
      }
      setBackendHealth("offline");
    } catch {
      setBackendHealth("offline");
    }
  }, [isLuxeWorkingPage]);

  const testConnectionToApi = useCallback(async () => {
    try {
      const res = await fetch("/api/health", { cache: "no-store" });
      const text = await res.text();
      let bodyPreview = text;
      if (bodyPreview.length > 500) {
        bodyPreview = `${bodyPreview.slice(0, 500)}…`;
      }
      window.alert(
        `GET /api/health\nHTTP ${res.status} ${res.statusText}\n\nBody (truncated):\n${bodyPreview}`,
      );
      void checkBackendHealth();
    } catch (e) {
      window.alert(
        `GET /api/health — network error (no HTTP status):\n${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }, [checkBackendHealth]);

  useEffect(() => {
    void checkBackendHealth();
  }, [checkBackendHealth]);

  useEffect(() => {
    if (skipInitialPromptHistorySave.current) {
      skipInitialPromptHistorySave.current = false;
      return;
    }
    savePromptHistoryToStorage(promptHistory);
  }, [promptHistory]);

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
    if (!showGenerationCompleteBadge) {
      return;
    }
    const t = window.setTimeout(() => setShowGenerationCompleteBadge(false), 5200);
    return () => window.clearTimeout(t);
  }, [showGenerationCompleteBadge]);

  useEffect(() => {
    if (initialImageResult === undefined || initialImageHydrateKey === undefined) {
      return;
    }
    if (appliedImageHydrateKeyRef.current === initialImageHydrateKey) {
      return;
    }
    appliedImageHydrateKeyRef.current = initialImageHydrateKey;
    setResponse(initialImageResult);
    setStreamedPromptCode(initialImageResult.sourceCode ?? "");
    setPromptError("");
    setError("");
    const id = createClientId();
    const createdAt = new Date().toLocaleString();
    setHistory((current) =>
      [
        {
          id,
          componentName: initialImageResult.componentName,
          createdAt,
          response: initialImageResult,
        },
        ...current,
      ].slice(0, 5),
    );
    setTotalGenerations(incrementTotalGenerations());
    fireSuccessConfetti();
  }, [initialImageResult, initialImageHydrateKey]);

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
      setShowGenerationCompleteBadge(false);
    }

    setGenerateLoading(true);
    if (!isAutoRetry) {
      setWorkspaceVisualEpoch((e) => e + 1);
    }
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

      /**
       * Connectivity: browser → same-origin POST `/api/generate` (Next.js Route Handler)
       * → server-side fetch to `${BACKEND_URL}/api/generate` (Express on :8080)
       * → Gemini stream (`text/plain`). Key stays on Express only.
       */
      let res: Response;
      try {
        res = await fetchWithExponentialBackoff("/api/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          cache: "no-store",
          body: JSON.stringify({
            prompt: effectivePrompt,
            designStyle,
            previousCode,
          }),
        });
      } catch (fetchErr) {
        logClientGenerateFetchFailure(fetchErr, "POST /api/generate");
        throw fetchErr;
      }

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
          flushSync(() => {
            setStreamedPromptCode(accumulated);
          });
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
        if (isLuxeWorkingPage) {
          setShowGenerationCompleteBadge(true);
        }
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

  const handlePromptGenerateRef = useRef(handlePromptGenerate);
  handlePromptGenerateRef.current = handlePromptGenerate;

  useEffect(() => {
    const p = autoRunPrompt?.trim();
    if (!p || typeof window === "undefined") {
      return;
    }
    const keyPart = autoRunKey !== undefined ? String(autoRunKey) : window.location.href;
    const sk = `luxegen-auto-run:${keyPart}`;
    if (sessionStorage.getItem(sk)) {
      return;
    }
    sessionStorage.setItem(sk, "1");
    setPromptDraft(p);
    void handlePromptGenerateRef.current({ prompt: p });
  }, [autoRunPrompt, autoRunKey]);

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
    console.log("[upload] starting upload", {
      fileName: file.name,
      size: file.size,
      type: file.type,
      url: IMAGE_UPLOAD_PATH,
    });
    setError("");
    setResponse(null);
    setFileName(file.name);
    setIsLoading(true);

    const formData = new FormData();
    formData.append("image", file);

    try {
      const data = await postImageToReact(file);
      console.log("[upload] success", { path: IMAGE_UPLOAD_PATH });
      setResponse(data);
      setStreamedPromptCode(data.sourceCode ?? "");
      const id = createClientId();
      const createdAt = new Date().toLocaleString();
      setHistory((current) =>
        [
          { id, componentName: data.componentName, createdAt, response: data },
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
            ? `Network error calling ${IMAGE_UPLOAD_PATH}. Set BACKEND_URL in frontend .env.local to your Express API origin (e.g. http://localhost:8080) and run the backend on that port.`
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

  const shellPb = useFloatingPromptBar ? "pb-40" : "pb-44";

  function buildDockedControlAside() {
    return (
      <aside className="rounded-3xl border border-white/20 bg-white/65 p-5 shadow-[0_18px_48px_rgba(20,20,20,0.16)] backdrop-blur-2xl dark:border-violet-300/20 dark:bg-[#0f0f14]/70">
        <h2 className="mb-6 text-xs font-semibold tracking-[0.18em] text-zinc-500 uppercase dark:text-zinc-400">
          Control Sidebar
        </h2>

        <div className="space-y-8">
          {!useFloatingPromptBar ? (
            <div>
              <p className="mb-2 text-[11px] font-semibold tracking-wide text-amber-700/90 uppercase dark:text-amber-300/80">
                Step 1 — The prompt
              </p>
              <label className="sr-only" htmlFor="prompt-draft">
                Design prompt
              </label>
              <textarea
                id="prompt-draft"
                value={promptDraft}
                onChange={(e) => setPromptDraft(e.target.value)}
                rows={7}
                placeholder="Describe the luxury UI you want — layout, mood, typography, and key sections..."
                className="glass-input min-h-[11rem] w-full rounded-2xl border-2 border-transparent px-4 py-4 text-base leading-relaxed text-zinc-900 placeholder:text-zinc-400 focus:border-amber-400/70 focus:outline-none focus:ring-4 focus:ring-amber-400/25 dark:text-zinc-100 dark:placeholder:text-zinc-500 dark:focus:border-amber-400/50 dark:focus:ring-amber-400/15"
              />
            </div>
          ) : null}

          <div>
            <p className="mb-2 text-[11px] font-semibold tracking-wide text-amber-700/90 uppercase dark:text-amber-300/80">
              Step 2 — Style
            </p>
            <label className="mb-2 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
              Visual direction
            </label>
            <select
              id="design-style"
              value={designStyle}
              onChange={(e) => setDesignStyle(e.target.value as DesignStyle)}
              className="h-12 w-full rounded-xl border-2 border-amber-800/30 bg-white px-4 text-sm font-medium text-zinc-900 shadow-sm ring-1 ring-amber-400/25 focus:border-amber-500/70 focus:outline-none focus:ring-2 focus:ring-amber-400/35 dark:border-[#fccf45]/50 dark:bg-[#292524] dark:text-[#fef3c7] dark:focus:border-[#fccf45] dark:focus:ring-[#fccf45]/25"
            >
              {designStyles.map((style) => (
                <option key={style} value={style}>
                  {formatDesignStyleLabel(style)}
                </option>
              ))}
            </select>
          </div>

          {!useFloatingPromptBar ? (
            <div>
              <p className="mb-3 text-[11px] font-semibold tracking-wide text-amber-700/90 uppercase dark:text-amber-300/80">
                Step 3 — Action
              </p>
              <motion.button
                type="button"
                onClick={() => void handlePromptGenerate()}
                disabled={generateLoading || !promptDraft.trim() || generateBlockedByBackend}
                className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl border-2 border-amber-700/30 bg-gradient-to-r from-amber-400 via-amber-500 to-amber-600 px-4 text-sm font-extrabold tracking-wide text-zinc-950 shadow-[0_10px_28px_rgba(217,119,6,0.45)] ring-2 ring-amber-950/15 transition hover:from-amber-300 hover:via-amber-400 hover:to-amber-500 hover:shadow-[0_12px_32px_rgba(245,158,11,0.5)] disabled:cursor-not-allowed disabled:opacity-50 dark:border-amber-400/40 dark:from-amber-400 dark:via-amber-500 dark:to-amber-600 dark:text-zinc-950 dark:ring-amber-950/25"
                whileHover={{ scale: generateLoading || generateBlockedByBackend ? 1 : 1.02 }}
                whileTap={{ scale: generateLoading || generateBlockedByBackend ? 1 : 0.98 }}
              >
                {generateLoading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
                {generateLoading ? "Generating..." : "Generate UI ⚡"}
              </motion.button>
            </div>
          ) : null}

          <div className="flex items-center gap-2 pt-2">
            <motion.button
              type="button"
              onClick={() => setPromptDraft(pickRandomSurpriseIdea(promptDraft))}
              disabled={generateLoading}
              className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-xl border-2 border-amber-800/35 bg-gradient-to-b from-amber-100 to-amber-200/95 px-3 text-sm font-semibold text-amber-950 shadow-[0_2px_10px_rgba(180,83,9,0.2)] ring-1 ring-amber-400/35 transition hover:from-amber-50 hover:to-amber-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-[#fccf45]/70 dark:from-[#422006] dark:to-[#713f12] dark:text-[#fef9c3] dark:shadow-[0_2px_14px_rgba(0,0,0,0.35)] dark:ring-[#fccf45]/25 dark:hover:from-[#4d2a0a] dark:hover:to-[#854d0e]"
              whileHover={{ scale: generateLoading ? 1 : 1.02 }}
              whileTap={{ scale: generateLoading ? 1 : 0.98 }}
              title="Need inspiration? Click for a random luxury prompt."
            >
              <Sparkles className="h-4 w-4 shrink-0 text-amber-800 dark:text-[#fccf45]" aria-hidden />
              Surprise
            </motion.button>
            <button
              type="button"
              title="Need inspiration? Click for a random luxury prompt."
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-violet-200/60 bg-violet-50/80 text-violet-700 transition hover:bg-violet-100 dark:border-violet-400/25 dark:bg-violet-500/10 dark:text-violet-200 dark:hover:bg-violet-500/20"
              aria-label="Need inspiration? Click Surprise for a random luxury prompt."
            >
              <Info className="h-4 w-4" aria-hidden />
            </button>
            <button
              type="button"
              onClick={() => uploadInputRef.current?.click()}
              disabled={isLoading}
              className="glass-btn inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-zinc-700 transition hover:bg-zinc-100/80 disabled:cursor-not-allowed disabled:opacity-50 dark:text-zinc-200 dark:hover:bg-white/10"
              title="Upload reference image"
            >
              <CloudUpload className="h-4 w-4" aria-hidden />
            </button>
          </div>
        </div>

        {streamedPromptCode.trim() ? (
          <div className="mt-8 hidden rounded-2xl border border-white/15 bg-white/50 p-3 md:block dark:bg-white/[0.04]">
            <label
              htmlFor="refinement-draft"
              className="mb-2 block text-[11px] font-semibold tracking-wide text-zinc-500 uppercase dark:text-zinc-400"
            >
              Tweak Design
            </label>
            <input
              id="refinement-draft"
              type="text"
              value={refinementDraft}
              onChange={(e) => setRefinementDraft(e.target.value)}
              placeholder="e.g. Softer shadows on cards"
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
              {generateLoading ? "Applying..." : "Apply changes"}
            </motion.button>
          </div>
        ) : null}
      </aside>
    );
  }

  return (
    <div
      className={
        isLuxeWorkingPage
          ? `relative min-h-screen ${shellPb} text-zinc-900 dark:text-zinc-100`
          : overlayOnHeroGradient
            ? `min-h-screen bg-transparent ${shellPb} text-zinc-900 dark:text-zinc-100`
            : `luxury-grid min-h-screen bg-zinc-100 ${shellPb} text-zinc-900 dark:bg-[#050505] dark:text-zinc-100`
      }
    >
      {isLuxeWorkingPage ? (
        <div className="luxe-working-mesh pointer-events-none absolute inset-0 z-0" aria-hidden />
      ) : null}
      {useFloatingPromptBar ? (
        <header
          className={
            isLuxeWorkingPage
              ? "sticky top-0 z-40 border-b border-[#d4af37]/20 bg-[#fdfbf4]/55 backdrop-blur-xl dark:border-[#fccf45]/18 dark:bg-[#261e01]/72"
              : "sticky top-0 z-40 border-b border-amber-200/35 bg-white/10 backdrop-blur-xl dark:border-[#fccf45]/22 dark:bg-[#261e01]/88 dark:backdrop-blur-xl"
          }
        >
          <div className="mx-auto flex max-w-[1500px] items-center justify-between gap-4 px-4 py-3.5 md:px-8">
            <div className="flex min-w-0 items-center gap-3">
              <button
                type="button"
                onClick={() => {
                  if (useFloatingPromptBar) {
                    setHistoryMenuOpen((current) => !current);
                    setSettingsDrawerOpen(false);
                  } else {
                    setSettingsDrawerOpen((current) => !current);
                  }
                }}
                className={`shrink-0 rounded-lg p-1 transition hover:bg-white/35 dark:hover:bg-white/10 ${
                  isLuxeWorkingPage
                    ? "text-[#b8860b] drop-shadow-[0_0_8px_rgba(212,175,55,0.35)] dark:text-[#fccf45]"
                    : "text-amber-900 dark:text-[#d4af37]"
                }`}
                aria-label={useFloatingPromptBar ? "Chat history" : "Open menu"}
                aria-expanded={useFloatingPromptBar ? historyMenuOpen : settingsDrawerOpen}
              >
                <Menu className="h-6 w-6" strokeWidth={isLuxeWorkingPage ? 2.25 : 2} />
              </button>
              <span
                className={`${luxeSerif.className} truncate text-xl font-semibold tracking-tight text-amber-900 opacity-90 md:text-2xl dark:text-[#fccf45]`}
              >
                Luxegen
              </span>
            </div>
            <div className="flex shrink-0 items-center gap-2 md:gap-3">
              {!isLuxeWorkingPage ? (
                <div className="hidden items-center gap-2 rounded-full border border-emerald-300/40 bg-emerald-100/60 px-3 py-1.5 text-xs font-medium text-emerald-900 sm:flex dark:border-emerald-400/30 dark:bg-emerald-500/10 dark:text-emerald-200">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" aria-hidden />
                  Gemini 1.5
                </div>
              ) : null}
              <button
                type="button"
                onClick={() => setPromptHistoryOpen((current) => !current)}
                className={`glass-btn h-9 w-9 items-center justify-center rounded-lg text-zinc-700 dark:text-zinc-200 ${useFloatingPromptBar ? "hidden" : "hidden md:inline-flex"}`}
                title="Prompt history"
              >
                {promptHistoryOpen ? <X className="h-4 w-4" /> : <History className="h-4 w-4" />}
              </button>
              {!useFloatingPromptBar ? (
                <button
                  type="button"
                  onClick={() => setSettingsDrawerOpen((current) => !current)}
                  className="glass-btn inline-flex h-9 w-9 items-center justify-center rounded-lg text-zinc-700 md:hidden dark:text-zinc-200"
                  title="More"
                  aria-expanded={settingsDrawerOpen}
                >
                  <Settings className="h-4 w-4" />
                </button>
              ) : null}
              <ThemeToggle />
            </div>
          </div>
        </header>
      ) : (
        <header
          className={
            overlayOnHeroGradient
              ? "sticky top-0 z-40 border-b border-black/[0.06] bg-[#f7f1e8]/65 backdrop-blur-xl dark:border-white/[0.07] dark:bg-[#2a2419]/65"
              : "sticky top-0 z-40 border-b border-white/10 bg-white/75 backdrop-blur-xl dark:bg-[#0a0a0c]/80"
          }
        >
          <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-4 md:px-8">
            <div className="min-w-0 flex items-center gap-2">
              <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-zinc-900 text-xs font-bold text-white dark:bg-violet-400 dark:text-zinc-900">
                L
              </span>
              <p className="truncate text-sm font-semibold tracking-tight text-zinc-900 md:text-base dark:text-zinc-100">
                LuxeGen: AI-Powered Luxury UI
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2 md:gap-3">
              {overlayOnHeroGradient ? <ThemeToggle /> : null}
              <div className="hidden items-center gap-2 rounded-full border border-emerald-300/40 bg-emerald-100/70 px-3 py-1.5 text-xs font-medium text-emerald-900 sm:flex dark:border-emerald-400/30 dark:bg-emerald-500/10 dark:text-emerald-200">
                <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" aria-hidden />
                Gemini 1.5
              </div>
              <button
                type="button"
                onClick={() => setPromptHistoryOpen((current) => !current)}
                className="glass-btn hidden h-9 w-9 items-center justify-center rounded-lg text-zinc-700 transition hover:bg-zinc-100/80 md:inline-flex dark:text-zinc-200 dark:hover:bg-white/10"
                title="Prompt history"
              >
                {promptHistoryOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
              </button>
              <button
                type="button"
                onClick={() => setSettingsDrawerOpen((current) => !current)}
                className="glass-btn inline-flex h-9 w-9 items-center justify-center rounded-lg text-zinc-700 transition hover:bg-zinc-100/80 md:hidden dark:text-zinc-200 dark:hover:bg-white/10"
                title="More — history & tweak design"
                aria-expanded={settingsDrawerOpen}
              >
                <Settings className="h-4 w-4" />
              </button>
            </div>
          </div>
        </header>
      )}

      <AnimatePresence>
        {promptHistoryOpen && !useFloatingPromptBar ? (
          <motion.aside
            initial={{ opacity: 0, x: 24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 24 }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
            className="fixed top-16 right-4 z-50 hidden w-[22rem] rounded-2xl border border-white/10 bg-white/80 p-2 shadow-[0_16px_40px_rgba(0,0,0,0.18)] backdrop-blur-xl md:block dark:bg-[#0f0f13]/85"
          >
            <PromptHistorySidebar
              items={promptHistory}
              activeId={activePromptHistoryId}
              onSelect={(id) => {
                handlePromptHistorySelect(id);
                setPromptHistoryOpen(false);
              }}
              onClear={handleClearPromptHistory}
              formatStyleLabel={formatDesignStyleLabel}
            />
          </motion.aside>
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {settingsDrawerOpen && !useFloatingPromptBar ? (
          <>
            <motion.button
              type="button"
              aria-label="Close settings"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm md:hidden"
              onClick={() => setSettingsDrawerOpen(false)}
            />
            <motion.aside
              initial={{ opacity: 0, y: "100%" }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: "100%" }}
              transition={{ type: "spring", stiffness: 320, damping: 34 }}
              className="fixed inset-x-0 bottom-0 z-[51] max-h-[85vh] overflow-y-auto rounded-t-3xl border border-white/15 bg-white/95 p-4 shadow-[0_-12px_40px_rgba(0,0,0,0.2)] backdrop-blur-xl md:hidden dark:bg-[#0f0f13]/95"
            >
              <div className="mx-auto mb-3 flex max-w-lg items-center justify-between">
                <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">More</p>
                <button
                  type="button"
                  onClick={() => setSettingsDrawerOpen(false)}
                  className="rounded-lg p-2 text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-white/10"
                  aria-label="Close"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              <div className="mx-auto max-w-lg space-y-6 pb-6">
                <div>
                  <p className="mb-2 text-xs font-semibold tracking-wide text-zinc-500 uppercase dark:text-zinc-400">
                    Prompt history
                  </p>
                  <PromptHistorySidebar
                    items={promptHistory}
                    activeId={activePromptHistoryId}
                    onSelect={(id) => {
                      handlePromptHistorySelect(id);
                      setSettingsDrawerOpen(false);
                    }}
                    onClear={handleClearPromptHistory}
                    formatStyleLabel={formatDesignStyleLabel}
                  />
                </div>
                {streamedPromptCode.trim() ? (
                  <div className="rounded-2xl border border-white/15 bg-white/50 p-3 dark:bg-white/[0.04]">
                    <label
                      htmlFor="refinement-draft-mobile"
                      className="mb-2 block text-[11px] font-semibold tracking-wide text-zinc-500 uppercase dark:text-zinc-400"
                    >
                      Tweak Design
                    </label>
                    <input
                      id="refinement-draft-mobile"
                      type="text"
                      value={refinementDraft}
                      onChange={(e) => setRefinementDraft(e.target.value)}
                      placeholder="e.g. Make the hero headline larger"
                      className="glass-input h-10 w-full rounded-xl px-3 text-sm text-zinc-900 placeholder:text-zinc-400 focus:outline-none dark:text-zinc-100"
                    />
                    <motion.button
                      type="button"
                      onClick={() => void handleRefinementGenerate()}
                      disabled={generateLoading || !refinementDraft.trim()}
                      className="glass-btn mt-2 inline-flex h-9 w-full items-center justify-center rounded-xl px-3 text-sm font-medium text-violet-900 transition hover:bg-violet-100/70 disabled:cursor-not-allowed disabled:opacity-50 dark:text-violet-100 dark:hover:bg-violet-500/15"
                      whileHover={{ scale: generateLoading ? 1 : 1.01 }}
                      whileTap={{ scale: generateLoading ? 1 : 0.99 }}
                    >
                      {generateLoading ? "Applying..." : "Apply changes"}
                    </motion.button>
                  </div>
                ) : null}
              </div>
            </motion.aside>
          </>
        ) : null}
      </AnimatePresence>

      {useFloatingPromptBar && historyMenuOpen ? (
        <motion.button
          type="button"
          aria-label="Close chat history"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[52] bg-black/25 backdrop-blur-[2px] dark:bg-black/45"
          onClick={() => setHistoryMenuOpen(false)}
        />
      ) : null}
      {useFloatingPromptBar ? (
        <aside
          className={`fixed top-0 left-0 z-[53] flex h-full min-h-0 w-[min(22rem,92vw)] flex-col border-r border-amber-200/40 bg-[#f7f3ec]/97 shadow-2xl backdrop-blur-2xl transition-[transform,opacity,visibility] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] dark:border-[#fccf45]/20 dark:bg-[#261e01]/98 ${
            historyMenuOpen
              ? "translate-x-0 opacity-100"
              : "pointer-events-none invisible -translate-x-full opacity-0"
          }`}
        >
          <div className="flex shrink-0 items-center justify-between gap-2 border-b border-amber-200/35 px-4 py-4 dark:border-white/10">
            <p
              className={`${luxeSerif.className} text-sm font-semibold text-zinc-800 dark:text-[#fccf45]`}
            >
              Chats
            </p>
            <button
              type="button"
              onClick={() => setHistoryMenuOpen(false)}
              className="rounded-lg p-2 text-zinc-600 hover:bg-black/[0.06] dark:text-zinc-300 dark:hover:bg-white/10"
              aria-label="Close"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
            <PromptHistorySidebar
              embedded
              items={promptHistory}
              activeId={activePromptHistoryId}
              onSelect={(id) => {
                handlePromptHistorySelect(id);
                setHistoryMenuOpen(false);
              }}
              onClear={handleClearPromptHistory}
              formatStyleLabel={formatDesignStyleLabel}
            />
          </div>
        </aside>
      ) : null}

      <div className="mx-auto max-w-[1500px] px-4 py-8 md:px-8">
        {!useFloatingPromptBar ? (
          <section className="mb-6 text-center">
            <h1 className="mx-auto max-w-4xl text-3xl font-semibold tracking-tight text-zinc-900 md:text-5xl dark:text-zinc-100">
              LuxeGen: AI-Powered Luxury UI
            </h1>
            <p className="mx-auto mt-2 max-w-2xl text-sm text-zinc-600 dark:text-zinc-400">
              Prompt, stream, and refine — your live preview updates as components take shape.
            </p>
            <div className="mx-auto mt-4 inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/60 px-4 py-2 text-xs font-medium text-zinc-700 backdrop-blur-xl dark:bg-white/[0.05] dark:text-zinc-200">
              Total Generations: {totalGenerations}
              <span className="text-zinc-400">|</span>
              Active Projects: {Math.max(1, history.length)}
            </div>
          </section>
        ) : null}

        <motion.div
          className={
            isLuxeWorkingPage
              ? "grid grid-cols-1 gap-5"
              : "grid grid-cols-1 gap-5 xl:grid-cols-[340px_minmax(0,1fr)]"
          }
          {...(animateCanvasEntrance
            ? {
                initial: { opacity: 0, scale: 0.97 },
                animate: { opacity: 1, scale: 1 },
                transition: { duration: 0.48, ease: [0.22, 1, 0.36, 1] as const },
              }
            : {})}
        >
          {!isLuxeWorkingPage ? buildDockedControlAside() : null}

          {isLuxeWorkingPage ? (
            <div className="luxe-thinkhall-surface rounded-[2rem] border border-[#d4af37]/28 bg-white/55 p-4 ring-1 ring-[#d4af37]/18 backdrop-blur-2xl dark:bg-[#1b1610]/55 dark:ring-[#fccf45]/15 md:p-6">
              {backendHealth === "offline" ? (
                <div
                  role="alert"
                  className="mb-5 flex flex-col gap-3 rounded-2xl border border-rose-300/50 bg-rose-50/95 px-4 py-4 text-rose-950 shadow-sm dark:border-rose-500/35 dark:bg-rose-950/40 dark:text-rose-50 md:flex-row md:items-center md:justify-between"
                >
                  <div className="min-w-0">
                    <p className={`${luxeSerif.className} text-base font-semibold tracking-tight`}>
                      Backend offline
                    </p>
                    <p className="mt-1 text-sm text-rose-900/90 dark:text-rose-100/85">
                      Next.js cannot reach your Express API. Start{" "}
                      <code className="rounded bg-black/5 px-1 py-0.5 text-xs dark:bg-white/10">
                        gemini-image-to-react-backend
                      </code>{" "}
                      (<kbd className="font-sans text-xs">npm run dev</kbd>) and ensure{" "}
                      <code className="rounded bg-black/5 px-1 py-0.5 text-xs dark:bg-white/10">
                        BACKEND_URL
                      </code>{" "}
                      in <code className="font-mono text-xs">frontend/.env.local</code> matches the
                      server port (e.g.{" "}
                      <span className="whitespace-nowrap">http://127.0.0.1:8080</span>). Use{" "}
                      <code className="rounded bg-black/5 px-1 py-0.5 text-xs dark:bg-white/10">
                        /api/test-direct
                      </code>{" "}
                      for a raw probe to the backend.
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2 self-start md:self-center">
                    <button
                      type="button"
                      onClick={() => void checkBackendHealth()}
                      className="inline-flex items-center justify-center gap-2 rounded-xl border border-rose-400/60 bg-white px-4 py-2.5 text-sm font-medium text-rose-900 transition hover:bg-rose-100/80 dark:border-rose-400/40 dark:bg-rose-900/50 dark:text-rose-50 dark:hover:bg-rose-900/80"
                    >
                      <RefreshCw className="h-4 w-4" aria-hidden />
                      Retry connection
                    </button>
                    <button
                      type="button"
                      onClick={() => void testConnectionToApi()}
                      className="inline-flex items-center justify-center rounded-xl border border-rose-500/40 bg-rose-100/80 px-4 py-2.5 text-sm font-medium text-rose-950 transition hover:bg-rose-200/90 dark:border-rose-400/35 dark:bg-rose-900/60 dark:text-rose-100 dark:hover:bg-rose-800/70"
                    >
                      Test connection
                    </button>
                  </div>
                </div>
              ) : null}
              {backendHealth === "no_gemini" ? (
                <div
                  role="status"
                  className="mb-5 rounded-2xl border border-amber-400/45 bg-amber-50/95 px-4 py-3 text-amber-950 dark:border-amber-500/30 dark:bg-amber-950/35 dark:text-amber-100"
                >
                  <p className="text-sm font-medium">API server is up — Gemini is not configured</p>
                  <p className="mt-1 text-xs text-amber-900/90 dark:text-amber-200/80">
                    Set <code className="font-mono">GEMINI_API_KEY</code> in the backend{" "}
                    <code className="font-mono">.env</code>, then restart the Express process.
                  </p>
                </div>
              ) : null}
              {backendHealth === "ready" && showGenerationCompleteBadge ? (
                <div
                  className="mb-5 flex justify-center"
                  role="status"
                  aria-live="polite"
                >
                  <div
                    className={`${luxeSerif.className} inline-flex items-center gap-2 rounded-full border border-[#c9a227]/55 bg-gradient-to-r from-[#fffdf9] via-[#fdf6e8] to-[#f8edd6] px-5 py-2 text-sm font-semibold tracking-wide text-[#6b5410] shadow-[0_10px_28px_rgba(180,140,40,0.28),inset_0_1px_0_rgba(255,255,255,0.9)] dark:border-[#fccf45]/45 dark:from-[#2c261c] dark:via-[#252018] dark:to-[#1e1a14] dark:text-[#fccf45] dark:shadow-[0_12px_36px_rgba(0,0,0,0.5),inset_0_1px_0_rgba(252,207,69,0.12)]`}
                  >
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#d4af37]/25 text-[#7c6210] dark:bg-[#fccf45]/20 dark:text-[#fccf45]">
                      <Check className="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden />
                    </span>
                    Generation Complete
                  </div>
                </div>
              ) : null}
              <div className="grid min-h-0 grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(300px,36%)] xl:gap-6">
                <motion.div
                  key={`luxe-canvas-${workspaceVisualEpoch}`}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
                  className="flex min-h-0 flex-col"
                >
                  <div className="mb-3 flex flex-wrap items-center gap-2 xl:px-0.5">
                    <h3
                      className={`${luxeSerif.className} text-sm font-semibold tracking-wide text-amber-900 dark:text-[#fccf45]`}
                    >
                      Workspace Canvas
                    </h3>
                    <label className="ml-auto flex cursor-pointer items-center gap-2 text-[10px] text-zinc-600 dark:text-white/50">
                      <input
                        type="checkbox"
                        checked={forceRenderPreview}
                        onChange={(e) => setForceRenderPreview(e.target.checked)}
                        className="rounded border-zinc-300 text-amber-600 focus:ring-amber-500"
                      />
                      Force render
                    </label>
                  </div>
                  <div className="luxe-thinkhall-surface min-h-[min(64vh,34rem)] flex-1 overflow-hidden rounded-2xl border border-[#e8dcc8]/80 bg-white/70 p-2 dark:border-[#fccf45]/12 dark:bg-[#0f0e0c]/75 xl:min-h-[min(70vh,38rem)]">
                    {!generateLoading && !serverBusy && !streamedPromptCode.trim() ? (
                      <div className="flex min-h-[24rem] flex-col items-center justify-center gap-6 rounded-xl border border-dashed border-[#d4af37]/25 bg-white/50 px-8 py-12 text-center dark:bg-white/[0.04]">
                        <p className="max-w-sm text-base font-medium text-zinc-800 dark:text-[#e8dcc4]">
                          Enter a prompt to begin
                        </p>
                        <div className="w-full max-w-md space-y-3">
                          <div className="mx-auto h-4 w-48 rounded bg-zinc-200/80 dark:bg-white/10" />
                          <div className="h-28 w-full rounded-xl shimmer-block" />
                          <div className="h-20 w-full rounded-xl shimmer-block" />
                        </div>
                      </div>
                    ) : (
                      <StreamingLivePreview
                        rawCode={streamedPromptCode}
                        serverBusy={serverBusy}
                        onServerBusyRetry={handleServerBusyRetry}
                        forceRender={
                          forceRenderPreview ||
                          generateLoading ||
                          Boolean(streamedPromptCode.trim())
                        }
                        isGenerating={generateLoading}
                        polishingMessage={LUXE_CRAFTING_MESSAGE}
                        luxeGoldShimmer
                      />
                    )}
                  </div>
                </motion.div>
                <motion.div
                  key={`luxe-code-${workspaceVisualEpoch}`}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1], delay: 0.06 }}
                  className="flex min-h-0 flex-col"
                >
                  <div className="flex min-h-[min(68vh,36rem)] flex-1 flex-col rounded-2xl border border-[#d4af37]/40 bg-gradient-to-b from-[#5c5346]/98 via-[#423a30]/99 to-[#2a241c] p-3 shadow-[inset_0_1px_0_rgba(212,175,55,0.22),0_18px_48px_rgba(0,0,0,0.28)] xl:min-h-[min(74vh,42rem)]">
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                      <p
                        className={`${luxeSerif.className} text-xs font-semibold tracking-wider text-[#e8dcc4] uppercase`}
                      >
                        Streamed Code
                      </p>
                      <div className="flex flex-wrap items-center gap-1.5">
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
                          className="inline-flex min-h-8 items-center gap-2 rounded-lg border border-[#d4af37]/25 bg-[#1e1a16]/60 px-3 py-1.5 text-[11px] font-medium text-[#f5efe4] transition hover:bg-[#2a241c]/80 disabled:cursor-not-allowed disabled:opacity-50"
                        />
                        <button
                          type="button"
                          onClick={handleExportStreamedTsx}
                          className="inline-flex items-center gap-2 rounded-lg border border-[#d4af37]/25 bg-[#1e1a16]/60 px-3 py-1.5 text-[11px] font-medium text-[#f5efe4] transition hover:bg-[#2a241c]/80"
                        >
                          <Download className="h-3.5 w-3.5" aria-hidden />
                          .tsx
                        </button>
                        <button
                          type="button"
                          onClick={handleMockDeployToVercel}
                          className="inline-flex items-center gap-2 rounded-lg border border-[#d4af37]/25 bg-[#1e1a16]/60 px-3 py-1.5 text-[11px] font-medium text-[#f5efe4] transition hover:bg-[#2a241c]/80"
                        >
                          <CloudUpload className="h-3.5 w-3.5" aria-hidden />
                          Deploy
                        </button>
                      </div>
                    </div>
                    <div className="min-h-0 flex-1 overflow-hidden rounded-xl border border-[#d4af37]/20 bg-[#1a1612]/65">
                      <StreamedCodeDisplay
                        code={streamedPromptCode}
                        isStreaming={generateLoading}
                        variant="luxe"
                      />
                    </div>
                  </div>
                </motion.div>
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
            </div>
          ) : (
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
                  {!generateLoading &&
                  !serverBusy &&
                  !streamedPromptCode.trim() ? (
                    <div className="flex min-h-[28rem] flex-col items-center justify-center gap-6 rounded-xl border border-dashed border-white/25 bg-white/40 px-8 py-12 text-center dark:bg-white/[0.02]">
                      <p className="max-w-sm text-base font-medium text-zinc-800 dark:text-zinc-100">
                        Enter a prompt to begin
                      </p>
                      <div className="w-full max-w-md space-y-3">
                        <div className="h-4 w-48 mx-auto rounded bg-zinc-200/80 dark:bg-zinc-700/50" />
                        <div className="h-28 w-full rounded-xl shimmer-block" />
                        <div className="h-20 w-full rounded-xl shimmer-block" />
                      </div>
                    </div>
                  ) : (
                    <StreamingLivePreview
                      rawCode={streamedPromptCode}
                      serverBusy={serverBusy}
                      onServerBusyRetry={handleServerBusyRetry}
                      forceRender={
                        forceRenderPreview ||
                        generateLoading ||
                        Boolean(streamedPromptCode.trim())
                      }
                      isGenerating={generateLoading}
                      polishingMessage="Polishing your luxury components..."
                    />
                  )}
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
                  <StreamedCodeDisplay
                    code={streamedPromptCode}
                    isStreaming={generateLoading}
                  />
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
          )}
        </motion.div>
      </div>

      {useFloatingPromptBar && heroToWorkspaceLayoutId ? (
        <motion.div
          layoutId={heroToWorkspaceLayoutId}
          transition={{ type: "spring", stiffness: 380, damping: 38 }}
          className="fixed right-0 bottom-0 left-0 z-[45] pt-2 pb-[max(1.25rem,env(safe-area-inset-bottom))] pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))]"
        >
          <motion.div animate={barPulseControls} className="relative mx-auto w-full max-w-[min(52rem,min(94vw,calc(100vw-2rem)))]">
            <div
              className={
                isLuxeWorkingPage
                  ? "relative overflow-hidden rounded-[1.85rem] border-2 border-[#d4af37]/45 bg-[#fdfbf4]/96 shadow-2xl shadow-amber-950/15 ring-2 ring-[#d4af37]/25 backdrop-blur-2xl dark:border-[#fccf45]/40 dark:bg-[#fdfbf4]/94 dark:shadow-black/45 dark:ring-[#fccf45]/20"
                  : "relative overflow-hidden rounded-[1.85rem] border-2 border-[#a07830]/55 bg-[#fdfbf4]/88 shadow-[0_10px_40px_rgba(139,105,20,0.07),inset_0_1px_0_rgba(255,255,255,0.85),inset_0_-10px_28px_rgba(160,120,48,0.06),inset_4px_4px_12px_rgba(255,255,255,0.45)] backdrop-blur-2xl dark:border-2 dark:border-[#d4af37]/30 dark:bg-transparent dark:shadow-[0_0_40px_rgba(0,0,0,0.45)] dark:backdrop-blur-none"
              }
            >
              <div className="relative rounded-[inherit] dark:rounded-2xl dark:bg-[#fdfbf4]/90 dark:backdrop-blur-md dark:p-2">
              {!streamedPromptCode.trim() ? (
                <>
                  <label htmlFor="floating-prompt-bar" className="sr-only">
                    Design prompt
                  </label>
                  <textarea
                    id="floating-prompt-bar"
                    value={promptDraft}
                    onChange={(e) => setPromptDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        if (
                          !generateLoading &&
                          !generateBlockedByBackend &&
                          promptDraft.trim()
                        ) {
                          void barPulseControls.start({
                            scale: [1, 1.018, 1],
                            transition: { duration: 0.48, ease: [0.22, 1, 0.36, 1] },
                          });
                          void handlePromptGenerate();
                        }
                      }
                    }}
                    rows={2}
                    placeholder="Describe The UI You Want..."
                    className="min-h-[5.25rem] w-full resize-none bg-transparent px-4 pt-4 pb-2 text-base leading-relaxed text-zinc-900 outline-none placeholder:font-sans placeholder:text-sm placeholder:text-zinc-400 dark:text-slate-900 dark:placeholder:text-slate-500"
                  />
                  <div className="flex flex-col gap-2 border-t border-[#d4af37]/25 bg-[#faf8f3]/60 px-3 py-2.5 dark:border-white/12 dark:bg-white/[0.04] sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <motion.button
                        type="button"
                        onClick={() => uploadInputRef.current?.click()}
                        disabled={isLoading}
                        title="Upload reference image"
                        aria-label="Upload reference image"
                        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[#c4b8a5]/75 bg-gradient-to-b from-[#f8f4ec] to-[#ebe4d8] text-zinc-800 shadow-sm transition hover:from-[#f2ece2] hover:to-[#e5ddd0] disabled:cursor-not-allowed disabled:opacity-40 dark:border-[#b8ae9c]/60 dark:from-[#e8e4dc] dark:to-[#dcd8d0]"
                        whileHover={{ scale: isLoading ? 1 : 1.04 }}
                        whileTap={{ scale: isLoading ? 1 : 0.96 }}
                      >
                        <Plus className="h-5 w-5" strokeWidth={2} aria-hidden />
                      </motion.button>
                      <div className="relative min-w-[10.5rem] flex-1 sm:max-w-[13.5rem]">
                        <Palette
                          className="pointer-events-none absolute top-1/2 left-2.5 z-[1] h-4 w-4 -translate-y-1/2 text-amber-800 dark:text-[#fccf45]"
                          aria-hidden
                        />
                        <label htmlFor="floating-design-style" className="sr-only">
                          Design style — minimal, luxury, editorial, etc.
                        </label>
                        <select
                          id="floating-design-style"
                          value={designStyle}
                          onChange={(e) => setDesignStyle(e.target.value as DesignStyle)}
                          className="h-10 w-full cursor-pointer appearance-none rounded-xl border-2 border-amber-800/30 bg-white py-0 pr-8 pl-9 text-xs font-medium text-zinc-900 shadow-sm ring-1 ring-amber-400/25 sm:text-sm dark:border-[#fccf45]/55 dark:bg-[#292524] dark:text-[#fef3c7] dark:shadow-[0_2px_12px_rgba(0,0,0,0.35)] dark:ring-[#fccf45]/20"
                        >
                          {designStyles.map((style) => (
                            <option key={style} value={style}>
                              {formatDesignStyleLabel(style)}
                            </option>
                          ))}
                        </select>
                      </div>
                      <motion.button
                        type="button"
                        onClick={() => setPromptDraft(pickRandomSurpriseIdea(promptDraft))}
                        disabled={generateLoading}
                        className="inline-flex h-10 shrink-0 items-center gap-2 rounded-xl border-2 border-amber-800/35 bg-gradient-to-b from-amber-100 to-amber-200/95 px-3 text-xs font-semibold text-amber-950 shadow-[0_2px_10px_rgba(180,83,9,0.2)] ring-1 ring-amber-400/35 transition hover:from-amber-50 hover:to-amber-100 disabled:opacity-50 sm:px-4 sm:text-sm dark:border-[#fccf45]/70 dark:from-[#422006] dark:to-[#713f12] dark:text-[#fef9c3] dark:shadow-[0_2px_14px_rgba(0,0,0,0.4)] dark:ring-[#fccf45]/25 dark:hover:from-[#4d2a0a] dark:hover:to-[#854d0e]"
                        whileHover={{ scale: generateLoading ? 1 : 1.02 }}
                        whileTap={{ scale: generateLoading ? 1 : 0.98 }}
                        title="Surprise me with a random luxury prompt"
                      >
                        <Sparkles className="h-4 w-4 shrink-0 text-amber-800 dark:text-[#fccf45]" aria-hidden />
                        Surprise me
                      </motion.button>
                    </div>
                    <div className="flex shrink-0 justify-end sm:justify-start">
                      <motion.button
                        type="button"
                        onClick={() => void handlePromptGenerate()}
                        disabled={
                          generateLoading ||
                          !promptDraft.trim() ||
                          generateBlockedByBackend
                        }
                        title={generateBlockedByBackend ? "Backend offline" : "Generate"}
                        aria-label="Generate"
                        className="flex h-10 w-10 items-center justify-center rounded-md border border-[#c4b8a5]/70 bg-gradient-to-b from-[#ebe4d8] to-[#dcd3c4] shadow-sm transition hover:from-[#e5ddd0] hover:to-[#d4cbbf] disabled:cursor-not-allowed disabled:opacity-40 dark:border-[#b8ae9c]/60 dark:from-[#d4d0c8] dark:to-[#c9c5bc]"
                        whileHover={{
                          scale:
                            generateLoading ||
                            !promptDraft.trim() ||
                            generateBlockedByBackend
                              ? 1
                              : 1.05,
                        }}
                        whileTap={{
                          scale:
                            generateLoading ||
                            !promptDraft.trim() ||
                            generateBlockedByBackend
                              ? 1
                              : 0.95,
                        }}
                      >
                        {generateLoading ? (
                          <Loader2 className="h-5 w-5 animate-spin text-zinc-800 dark:text-zinc-900" aria-hidden />
                        ) : (
                          <Play
                            className="ml-0.5 h-3.5 w-3.5 fill-zinc-900 text-zinc-900 dark:fill-black dark:text-black"
                            aria-hidden
                          />
                        )}
                      </motion.button>
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <label htmlFor="floating-refine-bar" className="sr-only">
                    Refine design
                  </label>
                  <input
                    id="floating-refine-bar"
                    type="text"
                    value={refinementDraft}
                    onChange={(e) => setRefinementDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (
                        e.key === "Enter" &&
                        refinementDraft.trim() &&
                        !generateLoading &&
                        !generateBlockedByBackend
                      ) {
                        e.preventDefault();
                        void barPulseControls.start({
                          scale: [1, 1.018, 1],
                          transition: { duration: 0.48, ease: [0.22, 1, 0.36, 1] },
                        });
                        void handleRefinementGenerate();
                      }
                    }}
                    placeholder="Refine — e.g. softer shadows, larger headline..."
                    className="h-11 w-full border-0 bg-transparent px-4 pt-3 pb-2 text-sm text-zinc-900 placeholder:text-slate-400 outline-none dark:text-slate-900 dark:placeholder:text-slate-500"
                  />
                  <div className="flex flex-col gap-2 border-t border-[#d4af37]/25 bg-[#faf8f3]/60 px-3 py-2.5 dark:border-white/12 dark:bg-white/[0.04] sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <motion.button
                        type="button"
                        onClick={() => uploadInputRef.current?.click()}
                        disabled={isLoading}
                        title="Upload reference image"
                        aria-label="Upload reference image"
                        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[#c4b8a5]/75 bg-gradient-to-b from-[#f8f4ec] to-[#ebe4d8] text-zinc-800 shadow-sm transition hover:from-[#f2ece2] disabled:opacity-40 dark:border-[#b8ae9c]/60 dark:from-[#e8e4dc] dark:to-[#dcd8d0]"
                        whileHover={{ scale: isLoading ? 1 : 1.04 }}
                        whileTap={{ scale: isLoading ? 1 : 0.96 }}
                      >
                        <Plus className="h-5 w-5" strokeWidth={2} aria-hidden />
                      </motion.button>
                      <div className="relative min-w-[10.5rem] flex-1 sm:max-w-[13.5rem]">
                        <Palette
                          className="pointer-events-none absolute top-1/2 left-2.5 z-[1] h-4 w-4 -translate-y-1/2 text-amber-800 dark:text-[#fccf45]"
                          aria-hidden
                        />
                        <label htmlFor="floating-design-style-refine" className="sr-only">
                          Design style for refinement
                        </label>
                        <select
                          id="floating-design-style-refine"
                          value={designStyle}
                          onChange={(e) => setDesignStyle(e.target.value as DesignStyle)}
                          className="h-10 w-full cursor-pointer appearance-none rounded-xl border-2 border-amber-800/30 bg-white py-0 pr-8 pl-9 text-xs font-medium text-zinc-900 shadow-sm ring-1 ring-amber-400/25 sm:text-sm dark:border-[#fccf45]/55 dark:bg-[#292524] dark:text-[#fef3c7] dark:shadow-[0_2px_12px_rgba(0,0,0,0.35)] dark:ring-[#fccf45]/20"
                        >
                          {designStyles.map((style) => (
                            <option key={style} value={style}>
                              {formatDesignStyleLabel(style)}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <div className="flex shrink-0 justify-end">
                      <motion.button
                        type="button"
                        onClick={() => void handleRefinementGenerate()}
                        disabled={
                          generateLoading ||
                          !refinementDraft.trim() ||
                          generateBlockedByBackend
                        }
                        title={generateBlockedByBackend ? "Backend offline" : "Apply refinement"}
                        aria-label="Apply refinement"
                        className="flex h-10 w-10 items-center justify-center rounded-md border border-[#c4b8a5]/70 bg-gradient-to-b from-[#ebe4d8] to-[#dcd3c4] shadow-sm transition hover:from-[#e5ddd0] hover:to-[#d4cbbf] disabled:cursor-not-allowed disabled:opacity-40 dark:border-[#b8ae9c]/60 dark:from-[#d4d0c8] dark:to-[#c9c5bc]"
                        whileHover={{
                          scale:
                            generateLoading ||
                            !refinementDraft.trim() ||
                            generateBlockedByBackend
                              ? 1
                              : 1.03,
                        }}
                        whileTap={{
                          scale:
                            generateLoading ||
                            !refinementDraft.trim() ||
                            generateBlockedByBackend
                              ? 1
                              : 0.97,
                        }}
                      >
                        {generateLoading ? (
                          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                        ) : (
                          <Play
                            className="ml-0.5 h-3.5 w-3.5 fill-zinc-900 text-zinc-900 dark:fill-black dark:text-black"
                            aria-hidden
                          />
                        )}
                      </motion.button>
                    </div>
                  </div>
                </>
              )}
              </div>
            </div>
          </motion.div>
        </motion.div>
      ) : null}

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
