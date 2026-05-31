import { TableLoading } from "@/components/ui/table-loading";

export default function CitiesLoading() {
  return <TableLoading titleWidth="w-24" rows={10} showFilters={false} />;
}
