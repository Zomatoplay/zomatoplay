import { CardSkeleton, PageSkeleton } from "@/components/shared/page-skeleton";

export default function Loading() {
  return (
    <PageSkeleton label="Loading plan">
      <CardSkeleton lines={3} />
      <CardSkeleton lines={5} />
      <CardSkeleton lines={2} />
    </PageSkeleton>
  );
}
