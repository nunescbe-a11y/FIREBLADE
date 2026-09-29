"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type Role = "ADMIN" | "MANAGEMENT";
type CompareMode = "same-period" | "previous-month" | "custom";
type QuickRange = "today" | "last7" | "last30" | "this-month" | "custom";
type ReportRanges = {
  currentFrom: string;
  currentTo: string;
  previousFrom: string;
  previousTo: string;
};

type PerformanceRow = {
  employee_id: string;
  employee_name: string;
  department_name: string;
  total_incoming: number;
  answered_calls: number;
  missed_calls: number;
  called_back: number;
  pending_callbacks: number;
  callback_rate: number;
  average_callback_minutes: number | null;
};

type Timing = {
  count: number;
  average_minutes: number | null;
  median_minutes: number | null;
  p90_minutes: number | null;
};

type Intelligence = {
  snapshot_ist: string;
  aging: {
    under_2h: number;
    h2_to_24: number;
    d1_to_3: number;
    d3_to_7: number;
    over_7d: number;
    total: number;
  };
  backlog: {
    total_pending: number;
    current_period_pending: number;
    previous_period_pending: number;
    older_pending: number;
  };
  timing: {
    current: Timing;
    previous: Timing;
  };
  employee_backlog: Array<{
    employee_id: string;
    employee_name: string;
    total_pending: number;
    current_month_pending: number;
    previous_month_pending: number;
    older_pending: number;
  }>;
};

type Summary = {
  incoming: number;
  answered: number;
  missed: number;
  resolved: number;
  pending: number;
  answerRate: number;
  callbackRate: number;
  pendingPer100Incoming: number;
  pendingPer100Missed: number;
  averageCallbackMinutes: number | null;
};

function istDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function parseDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const utc = new Date(Date.UTC(year, month - 1, day));
  if (
    utc.getUTCFullYear() !== year ||
    utc.getUTCMonth() !== month - 1 ||
    utc.getUTCDate() !== day
  ) return null;
  return { year, month, day, utc };
}

function isoDate(year: number, month: number, day: number) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function daysInMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function shiftMonth(value: string, delta: number) {
  const parsed = parseDate(value);
  if (!parsed) return value;
  const anchor = new Date(Date.UTC(parsed.year, parsed.month - 1 + delta, 1));
  const year = anchor.getUTCFullYear();
  const month = anchor.getUTCMonth() + 1;
  const day = Math.min(parsed.day, daysInMonth(year, month));
  return isoDate(year, month, day);
}

function addDays(value: string, delta: number) {
  const parsed = parseDate(value);
  if (!parsed) return value;
  const next = new Date(parsed.utc.getTime() + delta * 86_400_000);
  return isoDate(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate());
}

function fullPreviousMonth(value: string) {
  const parsed = parseDate(value);
  if (!parsed) return { from: value, to: value };
  const previous = new Date(Date.UTC(parsed.year, parsed.month - 2, 1));
  const year = previous.getUTCFullYear();
  const month = previous.getUTCMonth() + 1;
  return {
    from: isoDate(year, month, 1),
    to: isoDate(year, month, daysInMonth(year, month)),
  };
}

function initialRanges(): ReportRanges {
  const today = istDate();
  const [year, month] = today.split("-").map(Number);
  return {
    currentFrom: isoDate(year, month, 1),
    currentTo: today,
    previousFrom: shiftMonth(isoDate(year, month, 1), -1),
    previousTo: shiftMonth(today, -1),
  };
}

function comparisonFor(mode: CompareMode, currentFrom: string, currentTo: string, customFrom: string, customTo: string) {
  if (mode === "previous-month") return fullPreviousMonth(currentFrom);
  if (mode === "custom") return { from: customFrom, to: customTo };
  return { from: shiftMonth(currentFrom, -1), to: shiftMonth(currentTo, -1) };
}

function validateRange(from: string, to: string, today: string) {
  const parsedFrom = parseDate(from);
  const parsedTo = parseDate(to);
  const parsedToday = parseDate(today);
  if (!parsedFrom || !parsedTo || !parsedToday) return "Select valid dates.";
  if (parsedFrom.utc.getTime() > parsedTo.utc.getTime()) return "From date cannot be after To date.";
  if (parsedTo.utc.getTime() > parsedToday.utc.getTime()) return "Future dates are not allowed.";
  const days = Math.floor((parsedTo.utc.getTime() - parsedFrom.utc.getTime()) / 86_400_000) + 1;
  if (days > 366) return "A report range cannot exceed 366 days.";
  return "";
}

