// 实测校准脚本（一次性，用完即删）：node calibrate.mjs
// 前提：openclaw SDK 可解析（装过 openclaw 或 node_modules/openclaw junction 正常），
// 且环境变量 BAIDU_API_KEY 已设置。
import { executeBaiduSearch } from "./index.js";

const probes = [
  ["基础", { query: "OpenClaw", count: 3 }],
  ["时效+站点", { query: "OpenClaw", count: 3, freshness: "week", site: "github.com" }],
  ["单边日期", { query: "OpenClaw", count: 3, date_after: "2026-09-01" }],
  ["越界count", { query: "OpenClaw", count: 20 }],
];

for (const [name, args] of probes) {
  console.log(`\n===== ${name} =====`);
  console.log(JSON.stringify(await executeBaiduSearch(args, {}), null, 2));
}
