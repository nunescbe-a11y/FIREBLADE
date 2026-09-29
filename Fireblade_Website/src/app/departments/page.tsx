import {redirect} from "next/navigation";
import {getSession} from "@/lib/auth";
import AppShell from "@/components/AppShell";
import DepartmentsClient from "@/components/DepartmentsClient";
export default async function Page() {
 const user=await getSession(); if(!user)redirect("/login"); if(user.role !== "ADMIN" && user.role !== "MANAGEMENT")redirect("/dashboard");
 return <AppShell user={user}><DepartmentsClient user={user}/></AppShell>;
}
