export default function HealthStatusPill({ value }: { value: "ON" | "OFF" | "UNKNOWN" }) {
  const cls = value === "ON" ? "health-on" : value === "OFF" ? "health-off" : "health-unknown";
  return <span className={`health-pill ${cls}`}><span className="health-dot" />{value}</span>;
}
