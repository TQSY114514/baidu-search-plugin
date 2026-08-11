// 拉取 ClawHub 下载数据，追加到 downloads.json
// 幂等：同一天只记录一次；当天重复运行只更新数值不新增点
// 数据：series = [{date, downloads}] 累计下载数；values/dates 为平铺数组（供 shields.io sparkline 使用）
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const API = 'https://clawhub.ai/api/v1/packages/@tqsy114514/baidu-search-plugin';
const FILE = join(process.cwd(), 'downloads.json');

// 北京时间（Asia/Shanghai）的 YYYY-MM-DD
const fmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

async function main() {
  const res = await fetch(API);
  if (!res.ok) throw new Error(`ClawHub API responded ${res.status}`);
  const pkg = await res.json();
  const downloads = pkg?.package?.stats?.downloads;
  if (typeof downloads !== 'number') {
    throw new Error('package.stats.downloads not found in API response');
  }

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
  data.updated = new Date().toISOString();

  writeFileSync(FILE, JSON.stringify(data, null, 2) + '\n');
  console.log(`Total points: ${data.series.length}, latest: ${downloads}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
