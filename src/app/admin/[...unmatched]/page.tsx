import { notFound } from "next/navigation";

/**
 * Catch-all for unknown `/admin/*` URLs.
 *
 * Without this, an unmatched path under `/admin` never enters the admin
 * segment, so Next resolves the *root* `not-found.tsx` — which drops an
 * administrator into the user application's shell, complete with its bottom
 * navigation. Matching here and calling `notFound()` keeps the miss inside the
 * admin segment, where `admin/not-found.tsx` handles it.
 */
export default function AdminCatchAll(): never {
  notFound();
}
