import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import AppShell from "@/components/AppShell";
import PerformanceIntelligenceClient from "@/components/PerformanceIntelligenceClient";

export default async function PerformanceIntelligencePage() {
  const user = await getSession();
  if (!user) redirect("/login");
  if (user.force_password_change) redirect("/account/password");
  if (user.role === "MARKETING") redirect("/dashboard");

  return (
    <AppShell user={user}>
      <PerformanceIntelligenceClient role={user.role} />
    </AppShell>
  );
}