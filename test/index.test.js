// Behavior tests for index.js against a stubbed openclaw SDK (see fixtures/).
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register("./fixtures/openclaw-sdk-loader.mjs", import.meta.url);
const { default: plugin, executeBaiduSearch } = await import("../index.js");
const sdk = await import("openclaw/plugin-sdk/provider-web-search");

const KEY = { apiKey: "bce-v3/ALTAK-test" };
let calls;

function json(body, init = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "Content-Type": "application/json", ...init.headers },
  });
}

// Queue of responders; each fetch consumes the next one (the last repeats).
function serve(...responders) {
  globalThis.__baiduFetch = async (params) => {
    calls.push(params);
    const responder = responders[Math.min(calls.length - 1, responders.length - 1)];
    return responder(params);
  };
}

// A fetch that never answers until its signal aborts.
const hang = (params) =>
  new Promise((_, reject) => {
    params.signal.addEventListener("abort", () => reject(params.signal.reason), { once: true });
  });

const ok = () => json({ references: [{ title: "T", url: "https://a.example/x", content: "S", website: "a.example", authority_score: 0.91234 }] });

beforeEach(() => {
  calls = [];
  sdk.__clearCache();
  delete process.env.BAIDU_API_KEY;
  delete process.env.QIANFAN_API_KEY;
});

test("success: sends auth + body, maps and wraps results", async () => {
  serve(ok);
  const payload = await executeBaiduSearch({ query: " OpenClaw ", count: 3, site: "https://GitHub.com/x" }, KEY);
  assert.equal(calls.length, 1);
  const { init } = calls[0];
  assert.equal(init.headers.Authorization, "Bearer bce-v3/ALTAK-test");
  assert.equal(init.headers["X-Appbuilder-From"], "openclaw");
  const body = JSON.parse(init.body);
  assert.equal(body.messages[0].content, "OpenClaw");
  assert.equal(body.resource_type_filter[0].top_k, 3);
  assert.deepEqual(body.search_filter.match.site, ["github.com"]);
  assert.equal(payload.provider, "baidu");
  assert.equal(payload.count, 1);
  assert.deepEqual(payload.results[0], {
    title: "[ext]T",
    url: "https://a.example/x",
    description: "[ext]S",
    published: undefined,
    siteName: "a.example",
    authorityScore: 0.912,
  });
});

test("cache: an identical second search does not hit Baidu", async () => {
  serve(ok);
  const first = await executeBaiduSearch({ query: "cached" }, KEY);
  const second = await executeBaiduSearch({ query: "cached" }, KEY);
  assert.equal(calls.length, 1);
  assert.equal(second, first);
});

test("missing key: structured error, no request", async () => {
  serve(ok);
  const result = await executeBaiduSearch({ query: "x" }, {});
  assert.equal(result.error, "missing_baidu_api_key");
  assert.equal(calls.length, 0);
});

test("env key is used when config has none", async () => {
  process.env.QIANFAN_API_KEY = "bce-v3/ALTAK-env";
  serve(ok);
  await executeBaiduSearch({ query: "env" }, {});
  assert.equal(calls[0].init.headers.Authorization, "Bearer bce-v3/ALTAK-env");
});

test("200 with a symbolic error code: structured error with hint, not an empty success", async () => {
  serve(() => json({ code: "QUOTA_USER_DAILY_FREE", message: "Daily free quota per user for AI Search exceeded", request_id: "r1" }));
  const result = await executeBaiduSearch({ query: "quota" }, KEY);
  assert.equal(result.error, "baidu_search_error");
  assert.equal(result.code, "QUOTA_USER_DAILY_FREE");
  assert.match(result.hint, /免费额度/);
  assert.equal(result.requestId, "r1");
  // Errors are not cached.
  await executeBaiduSearch({ query: "quota" }, KEY);
  assert.equal(calls.length, 2);
});

test("429 with Retry-After is retried, then succeeds", async () => {
  serve(() => json({ code: "RATE_LIMIT_SEARCH_QPS" }, { status: 429, headers: { "Retry-After": "0" } }), ok);
  const payload = await executeBaiduSearch({ query: "retry" }, KEY);
  assert.equal(calls.length, 2);
  assert.equal(payload.count, 1);
});

test("transient 503s give up after 3 attempts using the fixed backoff", async () => {
  serve(() => json({}, { status: 503 }));
  const started = Date.now();
  await assert.rejects(executeBaiduSearch({ query: "down" }, KEY), { status: 503 });
  assert.equal(calls.length, 3);
  assert.ok(Date.now() - started >= 1000, "300ms + 800ms backoff");
});

