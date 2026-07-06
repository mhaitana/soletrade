/**
 * Customer timeline entry types (Wave 3). Shared between the app-layer loader
 * (`src/app/(app)/customers/[id]/actions.ts`) and the shared-layer timeline component
 * (`src/shared/components/customer-timeline/customer-timeline.tsx`) so the shared
 * component can consume the entry shape WITHOUT crossing the shared→app boundary.
 */

export type TimelineTone = "positive" | "negative" | "warning" | "neutral";

export interface TimelineEntry {
  kind: "invoice" | "quote" | "transaction";
  date: Date;
  id: string;
  label: string;
  sublabel: string;
  href: string;
  tone: TimelineTone;
}
