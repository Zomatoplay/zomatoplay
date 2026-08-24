import Link from "next/link";

import { APP_NAME } from "@/constants/app";

/**
 * The pieces every authentication screen shares.
 *
 * Not a shell component: each screen owns its own form and its own state, and
 * the only things genuinely common are the heading block and the "sign-in is
 * not configured" notice. Factoring more than that out would make four small
 * screens harder to read, not easier.
 */

export function AuthHeading({
  title,
  subtitle,
}: {
  title: string;
  subtitle: string;
}) {
  return (
    <div className="space-y-1.5 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      <p className="text-sm leading-relaxed text-muted-foreground">{subtitle}</p>
    </div>
  );
}

/**
 * Shown when the deployment has no Supabase configuration.
 *
 * It refuses rather than substituting a demo account, which is the whole point:
 * an application that signs you in as *somebody* when authentication is
 * misconfigured is showing you another person's balance.
 */
export function AuthUnconfigured() {
  return (
    <div className="space-y-4 rounded-2xl border border-border bg-card p-6 text-center">
      <h1 className="text-lg font-semibold tracking-tight">
        Sign-in is not configured
      </h1>
      <p className="text-sm leading-relaxed text-muted-foreground">
        This deployment of {APP_NAME} has no Supabase Auth configuration, so no
        account can be signed in. Set{" "}
        <code className="font-mono text-xs">NEXT_PUBLIC_SUPABASE_URL</code> and{" "}
        <code className="font-mono text-xs">
          NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
        </code>
        .
      </p>
      <p className="text-xs leading-relaxed text-muted-foreground">
        No demo account is signed in instead — that would show you someone
        else&rsquo;s balance.
      </p>
    </div>
  );
}

export function AuthFooterLink({
  prompt,
  href,
  label,
}: {
  prompt: string;
  href: string;
  label: string;
}) {
  return (
    <p className="text-center text-sm text-muted-foreground">
      {prompt}{" "}
      <Link
        href={href}
        className="font-medium text-brand underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        {label}
      </Link>
    </p>
  );
}

/**
 * Password rules, in one place so the sign-up form, the reset form and the
 * change-password sheet cannot disagree about what is acceptable.
 *
 * Deliberately modest and explicit. Supabase enforces its own project-level
 * minimum server-side; this is the message shown before the round trip, never
 * the thing that decides.
 */
export const PASSWORD_MIN_LENGTH = 8;

export function describePasswordProblem(
  password: string,
  confirmation?: string,
): string | null {
  if (password.length > 0 && password.length < PASSWORD_MIN_LENGTH) {
    return `Use at least ${PASSWORD_MIN_LENGTH} characters.`;
  }
  if (password.length > 0 && !/[a-zA-Z]/.test(password)) {
    return "Include at least one letter.";
  }
  if (password.length > 0 && !/[0-9]/.test(password)) {
    return "Include at least one number.";
  }
  if (
    confirmation !== undefined &&
    confirmation.length > 0 &&
    confirmation !== password
  ) {
    return "Passwords do not match.";
  }
  return null;
}

export function isPasswordAcceptable(password: string): boolean {
  return (
    password.length >= PASSWORD_MIN_LENGTH &&
    /[a-zA-Z]/.test(password) &&
    /[0-9]/.test(password)
  );
}

export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
