import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import AppShell from "@/components/AppShell";
import EmployeeAccountsClient from "@/components/EmployeeAccountsClient";
export default async function Page(){const user=await getSession();if(!user)redirect('/login');if(user.role!=='ADMIN')redirect('/dashboard');return <AppShell user={user}><EmployeeAccountsClient/></AppShell>}
