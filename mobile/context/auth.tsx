import * as SecureStore from "expo-secure-store";
import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { Platform } from "react-native";

import { AppMode, getMe, login, register, User } from "@/lib/api";

const TOKEN_KEY = "receipt-lens-token";

type AuthContextValue = {
  token: string | null;
  user: User | null;
  ready: boolean;
  signIn: (email: string, password: string, rememberMe: boolean) => Promise<void>;
  signUp: (input: {
    email: string;
    password: string;
    mode: AppMode;
    display_name?: string;
  }, rememberMe: boolean) => Promise<void>;
  setCurrentUser: (user: User) => void;
  signOut: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    restoreSession();
  }, []);

  const restoreSession = async () => {
    try {
      const savedToken = await storage.getItem(TOKEN_KEY);
      if (!savedToken) {
        return;
      }

      const savedUser = await getMe(savedToken);
      setToken(savedToken);
      setUser(savedUser);
    } catch {
      await storage.deleteItem(TOKEN_KEY);
      setToken(null);
      setUser(null);
    } finally {
      setReady(true);
    }
  };

  const value = useMemo<AuthContextValue>(
    () => ({
      token,
      user,
      ready,
      signIn: async (email, password, rememberMe) => {
        const result = await login({ email, password });
        setToken(result.token);
        setUser(result.user);
        if (rememberMe) {
          await storage.setItem(TOKEN_KEY, result.token);
        } else {
          await storage.deleteItem(TOKEN_KEY);
        }
      },
      signUp: async (input, rememberMe) => {
        const result = await register(input);
        setToken(result.token);
        setUser(result.user);
        if (rememberMe) {
          await storage.setItem(TOKEN_KEY, result.token);
        } else {
          await storage.deleteItem(TOKEN_KEY);
        }
      },
      setCurrentUser: setUser,
      signOut: async () => {
        await storage.deleteItem(TOKEN_KEY);
        setToken(null);
        setUser(null);
      },
    }),
    [ready, token, user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

const storage = {
  async getItem(key: string) {
    if (Platform.OS === "web") {
      return globalThis.localStorage?.getItem(key) ?? null;
    }

    return SecureStore.getItemAsync(key);
  },
  async setItem(key: string, value: string) {
    if (Platform.OS === "web") {
      globalThis.localStorage?.setItem(key, value);
      return;
    }

    await SecureStore.setItemAsync(key, value);
  },
  async deleteItem(key: string) {
    if (Platform.OS === "web") {
      globalThis.localStorage?.removeItem(key);
      return;
    }

    await SecureStore.deleteItemAsync(key);
  },
};

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used inside AuthProvider");
  }
  return context;
}
