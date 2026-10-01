// Minimal stand-in for the openclaw plugin SDK, so index.js can be tested
// without installing the ~400 MB host package. Behavior mirrors the pieces of
// openclaw@2026.9.x that index.js relies on (error shape, config merging,
// cache, endpoint wrapper). Tests drive HTTP through globalThis.__baiduFetch.

export const DEFAULT_SEARCH_COUNT = 5;

export const definePluginEntry = (entry) => entry;
export const createWebSearchProviderContractFields = () => ({});
export const isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);

export function resolveProviderWebSearchPluginConfig(config, pluginId) {
  const webSearch = config?.plugins?.entries?.[pluginId]?.config?.webSearch;
  return isRecord(webSearch) ? webSearch : undefined;
}

// Same semantics as the SDK: top-level apiKey is dropped, plugin apiKey is
// mirrored back when requested.
export function mergeScopedSearchConfig(searchConfig, key, pluginConfig, options) {
  const next = { ...searchConfig };
  delete next.apiKey;
  if (!pluginConfig) return Object.keys(next).length > 0 ? next : undefined;
  next[key] = { ...pluginConfig };
  if (options?.mirrorApiKeyToTopLevel && pluginConfig.apiKey !== undefined) next.apiKey = pluginConfig.apiKey;
  return next;
}

// ProviderHttpError shape: status/statusCode, code from the JSON body,
// retryAfterMs from the Retry-After header, no headers property.
export async function assertOkOrThrowProviderError(response, label) {
  if (response.ok) return;
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {}
  const retryAfter = response.headers.get("Retry-After");
  const err = new Error(`${label} (${response.status})${body?.message ? `: ${body.message}` : ""}`);
  err.name = "ProviderHttpError";
  err.status = response.status;
  err.statusCode = response.status;
  err.code = body?.code;
  err.retryAfterMs = retryAfter && /^\d+$/.test(retryAfter) ? Number(retryAfter) * 1000 : undefined;
  throw err;
}

export const readProviderJsonResponse = (response) => response.json();

const cache = new Map();
export const buildSearchCacheKey = (parts) => parts.join("\u0000");
export function readCachedSearchPayload(key) {
  const entry = cache.get(key);
  return entry && entry.expiresAt > Date.now() ? entry.value : null;
}
export function writeCachedSearchPayload(key, value, ttlMs) {
  if (ttlMs > 0) cache.set(key, { value, expiresAt: Date.now() + ttlMs });
}
export const __clearCache = () => cache.clear();

export function parseWebSearchTimeFilters(params) {
  const freshness = params.rawFreshness?.trim() || undefined;
  const dateAfter = params.rawDateAfter?.trim() || undefined;
  const dateBefore = params.rawDateBefore?.trim() || undefined;
  if (freshness && (dateAfter || dateBefore)) {
    return { error: "conflicting_time_filters", message: params.conflictingTimeFiltersMessage, docs: params.docs };
  }
  return { freshness, dateAfter, dateBefore };
}

export const readConfiguredSecretString = (value) =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;
export const readProviderEnvValue = (names) => names.map((n) => process.env[n]?.trim()).find(Boolean);

export function readStringParam(params, key, { required } = {}) {
  const value = params?.[key];
  if (typeof value !== "string" || !value.trim()) {
    if (required) throw new Error(`${key} required`);
    return undefined;
  }
  return value;
}

export function readStringArrayParam(params, key) {
  const raw = params?.[key];
  const values = (Array.isArray(raw) ? raw : [raw])
    .filter((v) => typeof v === "string")
    .map((v) => v.trim())
    .filter(Boolean);
  return values.length > 0 ? values : undefined;
}

export const resolveSearchCacheTtlMs = (cfg) => (cfg?.cacheTtlMinutes ?? 15) * 60_000;
export const resolveSearchTimeoutSeconds = (cfg) => cfg?.timeoutSeconds ?? 30;
export function resolveSearchCount(value, fallback) {
  const num = Number(value);
  return Number.isFinite(num) ? Math.min(10, Math.max(1, Math.floor(num))) : fallback;
}

export const wrapWebContent = (value) => `[ext]${value}`;

export async function withTrustedWebSearchEndpoint(params, run) {
  params.signal?.throwIfAborted();
  const response = await globalThis.__baiduFetch(params);
  return run(response);
}
