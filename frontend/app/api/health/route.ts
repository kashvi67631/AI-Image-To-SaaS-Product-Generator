import { NextResponse } from "next/server";
import { resolveProxyBackendBaseUrlMetadata } from "@/lib/server/backend-base-url";
import { fetchWithLocalhostIpv4Fallback } from "@/lib/server/fetch-with-localhost-ipv4-fallback";
import {
  describeUpstreamFetchError,
  logUpstreamProxyFailure,
} from "@/lib/server/log-upstream-failure";

export const runtime = "nodejs";

/**
 * Proxies GET /health from Express so the UI can verify BACKEND_URL without CORS.
 * Same base URL as POST /api/generate → `${base}/api/generate`.
 */
export async function GET(): Promise<Response> {
  const { base, source, forced } = resolveProxyBackendBaseUrlMetadata();
  if (!base) {
    console.error("[api/health] missing backend URL — check frontend/.env.local", {
      resolvedSource: source,
      hint: "Set BACKEND_URL=http://127.0.0.1:8080 and restart `next dev` from frontend/",
    });
    return NextResponse.json(
      {
        ok: false,
        error: "Server misconfiguration: set BACKEND_URL (or NEXT_PUBLIC_API_URL).",
        proxy: false,
      },
      { status: 500 },
    );
  }

  const targetUrl = `${base}/health`;
  console.log(
    "[api/health] proxy — base:",
    base,
    "| source:",
    source,
    forced ? "(DEBUG_FORCE_BACKEND_ORIGIN)" : "",
    "| GET:",
    targetUrl,
  );

  try {
    const upstream = await fetchWithLocalhostIpv4Fallback(targetUrl, {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    const text = await upstream.text();
    let parsed: Record<string, unknown> = {};
    try {
      const json = JSON.parse(text) as unknown;
      if (json && typeof json === "object" && !Array.isArray(json)) {
        parsed = json as Record<string, unknown>;
      }
    } catch {
      parsed = { raw: text };
    }

    const body = {
      ...parsed,
      proxyBase: base,
      resolvedFromEnv: source,
      proxyForcedDebug: forced,
      proxyPath: "Same origin as POST /api/generate (BACKEND_URL + /api/generate).",
    };

    return NextResponse.json(body, { status: upstream.status });
  } catch (err) {
    const detail = describeUpstreamFetchError(err);
    const isConnectionRefused =
      detail.code === "ECONNREFUSED" ||
      /\bECONNREFUSED\b|connection refused|connect\s+ECONNREFUSED/i.test(
        detail.fullMessage,
      );

    if (isConnectionRefused) {
      console.error(
        "[api/health] CONNECTION REFUSED — Nothing is accepting TCP on this host/port (Express not reachable from Next.js server-side fetch).",
        "\n  Resolved BACKEND_URL base:",
        base,
        "\n  Attempted GET:",
        targetUrl,
        "(fallback retries localhost as 127.0.0.1 automatically)",
        "\n  code/errno:",
        detail.code ?? "(see technicalDetail)",
        "\n  technicalDetail:",
        detail.fullMessage,
        "\n  Fix checklist:",
        "1) Second terminal: cd gemini-image-to-react-backend && npm run dev",
        "2) Backend log must show: Server running on port 8080 — if another port appears, set BACKEND_URL to http://127.0.0.1:<that-port>",
        "3) frontend/.env.local: BACKEND_URL=http://127.0.0.1:8080 then restart npm run dev in frontend/",
      );
    } else {
      console.error("[api/health] upstream fetch failed", {
        BACKEND_URL_base: base,
        targetUrl,
        source,
        category: detail.category,
        code: detail.code ?? null,
        technicalDetail: detail.fullMessage,
      });
    }

    const info = logUpstreamProxyFailure("api/health", targetUrl, err);
    return NextResponse.json(
      {
        ok: false,
        error: info.fullMessage,
        proxyBase: base,
        resolvedFromEnv: source,
        proxyForcedDebug: forced,
        failureCategory: info.category,
        failureCode: info.code ?? null,
        hint:
          "Start Express (e.g. gemini-image-to-react-backend on PORT 8080). BACKEND_URL in frontend/.env.local must match that origin exactly.",
        ...(process.env.NODE_ENV === "development"
          ? { debug: { targetUrl, resolvedFromEnv: source } }
          : {}),
      },
      { status: 502 },
    );
  }
}
