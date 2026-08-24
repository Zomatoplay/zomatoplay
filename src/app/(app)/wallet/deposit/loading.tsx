import { CardSkeleton, PageSkeleton } from "@/components/shared/page-skeleton";

export default function Loading() {
  return (
    <PageSkeleton label="Loading deposit">
      <CardSkeleton lines={2} />
      <CardSkeleton lines={4} />
    </PageSkeleton>
  );
}
