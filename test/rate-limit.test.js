import { test } from "node:test";
import assert from "node:assert/strict";
import { createRateLimiter, normalizeQps } from "../lib/rate-limit.js";

test("createRateLimiter: spaces starts 1000/qps ms apart and frees slots as time passes", () => {
  let t = 10_000;
  const reserve = createRateLimiter(() => t);
  assert.deepEqual([reserve(1), reserve(1), reserve(1)], [0, 1000, 2000]);
  t += 2500; // the next free slot is at +3000
  assert.equal(reserve(1), 500);
  t += 5000; // idle long enough: no backlog carried over
  assert.equal(reserve(4), 0);
  assert.equal(reserve(4), 250);
});

test("createRateLimiter: qps 0 neither waits nor books a slot", () => {
  const reserve = createRateLimiter(() => 0);
  assert.equal(reserve(0), 0);
  assert.equal(reserve(0), 0);
  assert.equal(reserve(1), 0);
});

test("normalizeQps: accepts 0..100, falls back to 1 otherwise", () => {
  assert.equal(normalizeQps(3), 3);
  assert.equal(normalizeQps(0.5), 0.5);
  assert.equal(normalizeQps(0), 0);
  for (const bad of [undefined, null, "3", -1, 101, NaN]) assert.equal(normalizeQps(bad), 1, String(bad));
});
