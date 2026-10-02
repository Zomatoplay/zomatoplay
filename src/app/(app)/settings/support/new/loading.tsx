import { CardSkeleton, PageSkeleton } from "@/components/shared/page-skeleton";

export default function Loading() {
  return (
    <PageSkeleton>
      <CardSkeleton lines={4} />
    </PageSkeleton>
  );
}
