// Spaces request starts at least 1000/qps ms apart, so parallel searches
// queue up instead of tripping Baidu's QPS limit (free tier: 1 QPS) and
// burning retries on 429s.

export const DEFAULT_QPS = 1;
export const MAX_QPS = 100;

// Configured qps (0 turns the limiter off) when it is a usable number, else
// DEFAULT_QPS.
export function normalizeQps(value) {
  return typeof value === "number" && value >= 0 && value <= MAX_QPS ? value : DEFAULT_QPS;
}

// Returns reserve(qps): books the next free start slot and returns how many
// ms the caller must wait before starting; 0 qps books nothing. `now` exists
// for tests.
export function createRateLimiter(now = Date.now) {
  let nextStart = 0;
  return function reserve(qps) {
    if (!(qps > 0)) return 0;
    const t = now();
    const start = Math.max(t, nextStart);
    nextStart = start + 1000 / qps;
    return start - t;
  };
}
