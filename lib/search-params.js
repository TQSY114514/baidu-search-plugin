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
export const MAX_RETRY_AFTER_MS = 10_000;

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

// HTTP statuses worth one more attempt. Anything else (notably 401/403)
// fails fast instead of burning quota on retries.
const RETRYABLE_HTTP_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

// Reads a numeric HTTP status from wherever the SDK error carries it.
// Returns undefined when absent so the caller can fall back to message sniffing.
export function readErrorStatus(err) {
  const candidates = [
    err?.status,
    err?.statusCode,
    err?.code,
    err?.response?.status,
    err?.response?.statusCode,
  ];
  for (const candidate of candidates) {
    const status = Number(candidate);
    if (Number.isInteger(status) && status >= 100 && status < 600) return status;
  }
  return;
}

export function isRetryableHttpStatus(status) {
  return RETRYABLE_HTTP_STATUS.has(status);
}

export function isRetryableSearchError(err) {
  // Prefer a numeric status when the SDK error carries one; message sniffing
  // is only a fallback (fragile across SDK/host locales, e.g. "4290" matches "429").
  // Baidu also uses 429 for exhausted quota / unpaid balance; those never
  // recover within a retry window.
  if (/QUOTA_USER_|BILLING_INSUFFICIENT/i.test(`${err?.code ?? ""} ${err?.message ?? ""}`)) return false;
  const status = readErrorStatus(err);
  if (status !== undefined) return isRetryableHttpStatus(status);
  const msg = String(err?.message ?? err ?? "");
  return /429|502|503|504|timeout|timed out|temporar|econn|etimedout|fetch failed|network/i.test(msg);
}

// The SDK's ProviderHttpError exposes Retry-After as `retryAfterMs` (it does
// not keep the response headers); raw header shapes are a fallback for other
// error types. Clamped to MAX_RETRY_AFTER_MS; undefined when absent.
export function readRetryAfterMs(err) {
  const fromSdk = Number(err?.retryAfterMs);
  if (err?.retryAfterMs != null && Number.isFinite(fromSdk)) {
    return Math.min(Math.max(fromSdk, 0), MAX_RETRY_AFTER_MS);
  }
  for (const headers of [err?.headers, err?.response?.headers]) {
    if (!headers) continue;
    const value =
      typeof headers.get === "function"
        ? headers.get("retry-after")
        : headers["retry-after"] ?? headers["Retry-After"];
    const ms = parseRetryAfterMs(value);
    if (ms !== undefined) return ms;
  }
  return;
}

