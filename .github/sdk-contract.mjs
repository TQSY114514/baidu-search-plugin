// Contract check against a real openclaw install (the unit tests use a stub).
// Catches SDK changes that break the plugin: removed or renamed exports,
// config-merging changes, and changes to the HTTP error shape. Needs no
// API key and spends no quota: the one real request uses a fake key and must
// come back as Baidu's 401 with the plugin's hint attached.
//
//   npm install --no-save openclaw@latest && node --test .github/sdk-contract.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const SDK_IMPORTS = /import\s*\{([^}]*)\}\s*from\s*"(openclaw\/plugin-sdk\/[^"]+)"/g;

test("every SDK import used by index.js exists", async () => {
  const source = readFileSync(new URL("../index.js", import.meta.url), "utf8");
  let checked = 0;
  for (const [, names, specifier] of source.matchAll(SDK_IMPORTS)) {
    const mod = await import(specifier);
    for (const name of names.split(",").map((n) => n.trim()).filter(Boolean)) {
      assert.ok(name in mod, `${specifier} no longer exports ${name}`);
      checked += 1;
    }
  }
  assert.ok(checked > 10, "found the SDK imports in index.js");
});

const { default: plugin, executeBaiduSearch } = await import("../index.js");
const { mergeScopedSearchConfig } = await import("openclaw/plugin-sdk/provider-web-search-config-contract");

function createTool(webSearch) {
  let provider;
  plugin.register({ registerWebSearchProvider: (p) => (provider = p) });
  assert.equal(provider?.id, "baidu");
  return provider.createTool({ config: { plugins: { entries: { baidu: { config: { webSearch } } } } }, searchConfig: {} });
}

test("plugin settings stay reachable under the provider id after merging", () => {
  const merged = mergeScopedSearchConfig({}, "baidu", { apiKey: "k", edition: "turbo", qps: 3 }, { mirrorApiKeyToTopLevel: true });
  assert.equal(merged.apiKey, "k");
  assert.equal(merged.baidu?.edition, "turbo");
  assert.equal(merged.baidu?.qps, 3);
});

test("argument errors come back as structured results", async () => {
  delete process.env.BAIDU_API_KEY;
  delete process.env.QIANFAN_API_KEY;
  assert.equal((await executeBaiduSearch({ query: "x" }, {})).error, "missing_baidu_api_key");
  const tool = createTool({ apiKey: "bce-v3/ALTAK-contract" });
  const conflict = await tool.execute({ query: "x", freshness: "pd", date_after: "2026-01-01" }, {});
  assert.equal(conflict.error, "conflicting_time_filters");
});

test("a real request with a fake key surfaces Baidu's 401 with the plugin hint", async () => {
  const tool = createTool({ apiKey: "bce-v3/ALTAK-contract/invalid" });
  await assert.rejects(tool.execute({ query: "OpenClaw contract" }, {}), (err) => {
    assert.equal(err.status, 401);
    assert.match(err.message, /API Key 无效/);
    return true;
  });
});
