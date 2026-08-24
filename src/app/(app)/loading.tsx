import {
  BalanceSkeleton,
  CardSkeleton,
  ListSkeleton,
  PageSkeleton,
} from "@/components/shared/page-skeleton";

/** Home: hero balance, an allocations block, an earnings card, recent activity. */
export default function Loading() {
  return (
    <PageSkeleton label="Loading your account">
      <BalanceSkeleton />
      <CardSkeleton lines={2} />
      <ListSkeleton rows={3} />
      <CardSkeleton lines={3} />
    </PageSkeleton>
  );
}
