export function when(value: string | number | null | undefined) {
 if(!value)return "—";const d=new Date(value);return Number.isNaN(+d)?"—":new Intl.DateTimeFormat("en-IN",{timeZone:"Asia/Kolkata",day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit",second:"2-digit"}).format(d);
}
