"use client";

import { useEffect, useMemo, useState } from "react";
import styles from "./IndiaMartCalls.module.css";

type Site = "KRISHNA" | "SF" | "MOHAMMED" | "OTHER";
type CallStatus = "ALL" | "ANSWERED" | "MISSED";
type SummaryRow = {
  site: Site;
  employee_id: string;
  employee_name: string;
  receiving_sim: string;
  total: number;
  answered: number;
  missed: number;
};
type CallRow = {
  call_id: number;
  site: Site;
  device_id: string;
  employee_id: string | null;
  employee_name: string | null;
  started_at_epoch_ms: number;
  direction: "INCOMING_ANSWERED" | "INCOMING_MISSED";
  duration_seconds: number;
  tracking_number: string;
  receiving_sim: string | null;
  sim_confidence: "CONFIRMED" | "INFERRED" | "UNKNOWN";
  line_resolution: string | null;
};
type Data = {
  summary: SummaryRow[];
  calls: CallRow[];
  totalCount: number;
  totalPages: number;
  page: number;
  countUnit: "device_call_records";
};
type Handler = { name: string; sim: string };
type HandlerCard = Handler & { key: string; total: number; answered: number; missed: number };
const IST_OFFSET_MS = 330 * 60 * 1000;
const DAY_MS = 86_400_000;
const todayIST = (epoch: number) => new Date(epoch + IST_OFFSET_MS).toISOString().slice(0, 10);
const SITES: Array<{ key: Site; label: string; tracking: string }> = [
  { key: "KRISHNA", label: "Krishna", tracking: "07942554266" },
  { key: "SF", label: "SF", tracking: "07942554266" },
  { key: "MOHAMMED", label: "Mohammed", tracking: "08048250260" },
  { key: "OTHER", label: "Other receivers", tracking: "Shared / cross-routed" },
];
const HANDLERS: Record<Exclude<Site, "OTHER">, Handler[]> = {
  KRISHNA: [
    { name: "Bhuvaneswari", sim: "9159242000" },
    { name: "Mercy", sim: "7305966225" },
  ],
  SF: [
    { name: "S.F Nunes", sim: "8940944000" },
    { name: "Kaviya", sim: "7550093383" },
  ],
  MOHAMMED: [
    { name: "Shane", sim: "9345226022" },
    { name: "Sukanya", sim: "9087753000" },
  ],
};
const timeIST = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata", day: "2-digit", month: "short",
  year: "numeric", hour: "2-digit", minute: "2-digit", hour12: true,
});
const fmt = (number: number) => Number(number || 0).toLocaleString("en-IN");
const totalFor = (summary: SummaryRow[], site: Site) =>
  summary.filter((row) => row.site === site).reduce(
    (total, row) => ({
      total: total.total + Number(row.total || 0),
      answered: total.answered + Number(row.answered || 0),
      missed: total.missed + Number(row.missed || 0),
    }),
    { total: 0, answered: 0, missed: 0 },
  );

