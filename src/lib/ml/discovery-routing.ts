/**
 * Marks the internal hop from /api/discover-ml back to /api/discover so the
 * proxy does not rewrite it into itself.
 *
 * This is a recursion guard, not a security boundary. A caller that sets the
 * header simply gets the deterministic canonical payload, which is the honest
 * result either way.
 */
export const INTERNAL_DISCOVERY_HEADER = "x-buzz-internal-discovery";

/** ML-enhanced discovery is opt-in so it can be switched off without a deploy. */
export function mlDiscoveryEnabled() {
  const flag = String(process.env.ML_DISCOVERY_ENABLED || "").toLowerCase();
  return flag === "1" || flag === "true";
}
