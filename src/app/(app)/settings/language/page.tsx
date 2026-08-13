import type { Metadata } from "next";

import { PageContainer } from "@/components/navigation/app-shell";
import { PageHeader } from "@/components/shared/page-header";
import { LanguagePicker } from "@/components/settings/language-picker";

export const metadata: Metadata = {
  title: "Language",
};

export default function LanguagePage() {
  return (
    <>
      <PageHeader title="Language" backHref="/settings" />
      <PageContainer>
        <LanguagePicker />
      </PageContainer>
    </>
  );
}
