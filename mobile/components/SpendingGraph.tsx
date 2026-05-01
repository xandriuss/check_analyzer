import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

import { getReceipts, Receipt } from "@/lib/api";
import { useAuth } from "@/context/auth";
import { type TranslationKey, useI18n } from "@/lib/i18n";

type ChartPeriod = "week" | "month" | "year";
type ChartPoint = {
  label: string;
  junk: number;
  useful: number;
  deposit: number;
};
type WasteCategory = "drinks" | "foods" | "candies" | "lottery";

const CATEGORY_COLORS: Record<WasteCategory, string> = {
  drinks: "#167a8b",
  foods: "#b3261e",
  candies: "#c04aa0",
  lottery: "#b7791f",
};

export function SpendingGraph() {
  const { token, user } = useAuth();
  const { t } = useI18n();
  const dark = Boolean(user?.dark_mode);
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [period, setPeriod] = useState<ChartPeriod>("week");
  const [chartWidth, setChartWidth] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const chartPoints = useMemo(() => buildChartPoints(receipts, period), [period, receipts]);
  const categoryTotals = useMemo(() => buildWasteCategoryTotals(receiptsInPeriod(receipts, period), t), [period, receipts, t]);
  const totals = useMemo(
    () =>
      chartPoints.reduce(
        (sum, point) => ({
          junk: sum.junk + point.junk,
          useful: sum.useful + point.useful,
          deposit: sum.deposit + point.deposit,
        }),
        { junk: 0, useful: 0, deposit: 0 },
      ),
    [chartPoints],
  );

  const loadReceipts = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError("");

    try {
      setReceipts(await getReceipts(token));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load graph");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    loadReceipts();
  }, [loadReceipts]);

  return (
    <View style={styles.screen}>
      <View style={styles.periodTabs}>
        {(["week", "month", "year"] as ChartPeriod[]).map((value) => (
          <Pressable
            key={value}
            onPress={() => setPeriod(value)}
            style={[styles.periodTab, period === value && styles.periodTabActive]}
          >
            <Text style={[styles.periodText, period === value && styles.periodTextActive]}>
              {value === "week" ? t("week") : value === "month" ? t("month") : t("year")}
            </Text>
          </Pressable>
        ))}
      </View>

      <View style={[styles.summaryGrid, dark && styles.darkPanel]}>
        <View style={styles.summaryMetric}>
          <Text style={[styles.label, dark && styles.darkMuted]}>{t("junkFood")}</Text>
          <Text style={styles.junk}>{totals.junk.toFixed(2)} EUR</Text>
        </View>
        <View style={styles.summaryMetric}>
          <Text style={[styles.label, dark && styles.darkMuted]}>{t("usefulFood")}</Text>
          <Text style={styles.useful}>{totals.useful.toFixed(2)} EUR</Text>
        </View>
        <View style={styles.summaryMetric}>
          <Text style={[styles.label, dark && styles.darkMuted]}>{t("depositNeutral")}</Text>
          <Text style={styles.deposit}>{totals.deposit.toFixed(2)} EUR</Text>
        </View>
      </View>

      <View style={[styles.categoryPanel, dark && styles.darkPanel]}>
        <View>
          <Text style={[styles.chartTitle, dark && styles.darkText]}>{t("wasteByCategory")}</Text>
          <Text style={[styles.chartSubtitle, dark && styles.darkMuted]}>{t("wasteByCategoryHelp")}</Text>
        </View>
        <View style={styles.categoryList}>
          {categoryTotals.map((category) => (
            <View key={category.key} style={styles.categoryItem}>
              <View style={styles.categoryTop}>
                <Text style={[styles.categoryName, dark && styles.darkText]}>{category.label}</Text>
                <Text style={[styles.categoryAmount, { color: category.color }]}>
                  {category.total.toFixed(2)} EUR
                </Text>
              </View>
              <View style={[styles.categoryTrack, dark && styles.darkTrack]}>
                <View
                  style={[
                    styles.categoryFill,
                    { width: `${category.share}%`, backgroundColor: category.color },
                  ]}
                />
              </View>
            </View>
          ))}
        </View>
      </View>

      <View
        onLayout={(event) => setChartWidth(event.nativeEvent.layout.width)}
        style={[styles.chartPanel, dark && styles.darkPanel]}
      >
        <View>
          <Text style={[styles.chartTitle, dark && styles.darkText]}>{t("spendingTrend")}</Text>
          <Text style={[styles.chartSubtitle, dark && styles.darkMuted]}>{t("graphHelp")}</Text>
        </View>
        <LineChart
          dark={dark}
          junkLabel={t("junkFood")}
          points={chartPoints}
          usefulLabel={t("usefulFood")}
          width={chartWidth - 28}
        />
      </View>

      {loading && <ActivityIndicator color="#e45b2c" />}
      {!!error && <Text style={styles.error}>{error}</Text>}
      {!loading && receipts.length === 0 && (
        <Text style={[styles.empty, dark && styles.darkMuted]}>{t("scanToGraph")}</Text>
      )}
    </View>
  );
}