function monthLabel(date: string) {
  return new Intl.DateTimeFormat("en-IN", {
    month: "short",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  }).format(new Date(`${date}T12:00:00+05:30`));
}

function periodLabel(from: string, to: string) {
  const fromDate = new Date(`${from}T12:00:00+05:30`);
  const toDate = new Date(`${to}T12:00:00+05:30`);
  const fmt = new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
  return from === to ? fmt.format(fromDate) : `${fmt.format(fromDate)} - ${fmt.format(toDate)}`;
}

function round(value: number, digits = 1) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function percentage(part: number, total: number) {
  return total > 0 ? round((part * 100) / total) : 0;
}

function aggregate(rows: PerformanceRow[]): Summary {
  const incoming = rows.reduce((sum, row) => sum + Number(row.total_incoming || 0), 0);
  const answered = rows.reduce((sum, row) => sum + Number(row.answered_calls || 0), 0);
  const missed = rows.reduce((sum, row) => sum + Number(row.missed_calls || 0), 0);
  const resolved = rows.reduce((sum, row) => sum + Number(row.called_back || 0), 0);
  const pending = rows.reduce((sum, row) => sum + Number(row.pending_callbacks || 0), 0);

  let callbackMinutes = 0;
  let callbackWeight = 0;
  for (const row of rows) {
    const weight = Number(row.called_back || 0);
    if (row.average_callback_minutes != null && weight > 0) {
      callbackMinutes += Number(row.average_callback_minutes) * weight;
      callbackWeight += weight;
    }
  }

  return {
    incoming,
    answered,
    missed,
    resolved,
    pending,
    answerRate: percentage(answered, incoming),
    callbackRate: percentage(resolved, missed),
    pendingPer100Incoming: incoming > 0 ? round((pending * 100) / incoming) : 0,
    pendingPer100Missed: missed > 0 ? round((pending * 100) / missed) : 0,
    averageCallbackMinutes: callbackWeight ? round(callbackMinutes / callbackWeight) : null,
  };
}

function changeText(current: number, previous: number) {
  const delta = round(current - previous);
  if (delta === 0) return "No change";
  return `${delta > 0 ? "+" : ""}${delta} pp`;
}

function durationText(minutes: number | null) {
  if (minutes == null) return "-";
  if (minutes < 60) return `${round(minutes)} min`;
  const hours = minutes / 60;
  if (hours < 24) return `${round(hours)} hr`;
  return `${round(hours / 24)} d`;
}

function BarPair({
  label,
  current,
  previous,
  currentLabel,
  previousLabel,
}: {
  label: string;
  current: number;
  previous: number;
  currentLabel: string;
  previousLabel: string;
}) {
  const max = Math.max(current, previous, 1);
  return (
    <div className="pi-bar-row">
      <strong>{label}</strong>
      <div className="pi-bar-lines">
        <div>
          <span>{previousLabel}</span>
          <div className="pi-track"><i className="pi-fill previous" style={{ width: `${(previous / max) * 100}%` }} /></div>
          <b>{previous}</b>
        </div>
        <div>
          <span>{currentLabel}</span>
          <div className="pi-track"><i className="pi-fill current" style={{ width: `${(current / max) * 100}%` }} /></div>
          <b>{current}</b>
        </div>
      </div>
    </div>
  );
}

