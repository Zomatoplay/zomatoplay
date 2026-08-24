import {
  BalanceSkeleton,
  CardSkeleton,
  ListSkeleton,
  PageSkeleton,
} from "@/components/shared/page-skeleton";

export default function Loading() {
  return (
    <PageSkeleton label="Loading your wallet">
      <BalanceSkeleton />
      <CardSkeleton lines={3} />
      <ListSkeleton rows={5} />
    </PageSkeleton>
  );
}