export default function IndiaMartCallsClient() {
  const today = todayIST(Date.now());
  const [site, setSite] = useState<Site>("KRISHNA");
  const [fromInput, setFromInput] = useState(() => todayIST(Date.now() - 29 * DAY_MS));
  const [toInput, setToInput] = useState(today);
  const [range, setRange] = useState(() => ({ from: todayIST(Date.now() - 29 * DAY_MS), to: today }));
  const [status, setStatus] = useState<CallStatus>("ALL");
  const [sim, setSim] = useState("");
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [validation, setValidation] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      setLoading(true);
      setError("");
      try {
        const params = new URLSearchParams({
          site, from: range.from, to: range.to, status, page: String(page),
        });
        if (sim) params.set("sim", sim);
        const response = await fetch("/api/indiamart-calls?" + params.toString(), {
          signal: controller.signal, cache: "no-store",
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Unable to load IndiaMART calls.");
        if (!controller.signal.aborted) setData(payload as Data);
      } catch (reason) {
        if (!controller.signal.aborted) {
          setError(reason instanceof Error ? reason.message : "Unable to load IndiaMART calls.");
          setData(null);
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, [site, range.from, range.to, status, sim, page, revision]);

  const summary = useMemo(() => data?.summary || [], [data]);
  const siteTotals = totalFor(summary, site);
  const cards = useMemo<HandlerCard[]>(() => {
    if (site === "OTHER") {
      return summary.filter((row) => row.site === "OTHER")
        .map((row, index) => ({
          key: row.employee_id + ":" + row.receiving_sim + ":" + index,
          name: row.employee_name || "Unknown employee",
          sim: row.receiving_sim,
          total: Number(row.total), answered: Number(row.answered), missed: Number(row.missed),
        }))
        .sort((a, b) => b.total - a.total);
    }
    return HANDLERS[site].map((handler) => {
      const matches = summary.filter((row) => row.site === site && row.receiving_sim === handler.sim);
      return {
        ...handler, key: handler.sim,
        total: matches.reduce((sum, row) => sum + Number(row.total), 0),
        answered: matches.reduce((sum, row) => sum + Number(row.answered), 0),
        missed: matches.reduce((sum, row) => sum + Number(row.missed), 0),
      };
    });
  }, [site, summary]);
  const activeSite = SITES.find((row) => row.key === site)!;

  function changeSite(next: Site) {
    setSite(next);
    setSim("");
    setStatus("ALL");
    setPage(1);
  }
  function chooseDays(days: number) {
    const end = todayIST(Date.now());
    const start = todayIST(Date.now() - (days - 1) * DAY_MS);
    setFromInput(start);
    setToInput(end);
    setRange({ from: start, to: end });
    setValidation("");
    setPage(1);
  }
  function applyDates() {
    const fromMs = Date.parse(fromInput + "T00:00:00+05:30");
    const toMs = Date.parse(toInput + "T00:00:00+05:30");
    if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) ||
      todayIST(fromMs) !== fromInput || todayIST(toMs) !== toInput ||
      fromMs > toMs || toMs > Date.parse(today + "T00:00:00+05:30") ||
      toMs - fromMs > 365 * DAY_MS) {
      setValidation("Choose valid India dates in order, with a maximum range of 366 days.");
      return;
    }
    setValidation("");
    setRange({ from: fromInput, to: toInput });
    setPage(1);
    setRevision((value) => value + 1);
  }

  return (
    <div className={styles.page}>
      <div className="page-header">
        <div>
          <p className="eyebrow">Nunes Instruments · IndiaMART</p>
          <h1>IndiaMART Calls</h1>
          <p>Three company profiles, separated by the SIM receiving each IndiaMART call.</p>
        </div>
        <button type="button" className="secondary-button" disabled={loading}
          onClick={() => setRevision((value) => value + 1)}>
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>

      <nav className={styles.tabs} aria-label="IndiaMART profile">
        {SITES.map((item) => {
          const count = totalFor(summary, item.key).total;
          return (
            <button type="button" key={item.key} onClick={() => changeSite(item.key)}
              aria-current={site === item.key ? "page" : undefined}
              className={site === item.key ? styles.selected : ""}>
              <span>{item.label}</span>
              <strong>{fmt(count)}</strong>
            </button>
          );
        })}
      </nav>

      <section className={styles.filterPanel} aria-label="IndiaMART call filters">
        <div className={styles.quickFilters}>
          {[7, 30, 90].map((days) => (
            <button key={days} type="button" className="secondary-button" onClick={() => chooseDays(days)}>
              Last {days} days
            </button>
          ))}
        </div>
        <div className={styles.filterGrid}>
          <label>From (IST)
            <input type="date" value={fromInput} max={today} onChange={(e) => setFromInput(e.target.value)}/>
          </label>
          <label>To (IST)
            <input type="date" value={toInput} max={today} onChange={(e) => setToInput(e.target.value)}/>
          </label>
          <button type="button" className="primary-button" onClick={applyDates}>Apply dates</button>
          <label>Status
            <select value={status} onChange={(e) => { setStatus(e.target.value as CallStatus); setPage(1); }}>
              <option value="ALL">Answered + missed</option>
              <option value="ANSWERED">Answered only</option>
              <option value="MISSED">Missed only</option>
            </select>
          </label>
          <label>Receiving number
            <select value={sim} onChange={(e) => { setSim(e.target.value); setPage(1); }}>
              <option value="">All handlers</option>
              {Array.from(new Set(cards.map((card) => card.sim).filter(Boolean))).map((number) => (
                <option key={number} value={number}>{number}</option>
              ))}
            </select>
          </label>
        </div>
        {validation && <p role="alert" className={styles.error}>{validation}</p>}
      </section>

      <section aria-label="IndiaMART summary" className={styles.kpis}>
        {[
          ["Incoming phone records", siteTotals.total],
          ["Answered phone records", siteTotals.answered],
          ["Missed phone records", siteTotals.missed],
          ["Answered rate", siteTotals.total ? Math.round(100 * siteTotals.answered / siteTotals.total) + "%" : "—"],
        ].map(([label, value]) => (
          <div className="stat-card" key={String(label)}>
            <span>{label}</span>
            <strong>{typeof value === "number" ? fmt(value) : value}</strong>
          </div>
        ))}
      </section>

      <div className={styles.note}>
        <strong>{activeSite.label}</strong> · {activeSite.tracking} · {range.from} through {range.to} (IST).
        A ring reaching multiple employee phones creates multiple call records; these totals are <strong>not unique customer enquiries</strong>.
        {site === "OTHER" && " These are IndiaMART-number calls received on unlinked, cross-routed or unresolved SIMs."}
        {(site === "KRISHNA" || site === "SF") && " Krishna and SF share the same tracking number; attribution follows the receiving company SIM."}
      </div>

      <section className={styles.section} aria-label="Employee breakdown">
        <div className={styles.sectionTitle}>
          <div><p className="eyebrow">Employee-wise</p><h2>Call handlers</h2></div>
          {sim && <button type="button" className="secondary-button" onClick={() => {setSim("");setPage(1);}}>Clear number filter</button>}
        </div>
        <div className={styles.handlers}>
          {cards.length ? cards.map((handler) => (
            <button key={handler.key} type="button"
              aria-pressed={Boolean(handler.sim && sim === handler.sim)}
              onClick={() => { setSim(handler.sim && sim !== handler.sim ? handler.sim : ""); setPage(1); }}
              className={styles.handler + (handler.sim && sim === handler.sim ? " " + styles.handlerSelected : "")}>
              <span className={styles.handlerName}>{handler.name}</span>
              <span className={styles.handlerSim}>{handler.sim || "Receiving SIM unresolved"}</span>
              <strong>{fmt(handler.total)} <small>records</small></strong>
              <span className={styles.handlerDetail}>{fmt(handler.answered)} answered · {fmt(handler.missed)} missed</span>
            </button>
          )) : <p className={styles.empty}>No call handlers found in this period.</p>}
        </div>
      </section>

      <section className={styles.section} aria-label="IndiaMART call history">
        <div className={styles.sectionTitle}>
          <div><p className="eyebrow">Full call history</p><h2>Calls received by employees</h2></div>
          <span className={styles.count}>{loading ? "Loading…" : fmt(data?.totalCount || 0) + " matching phone records"}</span>
        </div>
        {error && <div role="alert" className={styles.error}>{error}</div>}
        <div className={styles.tableScroll}>
          <table className={styles.callTable}>
            <thead><tr>
              <th>Date & time (IST)</th><th>Employee</th><th>Receiving SIM</th><th>Tracking caller ID</th>
              <th>Status</th><th>Duration</th><th>Device</th><th>SIM attribution</th>
            </tr></thead>
            <tbody>
              {!loading && !error && (data?.calls || []).map((call) => (
                <tr key={call.call_id}>
                  <td>{timeIST.format(new Date(call.started_at_epoch_ms))}</td>
                  <td><strong>{call.employee_name || "Unknown"}</strong><small>{call.employee_id || "Assignment unknown"}</small></td>
                  <td className="phone">{call.receiving_sim || "Unresolved"}</td>
                  <td className="phone">{call.tracking_number}</td>
                  <td><span className={"status-pill " + (call.direction === "INCOMING_ANSWERED" ? "success" : "warning")}>
                    {call.direction === "INCOMING_ANSWERED" ? "Answered" : "Missed"}
                  </span></td>
                  <td>{Math.max(0, Number(call.duration_seconds || 0))}s</td>
                  <td>{call.device_id}</td>
                  <td>{call.sim_confidence === "CONFIRMED" ? "Exact SIM" :
                    call.sim_confidence === "INFERRED" ? "Single-line fallback*" : "Unknown"}</td>
                </tr>
              ))}
              {!loading && !error && !data?.calls.length &&
                <tr><td colSpan={8} className={styles.empty}>No IndiaMART calls match these filters.</td></tr>}
              {loading && <tr><td colSpan={8} className={styles.empty}>Loading IndiaMART call records…</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="pagination-bar">
          <span>Page {page} of {data?.totalPages || 1} · 50 records per page</span>
          <div className="pagination-controls">
            <button type="button" className="pagination-btn" disabled={loading || page <= 1}
              onClick={() => setPage((value) => Math.max(1, value - 1))}>Previous</button>
            <button type="button" className="pagination-btn" disabled={loading || page >= (data?.totalPages || 1)}
              onClick={() => setPage((value) => value + 1)}>Next</button>
          </div>
        </div>
      </section>

      <p className={styles.footnote}>* Single-line fallback is inferred from the collector's registered line when an exact incoming SIM was not available. Calls with unresolved SIMs remain in Other receivers. IndiaMART's tracking caller ID does not reveal the original customer's phone number.</p>
    </div>
  );
}
