import { plans } from './entitlements.mjs';
import { HttpError } from './validate.mjs';

// Checkout details are resolved by a provider adapter; entitlement changes remain
// exclusively in the verified-payment/admin decision path in api.mjs.
const manualPayPalLinks = Object.freeze({
  'pro:monthly': 'https://paypal.me/seifroyale/49.99USD',
  'pro:annual': 'https://paypal.me/seifroyale/499USD',
  'max:monthly': 'https://paypal.me/seifroyale/199.99USD',
  'max:annual': 'https://paypal.me/seifroyale/1499USD',
});

export const billingProviders = Object.freeze({
  paypal_me_manual: Object.freeze({
    id: 'paypal_me_manual',
    automaticVerification: false,
    recurringBilling: false,
    createCheckout({ planId, interval }) {
      const plan = plans[planId];
      if (!plan || planId === 'starter' || !['monthly', 'annual'].includes(interval)) throw new HttpError(400, 'Choose a supported paid plan and billing interval');
      return { provider: this.id, amountCents: interval === 'annual' ? plan.annualCents : plan.monthlyCents, currency: 'USD', externalUrl: manualPayPalLinks[`${planId}:${interval}`], autoRenew: false };
    },
  }),
});

export function createCheckoutDetails({ provider = 'paypal_me_manual', planId, interval }) {
  const adapter = billingProviders[provider];
  if (!adapter) throw new HttpError(503, 'That payment provider is not configured');
  return { adapter, ...adapter.createCheckout({ planId, interval }) };
}
