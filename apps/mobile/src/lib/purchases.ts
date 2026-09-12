import { Platform } from 'react-native';
import Purchases, {
  PACKAGE_TYPE,
  PURCHASES_ERROR_CODE,
  type PurchasesPackage,
} from 'react-native-purchases';

const IOS_KEY = process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY;
const ANDROID_KEY = process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY;

let configuredFor: string | null = null;
let configuringFor: string | null = null;
let configuration: Promise<void> | null = null;

function apiKey(): string | null {
  if (Platform.OS === 'ios') return IOS_KEY ?? null;
  if (Platform.OS === 'android') return ANDROID_KEY ?? null;
  return null;
}

/** RevenueCat knows a purchase by the Clerk parent id the webhook can resolve to a Household. */
export function configurePurchases(clerkUserId: string): Promise<void> {
  if ((configuredFor === clerkUserId || configuringFor === clerkUserId) && configuration) {
    return configuration;
  }
  const key = apiKey();
  if (!key) return Promise.reject(new Error('RevenueCat is not configured for this build'));

  configuringFor = clerkUserId;
  configuration = (async () => {
    if (await Purchases.isConfigured()) {
      await Purchases.logIn(clerkUserId);
    } else {
      Purchases.configure({ apiKey: key, appUserID: clerkUserId });
    }
    configuredFor = clerkUserId;
  })().catch((error: unknown) => {
    configuringFor = null;
    configuration = null;
    throw error;
  });
  return configuration;
}

const PRODUCT_ORDER: Readonly<Record<string, number>> = {
  [PACKAGE_TYPE.ANNUAL]: 0,
  [PACKAGE_TYPE.MONTHLY]: 1,
  [PACKAGE_TYPE.LIFETIME]: 2,
};

/** The paywall is backed by the one current offering and only its three approved package types. */
export async function premiumPackages(clerkUserId: string): Promise<PurchasesPackage[]> {
  await configurePurchases(clerkUserId);
  const offering = (await Purchases.getOfferings()).current;
  if (!offering) throw new Error('RevenueCat current offering is missing');
  const packages = offering.availablePackages
    .filter((item) => item.packageType in PRODUCT_ORDER)
    .sort((a, b) => PRODUCT_ORDER[a.packageType]! - PRODUCT_ORDER[b.packageType]!);
  if (packages.length !== 3)
    throw new Error('RevenueCat premium offering must contain three products');
  return packages;
}

export async function purchase(aPackage: PurchasesPackage): Promise<void> {
  await Purchases.purchasePackage(aPackage);
}

export async function restore(): Promise<boolean> {
  const customer = await Purchases.restorePurchases();
  return customer.entitlements.active.premium !== undefined;
}

export function purchaseWasCancelled(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === PURCHASES_ERROR_CODE.PURCHASE_CANCELLED_ERROR
  );
}

export function packageName(packageType: PACKAGE_TYPE): 'annual' | 'monthly' | 'lifetime' {
  if (packageType === PACKAGE_TYPE.ANNUAL) return 'annual';
  if (packageType === PACKAGE_TYPE.MONTHLY) return 'monthly';
  return 'lifetime';
}
