import { NextResponse } from "next/server";
import {
  DEBUG_FORCE_BACKEND_ORIGIN,
  getBackendBaseUrlMetadata,
  resolveProxyBackendBaseUrlMetadata,
} from "@/lib/server/backend-base-url";

export const runtime = "nodejs";

const TARGET = "http://127.0.0.1:8080/health";

function serializeFetchError(err: unknown): Record<string, unknown> {
  if (!(err instanceof Error)) {
    return { errorMessage: String(err) };
  }
  const e = err as Error & { code?: string; errno?: number; syscall?: string };
  const cause = err.cause;
  let causeSerialized: Record<string, unknown> | string | undefined;
  let causeErrno: number | undefined;
  let causeAddress: string | undefined;
  let causePort: number | undefined;
  if (cause instanceof Error) {
    const c = cause as Error &
      NodeJS.ErrnoException & { address?: string; port?: number };
    causeErrno = c.errno;
    causeAddress = c.address;
    causePort = c.port;
    causeSerialized = {
      name: cause.name,
      message: cause.message,
      code: c.code,
      errno: c.errno,
      syscall: c.syscall,
      address: c.address,
      port: c.port,
    };
  } else if (cause !== undefined) {
    causeSerialized = String(cause);
  }
  return {
    errorName: e.name,
    errorMessage: e.message,
    code: e.code,
    errno: e.errno ?? causeErrno,
    syscall: e.syscall,
    address: causeAddress,
    port: causePort,
    cause: causeSerialized,
    stack: process.env.NODE_ENV === "development" ? e.stack : undefined,
  };
}

/**
 * Temporary diagnostic: hardcoded IPv4 backend health probe.
 * Open GET /api/test-direct — inspect JSON for ECONNREFUSED vs EPERM etc.
 */
export async function GET() {
  const envProbe =
    process.env.NODE_ENV === "development"
      ? {
          processEnvBACKEND_URL: process.env.BACKEND_URL ?? "(unset)",
          DEBUG_FORCE_BACKEND_ORIGIN: DEBUG_FORCE_BACKEND_ORIGIN ?? "(null)",
          envDerivedBase: getBackendBaseUrlMetadata(),
          resolveProxy: resolveProxyBackendBaseUrlMetadata(),
        }
      : undefined;

  try {
    const res = await fetch(TARGET, {
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    const text = await res.text();
    return NextResponse.json({
      ok: true,
      targetUrl: TARGET,
      upstreamStatus: res.status,
      upstreamHeaders: Object.fromEntries(res.headers.entries()),
      bodyPreview: text.slice(0, 4_096),
      ...(envProbe ? { envProbe } : {}),
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        targetUrl: TARGET,
        ...serializeFetchError(err),
        ...(envProbe ? { envProbe } : {}),
      },
      { status: 200 },
    );
  }
}
