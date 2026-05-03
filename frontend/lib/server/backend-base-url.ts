/**
 * Express backend origin only (no path). Used by Next.js API routes that proxy to gemini-image-to-react-backend.
 *
 * Env: set in `frontend/.env.local`, e.g. `BACKEND_URL=http://127.0.0.1:8080` (prefer IPv4 over `localhost` for Node fetch).
 * If you still use `http://localhost:8080`, it is normalized to `http://127.0.0.1:8080` here.
 * Restart `next dev` after changes.
 */
export type BackendUrlEnvKey =
  | "BACKEND_URL"
  | "INTERNAL_BACKEND_URL"
  | "LUXEGEN_BACKEND_URL"
  | "NEXT_PUBLIC_API_URL"
  | null;

/**
 * When non-null, Next.js API route proxies use this origin instead of env (`BACKEND_URL`, etc.).
 * Temporary local debugging aid — set to `null` after confirming `.env.local` loads (run `next dev` from `frontend/`).
 */
export const DEBUG_FORCE_BACKEND_ORIGIN: string | null = null;

export type ProxyResolutionSource = BackendUrlEnvKey | "__DEBUG_FORCE_BACKEND__";

/** Map localhost → 127.0.0.1 to reduce IPv6 (::1) vs IPv4 connection_refused issues. */
function preferIpv4LocalhostBase(base: string): string {
  const trimmed = base.replace(/\/$/, "");
  try {
    const u = new URL(trimmed);
    if (u.hostname === "localhost") {
      u.hostname = "127.0.0.1";
    }
    return `${u.protocol}//${u.host}`;
  } catch {
    return trimmed;
  }
}

export function getBackendBaseUrlMetadata(): {
  base: string | null;
  /** First env key that supplied the base URL (priority order). */
  envKey: BackendUrlEnvKey;
} {
  const explicitBackends = [
    ["BACKEND_URL", process.env.BACKEND_URL] as const,
    ["INTERNAL_BACKEND_URL", process.env.INTERNAL_BACKEND_URL] as const,
    ["LUXEGEN_BACKEND_URL", process.env.LUXEGEN_BACKEND_URL] as const,
  ];
  for (const [key, raw] of explicitBackends) {
    const t = raw?.trim();
    if (t) {
      return { base: preferIpv4LocalhostBase(t), envKey: key };
    }
  }

  const pub = process.env.NEXT_PUBLIC_API_URL?.trim();
  if (!pub) {
    return { base: null, envKey: null };
  }
  try {
    const u = new URL(pub);
    return {
      base: preferIpv4LocalhostBase(`${u.protocol}//${u.host}`),
      envKey: "NEXT_PUBLIC_API_URL",
    };
  } catch {
    return { base: null, envKey: null };
  }
}

export function getBackendBaseUrl(): string | null {
  return getBackendBaseUrlMetadata().base;
}

/** Prefer {@link DEBUG_FORCE_BACKEND_ORIGIN} when set; otherwise same as {@link getBackendBaseUrlMetadata}. */
export function resolveProxyBackendBaseUrlMetadata(): {
  base: string | null;
  source: ProxyResolutionSource | null;
  forced: boolean;
} {
  const forced = DEBUG_FORCE_BACKEND_ORIGIN?.trim();
  if (forced) {
    return {
      base: preferIpv4LocalhostBase(forced),
      source: "__DEBUG_FORCE_BACKEND__",
      forced: true,
    };
  }
  const { base, envKey } = getBackendBaseUrlMetadata();
  return { base, source: envKey, forced: false };
}

export function resolveProxyBackendBaseUrl(): string | null {
  return resolveProxyBackendBaseUrlMetadata().base;
}
