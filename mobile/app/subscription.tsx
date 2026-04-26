import { router } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

import { subscribeDemo } from "@/lib/api";
import { useAuth } from "@/context/auth";

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

  const continueFree = () => {
    router.replace("/(tabs)/camera");
  };

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
      <Pressable onPress={continueFree} style={styles.close}>
        <Text style={styles.closeText}>X</Text>
      </Pressable>

      <View style={styles.header}>
        <Text style={styles.eyebrow}>Upgrade</Text>
        <Text style={styles.title}>Receipt Lens Pro</Text>
        <Text style={styles.subtitle}>Keep the free plan or unlock better insight and smoother scanning.</Text>
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
        <Text style={styles.freeTitle}>Free plan</Text>
        <Text style={styles.freeText}>Includes ads, slightly slower operations, and limited weekly scans.</Text>
      </View>

      <Pressable disabled={loading} onPress={buy} style={styles.buy}>
        {loading ? <ActivityIndicator color="#ffffff" /> : <Text style={styles.buyText}>Start Pro</Text>}
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
  close: {
    position: "absolute",
    right: 18,
    top: 48,
    zIndex: 2,
    height: 36,
    width: 36,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.12)",
  },
  closeText: {
    color: "rgba(255,255,255,0.65)",
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
