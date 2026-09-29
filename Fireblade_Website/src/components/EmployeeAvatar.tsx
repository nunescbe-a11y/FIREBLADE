"use client";

import { useMemo, useState } from "react";

type Props = {
  employeeId?: string | null;
  employeeName?: string | null;
  photoUpdatedAt?: string | null;
  size?: "xs" | "sm" | "md" | "lg" | "xl";
  className?: string;
};

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] || ""}${parts[parts.length - 1][0] || ""}`.toUpperCase();
}

export default function EmployeeAvatar({ employeeId, employeeName, photoUpdatedAt, size = "sm", className = "" }: Props) {
  const [failed, setFailed] = useState(false);
  const name = employeeName || employeeId || "Employee";
  const url = useMemo(() => {
    if (!employeeId || failed) return "";
    const q = new URLSearchParams({ employee_id: employeeId });
    if (photoUpdatedAt) q.set("v", photoUpdatedAt);
    return `/api/employee-photo?${q.toString()}`;
  }, [employeeId, photoUpdatedAt, failed]);

  return <span className={`employee-avatar employee-avatar-${size} ${className}`.trim()} aria-label={`${name} profile photo`}>
    {url ? <img src={url} alt="" onError={() => setFailed(true)} /> : <span>{initials(name)}</span>}
  </span>;
}