test("401 fails fast with an actionable hint", async () => {
  serve(() => json({ code: 216003, message: "Authentication error" }, { status: 401 }));
  await assert.rejects(executeBaiduSearch({ query: "auth" }, KEY), (err) => {
    assert.equal(err.status, 401);
    assert.match(err.message, /API Key 无效/);
    return true;
  });
  assert.equal(calls.length, 1);
});

test("429 quota exhaustion is not retried", async () => {
  serve(() => json({ code: "QUOTA_USER_DAILY_FREE", message: "quota" }, { status: 429, headers: { "Retry-After": "0" } }));
  await assert.rejects(executeBaiduSearch({ query: "quota429" }, KEY), /免费额度/);
  assert.equal(calls.length, 1);
});

test("single-flight: concurrent identical searches share one request", async () => {
  let release;
  serve(() => new Promise((resolve) => (release = () => resolve(ok()))));
  const a = executeBaiduSearch({ query: "shared" }, KEY);
  const b = executeBaiduSearch({ query: "shared" }, KEY);
  await new Promise((r) => setImmediate(r));
  release();
  const [ra, rb] = await Promise.all([a, b]);
  assert.equal(calls.length, 1);
  assert.equal(ra, rb);
});

test("single-flight: one caller cancelling does not cancel the other", async () => {
  let release;
  serve(() => new Promise((resolve) => (release = () => resolve(ok()))));
  const ac = new AbortController();
  const a = executeBaiduSearch({ query: "half" }, KEY, ac.signal);
  const b = executeBaiduSearch({ query: "half" }, KEY, new AbortController().signal);
  await new Promise((r) => setImmediate(r));
  ac.abort();
  await assert.rejects(a, { name: "AbortError" });
  assert.equal(calls[0].signal.aborted, false);
  release();
  assert.equal((await b).count, 1);
});

test("single-flight: a caller without a signal keeps the shared request alive", async () => {
  let release;
  serve(() => new Promise((resolve) => (release = () => resolve(ok()))));
  const ac = new AbortController();
  const pinned = executeBaiduSearch({ query: "pinned" }, KEY);
  const cancellable = executeBaiduSearch({ query: "pinned" }, KEY, ac.signal);
  await new Promise((r) => setImmediate(r));
  ac.abort();
  await assert.rejects(cancellable, { name: "AbortError" });
  assert.equal(calls[0].signal.aborted, false);
  release();
  assert.equal((await pinned).count, 1);
});

test("cancellation: when every caller aborts, the request is aborted and not retried", async () => {
  serve(hang);
  const ac1 = new AbortController();
  const ac2 = new AbortController();
  const a = executeBaiduSearch({ query: "gone" }, KEY, ac1.signal);
  const b = executeBaiduSearch({ query: "gone" }, KEY, ac2.signal);
  await new Promise((r) => setImmediate(r));
  ac1.abort();
  ac2.abort();
  await assert.rejects(a, { name: "AbortError" });
  await assert.rejects(b, { name: "AbortError" });
  assert.equal(calls[0].signal.aborted, true);
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(calls.length, 1);
  // A fresh search after the abort starts a new request.
  serve(ok);
  assert.equal((await executeBaiduSearch({ query: "gone" }, KEY)).count, 1);
});

test("pre-aborted signal: throws without a request", async () => {
  serve(ok);
  await assert.rejects(executeBaiduSearch({ query: "pre" }, KEY, AbortSignal.abort()), { name: "AbortError" });
  assert.equal(calls.length, 0);
});

test("plugin: registers the baidu provider and forwards the tool signal", async () => {
  let provider;
  plugin.register({ registerWebSearchProvider: (p) => (provider = p) });
  assert.equal(provider.id, "baidu");
  const tool = provider.createTool({
    config: { plugins: { entries: { baidu: { config: { webSearch: { apiKey: "bce-v3/ALTAK-plugin" } } } } } },
    searchConfig: { cacheTtlMinutes: 1 },
  });
  assert.equal(tool.parameters.properties.count.type, "integer");
  serve(ok);
  const ac = new AbortController();
  await tool.execute({ query: "tool" }, { signal: ac.signal });
  assert.equal(calls[0].init.headers.Authorization, "Bearer bce-v3/ALTAK-plugin");
  assert.equal(calls[0].signal.aborted, false);
});
