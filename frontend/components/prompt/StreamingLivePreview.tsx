"use client";

import * as React from "react";
import { LiveContext, LivePreview, LiveProvider } from "react-live";
import {
  LIVE_PREVIEW_WAITING_CODE,
  appendMissingDefaultExport,
  analyzePreviewCodeIssues,
  isPlaceholderOrWaitingLiveCode,
  isPreparedLiveCodeStructurallyRenderSafe,
  prepareStreamedCodeForLive,
  stripMarkdownCodeFencesFromStream,
} from "@/lib/live-preview";
import { livePreviewScope } from "@/lib/live-preview-scope";
import {
  isLikelyTranspileSyntaxError,
  isLivePreviewCodeCompilable,
} from "@/lib/live-preview-compile-check";
import { luxeSerif } from "@/lib/fonts/luxe-serif";
import { devWarn } from "@/lib/dev-log";
import { persistPreviewProviderCodeForDiagnostics } from "@/lib/workspace-diagnostics";

type PreviewErrorBoundaryProps = {
  code: string;
  children: React.ReactNode;
  onRecover?: () => void;
};

type PreviewErrorBoundaryState = { hasError: boolean; lastMessage: string };

class PreviewErrorBoundary extends React.Component<
  PreviewErrorBoundaryProps,
  PreviewErrorBoundaryState
> {
  state: PreviewErrorBoundaryState = { hasError: false, lastMessage: "" };

  static getDerivedStateFromError(error: Error): PreviewErrorBoundaryState {
    return { hasError: true, lastMessage: error.message };
  }

  componentDidUpdate(prevProps: PreviewErrorBoundaryProps) {
    if (prevProps.code !== this.props.code) {
      this.setState({ hasError: false, lastMessage: "" });
    }
  }

  componentDidCatch(error: Error) {
    devWarn("[StreamingLivePreview] runtime error (often incomplete stream):", error.message);
    this.props.onRecover?.();
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-[12rem] flex-col items-center justify-center gap-2 rounded-xl border border-amber-200 bg-amber-50 p-4 text-center text-sm text-amber-950 dark:border-amber-300/25 dark:bg-amber-500/5 dark:text-amber-100/90">
          <p>Preview hit a runtime error — check the streamed code for invalid JSX or hooks.</p>
          {this.state.lastMessage ? (
            <pre className="max-h-24 max-w-full overflow-auto rounded-lg bg-amber-100/80 p-2 text-left text-[11px] whitespace-pre-wrap text-amber-950 dark:bg-amber-950/40 dark:text-amber-100/90">
              {this.state.lastMessage}
            </pre>
          ) : null}
          <p className="text-xs text-amber-800/90 dark:text-amber-200/70">
            A stable preview will return on the next successful update.
          </p>
        </div>
      );
    }
    return this.props.children;
  }
}

type SafeRenderProps = {
  children: React.ReactNode;
  onError?: () => void;
};

type SafeRenderState = { hasError: boolean };

class SafeRender extends React.Component<SafeRenderProps, SafeRenderState> {
  state: SafeRenderState = { hasError: false };

  static getDerivedStateFromError(): SafeRenderState {
    return { hasError: true };
  }

  componentDidCatch(error: Error) {
    devWarn("[SafeRender] guarded partial render error:", error.message);
    this.props.onError?.();
  }

  componentDidUpdate(prevProps: SafeRenderProps) {
    if (prevProps.children !== this.props.children && this.state.hasError) {
      this.setState({ hasError: false });
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-[12rem] items-center justify-center rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-300/25 dark:bg-amber-500/5 dark:text-amber-100/90">
          Optimizing Code...
        </div>
      );
    }
    return this.props.children;
  }
}

/**
 * Do not wrap `LivePreview` in `React.memo` with no props: when `LiveProvider`
 * updates context after async transpile, memo bails out and the preview never
 * re-renders (stuck blank).
 */
