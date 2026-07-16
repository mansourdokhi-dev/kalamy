// The full API schema (every route, permission name, and request/response
// shape) is significant reconnaissance value for an attacker and requires no
// authentication to view. Mount it everywhere except when NODE_ENV is
// explicitly set to 'production' — the same signal assertSafeBootConfig uses.
export function shouldExposeSwaggerDocs(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV !== 'production';
}
