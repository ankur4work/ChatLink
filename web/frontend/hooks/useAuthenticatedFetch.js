import { useAppBridge } from "@shopify/app-bridge-react";

/**
 * Returns an auth-aware fetch using App Bridge v4.
 * Pulls a fresh session token via shopify.idToken() and attaches it as a
 * Bearer header. Shopify's middleware on the backend reads this header.
 */
export function useAuthenticatedFetch() {
  const shopify = useAppBridge();

  return async (uri, options = {}) => {
    const token = await shopify.idToken();
    const headers = new Headers(options.headers || {});
    headers.set("Authorization", `Bearer ${token}`);
    return fetch(uri, { ...options, headers });
  };
}
