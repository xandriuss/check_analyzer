import { router } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

import { getSubscriptionConfig, SubscriptionConfig, subscribeDemo } from "@/lib/api";
import { useAuth } from "@/context/auth";

type BillingPeriod = "monthly" | "annual";

const FEATURES = [
  "More precise receipt and junk-waste results",
  "Separate waste share for each receipt",
  "Monthly spending insight",
  "Monthly junk waste insight",
  "Faster operations",
  "More operations weekly",
  "No ads",
];

export default function SubscriptionScreen() {
  const { token, setCurrentUser } = useAuth();
  const [loading, setLoading] = useState(false);
  const [period, setPeriod] = useState<BillingPeriod>("monthly");
  const [config, setConfig] = useState<SubscriptionConfig | null>(null);

  useEffect(() => {
    getSubscriptionConfig()
      .then(setConfig)
      .catch(() => setConfig(null));
  }, []);

  const selectedPlan = useMemo(
    () => config?.plans.find((plan) => plan.period === period),
    [config?.plans, period],
  );

  const buy = async () => {
    if (!token) return;

    setLoading(true);
    try {
      const user = await subscribeDemo(token);
      setCurrentUser(user);
      router.replace("/(tabs)/camera");
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.screen}>
      <Pressable
        accessibilityLabel="Skip subscription"
        onPress={() => router.replace("/(tabs)/camera")}
        style={styles.closeButton}
      >
        <Text style={styles.closeText}>X</Text>
      </Pressable>

      <View style={styles.header}>
        <Text style={styles.eyebrow}>Early access</Text>
        <Text style={styles.title}>Receipt Lens Pro</Text>
        <Text style={styles.subtitle}>Unlock more scans, deeper insights, faster operations, and no ads.</Text>
      </View>

      <View style={styles.periodSwitch}>
        <Pressable
          onPress={() => setPeriod("monthly")}
          style={[styles.periodButton, period === "monthly" && styles.periodActive]}
        >
          <Text style={[styles.periodText, period === "monthly" && styles.periodTextActive]}>Monthly</Text>
        </Pressable>
        <Pressable
          onPress={() => setPeriod("annual")}
          style={[styles.periodButton, period === "annual" && styles.periodActive]}
        >
          <Text style={[styles.periodText, period === "annual" && styles.periodTextActive]}>Annual</Text>
        </Pressable>
      </View>

      <View style={styles.priceCard}>
        <Text style={styles.planTitle}>{period === "monthly" ? "Monthly plan" : "Annual plan"}</Text>
        <Text style={styles.pricePlaceholder}>
          {selectedPlan?.price_label ??
            (period === "monthly" ? "Monthly price placeholder" : "Annual price placeholder")}
        </Text>
        <Text style={styles.planNote}>
          {period === "monthly"
            ? "Billed every month after full launch."
            : "Billed once per year after full launch."}
        </Text>
      </View>

      <View style={styles.list}>
        {FEATURES.map((feature) => (
          <View key={feature} style={styles.feature}>
            <Text style={styles.check}>PRO</Text>
            <Text style={styles.featureText}>{feature}</Text>
          </View>
        ))}
      </View>

      <View style={styles.freeBox}>
        <Text style={styles.freeTitle}>Pre-launch mode</Text>
        <Text style={styles.freeText}>Free access will return later. For now, unlock Pro to test the full app.</Text>
      </View>

      <Pressable disabled={loading} onPress={buy} style={styles.buy}>
        {loading ? <ActivityIndicator color="#ffffff" /> : <Text style={styles.buyText}>Unlock Pro access</Text>}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    justifyContent: "space-between",
    padding: 22,
    paddingTop: 58,
    backgroundColor: "#101718",
  },
  closeButton: {
    position: "absolute",
    right: 18,
    top: 44,
    zIndex: 2,
    minHeight: 36,
    minWidth: 36,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.12)",
  },
  closeText: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "900",
  },
  header: {
    gap: 10,
    paddingTop: 34,
  },
  eyebrow: {
    color: "#e45b2c",
    fontSize: 13,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  title: {
    color: "#ffffff",
    fontSize: 36,
    fontWeight: "900",
  },
  subtitle: {
    color: "#b8c4c2",
    fontSize: 16,
    lineHeight: 23,
  },
  periodSwitch: {
    flexDirection: "row",
    minHeight: 48,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.54)",
    overflow: "hidden",
  },
  periodButton: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  periodActive: {
    backgroundColor: "#ffffff",
  },
  periodText: {
    color: "#ffffff",
    fontSize: 15,
    fontWeight: "900",
  },
  periodTextActive: {
    color: "#183f45",
  },
  priceCard: {
    gap: 8,
    borderRadius: 8,
    padding: 18,
    backgroundColor: "#ffffff",
  },
  planTitle: {
    color: "#1b2a2f",
    fontSize: 18,
    fontWeight: "900",
    textAlign: "center",
    textTransform: "uppercase",
  },
  pricePlaceholder: {
    color: "#55a83a",
    fontSize: 28,
    fontWeight: "900",
    textAlign: "center",
  },
  planNote: {
    color: "#657174",
    lineHeight: 20,
    textAlign: "center",
  },
  list: {
    gap: 14,
  },
  feature: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  check: {
    color: "#e45b2c",
    fontSize: 12,
    fontWeight: "900",
  },
  featureText: {
    flex: 1,
    color: "#f3f7f5",
    fontSize: 17,
    fontWeight: "800",
  },
  freeBox: {
    gap: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#2f3d40",
    padding: 14,
    backgroundColor: "#182326",
  },
  freeTitle: {
    color: "#ffffff",
    fontSize: 17,
    fontWeight: "900",
  },
  freeText: {
    color: "#b8c4c2",
    lineHeight: 20,
  },
  buy: {
    minHeight: 58,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 8,
    backgroundColor: "#e45b2c",
  },
  buyText: {
    color: "#ffffff",
    fontSize: 18,
    fontWeight: "900",
  },
});
