"use client";

import { useCallback, useEffect, useState } from "react";

type Props = {
  name?: string | null;
  size?: "xs" | "sm" | "md" | "lg" | "xl";
  className?: string;
};

type Profile = {
  display_name: string;
  has_photo: boolean;
  profile_photo_updated_at: string | null;
};

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "MD";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] || ""}${parts[parts.length - 1][0] || ""}`.toUpperCase();
}

export default function ManagementAvatar({ name = "MD", size = "sm", className = "" }: Props) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/management/profile", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) return;
      setProfile(data);
      setFailed(false);
    } catch {
      // Initials remain a safe fallback if the profile service is unavailable.
    }
  }, []);

  useEffect(() => {
    void load();
    const refresh = () => void load();
    window.addEventListener("fireblade-management-profile-updated", refresh);
    return () => window.removeEventListener("fireblade-management-profile-updated", refresh);
  }, [load]);

  const displayName = profile?.display_name || name || "MD";
  const version = profile?.profile_photo_updated_at || "";
  const url = profile?.has_photo && !failed
    ? `/api/management/profile?photo=1&v=${encodeURIComponent(version)}`
    : "";

  return (
    <span className={`employee-avatar employee-avatar-${size} ${className}`.trim()} aria-label={`${displayName} profile photo`}>
      {url ? <img src={url} alt="" onError={() => setFailed(true)} /> : <span>{initials(displayName)}</span>}
    </span>
  );
}