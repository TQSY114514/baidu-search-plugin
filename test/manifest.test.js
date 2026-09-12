// Manifest sanity checks: package.json + openclaw.plugin.json must parse and
// carry the fields the ClawHub manifest validator and host expect.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function readJson(name) {
  return JSON.parse(readFileSync(join(root, name), "utf8"));
}

test("package.json: valid JSON with expected openclaw metadata", () => {
  const pkg = readJson("package.json");
  assert.equal(typeof pkg.name, "string");
  assert.equal(typeof pkg.version, "string");
  assert.equal(pkg.license, "MIT");
  assert.equal(pkg.type, "module");
  assert.ok(Array.isArray(pkg.files));
  assert.equal(pkg.openclaw.compat.pluginApi, ">=2026.9.4");
  assert.equal(pkg.openclaw.build.openclawVersion, "2026.9.4");
  assert.deepEqual(pkg.openclaw.extensions, ["./index.js"]);
  assert.equal(pkg.openclaw.install.defaultChoice, "clawhub");
  assert.equal(pkg.openclaw.install.clawhubSpec, "clawhub:@tqsy114514/baidu-search-plugin");
  assert.equal(pkg.openclaw.release.publishToClawHub, true);
});

test("openclaw.plugin.json: valid JSON with contracts and uiHints", () => {
  const manifest = readJson("openclaw.plugin.json");
  assert.equal(manifest.id, "baidu");
  assert.deepEqual(manifest.contracts.webSearchProviders, ["baidu"]);
  assert.deepEqual(manifest.categories, ["web"]);
  assert.equal(manifest.activation?.onStartup, false);
  assert.equal(manifest.uiHints["webSearch.apiKey"].sensitive, true);
  // apiKey may be a plain string or a SecretRef object.
  assert.deepEqual(manifest.configSchema.properties.webSearch.properties.apiKey.type, ["string", "object"]);
});

test("LICENSE exists and starts with the MIT license header", () => {
  const text = readFileSync(join(root, "LICENSE"), "utf8");
  assert.match(text, /^MIT License/m);
  assert.match(text, /Copyright \(c\) 2026/);
});

test("index.js entry exposes id/name and register', and README exists", () => {
  const source = readFileSync(join(root, "index.js"), "utf8");
  assert.match(source, /definePluginEntry\(\{/);
  assert.match(source, /id: "baidu"/);
  assert.ok(readFileSync(join(root, "README.md"), "utf8").length > 0);
});