export default function PerformanceIntelligenceClient({ role }: { role: Role }) {
  const defaults = useMemo(initialRanges, []);
  const today = useMemo(istDate, []);

  const [currentFrom, setCurrentFrom] = useState(defaults.currentFrom);
  const [currentTo, setCurrentTo] = useState(defaults.currentTo);
  const [compareMode, setCompareMode] = useState<CompareMode>("same-period");
  const [compareFrom, setCompareFrom] = useState(defaults.previousFrom);
  const [compareTo, setCompareTo] = useState(defaults.previousTo);
  const [quickRange, setQuickRange] = useState<QuickRange>("this-month");
  const [appliedRanges, setAppliedRanges] = useState<ReportRanges>(defaults);
  const [refreshToken, setRefreshToken] = useState(0);

  const [currentRows, setCurrentRows] = useState<PerformanceRow[]>([]);
  const [previousRows, setPreviousRows] = useState<PerformanceRow[]>([]);
  const [intelligence, setIntelligence] = useState<Intelligence | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [rangeError, setRangeError] = useState("");

  useEffect(() => {
    if (compareMode === "custom") return;
    const next = comparisonFor(compareMode, currentFrom, currentTo, compareFrom, compareTo);
    setCompareFrom(next.from);
    setCompareTo(next.to);
  }, [compareMode, currentFrom, currentTo]);

  const load = useCallback(async (ranges: ReportRanges) => {
    setLoading(true);
    setError("");
    try {
      const query = new URLSearchParams(ranges);
      const response = await fetch(`/api/management/performance/intelligence?${query}`, { cache: "no-store" });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || "Could not load performance intelligence");

      setCurrentRows(json.current_rows || []);
      setPreviousRows(json.previous_rows || []);
      setIntelligence(json);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load performance intelligence");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(appliedRanges);
  }, [load, appliedRanges, refreshToken]);

  const applySelection = () => {
    const currentError = validateRange(currentFrom, currentTo, today);
    const previousError = validateRange(compareFrom, compareTo, today);
    if (currentError || previousError) {
      setRangeError(currentError || previousError);
      return;
    }
    setRangeError("");
    const next = {
      currentFrom,
      currentTo,
      previousFrom: compareFrom,
      previousTo: compareTo,
    };
    const same =
      next.currentFrom === appliedRanges.currentFrom &&
      next.currentTo === appliedRanges.currentTo &&
      next.previousFrom === appliedRanges.previousFrom &&
      next.previousTo === appliedRanges.previousTo;
    setAppliedRanges(next);
    if (same) setRefreshToken(value => value + 1);
  };

  const chooseQuickRange = (range: QuickRange) => {
    setQuickRange(range);
    if (range === "custom") return;

    let from = today;
    let to = today;
    if (range === "last7") from = addDays(today, -6);
    if (range === "last30") from = addDays(today, -29);
    if (range === "this-month") {
      const parsed = parseDate(today);
      if (parsed) from = isoDate(parsed.year, parsed.month, 1);
    }

    setCurrentFrom(from);
    setCurrentTo(to);
  };

  const updateCurrentFrom = (value: string) => {
    setCurrentFrom(value);
    setQuickRange("custom");
  };
  const updateCurrentTo = (value: string) => {
    setCurrentTo(value);
    setQuickRange("custom");
  };

  const current = useMemo(() => aggregate(currentRows), [currentRows]);
  const previous = useMemo(() => aggregate(previousRows), [previousRows]);

  const employeeRows = useMemo(() => {
    const previousMap = new Map(previousRows.map(row => [row.employee_id, row]));
    return currentRows.map(row => {
      const old = previousMap.get(row.employee_id);
      return {
        ...row,
        previous_pending: Number(old?.pending_callbacks || 0),
        pending_change: Number(row.pending_callbacks || 0) - Number(old?.pending_callbacks || 0),
        callback_change: round(Number(row.callback_rate || 0) - Number(old?.callback_rate || 0)),
      };
    }).sort((a, b) => Number(b.pending_callbacks) - Number(a.pending_callbacks));
  }, [currentRows, previousRows]);

  const attentionRows = useMemo(
    () => employeeRows
      .filter(row => Number(row.pending_callbacks) >= 20 || (Number(row.missed_calls) >= 20 && Number(row.callback_rate) < 60))
      .slice(0, 5),
    [employeeRows]
  );

  const agingRows = intelligence ? [
    { label: "Under 2 hours", value: intelligence.aging.under_2h },
    { label: "2 - 24 hours", value: intelligence.aging.h2_to_24 },
    { label: "1 - 3 days", value: intelligence.aging.d1_to_3 },
    { label: "3 - 7 days", value: intelligence.aging.d3_to_7 },
    { label: "Over 7 days", value: intelligence.aging.over_7d },
  ] : [];
  const biggestAge = Math.max(...agingRows.map(row => row.value), 1);

  const answerImproved = current.answerRate >= previous.answerRate;
  const callbackImproved = current.callbackRate >= previous.callbackRate;
  const speedCurrent = intelligence?.timing.current.median_minutes ?? null;
  const speedPrevious = intelligence?.timing.previous.median_minutes ?? null;
  const speedImproved = speedCurrent != null && speedPrevious != null && speedCurrent <= speedPrevious;
  const hasData = Boolean(intelligence && (currentRows.length || previousRows.length || intelligence.backlog.total_pending >= 0));

  const summarySentence = loading
    ? "Calculating the live management summary..."
    : error && !hasData
      ? "Live performance statistics are unavailable. Correct the error above and refresh."
      : `Incoming volume is ${current.incoming >= previous.incoming ? "higher" : "lower"} than the selected comparison period. Answer rate ${answerImproved ? "improved" : "declined"}, callback completion ${callbackImproved ? "improved" : "needs attention"}, and median callback speed ${speedImproved ? "improved" : "needs attention"}.`;

  const currentBarLabel = periodLabel(appliedRanges.currentFrom, appliedRanges.currentTo);
  const previousBarLabel = periodLabel(appliedRanges.previousFrom, appliedRanges.previousTo);

  const exportCsv = () => {
    const lines = [[
      "Employee","ID","Incoming","Answered","Missed","Resolved","Pending",
      "Callback Rate","Previous Pending","Pending Change","Callback Rate Change"
    ].join(",")];

    for (const row of employeeRows) {
      const values = [
        row.employee_name,row.employee_id,row.total_incoming,row.answered_calls,row.missed_calls,
        row.called_back,row.pending_callbacks,row.callback_rate,row.previous_pending,row.pending_change,row.callback_change
      ];
      lines.push(values.map(value => `"${String(value).replaceAll('"', '""')}"`).join(","));
    }

    const blob = new Blob([lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `fireblade-performance-${appliedRanges.currentFrom}-to-${appliedRanges.currentTo}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section className="performance-intelligence">
      <header className="page-header pi-header">
        <div>
          <p className="eyebrow">Admin & Management</p>
          <h1>Performance Intelligence</h1>
          <p>Compare any selected call-performance period with the same period last month, the previous calendar month, or your own custom period.</p>
        </div>
        <div className="header-actions">
          <button className="secondary-button" onClick={() => window.print()}>Print / Save PDF</button>
          {role === "ADMIN" && <button className="secondary-button" onClick={exportCsv}>Export CSV</button>}
          <button className="primary-button" disabled={loading} onClick={applySelection}>{loading ? "Refreshing..." : "Refresh Live"}</button>
        </div>
      </header>

      <section className="panel pi-date-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Report period</p>
            <h2>Select dates manually</h2>
          </div>
          <span>Future dates blocked Â· Maximum 366 days</span>
        </div>

        <div className="pi-quick-ranges" aria-label="Quick date ranges">
          <button className={quickRange === "today" ? "active" : ""} onClick={() => chooseQuickRange("today")}>Today</button>
          <button className={quickRange === "last7" ? "active" : ""} onClick={() => chooseQuickRange("last7")}>Last 7 Days</button>
          <button className={quickRange === "last30" ? "active" : ""} onClick={() => chooseQuickRange("last30")}>Last 30 Days</button>
          <button className={quickRange === "this-month" ? "active" : ""} onClick={() => chooseQuickRange("this-month")}>This Month</button>
          <button className={quickRange === "custom" ? "active" : ""} onClick={() => chooseQuickRange("custom")}>Custom</button>
        </div>

        <div className="pi-date-grid">
          <label>
            <span>From</span>
            <input type="date" value={currentFrom} max={today} onChange={event => updateCurrentFrom(event.target.value)} />
          </label>
          <label>
            <span>To</span>
            <input type="date" value={currentTo} max={today} onChange={event => updateCurrentTo(event.target.value)} />
          </label>
          <label>
            <span>Compare with</span>
            <select value={compareMode} onChange={event => setCompareMode(event.target.value as CompareMode)}>
              <option value="same-period">Same period previous month</option>
              <option value="previous-month">Previous calendar month</option>
              <option value="custom">Custom comparison</option>
            </select>
          </label>
          <label>
            <span>Compare From</span>
            <input
              type="date"
              value={compareFrom}
              max={today}
              disabled={compareMode !== "custom"}
              onChange={event => setCompareFrom(event.target.value)}
            />
          </label>
          <label>
            <span>Compare To</span>
            <input
              type="date"
              value={compareTo}
              max={today}
              disabled={compareMode !== "custom"}
              onChange={event => setCompareTo(event.target.value)}
            />
          </label>
          <div className="pi-date-apply">
            <button className="primary-button" onClick={applySelection} disabled={loading}>Apply / Refresh</button>
          </div>
        </div>

        {rangeError && <div className="pi-range-error" role="alert">{rangeError}</div>}
        <p className="pi-date-help">
          Default comparison is statistically fair: the selected period is matched against the equivalent dates one month earlier. Choose Custom comparison when you need an exact management review period.
        </p>
      </section>

      {error && <div className="error-banner" role="alert">{error}</div>}

      <div className="pi-period">
        <div><span>Current comparison</span><strong>{appliedRanges.currentFrom} to {appliedRanges.currentTo}</strong></div>
        <div><span>Comparison period</span><strong>{appliedRanges.previousFrom} to {appliedRanges.previousTo}</strong></div>
        <div><span>Live snapshot</span><strong>{intelligence?.snapshot_ist || "Loading..."} IST</strong></div>
      </div>

      <div className="pi-summary">
        <div className={`pi-summary-mark ${answerImproved && speedImproved ? "positive" : "watch"}`} aria-hidden="true">
          {answerImproved && speedImproved ? "UP" : "!"}
        </div>
        <div><strong>Management summary</strong><p>{summarySentence}</p></div>
      </div>

      <div className="pi-kpi-grid">
        <article className="pi-kpi"><span>Incoming calls</span><strong>{current.incoming}</strong><small>{previous.incoming} comparison period</small></article>
        <article className="pi-kpi"><span>Answer rate</span><strong>{current.answerRate}%</strong><small>{changeText(current.answerRate, previous.answerRate)} vs comparison</small></article>
        <article className="pi-kpi"><span>Callback completion</span><strong>{current.callbackRate}%</strong><small>{changeText(current.callbackRate, previous.callbackRate)} vs comparison</small></article>
        <article className="pi-kpi"><span>Median callback time</span><strong className="pi-text-kpi">{durationText(speedCurrent)}</strong><small>Comparison {durationText(speedPrevious)}</small></article>
        <article className="pi-kpi"><span>Pending / 100 incoming</span><strong>{current.pendingPer100Incoming}</strong><small>Comparison {previous.pendingPer100Incoming}</small></article>
        <article className="pi-kpi"><span>Current period pending</span><strong>{current.pending}</strong><small>{current.pendingPer100Missed} per 100 missed calls</small></article>
      </div>

      <div className="pi-grid-two">
        <section className="panel pi-panel">
          <div className="panel-heading">
            <div><p className="eyebrow">Selected-period comparison</p><h2>{currentBarLabel} vs {previousBarLabel}</h2></div>
          </div>
          <div className="pi-bars">
            <BarPair label="Answered" previous={previous.answered} current={current.answered} previousLabel="Comparison" currentLabel="Selected" />
            <BarPair label="Missed" previous={previous.missed} current={current.missed} previousLabel="Comparison" currentLabel="Selected" />
            <BarPair label="Callbacks resolved" previous={previous.resolved} current={current.resolved} previousLabel="Comparison" currentLabel="Selected" />
            <BarPair label="Still pending" previous={previous.pending} current={current.pending} previousLabel="Comparison" currentLabel="Selected" />
          </div>
        </section>

        <section className="panel pi-panel">
          <div className="panel-heading"><div><p className="eyebrow">Callback speed</p><h2>How quickly missed calls are recovered</h2></div></div>
          <div className="pi-speed-grid">
            <div><span>Median selected</span><strong>{durationText(intelligence?.timing.current.median_minutes ?? null)}</strong></div>
            <div><span>Median comparison</span><strong>{durationText(intelligence?.timing.previous.median_minutes ?? null)}</strong></div>
            <div><span>Average selected</span><strong>{durationText(intelligence?.timing.current.average_minutes ?? current.averageCallbackMinutes)}</strong></div>
            <div><span>90th percentile</span><strong>{durationText(intelligence?.timing.current.p90_minutes ?? null)}</strong></div>
          </div>
          <p className="pi-explain">Median is the clearest everyday measure: half of completed callbacks were faster than this time and half were slower.</p>
        </section>
      </div>

      <div className="pi-grid-two">
        <section className="panel pi-panel">
          <div className="panel-heading"><div><p className="eyebrow">Historical backlog</p><h2>Unresolved missed-call rows</h2></div></div>
          <div className="pi-backlog-cards">
            <div><span>All history</span><strong>{intelligence?.backlog.total_pending ?? "-"}</strong></div>
            <div><span>Selected period</span><strong>{intelligence?.backlog.current_period_pending ?? "-"}</strong></div>
            <div><span>Comparison period</span><strong>{intelligence?.backlog.previous_period_pending ?? "-"}</strong></div>
            <div><span>Older unresolved</span><strong>{intelligence?.backlog.older_pending ?? "-"}</strong></div>
          </div>
          <p className="pi-explain">These are unresolved missed-call task rows, not necessarily unique customers. The daily 09:15 WhatsApp report is a separate previous-day view.</p>
        </section>

        <section className="panel pi-panel">
          <div className="panel-heading"><div><p className="eyebrow">Backlog aging</p><h2>How old are the pending callbacks?</h2></div></div>
          <div className="pi-aging">
            {agingRows.map(row => (
              <div key={row.label}>
                <span>{row.label}</span>
                <div className="pi-track"><i className="pi-fill aging" style={{ width: `${(row.value / biggestAge) * 100}%` }} /></div>
                <strong>{row.value}</strong>
              </div>
            ))}
          </div>
        </section>
      </div>

      <section className="panel pi-panel">
        <div className="panel-heading">
          <div><p className="eyebrow">Action view</p><h2>{role === "MANAGEMENT" ? "Employees needing attention" : "Employee performance comparison"}</h2></div>
          <span>{role === "MANAGEMENT" ? "Highest workload / lower completion indicators" : `${employeeRows.length} active employees`}</span>
        </div>
        <div className="table-scroll">
          <table className="pi-employee-table">
            <thead>
              <tr><th>Employee</th><th>Incoming</th><th>Missed</th><th>Resolved</th><th>Pending</th><th>Callback %</th><th>Comparison Pending</th><th>Pending Change</th><th>Rate Change</th></tr>
            </thead>
            <tbody>
              {(role === "MANAGEMENT" ? attentionRows : employeeRows).map(row => (
                <tr key={row.employee_id}>
                  <td><strong>{row.employee_name}</strong><small>{row.employee_id} - {row.department_name}</small></td>
                  <td>{row.total_incoming}</td>
                  <td>{row.missed_calls}</td>
                  <td>{row.called_back}</td>
                  <td><strong>{row.pending_callbacks}</strong></td>
                  <td>{row.callback_rate}%</td>
                  <td>{row.previous_pending}</td>
                  <td><span className={`pi-change ${row.pending_change <= 0 ? "good" : "watch"}`}>{row.pending_change > 0 ? "+" : ""}{row.pending_change}</span></td>
                  <td><span className={`pi-change ${row.callback_change >= 0 ? "good" : "watch"}`}>{row.callback_change > 0 ? "+" : ""}{row.callback_change} pp</span></td>
                </tr>
              ))}
              {!loading && !(role === "MANAGEMENT" ? attentionRows : employeeRows).length && (
                <tr><td colSpan={9} className="empty-state">No matching performance data.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        {role === "MANAGEMENT" && <p className="pi-explain">A high pending count can reflect higher call volume. Use pending count together with callback rate and missed-call volume before taking action.</p>}
      </section>

      {role === "ADMIN" && intelligence && (
        <section className="panel pi-panel">
          <div className="panel-heading">
            <div><p className="eyebrow">Technical backlog</p><h2>All-history unresolved by employee</h2></div>
            <span>{intelligence.employee_backlog.length} employees with unresolved rows</span>
          </div>
          <div className="table-scroll">
            <table className="pi-employee-table">
              <thead><tr><th>Employee</th><th>All Pending</th><th>Selected Period</th><th>Comparison Period</th><th>Older</th></tr></thead>
              <tbody>
                {intelligence.employee_backlog.map(row => (
                  <tr key={row.employee_id}>
                    <td><strong>{row.employee_name}</strong><small>{row.employee_id}</small></td>
                    <td>{row.total_pending}</td>
                    <td>{row.current_month_pending}</td>
                    <td>{row.previous_month_pending}</td>
                    <td>{row.older_pending}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </section>
  );
}