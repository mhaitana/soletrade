"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/responsive-dialog";
import { acceptQuoteAction, declineQuoteAction } from "@/features/quotes/api/public/actions";

const SIGNATURE_ASPECT_RATIO = 480 / 140;

type Pending = "accept" | "decline" | null;

export function QuoteAcceptForm({
  token,
  termsConditions,
}: {
  token: string;
  termsConditions: string | null;
}) {
  const [isPending, startTransition] = useTransition();
  const [pending, setPending] = useState<Pending>(null);
  const [error, setError] = useState<string>("");
  const [done, setDone] = useState<"accepted" | "declined" | null>(null);

  // Accept-form fields.
  const [accepterName, setAccepterName] = useState<string>("");
  const [accepterEmail, setAccepterEmail] = useState<string>("");
  const [agreedTerms, setAgreedTerms] = useState<boolean>(false);
  const [nameError, setNameError] = useState<string>("");
  const [termsError, setTermsError] = useState<string>("");

  // Signature pad - minimal dependency-free canvas. Declared directly in the component (not via
  // a hook return) so the React Compiler doesn't flag ref access during render.
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);
  const lastRef = useRef<{ x: number; y: number } | null>(null);
  const [hasStrokes, setHasStrokes] = useState(false);

  // Resize the canvas to fill its container, scaling by devicePixelRatio for crisp strokes on
  // high-DPI displays. Existing strokes are snapshoted and redrawn so a viewport resize doesn't
  // erase a half-drawn signature.
  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    let raf = 0;

    function resizeCanvas() {
      if (!container || !canvas) return;

      const cssWidth = Math.max(1, Math.floor(container.clientWidth));
      const cssHeight = Math.max(1, Math.floor(cssWidth / SIGNATURE_ASPECT_RATIO));
      const dpr = window.devicePixelRatio || 1;

      // Snapshot existing artwork before resizing clears the canvas.
      let snapshotSrc: string | null = null;
      if (hasStrokes && canvas.width > 0 && canvas.height > 0) {
        snapshotSrc = canvas.toDataURL("image/png");
      }

      canvas.width = cssWidth * dpr;
      canvas.height = cssHeight * dpr;

      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.strokeStyle = "#0f172a";
      ctx.lineWidth = 2 * dpr;

      if (snapshotSrc) {
        const img = new Image();
        img.onload = () => {
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        };
        img.src = snapshotSrc;
      }
    }

    function scheduleResize() {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(resizeCanvas);
    }

    const ro = new ResizeObserver(scheduleResize);
    ro.observe(container);
    scheduleResize();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [hasStrokes]);

  function pointerPos(e: React.PointerEvent<HTMLCanvasElement>) {
    const c = canvasRef.current;
    if (!c) return { x: 0, y: 0 };
    const rect = c.getBoundingClientRect();
    // Scale pointer coords to the canvas's internal resolution (accounts for CSS size ≠
    // canvas attribute size). In practice width/height attrs match the rendered size, so the
    // scale is 1:1 - this just keeps it robust.
    const sx = c.width / rect.width;
    const sy = c.height / rect.height;
    return { x: (e.clientX - rect.left) * sx, y: (e.clientY - rect.top) * sy };
  }

  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    e.preventDefault();
    const c = canvasRef.current;
    if (!c) return;
    c.setPointerCapture(e.pointerId);
    drawingRef.current = true;
    lastRef.current = pointerPos(e);
  }

  function onPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) return;
    const c = canvasRef.current;
    if (!c || !lastRef.current) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    const p = pointerPos(e);
    const dpr = window.devicePixelRatio || 1;
    ctx.beginPath();
    ctx.moveTo(lastRef.current.x, lastRef.current.y);
    ctx.lineTo(p.x, p.y);
    ctx.lineWidth = 2 * dpr;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#0f172a";
    ctx.stroke();
    lastRef.current = p;
    if (!hasStrokes) setHasStrokes(true);
  }

  function onPointerUp(e: React.PointerEvent<HTMLCanvasElement>) {
    drawingRef.current = false;
    lastRef.current = null;
    const c = canvasRef.current;
    if (c) {
      try {
        c.releasePointerCapture(e.pointerId);
      } catch {
        // pointer may already be released - ignore
      }
    }
  }

  function clearSignature() {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, c.width, c.height);
    setHasStrokes(false);
  }

  /** Returns a data-URL, or null when the canvas is empty. */
  function serializeSignature(): string | null {
    const c = canvasRef.current;
    if (!c || !hasStrokes) return null;
    return c.toDataURL("image/png");
  }

  function run(kind: "accept" | "decline") {
    setError("");
    if (kind === "accept") {
      // Client-side guards (server doesn't enforce agreement - just captures the row).
      if (accepterName.trim() === "") {
        setNameError("Please enter your name.");
        return;
      }
      if (termsConditions && !agreedTerms) {
        setTermsError("You must agree to the Terms & Conditions to accept.");
        return;
      }
    }

    startTransition(async () => {
      const res =
        kind === "accept"
          ? await acceptQuoteAction({
              token,
              accepterName: accepterName.trim(),
              accepterEmail: accepterEmail.trim() || undefined,
              signature: kind === "accept" ? (serializeSignature() ?? undefined) : undefined,
            })
          : await declineQuoteAction({ token });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setDone(kind === "accept" ? "accepted" : "declined");
    });
  }

  if (done === "accepted") {
    return (
      <div
        className="mt-6 flex items-center gap-3 rounded-md border border-emerald-200 bg-emerald-50 p-4"
        role="status"
        aria-live="polite"
      >
        <Check className="size-5 text-emerald-600 dark:text-emerald-500" aria-hidden />
        <div className="text-sm">
          <p className="font-medium text-emerald-800">Quote accepted</p>
          <p className="text-emerald-700">
            Thank you - the business will be in touch with an invoice.
          </p>
        </div>
      </div>
    );
  }

  if (done === "declined") {
    return (
      <div className="mt-6 flex items-center gap-3 rounded-md border border-border bg-muted/30 p-4 text-sm text-muted-foreground">
        <X className="size-5" aria-hidden />
        <span>This quote has been declined.</span>
      </div>
    );
  }

  return (
    <>
      <div className="mt-6 flex flex-wrap gap-2">
        <Button onClick={() => setPending("accept")} disabled={isPending}>
          <Check className="size-4" aria-hidden />
          Accept quote
        </Button>
        <Button variant="outline" onClick={() => setPending("decline")} disabled={isPending}>
          <X className="size-4" aria-hidden />
          Decline
        </Button>
      </div>

      {error ? (
        <p className="mt-3 text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}

      <ResponsiveDialog
        open={pending !== null}
        onOpenChange={(o) => {
          if (!o && !isPending) setPending(null);
        }}
      >
        <ResponsiveDialogContent>
          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
          {pending === "accept" ? (
            <>
              <ResponsiveDialogHeader>
                <ResponsiveDialogTitle>Accept this quote?</ResponsiveDialogTitle>
                <ResponsiveDialogDescription>
                  Enter your name below to confirm you accept the terms and total shown. The
                  business will be notified and can convert this quote to an invoice.
                </ResponsiveDialogDescription>
              </ResponsiveDialogHeader>

              <div className="space-y-4 py-2">
                <div className="space-y-1.5">
                  <Label htmlFor="accepterName">Your name</Label>
                  <Input
                    id="accepterName"
                    value={accepterName}
                    onChange={(e) => {
                      setAccepterName(e.target.value);
                      setNameError("");
                    }}
                    maxLength={200}
                    placeholder="Full name"
                    aria-invalid={Boolean(nameError)}
                  />
                  {nameError ? <p className="text-sm text-destructive">{nameError}</p> : null}
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="accepterEmail">Email (optional)</Label>
                  <Input
                    id="accepterEmail"
                    type="email"
                    value={accepterEmail}
                    onChange={(e) => setAccepterEmail(e.target.value)}
                    maxLength={200}
                    placeholder="you@example.com"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label>Signature</Label>
                  <p className="text-xs text-muted-foreground">
                    Draw your signature below, or leave it blank - your typed name is acceptable
                    evidence.
                  </p>
                  <div ref={containerRef} className="w-full">
                    <canvas
                      ref={canvasRef}
                      onPointerDown={onPointerDown}
                      onPointerMove={onPointerMove}
                      onPointerUp={onPointerUp}
                      onPointerLeave={onPointerUp}
                      className="h-auto w-full touch-none rounded-md border border-input bg-white"
                      aria-label="Signature pad"
                      data-testid="signature-canvas"
                    />
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={clearSignature}
                    disabled={!hasStrokes}
                  >
                    Clear signature
                  </Button>
                </div>

                {termsConditions ? (
                  <div className="space-y-1">
                    <label className="flex items-start gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={agreedTerms}
                        onChange={(e) => {
                          setAgreedTerms(e.target.checked);
                          setTermsError("");
                        }}
                        className="mt-0.5 size-4 rounded border-input"
                      />
                      <span>
                        I agree to the{" "}
                        <a href="#terms" className="font-medium underline underline-offset-2">
                          Terms &amp; Conditions
                        </a>
                      </span>
                    </label>
                    {termsError ? <p className="text-sm text-destructive">{termsError}</p> : null}
                  </div>
                ) : null}
              </div>

              <ResponsiveDialogFooter>
                <Button variant="outline" onClick={() => setPending(null)} disabled={isPending}>
                  Cancel
                </Button>
                <Button onClick={() => run("accept")} disabled={isPending}>
                  {isPending ? "Accepting…" : "Confirm accept"}
                </Button>
              </ResponsiveDialogFooter>
            </>
          ) : (
            <>
              <ResponsiveDialogHeader>
                <ResponsiveDialogTitle>Decline this quote?</ResponsiveDialogTitle>
                <ResponsiveDialogDescription>
                  Confirming you decline this quote. The business will be notified.
                </ResponsiveDialogDescription>
              </ResponsiveDialogHeader>
              <ResponsiveDialogFooter>
                <Button variant="outline" onClick={() => setPending(null)} disabled={isPending}>
                  Cancel
                </Button>
                <Button variant="destructive" onClick={() => run("decline")} disabled={isPending}>
                  {isPending ? "Working…" : "Confirm decline"}
                </Button>
              </ResponsiveDialogFooter>
            </>
          )}
        </ResponsiveDialogContent>
      </ResponsiveDialog>
    </>
  );
}
