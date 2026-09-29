export type PendingCallReportRow = {
  missed_call_id: number;
  employee_id: string;
  employee_name: string | null;
  department_name: string | null;
  phone_number_raw: string | null;
  phone_number_normalized: string | null;
  missed_at_epoch_ms: number;
  callback_status: "PENDING" | "RESOLVED";
};

const IST = "Asia/Kolkata";
const MAX_MESSAGE_CHARS = 9000;

export function reportDateIST(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: IST,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function formatPendingCallIST(epochMs: number) {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: IST,
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(epochMs));
}

function cleanPhone(row: PendingCallReportRow) {
  const value = row.phone_number_normalized || row.phone_number_raw || "Unknown number";
  const digits = value.replace(/\D/g, "");
  return digits.length >= 8 ? `+${digits}` : value;
}

function itemText(row: PendingCallReportRow, index: number) {
  return `${index}. ${cleanPhone(row)}\n   Customer called: ${formatPendingCallIST(Number(row.missed_at_epoch_ms))} IST`;
}

function header(employeeName: string, total: number, part?: { current: number; total: number }) {
  const partText = part && part.total > 1 ? ` · Part ${part.current}/${part.total}` : "";
  return [
    `🔥 FIREBLADE — PENDING CALL REPORT${partText}`,
    `09:15 AM IST · ${employeeName}`,
    "",
    `${total} customer callback${total === 1 ? " is" : "s are"} still pending.`,
    "",
  ].join("\n");
}

export function buildPendingCallReportMessages(employeeName: string, rows: PendingCallReportRow[]) {
  const pending = rows
    .filter(row => row.callback_status === "PENDING")
    .sort((a, b) => Number(a.missed_at_epoch_ms) - Number(b.missed_at_epoch_ms));

  if (!pending.length) return [];

  const itemBlocks = pending.map((row, index) => itemText(row, index + 1));
  const groups: string[][] = [];
  let current: string[] = [];
  let currentLength = 0;

  for (const block of itemBlocks) {
    const projected = currentLength + block.length + 2;
    if (current.length && projected > MAX_MESSAGE_CHARS - 500) {
      groups.push(current);
      current = [];
      currentLength = 0;
    }
    current.push(block);
    currentLength += block.length + 2;
  }
  if (current.length) groups.push(current);

  return groups.map((blocks, index) => {
    const body = blocks.join("\n\n");
    const footer = "\n\nPlease complete these callbacks. Resolved calls will automatically disappear from the next report.";
    return `${header(employeeName, pending.length, { current: index + 1, total: groups.length })}${body}${footer}`.slice(0, 12000);
  });
}
