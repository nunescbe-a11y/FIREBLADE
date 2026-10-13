"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";
import type { SessionUser } from "@/lib/types";
import ThemeControl from "@/components/ThemeControl";
import EmployeeAvatar from "@/components/EmployeeAvatar";
import ManagementAvatar from "@/components/ManagementAvatar";
import { FIREBLADE_PRODUCT_NAME } from "@/lib/version";

export default function AppShell({ user, children }: { user: SessionUser; children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const isMarketing = user.role === "MARKETING";
  const canManage = user.role === "ADMIN" || user.role === "MANAGEMENT";
  const displayName = user.employee_name || (user.role === "ADMIN" ? "Administrator" : user.role === "MANAGEMENT" ? "MD" : user.username);
  const departmentName = user.department_name || (user.role === "ADMIN" ? "Administration" : user.role === "MANAGEMENT" ? "Management" : "Marketing");

  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
  };
  const item = (href: string, label: string) => <Link className={pathname === href ? "active" : ""} href={href}>{label}</Link>;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><div className="brand-mark" aria-hidden="true"><Image src="/s-mark.svg" alt="" width={42} height={42}/></div><div><strong>{FIREBLADE_PRODUCT_NAME}</strong></div></div>
        <nav>
          {item("/dashboard", isMarketing ? "My Dashboard" : "Overview")}
          {canManage && item("/indiamart-calls", "IndiaMART Calls")}
          {item("/calls", isMarketing ? "My Calls" : "General Calls")}
          {isMarketing && item("/callbacks", "My Callbacks")}
          {isMarketing && item("/whatsapp", "My WhatsApp")}
          {user.role === "MANAGEMENT" && item("/management/md-whatsapp", "MD WhatsApp Report")}
          {canManage && item("/device-health", "Device Health")}
          {user.role === "ADMIN" && item("/admin/team", "Employees & Devices")}
          {user.role === "ADMIN" && item("/admin/accounts", "Employee Accounts and Passwords")}
          {canManage && item("/departments", "Departments")}
          {user.role === "ADMIN" && item("/admin/updates", "App Updates")}
          {user.role === "ADMIN" && item("/admin/audit", "Audit History")}
        </nav>
        <div className="sidebar-bottom">
          <div className="user-card">{user.role === "MANAGEMENT" ? <ManagementAvatar name={displayName} size="sm"/> : <EmployeeAvatar employeeId={user.employee_id} employeeName={displayName} photoUpdatedAt={user.profile_photo_updated_at} size="sm"/>}<div><strong>{displayName}</strong><small>{departmentName}</small></div></div>
          <ThemeControl initialTheme={user.theme || "STANDARD"} />
          {user.force_password_change && <Link className="password-warning" href="/account/password">Change temporary password</Link>}
          <button className="link-button" onClick={logout}>Sign out</button>
        </div>
      </aside>
      <main className="main-content">{children}</main>
    </div>
  );
}
