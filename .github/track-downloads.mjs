// 拉取 ClawHub 下载数据，追加到 downloads.json
// 幂等：同一天只记录一次；当天重复运行只更新数值不新增点
// 数据：series = [{date, downloads}] 累计下载数；values/dates 为平铺数组（供 shields.io sparkline 使用）
//
// 数据源：优先用 ClawHub 公开 JSON API 的 package.stats.downloads；
// API 不可用时（2026-08 改版期间曾 404 过）退回抓详情页 SSR 内嵌数据，形如：
// ...downloads:19,installs:3,stars:0,versions:4...
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const API = 'https://clawhub.ai/api/v1/packages/@tqsy114514/baidu-search-plugin';
const PAGE = 'https://clawhub.ai/tqsy114514/plugins/baidu-search-plugin';
const FILE = join(process.cwd(), 'downloads.json');

// 北京时间（Asia/Shanghai）的 YYYY-MM-DD
const fmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

async function fetchDownloadsFromApi() {
  const res = await fetch(API);
  if (!res.ok) throw new Error(`ClawHub API responded ${res.status}`);
  const downloads = (await res.json())?.package?.stats?.downloads;
  if (!Number.isInteger(downloads)) throw new Error('package.stats.downloads missing from ClawHub API');
  return downloads;
}

async function fetchDownloads() {
  try {
    return await fetchDownloadsFromApi();
  } catch (err) {
    console.warn(`::warning::${err.message}; falling back to the plugin page`);
  }
  const res = await fetch(PAGE);
  if (!res.ok) throw new Error(`ClawHub page responded ${res.status}`);
  const html = await res.text();
  // Anchor on the adjacent stats fields so a "downloads:" belonging to some
  // other embedded package can't be picked up; fail loudly if the layout changes.
  const m = html.match(/downloads:(\d+),installs:\d+/);
  if (!m) throw new Error('downloads count not found in ClawHub page (page layout changed?)');
  return Number(m[1]);
}

async function main() {
  const downloads = await fetchDownloads();
  if (!Number.isInteger(downloads)) throw new Error('invalid downloads value');

  const today = fmt.format(new Date());

  const data = existsSync(FILE)
    ? JSON.parse(readFileSync(FILE, 'utf8'))
    : { package: '@tqsy114514/baidu-search-plugin', series: [] };

  const last = data.series[data.series.length - 1];
  // Downloads are cumulative; a drop means we scraped the wrong number.
  const previous = data.series.findLast((p) => p.date !== today);
  if (previous && downloads < previous.downloads) {
    throw new Error(`downloads went down (${previous.downloads} -> ${downloads}); refusing to record`);
  }
  if (last && last.date === today) {
    last.downloads = downloads; // 当天已记录：修正数值
    console.log(`Updated today entry: ${today} = ${downloads}`);
  } else {
    data.series.push({ date: today, downloads });
    console.log(`Appended: ${today} = ${downloads}`);
  }

  data.values = data.series.map((p) => p.downloads);
  data.dates = data.series.map((p) => p.date);
  data.latest = downloads; // 供 shields.io badge 直接读取（query=latest）
  data.updated = new Date().toISOString();

  writeFileSync(FILE, JSON.stringify(data, null, 2) + '\n');
  console.log(`Total points: ${data.series.length}, latest: ${downloads}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
