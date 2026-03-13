import { Alert, Platform } from 'react-native';
import {
  initConnection,
  endConnection,
  fetchProducts,
  requestPurchase,
  getAvailablePurchases,
  finishTransaction,
  purchaseUpdatedListener,
  purchaseErrorListener,
  type Purchase,
  type PurchaseError,
  type ProductSubscription,
} from 'react-native-iap';
import { setIsPremium } from './rateLimiter';
import { track } from './analytics';

const SUBSCRIPTION_ID = 'roast_ai_premium';

let purchaseUpdateSub: ReturnType<typeof purchaseUpdatedListener> | null = null;
let purchaseErrorSub: ReturnType<typeof purchaseErrorListener> | null = null;

/**
 * Initialize billing connection and set up purchase listeners.
 * Call once at app startup (e.g. in _layout.tsx).
 */
export async function initPurchases(): Promise<void> {
  try {
    const result = await initConnection();
    console.log('[IAP] Billing connection ready, result:', result);
    // TODO: remove debug alert after confirming build is correct
    Alert.alert('[IAP DEBUG]', `Billing init OK: ${JSON.stringify(result)}`);

    // Listen for successful purchases
    purchaseUpdateSub = purchaseUpdatedListener(
      async (purchase: Purchase) => {
        console.log('[IAP] Purchase update received:', purchase.productId, 'state:', (purchase as any).purchaseStateAndroid);
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
      console.warn('[IAP] Purchase error listener:', error.code, error.message, JSON.stringify(error));
      if (error.code !== 'user-cancelled') {
        track('purchase_error', { code: error.code, message: error.message });
      }
    });
  } catch (err) {
    console.warn('[IAP] init failed:', err);
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
export async function getSubscriptionInfo(): Promise<ProductSubscription | null> {
  try {
    console.log('[IAP] Fetching subscription products for SKU:', SUBSCRIPTION_ID);
    const products = await fetchProducts({ skus: [SUBSCRIPTION_ID], type: 'subs' });
    const productList = products ?? [];
    console.log('[IAP] fetchProducts returned', productList.length, 'items:', JSON.stringify(productList.map(p => ({ id: p.id, type: p.type, platform: p.platform }))));
    // TODO: remove debug alert after confirming build is correct
    Alert.alert('[IAP DEBUG]', `fetchProducts returned ${productList.length} items`);

    const sub = productList.find((s) => s.id === SUBSCRIPTION_ID) as ProductSubscription | undefined;
    if (sub) {
      // Log offer details for debugging
      if (sub.platform === 'android') {
        const offers = sub.subscriptionOffers ?? sub.subscriptionOfferDetailsAndroid;
        console.log('[IAP] Subscription offers:', JSON.stringify(offers));
      }
    } else {
      console.warn('[IAP] Subscription not found in fetched products');
    }
    return sub ?? null;
  } catch (err) {
    console.error('[IAP] fetchProducts failed:', err);
    return null;
  }
}

/**
 * Start the Google Play purchase flow for the premium subscription.
 * Fetches product details first to get the required offer token, then launches
 * the purchase sheet. The purchaseUpdatedListener handles the result.
 */
export async function purchasePremium(): Promise<void> {
  if (Platform.OS !== 'android') return;
  try {
    track('purchase_started');

    const product = await getSubscriptionInfo();
    console.log('[IAP] Product fetch result:', product?.id ?? 'not found');

    if (!product) {
      const msg = `Subscription "${SUBSCRIPTION_ID}" not available on Google Play`;
      console.error('[IAP]', msg);
      track('purchase_product_unavailable', { sku: SUBSCRIPTION_ID });
      throw new Error(msg);
    }

    // Extract offer token — required for Google Play Billing v5+
    let offerToken: string | undefined;
    if (product.platform === 'android') {
      const offers = product.subscriptionOfferDetailsAndroid ?? [];
      if (offers.length > 0) {
        // Use the first available offer (base plan)
        offerToken = offers[0].offerToken;
        console.log('[IAP] Using offer token from offer index 0, basePlanId:', offers[0].basePlanId, 'offerId:', offers[0].offerId);
      } else {
        // Fallback: try standardized subscriptionOffers
        const stdOffers = product.subscriptionOffers ?? [];
        if (stdOffers.length > 0 && 'offerTokenAndroid' in stdOffers[0]) {
          offerToken = (stdOffers[0] as any).offerTokenAndroid;
          console.log('[IAP] Using offer token from standardized offers');
        }
      }
    }

    if (!offerToken) {
      const msg = 'No subscription offer token available — cannot launch purchase';
      console.error('[IAP]', msg);
      track('purchase_no_offer_token', { sku: SUBSCRIPTION_ID });
      throw new Error(msg);
    }

    console.log('[IAP] Requesting purchase for:', SUBSCRIPTION_ID, 'with offerToken:', offerToken.substring(0, 30) + '...');
    // TODO: remove debug alert after confirming build is correct
    Alert.alert('[IAP DEBUG]', `About to requestPurchase with offerToken: ${offerToken.substring(0, 30)}...`);

    await requestPurchase({
      request: {
        google: {
          skus: [SUBSCRIPTION_ID],
          subscriptionOffers: [
            {
              sku: SUBSCRIPTION_ID,
              offerToken,
            },
          ],
        },
      },
      type: 'subs',
    });
  } catch (err: any) {
    console.error('[IAP] purchasePremium error:', err?.code, err?.message, JSON.stringify(err));
    // E_USER_CANCELLED is normal — user backed out of the Google Play sheet
    if (err?.code !== 'user-cancelled') {
      track('purchase_request_error', { code: err?.code, message: err?.message });
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
