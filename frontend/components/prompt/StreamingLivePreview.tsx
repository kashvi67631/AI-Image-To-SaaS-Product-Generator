"use client";

import * as React from "react";
import { LiveError, LivePreview, LiveProvider } from "react-live";
import {
  appendMissingDefaultExport,
  analyzePreviewCodeIssues,
  prepareStreamedCodeForLive,
} from "@/lib/live-preview";
import { livePreviewScope } from "@/lib/live-preview-scope";

type PreviewErrorBoundaryProps = {
  code: string;
  children: React.ReactNode;
};

type PreviewErrorBoundaryState = { hasError: boolean };

class PreviewErrorBoundary extends React.Component<
  PreviewErrorBoundaryProps,
  PreviewErrorBoundaryState
> {
  state: PreviewErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): PreviewErrorBoundaryState {
    return { hasError: true };
  }

  componentDidUpdate(prevProps: PreviewErrorBoundaryProps) {
    if (prevProps.code !== this.props.code) {
      this.setState({ hasError: false });
    }
  }

  componentDidCatch(error: Error) {
    console.warn("[StreamingLivePreview] runtime error (often incomplete stream):", error.message);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-[12rem] flex-col items-center justify-center gap-2 rounded-xl border border-amber-200 bg-amber-50 p-4 text-center text-sm text-amber-950 dark:border-amber-300/25 dark:bg-amber-500/5 dark:text-amber-100/90">
          <p>Preview paused — the streamed component is not runnable yet.</p>
          <p className="text-xs text-amber-800/90 dark:text-amber-200/70">
            This is normal while JSX is incomplete. The preview retries automatically as more code arrives.
          </p>
        </div>
      );
    }
    return this.props.children;
  }
}

type StreamingLivePreviewProps = {
  rawCode: string;
  serverBusy?: boolean;
  onServerBusyRetry?: () => void;
  forceRender?: boolean;
};

export function StreamingLivePreview({
  rawCode,
  serverBusy = false,
  onServerBusyRetry,
  forceRender = false,
}: StreamingLivePreviewProps) {
  const normalizedRawCode = React.useMemo(() => appendMissingDefaultExport(rawCode), [rawCode]);
  const liveCode = React.useMemo(
    () => prepareStreamedCodeForLive(normalizedRawCode, { forceRender }),
    [normalizedRawCode, forceRender],
  );
  const diagnostics = React.useMemo(
    () => analyzePreviewCodeIssues(normalizedRawCode),
    [normalizedRawCode],
  );

  if (serverBusy) {
    return (
      <article className="overflow-hidden rounded-2xl border border-zinc-200/90 bg-white shadow-sm dark:border-white/10 dark:bg-[#0b0b0e] dark:shadow-none">
        <div className="flex items-center justify-between border-b border-zinc-200/90 px-4 py-2 dark:border-white/10">
          <span className="text-xs text-zinc-600 dark:text-zinc-400">Live preview (streaming)</span>
        </div>
        <div className="flex min-h-[28rem] flex-col items-center justify-center gap-4 p-8 text-center">
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
    <article className="overflow-hidden rounded-2xl border border-zinc-200/90 bg-white shadow-sm dark:border-white/10 dark:bg-[#0b0b0e] dark:shadow-none">
      <div className="border-b border-zinc-200/90 px-4 py-2 text-xs text-zinc-600 dark:border-white/10 dark:text-zinc-400">
        Live preview (streaming)
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
        <LiveProvider
          code={liveCode}
          noInline
          scope={livePreviewScope}
          enableTypeScript
        >
          <PreviewErrorBoundary code={`${normalizedRawCode}:${forceRender ? "1" : "0"}`}>
            <div className="max-h-[26rem] min-h-[20rem] overflow-y-auto overflow-x-hidden rounded-2xl border border-white/10 bg-white p-4 text-black [&_main]:h-auto [&_main]:min-h-0 [&_main]:max-h-none [&_main]:overflow-visible">
              <LivePreview />
            </div>
          </PreviewErrorBoundary>
          <LiveError className="mt-3 max-h-40 overflow-auto rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800 dark:border-rose-300/40 dark:bg-rose-950/10 dark:text-rose-300" />
        </LiveProvider>
      </div>
    </article>
  );
}
