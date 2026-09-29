import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import AppShell from "@/components/AppShell";
import DashboardClient from "@/components/DashboardClient";
import MarketingDashboardClient from "@/components/MarketingDashboardClient";

export default async function DashboardPage() {
  const user = await getSession();
  if (!user) redirect("/login");
  if (user.force_password_change) redirect("/account/password");
  return <AppShell user={user}>{user.role === "MARKETING" ? <MarketingDashboardClient user={user}/> : <DashboardClient user={user} />}</AppShell>;
}
