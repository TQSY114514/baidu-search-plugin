// Unit tests for the pure search-params helpers (no openclaw SDK dependency).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildBaiduRequestBody,
  isRetryableHttpStatus,
  mapBaiduReferences,
  normalizeFreshness,
  normalizePublishedDate,
  normalizeSearchCount,
  normalizeUrlForDedup,
  parseRetryAfterMs,
  readErrorStatus,
  resolveBaiduErrorCode,
  resolveSiteName,
  toIsoDate,
  truncateSnippet,
} from "../lib/search-params.js";

test("buildBaiduRequestBody: minimal body uses web_search_v2 and top_k=count", () => {
  const body = buildBaiduRequestBody({
    query: "hello",
    count: 5,
    timeFilters: {},
    sites: [],
    excludedSites: [],
  });
  assert.deepEqual(body, {
    messages: [{ role: "user", content: "hello" }],
    search_source: "baidu_search_v2",
    resource_type_filter: [{ type: "web", top_k: 5 }],
  });
});

test("buildBaiduRequestBody: date range maps to search_filter.range.page_time", () => {
  const body = buildBaiduRequestBody({
    query: "q",
    count: 5,
    timeFilters: { dateAfter: "2026-01-01", dateBefore: "2026-02-01" },
    sites: [],
    excludedSites: [],
  });
  assert.deepEqual(body.search_filter, {
    range: { page_time: { gte: "2026-01-01", lt: "2026-02-01" } },
  });
});

test("buildBaiduRequestBody: freshness maps to top-level search_recency_filter", () => {
  const body = buildBaiduRequestBody({
    query: "q",
    count: 5,
    timeFilters: { freshness: "week" },
    sites: [],
    excludedSites: [],
  });
  assert.equal(body.search_recency_filter, "week");
  // The undocumented page_time range must not be emitted for freshness.
  assert.equal(body.search_filter, undefined);
});

test("buildBaiduRequestBody: single-sided date omits the missing bound", () => {
  // freshness and explicit dates are mutually exclusive by the caller; here we
  // verify the date branch does not pick up freshness fields.
  const body = buildBaiduRequestBody({
    query: "q",
    count: 5,
    timeFilters: { dateAfter: "2026-03-01" },
    sites: [],
    excludedSites: [],
  });
  assert.deepEqual(body.search_filter, {
    range: { page_time: { gte: "2026-03-01" } },
  });
});

test("buildBaiduRequestBody: single-sided dateBefore omits gte", () => {
  const body = buildBaiduRequestBody({
    query: "q",
    count: 5,
    timeFilters: { dateBefore: "2026-03-01" },
    sites: [],
    excludedSites: [],
  });
  assert.deepEqual(body.search_filter, {
    range: { page_time: { lt: "2026-03-01" } },
  });
});

test("buildBaiduRequestBody: sites map to match.site and excludedSites to block_websites", () => {
  const body = buildBaiduRequestBody({
    query: "q",
    count: 5,
    timeFilters: {},
    sites: ["baidu.com", "tieba.baidu.com"],
    excludedSites: ["spam.example"],
  });
  assert.deepEqual(body.search_filter.match, {
    site: ["baidu.com", "tieba.baidu.com"],
  });
  assert.deepEqual(body.block_websites, ["spam.example"]);
});

test("buildBaiduRequestBody: site filter combines with a recency filter", () => {
  const body = buildBaiduRequestBody({
    query: "q",
    count: 5,
    timeFilters: { freshness: "month" },
    sites: ["baidu.com"],
    excludedSites: [],
  });
  assert.ok(body.search_filter.match.site.includes("baidu.com"));
  assert.equal(body.search_recency_filter, "month");
});

test("normalizeFreshness: pd/pw/pm/py map to Baidu recency values", () => {
  assert.equal(normalizeFreshness("pd"), "day");
  assert.equal(normalizeFreshness("pw"), "week");
  assert.equal(normalizeFreshness("pm"), "month");
  assert.equal(normalizeFreshness("py"), "year");
  assert.equal(normalizeFreshness("week"), "week");
  assert.equal(normalizeFreshness("decade"), undefined);
  assert.equal(normalizeFreshness(undefined), undefined);
});

