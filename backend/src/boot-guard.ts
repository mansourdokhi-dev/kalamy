// DEV_MODE=true makes auth.service.ts return real OTP codes directly in API
// responses (register/forgot-password), bypassing SMS delivery entirely —
// convenient for local development, but a full auth-bypass if ever left on in
// production. `.env.example` ships with DEV_MODE=true as the local-dev default,
// so this is the safety net for whoever copies it into a real deployment
// without overriding it.
export function assertSafeBootConfig(env: NodeJS.ProcessEnv = process.env): void {
  if (env.DEV_MODE === 'true' && env.NODE_ENV === 'production') {
    throw new Error(
      'Refusing to start: DEV_MODE=true is not allowed when NODE_ENV=production ' +
        '(this would leak OTP verification codes directly in API responses).',
    );
  }
}
