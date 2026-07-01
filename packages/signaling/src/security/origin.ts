/**
 * WebSocket origin check. An empty allowlist means "allow all" (dev only); in production the
 * allowlist is set so only the deployed web origin can open signaling connections, blunting
 * cross-site abuse of the service.
 */
export function isOriginAllowed(origin: string | undefined, allowlist: string[]): boolean {
  if (allowlist.length === 0) return true;
  if (!origin) return false;
  return allowlist.includes(origin);
}
