import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PageContainer } from "@/components/navigation/app-shell";
import { PageHeader } from "@/components/shared/page-header";
import { legalDocuments } from "@/data/support";
import { formatDate } from "@/utils/format";

type DocumentKey = keyof typeof legalDocuments;

const KEYS = Object.keys(legalDocuments) as DocumentKey[];

function isDocumentKey(value: string): value is DocumentKey {
  return (KEYS as string[]).includes(value);
}

export function generateStaticParams() {
  return KEYS.map((document) => ({ document }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ document: string }>;
}): Promise<Metadata> {
  const { document } = await params;
  if (!isDocumentKey(document)) return { title: "Not found" };
  return { title: legalDocuments[document].title };
}

export default async function LegalDocumentPage({
  params,
}: {
  params: Promise<{ document: string }>;
}) {
  const { document } = await params;
  if (!isDocumentKey(document)) notFound();

  const content = legalDocuments[document];

  return (
    <>
      <PageHeader title={content.title} backHref="/settings" />
      <PageContainer className="space-y-5">
        <p className="text-xs text-muted-foreground">
          Last updated {formatDate(content.updated)}
        </p>

        <article className="space-y-5">
          {content.sections.map((section) => (
            <section key={section.heading} className="space-y-1.5">
              <h2 className="text-sm font-semibold text-foreground">
                {section.heading}
              </h2>
              <p className="text-sm leading-relaxed text-muted-foreground">
                {section.body}
              </p>
            </section>
          ))}
        </article>

      </PageContainer>
    </>
  );
}
