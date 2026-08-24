import { CardSkeleton, ListSkeleton, PageSkeleton } from "@/components/shared/page-skeleton";

export default function Loading() {
  return (
    <PageSkeleton>
      <CardSkeleton lines={3} />
      <ListSkeleton rows={4} />
    </PageSkeleton>
  );
}
