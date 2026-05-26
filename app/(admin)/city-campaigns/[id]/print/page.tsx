import { requireStaff } from "@/lib/auth";
import { loadPrintCitySheet } from "@/lib/print-city-sheet";
import { notFound } from "next/navigation";
import { PrintActions } from "./_components/print-actions";
import { PrintSheet } from "./_components/print-sheet";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Print sheet",
};

/**
 * /city-campaigns/[id]/print — print-optimized handout for night-of staff.
 *
 * Layout strategy: a single scrollable page on screen, with @media
 * print CSS that ensures clean page breaks between crawls. The
 * operator hits Cmd/Ctrl+P, saves as PDF (or sends to a real
 * printer), hands it to staff working the wristband table.
 *
 * Auth: requireStaff — any role can print sheets (it's a normal
 * operational document, not an admin-only one).
 */
export default async function PrintCitySheetPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireStaff();
  const { id } = await params;
  const data = await loadPrintCitySheet(id);
  if (!data) notFound();

  return (
    <>
      {/* Screen-only action bar — hidden when printing */}
      <PrintActions cityCampaignId={id} cityName={data.cityName} />
      <PrintSheet data={data} />
    </>
  );
}
