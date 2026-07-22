"use client";

import * as React from "react";
import { Dialog as DialogPrimitive, Dialog as SheetPrimitive } from "radix-ui";

import { useIsMobile } from "@/shared/lib/use-media-query";
import { cn } from "@/shared/lib/utils";
import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/shared/ui/dialog";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/shared/ui/sheet";

const ResponsiveDialogContext = React.createContext<boolean>(false);

function useResponsiveDialogContext(): boolean {
  const value = React.useContext(ResponsiveDialogContext);
  if (value === undefined) {
    throw new Error(
      "ResponsiveDialog subcomponents must be rendered inside a <ResponsiveDialog />.",
    );
  }
  return value;
}

/**
 * ResponsiveDialog - a single component that renders as a bottom Sheet on
 * narrow viewports and a centered Dialog on desktop. It preserves the Radix
 * trigger/content/footer API so existing confirmation flows can swap Dialog
 * for ResponsiveDialog with minimal changes.
 */
export function ResponsiveDialog({
  children,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Root>) {
  const isMobile = useIsMobile();
  return (
    <ResponsiveDialogContext.Provider value={isMobile}>
      {isMobile ? (
        <Sheet {...(props as React.ComponentProps<typeof SheetPrimitive.Root>)}>{children}</Sheet>
      ) : (
        <Dialog {...props}>{children}</Dialog>
      )}
    </ResponsiveDialogContext.Provider>
  );
}

export function ResponsiveDialogTrigger(
  props: React.ComponentProps<typeof DialogPrimitive.Trigger>,
) {
  const isMobile = useResponsiveDialogContext();
  return isMobile ? <SheetTrigger {...props} /> : <DialogTrigger {...props} />;
}

type ResponsiveDialogContentProps = React.ComponentProps<typeof DialogPrimitive.Content> & {
  /** Sheet-specific side override. Defaults to "bottom" on mobile. */
  side?: React.ComponentProps<typeof SheetContent>["side"];
  showCloseButton?: boolean;
};

export function ResponsiveDialogContent({
  className,
  side = "bottom",
  showCloseButton = true,
  children,
  ...props
}: ResponsiveDialogContentProps) {
  const isMobile = useResponsiveDialogContext();
  if (isMobile) {
    return (
      <SheetContent
        side={side}
        showCloseButton={showCloseButton}
        className={cn("h-auto max-h-[90vh]", className)}
        {...(props as React.ComponentProps<typeof SheetContent>)}
      >
        {children}
      </SheetContent>
    );
  }
  return (
    <DialogContent showCloseButton={showCloseButton} className={className} {...props}>
      {children}
    </DialogContent>
  );
}

export function ResponsiveDialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  const isMobile = useResponsiveDialogContext();
  return isMobile ? (
    <SheetHeader className={className} {...props} />
  ) : (
    <DialogHeader className={className} {...props} />
  );
}

type ResponsiveDialogFooterProps = React.ComponentProps<"div"> & {
  showCloseButton?: boolean;
};

export function ResponsiveDialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: ResponsiveDialogFooterProps) {
  const isMobile = useResponsiveDialogContext();
  if (isMobile) {
    return (
      <SheetFooter className={className} {...props}>
        {children}
        {showCloseButton && (
          <SheetClose asChild>
            <Button variant="outline">Close</Button>
          </SheetClose>
        )}
      </SheetFooter>
    );
  }
  return (
    <DialogFooter className={className} showCloseButton={showCloseButton} {...props}>
      {children}
    </DialogFooter>
  );
}

export function ResponsiveDialogTitle(props: React.ComponentProps<typeof DialogPrimitive.Title>) {
  const isMobile = useResponsiveDialogContext();
  return isMobile ? <SheetTitle {...props} /> : <DialogTitle {...props} />;
}

export function ResponsiveDialogDescription(
  props: React.ComponentProps<typeof DialogPrimitive.Description>,
) {
  const isMobile = useResponsiveDialogContext();
  return isMobile ? <SheetDescription {...props} /> : <DialogDescription {...props} />;
}

export function ResponsiveDialogClose(props: React.ComponentProps<typeof DialogPrimitive.Close>) {
  const isMobile = useResponsiveDialogContext();
  return isMobile ? <SheetClose {...props} /> : <DialogClose {...props} />;
}
