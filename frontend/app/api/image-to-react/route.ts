import { NextResponse } from "next/server";
import { resolveProxyBackendBaseUrl } from "@/lib/server/backend-base-url";
import { fetchWithLocalhostIpv4Fallback } from "@/lib/server/fetch-with-localhost-ipv4-fallback";
import { logUpstreamProxyFailure } from "@/lib/server/log-upstream-failure";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * Proxies multipart POST to Express POST /api/image-to-react so the browser stays same-origin (no CORS).
 */
export async function POST(req: Request): Promise<Response> {
  const base = resolveProxyBackendBaseUrl();
  if (!base) {
    return NextResponse.json(
      {
        error:
          "Server misconfiguration: set BACKEND_URL (or NEXT_PUBLIC_API_URL) so uploads can proxy to the API server.",
      },
      { status: 500 },
    );
  }

  const contentType = req.headers.get("content-type");
  if (!contentType || !contentType.includes("multipart/form-data")) {
    return NextResponse.json(
      { error: 'Expected multipart/form-data with field "image"' },
      { status: 400 },
    );
  }

  const targetUrl = `${base}/api/image-to-react`;

  try {
    const upstream = await fetchWithLocalhostIpv4Fallback(targetUrl, {
      method: "POST",
      headers: {
        "Content-Type": contentType,
      },
      body: req.body,
      duplex: "half",
    } as RequestInit);

    return new NextResponse(upstream.body, {
      status: upstream.status,
      headers: {
        "Content-Type": upstream.headers.get("Content-Type") ?? "application/json",
      },
    });
  } catch (err) {
    const info = logUpstreamProxyFailure("api/image-to-react", targetUrl, err);
    return NextResponse.json(
      {
        error: `Cannot reach ${base} (${info.category}).`,
        failureCategory: info.category,
        failureCode: info.code ?? null,
        ...(process.env.NODE_ENV === "development"
          ? { debug: { targetUrl, detail: info.fullMessage } }
          : {}),
      },
      { status: 502 },
    );
  }
}
