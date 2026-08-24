import { ListSkeleton, PageSkeleton } from "@/components/shared/page-skeleton";

export default function Loading() {
  return (
    <PageSkeleton label="Loading transactions">
      <ListSkeleton rows={8} />
    </PageSkeleton>
  );
}
