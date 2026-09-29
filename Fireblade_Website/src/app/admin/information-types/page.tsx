import { redirect } from "next/navigation";
import AppShell from "@/components/AppShell";
import AdminInformationTypesClient from "@/components/AdminInformationTypesClient";
import { getSession } from "@/lib/auth";

export default async function AdminInformationTypesPage() {
  const user = await getSession();
  if (!user) redirect("/login");
  if (user.role !== "ADMIN") redirect("/dashboard");

  return (
    <AppShell user={user}>
      <AdminInformationTypesClient />
    </AppShell>
  );
}