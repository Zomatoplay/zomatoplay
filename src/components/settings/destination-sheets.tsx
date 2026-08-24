"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  addBankAccountAction,
  addWalletAddressAction,
} from "@/app/(app)/settings/account-actions";
import type { DepositNetwork, DepositNetworkId } from "@/types";

/**
 * Registering payout and deposit destinations.
 *
 * These two controls used to raise "not part of this build". That was the one
 * gap that made a freshly registered account unable to withdraw at all: the
 * withdrawal screen requires a payout destination, only seeded accounts had
 * one, and there was no way to add one. Both now write through server actions.
 *
 * ONLY THE MASKED ACCOUNT NUMBER IS KEPT
 * --------------------------------------
 * The full number is typed here and masked server-side before it reaches a
 * column. There is no payout rail, so storing a whole account number would be
 * accumulating exactly the data this build cannot yet protect.
 */

export function AddBankAccountSheet() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState({
    label: "",
    bankName: "",
    accountNumber: "",
    ifsc: "",
    holderName: "",
  });

  const ifscValid = /^[A-Za-z]{4}0[A-Za-z0-9]{6}$/.test(form.ifsc.trim());
  const canSubmit =
    form.bankName.trim().length > 1 &&
    form.holderName.trim().length > 1 &&
    form.accountNumber.replace(/\D/g, "").length >= 6 &&
    ifscValid &&
    !pending;

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    startTransition(async () => {
      const result = await addBankAccountAction(form);
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      toast.success("Payout destination added");
      setForm({
        label: "",
        bankName: "",
        accountNumber: "",
        ifsc: "",
        holderName: "",
      });
      setOpen(false);
      router.refresh();
    });
  }

  function field(key: keyof typeof form) {
    return {
      value: form[key],
      onChange: (event: React.ChangeEvent<HTMLInputElement>) =>
        setForm((current) => ({ ...current, [key]: event.target.value })),
    };
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm" block>
          <Plus className="size-4" />
          Add bank account
        </Button>
      </SheetTrigger>
      <SheetContent>
        <form onSubmit={submit} className="contents">
          <SheetHeader>
            <SheetTitle>Add a bank account</SheetTitle>
            <SheetDescription>
              Withdrawals settle in INR to an Indian bank account.
            </SheetDescription>
          </SheetHeader>
          <SheetBody className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="bank-holder">Account holder name</Label>
              <Input id="bank-holder" autoComplete="name" required {...field("holderName")} />
              <p className="text-xs text-muted-foreground">
                Must match the name on your verification document.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bank-name">Bank name</Label>
              <Input id="bank-name" required {...field("bankName")} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bank-number">Account number</Label>
              <Input
                id="bank-number"
                inputMode="numeric"
                autoComplete="off"
                required
                {...field("accountNumber")}
              />
              <p className="text-xs text-muted-foreground">
                Only the last four digits are stored.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bank-ifsc">IFSC code</Label>
              <Input
                id="bank-ifsc"
                autoCapitalize="characters"
                autoComplete="off"
                aria-invalid={form.ifsc.length > 0 && !ifscValid}
                required
                {...field("ifsc")}
              />
              <p className="text-xs text-muted-foreground">
                Eleven characters, for example HDFC0001234.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bank-label">Label (optional)</Label>
              <Input id="bank-label" placeholder="Salary account" {...field("label")} />
            </div>
          </SheetBody>
          <SheetFooter>
            <Button type="submit" variant="brand" size="lg" block disabled={!canSubmit}>
              {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
              {pending ? "Saving…" : "Save destination"}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}

export function AddWalletAddressSheet({
  networks,
}: {
  networks: DepositNetwork[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [label, setLabel] = useState("");
  const [address, setAddress] = useState("");
  const [network, setNetwork] = useState<DepositNetworkId>("trc20");

  const canSubmit = address.trim().length >= 20 && !pending;

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    startTransition(async () => {
      const result = await addWalletAddressAction({
        label,
        network,
        address: address.trim(),
      });
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      toast.success("Address saved");
      setLabel("");
      setAddress("");
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm" block>
          <Plus className="size-4" />
          Add wallet address
        </Button>
      </SheetTrigger>
      <SheetContent>
        <form onSubmit={submit} className="contents">
          <SheetHeader>
            <SheetTitle>Save a wallet address</SheetTitle>
            <SheetDescription>
              A labelled USDT address you can reuse later.
            </SheetDescription>
          </SheetHeader>
          <SheetBody className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="address-network">Network</Label>
              <div className="flex flex-wrap gap-2">
                {networks.map((item) => (
                  <Button
                    key={item.id}
                    type="button"
                    variant={item.id === network ? "brand" : "outline"}
                    size="sm"
                    onClick={() => setNetwork(item.id)}
                    aria-pressed={item.id === network}
                  >
                    {item.name}
                  </Button>
                ))}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="address-value">Address</Label>
              <Input
                id="address-value"
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                className="font-mono text-sm"
                value={address}
                onChange={(event) => setAddress(event.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="address-label">Label (optional)</Label>
              <Input
                id="address-label"
                placeholder="Exchange wallet"
                value={label}
                onChange={(event) => setLabel(event.target.value)}
              />
            </div>
          </SheetBody>
          <SheetFooter>
            <Button type="submit" variant="brand" size="lg" block disabled={!canSubmit}>
              {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
              {pending ? "Saving…" : "Save address"}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
