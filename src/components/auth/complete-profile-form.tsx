"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { saveProfile } from "@/app/(auth)/complete-profile/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * The one step between a verified email and a usable account.
 *
 * Kept to the two fields the rest of the application actually needs. Identity
 * details proper are collected by the verification flow, which is a different
 * thing with different handling.
 */
export function CompleteProfileForm({
  email,
  initialFullName,
}: {
  email: string;
  /** From sign-up. Empty for accounts created by one-time code. */
  initialFullName: string;
}) {
  const router = useRouter();
  const [fullName, setFullName] = useState(initialFullName);
  const [phone, setPhone] = useState("");
  const [pending, startTransition] = useTransition();

  function submit(event: React.FormEvent) {
    event.preventDefault();
    startTransition(async () => {
      const result = await saveProfile({ fullName, phone });
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      toast.success("Welcome to Nanotron");
      router.replace("/");
      router.refresh();
    });
  }

  return (
    <form onSubmit={submit} className="space-y-6">
      <div className="space-y-1.5 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">
          Complete your profile
        </h1>
        <p className="text-sm text-muted-foreground">
          Signed in as {email}.
        </p>
      </div>

      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="fullName">Full name</Label>
          <Input
            id="fullName"
            autoComplete="name"
            autoFocus={initialFullName.length === 0}
            value={fullName}
            onChange={(event) => setFullName(event.target.value)}
            placeholder="As it appears on your ID"
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="phone">Phone number</Label>
          <Input
            id="phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            autoFocus={initialFullName.length > 0}
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            placeholder="+91 90000 00000"
            required
          />
        </div>
      </div>

      <Button
        type="submit"
        variant="brand"
        size="lg"
        className="w-full"
        disabled={pending}
      >
        {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
        {pending ? "Saving…" : "Continue"}
      </Button>
    </form>
  );
}
