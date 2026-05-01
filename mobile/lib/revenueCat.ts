import { Platform } from "react-native";
import type { CustomerInfo, PurchasesPackage } from "react-native-purchases";

import type { SubscriptionConfig, User } from "@/lib/api";
import {
  REVENUECAT_ANDROID_API_KEY,
  REVENUECAT_IOS_API_KEY,
} from "@/lib/serviceConfig";

declare const require: any;

export type BillingPeriod = "monthly" | "annual";

export type RevenueCatStorePlan = {
  period: BillingPeriod;
  productId: string;
  priceLabel: string;
  package: PurchasesPackage;
};

let configuredAppUserId: string | null = null;

export function revenueCatAppUserId(user: Pick<User, "id">, config?: SubscriptionConfig | null) {
  const prefix = config?.revenuecat?.app_user_id_prefix ?? "receipt_lens_user_";
  return `${prefix}${user.id}`;
}

export function isRevenueCatReady() {
  return revenueCatApiKey().length > 0;
}

function revenueCatApiKey() {
  if (Platform.OS === "ios") {
    return REVENUECAT_IOS_API_KEY;
  }

  if (Platform.OS === "android") {
    return REVENUECAT_ANDROID_API_KEY;
  }

  return REVENUECAT_ANDROID_API_KEY || REVENUECAT_IOS_API_KEY;
}

function getPurchases() {
  const module = require("react-native-purchases");
  return module.default ?? module;
}

async function configureRevenueCat(user: User, config: SubscriptionConfig) {
  const apiKey = revenueCatApiKey();
  if (!apiKey) {
    throw new Error("RevenueCat API key is missing for this platform.");
  }

  const appUserId = revenueCatAppUserId(user, config);
  const Purchases = getPurchases();
  const isConfigured = await Purchases.isConfigured().catch(() => false);

  if (!isConfigured) {
    Purchases.configure({ apiKey, appUserID: appUserId });
  } else if (configuredAppUserId !== appUserId) {
    await Purchases.logIn(appUserId);
  }

  configuredAppUserId = appUserId;
  await Purchases.setEmail(user.email).catch(() => undefined);
  await Purchases.setDisplayName(user.display_name ?? null).catch(() => undefined);
}

function entitlementId(config: SubscriptionConfig) {
  return config.revenuecat?.entitlement_id ?? "pro";
}

export function hasActiveRevenueCatEntitlement(customerInfo: CustomerInfo, config: SubscriptionConfig) {
  return Boolean(customerInfo.entitlements.active[entitlementId(config)]);
}

function fallbackPlanPrice(config: SubscriptionConfig, period: BillingPeriod) {
  return config.plans.find((plan) => plan.period === period)?.price_label ?? "Price unavailable";
}

function productIdForPeriod(config: SubscriptionConfig, period: BillingPeriod) {
  return config.plans.find((plan) => plan.period === period)?.product_id;
}

function findPackageForPeriod(config: SubscriptionConfig, offering: any, period: BillingPeriod) {
  const productId = productIdForPeriod(config, period);
  const periodPackage = period === "monthly" ? offering?.monthly : offering?.annual;

  if (periodPackage) {
    return periodPackage as PurchasesPackage;
  }

  return offering?.availablePackages?.find(
    (item: PurchasesPackage) => item.product.identifier === productId,
  ) as PurchasesPackage | undefined;
}

export async function loadRevenueCatStorePlans(user: User, config: SubscriptionConfig) {
  await configureRevenueCat(user, config);

  const Purchases = getPurchases();
  const offerings = await Purchases.getOfferings();
  const offering = offerings.current;
  if (!offering) {
    throw new Error("No RevenueCat offering is configured yet.");
  }

  const result: Partial<Record<BillingPeriod, RevenueCatStorePlan>> = {};
  (["monthly", "annual"] as BillingPeriod[]).forEach((period) => {
    const pack = findPackageForPeriod(config, offering, period);
    if (!pack) {
      return;
    }

    result[period] = {
      period,
      productId: pack.product.identifier,
      priceLabel: pack.product.priceString || fallbackPlanPrice(config, period),
      package: pack,
    };
  });

  return result;
}

export async function purchaseRevenueCatPlan(
  user: User,
  config: SubscriptionConfig,
  period: BillingPeriod,
  storePlan?: RevenueCatStorePlan,
) {
  await configureRevenueCat(user, config);
  const plan = storePlan ?? (await loadRevenueCatStorePlans(user, config))[period];
  if (!plan) {
    throw new Error("This subscription plan is not available yet.");
  }

  const Purchases = getPurchases();
  const result = await Purchases.purchasePackage(plan.package);
  if (!hasActiveRevenueCatEntitlement(result.customerInfo, config)) {
    throw new Error("Purchase finished, but the Pro entitlement is not active yet.");
  }

  return {
    appUserId: revenueCatAppUserId(user, config),
    customerInfo: result.customerInfo as CustomerInfo,
  };
}

export async function restoreRevenueCatSubscription(user: User, config: SubscriptionConfig) {
  await configureRevenueCat(user, config);

  const Purchases = getPurchases();
  const customerInfo = (await Purchases.restorePurchases()) as CustomerInfo;
  if (!hasActiveRevenueCatEntitlement(customerInfo, config)) {
    throw new Error("No active Pro subscription was found for this store account.");
  }

  return {
    appUserId: revenueCatAppUserId(user, config),
    customerInfo,
  };
}
