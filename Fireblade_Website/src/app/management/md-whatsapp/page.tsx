import { redirect } from "next/navigation";
import AppShell from "@/components/AppShell";
import MdWhatsAppReportClient from "@/components/MdWhatsAppReportClient";
import { getSession } from "@/lib/auth";

export default async function MdWhatsAppReportPage() {
  const user = await getSession();
  if (!user) redirect("/login");
  if (user.role !== "MANAGEMENT") redirect("/dashboard");
  return <AppShell user={user}><MdWhatsAppReportClient /></AppShell>;
}