function LivePreviewWithShell(props: {
  isGenerating: boolean;
  luxeGoldShimmer?: boolean;
}): React.ReactElement {
  const { element } = React.useContext(LiveContext);
  const showCompilingOverlay =
    props.isGenerating && (element === undefined || element === null);

  return (
    <div className="relative min-h-[min(11rem,32dvh)] w-full flex-1">
      <LivePreview className="min-h-[8rem] w-full" />
      {showCompilingOverlay ? (
        <div
          className={
            props.luxeGoldShimmer
              ? "absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-gradient-to-b from-[#fffdfb]/92 to-[#f5ebe0]/88 px-3 py-6 text-center dark:from-[#252018]/94 dark:to-[#1a1612]/92"
              : "absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-white/90 px-3 py-6 text-center dark:bg-[#121217]/88"
          }
          role="status"
          aria-live="polite"
        >
          <p
            className={
              props.luxeGoldShimmer
                ? "max-w-sm text-sm font-medium text-amber-950/90 dark:text-[#e8dcc4]/95"
                : "max-w-sm text-sm text-zinc-600 dark:text-zinc-300"
            }
          >
            Compiling live preview from the stream… It will appear here when the TSX is valid.
          </p>
        </div>
      ) : null}
    </div>
  );
}

function TryLivePreview(props: {
  onRenderError: () => void;
  isGenerating: boolean;
  luxeGoldShimmer?: boolean;
}): React.ReactElement | null {
  try {
    return (
      <LivePreviewWithShell isGenerating={props.isGenerating} luxeGoldShimmer={props.luxeGoldShimmer} />
    );
  } catch (err) {
    devWarn("[TryLivePreview] render guard:", err);
    props.onRenderError();
    return null;
  }
}

function FilteredStreamingLiveError(props: {
  className?: string;
  /** Hide Sucrase/react-live error UI while the model is still streaming */
  hideDuringStream?: boolean;
}): React.ReactElement | null {
  const { error } = React.useContext(LiveContext);
  if (!error || props.hideDuringStream) {
    return null;
  }
  const syntax = isLikelyTranspileSyntaxError(error);
  return (
    <div
      className={
        props.className ??
        "mt-3 max-h-56 overflow-auto rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-900 dark:border-rose-300/40 dark:bg-rose-950/20 dark:text-rose-200"
      }
      role="alert"
    >
      <p className="font-semibold">
        {syntax ? "Syntax error (streaming)" : "Preview error"}
      </p>
      <pre className="mt-2 max-h-44 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] text-rose-950 dark:text-rose-100/95">
        {error}
      </pre>
    </div>
  );
}

type StreamingLivePreviewProps = {
  rawCode: string;
  serverBusy?: boolean;
  onServerBusyRetry?: () => void;
  forceRender?: boolean;
  isGenerating?: boolean;
  /**
   * Bumps when a new generation starts (e.g. workspace visual epoch). Remounts
   * `LiveProvider` and clears stable preview cache so react-live does not reuse prior stream state.
   */
  streamResetKey?: number;
  /** Shown under the shimmer while generating or waiting on capacity retries */
  polishingMessage?: string;
  /** Gold mesh shimmer + typography for the luxe /generate workspace. */
  luxeGoldShimmer?: boolean;
};

const DEFAULT_POLISH_MESSAGE = "Polishing your luxury components...";

function appearsChunkClosed(code: string): boolean {
  const t = code.trim();
  if (!t) {
    return false;
  }
  return /<\/[a-zA-Z][\w:-]*>\s*$/.test(t) || /\/>\s*$/.test(t) || /[;)}]\s*$/.test(t);
}

function hasRenderableKickoffSignal(code: string): boolean {
  const t = code.trim();
  if (!t) {
    return false;
  }
  return (
    /<[A-Za-z][\w:-]*(?:\s|>)/.test(t) ||
    /\bfunction\s+[A-Za-z_$][\w$]*\s*\(/.test(t) ||
    /\bconst\s+[A-Za-z_$][\w$]*\s*=\s*(?:\([^)]*\)\s*=>|function\b)/.test(t)
  );
}

/** Set at build time in the client bundle. */
const IS_PRODUCTION_BUILD = process.env.NODE_ENV === "production";

/**
 * Production: only feed react-live when sucrase can compile the snippet and the chunk
 * looks structurally complete enough to avoid streaming SyntaxErrors in the preview.
 */
function passesProductionStableGate(liveCode: string): boolean {
  if (isPlaceholderOrWaitingLiveCode(liveCode)) {
    return true;
  }
  try {
    if (!isLivePreviewCodeCompilable(liveCode)) {
      return false;
    }
    return (
      appearsChunkClosed(liveCode) || isPreparedLiveCodeStructurallyRenderSafe(liveCode)
    );
  } catch {
    return false;
  }
}

