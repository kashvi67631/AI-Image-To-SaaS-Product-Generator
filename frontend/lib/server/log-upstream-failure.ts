/**
 * Formats undici/Node fetch errors (TypeError: fetch failed + ECONNREFUSED in cause).
 * Use in Next.js API route catch blocks so the dev terminal shows why the proxy failed.
 */
export function describeUpstreamFetchError(err: unknown): {
  /** Short category for UI / JSON */
  category: string;
  /** errno-style code when present (e.g. ECONNREFUSED) */
  code: string | undefined;
  /** Full detail for logs */
  fullMessage: string;
} {
  if (!(err instanceof Error)) {
    return {
      category: "unknown",
      code: undefined,
      fullMessage: String(err),
    };
  }

  const pieces: string[] = [`${err.name}: ${err.message}`];
  let code: string | undefined =
    (err as NodeJS.ErrnoException).code ??
    (typeof err.cause === "object" &&
    err.cause !== null &&
    "code" in err.cause &&
    typeof (err.cause as { code?: string }).code === "string"
      ? (err.cause as { code: string }).code
      : undefined);

  if (err.cause instanceof Error) {
    pieces.push(`cause: ${err.cause.name}: ${err.cause.message}`);
    const c = err.cause as NodeJS.ErrnoException;
    if (!code && c.code) {
      code = c.code;
    }
  } else if (err.cause !== undefined && err.cause !== null) {
    pieces.push(`cause: ${String(err.cause)}`);
  }

  const errno = (err as NodeJS.ErrnoException).errno;
  if (typeof errno === "number") {
    pieces.push(`errno: ${errno}`);
  }

  let category: string;
  switch (code) {
    case "ECONNREFUSED":
      category =
        "connection_refused (no server on that host:port — wrong PORT or Express not running)";
      break;
    case "ETIMEDOUT":
      category = "timeout (host slow or firewall / wrong host)";
      break;
    case "ENOTFOUND":
      category = "dns_not_found (check hostname in BACKEND_URL)";
      break;
    case "ECONNRESET":
      category = "connection_reset (peer closed connection)";
      break;
    default:
      if (/timeout/i.test(err.message)) {
        category = "timeout";
      } else if (/fetch failed/i.test(err.message) && !code) {
        category = "fetch_failed (see cause chain)";
      } else {
        category = "error";
      }
  }

  return {
    category,
    code,
    fullMessage: pieces.join(" | "),
  };
}

export function logUpstreamProxyFailure(
  routeLabel: string,
  targetUrl: string,
  err: unknown,
): ReturnType<typeof describeUpstreamFetchError> {
  const info = describeUpstreamFetchError(err);
  console.error(`[${routeLabel}] upstream fetch failed → ${targetUrl}`, {
    category: info.category,
    code: info.code ?? null,
    detail: info.fullMessage,
    stack: err instanceof Error ? err.stack : undefined,
  });
  return info;
}
