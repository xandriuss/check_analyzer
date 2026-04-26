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

export default function HistoryScreen() {
  const { token, user } = useAuth();
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [summary, setSummary] = useState<SubscriptionSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

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
