import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import AppShell from "@/components/AppShell";
import ShaneHandoverClient from "@/components/ShaneHandoverClient";
import { GET as getShaneHandoverData } from "@/app/api/shane-handover/route";

export default async function ShaneHandoverPage() {
  const user = await getSession();
  if (!user) redirect("/login");
  if (user.force_password_change) redirect("/account/password");
  if (user.role !== "ADMIN" && user.role !== "MANAGEMENT") redirect("/dashboard");

  const response = await getShaneHandoverData();
  const data = await response.json().catch(() => ({ marketing_employees: [], service_employees: [] }));

  return (
    <AppShell user={user}>
      <ShaneHandoverClient initialData={data} />
    </AppShell>
  );
}