function receiptsInPeriod(receipts: Receipt[], period: ChartPeriod) {
  const sorted = [...receipts].sort((a, b) => getReceiptTime(a) - getReceiptTime(b));
  if (sorted.length === 0) {
    return [];
  }

  const now = startOfDay(new Date());
  const maxDays = period === "week" ? 7 : period === "month" ? 30 : 365;
  const earliestAllowed = addDays(now, -(maxDays - 1));
  return sorted.filter((receipt) => getReceiptDate(receipt) >= earliestAllowed);
}

function buildWasteCategoryTotals(receipts: Receipt[], t: (key: TranslationKey) => string) {
  const totals: Record<WasteCategory, number> = {
    drinks: 0,
    foods: 0,
    candies: 0,
    lottery: 0,
  };

  receipts.forEach((receipt) => {
    receipt.items.forEach((item) => {
      const category = detectWasteCategory(item.name, item.is_junk);
      if (!category) return;

      const price = Number(item.price) || 0;
      if (price >= 0 && !item.is_junk) return;

      totals[category] += price;
    });
  });

  const normalized = (Object.keys(totals) as WasteCategory[]).map((key) => ({
    key,
    label: t(key),
    total: Math.max(totals[key], 0),
    color: CATEGORY_COLORS[key],
    share: 0,
  }));
  const maxTotal = Math.max(...normalized.map((category) => category.total), 0.01);

  return normalized
    .map((category) => ({
      ...category,
      share: Math.max((category.total / maxTotal) * 100, category.total > 0 ? 4 : 0),
    }))
    .sort((a, b) => b.total - a.total);
}

function detectWasteCategory(name: string, isJunk: boolean): WasteCategory | null {
  const normalized = normalizeName(name);

  if (hasAny(normalized, [
    "loterija",
    "bilietas",
    "bilietai",
    "loto",
    "vikinglotto",
    "teleloto",
    "eurojackpot",
    "kenoloto",
    "superloto",
    "nutrinamas",
    "scratch",
  ])) {
    return "lottery";
  }

  if (hasAny(normalized, [
    "coca cola",
    "coca",
    "cola",
    "c0la",
    "pepsi",
    "fanta",
    "sprite",
    "red bull",
    "monster",
    "battery",
    "dynamit",
    "prime",
    "oshee",
    "energinis",
    "energetinis",
    "gazuotas",
    "limonadas",
    "alus",
    "sidras",
    "degtine",
    "vynas",
    "likeris",
    "kokteilis",
  ])) {
    return "drinks";
  }

  if (hasAny(normalized, [
    "guminukai",
    "gummy",
    "saldainiai",
    "saldainis",
    "sokoladas",
    "chocolate",
    "kinder",
    "haribo",
    "candy pop",
    "roshen",
    "milka",
    "snickers",
    "mars",
    "twix",
    "bounty",
    "skittles",
    "rafaello",
    "ferrero",
    "ciulpinukai",
    "ledinukai",
  ])) {
    return "candies";
  }

  if (hasAny(normalized, [
    "traskuciai",
    "cipsai",
    "chips",
    "nacho",
    "cheese balls",
    "taffel",
    "estrella",
    "lays",
    "pringles",
    "pyragas",
    "bandel",
    "spurga",
    "sausainiai",
    "vafliai",
    "pica",
    "burger",
    "mesainis",
    "kebabas",
    "desreles",
    "desra",
    "saliami",
  ])) {
    return "foods";
  }

  return isJunk ? "foods" : null;
}

