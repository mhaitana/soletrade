"use client";

import * as React from "react";
import Link from "next/link";
import { Check, Sparkles, ArrowRight, BookOpen, FileText, Car, Receipt } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { MODULES, type ModuleKey } from "@/config/modules";
import { priceSubscription, formatCents, type Interval } from "@/lib/domain/billing/pricing";
import { cn } from "@/lib/utils";

const ALL_MODULES: { key: ModuleKey; icon: React.ComponentType<{ className?: string }> }[] = [
  { key: "books", icon: BookOpen },
  { key: "quotes", icon: FileText },
  { key: "drive", icon: Car },
  { key: "invoices", icon: Receipt },
];

export function StackCalculator() {
  const [selected, setSelected] = React.useState<ModuleKey[]>([
    "books",
    "quotes",
    "drive",
    "invoices",
  ]);
  const [interval, setInterval] = React.useState<Interval>("monthly");

  const toggleModule = (key: ModuleKey) => {
    setSelected((current) => {
      if (current.includes(key)) {
        if (current.length === 1) return current; // Keep at least one module selected
        return current.filter((m) => m !== key);
      }
      return [...current, key];
    });
  };

  const pricing = priceSubscription(selected, interval);
  const anchorName = pricing.anchorKey ? MODULES[pricing.anchorKey].name : null;

  return (
    <div className="rounded-3xl border border-border/80 bg-card p-6 shadow-md sm:p-8">
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
        {/* Left: Controls */}
        <div className="flex-1 space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-semibold tracking-tight text-foreground">
                Interactive Stack Calculator
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Select your business modules to see your real-time pricing and stack savings.
              </p>
            </div>

            {/* Interval Toggle */}
            <div className="inline-flex items-center rounded-xl border border-border/60 bg-muted p-1">
              <button
                type="button"
                onClick={() => setInterval("monthly")}
                className={cn(
                  "cursor-pointer rounded-lg px-3 py-1.5 text-xs font-medium transition-all",
                  interval === "monthly"
                    ? "bg-card text-foreground shadow-xs font-semibold"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                Monthly
              </button>
              <button
                type="button"
                onClick={() => setInterval("annual")}
                className={cn(
                  "inline-flex cursor-pointer items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all",
                  interval === "annual"
                    ? "bg-card text-foreground shadow-xs font-semibold"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <span>Annual</span>
                <span className="rounded-full bg-success/15 px-1.5 py-0.2 text-[10px] font-semibold text-success">
                  3 mos free
                </span>
              </button>
            </div>
          </div>

          {/* Module Selector Chips */}
          <div className="grid gap-3 sm:grid-cols-2">
            {ALL_MODULES.map(({ key, icon: Icon }) => {
              const info = MODULES[key];
              const isSelected = selected.includes(key);
              const isAnchor = pricing.anchorKey === key;

              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => toggleModule(key)}
                  className={cn(
                    "flex cursor-pointer items-start gap-3 rounded-2xl border p-4 text-left transition-all",
                    isSelected
                      ? "border-foreground/30 bg-muted/40 shadow-xs ring-1 ring-foreground/10"
                      : "border-border/60 bg-card hover:border-border hover:bg-muted/20 opacity-70",
                  )}
                >
                  <div
                    className={cn(
                      "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg border transition-all",
                      isSelected
                        ? "border-foreground bg-foreground text-background"
                        : "border-border bg-muted text-muted-foreground",
                    )}
                  >
                    {isSelected ? <Check className="size-4" /> : <Icon className="size-4" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-1">
                      <span className="font-semibold text-sm text-foreground">{info.name}</span>
                      {isSelected && isAnchor && (
                        <Badge
                          variant="outline"
                          className="text-[10px] bg-brand-blue/10 text-brand-blue border-brand-blue/20"
                        >
                          Anchor
                        </Badge>
                      )}
                      {isSelected && !isAnchor && (
                        <Badge
                          variant="outline"
                          className="text-[10px] bg-success/10 text-success border-success/20"
                        >
                          Add-on
                        </Badge>
                      )}
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground line-clamp-1">
                      {info.description}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Right: Summary Card */}
        <div className="w-full lg:w-80 rounded-2xl border border-border/80 bg-muted/30 p-6 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Total Price
              </span>
              <span className="text-xs font-mono text-muted-foreground">excl. GST</span>
            </div>

            <div className="mt-3 flex items-baseline gap-2">
              <span className="font-mono text-4xl sm:text-5xl font-semibold tracking-tight tabular-nums text-foreground">
                {formatCents(pricing.totalCents)}
              </span>
              <span className="text-sm font-medium text-muted-foreground">
                /{interval === "monthly" ? "mo" : "yr"}
              </span>
            </div>

            {pricing.totalDiscountCents > 0 && (
              <div className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-success/10 px-2.5 py-1 text-xs font-semibold text-success border border-success/20">
                <Sparkles className="size-3" />
                <span>
                  Saving {formatCents(pricing.totalDiscountCents)}/
                  {interval === "monthly" ? "mo" : "yr"}
                </span>
              </div>
            )}

            <div className="mt-6 divide-y divide-border/60 text-xs">
              {pricing.modules.map((m) => (
                <div key={m.key} className="flex items-center justify-between py-2">
                  <span className="font-medium text-foreground">
                    {MODULES[m.key].name}{" "}
                    <span className="text-muted-foreground">
                      ({m.role === "standalone" ? "Anchor" : "Add-on"})
                    </span>
                  </span>
                  <span className="font-mono tabular-nums text-foreground">
                    {formatCents(m.netCents)}
                  </span>
                </div>
              ))}
            </div>

            {anchorName && (
              <p className="mt-4 text-xs text-muted-foreground">
                <strong>{anchorName}</strong> has the highest base price and anchors your stack.
              </p>
            )}
          </div>

          <div className="mt-6 pt-4 border-t border-border/60">
            <Button asChild className="w-full" size="lg">
              <Link href="/signup">
                Start with this stack <ArrowRight className="size-4" />
              </Link>
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
