import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import AppShell from "@/components/AppShell";
import IndiaMartCallsClient from "@/components/IndiaMartCallsClient";

export default async function IndiaMartCallsPage() {
  const user = await getSession();
  if (!user) redirect("/login");
  if (user.force_password_change) redirect("/account/password");
  if (user.role !== "ADMIN" && user.role !== "MANAGEMENT") redirect("/dashboard");

  return (
    <AppShell user={user}>
      <IndiaMartCallsClient />
    </AppShell>
  );
}
