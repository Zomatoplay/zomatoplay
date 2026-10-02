import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PageContainer } from "@/components/navigation/app-shell";
import { LegalDocumentBody, LEGAL_DOCUMENT_KEYS, isLegalDocumentKey } from "@/components/shared/legal-document";
import { PageHeader } from "@/components/shared/page-header";
import { legalDocuments } from "@/data/support";

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
  return { title: legalDocuments[document].title };
}

export default async function LegalDocumentPage({
  params,
}: {
  params: Promise<{ document: string }>;
}) {
  const { document } = await params;
  if (!isLegalDocumentKey(document)) notFound();

  return (
    <>
      <PageHeader title={legalDocuments[document].title} backHref="/settings" />
      <PageContainer className="space-y-5">
        <LegalDocumentBody document={document} />
      </PageContainer>
    </>
  );
}
