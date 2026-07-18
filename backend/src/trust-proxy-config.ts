// Resolves Express's `trust proxy` setting from the TRUST_PROXY env var so the
// per-IP throttler (throttler-config.ts) keys on the real client address when
// deployed behind a reverse proxy, instead of collapsing every request into the
// proxy's single IP.
//
// Accepted values:
//   unset / ''      -> false  (safe local/default: trust only the direct socket)
//   'false'         -> false
//   a positive int  -> that number of trusted proxy hops (the safe production
//                      choice — e.g. '1' for a single nginx/ALB in front)
//   anything else   -> passed through verbatim (an IP/CIDR/subnet string that
//                      Express's trust-proxy accepts)
//
// Deliberately does NOT accept 'true': trusting an arbitrary client-supplied
// X-Forwarded-For header lets an attacker spoof their IP and bypass the limit
// entirely. A deployer who genuinely wants that must set an explicit hop count
// or subnet instead.
export function resolveTrustProxy(env: NodeJS.ProcessEnv = process.env): number | string | boolean {
  const raw = env.TRUST_PROXY?.trim();
  if (!raw || raw.toLowerCase() === 'false') {
    return false;
  }
  if (raw.toLowerCase() === 'true') {
    throw new Error(
      "TRUST_PROXY='true' is not allowed: it trusts a client-supplied X-Forwarded-For header and defeats per-IP rate limiting. " +
        'Set it to the number of trusted proxy hops (e.g. 1) or an IP/CIDR instead.',
    );
  }
  const asInt = Number(raw);
  if (Number.isInteger(asInt) && asInt > 0) {
    return asInt;
  }
  return raw;
}