function normalizeName(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hasAny(value: string, words: string[]) {
  return words.some((word) => value.includes(word));
}

function buildChartPoints(receipts: Receipt[], period: ChartPeriod): ChartPoint[] {
  const sorted = [...receipts].sort((a, b) => getReceiptTime(a) - getReceiptTime(b));
  if (sorted.length === 0) {
    return [];
  }

  const now = startOfDay(new Date());
  const maxDays = period === "week" ? 7 : period === "month" ? 30 : 365;
  const earliestAllowed = addDays(now, -(maxDays - 1));
  const inRange = sorted.filter((receipt) => getReceiptDate(receipt) >= earliestAllowed);

  if (period === "year") {
    return buildMonthBuckets(inRange.length ? inRange : sorted.slice(-1), now);
  }

  return buildDayBuckets(inRange.length ? inRange : sorted.slice(-1), now, maxDays);
}

function buildDayBuckets(receipts: Receipt[], now: Date, maxDays: number): ChartPoint[] {
  const firstReceiptDay = startOfDay(getReceiptDate(receipts[0]));
  const start = firstReceiptDay > addDays(now, -(maxDays - 1)) ? firstReceiptDay : addDays(now, -(maxDays - 1));
  const dayCount = Math.max(1, Math.min(maxDays, differenceInDays(start, now) + 1));
  const buckets = Array.from({ length: dayCount }, (_, index) => {
    const date = addDays(start, index);
    return {
      key: date.toDateString(),
      label: dayCount <= 10 ? date.toLocaleDateString(undefined, { weekday: "short" }) : String(date.getDate()),
      junk: 0,
      useful: 0,
      deposit: 0,
    };
  });
  const bucketMap = new Map(buckets.map((bucket) => [bucket.key, bucket]));

  receipts.forEach((receipt) => {
    const date = startOfDay(getReceiptDate(receipt));
    const bucket = bucketMap.get(date.toDateString());
    if (!bucket) return;
    addReceiptToBucket(bucket, receipt);
  });

  return buckets;
}

function buildMonthBuckets(receipts: Receipt[], now: Date): ChartPoint[] {
  const firstReceipt = getReceiptDate(receipts[0]);
  const firstMonth = new Date(firstReceipt.getFullYear(), firstReceipt.getMonth(), 1);
  const latestAllowed = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthCount = Math.max(1, Math.min(12, differenceInMonths(firstMonth, latestAllowed) + 1));
  const start = addMonths(latestAllowed, -(monthCount - 1));
  const buckets = Array.from({ length: monthCount }, (_, index) => {
    const date = addMonths(start, index);
    return {
      key: `${date.getFullYear()}-${date.getMonth()}`,
      label: date.toLocaleDateString(undefined, { month: "short" }),
      junk: 0,
      useful: 0,
      deposit: 0,
    };
  });
  const bucketMap = new Map(buckets.map((bucket) => [bucket.key, bucket]));

  receipts.forEach((receipt) => {
    const date = getReceiptDate(receipt);
    const bucket = bucketMap.get(`${date.getFullYear()}-${date.getMonth()}`);
    if (!bucket) return;
    addReceiptToBucket(bucket, receipt);
  });

  return buckets;
}

function addReceiptToBucket(bucket: ChartPoint, receipt: Receipt) {
  const junk = Math.max(receipt.junk_total, 0);
  const deposit = Math.max(receipt.deposit_total ?? 0, 0);
  bucket.junk += junk;
  bucket.deposit += deposit;
  bucket.useful += Math.max(receipt.useful_total ?? receipt.total - junk - deposit, 0);
}

function getReceiptDate(receipt: Receipt) {
  return startOfDay(new Date(receipt.date ?? Date.now()));
}

function getReceiptTime(receipt: Receipt) {
  return getReceiptDate(receipt).getTime();
}

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date: Date, days: number) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function addMonths(date: Date, months: number) {
  const result = new Date(date);
  result.setMonth(result.getMonth() + months, 1);
  return result;
}

