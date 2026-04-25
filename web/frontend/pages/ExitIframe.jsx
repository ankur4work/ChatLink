import { useEffect } from "react";
import { useLocation } from "react-router-dom";

export default function ExitIframe() {
  const { search } = useLocation();

  useEffect(() => {
    if (!search) return;
    const params = new URLSearchParams(search);
    const redirectUri = params.get("redirectUri");
    if (!redirectUri) return;

    const decoded = decodeURIComponent(redirectUri);
    try {
      const url = new URL(decoded);
      if (url.hostname === location.hostname) {
        if (window.top) {
          window.top.location.href = decoded;
        } else {
          window.location.href = decoded;
        }
      }
    } catch {
      /* invalid URL, ignore */
    }
  }, [search]);

  return null;
}
