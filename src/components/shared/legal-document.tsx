import { legalDocuments } from "@/data/support";
import { formatDate } from "@/utils/format";

export type LegalDocumentKey = keyof typeof legalDocuments;

const KEYS = Object.keys(legalDocuments) as LegalDocumentKey[];

export const LEGAL_DOCUMENT_KEYS = KEYS;

export function isLegalDocumentKey(value: string): value is LegalDocumentKey {
  return (KEYS as string[]).includes(value);
}

/** The body of a legal document. One renderer for the in-app and public routes. */
export function LegalDocumentBody({ document }: { document: LegalDocumentKey }) {
  const content = legalDocuments[document];
  return (
    <div className="space-y-5">
      <p className="text-xs text-muted-foreground">Last updated {formatDate(content.updated)}</p>
      <article className="space-y-5">
        {content.sections.map((section) => (
          <section key={section.heading} className="space-y-1.5">
            <h2 className="text-sm font-semibold text-foreground">{section.heading}</h2>
            <p className="text-sm leading-relaxed text-muted-foreground">{section.body}</p>
          </section>
        ))}
      </article>
    </div>
  );
}
