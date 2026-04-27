import { router, useFocusEffect } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { getReceipts, getSubscriptionSummary, Receipt, SubscriptionSummary } from "@/lib/api";
import { useAuth } from "@/context/auth";

type ChartPeriod = "week" | "month" | "year";

export default function HistoryScreen() {
  const { token, user } = useAuth();
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [summary, setSummary] = useState<SubscriptionSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [period, setPeriod] = useState<ChartPeriod>("week");
  const [chartWidth, setChartWidth] = useState(0);

  const totals = useMemo(
    () =>
      receipts.reduce(
        (sum, receipt) => ({
          spent: sum.spent + receipt.total,
          junk: sum.junk + receipt.junk_total,
        }),
        { spent: 0, junk: 0 },
      ),
    [receipts],
  );
  const chartPoints = useMemo(() => buildChartPoints(receipts, period), [period, receipts]);

  const loadReceipts = useCallback(async () => {
    if (!token) return;

    setLoading(true);
    setError("");

    try {
      const [receiptData, summaryData] = await Promise.all([
        getReceipts(token),
        getSubscriptionSummary(token),
      ]);
      setReceipts(receiptData);
      setSummary(summaryData);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load data");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useFocusEffect(
    useCallback(() => {
      loadReceipts();
    }, [loadReceipts]),
  );

  return (
    <View style={[styles.screen, user?.dark_mode && styles.darkScreen]}>
      <View style={styles.header}>
        <View>
          <Text style={styles.eyebrow}>{user?.mode === "family" ? "Family mode" : "Personal mode"}</Text>
          <Text style={[styles.title, user?.dark_mode && styles.darkText]}>Data</Text>
        </View>
      </View>

      {summary && (
        <View style={[styles.proPanel, user?.dark_mode && styles.darkPanel]}>
          {summary.locked ? (
            <>
              <Pressable onPress={() => router.push("/subscription")} style={styles.subscribeButton}>
                <Text style={styles.subscribeText}>Subscribe</Text>
              </Pressable>
              <Text style={[styles.locked, user?.dark_mode && styles.darkMuted]}>
                Unlock waste share, per-receipt junk percent, monthly totals, faster scans, and no ads.
              </Text>
            </>
          ) : (
            <>
              <Text style={[styles.label, user?.dark_mode && styles.darkMuted]}>Subscription insights</Text>
              <Text style={[styles.value, user?.dark_mode && styles.darkText]}>
                Waste share: {summary.waste_percent.toFixed(1)}%
              </Text>
              <Text style={[styles.value, user?.dark_mode && styles.darkText]}>
                Monthly total: {(summary.monthly_total ?? 0).toFixed(2)} EUR
              </Text>
              <Text style={[styles.value, user?.dark_mode && styles.darkText]}>
                Monthly junk: {(summary.monthly_junk_total ?? 0).toFixed(2)} EUR
              </Text>
              <Text style={[styles.value, user?.dark_mode && styles.darkText]}>
                Monthly waste share: {(summary.monthly_waste_percent ?? 0).toFixed(1)}%
              </Text>
            </>
          )}
        </View>
      )}

      <View style={styles.summary}>
        <View>
          <Text style={[styles.label, user?.dark_mode && styles.darkMuted]}>Total spent</Text>
          <Text style={styles.total}>{totals.spent.toFixed(2)} EUR</Text>
        </View>
        <View>
          <Text style={[styles.label, user?.dark_mode && styles.darkMuted]}>Junk waste</Text>
          <Text style={styles.junk}>{totals.junk.toFixed(2)} EUR</Text>
        </View>
      </View>

      <View
        onLayout={(event) => setChartWidth(event.nativeEvent.layout.width)}
        style={[styles.chartPanel, user?.dark_mode && styles.darkPanel]}
      >
        <View style={styles.chartHeader}>
          <View>
            <Text style={[styles.chartTitle, user?.dark_mode && styles.darkText]}>Spending trend</Text>
            <Text style={[styles.chartSubtitle, user?.dark_mode && styles.darkMuted]}>
              Junk food vs useful food spending
            </Text>
          </View>
          <View style={styles.periodTabs}>
            {(["week", "month", "year"] as ChartPeriod[]).map((value) => (
              <Pressable
                key={value}
                onPress={() => setPeriod(value)}
                style={[styles.periodTab, period === value && styles.periodTabActive]}
              >
                <Text style={[styles.periodText, period === value && styles.periodTextActive]}>
                  {value === "week" ? "1W" : value === "month" ? "1M" : "1Y"}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
        <LineChart points={chartPoints} width={chartWidth - 28} dark={!!user?.dark_mode} />
      </View>

      {loading && <ActivityIndicator color="#e45b2c" style={styles.loader} />}
      {!!error && <Text style={styles.error}>{error}</Text>}

      <FlatList
        contentContainerStyle={styles.list}
        data={receipts}
        keyExtractor={(item) => String(item.id)}
        ListEmptyComponent={
          !loading ? <Text style={styles.empty}>No scanned receipts yet.</Text> : null
        }
        renderItem={({ item }) => (
          <View style={[styles.receipt, user?.dark_mode && styles.darkPanel]}>
            <View style={styles.receiptTop}>
              <Text style={[styles.receiptDate, user?.dark_mode && styles.darkText]}>
                {item.date ? new Date(item.date).toLocaleDateString() : "Receipt"}
              </Text>
              <Text style={styles.receiptTotal}>{item.total.toFixed(2)} EUR</Text>
            </View>
            <Text style={styles.receiptJunk}>
              {item.junk_total.toFixed(2)} EUR junk food
              {user?.is_subscriber ? ` - ${(item.waste_percent ?? 0).toFixed(1)}%` : ""}
            </Text>
            {item.items.map((product) => (
              <View key={`${item.id}-${product.name}-${product.price}`} style={styles.itemRow}>
                <Text style={[styles.itemName, user?.dark_mode && styles.darkMuted, product.is_junk && styles.itemJunk]}>
                  {product.name}
                </Text>
                <Text style={[styles.itemPrice, user?.dark_mode && styles.darkMuted, product.is_junk && styles.itemJunk]}>
                  {product.price.toFixed(2)} EUR
                </Text>
              </View>
            ))}
          </View>
        )}
      />
    </View>
  );
}

function buildChartPoints(receipts: Receipt[], period: ChartPeriod) {
  const now = new Date();
  const newestFirst = [...receipts].sort((a, b) => getReceiptTime(a) - getReceiptTime(b));
  const bucketCount = period === "year" ? 12 : period === "month" ? 30 : 7;
  const buckets = Array.from({ length: bucketCount }, (_, index) => {
    const date = new Date(now);
    if (period === "year") {
      date.setMonth(now.getMonth() - (bucketCount - 1 - index), 1);
      date.setHours(0, 0, 0, 0);
      return {
        key: `${date.getFullYear()}-${date.getMonth()}`,
        label: date.toLocaleDateString(undefined, { month: "short" }),
        junk: 0,
        useful: 0,
      };
    }

    date.setDate(now.getDate() - (bucketCount - 1 - index));
    date.setHours(0, 0, 0, 0);
    return {
      key: date.toDateString(),
      label: period === "week"
        ? date.toLocaleDateString(undefined, { weekday: "short" })
        : String(date.getDate()),
      junk: 0,
      useful: 0,
    };
  });

  const bucketMap = new Map(buckets.map((bucket) => [bucket.key, bucket]));

  newestFirst.forEach((receipt) => {
    const date = new Date(receipt.date ?? Date.now());
    const key = period === "year"
      ? `${date.getFullYear()}-${date.getMonth()}`
      : new Date(date.getFullYear(), date.getMonth(), date.getDate()).toDateString();
    const bucket = bucketMap.get(key);
    if (!bucket) return;

    const junk = Math.max(receipt.junk_total, 0);
    bucket.junk += junk;
    bucket.useful += Math.max(receipt.total - junk, 0);
  });

  return buckets;
}

function getReceiptTime(receipt: Receipt) {
  return new Date(receipt.date ?? 0).getTime();
}

function LineChart({
  points,
  width,
  dark,
}: {
  points: { label: string; junk: number; useful: number }[];
  width: number;
  dark: boolean;
}) {
  const chartHeight = 148;
  const chartWidth = Math.max(width, 1);
  const leftAxis = 36;
  const rightPadding = 8;
  const topPadding = 10;
  const bottomPadding = 24;
  const plotWidth = Math.max(chartWidth - leftAxis - rightPadding, 1);
  const plotHeight = chartHeight - topPadding - bottomPadding;
  const maxValue = Math.max(1, ...points.flatMap((point) => [point.junk, point.useful]));
  const niceMax = Math.ceil(maxValue / 10) * 10 || 10;
  const xStep = points.length > 1 ? plotWidth / (points.length - 1) : plotWidth;
  const toPoint = (value: number, index: number) => ({
    x: leftAxis + index * xStep,
    y: topPadding + plotHeight - (value / niceMax) * plotHeight,
  });
  const junk = points.map((point, index) => toPoint(point.junk, index));
  const useful = points.map((point, index) => toPoint(point.useful, index));
  const gridValues = [niceMax, niceMax / 2, 0];

  return (
    <View style={[styles.chart, { width: chartWidth, height: chartHeight }]}>
      {gridValues.map((value) => {
        const y = topPadding + plotHeight - (value / niceMax) * plotHeight;
        return (
          <View key={value} style={[styles.gridLine, { top: y, left: leftAxis, width: plotWidth }]}>
            <Text style={[styles.axisLabel, dark && styles.darkMuted]}>{Math.round(value)}</Text>
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
            { left: leftAxis + index * xStep - 14, top: chartHeight - 18 },
          ]}
        >
          {index === 0 || index === points.length - 1 || points.length <= 12 ? point.label : ""}
        </Text>
      ))}
      <View style={styles.legend}>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: "#b3261e" }]} />
          <Text style={[styles.legendText, dark && styles.darkMuted]}>Junk food</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: "#1e6d66" }]} />
          <Text style={[styles.legendText, dark && styles.darkMuted]}>Useful food spending</Text>
        </View>
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
          style={[styles.chartDot, { left: point.x - 3, top: point.y - 3, borderColor: color }]}
        />
      ))}
    </>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#f6f4ef",
    paddingTop: 56,
  },
  darkScreen: {
    backgroundColor: "#101718",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingBottom: 16,
  },
  eyebrow: {
    color: "#e45b2c",
    fontSize: 13,
    fontWeight: "800",
    textTransform: "uppercase",
  },
  title: {
    color: "#1b2a2f",
    fontSize: 34,
    fontWeight: "900",
  },
  summary: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 12,
    marginHorizontal: 20,
    paddingVertical: 18,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: "#ded8cc",
  },
  proPanel: {
    gap: 6,
    marginHorizontal: 20,
    marginTop: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#e1dbcf",
    padding: 14,
    backgroundColor: "#ffffff",
  },
  label: {
    color: "#657174",
    fontSize: 13,
    fontWeight: "700",
  },
  total: {
    color: "#183f45",
    fontSize: 26,
    fontWeight: "900",
  },
  junk: {
    color: "#b3261e",
    fontSize: 26,
    fontWeight: "900",
  },
  chartPanel: {
    gap: 14,
    marginHorizontal: 20,
    marginTop: 14,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#e1dbcf",
    padding: 14,
    backgroundColor: "#ffffff",
  },
  chartHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
  },
  chartTitle: {
    color: "#1b2a2f",
    fontSize: 18,
    fontWeight: "900",
  },
  chartSubtitle: {
    color: "#657174",
    fontSize: 12,
    fontWeight: "700",
  },
  periodTabs: {
    flexDirection: "row",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#ded8cc",
    overflow: "hidden",
  },
  periodTab: {
    minWidth: 34,
    minHeight: 30,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 8,
    backgroundColor: "#ffffff",
  },
  periodTabActive: {
    backgroundColor: "#183f45",
  },
  periodText: {
    color: "#657174",
    fontSize: 12,
    fontWeight: "900",
  },
  periodTextActive: {
    color: "#ffffff",
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
    left: -36,
    top: -8,
    width: 30,
    color: "#8b9496",
    fontSize: 10,
    fontWeight: "800",
    textAlign: "right",
  },
  xLabel: {
    position: "absolute",
    width: 28,
    color: "#8b9496",
    fontSize: 9,
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
    width: 6,
    height: 6,
    borderRadius: 3,
    borderWidth: 2,
    backgroundColor: "#ffffff",
  },
  legend: {
    position: "absolute",
    left: 36,
    bottom: 0,
    flexDirection: "row",
    gap: 12,
  },
  legendItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  legendText: {
    color: "#657174",
    fontSize: 11,
    fontWeight: "800",
  },
  loader: {
    marginTop: 18,
  },
  error: {
    margin: 20,
    color: "#b3261e",
    fontWeight: "700",
  },
  list: {
    gap: 12,
    padding: 20,
  },
  empty: {
    color: "#657174",
    fontSize: 16,
    textAlign: "center",
    paddingTop: 36,
  },
  receipt: {
    gap: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#e1dbcf",
    padding: 14,
    backgroundColor: "#ffffff",
  },
  receiptTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 12,
  },
  receiptDate: {
    color: "#1b2a2f",
    fontSize: 16,
    fontWeight: "900",
  },
  receiptTotal: {
    color: "#183f45",
    fontSize: 16,
    fontWeight: "900",
  },
  receiptJunk: {
    color: "#b3261e",
    fontWeight: "800",
  },
  itemRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 10,
  },
  itemName: {
    flex: 1,
    color: "#4f5a5d",
  },
  itemPrice: {
    color: "#4f5a5d",
    fontWeight: "700",
  },
  itemJunk: {
    color: "#b3261e",
  },
  value: {
    color: "#1b2a2f",
    fontSize: 16,
    fontWeight: "800",
  },
  locked: {
    color: "#657174",
    lineHeight: 20,
  },
  subscribeButton: {
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 8,
    backgroundColor: "#e45b2c",
  },
  subscribeText: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "900",
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
});
