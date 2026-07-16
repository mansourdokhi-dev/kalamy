import { ExecutionContext } from '@nestjs/common';
import { minutes } from '@nestjs/throttler';

interface AppThrottlerOptions {
  throttlers: Array<{ limit: number; ttl: number }>;
  skipIf: (context: ExecutionContext) => boolean;
}

// The per-account login lockout (auth.service.ts) is the only existing brute-force
// protection, and it's strictly per-mobile-number — an attacker distributing
// attempts across many different accounts from one IP is entirely unthrottled,
// as is unlimited hammering of the OTP-issuing endpoints (register/forgot-password),
// which costs real SMS-provider money per request. This adds a global, per-IP
// floor plus a stricter override on the auth-sensitive routes (see auth.controller.ts).
//
// Disabled during automated tests (Jest always sets NODE_ENV=test): dozens of
// existing e2e tests legitimately make many rapid same-IP requests to these exact
// routes as test setup (registering/logging in many users per file, deliberate
// lockout tests, concurrency tests) — throttling them would break test *setup*,
// not exercise anything the throttler is meant to catch. Verified manually against
// a running server instead (see the design notes for this fix).
export function shouldSkipThrottling(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV === 'test';
}

export function buildThrottlerOptions(env: NodeJS.ProcessEnv = process.env): AppThrottlerOptions {
  return {
    throttlers: [{ limit: 60, ttl: minutes(1) }],
    skipIf: () => shouldSkipThrottling(env),
  };
}
