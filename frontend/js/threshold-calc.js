// Pure helper for computing the dynamic reorder threshold from tracker sales.
// When the "tracker" source is selected, the inventory grid reuses the 3 full
// past months of sales history it already fetched (no extra calls) and feeds
// them through the SAME formula the backend uses for the invoices source:
//   dailyAverage   = totalSales / totalDays
//   monthlyAverage = dailyAverage * 30
//   threshold      = ceil(monthlyAverage)
//   suggestedQty   = ceil(dailyAverage * orderPeriodDays / unitQty2) * unitQty2
// (No threshold multiplier is applied, matching the current backend behavior.)
function calcTrackerThreshold({
  monthSales,
  monthDays,
  orderPeriodDays,
  unitQty2,
  effectiveQty,
}) {
  const totalSales = monthSales.reduce((sum, s) => sum + (s || 0), 0);
  const totalDays = monthDays.reduce((sum, d) => sum + (d || 0), 0);
  const cq = unitQty2 > 0 ? unitQty2 : 1;

  const dailyAverage = totalDays > 0 ? totalSales / totalDays : 0;
  const monthlyAverage = dailyAverage * 30;
  const threshold = Math.ceil(monthlyAverage);
  const needsReorder = effectiveQty < threshold;

  let suggestedQty = 0;
  if (needsReorder) {
    const projectedNeed = dailyAverage * orderPeriodDays;
    suggestedQty = Math.ceil(projectedNeed / cq) * cq;
  }

  return {
    dailyAverage,
    monthlyAverage,
    threshold,
    needsReorder,
    suggestedQty,
  };
}

// Days covered by a tracker month range (inclusive of both endpoints).
function trackerMonthDays(fromIso, toIso) {
  const MS_PER_DAY = 86400000;
  return Math.round((new Date(toIso) - new Date(fromIso)) / MS_PER_DAY) + 1;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { calcTrackerThreshold, trackerMonthDays };
}