function differenceInDays(start: Date, end: Date) {
  return Math.round((end.getTime() - start.getTime()) / 86400000);
}

function differenceInMonths(start: Date, end: Date) {
  return (end.getFullYear() - start.getFullYear()) * 12 + end.getMonth() - start.getMonth();
}

function LineChart({
  points,
  width,
  dark,
  junkLabel,
  usefulLabel,
}: {
  points: ChartPoint[];
  width: number;
  dark: boolean;
  junkLabel: string;
  usefulLabel: string;
}) {
  const chartHeight = 230;
  const chartWidth = Math.max(width, 1);
  const leftAxis = 42;
  const rightPadding = 16;
  const topPadding = 18;
  const bottomPadding = 54;
  const plotWidth = Math.max(chartWidth - leftAxis - rightPadding, 1);
  const plotHeight = chartHeight - topPadding - bottomPadding;
  const maxValue = Math.max(1, ...points.flatMap((point) => [point.junk, point.useful]));
  const niceMax = niceAxisMax(maxValue);
  const xStep = points.length > 1 ? plotWidth / (points.length - 1) : plotWidth / 2;
  const toPoint = (value: number, index: number) => ({
    x: leftAxis + (points.length > 1 ? index * xStep : plotWidth / 2),
    y: topPadding + plotHeight - (value / niceMax) * plotHeight,
  });
  const useful = points.map((point, index) => toPoint(point.useful, index));
  const junk = points.map((point, index) => toPoint(point.junk, index));

  return (
    <View style={[styles.chart, { width: chartWidth, height: chartHeight }]}>
      {[niceMax, niceMax / 2, 0].map((value) => {
        const y = topPadding + plotHeight - (value / niceMax) * plotHeight;
        return (
          <View key={value} style={[styles.gridLine, { top: y, left: leftAxis, width: plotWidth }]}>
            <Text style={[styles.axisLabel, dark && styles.darkMuted]}>{formatAxis(value)}</Text>
          </View>
        );
      })}
      <Polyline points={useful} color="#1e6d66" />
      <Polyline points={junk} color="#b3261e" />
      {points.map((point, index) => (
        <Text
          key={`${point.label}-${index}`}
          numberOfLines={1}
          style={[
            styles.xLabel,
            dark && styles.darkMuted,
            { left: leftAxis + (points.length > 1 ? index * xStep : plotWidth / 2) - 18, top: chartHeight - 44 },
          ]}
        >
          {shouldShowXLabel(points.length, index) ? point.label : ""}
        </Text>
      ))}
      <View style={styles.legend}>
        <LegendItem color="#b3261e" label={junkLabel} dark={dark} />
        <LegendItem color="#1e6d66" label={usefulLabel} dark={dark} />
      </View>
    </View>
  );
}

function Polyline({ points, color }: { points: { x: number; y: number }[]; color: string }) {
  return (
    <>
      {points.slice(1).map((point, index) => {
        const previous = points[index];
        const dx = point.x - previous.x;
        const dy = point.y - previous.y;
        const length = Math.sqrt(dx * dx + dy * dy);
        const angle = Math.atan2(dy, dx);
        return (
          <View
            key={`${color}-${index}`}
            style={[
              styles.chartSegment,
              {
                left: previous.x,
                top: previous.y,
                width: length,
                backgroundColor: color,
                transform: [{ rotateZ: `${angle}rad` }],
              },
            ]}
          />
        );
      })}
      {points.map((point, index) => (
        <View
          key={`${color}-dot-${index}`}
          style={[styles.chartDot, { left: point.x - 4, top: point.y - 4, borderColor: color }]}
        />
      ))}
    </>
  );
}

function LegendItem({ color, label, dark }: { color: string; label: string; dark: boolean }) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.legendDot, { backgroundColor: color }]} />
      <Text style={[styles.legendText, dark && styles.darkMuted]}>{label}</Text>
    </View>
  );
}

