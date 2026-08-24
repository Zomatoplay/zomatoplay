import { CardSkeleton, PageSkeleton } from "@/components/shared/page-skeleton";

export default function Loading() {
  return (
    <PageSkeleton label="Loading plans">
      <CardSkeleton lines={1} />
      <CardSkeleton lines={4} />
      <CardSkeleton lines={4} />
      <CardSkeleton lines={4} />
    </PageSkeleton>
  );
}
