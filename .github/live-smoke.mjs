// Live smoke test against the real Baidu API (replaces calibrate.mjs).
// Uses the plugin's own request builder / result mapper, so it verifies that
// Baidu accepts exactly the bodies the plugin sends. 3 calls per run.
//
//   BAIDU_API_KEY=bce-v3/ALTAK-... node .github/live-smoke.mjs
//
// Without BAIDU_API_KEY it prints a notice and exits 0 (forks, first setup).
import { appendFileSync } from "node:fs";
import {
  buildBaiduRequestBody,
  mapBaiduReferences,
  normalizeSiteList,
  resolveBaiduErrorCode,
  resolveBaiduErrorHint,
} from "../lib/search-params.js";

const ENDPOINT = "https://qianfan.baidubce.com/v2/ai_search/web_search";
const apiKey = process.env.BAIDU_API_KEY?.trim();

if (!apiKey) {
  console.log("::notice::BAIDU_API_KEY is not set; skipping live smoke test.");
  process.exit(0);
}

const daysAgo = (n) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

const cases = [
  {
    name: "site filter",
    params: { query: "OpenClaw", count: 5, sites: normalizeSiteList(["github.com"]) },
    check: (results) =>
      results.every((r) => /(^|\.)github\.com$/.test(new URL(r.url).hostname)) || "result outside github.com",
  },
  {
    name: "one-sided date_after",
    params: { query: "人工智能 新闻", count: 5, timeFilters: { dateAfter: daysAgo(30) } },
    // Report-only: a few undated/older pages are tolerated, but most results
    // must respect the range or the page_time filter is being ignored.
    check: (results, { dateAfter }) => {
      const dated = results.filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.published ?? ""));
      const inRange = dated.filter((r) => r.published >= dateAfter);
      console.log(`  dated ${dated.length}/${results.length}, in range ${inRange.length}/${dated.length}`);
      return dated.length === 0 || inRange.length * 2 >= dated.length || "page_time range looks ignored";
    },
  },
  {
    name: "long query (enable_rewrite)",
    params: { query: "请帮我查一下最近关于百度千帆平台AI搜索接口的官方更新说明以及免费额度和收费标准的调整情况", count: 3 },
    check: (_results, _f, body) => body.query_policy?.enable_rewrite === true || "rewrite flag not set",
  },
];

const summary = ["| case | status | results | ms |", "|---|---|---|---|"];
let failed = 0;

for (const { name, params, check } of cases) {
  const body = buildBaiduRequestBody({ timeFilters: {}, sites: [], excludedSites: [], ...params });
  const started = Date.now();
  let status = "ok";
  let count = 0;
  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Appbuilder-From": "openclaw", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    const data = await res.json().catch(() => ({}));
    const code = resolveBaiduErrorCode(data);
    if (!res.ok || (code !== undefined && code !== 0)) {
      const hint = resolveBaiduErrorHint({ status: res.status, code, message: data.message });
      throw new Error(`HTTP ${res.status} code=${code ?? "-"} ${data.message ?? ""}${hint ? ` (${hint})` : ""}`);
    }
    const results = mapBaiduReferences(data.references);
    count = results.length;
    if (count === 0) throw new Error("no results");
    const verdict = check(results, params.timeFilters ?? {}, body);
    if (verdict !== true) throw new Error(verdict);
  } catch (err) {
    status = `FAIL: ${err.message}`;
    failed += 1;
  }
  const ms = Date.now() - started;
  console.log(`${status === "ok" ? "✔" : "✖"} ${name} — ${status} (${count} results, ${ms}ms)`);
  summary.push(`| ${name} | ${status} | ${count} | ${ms} |`);
}

if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## Baidu live smoke\n\n${summary.join("\n")}\n`);
}
process.exit(failed > 0 ? 1 : 0);
