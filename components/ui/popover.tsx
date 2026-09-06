import * as React from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";

import { cn } from "../../lib/utils";
import { usePortalScopeProps } from "../../lib/portal-scope";

// Minimal anchored popover for small, always-portalled content (a menu, not a modal): the SDK's
// thread-header contract requires taller content to render in "a portalled popover" instead of
// growing the 48px header row, so this is the vendoring counterpart to dialog.tsx for that case.
// Deliberately skips ResponsiveDrawerShell/MobileTrigger: Radix's own Popover.Portal already
// portals and positions the content (anchored to the trigger, flips on collision), which a
// drawer-adapting modal does not need to reimplement for a few menu rows.
const Popover = PopoverPrimitive.Root;
const PopoverTrigger = PopoverPrimitive.Trigger;

const PopoverContent = React.forwardRef<
  React.ComponentRef<typeof PopoverPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>
>(({ className, align = "end", sideOffset = 6, ...props }, ref) => {
  const scopeProps = usePortalScopeProps();
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        ref={ref}
        align={align}
        sideOffset={sideOffset}
        {...scopeProps}
        className={cn(
          "z-50 w-40 rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
          className,
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
});
PopoverContent.displayName = "PopoverContent";

export { Popover, PopoverTrigger, PopoverContent };
