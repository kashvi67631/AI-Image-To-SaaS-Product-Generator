import { devLog } from "@/lib/dev-log";
import { describeUpstreamFetchError } from "@/lib/server/log-upstream-failure";

/**
 * Node may resolve `localhost` to ::1 while Express listens on IPv4 only — retry via 127.0.0.1 once.
 */
export async function fetchWithLocalhostIpv4Fallback(
  url: string,
  init?: RequestInit,
): Promise<Response> {
  const logFailure = (failedUrl: string, err: unknown, phase: string): void => {
    const detail = describeUpstreamFetchError(err);
    console.error(`[upstream-fetch] ${phase} — connection failed`, {
      attemptedUrl: failedUrl,
      category: detail.category,
      code: detail.code ?? null,
      detail: detail.fullMessage,
      hint:
        process.env.NODE_ENV === "development"
          ? "Confirm Express is listening (e.g. http://127.0.0.1:8080) and BACKEND_URL in frontend/.env.local matches."
          : undefined,
    });
  };

  try {
    return await fetch(url, init);
  } catch (err) {
    logFailure(url, err, "primary");

    let ipv4Url: string | null = null;
    try {
      const u = new URL(url);
      if (u.hostname === "localhost") {
        u.hostname = "127.0.0.1";
        ipv4Url = u.toString();
      }
    } catch {
      /* keep null */
    }

    if (ipv4Url) {
      devLog("[upstream-fetch] retrying with 127.0.0.1", {
        from: url,
        to: ipv4Url,
      });
      try {
        return await fetch(ipv4Url, init);
      } catch (err2) {
        logFailure(ipv4Url, err2, "ipv4-retry");
        throw err2;
      }
    }

    throw err;
  }
}
