import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";

import { LegalDocumentBody, LEGAL_DOCUMENT_KEYS, isLegalDocumentKey } from "@/components/shared/legal-document";
import { APP_NAME, APP_TAGLINE } from "@/constants/app";
import { legalDocuments } from "@/data/support";

/**
 * The legal documents without needing an account, so the sign-in screen can
 * link to them. Same text as Settings → Legal; `LegalDocumentBody` renders both.
 */
export function generateStaticParams() {
  return LEGAL_DOCUMENT_KEYS.map((document) => ({ document }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ document: string }>;
}): Promise<Metadata> {
  const { document } = await params;
  if (!isLegalDocumentKey(document)) return { title: "Not found" };
  return { title: legalDocuments[document].title, robots: { index: true, follow: true } };
}

export default async function PublicLegalPage({
  params,
}: {
  params: Promise<{ document: string }>;
}) {
  const { document } = await params;
  if (!isLegalDocumentKey(document)) notFound();

  return (
    <div className="space-y-5">
      <Link
        href="/login"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <ChevronLeft className="size-4" aria-hidden />
        Back to sign in
      </Link>
      <header className="space-y-1">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {APP_NAME} {APP_TAGLINE}
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">{legalDocuments[document].title}</h1>
      </header>
      <LegalDocumentBody document={document} />
      <nav aria-label="Legal documents" className="flex flex-wrap gap-x-4 gap-y-1 border-t border-border pt-4 text-sm">
        {LEGAL_DOCUMENT_KEYS.filter((key) => key !== document).map((key) => (
          <Link key={key} href={`/legal/${key}`} className="text-brand underline-offset-4 hover:underline">
            {legalDocuments[key].title}
          </Link>
        ))}
      </nav>
    </div>
  );
}
