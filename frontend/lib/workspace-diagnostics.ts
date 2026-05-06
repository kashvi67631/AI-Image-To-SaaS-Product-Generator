import { isDevEnvironment } from "@/lib/dev-log";

/** sessionStorage key: last streamed TSX from the workspace (truncated). */
export const WORKSPACE_STREAM_SNAPSHOT_KEY = "luxegen:lastStreamedCode";
/** Last string passed to react-live (prepared), for transpile/runtime diagnostics. */
export const WORKSPACE_PREVIEW_PROVIDER_KEY = "luxegen:lastPreviewProviderCode";

const MAX_STREAM_SNAPSHOT_CHARS = 14_000;
const MAX_PREVIEW_SNAPSHOT_CHARS = 4_000;

export function persistStreamSnapshotForDiagnostics(code: string): void {
  if (typeof window === "undefined" || !code) {
    return;
  }
  try {
    const slice =
      code.length > MAX_STREAM_SNAPSHOT_CHARS
        ? code.slice(code.length - MAX_STREAM_SNAPSHOT_CHARS)
        : code;
    sessionStorage.setItem(WORKSPACE_STREAM_SNAPSHOT_KEY, slice);
  } catch {
    /* quota / private mode */
  }
}

export function persistPreviewProviderCodeForDiagnostics(code: string): void {
  if (typeof window === "undefined" || !code.trim()) {
    return;
  }
  try {
    const slice =
      code.length > MAX_PREVIEW_SNAPSHOT_CHARS
        ? code.slice(code.length - MAX_PREVIEW_SNAPSHOT_CHARS)
        : code;
    sessionStorage.setItem(WORKSPACE_PREVIEW_PROVIDER_KEY, slice);
  } catch {
    /* quota / private mode */
  }
}

export type WorkspaceIssueReport = {
  reportedAt: string;
  url: string;
  userAgent: string;
  message: string;
  /** Present in development only. */
  componentStack?: string;
  lastStreamedCodeExcerpt: string | null;
  /** Last react-live `code` prop (truncated). */
  lastPreviewProviderExcerpt: string | null;
};

export function readStreamSnapshotFromStorage(): string | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    return sessionStorage.getItem(WORKSPACE_STREAM_SNAPSHOT_KEY);
  } catch {
    return null;
  }
}

function readPreviewProviderFromStorage(): string | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    return sessionStorage.getItem(WORKSPACE_PREVIEW_PROVIDER_KEY);
  } catch {
    return null;
  }
}

export function buildWorkspaceIssueReport(
  error: Error,
  errorInfo: { componentStack?: string | null },
): WorkspaceIssueReport {
  return {
    reportedAt: new Date().toISOString(),
    url: typeof window !== "undefined" ? window.location.href : "",
    userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "",
    message: error.message,
    ...(isDevEnvironment ? { componentStack: errorInfo.componentStack ?? undefined } : {}),
    lastStreamedCodeExcerpt: readStreamSnapshotFromStorage(),
    lastPreviewProviderExcerpt: readPreviewProviderFromStorage(),
  };
}

export async function copyWorkspaceIssueReportToClipboard(
  report: WorkspaceIssueReport,
): Promise<void> {
  const text = JSON.stringify(report, null, 2);
  await navigator.clipboard.writeText(text);
}
