import { AdminTableSkeleton } from "@/components/admin/shared/admin-skeleton";

export default function Loading() {
  return <AdminTableSkeleton rows={6} label="Loading the account" />;
}
