import { router } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { AppMode } from "@/lib/api";
import { useAuth } from "@/context/auth";

export default function LoginScreen() {
  const { ready, signIn, signUp, user } = useAuth();
  const [isRegistering, setIsRegistering] = useState(true);
  const [mode, setMode] = useState<AppMode>("person");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [rememberMe, setRememberMe] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    setError("");
    setLoading(true);

    try {
      if (isRegistering) {
        await signUp({
          email,
          password,
          mode,
          display_name: displayName || undefined,
        }, rememberMe);
      } else {
        await signIn(email, password, rememberMe);
      }
      router.replace("/subscription");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (ready && user) {
      router.replace(user.is_subscriber ? "/(tabs)/history" : "/subscription");
    }
  }, [ready, user]);

  if (!ready) {
    return (
      <View style={styles.screen}>
        <ActivityIndicator color="#e45b2c" />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.title}>Receipt Lens</Text>
        <Text style={styles.subtitle}>
          Scan grocery receipts and see how much went to junk food.
        </Text>
      </View>

      <View style={styles.segment}>
        <Pressable
          style={[styles.segmentButton, mode === "person" && styles.segmentActive]}
          onPress={() => setMode("person")}
        >
          <Text style={[styles.segmentText, mode === "person" && styles.segmentTextActive]}>
            Person
          </Text>
        </Pressable>
        <Pressable
          style={[styles.segmentButton, mode === "family" && styles.segmentActive]}
          onPress={() => setMode("family")}
        >
          <Text style={[styles.segmentText, mode === "family" && styles.segmentTextActive]}>
            Family
          </Text>
        </Pressable>
      </View>

      <View style={styles.field}>
        <Text style={styles.inputLabel}>Email</Text>
        <TextInput
          autoCapitalize="none"
          keyboardType="email-address"
          onChangeText={setEmail}
          placeholder="you@example.com"
          placeholderTextColor="#7b8684"
          style={styles.input}
          value={email}
        />
      </View>
      <View style={styles.field}>
        <Text style={styles.inputLabel}>Password</Text>
        <TextInput
          onChangeText={setPassword}
          placeholder="Your password"
          placeholderTextColor="#7b8684"
          secureTextEntry
          style={styles.input}
          value={password}
        />
      </View>
      {isRegistering && (
        <View style={styles.field}>
          <Text style={styles.inputLabel}>{mode === "family" ? "Family name" : "Your name"}</Text>
          <TextInput
            onChangeText={setDisplayName}
            placeholder={mode === "family" ? "Example: Dovydonis family" : "Example: Andrius"}
            placeholderTextColor="#7b8684"
            style={styles.input}
            value={displayName}
          />
        </View>
      )}

      <Pressable onPress={() => setRememberMe((value) => !value)} style={styles.checkboxRow}>
        <View style={[styles.checkbox, rememberMe && styles.checkboxChecked]}>
          {rememberMe && <Text style={styles.checkboxMark}>X</Text>}
        </View>
        <Text style={styles.checkboxText}>Remember me</Text>
      </Pressable>

      {!!error && <Text style={styles.error}>{error}</Text>}

      <Pressable
        disabled={loading || !email || !password}
        onPress={submit}
        style={({ pressed }) => [
          styles.primary,
          (pressed || loading) && styles.primaryPressed,
          (!email || !password) && styles.disabled,
        ]}
      >
        {loading ? (
          <ActivityIndicator color="#ffffff" />
        ) : (
          <Text style={styles.primaryText}>{isRegistering ? "Create account" : "Log in"}</Text>
        )}
      </Pressable>

      <Pressable onPress={() => setIsRegistering((value) => !value)} style={styles.switchMode}>
        <Text style={styles.switchText}>
          {isRegistering ? "Already have an account? Log in" : "New here? Create account"}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    justifyContent: "center",
    gap: 14,
    padding: 24,
    backgroundColor: "#f6f4ef",
  },
  header: {
    gap: 8,
    marginBottom: 12,
  },
  title: {
    color: "#1b2a2f",
    fontSize: 34,
    fontWeight: "800",
  },
  subtitle: {
    color: "#5f6d70",
    fontSize: 16,
    lineHeight: 22,
  },
  segment: {
    flexDirection: "row",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#d5d0c4",
    overflow: "hidden",
  },
  segmentButton: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 12,
    backgroundColor: "#ffffff",
  },
  segmentActive: {
    backgroundColor: "#183f45",
  },
  segmentText: {
    color: "#536164",
    fontWeight: "700",
  },
  segmentTextActive: {
    color: "#ffffff",
  },
  input: {
    minHeight: 52,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#d5d0c4",
    backgroundColor: "#ffffff",
    color: "#1b2a2f",
    fontSize: 16,
    paddingHorizontal: 14,
  },
  field: {
    gap: 6,
  },
  inputLabel: {
    color: "#183f45",
    fontSize: 13,
    fontWeight: "800",
  },
  checkboxRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 2,
  },
  checkbox: {
    width: 24,
    height: 24,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 5,
    borderWidth: 2,
    borderColor: "#9da7a4",
    backgroundColor: "#ffffff",
  },
  checkboxChecked: {
    borderColor: "#183f45",
    backgroundColor: "#183f45",
  },
  checkboxMark: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "900",
  },
  checkboxText: {
    color: "#183f45",
    fontSize: 15,
    fontWeight: "700",
  },
  error: {
    color: "#b3261e",
    fontWeight: "600",
  },
  primary: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: 52,
    borderRadius: 8,
    backgroundColor: "#e45b2c",
  },
  primaryPressed: {
    opacity: 0.85,
  },
  disabled: {
    backgroundColor: "#a9b0ad",
  },
  primaryText: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "800",
  },
  switchMode: {
    alignItems: "center",
    padding: 8,
  },
  switchText: {
    color: "#183f45",
    fontWeight: "700",
  },
});
