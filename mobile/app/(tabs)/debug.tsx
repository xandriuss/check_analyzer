import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { API_URL, getReceipts, Receipt } from "@/lib/api";
import { useAuth } from "@/context/auth";

export default function DebugScreen() {
  const { token } = useAuth();
  const [latest, setLatest] = useState<Receipt | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!token) return;

    setLoading(true);
    setError("");

    try {
      const receipts = await getReceipts(token);
      setLatest(receipts.find((receipt) => receipt.scan_url) ?? receipts[0] ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load debug data");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const scanUri = latest?.scan_url ? `${API_URL}${latest.scan_url}?v=${latest.id}` : null;

  return (
    <ScrollView contentContainerStyle={styles.screen}>
      <View style={styles.header}>
        <View>
          <Text style={styles.eyebrow}>Temporary</Text>
          <Text style={styles.title}>Debug</Text>
        </View>
        <Pressable onPress={load} style={styles.refresh}>
          <Text style={styles.refreshText}>Refresh</Text>
        </Pressable>
      </View>

      {loading && <ActivityIndicator color="#e45b2c" />}
      {!!error && <Text style={styles.error}>{error}</Text>}

      {scanUri ? (
        <View style={styles.panel}>
          <Text style={styles.label}>Cropped image sent to AI/OCR</Text>
          <Image source={{ uri: scanUri }} style={styles.scan} />
          <Text style={styles.url}>{scanUri}</Text>
        </View>
      ) : (
        <Text style={styles.empty}>No cropped scan image yet. Scan one receipt first.</Text>
      )}

      {latest && (
        <View style={styles.panel}>
          <Text style={styles.label}>Latest parsed totals</Text>
          <Text style={styles.value}>Spent: {latest.total.toFixed(2)} EUR</Text>
          <Text style={styles.value}>Junk: {latest.junk_total.toFixed(2)} EUR</Text>
          {latest.items.map((item) => (
            <Text key={`${item.name}-${item.price}`} style={item.is_junk ? styles.junk : styles.item}>
              {item.name} - {item.price.toFixed(2)} EUR
            </Text>
          ))}
        </View>
      )}

      {latest && (
        <View style={styles.panel}>
          <Text style={styles.label}>AI raw output</Text>
          <Text selectable style={styles.rawOutput}>
            {latest.ai_output || "No AI output stored for this scan yet."}
          </Text>
        </View>
      )}

      {latest && (
        <View style={styles.panel}>
          <Text style={styles.label}>OCR raw output</Text>
          <Text selectable style={styles.rawOutput}>
            {latest.ocr_output || "No OCR output stored for this scan yet."}
          </Text>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    gap: 16,
    padding: 20,
    paddingTop: 56,
    backgroundColor: "#f6f4ef",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
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
  refresh: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#c9c2b5",
    paddingHorizontal: 12,
    paddingVertical: 9,
    backgroundColor: "#ffffff",
  },
  refreshText: {
    color: "#183f45",
    fontWeight: "800",
  },
  panel: {
    gap: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#e1dbcf",
    padding: 14,
    backgroundColor: "#ffffff",
  },
  label: {
    color: "#657174",
    fontSize: 13,
    fontWeight: "800",
    textTransform: "uppercase",
  },
  scan: {
    width: "100%",
    height: 520,
    resizeMode: "contain",
    backgroundColor: "#f2f2f2",
  },
  url: {
    color: "#657174",
    fontSize: 12,
  },
  value: {
    color: "#1b2a2f",
    fontSize: 16,
    fontWeight: "800",
  },
  item: {
    color: "#4f5a5d",
  },
  junk: {
    color: "#b3261e",
    fontWeight: "800",
  },
  rawOutput: {
    color: "#1b2a2f",
    fontFamily: "monospace",
    fontSize: 12,
    lineHeight: 17,
  },
  empty: {
    color: "#657174",
    fontSize: 16,
    textAlign: "center",
    paddingTop: 36,
  },
  error: {
    color: "#b3261e",
    fontWeight: "700",
  },
});
