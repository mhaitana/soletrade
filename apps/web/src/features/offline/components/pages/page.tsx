import { WifiOff } from "lucide-react";
import { brand } from "@/config/brand";
import { ReloadButton } from "@/features/offline/components/reload-button";

/**
 * Static offline fallback page served by the service worker when a navigation
 * request fails. The page itself remains a Server Component so metadata is
 * statically generated; only the reload button is a small Client Component.
 */
export const metadata = {
  title: `Offline · ${brand.productName}`,
  description: "You are currently offline. Please check your connection and try again.",
};

export default function OfflinePage() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-6 text-center">
      <div className="mx-auto flex max-w-md flex-col items-center gap-4">
        <div className="rounded-full border border-border bg-muted p-4">
          <WifiOff className="size-8 text-muted-foreground" aria-hidden />
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">You are offline</h1>
        <p className="text-balance text-muted-foreground">
          {brand.productName} cannot reach the network right now. Check your connection, then try
          reloading the page.
        </p>
        <ReloadButton />
      </div>
    </main>
  );
}
