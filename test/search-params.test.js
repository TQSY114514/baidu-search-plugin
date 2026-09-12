// Unit tests for the pure search-params helpers (no openclaw SDK dependency).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildBaiduRequestBody,
  freshnessToPageTimeRange,
  mapBaiduReferences,
  resolveSiteName,
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

test("buildBaiduRequestBody: freshness maps to a page_time range", () => {
  const body = buildBaiduRequestBody({
    query: "q",
    count: 5,
    timeFilters: { freshness: "pw" },
    sites: [],
    excludedSites: [],
  });
  const range = body.search_filter.range.page_time;
  assert.match(range.gte, /^\d{4}-\d{2}-\d{2}$/);
  assert.match(range.lt, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(range.gte < range.lt, `gte ${range.gte} should be before lt ${range.lt}`);
});

test("buildBaiduRequestBody: date range wins when freshness is absent but both not present", () => {
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
    range: { page_time: { gte: "2026-03-01", lt: undefined } },
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

test("buildBaiduRequestBody: site filter combines with time range into one search_filter", () => {
  const body = buildBaiduRequestBody({
    query: "q",
    count: 5,
    timeFilters: { freshness: "pm" },
    sites: ["baidu.com"],
    excludedSites: [],
  });
  assert.ok(body.search_filter.match.site.includes("baidu.com"));
  assert.ok(body.search_filter.range.page_time.gte);
});

test("freshnessToPageTimeRange: maps each shortcut to a date window", () => {
  for (const f of ["pd", "pw", "pm", "py"]) {
    const range = freshnessToPageTimeRange(f);
    assert.ok(range?.gte && /^\d{4}-\d{2}-\d{2}$/.test(range.gte), `${f}: gte`);
    assert.ok(range?.lt && /^\d{4}-\d{2}-\d{2}$/.test(range.lt), `${f}: lt`);
    assert.ok(range.gte < range.lt, `${f}: gte before lt`);
  }
});

test("freshnessToPageTimeRange: unsupported shortcut returns undefined", () => {
  assert.equal(freshnessToPageTimeRange("decade"), undefined);
  assert.equal(freshnessToPageTimeRange(undefined), undefined);
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