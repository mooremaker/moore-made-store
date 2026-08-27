import { OrderWorksheetPublicPage } from "@/components/OrderWorksheetPublicPage";

export const metadata = { robots: { index: false, follow: false } };
export default async function OrderWorksheetPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <OrderWorksheetPublicPage token={token} />;
}
