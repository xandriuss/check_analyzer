import { router } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

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
  const { height, width } = useWindowDimensions();
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
  const compact = height < 760 || width < 360;

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
    <SafeAreaView edges={["top", "bottom"]} style={styles.screen}>
      <Pressable
        accessibilityLabel="Skip subscription"
        onPress={() => router.replace("/(tabs)/history")}
        style={styles.closeButton}
      >
        <Text style={styles.closeText}>X</Text>
      </Pressable>

      <ScrollView
        contentContainerStyle={[styles.content, compact && styles.contentCompact]}
        showsVerticalScrollIndicator={false}
        style={styles.scroll}
      >
        <View style={[styles.header, compact && styles.headerCompact]}>
          <Text style={styles.eyebrow}>Early access</Text>
          <Text style={[styles.title, compact && styles.titleCompact]}>Receipt Lens Pro</Text>
          <Text style={[styles.subtitle, compact && styles.subtitleCompact]}>
            Unlock more scans, deeper insights, faster operations, and no ads.
          </Text>
        </View>

        <View style={[styles.periodSwitch, compact && styles.periodSwitchCompact]}>
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

        <View style={[styles.priceCard, compact && styles.priceCardCompact]}>
          <Text style={[styles.planTitle, compact && styles.planTitleCompact]}>
            {period === "monthly" ? "Monthly plan" : "Annual plan"}
          </Text>
          <Text style={[styles.pricePlaceholder, compact && styles.pricePlaceholderCompact]}>
            {storeLoading ? "Loading price..." : selectedPrice ?? "Price placeholder"}
          </Text>
          <Text style={[styles.planNote, compact && styles.planNoteCompact]}>
            {storeMode
              ? "Payment is handled by Google Play or the App Store."
              : period === "monthly"
                ? "Demo unlock for local testing. Real monthly billing can be enabled from the backend."
                : "Demo unlock for local testing. Real annual billing can be enabled from the backend."}
          </Text>
        </View>

        <View style={[styles.list, compact && styles.listCompact]}>
          {FEATURES.map((feature) => (
            <View key={feature} style={[styles.feature, compact && styles.featureCompact]}>
              <Text style={styles.check}>PRO</Text>
              <Text style={[styles.featureText, compact && styles.featureTextCompact]}>{feature}</Text>
            </View>
          ))}
        </View>

        <View style={[styles.freeBox, compact && styles.freeBoxCompact]}>
          <Text style={[styles.freeTitle, compact && styles.freeTitleCompact]}>
            {storeMode ? "Store billing" : "Pre-launch mode"}
          </Text>
          <Text style={[styles.freeText, compact && styles.freeTextCompact]}>
            {storeMode
              ? "Subscribe here when the store products are ready, or close this screen to keep using the free version."
              : "This build still uses demo unlock. Close this screen to keep using the free version."}
          </Text>
        </View>
      </ScrollView>

      <View style={[styles.footer, compact && styles.footerCompact]}>
        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Pressable
          disabled={loading || storeLoading || (storeMode && !isRevenueCatReady())}
          onPress={buy}
          style={[
            styles.buy,
            compact && styles.buyCompact,
            (loading || storeLoading || (storeMode && !isRevenueCatReady())) && styles.disabledButton,
          ]}
        >
          {loading ? (
            <ActivityIndicator color="#ffffff" />
          ) : (
            <Text style={[styles.buyText, compact && styles.buyTextCompact]}>
              {storeMode ? `Subscribe ${period === "monthly" ? "monthly" : "annually"}` : "Unlock Pro access"}
            </Text>
          )}
        </Pressable>

        {storeMode ? (
          <Pressable disabled={loading} onPress={restore} style={[styles.restoreButton, compact && styles.restoreButtonCompact]}>
            <Text style={styles.restoreText}>Restore purchases</Text>
          </Pressable>
        ) : null}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#101718",
  },
  scroll: {
    flex: 1,
  },
  content: {
    gap: 14,
    paddingHorizontal: 18,
    paddingTop: 58,
    paddingBottom: 16,
  },
  contentCompact: {
    gap: 10,
    paddingHorizontal: 14,
    paddingTop: 46,
    paddingBottom: 12,
  },
  closeButton: {
    position: "absolute",
    right: 16,
    top: 12,
    zIndex: 5,
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
    gap: 9,
  },
  headerCompact: {
    gap: 7,
  },
  eyebrow: {
    color: "#e45b2c",
    fontSize: 13,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  title: {
    color: "#ffffff",
    fontSize: 34,
    fontWeight: "900",
    lineHeight: 39,
  },
  titleCompact: {
    fontSize: 29,
    lineHeight: 34,
  },
  subtitle: {
    color: "#b8c4c2",
    fontSize: 16,
    lineHeight: 23,
  },
  subtitleCompact: {
    fontSize: 14,
    lineHeight: 20,
  },
  periodSwitch: {
    flexDirection: "row",
    minHeight: 46,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.54)",
    overflow: "hidden",
  },
  periodSwitchCompact: {
    minHeight: 42,
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
    gap: 7,
    borderRadius: 8,
    padding: 16,
    backgroundColor: "#ffffff",
  },
  priceCardCompact: {
    gap: 5,
    padding: 12,
  },
  planTitle: {
    color: "#1b2a2f",
    fontSize: 17,
    fontWeight: "900",
    textAlign: "center",
    textTransform: "uppercase",
  },
  planTitleCompact: {
    fontSize: 15,
  },
  pricePlaceholder: {
    color: "#55a83a",
    fontSize: 27,
    fontWeight: "900",
    lineHeight: 34,
    textAlign: "center",
  },
  pricePlaceholderCompact: {
    fontSize: 22,
    lineHeight: 28,
  },
  planNote: {
    color: "#657174",
    fontSize: 14,
    lineHeight: 19,
    textAlign: "center",
  },
  planNoteCompact: {
    fontSize: 12,
    lineHeight: 17,
  },
  list: {
    gap: 11,
  },
  listCompact: {
    gap: 7,
  },
  feature: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  featureCompact: {
    gap: 8,
  },
  check: {
    color: "#e45b2c",
    fontSize: 12,
    fontWeight: "900",
    lineHeight: 20,
  },
  featureText: {
    flex: 1,
    color: "#f3f7f5",
    fontSize: 16,
    fontWeight: "800",
    lineHeight: 21,
  },
  featureTextCompact: {
    fontSize: 14,
    lineHeight: 18,
  },
  freeBox: {
    gap: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#2f3d40",
    padding: 13,
    backgroundColor: "#182326",
  },
  freeBoxCompact: {
    padding: 10,
  },
  freeTitle: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "900",
  },
  freeTitleCompact: {
    fontSize: 15,
  },
  freeText: {
    color: "#b8c4c2",
    fontSize: 14,
    lineHeight: 20,
  },
  freeTextCompact: {
    fontSize: 12,
    lineHeight: 17,
  },
  footer: {
    gap: 8,
    paddingHorizontal: 18,
    paddingTop: 12,
    paddingBottom: 10,
    borderTopWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    backgroundColor: "#101718",
  },
  footerCompact: {
    gap: 6,
    paddingHorizontal: 14,
    paddingTop: 10,
  },
  buy: {
    minHeight: 54,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 8,
    backgroundColor: "#e45b2c",
  },
  buyCompact: {
    minHeight: 48,
  },
  disabledButton: {
    opacity: 0.55,
  },
  buyText: {
    color: "#ffffff",
    fontSize: 17,
    fontWeight: "900",
  },
  buyTextCompact: {
    fontSize: 15,
  },
  restoreButton: {
    minHeight: 38,
    alignItems: "center",
    justifyContent: "center",
  },
  restoreButtonCompact: {
    minHeight: 34,
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
