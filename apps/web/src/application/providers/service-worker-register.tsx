"use client";

import { useEffect } from "react";

/**
 * Client component that registers the minimal service worker.
 *
 * Registration is gated to browser environments and deferred until after the
 * page becomes interactive to avoid competing with critical rendering work.
 * It only runs in production builds (NODE_ENV === "production") so the dev
 * server does not serve a stale service worker during local development.
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV !== "production") return;

    const register = () => {
      navigator.serviceWorker
        .register("/sw.js", { scope: "/" })
        .then((registration) => {
          console.info("Service worker registered:", registration.scope);
        })
        .catch((error) => {
          console.warn("Service worker registration failed:", error);
        });
    };

    if (document.readyState === "complete") {
      register();
    } else {
      window.addEventListener("load", register, { once: true });
    }
  }, []);

  return null;
}
