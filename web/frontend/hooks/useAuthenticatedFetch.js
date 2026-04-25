import { useAppBridge } from "@shopify/app-bridge-react";

/**
 * Returns an auth-aware fetch using App Bridge v4.
 * `shopify.fetch` automatically attaches the session token (Bearer header)
 * and handles reauthorization redirects internally.
 */
export function useAuthenticatedFetch() {
  const shopify = useAppBridge();
  return (uri, options) => shopify.fetch(uri, options);
}
