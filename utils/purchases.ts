import { Platform } from 'react-native';
import {
  initConnection,
  endConnection,
  getSubscriptions,
  requestSubscription,
  getAvailablePurchases,
  finishTransaction,
  purchaseUpdatedListener,
  purchaseErrorListener,
  type SubscriptionPurchase,
  type PurchaseError,
  type Subscription,
} from 'react-native-iap';
import { setIsPremium } from './rateLimiter';
import { track } from './analytics';

const SUBSCRIPTION_ID = 'roast_ai_premium';
const skus = [SUBSCRIPTION_ID];

let purchaseUpdateSub: ReturnType<typeof purchaseUpdatedListener> | null = null;
let purchaseErrorSub: ReturnType<typeof purchaseErrorListener> | null = null;

/**
 * Initialize billing connection and set up purchase listeners.
 * Call once at app startup (e.g. in _layout.tsx).
 */
export async function initPurchases(): Promise<void> {
  try {
    await initConnection();

    // Listen for successful purchases
    purchaseUpdateSub = purchaseUpdatedListener(
      async (purchase: SubscriptionPurchase) => {
        if (purchase.productId === SUBSCRIPTION_ID) {
          // Acknowledge the purchase so Google doesn't refund it
          await finishTransaction({ purchase, isConsumable: false });
          await setIsPremium(true);
          track('premium_activated', { source: 'purchase' });
        }
      },
    );

    // Listen for purchase errors (logged, not thrown)
    purchaseErrorSub = purchaseErrorListener((error: PurchaseError) => {
      if (error.code !== 'E_USER_CANCELLED') {
        track('purchase_error', { code: error.code, message: error.message });
      }
    });
  } catch (err) {
    console.warn('IAP init failed:', err);
  }
}

/**
 * Tear down billing connection. Call on app unmount if needed.
 */
export async function teardownPurchases(): Promise<void> {
  purchaseUpdateSub?.remove();
  purchaseErrorSub?.remove();
  purchaseUpdateSub = null;
  purchaseErrorSub = null;
  await endConnection();
}

/**
 * Fetch the subscription product details from Google Play.
 * Returns null if unavailable.
 */
export async function getSubscriptionInfo(): Promise<Subscription | null> {
  try {
    const subs = await getSubscriptions({ skus });
    return subs.find((s) => s.productId === SUBSCRIPTION_ID) ?? null;
  } catch {
    return null;
  }
}

/**
 * Start the Google Play purchase flow for the premium subscription.
 * The purchaseUpdatedListener handles the result.
 */
export async function purchasePremium(): Promise<void> {
  if (Platform.OS !== 'android') return;
  try {
    track('purchase_started');
    await requestSubscription({ sku: SUBSCRIPTION_ID });
  } catch (err: any) {
    // E_USER_CANCELLED is normal — user backed out of the Google Play sheet
    if (err?.code !== 'E_USER_CANCELLED') {
      track('purchase_request_error', { message: err?.message });
      throw err;
    }
  }
}

/**
 * Check Google Play for active subscriptions and restore premium status.
 * Call on app launch to keep premium state in sync.
 */
export async function restorePurchases(): Promise<boolean> {
  try {
    const purchases = await getAvailablePurchases();
    const hasActive = purchases.some((p) => p.productId === SUBSCRIPTION_ID);
    await setIsPremium(hasActive);
    if (hasActive) {
      track('premium_restored');
    }
    return hasActive;
  } catch {
    // Billing service unavailable — keep last known premium state.
    // This prevents revoking premium due to transient Google Play issues.
    return false;
  }
}
