import policies from '../../shared/policies.json' with { type: 'json' };

export { policies };
export const requiredPolicyIds = policies.map(({ id }) => id);
export const policyVersions = Object.fromEntries(policies.map(({ id, version }) => [id, version]));
export const registrationConsentText = "I have read and agree to Morgan's Terms of Use, Privacy Policy, and Refund Policy.";
export const manualPaymentTermsVersion = 'paypal-me-one-time-v1';
export const manualPaymentTermsText = 'One-time USD payment for the selected monthly or annual plan period. There is no trial and no automatic renewal. Morgan paid-plan access begins only after manual PayPal transaction verification and ends on the displayed period end unless another payment is verified.';

export function acceptedCurrentPolicies(value) {
  if (!Array.isArray(value)) return null;
  const accepted = new Map(value.filter((item) => item && typeof item === 'object').map((item) => [item.policyId, item.version]));
  if (!requiredPolicyIds.every((id) => accepted.get(id) === policyVersions[id])) return null;
  return requiredPolicyIds.map((policyId) => ({ policyId, version: policyVersions[policyId] }));
}

export function needsPolicyAcceptance(user) {
  return requiredPolicyIds.some((id) => user?.policyVersionsAccepted?.[id] !== policyVersions[id]);
}
