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
      <View style={styles.header}>
        <Text style={styles.eyebrow}>Early access</Text>
        <Text style={styles.title}>Receipt Lens Pro</Text>
        <Text style={styles.subtitle}>Subscription access is required during the pre-launch testing period.</Text>
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
