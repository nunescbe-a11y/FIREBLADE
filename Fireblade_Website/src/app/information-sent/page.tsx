import { redirect } from "next/navigation";
import AppShell from "@/components/AppShell";
import InformationSentReportClient from "@/components/InformationSentReportClient";
import { getSession } from "@/lib/auth";

export default async function InformationSentPage() {
  const user = await getSession();
  if (!user) redirect("/login");
  if (user.role !== "ADMIN" && user.role !== "MANAGEMENT") redirect("/dashboard");

  return (
    <AppShell user={user}>
      <InformationSentReportClient />
    </AppShell>
  );
}