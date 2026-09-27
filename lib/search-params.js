// Pure helpers for the Baidu Qianfan AI Search provider.
// Kept free of openclaw SDK imports so they can be unit-tested directly.

// Baidu's documented `search_recency_filter` values.
export const RECENCY_VALUES = ["day", "week", "month", "year"];

// The SDK time parser (freshnessProvider "perplexity") yields pd/pw/pm/py.
// Map those onto Baidu's day/week/month/year; pass through values that are
// already canonical. Returns undefined for anything else so the caller can
// leave the filter unset instead of sending a value Baidu ignores.
export const FRESHNESS_TO_RECENCY = {
  pd: "day",
  pw: "week",
  pm: "month",
  py: "year",
  day: "day",
  week: "week",
  month: "month",
  year: "year",
};

export function normalizeFreshness(freshness) {
  if (!freshness) return;
  return FRESHNESS_TO_RECENCY[String(freshness).trim().toLowerCase()];
}

export const DEFAULT_SEARCH_COUNT = 5;
export const MIN_SEARCH_COUNT = 1;
export const MAX_SEARCH_COUNT = 10;
export const MAX_SNIPPET_LENGTH = 500;

// Count comes from the tool schema (number) but callers can pass strings,
// floats or garbage. Clamp to [1, 10] so top_k is always valid.
export function normalizeSearchCount(value, fallback = DEFAULT_SEARCH_COUNT) {
  const num =
    typeof value === "string"
      ? value.trim() === "" ? NaN : Number(value.trim())
      : Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(MAX_SEARCH_COUNT, Math.max(MIN_SEARCH_COUNT, Math.floor(num)));
}

export function resolveSiteName(url) {
  if (!url) return;
  try {
    return new URL(url).hostname;
  } catch {
    return;
  }
}

export function toIsoDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// Builds the POST body for /v2/ai_search/web_search.
// timeFilters is the shape returned by parseWebSearchTimeFilters:
//   { freshness?, dateAfter?, dateBefore? }
// freshness maps to Baidu's documented top-level search_recency_filter
// (day | week | month | year); explicit dates fall back to a best-effort
// page_time range (single-sided when only one bound is given).
export function buildBaiduRequestBody({ query, count, timeFilters, sites, excludedSites }) {
  const body = {
    messages: [{ role: "user", content: query }],
    search_source: "baidu_search_v2",
    resource_type_filter: [{ type: "web", top_k: normalizeSearchCount(count) }],
  };
  if (Array.isArray(sites) && sites.length > 0) {
    body.search_filter = body.search_filter ?? {};
    body.search_filter.match = { site: sites };
  }
  if (Array.isArray(excludedSites) && excludedSites.length > 0) {
    body.block_websites = excludedSites;
  }
  const recency = normalizeFreshness(timeFilters?.freshness);
  if (recency) {
    body.search_recency_filter = recency;
  } else if (timeFilters?.dateAfter || timeFilters?.dateBefore) {
    // Explicit date ranges are not covered by Baidu's published schema; kept as
    // a best-effort page_time range pending live verification.
    body.search_filter = body.search_filter ?? {};
    body.search_filter.range = {
      page_time: {
        ...(timeFilters.dateAfter ? { gte: timeFilters.dateAfter } : {}),
        ...(timeFilters.dateBefore ? { lt: timeFilters.dateBefore } : {}),
      },
    };
  }
  return body;
}

// Normalize a published date to YYYY-MM-DD when parseable.
// Accepts "2026-09-01", "2026-09-01T12:00:00Z", "2026年9月1日", timestamps.
// Returns the original trimmed string when unparseable, undefined when empty.
export function normalizePublishedDate(value) {
  if (value === undefined || value === null) return;
  if (typeof value === "number" && Number.isFinite(value)) {
    const d = new Date(value > 1e12 ? value : value * 1000);
    return Number.isNaN(d.getTime()) ? undefined : toIsoDate(d);
  }
  const text = String(value).trim();
  if (!text) return;
  const isoPrefix = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (isoPrefix) {
    const [, y, m, d] = isoPrefix;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  const chinese = text.match(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日?/);
  if (chinese) {
    const [, y, m, d] = chinese;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime())) return toIsoDate(parsed);
  return text;
}

export function truncateSnippet(text) {
  const str = String(text ?? "");
  if (str.length <= MAX_SNIPPET_LENGTH) return str;
  return `${str.slice(0, MAX_SNIPPET_LENGTH).trimEnd()}…`;
}

// Dedup key: lowercase scheme+host, strip fragment, strip trailing slashes.
// Falls back to trimmed-lowercased raw string for non-URL values.
export function normalizeUrlForDedup(url) {
  const text = String(url ?? "").trim();
  if (!text) return "";
  const withoutFragment = text.split("#")[0].trim();
  try {
    const parsed = new URL(withoutFragment);
    const path = parsed.pathname.replace(/\/+$/, "") || "/";
    return `${parsed.protocol}//${parsed.host.toLowerCase()}${path}${parsed.search}`;
  } catch {
    return withoutFragment.toLowerCase().replace(/\/+$/, "");
  }
}

// Maps a Baidu `references[]` entry into a standard web-search result.
// `wrap` defaults to identity so the pure mapping stays SDK-free; the plugin
// injects the SDK's wrapWebContent to mark external content.
// Dedupes by normalized URL (keeps first), truncates long snippets,
// normalizes published dates.
export function mapBaiduReferences(references, wrap = (value) => value) {
  if (!Array.isArray(references)) return [];
  const seen = new Set();
  const out = [];
  for (const entry of references) {
    if (!entry || typeof entry !== "object") continue;
    const rawUrl = typeof entry.url === "string" ? entry.url.trim() : (entry.url ?? "");
    if (rawUrl) {
      const key = normalizeUrlForDedup(rawUrl);
      if (seen.has(key)) continue;
      seen.add(key);
    }
    const title = typeof entry.title === "string" ? entry.title.trim() : (entry.title ?? "");
    const rawSnippet = entry.snippet || entry.content || "";
    const snippet = typeof rawSnippet === "string" ? rawSnippet.trim() : String(rawSnippet);
    out.push({
      title: title ? wrap(title) : "",
      url: rawUrl,
      description: snippet ? wrap(truncateSnippet(snippet)) : "",
      published: normalizePublishedDate(entry.date),
      siteName: resolveSiteName(rawUrl) || void 0,
    });
  }
  return out;
}