// Reduces a site filter value to a bare lowercase host so "site:Baidu.com",
// "https://baidu.com/x" and "baidu.com/" all become "baidu.com".
export function normalizeSiteValue(value) {
  let text = String(value ?? "").trim().toLowerCase().replace(/^site:/, "");
  if (!text) return "";
  try {
    text = new URL(text.includes("://") ? text : `http://${text}`).hostname;
  } catch {
    text = text.split(/[/?#]/)[0];
  }
  return text.replace(/\.$/, "");
}

export function normalizeSiteList(values) {
  if (!Array.isArray(values)) return [];
  const out = new Set();
  for (const v of values) {
    const norm = normalizeSiteValue(v);
    if (norm) out.add(norm);
  }
  return [...out];
}

// Slice by code points so a cut never leaves a lone surrogate behind.
export function truncateByCodePoints(value, maxLength) {
  const str = String(value ?? "");
  if (Array.from(str).length <= maxLength) return str;
  return Array.from(str).slice(0, maxLength).join("");
}

// Parses a Retry-After header value into milliseconds.
// Accepts delay seconds ("120") or an HTTP date. Clamps to
// [0, MAX_RETRY_AFTER_MS]; returns undefined when absent/unparseable.
// `nowMs` exists for tests.
export function parseRetryAfterMs(value, nowMs = Date.now()) {
  if (value === undefined || value === null) return;
  const text = String(value).trim();
  if (!text) return;
  if (/^\d+$/.test(text)) {
    return Math.min(Number(text) * 1000, MAX_RETRY_AFTER_MS);
  }
  const at = Date.parse(text);
  if (!Number.isNaN(at)) {
    return Math.min(Math.max(at - nowMs, 0), MAX_RETRY_AFTER_MS);
  }
  return;
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
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// Baidu error codes arrive as numbers (216003), numeric strings ("400") or
// symbolic strings ("QUOTA_USER_DAILY_FREE"); all must count as failures
// instead of an empty success. Numeric forms are returned as numbers.
// Returns undefined when there is no code.
export function resolveBaiduErrorCode(data) {
  const raw = data?.code;
  if (raw === undefined || raw === null) return;
  const text = String(raw).trim();
  if (!text) return;
  const num = Number(text);
  return Number.isFinite(num) ? num : text;
}

// Actionable hints for Baidu errors users can fix themselves. Matched against
// the error code and message, since Baidu reports some failures as HTTP errors
// (ProviderHttpError: status/code/message) and others as a 200 body with code.
// Legacy numeric codes are compared exactly against `code` only, so numbers
// inside messages (dates, request ids) never match.
const INVALID_KEY_HINT = "API Key 无效：需要千帆控制台创建的 bce-v3/ALTAK-... 格式 API Key";
const BAIDU_ERROR_HINTS = [
  { codes: ["17"], pattern: /QUOTA_USER_DAILY_FREE|daily request limit/i, hint: "免费额度已用完：请在千帆控制台开通后付费 https://console.bce.baidu.com/qianfan/studio/resource" },
  { codes: [], pattern: /QUOTA_USER_DAILY_REQUEST/i, hint: "今日调用次数已达上限，明天再试或联系百度申请扩容" },
  { codes: [], pattern: /BILLING_INSUFFICIENT_BALANCE|insufficient balance/i, hint: "百度智能云账户欠费，请充值 https://console.bce.baidu.com/finance/recharge" },
  { codes: ["18"], pattern: /RATE_LIMIT|rate_limit_exceeded|qps (request )?limit/i, hint: "请求过于频繁（百度默认 3 QPS），请稍后再试" },
  { codes: ["216003"], pattern: /InvalidHTTPAuthHeader|invalid_iam_token|IAM Certification/i, hint: INVALID_KEY_HINT },
];

/** @param {{ status?: number, code?: unknown, message?: unknown }} [error] */
export function resolveBaiduErrorHint({ status, code, message } = {}) {
  const codeText = String(code ?? "").trim();
  const text = `${codeText} ${message ?? ""}`;
  for (const { codes, pattern, hint } of BAIDU_ERROR_HINTS) {
    if (codes.includes(codeText) || pattern.test(text)) return hint;
  }
  if (status === 401) return INVALID_KEY_HINT;
  if (status === 403) return "API Key 没有百度搜索权限：请在千帆控制台为该 Key 开通百度 AI 搜索";
  return;
}

// Absolute result URLs with a non-http(s) scheme (javascript:, data:, ...)
// must never flow into rendered results. Relative or unparseable values have
// no scheme to abuse and keep the previous behavior.
export function hasBlockedUrlScheme(rawUrl) {
  const text = String(rawUrl ?? "").trim();
  if (!text) return false;
  try {
    const scheme = new URL(text).protocol;
    return scheme !== "http:" && scheme !== "https:";
  } catch {
    return false;
  }
}

// Baidu only searches the first 72 "characters" of a query, counting each
// non-ASCII character (e.g. a hanzi) as two.
export const BAIDU_QUERY_CHAR_LIMIT = 72;
// Baidu accepts at most 20 entries in search_filter.match.site.
export const MAX_SITE_FILTERS = 20;
// Fillers for a one-sided date range. Verified against the live API
// (2026-10): Baidu ignores a page_time range unless both bounds are present,
// rejects mixing absolute dates with "now/d" math (InvalidArgument), and
// silently ignores a 1970-01-01 lower bound (epoch 0) — 1990+ works.
const EARLIEST_PAGE_TIME = "2000-01-01";
const LATEST_PAGE_TIME = "2099-12-31";

export function baiduQueryLength(query) {
  let length = 0;
  for (const ch of String(query ?? "")) length += (ch.codePointAt(0) ?? 0) > 0x7f ? 2 : 1;
  return length;
}

// Builds the POST body for /v2/ai_search/web_search.
// timeFilters is the shape returned by parseWebSearchTimeFilters:
//   { freshness?, dateAfter?, dateBefore? }
// freshness maps to Baidu's documented top-level search_recency_filter
// (day | week | month | year); explicit dates map to a page_time range with
// inclusive bounds (matching the SDK's date_after <= date_before validation).
// Baidu requires both bounds, so a missing one is filled with a fixed date.
export function buildBaiduRequestBody({ query, count, timeFilters, sites, excludedSites }) {
  const body = {
    messages: [{ role: "user", content: query }],
    search_source: "baidu_search_v2",
    resource_type_filter: [{ type: "web", top_k: normalizeSearchCount(count) }],
  };
  // Over-limit queries would be cut silently; Baidu's documented query
  // rewrite improves long-query results for ~10-20ms extra latency.
  if (baiduQueryLength(query) > BAIDU_QUERY_CHAR_LIMIT) {
    body.query_policy = { enable_rewrite: true };
  }
  if (Array.isArray(sites) && sites.length > 0) {
    body.search_filter = body.search_filter ?? {};
    body.search_filter.match = { site: sites.slice(0, MAX_SITE_FILTERS) };
  }
  if (Array.isArray(excludedSites) && excludedSites.length > 0) {
    body.block_websites = excludedSites;
  }
  const recency = normalizeFreshness(timeFilters?.freshness);
  if (recency) {
    body.search_recency_filter = recency;
  } else if (timeFilters?.dateAfter || timeFilters?.dateBefore) {
    body.search_filter = body.search_filter ?? {};
    body.search_filter.range = {
      page_time: {
        gte: timeFilters.dateAfter || EARLIEST_PAGE_TIME,
        lte: timeFilters.dateBefore || LATEST_PAGE_TIME,
      },
    };
  }
  return body;
}

// Baidu results are Chinese-market content, so instants (timestamps, parsed
// date strings) are reported as their Beijing calendar date. Formatting via
// Asia/Shanghai keeps the output independent of the host timezone.
const BEIJING_DATE_FORMAT = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function toBeijingIsoDate(date) {
  return BEIJING_DATE_FORMAT.format(date);
}

// Normalize a published date to YYYY-MM-DD when parseable.
// Accepts "2026-09-01", "2026/9/1", "2026-09-01T12:00:00Z", "2026年9月1日", timestamps.
// Returns the original trimmed string when unparseable, undefined when empty.
export function normalizePublishedDate(value) {
  if (value === undefined || value === null) return;
  if (typeof value === "number" && Number.isFinite(value)) {
    const d = new Date(value > 1e12 ? value : value * 1000);
    return Number.isNaN(d.getTime()) ? undefined : toBeijingIsoDate(d);
  }
  const text = String(value).trim();
  if (!text) return;
  const isoPrefix = text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
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
  if (!Number.isNaN(parsed.getTime())) return toBeijingIsoDate(parsed);
  return text;
}

export function truncateSnippet(text) {
  const str = String(text ?? "");
  if (Array.from(str).length <= MAX_SNIPPET_LENGTH) return str;
  return `${truncateByCodePoints(str, MAX_SNIPPET_LENGTH).trimEnd()}…`;
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

// Baidu embeds control characters (e.g. \u0004/\u0005 highlight markers) in
// titles and snippets; drop them but keep tab/newline/carriage return.
export function stripControlChars(text) {
  return String(text ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");
}

function readScore(value) {
  if (value === null || value === undefined || value === "") return;
  const num = Number(value);
  return Number.isFinite(num) ? Math.round(num * 1000) / 1000 : undefined;
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
    if (rawUrl && hasBlockedUrlScheme(rawUrl)) continue;
    if (rawUrl) {
      const key = normalizeUrlForDedup(rawUrl);
      if (seen.has(key)) continue;
      seen.add(key);
    }
    const title = typeof entry.title === "string" ? stripControlChars(entry.title).trim() : (entry.title ?? "");
    const rawSnippet = entry.snippet || entry.content || "";
    const snippet = stripControlChars(String(rawSnippet)).trim();
    const website = typeof entry.website === "string" ? entry.website.trim() : "";
    const rawAuthor = entry.web_extensions?.author_info?.name;
    const author = typeof rawAuthor === "string" ? stripControlChars(rawAuthor).trim() : "";
    // Baidu's own [0,1] relevance/authority signals; only emitted when present.
    const rerankScore = readScore(entry.rerank_score);
    const authorityScore = readScore(entry.authority_score);
    out.push({
      title: title ? wrap(title) : "",
      url: rawUrl,
      description: snippet ? wrap(truncateSnippet(snippet)) : "",
      published: normalizePublishedDate(entry.date),
      siteName: website || resolveSiteName(rawUrl) || void 0,
      ...(rerankScore !== undefined ? { rerankScore } : {}),
      ...(authorityScore !== undefined ? { authorityScore } : {}),
      ...(author ? { author: wrap(author) } : {}),
    });
  }
  return out;
}
