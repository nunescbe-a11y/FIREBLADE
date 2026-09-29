"use client";

import { useEffect, useRef, useState } from "react";
import type { SessionUser } from "@/lib/types";
import ManagementAvatar from "@/components/ManagementAvatar";

type Profile = {
  display_name: string;
  has_photo: boolean;
  profile_photo_updated_at: string | null;
};

function greetingIST() {
  const hour = Number(new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    hourCycle: "h23",
  }).format(new Date()));

  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

export default function ManagementWelcomeCard({ user }: { user: SessionUser }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [fileKey, setFileKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  const load = async () => {
    try {
      const response = await fetch("/api/management/profile", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not load Management profile");
      setProfile(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load Management profile");
    }
  };

  useEffect(() => { void load(); }, []);

  const clearInput = () => {
    setFile(null);
    setFileKey(k => k + 1);
  };

  const upload = async () => {
    if (!file) return;
    setBusy(true);
    setError("");
    setNotice("");

    try {
      const sign = await fetch("/api/management/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "sign_upload",
          filename: file.name,
          content_type: file.type,
          size: file.size,
        }),
      });
      const signed = await sign.json();
      if (!sign.ok) throw new Error(signed.error || "Could not prepare Management photo upload");

      const formData = new FormData();
      formData.append("cacheControl", "3600");
      formData.append("", file);
      const uploaded = await fetch(signed.upload_url, {
        method: "PUT",
        headers: { "x-upsert": "false" },
        body: formData,
      });
      if (!uploaded.ok) throw new Error(`Management photo upload failed (${uploaded.status})`);

      const final = await fetch("/api/management/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "finalize_upload", object_path: signed.object_path }),
      });
      const result = await final.json();
      if (!final.ok) throw new Error(result.error || "Could not finalize Management photo");

      clearInput();
      setNotice("Management profile photo updated.");
      await load();
      window.dispatchEvent(new Event("fireblade-management-profile-updated"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update Management profile photo");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!window.confirm("Remove the Management profile photo? The MD initials will be shown instead.")) return;
    setBusy(true);
    setError("");
    setNotice("");

    try {
      const response = await fetch("/api/management/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "remove" }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not remove Management profile photo");
      clearInput();
      setNotice("Management profile photo removed.");
      await load();
      window.dispatchEvent(new Event("fireblade-management-profile-updated"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not remove Management profile photo");
    } finally {
      setBusy(false);
    }
  };

  const name = profile?.display_name || user.employee_name || "MD";

  return (
    <section className="management-welcome-card">
      <ManagementAvatar name={name} size="xl" />
      <div className="management-welcome-copy">
        <p className="eyebrow">Management workspace</p>
        <h1>{greetingIST()}, {name}</h1>
        <p>Here is the current Fireblade company activity and follow-up status.</p>
      </div>
      <div className="management-photo-editor">
        <strong>Management Profile Photo</strong>
        <small>Visible only on the Management / MD experience.</small>
        <input
          ref={inputRef}
          key={fileKey}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={event => setFile(event.target.files?.[0] || null)}
        />
        <div className="management-photo-actions">
          <button type="button" className="primary-button" disabled={!file || busy} onClick={() => void upload()}>
            {busy ? "Saving..." : profile?.has_photo ? "Replace Photo" : "Save Photo"}
          </button>
          {profile?.has_photo && (
            <button type="button" className="secondary-button danger-text" disabled={busy} onClick={() => void remove()}>
              Remove Photo
            </button>
          )}
        </div>
        {notice && <small className="management-profile-success">{notice}</small>}
        {error && <small className="management-profile-error">{error}</small>}
      </div>
    </section>
  );
}