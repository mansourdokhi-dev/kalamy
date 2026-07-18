# Payments-Ready Architecture (design only, no implementation)

**Status:** Deferred to phase 2 per founder decision, 2026-07-18. This document exists so phase 2 can add a real payment provider without reworking the codebase — it deliberately adds no code, no Prisma models, and no new dependencies to the MVP/pilot build.

## Why this doc and not code

The founder's instruction for this readiness push was explicit: don't add features beyond what the approved docs call for, and payments is explicitly out of scope until phase 2. Scaffolding a live `Payment`/`Subscription` Prisma model now would mean a real migration, an unused table, and dead code paths shipping into the pilot build for a feature nobody can test yet (no provider account exists) — the same category of problem as the SMS/WhatsApp/push blockers found during this session's audit. A design note carries the intent forward without that cost.

## What already exists in the codebase (reference points for phase 2)

- `TrainingCycle72h.status` includes `SUBSCRIPTION_EXPIRED_CLINICAL_FLOW_OPEN` (`backend/prisma/schema.prisma`) — a status value already anticipates subscription expiry affecting the training flow, but nothing sets or reads it today. Phase 2's access-gating logic has a natural landing spot here.
- `backend/src/modules/consultations/` and `backend/src/common/otp-delivery/` (built 2026-07-17/18) are the two existing examples of a **provider-agnostic interface + pluggable implementation** pattern in this codebase — `OtpDeliveryChannel` (interface) with `EmailOtpChannel`/`WhatsAppOtpChannel` (implementations) selected by a small orchestrator (`OtpDeliveryService`) that tries each in priority order and never lets one implementation's failure leak into the caller. Phase 2's payment integration should follow the same shape:

```typescript
// backend/src/common/payments/payment-provider.interface.ts (phase 2)
interface PaymentProvider {
  readonly name: string; // 'stripe' | 'moyasar' | 'hyperpay'
  isEnabled(): boolean; // env-var gated, same as OtpDeliveryChannel
  createCharge(amount: number, currency: string, metadata: Record<string, string>): Promise<{ providerChargeId: string; status: 'pending' | 'succeeded' | 'failed' }>;
  verifyWebhookSignature(rawBody: Buffer, signature: string): boolean;
}
```

A `PaymentsService` would select the configured provider the same way `OtpDeliveryService` selects a channel — this keeps Stripe/Moyasar/HyperPay swappable (or run side-by-side, e.g. Moyasar/HyperPay for Saudi cards, Stripe for international) without touching the rest of the app.

## What phase 2 will actually need to build (not now)

1. `Payment`/`Subscription` Prisma models — subscriber, plan, provider, provider reference id, status, period start/end. Needs a real schema design session once a provider and pricing model are chosen (out of scope for this note).
2. The `PaymentProvider` interface above + one real implementation (whichever provider the founder picks first).
3. A `PatientAccessService` gate change: when a subscription is expired, degrade to `SUBSCRIPTION_EXPIRED_CLINICAL_FLOW_OPEN`-equivalent behavior (open clinical flow, restrict something else — needs a product decision on exactly what gets restricted) rather than the current no-op.
4. Webhook endpoint(s) for provider payment-status callbacks, signature-verified per provider.
5. The financial/subscriptions report (`docs/superpowers/specs/2026-07-16-deferred-items-review-report.md` item, also deferred) becomes buildable once this model exists.

## Founder's action items before phase 2 can start

- Pick which of Stripe/Moyasar/HyperPay is first (or confirm running more than one).
- Provide API credentials for that provider (sandbox first).
- Decide what "restricted" means for an expired subscription (block new sessions? block new assessments? read-only access to history?) — this is a clinical/business decision, not a technical one.
