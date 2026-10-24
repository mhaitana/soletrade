"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Route homepage launches and desktop install transfers into the app. */
export function InstalledAppRedirect() {
  const router = useRouter();

  useEffect(() => {
    const standalone = window.matchMedia("(display-mode: standalone)");
    const openDashboard = () => {
      const iosStandalone = (navigator as Navigator & { standalone?: boolean }).standalone;
      if (standalone.matches || iosStandalone) {
        router.replace("/dashboard");
      }
    };

    openDashboard();
    standalone.addEventListener("change", openDashboard);
    return () => standalone.removeEventListener("change", openDashboard);
  }, [router]);

  return null;
}