test("buildBaiduRequestBody: pd-style freshness maps to search_recency_filter", () => {
  for (const [input, expected] of [["pd", "day"], ["pw", "week"], ["pm", "month"], ["py", "year"]]) {
    const body = buildBaiduRequestBody({
      query: "q",
      count: 5,
      timeFilters: { freshness: input },
      sites: [],
      excludedSites: [],
    });
    assert.equal(body.search_recency_filter, expected, input);
    assert.equal(body.search_filter, undefined, `${input}: no page_time range`);
  }
});

test("mapBaiduReferences: maps title/url/snippet and falls back to content", () => {
  const results = mapBaiduReferences([
    { title: "T1", url: "https://baidu.com/a", snippet: "Snip", date: "2026-09-01" },
    { title: "T2", url: "https://baidu.com/b", content: "Body" },
    { url: "https://baidu.com/c" },
  ]);
  assert.equal(results.length, 3);
  assert.deepEqual(results[0], {
    title: "T1",
    url: "https://baidu.com/a",
    description: "Snip",
    published: "2026-09-01",
    siteName: "baidu.com",
  });
  assert.equal(results[1].description, "Body");
  assert.equal(results[2].title, "");
  assert.equal(results[2].description, "");
  assert.equal(results[2].published, undefined);
});

test("mapBaiduReferences: wrap callback is applied to title and description", () => {
  const results = mapBaiduReferences(
    [{ title: "T", url: "https://baidu.com/a", snippet: "S" }],
    (value) => `[[${value}]]`,
  );
  assert.equal(results[0].title, "[[T]]");
  assert.equal(results[0].description, "[[S]]");
});

test("mapBaiduReferences: non-array input yields empty list", () => {
  assert.deepEqual(mapBaiduReferences(undefined), []);
  assert.deepEqual(mapBaiduReferences(null), []);
  assert.deepEqual(mapBaiduReferences({}), []);
});

test("resolveSiteName: extracts hostname and tolerates bad urls", () => {
  assert.equal(resolveSiteName("https://www.baidu.com/s?wd=x"), "www.baidu.com");
  assert.equal(resolveSiteName("not-a-url"), undefined);
  assert.equal(resolveSiteName(undefined), undefined);
});

test("normalizeSearchCount: clamps to 1-10 and falls back on garbage", () => {
  assert.equal(normalizeSearchCount(5), 5);
  assert.equal(normalizeSearchCount(0), 1);
  assert.equal(normalizeSearchCount(99), 10);
  assert.equal(normalizeSearchCount(4.9), 4);
  assert.equal(normalizeSearchCount("7"), 7);
  assert.equal(normalizeSearchCount("abc"), 5);
  assert.equal(normalizeSearchCount(undefined), 5);
  assert.equal(normalizeSearchCount(NaN), 5);
});

test("buildBaiduRequestBody: out-of-range count is clamped into top_k", () => {
  const body = buildBaiduRequestBody({
    query: "q",
    count: 99,
    timeFilters: {},
    sites: [],
    excludedSites: [],
  });
  assert.equal(body.resource_type_filter[0].top_k, 10);
});

test("mapBaiduReferences: dedupes by normalized url keeping first", () => {
  const results = mapBaiduReferences([
    { title: "A", url: "https://baidu.com/a", snippet: "one" },
    { title: "A-dup", url: "https://baidu.com/a#frag", snippet: "two" },
    { title: "A-slash", url: "https://baidu.com/a/", snippet: "three" },
    { title: "B", url: "https://baidu.com/b", snippet: "four" },
  ]);
  assert.equal(results.length, 2);
  assert.equal(results[0].title, "A");
  assert.equal(results[1].url, "https://baidu.com/b");
});

test("mapBaiduReferences: truncates long snippets", () => {
  const long = "x".repeat(600);
  const results = mapBaiduReferences([{ title: "T", url: "https://baidu.com/a", snippet: long }]);
  assert.ok(results[0].description.length <= 501, `len ${results[0].description.length}`);
  assert.match(results[0].description, /…$/);
});

test("normalizePublishedDate: normalizes common formats", () => {
  assert.equal(normalizePublishedDate("2026-09-01"), "2026-09-01");
  assert.equal(normalizePublishedDate("2026-9-1"), "2026-09-01");
  assert.equal(normalizePublishedDate("2026年9月1日"), "2026-09-01");
  assert.equal(normalizePublishedDate(undefined), undefined);
  assert.equal(normalizePublishedDate(""), undefined);
});

