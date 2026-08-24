import { CardSkeleton, PageSkeleton } from "@/components/shared/page-skeleton";

export default function Loading() {
  return (
    <PageSkeleton label="Loading withdrawal">
      <CardSkeleton lines={2} />
      <CardSkeleton lines={5} />
    </PageSkeleton>
  );
}