function niceAxisMax(value: number) {
  if (value <= 10) return 10;
  if (value <= 50) return Math.ceil(value / 10) * 10;
  if (value <= 100) return Math.ceil(value / 25) * 25;
  return Math.ceil(value / 50) * 50;
}

function formatAxis(value: number) {
  return value >= 1000 ? `${Math.round(value / 1000)}k` : String(Math.round(value));
}

function shouldShowXLabel(length: number, index: number) {
  if (length <= 8) return true;
  if (index === 0 || index === length - 1) return true;
  return index % Math.ceil(length / 5) === 0;
}

const styles = StyleSheet.create({
  screen: {
    gap: 16,
  },
  periodTabs: {
    flexDirection: "row",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#ded8cc",
    overflow: "hidden",
    backgroundColor: "#ffffff",
  },
  periodTab: {
    flex: 1,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  periodTabActive: {
    backgroundColor: "#183f45",
  },
  periodText: {
    color: "#657174",
    fontSize: 14,
    fontWeight: "900",
  },
  periodTextActive: {
    color: "#ffffff",
  },
  summaryGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#e1dbcf",
    padding: 14,
    backgroundColor: "#ffffff",
  },
  summaryMetric: {
    minWidth: 116,
    flexGrow: 1,
  },
  label: {
    color: "#657174",
    fontSize: 12,
    fontWeight: "800",
  },
  junk: {
    color: "#b3261e",
    fontSize: 22,
    fontWeight: "900",
  },
  useful: {
    color: "#1e6d66",
    fontSize: 22,
    fontWeight: "900",
  },
  deposit: {
    color: "#657174",
    fontSize: 22,
    fontWeight: "900",
  },
  categoryPanel: {
    gap: 14,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#e1dbcf",
    padding: 14,
    backgroundColor: "#ffffff",
  },
  categoryList: {
    gap: 12,
  },
  categoryItem: {
    gap: 7,
  },
  categoryTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  categoryName: {
    flex: 1,
    color: "#1b2a2f",
    fontSize: 14,
    fontWeight: "900",
  },
  categoryAmount: {
    fontSize: 14,
    fontWeight: "900",
  },
  categoryTrack: {
    height: 9,
    overflow: "hidden",
    borderRadius: 999,
    backgroundColor: "#eee8dc",
  },
  categoryFill: {
    height: "100%",
    borderRadius: 999,
  },
  chartPanel: {
    gap: 18,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#e1dbcf",
    padding: 14,
    backgroundColor: "#ffffff",
  },
  chartTitle: {
    color: "#1b2a2f",
    fontSize: 20,
    fontWeight: "900",
  },
  chartSubtitle: {
    color: "#657174",
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "700",
  },
  chart: {
    position: "relative",
    overflow: "hidden",
  },
  gridLine: {
    position: "absolute",
    height: 1,
    backgroundColor: "#e8e1d5",
  },
  axisLabel: {
    position: "absolute",
    left: -42,
    top: -8,
    width: 34,
    color: "#8b9496",
    fontSize: 10,
    fontWeight: "800",
    textAlign: "right",
  },
  xLabel: {
    position: "absolute",
    width: 36,
    color: "#8b9496",
    fontSize: 10,
    fontWeight: "800",
    textAlign: "center",
  },
  chartSegment: {
    position: "absolute",
    height: 3,
    borderRadius: 3,
    transformOrigin: "0px 1.5px",
  },
  chartDot: {
    position: "absolute",
    width: 8,
    height: 8,
    borderRadius: 4,
    borderWidth: 2,
    backgroundColor: "#ffffff",
  },
  legend: {
    position: "absolute",
    left: 42,
    right: 0,
    bottom: 0,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  legendItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  legendText: {
    color: "#657174",
    fontSize: 12,
    fontWeight: "800",
  },
  error: {
    color: "#b3261e",
    fontWeight: "800",
  },
  empty: {
    color: "#657174",
    textAlign: "center",
    lineHeight: 21,
  },
  darkPanel: {
    backgroundColor: "#182326",
    borderColor: "#2f3d40",
  },
  darkText: {
    color: "#f3f7f5",
  },
  darkMuted: {
    color: "#b8c4c2",
  },
  darkTrack: {
    backgroundColor: "#2f3d40",
  },
});
