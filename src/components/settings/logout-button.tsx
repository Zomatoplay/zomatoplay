"use client";

import { useState, useTransition } from "react";
import { Loader2, LogOut } from "lucide-react";

import { ListGroup, ListRow } from "@/components/shared/list-row";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { signOutAction } from "@/app/(app)/settings/actions";

/**
 * Sign out.
 *
 * The "reset demo data" control that used to sit here is gone: it restored an
 * in-memory copy of one demo account's balances and verification status, and
 * account state now lives in PostgreSQL where a button cannot rewrite it.
 */
export function AccountActions() {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function handleLogout() {
    startTransition(async () => {
      await signOutAction();
    });
  }

  return (
    <>
      <ListGroup>
        <ListRow
          icon={LogOut}
          title="Log out"
          onClick={() => setOpen(true)}
          destructive
          hideChevron
        />
      </ListGroup>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Log out?</SheetTitle>
            <SheetDescription>
              You will need to sign in again to access your account.
            </SheetDescription>
          </SheetHeader>
          <SheetBody>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Your session will end on this device. Your balances, allocations
              and verification stay on your account.
            </p>
          </SheetBody>
          <SheetFooter>
            <Button
              variant="destructive"
              size="lg"
              block
              onClick={handleLogout}
              disabled={pending}
            >
              {pending ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : null}
              {pending ? "Signing out…" : "Log out"}
            </Button>
            <Button variant="ghost" size="lg" block onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </>
  );
}
