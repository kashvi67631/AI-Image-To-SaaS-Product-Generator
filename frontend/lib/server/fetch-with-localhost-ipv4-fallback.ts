import { describeUpstreamFetchError } from "@/lib/server/log-upstream-failure";

/**
 * Node may resolve `localhost` to ::1 while Express listens on IPv4 only — retry via 127.0.0.1 once.
 */
export async function fetchWithLocalhostIpv4Fallback(
  url: string,
  init?: RequestInit,
): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (err) {
    let ipv4Url: string;
    try {
      const u = new URL(url);
      if (u.hostname !== "localhost") {
        throw err;
      }
      u.hostname = "127.0.0.1";
      ipv4Url = u.toString();
    } catch {
      throw err;
    }

    console.warn("[upstream-fetch] localhost failed — retrying with 127.0.0.1", {
      failedUrl: url,
      ipv4Url,
      error: describeUpstreamFetchError(err).fullMessage,
    });

    return await fetch(ipv4Url, init);
  }
}
