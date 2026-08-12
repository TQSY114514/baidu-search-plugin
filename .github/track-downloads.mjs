// 拉取 ClawHub 下载数据，追加到 downloads.json
// 幂等：同一天只记录一次；当天重复运行只更新数值不新增点
// 数据：series = [{date, downloads}] 累计下载数；values/dates 为平铺数组（供 shields.io sparkline 使用）
//
// 数据源说明（2026-08-12 起）：ClawHub 改版下线了公开 JSON API（/api/v1/packages/... 已 404），
// 改为抓详情页 SSR 内嵌数据，形如：...downloads:19,installs:3,stars:0,versions:4...
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const PAGE = 'https://clawhub.ai/tqsy114514/plugins/baidu-search-plugin';
const FILE = join(process.cwd(), 'downloads.json');

// 北京时间（Asia/Shanghai）的 YYYY-MM-DD
const fmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

async function fetchDownloads() {
  const res = await fetch(PAGE);
  if (!res.ok) throw new Error(`ClawHub page responded ${res.status}`);
  const html = await res.text();
  const m = html.match(/downloads:(\d+)/);
  if (!m) throw new Error('downloads count not found in ClawHub page');
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
