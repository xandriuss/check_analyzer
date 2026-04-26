import { useState } from "react";
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";

import { updateSettings } from "@/lib/api";
import { useAuth } from "@/context/auth";

export default function SettingsScreen() {
  const { token, user, setCurrentUser, signOut } = useAuth();
  const [term, setTerm] = useState("");
  const [saving, setSaving] = useState(false);
  const exclusions = user?.junk_exclusions ?? [];
  const dark = Boolean(user?.dark_mode);

  const save = async (next: { dark_mode?: boolean; junk_exclusions?: string[] }) => {
    if (!token) return;
    setSaving(true);
    try {
      const updated = await updateSettings(token, next);
      setCurrentUser(updated);
    } catch (err) {
      Alert.alert("Settings error", err instanceof Error ? err.message : "Could not save settings");
    } finally {
      setSaving(false);
    }
  };

  const addExclusion = () => {
    const value = term.trim();
    if (!value) return;

    Alert.alert(
      "Remove from junk tracking?",
      "This can make the app less useful for saving money, because these purchases will no longer count toward wasted junk spending.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove from junk",
          style: "destructive",
          onPress: () => {
            setTerm("");
            save({ junk_exclusions: [...exclusions, value] });
          },
        },
      ],
    );
  };

  const removeExclusion = (value: string) => {
    save({ junk_exclusions: exclusions.filter((item) => item !== value) });
  };

  return (
    <ScrollView style={[styles.container, dark && styles.darkScreen]} contentContainerStyle={styles.screen}>
      <Text style={styles.eyebrow}>Preferences</Text>
      <Text style={[styles.title, dark && styles.darkText]}>Settings</Text>

      <View style={[styles.panel, dark && styles.darkPanel]}>
        <View style={styles.row}>
          <View style={styles.rowText}>
            <Text style={[styles.panelTitle, dark && styles.darkText]}>Dark mode</Text>
            <Text style={[styles.muted, dark && styles.darkMuted]}>Use a dark background with light text.</Text>
          </View>
          <Switch value={dark} onValueChange={(value) => save({ dark_mode: value })} />
        </View>
      </View>

      <View style={[styles.panel, dark && styles.darkPanel]}>
        <Text style={[styles.panelTitle, dark && styles.darkText]}>Junk exclusions</Text>
        <Text style={[styles.warning, dark && styles.darkMuted]}>
          Warning: removing words like cola, beer, chips, or gummies can reduce the app ability to help you save money.
        </Text>
        <View style={styles.inputRow}>
          <TextInput
            onChangeText={setTerm}
            placeholder="Example: cola"
            placeholderTextColor={dark ? "#83918f" : "#8b9290"}
            style={[styles.input, dark && styles.darkInput]}
            value={term}
          />
          <Pressable disabled={saving} onPress={addExclusion} style={styles.button}>
            <Text style={styles.buttonText}>Add</Text>
          </Pressable>
        </View>

        {exclusions.map((item) => (
          <View key={item} style={styles.chipRow}>
            <Text style={[styles.chipText, dark && styles.darkText]}>{item}</Text>
            <Pressable onPress={() => removeExclusion(item)}>
              <Text style={styles.remove}>Remove</Text>
            </Pressable>
          </View>
        ))}
      </View>

      <Pressable onPress={signOut} style={styles.logout}>
        <Text style={styles.logoutText}>Log out</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: "#f6f4ef",
    flex: 1,
  },
  screen: {
    flexGrow: 1,
    gap: 16,
    padding: 20,
    paddingTop: 56,
  },
  darkScreen: {
    backgroundColor: "#101718",
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
  panel: {
    gap: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#e1dbcf",
    padding: 14,
    backgroundColor: "#ffffff",
  },
  darkPanel: {
    backgroundColor: "#182326",
    borderColor: "#2f3d40",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  rowText: {
    flex: 1,
  },
  panelTitle: {
    color: "#1b2a2f",
    fontSize: 18,
    fontWeight: "900",
  },
  muted: {
    color: "#657174",
    lineHeight: 20,
  },
  warning: {
    color: "#8a4b16",
    lineHeight: 20,
    fontWeight: "700",
  },
  inputRow: {
    flexDirection: "row",
    gap: 10,
  },
  input: {
    flex: 1,
    minHeight: 48,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#d5d0c4",
    paddingHorizontal: 12,
    backgroundColor: "#ffffff",
    color: "#1b2a2f",
  },
  darkInput: {
    backgroundColor: "#101718",
    borderColor: "#334244",
    color: "#f3f7f5",
  },
  button: {
    minWidth: 72,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 8,
    backgroundColor: "#e45b2c",
  },
  buttonText: {
    color: "#ffffff",
    fontWeight: "900",
  },
  chipRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    paddingVertical: 8,
  },
  chipText: {
    flex: 1,
    color: "#1b2a2f",
    fontWeight: "700",
  },
  remove: {
    color: "#b3261e",
    fontWeight: "900",
  },
  logout: {
    minHeight: 50,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 8,
    backgroundColor: "#183f45",
  },
  logoutText: {
    color: "#ffffff",
    fontWeight: "900",
  },
  darkText: {
    color: "#f3f7f5",
  },
  darkMuted: {
    color: "#b8c4c2",
  },
});
