// `app.enableCors()` with no options defaults to origin: '*' — any website can
// call this API cross-origin. Resolve an explicit allow-list instead: a
// deployment sets CORS_ALLOWED_ORIGINS (comma-separated) to its real frontend
// origins; local dev falls back to the two dev-server ports in
// .claude/launch.json (staff-web on 5173, the mobile Expo web build on 8081).
const DEFAULT_DEV_ORIGINS = ['http://localhost:5173', 'http://localhost:8081'];

export function resolveAllowedOrigins(env: NodeJS.ProcessEnv = process.env): string[] {
  const configured = env.CORS_ALLOWED_ORIGINS;
  if (!configured) {
    return DEFAULT_DEV_ORIGINS;
  }
  return configured
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}
