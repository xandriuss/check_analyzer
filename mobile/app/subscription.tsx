import { router } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

import {
  getSubscriptionConfig,
  refreshRevenueCatSubscription,
  SubscriptionConfig,
  subscribeDemo,
} from "@/lib/api";
import { useAuth } from "@/context/auth";
import {
  BillingPeriod,
  isRevenueCatReady,
  loadRevenueCatStorePlans,
  purchaseRevenueCatPlan,
  restoreRevenueCatSubscription,
  RevenueCatStorePlan,
} from "@/lib/revenueCat";

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
  const { token, user, setCurrentUser } = useAuth();
  const [loading, setLoading] = useState(false);
  const [storeLoading, setStoreLoading] = useState(false);
  const [period, setPeriod] = useState<BillingPeriod>("monthly");
  const [config, setConfig] = useState<SubscriptionConfig | null>(null);
  const [storePlans, setStorePlans] = useState<Partial<Record<BillingPeriod, RevenueCatStorePlan>>>({});
  const [error, setError] = useState("");

  useEffect(() => {
    getSubscriptionConfig()
      .then(setConfig)
      .catch(() => setConfig(null));
  }, []);

  const storeMode = config?.mode === "store" && config.provider === "revenuecat";

  useEffect(() => {
    if (storeMode && !isRevenueCatReady()) {
      setError("Payment keys are not configured for this build yet.");
      return;
    }

    if (!storeMode || !user || !config) {
      return;
    }

    setStoreLoading(true);
    setError("");
    loadRevenueCatStorePlans(user, config)
      .then(setStorePlans)
      .catch((exception) => setError(exception.message || "Could not load subscription prices."))
      .finally(() => setStoreLoading(false));
  }, [config, storeMode, user]);

  const selectedPlan = useMemo(
    () => config?.plans.find((plan) => plan.period === period),
    [config?.plans, period],
  );
  const selectedStorePlan = storePlans[period];
  const selectedPrice = selectedStorePlan?.priceLabel ?? selectedPlan?.price_label;

  const buy = async () => {
    if (!token || !user || !config) return;

    setLoading(true);
    setError("");
    try {
      let updatedUser;

      if (storeMode) {
        if (!isRevenueCatReady()) {
          throw new Error("Payment keys are not configured for this build yet.");
        }

        const purchase = await purchaseRevenueCatPlan(user, config, period, selectedStorePlan);
        updatedUser = await refreshRevenueCatSubscription(token, purchase.appUserId);
      } else {
        updatedUser = await subscribeDemo(token);
      }

      setCurrentUser(updatedUser);
      router.replace("/(tabs)/history");
    } catch (exception: any) {
      if (exception?.userCancelled) {
        return;
      }
      setError(exception?.message || "Subscription could not be completed.");
    } finally {
      setLoading(false);
    }
  };

  const restore = async () => {
    if (!token || !user || !config) return;

    setLoading(true);
    setError("");
    try {
      const restored = await restoreRevenueCatSubscription(user, config);
      const updatedUser = await refreshRevenueCatSubscription(token, restored.appUserId);
      setCurrentUser(updatedUser);
      router.replace("/(tabs)/history");
    } catch (exception: any) {
      setError(exception?.message || "Could not restore purchases.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.screen}>
      <Pressable
        accessibilityLabel="Skip subscription"
        onPress={() => router.replace("/(tabs)/history")}
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
          {storeLoading ? "Loading price..." : selectedPrice ?? "Price placeholder"}
        </Text>
        <Text style={styles.planNote}>
          {storeMode
            ? "Payment is handled by Google Play or the App Store."
            : period === "monthly"
              ? "Demo unlock for local testing. Real monthly billing can be enabled from the backend."
              : "Demo unlock for local testing. Real annual billing can be enabled from the backend."}
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
        <Text style={styles.freeTitle}>{storeMode ? "Store billing" : "Pre-launch mode"}</Text>
        <Text style={styles.freeText}>
          {storeMode
            ? "Subscribe here when the store products are ready, or close this screen to keep using the free version."
            : "This build still uses demo unlock. Close this screen to keep using the free version."}
        </Text>
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Pressable
        disabled={loading || storeLoading || (storeMode && !isRevenueCatReady())}
        onPress={buy}
        style={[
          styles.buy,
          (loading || storeLoading || (storeMode && !isRevenueCatReady())) && styles.disabledButton,
        ]}
      >
        {loading ? (
          <ActivityIndicator color="#ffffff" />
        ) : (
          <Text style={styles.buyText}>
            {storeMode ? `Subscribe ${period === "monthly" ? "monthly" : "annually"}` : "Unlock Pro access"}
          </Text>
        )}
      </Pressable>

      {storeMode ? (
        <Pressable disabled={loading} onPress={restore} style={styles.restoreButton}>
          <Text style={styles.restoreText}>Restore purchases</Text>
        </Pressable>
      ) : null}
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
  disabledButton: {
    opacity: 0.55,
  },
  buyText: {
    color: "#ffffff",
    fontSize: 18,
    fontWeight: "900",
  },
  restoreButton: {
    minHeight: 42,
    alignItems: "center",
    justifyContent: "center",
  },
  restoreText: {
    color: "#f3f7f5",
    fontWeight: "900",
  },
  error: {
    color: "#ffb0a0",
    fontWeight: "800",
    lineHeight: 20,
  },
});
