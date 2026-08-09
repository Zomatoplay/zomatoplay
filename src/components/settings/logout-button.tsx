"use client";

import { useState } from "react";
import { LogOut, RotateCcw } from "lucide-react";
import { toast } from "sonner";

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
import { usePrototypeStore } from "@/lib/prototype-store";

/**
 * Logout, plus a demo-only control to reset the in-memory prototype state.
 *
 * INTEGRATION POINT: `handleLogout` will clear the session and redirect to the
 * sign-in route once authentication exists.
 */
export function AccountActions() {
  const { reset } = usePrototypeStore();
  const [open, setOpen] = useState(false);

  function handleLogout() {
    setOpen(false);
    toast("Signed out", {
      description: "Authentication is not part of this build — nothing changed.",
    });
  }

  function handleReset() {
    reset();
    toast.success("Demo data reset", {
      description: "Balances, investments and verification are back to their seed values.",
    });
  }

  return (
    <>
      <ListGroup>
        <ListRow
          icon={RotateCcw}
          title="Reset demo data"
          description="Restore the sample balances, investments and KYC status."
          onClick={handleReset}
          hideChevron
        />
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
              Authentication is not implemented in this build, so this is a
              demonstration of the confirmation step only.
            </p>
          </SheetBody>
          <SheetFooter>
            <Button variant="destructive" size="lg" block onClick={handleLogout}>
              Log out
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
