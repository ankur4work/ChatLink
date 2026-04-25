import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { useAppBridge } from "@shopify/app-bridge-react";

/**
 * Used by Shopify's auth flow to break out of the embedded iframe.
 * App Bridge v4's `shopify.redirectTo` handles cross-frame navigation
 * safely (delegates to the parent admin via postMessage); a direct
 * `window.top.location.href` is blocked by Chrome without a user gesture.
 */
export default function ExitIframe() {
  const { search } = useLocation();
  const shopify = useAppBridge();

  useEffect(() => {
    if (!shopify) return;

    const params = new URLSearchParams(search);
    const redirectUri = params.get("redirectUri");
    const target = redirectUri ? decodeURIComponent(redirectUri) : "/";

    if (typeof shopify.redirectTo === "function") {
      shopify.redirectTo(target);
    }
  }, [shopify, search]);

  return null;
}
