import { devWarn } from "@/lib/dev-log";
import { fetchWithLocalhostIpv4Fallback } from "@/lib/server/fetch-with-localhost-ipv4-fallback";
import { describeUpstreamFetchError } from "@/lib/server/log-upstream-failure";

/** When Express starts after Next, brief ECONNREFUSED retries avoid false "unreachable" errors. */
const ECONNREFUSED_RETRY_DELAYS_MS = [600, 1400, 2800] as const;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Same as {@link fetchWithLocalhostIpv4Fallback}, but retries a few times if nothing is listening yet.
 */
export async function fetchBackendWithEconnrefusedRetries(
  url: string,
  init?: RequestInit,
  routeLabel?: string,
): Promise<Response> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= ECONNREFUSED_RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      return await fetchWithLocalhostIpv4Fallback(url, init);
    } catch (err) {
      lastErr = err;
      const { code } = describeUpstreamFetchError(err);
      const canRetry =
        code === "ECONNREFUSED" && attempt < ECONNREFUSED_RETRY_DELAYS_MS.length;
      if (!canRetry) {
        throw err;
      }
      const waitMs = ECONNREFUSED_RETRY_DELAYS_MS[attempt];
      const tag = routeLabel ? `[${routeLabel}] ` : "";
      devWarn(
        `${tag}upstream ECONNREFUSED — retry in ${waitMs}ms (${attempt + 1}/${ECONNREFUSED_RETRY_DELAYS_MS.length})`,
      );
      await sleep(waitMs);
    }
  }
  throw lastErr;
}
