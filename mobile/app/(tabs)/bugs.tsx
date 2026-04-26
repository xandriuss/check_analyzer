import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { createBugReport, getBugReports } from "@/lib/api";
import { useAuth } from "@/context/auth";

type Report = {
  id: number;
  user_email?: string | null;
  user_name?: string | null;
  title: string;
  description: string;
  status: string;
};

export default function BugReportsScreen() {
  const { token, user } = useAuth();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [reports, setReports] = useState<Report[]>([]);
  const dark = Boolean(user?.dark_mode);

  const loadReports = useCallback(async () => {
    if (!token || user?.role !== "admin") return;
    try {
      setReports(await getBugReports(token));
    } catch {
      setReports([]);
    }
  }, [token, user?.role]);

  useFocusEffect(
    useCallback(() => {
      loadReports();
    }, [loadReports]),
  );

  const submit = async () => {
    if (!token || !title.trim() || !description.trim()) return;

    try {
      await createBugReport(token, { title, description });
      setTitle("");
      setDescription("");
      Alert.alert("Thank you", "Bug report sent.");
      loadReports();
    } catch (err) {
      Alert.alert("Bug report error", err instanceof Error ? err.message : "Could not send report");
    }
  };

  return (
    <ScrollView style={[styles.container, dark && styles.darkScreen]} contentContainerStyle={styles.screen}>
      <Text style={styles.eyebrow}>Support</Text>
      <Text style={[styles.title, dark && styles.darkText]}>Bug reports</Text>

      <View style={[styles.panel, dark && styles.darkPanel]}>
        <Text style={[styles.label, dark && styles.darkText]}>Title</Text>
        <TextInput
          onChangeText={setTitle}
          placeholder="Short bug title"
          placeholderTextColor={dark ? "#83918f" : "#8b9290"}
          style={[styles.input, dark && styles.darkInput]}
          value={title}
        />
        <Text style={[styles.label, dark && styles.darkText]}>Description</Text>
        <TextInput
          multiline
          onChangeText={setDescription}
          placeholder="What happened?"
          placeholderTextColor={dark ? "#83918f" : "#8b9290"}
          style={[styles.input, styles.textArea, dark && styles.darkInput]}
          value={description}
        />
        <Pressable onPress={submit} style={styles.button}>
          <Text style={styles.buttonText}>Send report</Text>
        </Pressable>
      </View>

      {user?.role === "admin" && (
        <View style={[styles.panel, dark && styles.darkPanel]}>
          <Text style={[styles.label, dark && styles.darkText]}>Admin reports</Text>
          {reports.map((report) => (
            <View key={report.id} style={styles.report}>
              <Text style={[styles.reportTitle, dark && styles.darkText]}>{report.title}</Text>
              <Text style={[styles.reportUser, dark && styles.darkMuted]}>
                From: {report.user_name || report.user_email || "Unknown user"}
              </Text>
              <Text style={[styles.reportText, dark && styles.darkMuted]}>{report.description}</Text>
              <Text style={styles.status}>{report.status}</Text>
            </View>
          ))}
        </View>
      )}
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
    gap: 10,
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
  label: {
    color: "#1b2a2f",
    fontWeight: "900",
  },
  input: {
    minHeight: 48,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#d5d0c4",
    padding: 12,
    backgroundColor: "#ffffff",
    color: "#1b2a2f",
  },
  textArea: {
    minHeight: 110,
    textAlignVertical: "top",
  },
  darkInput: {
    backgroundColor: "#101718",
    borderColor: "#334244",
    color: "#f3f7f5",
  },
  button: {
    minHeight: 50,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 8,
    backgroundColor: "#e45b2c",
  },
  buttonText: {
    color: "#ffffff",
    fontWeight: "900",
  },
  report: {
    gap: 4,
    borderTopWidth: 1,
    borderColor: "#e1dbcf",
    paddingTop: 10,
  },
  reportTitle: {
    color: "#1b2a2f",
    fontWeight: "900",
  },
  reportText: {
    color: "#657174",
  },
  reportUser: {
    color: "#657174",
    fontWeight: "800",
  },
  status: {
    color: "#e45b2c",
    fontWeight: "900",
  },
  darkText: {
    color: "#f3f7f5",
  },
  darkMuted: {
    color: "#b8c4c2",
  },
});
