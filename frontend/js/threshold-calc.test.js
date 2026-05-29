// Run with: node --test frontend/js/threshold-calc.test.js
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { calcTrackerThreshold, trackerMonthDays } = require("./threshold-calc");

test("calcTrackerThreshold averages 3 months over their actual day count", () => {
  // 900 units across 90 days = 10/day = 300/month.
  const result = calcTrackerThreshold({
    monthSales: [300, 300, 300],
    monthDays: [30, 31, 29],
    orderPeriodDays: 28,
    unitQty2: 12,
    effectiveQty: 0,
  });
  assert.equal(result.dailyAverage, 900 / 90);
  assert.equal(result.monthlyAverage, (900 / 90) * 30);
  assert.equal(result.threshold, 300);
  assert.equal(result.needsReorder, true);
  // 10/day * 28 days = 280 -> ceil(280/12)=24 cases -> 288 units
  assert.equal(result.suggestedQty, 288);
});

test("calcTrackerThreshold rounds the monthly threshold up", () => {
  // 100 units / 90 days = 1.111/day -> monthly 33.33 -> ceil 34
  const result = calcTrackerThreshold({
    monthSales: [40, 30, 30],
    monthDays: [30, 30, 30],
    orderPeriodDays: 28,
    unitQty2: 1,
    effectiveQty: 50,
  });
  assert.equal(result.threshold, Math.ceil((100 / 90) * 30));
});

test("calcTrackerThreshold treats effectiveQty == threshold as sufficient", () => {
  const result = calcTrackerThreshold({
    monthSales: [300, 300, 300],
    monthDays: [30, 30, 30],
    orderPeriodDays: 28,
    unitQty2: 12,
    effectiveQty: 300,
  });
  assert.equal(result.threshold, 300);
  assert.equal(result.needsReorder, false);
  assert.equal(result.suggestedQty, 0);
});

test("calcTrackerThreshold returns zeros when there is no sales history", () => {
  const result = calcTrackerThreshold({
    monthSales: [0, 0, 0],
    monthDays: [30, 31, 30],
    orderPeriodDays: 28,
    unitQty2: 12,
    effectiveQty: 0,
  });
  assert.equal(result.threshold, 0);
  assert.equal(result.needsReorder, false);
  assert.equal(result.suggestedQty, 0);
});

test("calcTrackerThreshold guards against a zero day span", () => {
  const result = calcTrackerThreshold({
    monthSales: [100, 100, 100],
    monthDays: [0, 0, 0],
    orderPeriodDays: 28,
    unitQty2: 12,
    effectiveQty: 0,
  });
  assert.equal(result.dailyAverage, 0);
  assert.equal(result.threshold, 0);
});

test("calcTrackerThreshold rounds suggested qty up to whole cases", () => {
  // 360 units / 90 days = 4/day; order 28 days = 112; case=50 -> ceil(112/50)=3 -> 150
  const result = calcTrackerThreshold({
    monthSales: [120, 120, 120],
    monthDays: [30, 30, 30],
    orderPeriodDays: 28,
    unitQty2: 50,
    effectiveQty: 10,
  });
  assert.equal(result.suggestedQty, 150);
});

test("trackerMonthDays counts both endpoints", () => {
  assert.equal(trackerMonthDays("2026-01-01", "2026-01-31"), 31);
  assert.equal(trackerMonthDays("2026-02-01", "2026-02-28"), 28);
});
