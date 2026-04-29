import { useState } from "react";
import * as Updates from "expo-updates";
import {
  Alert,
  ActivityIndicator,
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
import { AppLanguage, useI18n } from "@/lib/i18n";

const LANGUAGES: { label: string; value: AppLanguage }[] = [
  { label: "English", value: "en" },
  { label: "Lietuvių", value: "lt" },
  { label: "Русский", value: "ru" },
];

export default function SettingsScreen() {
  const { token, user, setCurrentUser, signOut } = useAuth();
  const { language, setLanguage, t } = useI18n();
  const [term, setTerm] = useState("");
  const [saving, setSaving] = useState(false);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [updateStatus, setUpdateStatus] = useState("Not checked yet.");
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

  const checkForUpdates = async () => {
    if (!Updates.isEnabled) {
      setUpdateStatus("Updates are available only in the installed app.");
      return;
    }

    setCheckingUpdate(true);
    setUpdateStatus("Checking for updates...");
    try {
      const update = await Updates.checkForUpdateAsync();
      if (!update.isAvailable) {
        setUpdateStatus("Your app is up to date.");
        return;
      }

      setUpdateStatus("Update found. Downloading...");
      await Updates.fetchUpdateAsync();
      setUpdateStatus("Update ready. Restarting app...");
      await Updates.reloadAsync();
    } catch (err) {
      setUpdateStatus(err instanceof Error ? err.message : "Could not check for updates.");
    } finally {
      setCheckingUpdate(false);
    }
  };

  return (
    <ScrollView style={[styles.container, dark && styles.darkScreen]} contentContainerStyle={styles.screen}>
      <Text style={styles.eyebrow}>{t("preferences")}</Text>
      <Text style={[styles.title, dark && styles.darkText]}>{t("settings")}</Text>

      <View style={[styles.panel, dark && styles.darkPanel]}>
        <Text style={[styles.panelTitle, dark && styles.darkText]}>{t("language")}</Text>
        <Text style={[styles.muted, dark && styles.darkMuted]}>{t("languageHelp")}</Text>
        <View style={styles.languageTabs}>
          {LANGUAGES.map((item) => (
            <Pressable
              key={item.value}
              onPress={() => setLanguage(item.value)}
              style={[styles.languageTab, language === item.value && styles.languageTabActive]}
            >
              <Text style={[styles.languageText, language === item.value && styles.languageTextActive]}>
                {item.label}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      <View style={[styles.panel, dark && styles.darkPanel]}>
        <View style={styles.row}>
          <View style={styles.rowText}>
            <Text style={[styles.panelTitle, dark && styles.darkText]}>{t("darkMode")}</Text>
            <Text style={[styles.muted, dark && styles.darkMuted]}>{t("darkModeHelp")}</Text>
          </View>
          <Switch value={dark} onValueChange={(value) => save({ dark_mode: value })} />
        </View>
      </View>

      <View style={[styles.panel, dark && styles.darkPanel]}>
        <Text style={[styles.panelTitle, dark && styles.darkText]}>{t("appUpdates")}</Text>
        <Text style={[styles.muted, dark && styles.darkMuted]}>{updateStatus}</Text>
        <Pressable disabled={checkingUpdate} onPress={checkForUpdates} style={styles.updateButton}>
          {checkingUpdate ? (
            <ActivityIndicator color="#ffffff" />
          ) : (
            <Text style={styles.updateButtonText}>{t("checkForUpdates")}</Text>
          )}
        </Pressable>
      </View>

      <View style={[styles.panel, dark && styles.darkPanel]}>
        <Text style={[styles.panelTitle, dark && styles.darkText]}>{t("junkExclusions")}</Text>
        <Text style={[styles.warning, dark && styles.darkMuted]}>{t("junkWarning")}</Text>
        <View style={styles.inputRow}>
          <TextInput
            onChangeText={setTerm}
            placeholder="Example: cola"
            placeholderTextColor={dark ? "#83918f" : "#8b9290"}
            style={[styles.input, dark && styles.darkInput]}
            value={term}
          />
          <Pressable disabled={saving} onPress={addExclusion} style={styles.button}>
            <Text style={styles.buttonText}>{t("add")}</Text>
          </Pressable>
        </View>

        {exclusions.map((item) => (
          <View key={item} style={styles.chipRow}>
            <Text style={[styles.chipText, dark && styles.darkText]}>{item}</Text>
            <Pressable onPress={() => removeExclusion(item)}>
              <Text style={styles.remove}>{t("remove")}</Text>
            </Pressable>
          </View>
        ))}
      </View>

      <Pressable onPress={signOut} style={styles.logout}>
        <Text style={styles.logoutText}>{t("logOut")}</Text>
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
  languageTabs: {
    flexDirection: "row",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#ded8cc",
    overflow: "hidden",
    backgroundColor: "#ffffff",
  },
  languageTab: {
    flex: 1,
    minHeight: 42,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 6,
  },
  languageTabActive: {
    backgroundColor: "#183f45",
  },
  languageText: {
    color: "#657174",
    fontSize: 12,
    fontWeight: "900",
    textAlign: "center",
  },
  languageTextActive: {
    color: "#ffffff",
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
  updateButton: {
    minHeight: 46,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 8,
    backgroundColor: "#e45b2c",
  },
  updateButtonText: {
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
