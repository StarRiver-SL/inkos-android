import { isEmbeddedNodeMode } from "./mobile-runtime";

const API_PATH_BASE = "/api/v1";
const DEFAULT_PRODUCTION_API_ORIGIN = "https://inkos.christmas.qzz.io";

function trimTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, "");
}

/**
 * Returns the API origin for non-native (web) builds.
 * On Android, the LocalAssetServer reverse-proxies /api/* to the Node backend,
 * so we return an empty string to produce same-origin relative URLs.
 */
export function getApiOrigin(): string {
  if (isEmbeddedNodeMode()) {
    // Use relative paths — the Capacitor local asset server (port 4568) proxies
    // /api/* to the Node backend (port 4567), avoiding cross-origin CORS issues
    // with GeckoView's strict Same-Origin Policy.
    return "";
  }

  const envOrigin = String(import.meta.env.VITE_INKOS_API_ORIGIN ?? "").trim();
  if (envOrigin) {
    return trimTrailingSlashes(envOrigin);
  }

  return import.meta.env.PROD ? DEFAULT_PRODUCTION_API_ORIGIN : "";
}

/**
 * Returns the direct SSE origin for real-time event streams.
 * On Android, NanoHTTPD's response buffering delays SSE event delivery.
 * Connecting directly to the Node backend on port 4567 bypasses this.
 */
export function getSseOrigin(): string {
  if (isEmbeddedNodeMode()) {
    return "http://127.0.0.1:4567";
  }
  return getApiOrigin();
}

export function buildApiUrl(path: string): string | null {
  const normalized = String(path ?? "").trim();
  if (!normalized) return null;

  const apiOrigin = getApiOrigin();
  const apiBase = `${apiOrigin}${API_PATH_BASE}`;

  if (/^https?:\/\//i.test(normalized)) {
    return normalized;
  }

  if (normalized.startsWith(`${API_PATH_BASE}/`) || normalized === API_PATH_BASE) {
    return `${apiOrigin}${normalized}`;
  }

  const pathWithSlash = normalized.startsWith("/") ? normalized : `/${normalized}`;
  return `${apiBase}${pathWithSlash}`;
}
