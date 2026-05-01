import { router, useFocusEffect } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { getReceipts, getSubscriptionSummary, Receipt, SubscriptionSummary } from "@/lib/api";
import { useAuth } from "@/context/auth";
import { SpendingGraph } from "@/components/SpendingGraph";
import { useI18n } from "@/lib/i18n";

type DataView = "receipts" | "graphs";

function receiptDepositTotal(receipt: Receipt) {
  return Math.max(receipt.deposit_total ?? 0, 0);
}

function receiptUsefulTotal(receipt: Receipt) {
  return Math.max(receipt.useful_total ?? receipt.total - receipt.junk_total - receiptDepositTotal(receipt), 0);
}

export default function HistoryScreen() {
  const { token, user } = useAuth();
  const { t } = useI18n();
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [summary, setSummary] = useState<SubscriptionSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [view, setView] = useState<DataView>("receipts");

  const totals = useMemo(
    () =>
      receipts.reduce(
        (sum, receipt) => ({
          spent: sum.spent + receipt.total,
          junk: sum.junk + receipt.junk_total,
          deposit: sum.deposit + receiptDepositTotal(receipt),
          useful: sum.useful + receiptUsefulTotal(receipt),
        }),
        { spent: 0, junk: 0, deposit: 0, useful: 0 },
      ),
    [receipts],
  );

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
          <Text style={[styles.title, user?.dark_mode && styles.darkText]}>{t("data")}</Text>
        </View>
      </View>

      <View style={styles.viewTabs}>
        {(["receipts", "graphs"] as DataView[]).map((value) => (
          <Pressable
            key={value}
            onPress={() => setView(value)}
            style={[styles.viewTab, view === value && styles.viewTabActive]}
          >
            <Text style={[styles.viewTabText, view === value && styles.viewTabTextActive]}>
              {value === "receipts" ? t("receiptInfo") : t("graphs")}
            </Text>
          </Pressable>
        ))}
      </View>

      {view === "receipts" && summary && (
        <View style={[styles.proPanel, user?.dark_mode && styles.darkPanel]}>
          {summary.locked ? (
            <>
              <Pressable onPress={() => router.push("/subscription")} style={styles.subscribeButton}>
                <Text style={styles.subscribeText}>{t("subscribe")}</Text>
              </Pressable>
              <Text style={[styles.locked, user?.dark_mode && styles.darkMuted]}>
                Unlock waste share, per-receipt junk percent, monthly totals, faster scans, and no ads.
              </Text>
            </>
          ) : (
            <>
              <Text style={[styles.label, user?.dark_mode && styles.darkMuted]}>{t("subscriptionInsights")}</Text>
              <Text style={[styles.value, user?.dark_mode && styles.darkText]}>
                {t("wasteShare")}: {summary.waste_percent.toFixed(1)}%
              </Text>
              <Text style={[styles.value, user?.dark_mode && styles.darkText]}>
                {t("monthlyTotal")}: {(summary.monthly_total ?? 0).toFixed(2)} EUR
              </Text>
              <Text style={[styles.value, user?.dark_mode && styles.darkText]}>
                {t("monthlyJunk")}: {(summary.monthly_junk_total ?? 0).toFixed(2)} EUR
              </Text>
              <Text style={[styles.value, user?.dark_mode && styles.darkText]}>
                {t("monthlyDeposit")}: {(summary.monthly_deposit_total ?? 0).toFixed(2)} EUR
              </Text>
              <Text style={[styles.value, user?.dark_mode && styles.darkText]}>
                {t("monthlyUseful")}: {(summary.monthly_useful_total ?? 0).toFixed(2)} EUR
              </Text>
              <Text style={[styles.value, user?.dark_mode && styles.darkText]}>
                {t("monthlyWasteShare")}: {(summary.monthly_waste_percent ?? 0).toFixed(1)}%
              </Text>
            </>
          )}
        </View>
      )}

      {view === "receipts" ? (
        <>
          <View style={styles.summary}>
            <View style={styles.summaryMetric}>
              <Text style={[styles.label, user?.dark_mode && styles.darkMuted]}>{t("totalSpent")}</Text>
              <Text style={styles.total}>{totals.spent.toFixed(2)} EUR</Text>
            </View>
            <View style={styles.summaryMetric}>
              <Text style={[styles.label, user?.dark_mode && styles.darkMuted]}>{t("junkWaste")}</Text>
              <Text style={styles.junk}>{totals.junk.toFixed(2)} EUR</Text>
            </View>
            <View style={styles.summaryMetric}>
              <Text style={[styles.label, user?.dark_mode && styles.darkMuted]}>{t("depositNeutral")}</Text>
              <Text style={styles.deposit}>{totals.deposit.toFixed(2)} EUR</Text>
            </View>
            <View style={styles.summaryMetric}>
              <Text style={[styles.label, user?.dark_mode && styles.darkMuted]}>{t("usefulSpending")}</Text>
              <Text style={styles.useful}>{totals.useful.toFixed(2)} EUR</Text>
            </View>
          </View>

          {loading && <ActivityIndicator color="#e45b2c" style={styles.loader} />}
          {!!error && <Text style={styles.error}>{error}</Text>}

          <FlatList
            contentContainerStyle={styles.list}
            data={receipts}
            keyExtractor={(item) => String(item.id)}
            ListEmptyComponent={!loading ? <Text style={styles.empty}>{t("noReceipts")}</Text> : null}
            renderItem={({ item }) => (
              <View style={[styles.receipt, user?.dark_mode && styles.darkPanel]}>
                <View style={styles.receiptTop}>
                  <Text style={[styles.receiptDate, user?.dark_mode && styles.darkText]}>
                    {item.date ? new Date(item.date).toLocaleDateString() : "Receipt"}
                  </Text>
                  <Text style={styles.receiptTotal}>{item.total.toFixed(2)} EUR</Text>
                </View>
                <Text style={styles.receiptJunk}>
                  {item.junk_total.toFixed(2)} EUR {t("junkFood").toLowerCase()}
                  {user?.is_subscriber ? ` - ${(item.waste_percent ?? 0).toFixed(1)}%` : ""}
                </Text>
                {receiptDepositTotal(item) > 0 && (
                  <Text style={[styles.receiptDeposit, user?.dark_mode && styles.darkMuted]}>
                    {receiptDepositTotal(item).toFixed(2)} EUR {t("depositNeutral").toLowerCase()}
                  </Text>
                )}
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
        </>
      ) : (
        <ScrollView contentContainerStyle={styles.graphWrap}>
          <SpendingGraph />
        </ScrollView>
      )}
    </View>
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
  viewTabs: {
    flexDirection: "row",
    marginHorizontal: 20,
    marginBottom: 14,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#ded8cc",
    overflow: "hidden",
    backgroundColor: "#ffffff",
  },
  viewTab: {
    flex: 1,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  viewTabActive: {
    backgroundColor: "#183f45",
  },
  viewTabText: {
    color: "#657174",
    fontSize: 14,
    fontWeight: "900",
  },
  viewTabTextActive: {
    color: "#ffffff",
  },
  summary: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
    marginHorizontal: 20,
    paddingVertical: 18,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: "#ded8cc",
  },
  summaryMetric: {
    width: "47%",
    minWidth: 132,
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
  deposit: {
    color: "#657174",
    fontSize: 24,
    fontWeight: "900",
  },
  useful: {
    color: "#1e6d66",
    fontSize: 24,
    fontWeight: "900",
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
  receiptDeposit: {
    color: "#657174",
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
  graphWrap: {
    paddingHorizontal: 20,
    paddingBottom: 96,
  },
});
