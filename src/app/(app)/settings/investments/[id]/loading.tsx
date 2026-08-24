import { CardSkeleton, PageSkeleton } from "@/components/shared/page-skeleton";

export default function Loading() {
  return (
    <PageSkeleton label="Loading allocation">
      <CardSkeleton lines={4} />
      <CardSkeleton lines={3} />
    </PageSkeleton>
  );
}