export function StreamingLivePreview({
  rawCode,
  serverBusy = false,
  onServerBusyRetry,
  forceRender = false,
  isGenerating = false,
  streamResetKey = 0,
  polishingMessage = DEFAULT_POLISH_MESSAGE,
  luxeGoldShimmer = false,
}: StreamingLivePreviewProps) {
  const barShimmer = luxeGoldShimmer ? "luxe-gold-shimmer" : "shimmer-block";
  const fenceStrippedRaw = React.useMemo(
    () => stripMarkdownCodeFencesFromStream(rawCode),
    [rawCode],
  );
  const hasStreamedBody = Boolean(fenceStrippedRaw.trim());
  const normalizedRawCode = React.useMemo(
    () =>
      appendMissingDefaultExport(fenceStrippedRaw, {
        permissive: Boolean(forceRender || isGenerating || hasStreamedBody),
      }),
    [fenceStrippedRaw, forceRender, isGenerating, hasStreamedBody],
  );
  const candidateLiveCode = React.useMemo(
    () =>
      prepareStreamedCodeForLive(normalizedRawCode, {
        forceRender: forceRender || isGenerating || hasStreamedBody,
      }),
    [normalizedRawCode, forceRender, isGenerating, hasStreamedBody],
  );

  const lastStableLiveRef = React.useRef<string | null>(null);
  const [providerCode, setProviderCode] = React.useState(LIVE_PREVIEW_WAITING_CODE);
  const [previewPipelineLabel, setPreviewPipelineLabel] = React.useState<
    "Waiting" | "Debounced" | "Kickoff"
  >("Waiting");
  const prevStreamEpochRef = React.useRef<number | undefined>(undefined);
  const recoverThrottleRef = React.useRef<number>(0);
  const debounceTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const showPreviewDebugBadge =
    process.env.NODE_ENV === "development" && isGenerating && !serverBusy;

  const bumpPipelineLabel = React.useCallback((next: "Waiting" | "Debounced" | "Kickoff") => {
    if (process.env.NODE_ENV === "development") {
      setPreviewPipelineLabel(next);
    }
  }, []);

  React.useEffect(() => {
    persistPreviewProviderCodeForDiagnostics(providerCode);
  }, [providerCode]);

  const applyLiveCode = React.useCallback(
    (next: string) => {
      if (isLivePreviewCodeCompilable(next)) {
        setProviderCode((prev) => (prev === next ? prev : next));
        if (!isPlaceholderOrWaitingLiveCode(next)) {
          lastStableLiveRef.current = next;
        }
        return;
      }
      if (isGenerating) {
        if (
          !lastStableLiveRef.current &&
          !isPlaceholderOrWaitingLiveCode(next) &&
          hasRenderableKickoffSignal(fenceStrippedRaw)
        ) {
          /** First valid JSX/component signal: attempt render early instead of staying in Waiting forever. */
          setProviderCode((prev) => (prev === next ? prev : next));
          return;
        }
        const stable = lastStableLiveRef.current;
        if (stable) {
          setProviderCode((prev) => (prev === stable ? prev : stable));
        }
        return;
      }
      setProviderCode((prev) => (prev === next ? prev : next));
    },
    [fenceStrippedRaw, isGenerating],
  );

  React.useEffect(() => {
    const prev = prevStreamEpochRef.current;
    prevStreamEpochRef.current = streamResetKey;
    if (prev !== undefined && prev !== streamResetKey) {
      lastStableLiveRef.current = null;
      setProviderCode(LIVE_PREVIEW_WAITING_CODE);
      bumpPipelineLabel("Waiting");
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
    }
  }, [bumpPipelineLabel, streamResetKey]);

  React.useEffect(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }

    if (!fenceStrippedRaw.trim()) {
      if (isGenerating) {
        bumpPipelineLabel("Waiting");
        setProviderCode((p) => (p === LIVE_PREVIEW_WAITING_CODE ? p : LIVE_PREVIEW_WAITING_CODE));
      } else {
        lastStableLiveRef.current = null;
        setProviderCode((p) => (p === LIVE_PREVIEW_WAITING_CODE ? p : LIVE_PREVIEW_WAITING_CODE));
      }
      return;
    }

    const tryApplyCandidate = () => {
      const next = candidateLiveCode;
      const placeholder = isPlaceholderOrWaitingLiveCode(next);
      const structureOk = placeholder || isPreparedLiveCodeStructurallyRenderSafe(next);
      const closingLooksComplete = appearsChunkClosed(next);
      const safeEnoughToTry =
        !isGenerating || placeholder || structureOk || closingLooksComplete;

      if (!safeEnoughToTry) {
        const stable = lastStableLiveRef.current;
        if (stable) {
          setProviderCode((prev) => (prev === stable ? prev : stable));
        }
        return;
      }

      if (
        IS_PRODUCTION_BUILD &&
        isGenerating &&
        !forceRender &&
        !placeholder &&
        !passesProductionStableGate(next)
      ) {
        const stable = lastStableLiveRef.current;
        if (stable) {
          setProviderCode((prev) => (prev === stable ? prev : stable));
        }
        return;
      }

      try {
        if (!placeholder && !isLivePreviewCodeCompilable(next)) {
          const stable = lastStableLiveRef.current;
          if (stable) {
            setProviderCode((prev) => (prev === stable ? prev : stable));
          }
          return;
        }
        applyLiveCode(next);
      } catch (err) {
        if (err instanceof SyntaxError) {
          return;
        }
        devWarn("[StreamingLivePreview] guarded compile/apply error:", err);
      }
    };

    if (isGenerating) {
      if (hasRenderableKickoffSignal(fenceStrippedRaw)) {
        bumpPipelineLabel("Kickoff");
        tryApplyCandidate();
        return;
      }
      bumpPipelineLabel("Debounced");
      debounceTimerRef.current = setTimeout(() => {
        bumpPipelineLabel("Kickoff");
        tryApplyCandidate();
      }, 500);
      return;
    }

    tryApplyCandidate();

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
    };
  }, [
    applyLiveCode,
    bumpPipelineLabel,
    candidateLiveCode,
    fenceStrippedRaw,
    forceRender,
    isGenerating,
  ]);

  React.useEffect(
    () => () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
    },
    [],
  );

  const handleRecover = React.useCallback(() => {
    const now = Date.now();
    if (now - recoverThrottleRef.current < 400) {
      return;
    }
    recoverThrottleRef.current = now;
    const stable = lastStableLiveRef.current;
    if (stable) {
      setProviderCode((prev) => (prev === stable ? prev : stable));
    }
  }, []);

  const diagnostics = React.useMemo(
    () => analyzePreviewCodeIssues(fenceStrippedRaw),
    [fenceStrippedRaw],
  );
  /**
   * Skeleton: server capacity, or very early streaming chunks where code is still too partial
   * to render a stable preview.
   */
  const isEarlyStreamingPhase =
    isGenerating && fenceStrippedRaw.trim().length < 180;
  /** Production: keep the “generating” banner for the whole stream unless Force render is on. */
  const showProductionStreamGenerating =
    IS_PRODUCTION_BUILD && isGenerating && hasStreamedBody && !forceRender;
  const showShimmer =
    serverBusy || isEarlyStreamingPhase || showProductionStreamGenerating;

  if (serverBusy) {
    return (
      <article className="overflow-hidden rounded-2xl border border-zinc-200/90 bg-white shadow-sm dark:border-white/10 dark:bg-[#0b0b0e] dark:shadow-none">
        <div className="flex items-center justify-between border-b border-zinc-200/90 px-4 py-2 dark:border-white/10">
          <span className="text-xs text-zinc-600 dark:text-zinc-400">Live preview (streaming)</span>
        </div>
        <div className="flex min-h-[min(28rem,72dvh)] flex-col items-center justify-center gap-4 p-6 text-center sm:min-h-[28rem] sm:p-8">
          <div
            className={
              luxeGoldShimmer
                ? "w-full max-w-2xl space-y-3 rounded-2xl border border-[#d4af37]/30 bg-[#fdfbf4]/75 p-5 shadow-inner dark:border-[#fccf45]/25 dark:bg-[#1a1612]/85"
                : "w-full max-w-2xl space-y-3 rounded-2xl border border-white/10 bg-white/70 p-4 dark:bg-white/[0.04]"
            }
          >
            <p
              className={
                luxeGoldShimmer
                  ? "text-center text-sm font-medium tracking-wide text-amber-900 dark:text-[#fccf45]"
                  : "text-center text-sm font-medium text-zinc-600 dark:text-zinc-300"
              }
            >
              {polishingMessage}
            </p>
            <div
              className={`mx-auto h-5 w-40 rounded ${luxeGoldShimmer ? barShimmer : "bg-zinc-200/70 dark:bg-zinc-700/40"}`}
            />
            <div className={`h-24 rounded-xl ${barShimmer}`} />
            <div className={`h-16 rounded-xl ${barShimmer} ${luxeGoldShimmer ? "opacity-90" : ""}`} />
          </div>
          <div className="rounded-2xl border border-amber-200/80 bg-amber-50/90 px-6 py-8 dark:border-amber-400/30 dark:bg-amber-950/30">
            <p className="text-base font-semibold text-amber-950 dark:text-amber-100">Server busy</p>
            <p className="mt-2 max-w-sm text-sm text-amber-900/90 dark:text-amber-200/80">
              The model is temporarily unavailable (503 / high demand). Try again in a moment.
            </p>
            {onServerBusyRetry ? (
              <button
                type="button"
                onClick={onServerBusyRetry}
                className="mt-4 rounded-xl bg-amber-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-amber-700 dark:bg-amber-500 dark:hover:bg-amber-400"
              >
                Retry
              </button>
            ) : null}
          </div>
        </div>
      </article>
    );
  }

  return (
    <article
      className={
        luxeGoldShimmer
          ? "luxe-thinkhall-surface w-full min-w-0 overflow-hidden rounded-2xl border border-[#d4af37]/32 bg-gradient-to-b from-white to-[#fbf6ed] dark:border-[#fccf45]/22 dark:from-[#12100e] dark:to-[#0a0908]"
          : "w-full min-w-0 overflow-hidden rounded-2xl border border-zinc-200/90 bg-white shadow-sm dark:border-white/10 dark:bg-[#0b0b0e] dark:shadow-none"
      }
    >
      <div
        className={
          luxeGoldShimmer
            ? `${luxeSerif.className} border-b border-[#d4af37]/25 px-4 py-2.5 text-xs tracking-[0.18em] text-amber-900/85 uppercase dark:border-[#fccf45]/18 dark:text-[#e8dcc4]/95`
            : "border-b border-zinc-200/90 px-4 py-2 text-xs text-zinc-600 dark:border-white/10 dark:text-zinc-400"
        }
      >
        {luxeGoldShimmer ? "Live preview · Luxe canvas" : "Live preview (streaming)"}
      </div>
      <div className="relative min-h-[min(28rem,72dvh)] p-3 sm:min-h-[28rem] sm:p-4">
        {showPreviewDebugBadge ? (
          <div
            className={
              luxeGoldShimmer
                ? "pointer-events-none absolute right-3 bottom-3 z-20 rounded-md border border-[#d4af37]/40 bg-[#fdfbf4]/92 px-2 py-0.5 font-mono text-[10px] font-medium tracking-tight text-amber-950 shadow-sm backdrop-blur-sm dark:border-[#fccf45]/35 dark:bg-[#1a1612]/90 dark:text-[#fccf45]"
                : "pointer-events-none absolute right-3 bottom-3 z-20 rounded-md border border-zinc-300/80 bg-white/90 px-2 py-0.5 font-mono text-[10px] font-medium tracking-tight text-zinc-700 shadow-sm backdrop-blur-sm dark:border-white/15 dark:bg-[#0b0b0e]/90 dark:text-zinc-200"
            }
            title="Preview pipeline (dev only)"
          >
            {previewPipelineLabel}
          </div>
        ) : null}
        {!diagnostics.hasDefaultExport && hasStreamedBody && !forceRender ? (
          <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900 dark:border-amber-300/30 dark:bg-amber-500/10 dark:text-amber-200">
            Streamed code has no <code>export default ...</code> yet; turn on <strong>Force render</strong> to try a partial preview.
          </div>
        ) : null}
        {diagnostics.streamError ? (
          <div className="mb-3 rounded-lg border border-rose-200 bg-rose-50 p-2 text-xs text-rose-900 dark:border-rose-300/30 dark:bg-rose-500/10 dark:text-rose-200">
            Generation error: {diagnostics.streamError}
          </div>
        ) : null}
        {diagnostics.unsupportedImports.length ? (
          <div className="mb-3 rounded-lg border border-rose-200 bg-rose-50 p-2 text-xs text-rose-900 dark:border-rose-300/30 dark:bg-rose-500/10 dark:text-rose-200">
            Unsupported imports for live preview: {diagnostics.unsupportedImports.join(", ")}
          </div>
        ) : null}
        {showShimmer ? (
          <div
            className={
              luxeGoldShimmer
                ? "mb-3 space-y-3 rounded-2xl border border-[#d4af37]/28 bg-gradient-to-b from-[#fffdfb]/95 to-[#f5ebe0]/90 p-5 shadow-[inset_0_1px_0_rgba(212,175,55,0.2)] dark:border-[#fccf45]/22 dark:from-[#2a2419]/95 dark:to-[#1e1a14]/95"
                : "mb-3 space-y-3 rounded-2xl border border-white/10 bg-white/70 p-4 dark:bg-white/[0.04]"
            }
          >
            <p
              className={
                luxeGoldShimmer
                  ? "text-center text-sm font-medium tracking-wide text-amber-950 dark:text-[#fccf45]"
                  : "text-center text-sm font-medium text-zinc-600 dark:text-zinc-300"
              }
            >
              {polishingMessage}
            </p>
            <div
              className={`mx-auto h-5 w-40 rounded ${luxeGoldShimmer ? barShimmer : "bg-zinc-200/70 dark:bg-zinc-700/40"}`}
            />
            <div className={`h-24 rounded-xl ${barShimmer}`} />
            <div className={`h-16 rounded-xl ${barShimmer} ${luxeGoldShimmer ? "opacity-90" : ""}`} />
          </div>
        ) : null}
        <LiveProvider
          key={`luxegen-live-${streamResetKey}`}
          code={providerCode}
          noInline
          scope={livePreviewScope}
          enableTypeScript
        >
          <PreviewErrorBoundary
            key={`luxegen-preview-eb-${streamResetKey}`}
            code={providerCode}
            onRecover={handleRecover}
          >
            <div
              className={
                luxeGoldShimmer
                  ? "live-preview-mount flex min-h-[min(20rem,50dvh)] max-h-[min(26rem,65dvh)] flex-col overflow-y-auto overflow-x-auto rounded-2xl border border-[#e5ded3]/90 bg-white p-3 text-zinc-900 shadow-[inset_0_2px_12px_rgba(45,38,28,0.04)] sm:max-h-[26rem] sm:min-h-[20rem] sm:p-4 [&_main]:h-auto [&_main]:min-h-0 [&_main]:max-h-none [&_main]:overflow-visible dark:border-white/12 dark:bg-[#faf9f7] dark:text-zinc-900 dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.65)] [&_.react-live-error]:text-sm [&_.react-live-error]:text-rose-700"
                  : "live-preview-mount flex min-h-[min(20rem,50dvh)] max-h-[min(26rem,65dvh)] flex-col overflow-y-auto overflow-x-auto rounded-2xl border border-white/10 bg-white p-3 text-zinc-900 sm:max-h-[26rem] sm:min-h-[20rem] sm:p-4 [&_main]:h-auto [&_main]:min-h-0 [&_main]:max-h-none [&_main]:overflow-visible [&_.react-live-error]:text-sm [&_.react-live-error]:text-rose-700"
              }
            >
              <FilteredStreamingLiveError
                hideDuringStream={isGenerating}
                className="mb-3 max-h-56 shrink-0 overflow-auto rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-900 dark:border-rose-300/40 dark:bg-rose-950/20 dark:text-rose-200"
              />
              <SafeRender onError={handleRecover}>
                <div className="flex min-h-[12rem] flex-1 flex-col">
                  <TryLivePreview
                    onRenderError={handleRecover}
                    isGenerating={isGenerating}
                    luxeGoldShimmer={luxeGoldShimmer}
                  />
                </div>
              </SafeRender>
            </div>
          </PreviewErrorBoundary>
        </LiveProvider>
      </div>
    </article>
  );
}