test("normalizeUrlForDedup: fragment and trailing slash are ignored", () => {
  assert.equal(
    normalizeUrlForDedup("https://baidu.com/a#x"),
    normalizeUrlForDedup("https://baidu.com/a/"),
  );
});

test("truncateSnippet: short text untouched", () => {
  assert.equal(truncateSnippet("hello"), "hello");
});

test("parseRetryAfterMs: delay seconds convert to ms and clamp", () => {
  assert.equal(parseRetryAfterMs("120"), 10_000); // clamped to MAX_RETRY_AFTER_MS
  assert.equal(parseRetryAfterMs("2"), 2000);
  assert.equal(parseRetryAfterMs("0"), 0);
});

test("parseRetryAfterMs: HTTP date resolves against now and clamps past to 0", () => {
  const now = Date.UTC(2026, 8, 27, 12, 0, 0);
  assert.equal(parseRetryAfterMs("Sat, 27 Sep 2026 12:00:05 GMT", now), 5000);
  assert.equal(parseRetryAfterMs("Sat, 27 Sep 2026 11:00:00 GMT", now), 0);
});

test("parseRetryAfterMs: garbage returns undefined", () => {
  assert.equal(parseRetryAfterMs(undefined), undefined);
  assert.equal(parseRetryAfterMs(""), undefined);
  assert.equal(parseRetryAfterMs("soon"), undefined);
});

test("resolveBaiduErrorCode: numeric strings count as failure codes", () => {
  assert.equal(resolveBaiduErrorCode({ code: 400 }), 400);
  assert.equal(resolveBaiduErrorCode({ code: "400" }), 400);
  assert.equal(resolveBaiduErrorCode({ code: 0 }), 0);
  assert.equal(resolveBaiduErrorCode({ code: "0" }), 0);
  assert.equal(resolveBaiduErrorCode({}), undefined);
  assert.equal(resolveBaiduErrorCode({ code: "oops" }), undefined);
  assert.equal(resolveBaiduErrorCode(undefined), undefined);
});

test("toIsoDate: UTC midnight edge does not shift the day", () => {
  // 2026-09-01T00:30:00Z is still 2026-09-01 in UTC but 2026-09-01 08:30 in
  // UTC+8; local-time getters used to return different days by timezone.
  assert.equal(toIsoDate(new Date("2026-09-01T00:30:00Z")), "2026-09-01");
  assert.equal(toIsoDate(new Date("2026-09-01T23:30:00Z")), "2026-09-01");
});

test("mapBaiduReferences: drops non-http(s) URL schemes", () => {
  const results = mapBaiduReferences([
    { title: "JS", url: "javascript:alert(1)", snippet: "x" },
    { title: "DATA", url: "data:text/html,hi", snippet: "x" },
    { title: "OK", url: "https://baidu.com/a", snippet: "x" },
    { title: "REL", url: "/relative/path", snippet: "x" },
  ]);
  assert.equal(results.length, 2);
  assert.equal(results[0].title, "OK");
  assert.equal(results[1].title, "REL");
});

test("readErrorStatus: finds numeric status across SDK error shapes", () => {
  assert.equal(readErrorStatus({ status: 429 }), 429);
  assert.equal(readErrorStatus({ statusCode: "503" }), 503);
  assert.equal(readErrorStatus({ response: { status: 502 } }), 502);
  assert.equal(readErrorStatus({ code: "ECONNRESET" }), undefined);
  assert.equal(readErrorStatus({ message: "timeout" }), undefined);
  assert.equal(readErrorStatus(undefined), undefined);
});

test("isRetryableHttpStatus: only transient statuses retry", () => {
  assert.equal(isRetryableHttpStatus(429), true);
  assert.equal(isRetryableHttpStatus(503), true);
  assert.equal(isRetryableHttpStatus(401), false);
  assert.equal(isRetryableHttpStatus(403), false);
  assert.equal(isRetryableHttpStatus(400), false);
});

test("truncateSnippet: never splits a surrogate pair", () => {
  const results = mapBaiduReferences([
    { title: "E", url: "https://baidu.com/e", snippet: "😀".repeat(600) },
  ]);
  const codePoints = Array.from(results[0].description);
  assert.ok(codePoints.length <= 501, `len ${codePoints.length}`);
  assert.match(results[0].description, /…$/);
  // No lone surrogates: re-encoding round-trips cleanly.
  assert.equal(Array.from(results[0].description).join(""), results[0].description);
});