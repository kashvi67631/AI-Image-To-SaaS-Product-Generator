import { NextResponse } from "next/server";
import { resolveProxyBackendBaseUrlMetadata } from "@/lib/server/backend-base-url";
import { fetchWithLocalhostIpv4Fallback } from "@/lib/server/fetch-with-localhost-ipv4-fallback";
import { logUpstreamProxyFailure } from "@/lib/server/log-upstream-failure";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * Proxies JSON body to the backend POST /api/generate and streams plain text back.
 * No GEMINI_API_KEY in this Next.js process — key stays on the backend only.
 */
export async function POST(req: Request): Promise<Response> {
  const { base, source, forced } = resolveProxyBackendBaseUrlMetadata();
  if (process.env.NODE_ENV === "development") {
    console.log("[api/generate] upstream base:", base, "| source:", source, forced ? "| DEBUG_FORCE" : "");
  }
  if (!base) {
    return NextResponse.json(
      {
        error:
          "Server misconfiguration: set BACKEND_URL (or NEXT_PUBLIC_API_URL) so prompt generation can proxy to the API server.",
      },
      { status: 500 },
    );
  }

  let bodyText: string;
  try {
    bodyText = await req.text();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  let upstream: Response;
  const generateUrl = `${base}/api/generate`;
  try {
    upstream = await fetchWithLocalhostIpv4Fallback(generateUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/plain, application/json",
      },
      body: bodyText,
    });
  } catch (err) {
    const info = logUpstreamProxyFailure("api/generate", generateUrl, err);
    return NextResponse.json(
      {
        error: `Cannot reach ${base} (${info.category}). Start Express on the same port as BACKEND_URL.`,
        failureCategory: info.category,
        failureCode: info.code ?? null,
        ...(process.env.NODE_ENV === "development"
          ? { debug: { targetUrl: generateUrl, detail: info.fullMessage } }
          : {}),
      },
      { status: 502 },
    );
  }

  if (!upstream.ok) {
    const errText = await upstream.text();
    return new NextResponse(errText, {
      status: upstream.status,
      headers: {
        "Content-Type": upstream.headers.get("Content-Type") ?? "application/json",
      },
    });
  }

  const contentType =
    upstream.headers.get("Content-Type") ?? "text/plain; charset=utf-8";
  const outHeaders = new Headers();
  outHeaders.set("Content-Type", contentType);
  outHeaders.set("Cache-Control", "no-store");
  /** Helps reverse proxies stream chunks instead of buffering the full body. */
  outHeaders.set("X-Accel-Buffering", "no");

  return new Response(upstream.body, {
    headers: outHeaders,
  });
}
