import { CardSkeleton, ListSkeleton, PageSkeleton } from "@/components/shared/page-skeleton";

export default function Loading() {
  return (
    <PageSkeleton label="Loading settings">
      <CardSkeleton lines={2} />
      <ListSkeleton rows={3} />
      <ListSkeleton rows={3} />
    </PageSkeleton>
  );
}
