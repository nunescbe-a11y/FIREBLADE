"use client";

import { useEffect, useMemo, useState } from "react";

type InformationType = {
  id: string;
  code: string;
  label: string;
  sort_order: number;
  active: boolean;
  require_remark_when_no: boolean;
};

export default function AdminInformationTypesClient() {
  const [types, setTypes] = useState<InformationType[]>([]);
  const [label, setLabel] = useState("");
  const [requireRemark, setRequireRemark] = useState(true);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const orderedTypes = useMemo(
    () => [...types].sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0) || a.label.localeCompare(b.label)),
    [types],
  );

  const load = async () => {
    setError("");
    try {
      const response = await fetch("/api/admin/information-types", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not load information types");
      setTypes(data.types || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load information types");
    }
  };

  useEffect(() => { void load(); }, []);

  const nextSortOrder = useMemo(
    () => orderedTypes.length ? Math.max(...orderedTypes.map((item) => Number(item.sort_order || 0))) + 10 : 10,
    [orderedTypes],
  );

  const post = async (payload: Record<string, unknown>) => {
    const response = await fetch("/api/admin/information-types", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not save information type");
    setTypes(data.types || []);
    return data;
  };

  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy("NEW");
    setError("");
    setMessage("");
    try {
      await post({
        action: "CREATE",
        label,
        sort_order: nextSortOrder,
        active: true,
        require_remark_when_no: requireRemark,
      });
      setLabel("");
      setRequireRemark(true);
      setMessage("Information type added at the end of the checklist. Use Move Up / Move Down to reposition it.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not add information type");
    } finally {
      setBusy("");
    }
  };

  const updateLocal = (id: string, patch: Partial<InformationType>) => {
    setTypes((current) => current.map((item) => item.id === id ? { ...item, ...patch } : item));
  };

  const save = async (item: InformationType) => {
    setBusy(item.id);
    setError("");
    setMessage("");
    try {
      await post({
        action: "UPDATE",
        id: item.id,
        label: item.label,
        sort_order: Number(item.sort_order),
        active: item.active,
        require_remark_when_no: item.require_remark_when_no,
      });
      setMessage(`${item.label} updated.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update information type");
    } finally {
      setBusy("");
    }
  };

  const persistOrder = async (first: InformationType, firstOrder: number, second: InformationType, secondOrder: number) => {
    const update = async (item: InformationType, sortOrder: number) => {
      const response = await fetch("/api/admin/information-types", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "UPDATE",
          id: item.id,
          label: item.label,
          sort_order: sortOrder,
          active: item.active,
          require_remark_when_no: item.require_remark_when_no,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not reorder information types");
      return data;
    };

    await update(first, firstOrder);
    const final = await update(second, secondOrder);
    setTypes(final.types || []);
  };

  const moveType = async (id: string, direction: -1 | 1) => {
    const index = orderedTypes.findIndex((item) => item.id === id);
    const targetIndex = index + direction;
    if (index < 0 || targetIndex < 0 || targetIndex >= orderedTypes.length) return;

    const currentItem = orderedTypes[index];
    const targetItem = orderedTypes[targetIndex];

    setBusy(`MOVE:${id}`);
    setError("");
    setMessage("");

    // Optimistic visual swap.
    setTypes((current) => current.map((item) => {
      if (item.id === currentItem.id) return { ...item, sort_order: targetItem.sort_order };
      if (item.id === targetItem.id) return { ...item, sort_order: currentItem.sort_order };
      return item;
    }));

    try {
      await persistOrder(
        currentItem,
        Number(targetItem.sort_order),
        targetItem,
        Number(currentItem.sort_order),
      );
      setMessage(`${currentItem.label} moved ${direction < 0 ? "up" : "down"}.`);
    } catch (e) {
      await load();
      setError(e instanceof Error ? e.message : "Could not reorder information types");
    } finally {
      setBusy("");
    }
  };

  return (
    <>
      <div className="page-header">
        <div>
          <p className="eyebrow">Administration</p>
          <h1>Information Types</h1>
          <p>Control the Yes / No checklist shown to Marketing after every customer call.</p>
        </div>
      </div>

      {error && <div className="error-banner">{error}</div>}
      {message && <div className="notice-banner">{message}</div>}

      <section className="panel admin-information-create">
        <div>
          <p className="eyebrow">Add future item</p>
          <h2>New Information Type</h2>
          <p className="muted">Examples: Datasheet, Technical Drawing, Certificate, Price List, Video, Sample.</p>
        </div>

        <form onSubmit={create} className="admin-information-create-form admin-information-create-form-simple">
          <label>
            <span>Name</span>
            <input required value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Technical Drawing" />
          </label>

          <label className="checkbox-row">
            <input type="checkbox" checked={requireRemark} onChange={(e) => setRequireRemark(e.target.checked)} />
            <span>Require remarks when No is selected</span>
          </label>

          <button className="primary-button" disabled={busy === "NEW" || !label.trim()}>
            {busy === "NEW" ? "Adding..." : "Add Information Type"}
          </button>
        </form>
      </section>

      <div className="table-card">
        <div className="table-meta">
          <span>{orderedTypes.length} configured types</span>
          <span>Use Move Up / Move Down to control checklist order</span>
        </div>

        <div className="table-scroll">
          <table className="admin-information-table admin-information-reorder-table">
            <thead>
              <tr>
                <th>Information Type</th>
                <th>Position</th>
                <th>Active</th>
                <th>No Requires Remarks</th>
                <th></th>
              </tr>
            </thead>

            <tbody>
              {orderedTypes.map((item, index) => (
                <tr key={item.id}>
                  <td>
                    <input value={item.label} onChange={(e) => updateLocal(item.id, { label: e.target.value })} />
                    <small className="information-type-code">{item.code}</small>
                  </td>

                  <td>
                    <div className="information-order-controls">
                      <button
                        type="button"
                        className="secondary-button information-order-button"
                        disabled={index === 0 || busy.startsWith("MOVE:")}
                        onClick={() => void moveType(item.id, -1)}
                        aria-label={`Move ${item.label} up`}
                      >
                        ↑ Move Up
                      </button>

                      <button
                        type="button"
                        className="secondary-button information-order-button"
                        disabled={index === orderedTypes.length - 1 || busy.startsWith("MOVE:")}
                        onClick={() => void moveType(item.id, 1)}
                        aria-label={`Move ${item.label} down`}
                      >
                        ↓ Move Down
                      </button>
                    </div>
                  </td>

                  <td>
                    <input
                      type="checkbox"
                      checked={item.active}
                      onChange={(e) => updateLocal(item.id, { active: e.target.checked })}
                      aria-label={`${item.label} active`}
                    />
                  </td>

                  <td>
                    <input
                      type="checkbox"
                      checked={item.require_remark_when_no}
                      onChange={(e) => updateLocal(item.id, { require_remark_when_no: e.target.checked })}
                      aria-label={`${item.label} require remarks when No`}
                    />
                  </td>

                  <td>
                    <button
                      className="secondary-button"
                      disabled={busy === item.id || !item.label.trim()}
                      onClick={() => void save(item)}
                    >
                      {busy === item.id ? "Saving..." : "Save"}
                    </button>
                  </td>
                </tr>
              ))}

              {!orderedTypes.length && <tr><td colSpan={5} className="empty-state">No information types configured.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}