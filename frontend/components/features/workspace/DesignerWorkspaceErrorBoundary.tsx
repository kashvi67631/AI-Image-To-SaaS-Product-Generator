"use client";

import * as React from "react";
import { devWarn } from "@/lib/dev-log";
import {
  buildWorkspaceIssueReport,
  copyWorkspaceIssueReportToClipboard,
} from "@/lib/workspace-diagnostics";

type DesignerWorkspaceErrorBoundaryProps = {
  children: React.ReactNode;
};

type OkState = { hasError: false };
type ErrState = {
  hasError: true;
  error: Error;
  componentStack: string | null;
  reportCopied: boolean;
  reportError: string | null;
};
type BoundaryState = OkState | ErrState;

export class DesignerWorkspaceErrorBoundary extends React.Component<
  DesignerWorkspaceErrorBoundaryProps,
  BoundaryState
> {
  state: BoundaryState = { hasError: false };

  static getDerivedStateFromError(error: Error): ErrState {
    return {
      hasError: true,
      error,
      componentStack: null,
      reportCopied: false,
      reportError: null,
    };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    if (process.env.NODE_ENV === "development") {
      console.error("[DesignerWorkspaceErrorBoundary]", error, errorInfo.componentStack);
    } else {
      devWarn("[DesignerWorkspaceErrorBoundary] workspace error (copy diagnostics from UI)");
    }
    this.setState((prev) =>
      prev.hasError ? { ...prev, componentStack: errorInfo.componentStack ?? null } : prev,
    );
  }

  private handleReset = (): void => {
    this.setState({ hasError: false });
  };

  private handleReportIssue = async (): Promise<void> => {
    if (!this.state.hasError) {
      return;
    }
    try {
      const report = buildWorkspaceIssueReport(this.state.error, {
        componentStack: this.state.componentStack,
      });
      await copyWorkspaceIssueReportToClipboard(report);
      this.setState((s) =>
        s.hasError ? { ...s, reportCopied: true, reportError: null } : s,
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Copy failed";
      this.setState((s) => (s.hasError ? { ...s, reportError: msg } : s));
    }
  };

  render(): React.ReactNode {
    if (!this.state.hasError) {
      return this.props.children;
    }

    const { error, reportCopied, reportError } = this.state;

    return (
      <div className="flex min-h-[min(60vh,28rem)] flex-col items-center justify-center gap-4 rounded-2xl border border-amber-200/80 bg-amber-50/90 px-6 py-10 text-center dark:border-amber-400/25 dark:bg-amber-950/25">
        <h2 className="text-lg font-semibold text-amber-950 dark:text-amber-100">
          Something went wrong in the workspace
        </h2>
        <p className="max-w-md text-sm text-amber-900/90 dark:text-amber-200/85">
          The rest of the app should still work. Reset the workspace or copy a diagnostic report
          (includes the latest streamed code snapshot) for bug reports.
        </p>
        {process.env.NODE_ENV === "development" ? (
          <pre className="max-h-32 max-w-full overflow-auto rounded-lg bg-amber-100/80 p-2 text-left text-xs whitespace-pre-wrap text-amber-950 dark:bg-amber-950/40 dark:text-amber-100/90">
            {error.message}
          </pre>
        ) : null}
        <div className="flex flex-wrap items-center justify-center gap-2">
          <button
            type="button"
            onClick={this.handleReset}
            className="rounded-xl bg-amber-700 px-4 py-2 text-sm font-medium text-white transition hover:bg-amber-800 dark:bg-amber-600 dark:hover:bg-amber-500"
          >
            Reset workspace view
          </button>
          <button
            type="button"
            onClick={() => void this.handleReportIssue()}
            className="rounded-xl border border-amber-800/30 bg-white px-4 py-2 text-sm font-medium text-amber-950 transition hover:bg-amber-100/80 dark:border-amber-400/30 dark:bg-amber-900/40 dark:text-amber-50 dark:hover:bg-amber-900/60"
          >
            Report issue (copy diagnostics)
          </button>
        </div>
        {reportCopied ? (
          <p className="text-xs font-medium text-emerald-800 dark:text-emerald-300">
            Copied diagnostic JSON to clipboard.
          </p>
        ) : null}
        {reportError ? (
          <p className="text-xs text-rose-700 dark:text-rose-300">{reportError}</p>
        ) : null}
      </div>
    );
  }
}
