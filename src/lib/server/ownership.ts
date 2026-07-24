/**
 * Service-role database clients bypass RLS. Route handlers use this explicit
 * check before updating resources addressed by a globally unique key.
 */
export function isResourceOwner(
  resourceUserId: string | null | undefined,
  requestUserId: string,
) {
  return Boolean(resourceUserId) && resourceUserId === requestUserId;
}
