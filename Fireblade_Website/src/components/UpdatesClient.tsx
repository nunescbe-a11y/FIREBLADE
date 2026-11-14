"use client";
import { useEffect, useMemo, useState } from "react";
import { StatusBadge } from "./StatusBadge";
import { when } from "@/lib/date";
import { FIREBLADE_INTERNAL_WEB_VERSION, FIREBLADE_PRODUCT_NAME } from "@/lib/version";

type Release = {
  id: string;
  version_name: string;
  version_code: number;
  status: string;
  published_at: string;
  notes: string;
  target_device_id: string | null;
};
type Device = {
  device_id: string;
  device_name: string | null;
  employee_name?: string | null;
  department_name?: string | null;
  company_phone_number?: string | null;
};
type Health = {
  device_id: string;
  apk_version: string;
  app_version_code: number;
};
type Update = {
  device_id: string;
  stage: string;
  last_checked_at: string;
  message: string;
  app_version_code: number;
  release_id: string;
};

export default function UpdatesClient() {
  const [data, setData] = useState<{
    releases: Release[];
    devices: Device[];
    health: Health[];
    updates: Update[];
    push_configured: boolean;
  }>({ releases: [], devices: [], health: [], updates: [], push_configured: false });

  const [version, setVersion] = useState("1.7.20");
  const [code, setCode] = useState(35);
  const [notes, setNotes] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [device, setDevice] = useState("");
  const [enrollment, setEnrollment] = useState<{ code: string; expires_at: string } | null>(null);
  const [targetDevice, setTargetDevice] = useState(""); // Default to ALL phones

  const load = async () => {
    try {
      const r = await fetch("/api/admin/releases", { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw Error(j.error);
      setData(j);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Unable to load releases");
    }
  };

  useEffect(() => {
    void load();
    const t = setInterval(() => {
      if (!document.hidden) void load();
    }, 15000);
    return () => clearInterval(t);
  }, []);

  const post = async (path: string, body: unknown) => {
    const r = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const j = await r.json();
    if (!r.ok) throw Error(j.error || "Request failed");
    return j;
  };

  const publish = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) return;
    setBusy(true);
    try {
      if (file.size > 157286400) throw Error("The APK must be smaller than 150 MB");
      setMessage("Checking APK signature…");
      const hash = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
      const sha256 = Array.from(new Uint8Array(hash))
        .map((x) => x.toString(16).padStart(2, "0"))
        .join("");
      const p = await post("/api/admin/releases", {
        action: "PREPARE",
        version_code: code,
        version_name: version,
        notes,
        size_bytes: file.size,
        sha256,
        target_device_id: targetDevice || null,
      });
      setMessage("Uploading APK to secure storage…");
      const uploaded = await fetch(p.upload_url, {
        method: "PUT",
        headers: { "Content-Type": "application/vnd.android.package-archive" },
        body: file,
      });
      if (!uploaded.ok)
        throw Error("Upload failed. Check connection, then retry.");
      setMessage("Verifying and publishing APK…");
      await post("/api/admin/releases", { action: "PUBLISH", id: p.id });
      setMessage(
        targetDevice
          ? `Fireblade App ${version} published to ${targetDevice} only.`
          : `Fireblade App ${version} published to ALL company phones.`
      );
      await load();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Publish failed");
    } finally {
      setBusy(false);
    }
  };

  const enroll = async () => {
    if (!device) return;
    setBusy(true);
    setEnrollment(null);
    try {
      setEnrollment(await post("/api/admin/enrollment", { device_id: device }));
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Enrollment failed");
    } finally {
      setBusy(false);
    }
  };

  const promote = async (id: string) => {
    setBusy(true);
    try {
      await post("/api/admin/releases", { action: "PROMOTE", id });
      setMessage("Release promoted to ALL eligible Fireblade company phones.");
      await load();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Promotion failed");
    } finally {
      setBusy(false);
    }
  };

  const latestStable = useMemo(
    () => data.releases.find((r) => r.status === "PUBLISHED" && !r.target_device_id),
    [data.releases]
  );
  const installed = data.devices.filter(
    (d) =>
      latestStable &&
      data.health.some(
        (h) => h.device_id === d.device_id && h.app_version_code >= latestStable.version_code
      )
  ).length;

  const awaitingInstallCount = data.devices.filter((d) => {
    const u = data.updates.find((x) => x.device_id === d.device_id);
    return u?.stage === "AWAITING_INSTALL";
  }).length;

  return (
    <>
      <div className="page-header">
        <div>
          <p className="eyebrow">Administration</p>
          <h1>App Updates</h1>
        </div>
        <button className="secondary-button" onClick={() => void load()}>
          Check Versions
        </button>
      </div>

      <div className="health-summary-grid">
        <div className="stat-card">
          <span>Web system</span>
          <strong className="text-stat">{FIREBLADE_PRODUCT_NAME}</strong>
          <small>Internal {FIREBLADE_INTERNAL_WEB_VERSION}</small>
        </div>
        <div className="stat-card">
          <span>Stable release</span>
          <strong>{latestStable ? `v${latestStable.version_name}` : "—"}</strong>
          {latestStable && <small>Build {latestStable.version_code} (All Phones)</small>}
        </div>
        <div className="stat-card">
          <span>Devices updated</span>
          <strong>{installed} / {data.devices.length}</strong>
          <small>Running Build {latestStable?.version_code || "latest"} or higher</small>
        </div>
        <div className="stat-card">
          <span>Awaiting install</span>
          <strong>{awaitingInstallCount}</strong>
          <small>APK on phone, tap install</small>
        </div>
        <div className="stat-card">
          <span>Push messaging</span>
          <strong className="text-stat">{data.push_configured ? "Configured" : "Setup needed"}</strong>
        </div>
      </div>

      <div className="update-grid">
        <form className="panel form-grid" onSubmit={publish}>
          <h2>Publish Update</h2>
          <label>
            <span>Signed Fireblade APK</span>
            <input required type="file" accept=".apk" onChange={(e) => setFile(e.target.files?.[0] || null)} />
          </label>
          <div className="form-grid two-col">
            <label>
              <span>Version</span>
              <input required value={version} onChange={(e) => setVersion(e.target.value)} />
            </label>
            <label>
              <span>Version code</span>
              <input
                required
                type="number"
                min={6}
                max={2100000000}
                value={code}
                onChange={(e) => setCode(Number(e.target.value))}
              />
            </label>
          </div>
          <label>
            <span>Release audience</span>
            <select value={targetDevice} onChange={(e) => setTargetDevice(e.target.value)}>
              <option value="">All company phones (stable release)</option>
              {data.devices.map((d) => (
                <option value={d.device_id} key={d.device_id}>
                  {d.device_id}
                  {d.employee_name ? ` · ${d.employee_name}` : ""}
                  {d.device_id === "MKT-001" ? " (TEST)" : ""}
                </option>
              ))}
            </select>
          </label>
          {targetDevice ? (
            <p className="muted">
              <strong>Test release:</strong> only {targetDevice} will discover this APK. After testing, you can promote to all phones.
            </p>
          ) : (
            <p className="muted">
              <strong>Stable release:</strong> all registered company phones will automatically receive this update.
            </p>
          )}
          <label>
            <span>Release notes</span>
            <textarea maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </label>
          <button className="primary-button" disabled={busy || !file}>
            {busy ? "Please wait…" : targetDevice ? `Upload & Publish to ${targetDevice}` : "Upload & Publish to all phones"}
          </button>
        </form>

        <section className="panel form-grid">
          <h2>Connect a phone</h2>
          <label>
            <span>Registered phone</span>
            <select
              value={device}
              onChange={(e) => {
                setDevice(e.target.value);
                setEnrollment(null);
              }}
            >
              <option value="">Choose phone</option>
              {data.devices.map((d) => (
                <option key={d.device_id} value={d.device_id}>
                  {d.device_id}
                  {d.employee_name ? ` · ${d.employee_name}` : ""}
                </option>
              ))}
            </select>
          </label>
          <p className="muted">
            Enter the one-time code in Fireblade App → Admin → Connect. Each code expires after 15 minutes.
          </p>
          <button className="secondary-button" disabled={busy || !device} onClick={() => void enroll()}>
            Create connection code
          </button>
          {enrollment && (
            <div className="enrollment-code">
              <code>{enrollment.code}</code>
              <small>Expires {when(enrollment.expires_at)} IST</small>
              <button
                className="secondary-button"
                onClick={() =>
                  void navigator.clipboard
                    .writeText(enrollment.code)
                    .then(() => setMessage("Code copied"))
                    .catch(() => setMessage("Select the code above to copy it"))
                }
              >
                Copy code
              </button>
            </div>
          )}
        </section>
      </div>

      {message && <div className="notice-banner" role="status">{message}</div>}

      <div className="table-card">
        <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--line)" }}>
          <strong style={{ fontSize: "15px" }}>Registered Phones & Update Status</strong>
          <small style={{ display: "block", color: "var(--muted)", fontSize: "11px", marginTop: "2px" }}>
            Real-time status of installed app builds across all company devices
          </small>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Device / Employee</th>
                <th>Installed app</th>
                <th>Can Update / Target</th>
                <th>Update status</th>
                <th>Last update check</th>
                <th>Details & Actions</th>
              </tr>
            </thead>
            <tbody>
              {data.devices.map((d) => {
                const h = data.health.find((x) => x.device_id === d.device_id);
                const u = data.updates.find((x) => x.device_id === d.device_id);
                const applicable = data.releases.find(
                  (r) =>
                    r.status === "PUBLISHED" &&
                    (!r.target_device_id || r.target_device_id === d.device_id)
                );

                let stage = "UNKNOWN";
                if (!h?.apk_version) stage = "NOT INSTALLED";
                else if (applicable && h && h.app_version_code >= applicable.version_code)
                  stage = "CURRENT";
                else if (u?.message?.toLowerCase().includes("signing key")) stage = "FAILED";
                else if (applicable && u?.release_id === applicable.id) stage = u.stage;
                else if (applicable && h?.app_version_code) stage = "AVAILABLE";
                else if (applicable) stage = "AVAILABLE";
                else stage = "CURRENT";

                const badgeVal =
                  stage === "CURRENT"
                    ? "UP TO DATE"
                    : stage === "AVAILABLE"
                    ? "UPDATE AVAILABLE"
                    : stage === "AWAITING_INSTALL"
                    ? "INSTALL PENDING"
                    : stage;

                const canUpdate =
                  stage === "AVAILABLE" ||
                  stage === "AWAITING_INSTALL" ||
                  stage === "DOWNLOADING";

                let detailText = "";
                if (stage === "CURRENT") {
                  detailText = "Up to date with latest release.";
                } else if (stage === "AWAITING_INSTALL") {
                  detailText = "APK downloaded on device. Employee needs to tap 'Install' on phone.";
                } else if (stage === "AVAILABLE") {
                  detailText = "New build ready on server. Phone downloads on next sync.";
                } else if (stage === "DOWNLOADING") {
                  detailText = "Device is currently downloading the update.";
                } else if (stage === "FAILED") {
                  detailText = u?.message || "Install failed or key mismatch. Reinstall needed.";
                } else if (stage === "NOT INSTALLED") {
                  detailText = "App not reported yet.";
                } else {
                  detailText = u?.message || "–";
                }

                return (
                  <tr key={d.device_id}>
                    <td>
                      <strong>{d.device_id}</strong>
                      <small>
                        {d.employee_name
                          ? `${d.employee_name} · ${d.department_name || "Marketing"}`
                          : d.device_name || "Unassigned"}
                      </small>
                    </td>
                    <td>
                      <strong>
                        {h?.apk_version ? `v${h.apk_version}` : "Not installed"}
                      </strong>
                      {h?.app_version_code ? (
                        <small>Build {h.app_version_code}</small>
                      ) : null}
                    </td>
                    <td>
                      {canUpdate && applicable ? (
                        <>
                          <strong>Yes · v{applicable.version_name}</strong>
                          <small>
                            Build {applicable.version_code}{" "}
                            {applicable.target_device_id
                              ? `(${applicable.target_device_id})`
                              : "(All Phones)"}
                          </small>
                        </>
                      ) : stage === "CURRENT" ? (
                        <>
                          <strong>No · Up to date</strong>
                          <small>Running latest release</small>
                        </>
                      ) : stage === "FAILED" ? (
                        <>
                          <strong>Key mismatch</strong>
                          <small>Clean reinstall needed</small>
                        </>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td>
                      <StatusBadge value={badgeVal} />
                    </td>
                    <td>{when(u?.last_checked_at)}</td>
                    <td>
                      <div>
                        <span>{detailText}</span>
                        {applicable && applicable.target_device_id && (
                          <div style={{ marginTop: "4px" }}>
                            <button
                              type="button"
                              className="secondary-button"
                              style={{ fontSize: "11px", padding: "3px 8px" }}
                              disabled={busy}
                              onClick={() => void promote(applicable.id)}
                            >
                              Roll out to all phones
                            </button>
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <section className="panel check-history">
        <h2>Releases History</h2>
        {data.releases.map((r) => (
          <div className="release-row" key={r.id}>
            <div>
              <strong>v{r.version_name}</strong>
              <small>
                Code {r.version_code} · {r.status} ·{" "}
                {r.target_device_id ? `Target: ${r.target_device_id}` : "Target: ALL COMPANY PHONES"}{" "}
                · {when(r.published_at)}
              </small>
            </div>
            <div style={{ display: "flex", gap: "8px" }}>
              {r.status === "DRAFT" && (
                <button
                  className="secondary-button"
                  disabled={busy}
                  onClick={() => {
                    setBusy(true);
                    void post("/api/admin/releases", { action: "PUBLISH", id: r.id })
                      .then(() => {
                        setMessage("Release published");
                        return load();
                      })
                      .catch((e) => setMessage(e.message))
                      .finally(() => setBusy(false));
                  }}
                >
                  Verify & Publish
                </button>
              )}
              {r.status === "PUBLISHED" && r.target_device_id && (
                <button
                  className="primary-button"
                  disabled={busy}
                  onClick={() => void promote(r.id)}
                >
                  Promote to all phones
                </button>
              )}
            </div>
          </div>
        ))}
      </section>
    </>
  );
}
