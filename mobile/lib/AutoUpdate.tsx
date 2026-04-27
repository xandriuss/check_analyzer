import { useEffect } from "react";
import * as Updates from "expo-updates";

export function AutoUpdate() {
  useEffect(() => {
    let cancelled = false;

    async function updateIfAvailable() {
      if (__DEV__ || !Updates.isEnabled) return;

      try {
        const update = await Updates.checkForUpdateAsync();
        if (!update.isAvailable || cancelled) return;

        await Updates.fetchUpdateAsync();
        if (!cancelled) {
          await Updates.reloadAsync();
        }
      } catch {
        // Update failures should never block the app from opening.
      }
    }

    updateIfAvailable();

    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}
