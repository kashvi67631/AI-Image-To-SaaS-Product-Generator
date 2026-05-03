"use client";

import * as React from "react";
import { LiveContext, LivePreview, LiveProvider } from "react-live";
import {
  LIVE_PREVIEW_WAITING_CODE,
  appendMissingDefaultExport,
  analyzePreviewCodeIssues,
  isPlaceholderOrWaitingLiveCode,
  prepareStreamedCodeForLive,
} from "@/lib/live-preview";
import { livePreviewScope } from "@/lib/live-preview-scope";
import {
  isLikelyTranspileSyntaxError,
  isLivePreviewCodeCompilable,
} from "@/lib/live-preview-compile-check";
import { luxeSerif } from "@/lib/fonts/luxe-serif";

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
    console.warn("[StreamingLivePreview] runtime error (often incomplete stream):", error.message);
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
    console.warn("[SafeRender] guarded partial render error:", error.message);
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

function TryLivePreview(props: { onRenderError: () => void }): React.ReactElement | null {
  try {
    return <LivePreview />;
  } catch (err) {
    console.warn("[TryLivePreview] render guard:", err);
    props.onRenderError();
    return null;
  }
}

function FilteredStreamingLiveError(props: { className?: string }): React.ReactElement | null {
  const { error } = React.useContext(LiveContext);
  if (!error) {
    return null;
  }
  if (isLikelyTranspileSyntaxError(error)) {
    return null;
  }
  return <pre className={props.className}>{error}</pre>;
}

type StreamingLivePreviewProps = {
  rawCode: string;
  serverBusy?: boolean;
  onServerBusyRetry?: () => void;
  forceRender?: boolean;
  isGenerating?: boolean;
  /** Shown under the shimmer while generating or waiting on capacity retries */
  polishingMessage?: string;
  /** Gold mesh shimmer + typography for the luxe /generate workspace. */
  luxeGoldShimmer?: boolean;
};

const DEFAULT_POLISH_MESSAGE = "Polishing your luxury components...";

export function StreamingLivePreview({
  rawCode,
  serverBusy = false,
  onServerBusyRetry,
  forceRender = false,
  isGenerating = false,
  polishingMessage = DEFAULT_POLISH_MESSAGE,
  luxeGoldShimmer = false,
}: StreamingLivePreviewProps) {
  const barShimmer = luxeGoldShimmer ? "luxe-gold-shimmer" : "shimmer-block";
  const normalizedRawCode = React.useMemo(
    () =>
      appendMissingDefaultExport(rawCode, {
        permissive: Boolean(forceRender || isGenerating),
      }),
    [rawCode, forceRender, isGenerating],
  );
  const candidateLiveCode = React.useMemo(
    () =>
      prepareStreamedCodeForLive(normalizedRawCode, {
        forceRender: forceRender || isGenerating,
      }),
    [normalizedRawCode, forceRender, isGenerating],
  );

  const lastStableLiveRef = React.useRef<string | null>(null);
  const [providerCode, setProviderCode] = React.useState(LIVE_PREVIEW_WAITING_CODE);

  React.useEffect(() => {
    if (!rawCode.trim()) {
      if (isGenerating) {
        if (lastStableLiveRef.current) {
          setProviderCode(lastStableLiveRef.current);
          return;
        }
        setProviderCode(LIVE_PREVIEW_WAITING_CODE);
        return;
      }
      lastStableLiveRef.current = null;
      setProviderCode(LIVE_PREVIEW_WAITING_CODE);
      return;
    }

    const next = candidateLiveCode;
    if (isPlaceholderOrWaitingLiveCode(next)) {
      if (
        lastStableLiveRef.current &&
        !isPlaceholderOrWaitingLiveCode(lastStableLiveRef.current)
      ) {
        setProviderCode(lastStableLiveRef.current);
        return;
      }
    } else if (!isLivePreviewCodeCompilable(next)) {
      if (
        lastStableLiveRef.current &&
        !isPlaceholderOrWaitingLiveCode(lastStableLiveRef.current)
      ) {
        setProviderCode(lastStableLiveRef.current);
        return;
      }
      setProviderCode(LIVE_PREVIEW_WAITING_CODE);
      return;
    }

    setProviderCode(next);
    if (!isPlaceholderOrWaitingLiveCode(next)) {
      lastStableLiveRef.current = next;
    }
  }, [candidateLiveCode, rawCode, isGenerating]);

  const handleRecover = React.useCallback(() => {
    if (lastStableLiveRef.current) {
      setProviderCode(lastStableLiveRef.current);
    }
  }, []);

  const diagnostics = React.useMemo(
    () => analyzePreviewCodeIssues(normalizedRawCode),
    [normalizedRawCode],
  );
  /** Skeleton only while busy/streaming, or when code exists but live provider is still on a placeholder. */
  const showShimmer =
    serverBusy ||
    isGenerating ||
    (Boolean(rawCode.trim()) && isPlaceholderOrWaitingLiveCode(providerCode));

  if (serverBusy) {
    return (
      <article className="overflow-hidden rounded-2xl border border-zinc-200/90 bg-white shadow-sm dark:border-white/10 dark:bg-[#0b0b0e] dark:shadow-none">
        <div className="flex items-center justify-between border-b border-zinc-200/90 px-4 py-2 dark:border-white/10">
          <span className="text-xs text-zinc-600 dark:text-zinc-400">Live preview (streaming)</span>
        </div>
        <div className="flex min-h-[28rem] flex-col items-center justify-center gap-4 p-8 text-center">
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
          ? "luxe-thinkhall-surface overflow-hidden rounded-2xl border border-[#d4af37]/32 bg-gradient-to-b from-white to-[#fbf6ed] dark:border-[#fccf45]/22 dark:from-[#12100e] dark:to-[#0a0908]"
          : "overflow-hidden rounded-2xl border border-zinc-200/90 bg-white shadow-sm dark:border-white/10 dark:bg-[#0b0b0e] dark:shadow-none"
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
      <div className="min-h-[28rem] p-4">
        {!diagnostics.hasDefaultExport && rawCode.trim() && !forceRender ? (
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
          code={providerCode}
          noInline
          scope={livePreviewScope}
          enableTypeScript
        >
          <PreviewErrorBoundary code={providerCode} onRecover={handleRecover}>
            <div
              className={
                luxeGoldShimmer
                  ? "max-h-[26rem] min-h-[20rem] overflow-y-auto overflow-x-hidden rounded-2xl border border-[#e5ded3]/90 bg-white p-4 text-black shadow-[inset_0_2px_12px_rgba(45,38,28,0.04)] [&_main]:h-auto [&_main]:min-h-0 [&_main]:max-h-none [&_main]:overflow-visible dark:border-white/12 dark:bg-[#faf9f7] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.65)]"
                  : "max-h-[26rem] min-h-[20rem] overflow-y-auto overflow-x-hidden rounded-2xl border border-white/10 bg-white p-4 text-black [&_main]:h-auto [&_main]:min-h-0 [&_main]:max-h-none [&_main]:overflow-visible"
              }
            >
              {!showShimmer ? (
                <SafeRender onError={handleRecover}>
                  <TryLivePreview onRenderError={handleRecover} />
                </SafeRender>
              ) : null}
            </div>
          </PreviewErrorBoundary>
          {!providerCode.includes("Optimizing Code...") && !showShimmer ? (
            <FilteredStreamingLiveError className="mt-3 max-h-40 overflow-auto rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800 dark:border-rose-300/40 dark:bg-rose-950/10 dark:text-rose-300" />
          ) : null}
        </LiveProvider>
      </div>
    </article>
  );
}
