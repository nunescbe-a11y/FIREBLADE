import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import AppShell from "@/components/AppShell";
import DeviceHealthClient from "@/components/DeviceHealthClient";

export default async function DeviceHealthPage() {
  const user = await getSession();
  if (!user) redirect("/login");
  if (user.role !== "ADMIN" && user.role !== "MANAGEMENT") redirect("/dashboard");
  return <AppShell user={user}><DeviceHealthClient user={user} /></AppShell>;
}
