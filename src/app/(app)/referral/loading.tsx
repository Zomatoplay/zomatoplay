import {
  CardSkeleton,
  ListSkeleton,
  PageSkeleton,
  StatGridSkeleton,
} from "@/components/shared/page-skeleton";

export default function Loading() {
  return (
    <PageSkeleton label="Loading referrals">
      <StatGridSkeleton tiles={4} />
      <CardSkeleton lines={3} />
      <ListSkeleton rows={4} />
    </PageSkeleton>
  );
}
