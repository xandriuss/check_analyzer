import { Platform } from "react-native";

const PRODUCTION_API_URL = "https://checkanalyzer-production.up.railway.app";

export type AppMode = "person" | "family";

export type User = {
  id: number;
  email: string;
  mode: AppMode;
  display_name?: string | null;
  role?: "user" | "admin";
  is_subscriber?: boolean;
  dark_mode?: boolean;
  junk_exclusions?: string[];
  bonus_scan_credits?: number;
};

export type ReceiptItem = {
  name: string;
  price: number;
  is_junk: boolean;
};

export type Receipt = {
  id: number;
  date?: string;
  total: number;
  junk_total: number;
  waste_percent?: number;
  photo_url?: string | null;
  scan_url?: string | null;
  discounts?: { name: string; amount: number; is_junk?: boolean }[];
  items: ReceiptItem[];
};

export type SubscriptionSummary = {
  locked: boolean;
  total: number;
  junk_total: number;
  waste_percent: number;
  monthly_total?: number;
  monthly_junk_total?: number;
  monthly_waste_percent?: number;
};

export type UsageStatus = {
  is_subscriber: boolean;
  weekly_limit: number | null;
  weekly_used: number;
  weekly_remaining: number | null;
  bonus_scan_credits: number;
  rewarded_ads_remaining: number;
  rewarded_ads_limit: number;
  rewarded_ads_reset_at?: string | null;
};

export type SubscriptionPlan = {
  period: "monthly" | "annual";
  product_id: string;
  price_label: string;
};

export type SubscriptionConfig = {
  provider: string;
  mode: "demo" | "store";
  plans: SubscriptionPlan[];
};

export const API_URL =
  process.env.EXPO_PUBLIC_API_URL ??
  (Platform.OS === "web" ? "http://localhost:8000" : PRODUCTION_API_URL);

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.detail || data.error || "Request failed");
  }

  return data as T;
}

export function register(input: {
  email: string;
  password: string;
  mode: AppMode;
  display_name?: string;
}) {
  return request<{ token: string; user: User }>("/register", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function login(input: { email: string; password: string }) {
  return request<{ token: string; user: User }>("/login", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function getMe(token: string) {
  return request<User>("/me", {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
}

export async function uploadReceipt(uri: string, token: string) {
  const form = new FormData();
  form.append("file", {
    uri,
    name: "receipt.jpg",
    type: "image/jpeg",
  } as any);

  const response = await fetch(`${API_URL}/upload`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
    },
    body: form,
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.detail || data.error || "Upload failed");
  }

  return data as Receipt;
}

export async function getReceipts(token: string) {
  const response = await fetch(`${API_URL}/receipts`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.detail || data.error || "Could not load receipts");
  }

  return data as Receipt[];
}

export async function updateSettings(
  token: string,
  input: { dark_mode?: boolean; junk_exclusions?: string[] },
) {
  return request<User>("/settings", {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(input),
  });
}

export async function subscribeDemo(token: string) {
  return request<User>("/subscribe-demo", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
}

export async function getSubscriptionConfig() {
  return request<SubscriptionConfig>("/subscription-config");
}

export function getUsage(token: string) {
  return request<UsageStatus>("/usage", {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
}

export function completeRewardedAd(token: string) {
  return request<UsageStatus>("/rewarded-ad/complete", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
}

export async function getSubscriptionSummary(token: string) {
  return request<SubscriptionSummary>("/subscription-summary", {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
}

export async function createBugReport(
  token: string,
  input: { title: string; description: string },
) {
  return request<{ id: number; status: string }>("/bug-reports", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(input),
  });
}

export async function getBugReports(token: string) {
  const response = await fetch(`${API_URL}/bug-reports`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.detail || data.error || "Could not load bug reports");
  }
  return data as {
    id: number;
    user_id?: number;
    user_email?: string | null;
    user_name?: string | null;
    title: string;
    description: string;
    status: string;
    created_at?: string;
  }[];
}
