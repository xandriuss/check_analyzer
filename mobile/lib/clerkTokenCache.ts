import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

import type { TokenCache } from "@clerk/clerk-expo";

export const clerkTokenCache: TokenCache = {
  async getToken(key) {
    try {
      if (Platform.OS === "web") {
        return globalThis.localStorage?.getItem(key) ?? null;
      }

      return SecureStore.getItemAsync(key);
    } catch {
      return null;
    }
  },
  async saveToken(key, token) {
    if (Platform.OS === "web") {
      globalThis.localStorage?.setItem(key, token);
      return;
    }

    await SecureStore.setItemAsync(key, token);
  },
  async clearToken(key) {
    if (Platform.OS === "web") {
      globalThis.localStorage?.removeItem(key);
      return;
    }

    await SecureStore.deleteItemAsync(key);
  },
};
