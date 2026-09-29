import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import AppShell from "@/components/AppShell";
import CallsClient from "@/components/CallsClient";

export default async function CallsPage() {
  const user = await getSession();
  if (!user) redirect("/login");
  if (user.force_password_change) redirect("/account/password");
  return <AppShell user={user}><CallsClient user={user} /></AppShell>;
}
