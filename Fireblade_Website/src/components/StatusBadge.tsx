export function StatusBadge({value}:{value:string}) {
 const good=["ON CONFIRMED","ON","YES","RESPONDED","GRANTED","CURRENT"].includes(value);
 const bad=["OFF CONFIRMED","OFF","NO","FAILED","MISSING"].includes(value);
 const pending=["PENDING","AVAILABLE","DOWNLOADING","AWAITING_INSTALL"].includes(value);
 return <span className={`status-badge ${good?"good":bad?"bad":pending?"pending":"unknown"}`}>{value.replaceAll("_"," ")}</span>;
}
