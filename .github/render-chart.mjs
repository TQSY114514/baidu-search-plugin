// 根据 downloads.json 渲染 chart.svg（累计下载曲线图，纯 Node 无依赖）
// 由 GitHub Actions 在更新数据后自动调用；也可本地手动运行
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const data = JSON.parse(readFileSync(join(root, 'downloads.json'), 'utf8'));
const series = data.series;

if (!series.length) {
  console.error('no data points in downloads.json');
  process.exit(1);
}

const W = 860, H = 300;
const padL = 58, padR = 24, padT = 48, padB = 44;
const iw = W - padL - padR, ih = H - padT - padB;

const values = series.map((p) => p.downloads);
const rawMax = Math.max(...values, 1);

// y 轴上限：取 1/2/5×10^n 的"好看"整数
function niceCeil(v) {
  const pow = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / pow;
  const nice = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return nice * pow;
}
const yMax = niceCeil(rawMax * 1.2);
const ticks = 5;

const X = (i) => padL + (series.length === 1 ? iw / 2 : (i / (series.length - 1)) * iw);
const Y = (v) => padT + ih - (v / yMax) * ih;
const fmt = (v) => (Number.isInteger(v) ? String(v) : v.toFixed(1));

// 水平网格 + y 刻度
let grid = '';
for (let t = 0; t <= ticks; t++) {
  const v = (yMax / ticks) * t;
  const yv = Y(v);
  grid += `<line x1="${padL}" y1="${yv.toFixed(1)}" x2="${W - padR}" y2="${yv.toFixed(1)}" stroke="#e5e7eb" stroke-width="1"/>`;
  grid += `<text x="${padL - 10}" y="${(yv + 4).toFixed(1)}" text-anchor="end" font-size="12" fill="#6b7280">${fmt(v)}</text>`;
}

// x 轴日期标签（最多约 8 个，首尾必显）
const step = Math.max(1, Math.ceil(series.length / 8));
let xlabels = '';
series.forEach((p, i) => {
  if (i % step === 0 || i === series.length - 1) {
    xlabels += `<text x="${X(i).toFixed(1)}" y="${H - padB + 20}" text-anchor="middle" font-size="12" fill="#6b7280">${p.date.slice(5)}</text>`;
  }
});

const pts = series.map((p, i) => `${X(i).toFixed(1)},${Y(p.downloads).toFixed(1)}`).join(' ');
const last = series[series.length - 1];
const lastX = X(series.length - 1), lastY = Y(last.downloads);

// 面积渐变（折线下方）
const area = `<path d="M ${pts} L ${lastX.toFixed(1)},${Y(0).toFixed(1)} L ${X(0).toFixed(1)},${Y(0).toFixed(1)} Z" fill="url(#grad)"/>`;

// 折线
const polyline = `<polyline points="${pts}" fill="none" stroke="#16a34a" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`;

// 数据点 + 最新点高亮
let dots = '';
series.forEach((p, i) => {
  const isLast = i === series.length - 1;
  const r = isLast ? 5 : 3.5;
  dots += `<circle cx="${X(i).toFixed(1)}" cy="${Y(p.downloads).toFixed(1)}" r="${r}" fill="${isLast ? '#166534' : '#16a34a'}" stroke="#ffffff" stroke-width="1.5"/>`;
});
dots += `<text x="${lastX.toFixed(1)}" y="${(lastY - 12).toFixed(1)}" text-anchor="middle" font-size="14" font-weight="bold" fill="#166534">${last.downloads}</text>`;

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Segoe UI, Arial, sans-serif" role="img" aria-label="ClawHub downloads trend: ${values.join(', ')}">
<defs>
<linearGradient id="grad" x1="0" y1="0" x2="0" y2="1">
<stop offset="0%" stop-color="#16a34a" stop-opacity="0.30"/>
<stop offset="100%" stop-color="#16a34a" stop-opacity="0"/>
</linearGradient>
</defs>
<rect width="${W}" height="${H}" fill="#ffffff" rx="12"/>
${grid}
${area}
${polyline}
${dots}
${xlabels}
<text x="${padL}" y="28" font-size="17" font-weight="bold" fill="#111827">ClawHub Downloads Trend</text>
<text x="${W - padR}" y="28" text-anchor="end" font-size="12" fill="#6b7280">@tqsy114514/baidu-search-plugin · updated ${data.updated.slice(0, 10)}</text>
</svg>
`;

writeFileSync(join(root, 'chart.svg'), svg);
console.log(`chart.svg written: ${series.length} points, yMax=${yMax}, latest=${last.downloads}`);
