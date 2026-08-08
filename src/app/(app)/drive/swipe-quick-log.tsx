"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { DRIVE_PLATFORMS } from "@/shared/constants/drive-platforms";
import { createTripAction } from "./actions";

/**
 * Swipe-to-log quick trip (Wave 2). A small card with a platform + distance input and a
 * swipeable "track" the user drags right; releasing past 80px confirms a quick trip via
 * `createTripAction`. Native pointer events + CSS `transform: translateX(...)` - no gesture
 * library. A "Quick log" button is the accessible fallback (pointer/touch swipe is an
 * enhancement; the button always works and is keyboard-reachable).
 *
 * Defaults: first platform in the catalog; 5 km distance (the workspace's settings don't yet
 * store a default platform/distance - only the mileage rate + default vehicle - so we use
 * sensible built-in defaults the user can override inline before swiping).
 */
const SWIPE_THRESHOLD = 80;
const DEFAULT_DISTANCE_KM = 5;

export function SwipeQuickLog({ defaultPlatform }: { defaultPlatform?: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string>("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]> | undefined>();

  const [platform, setPlatform] = useState<string>(defaultPlatform ?? DRIVE_PLATFORMS[0]!.key);
  const [distanceKm, setDistanceKm] = useState<string>(String(DEFAULT_DISTANCE_KM));

  // Swipe state.
  const trackRef = useRef<HTMLDivElement>(null);
  const pointerId = useRef<number | null>(null);
  const startX = useRef<number>(0);
  const [dragX, setDragX] = useState<number>(0);
  const [swiping, setSwiping] = useState<boolean>(false);

  function logTrip() {
    setError("");
    setFieldErrors(undefined);
    const input = {
      platform,
      distanceKm: Number(distanceKm),
      date: new Date(),
      purpose: null,
      notes: null,
    };
    startTransition(async () => {
      const res = await createTripAction(input);
      if (res.ok) {
        router.refresh();
        return;
      }
      setError(res.error);
      setFieldErrors(res.fieldErrors);
    });
  }

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (isPending) return;
    pointerId.current = e.pointerId;
    startX.current = e.clientX;
    setSwiping(true);
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (pointerId.current !== e.pointerId) return;
    const dx = e.clientX - startX.current;
    // Only allow rightward drag (positive); clamp to a max so it doesn't fly off.
    setDragX(Math.max(0, Math.min(dx, SWIPE_THRESHOLD * 1.5)));
  }

  function onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    if (pointerId.current !== e.pointerId) return;
    const dx = e.clientX - startX.current;
    pointerId.current = null;
    setSwiping(false);
    setDragX(0);
    if (dx >= SWIPE_THRESHOLD) {
      logTrip();
    }
  }

  function onPointerCancel(e: React.PointerEvent<HTMLDivElement>) {
    if (pointerId.current !== e.pointerId) return;
    pointerId.current = null;
    setSwiping(false);
    setDragX(0);
  }

  const progress = Math.min(dragX / SWIPE_THRESHOLD, 1);
  const fieldErr = (name: string) => fieldErrors?.[name]?.[0];

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium text-foreground">Quick log a trip</h3>
          <p className="text-xs text-muted-foreground">Swipe right to log, or use the button.</p>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label htmlFor="quick-platform" className="text-xs">
            Platform
          </Label>
          <select
            id="quick-platform"
            value={platform}
            onChange={(e) => setPlatform(e.target.value)}
            aria-invalid={Boolean(fieldErr("platform"))}
            className="flex h-11 w-full rounded-md border border-input bg-background px-2 py-1 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:h-9"
          >
            {DRIVE_PLATFORMS.map((p) => (
              <option key={p.key} value={p.key}>
                {p.label}
              </option>
            ))}
          </select>
          {fieldErr("platform") ? (
            <p className="text-xs text-destructive">{fieldErr("platform")}</p>
          ) : null}
        </div>
        <div className="space-y-1">
          <Label htmlFor="quick-distance" className="text-xs">
            Distance (km)
          </Label>
          <Input
            id="quick-distance"
            type="number"
            min={0.1}
            step={0.1}
            inputMode="decimal"
            value={distanceKm}
            onChange={(e) => setDistanceKm(e.target.value)}
            aria-invalid={Boolean(fieldErr("distanceKm"))}
            className="h-9 tabular-nums"
          />
          {fieldErr("distanceKm") ? (
            <p className="text-xs text-destructive">{fieldErr("distanceKm")}</p>
          ) : null}
        </div>
      </div>

      {/* Swipe track */}
      <div
        ref={trackRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        className="relative mt-3 h-12 select-none overflow-hidden rounded-md bg-muted touch-none"
        style={{ touchAction: "none" }}
      >
        <div
          className="absolute inset-y-0 left-0 flex items-center justify-center rounded-md bg-primary text-primary-foreground transition-[background-color] duration-150"
          style={{
            width: "100%",
            transform: `translateX(${dragX}px)`,
            opacity: swiping ? 0.95 : 1,
          }}
        >
          <div className="flex w-full items-center justify-between px-4">
            <span className="text-sm font-medium">
              {progress >= 1 ? "Release to log" : "Swipe right to log"}
            </span>
            <div className="flex items-center gap-1">
              <ChevronRight className="size-4" aria-hidden />
              <ChevronRight className="size-4 -ml-2.5" aria-hidden />
            </div>
          </div>
        </div>
        {/* Progress underlay */}
        <div
          className="absolute inset-y-0 left-0 bg-primary/20"
          style={{ width: `${progress * 100}%` }}
          aria-hidden
        />
      </div>

      {error ? (
        <p className="mt-2 text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}

      <div className="mt-3 flex justify-end">
        <Button type="button" size="sm" onClick={logTrip} disabled={isPending}>
          {isPending ? "Logging…" : "Quick log"}
        </Button>
      </div>
    </div>
  );
}
