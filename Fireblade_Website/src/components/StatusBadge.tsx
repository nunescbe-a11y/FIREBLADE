export function StatusBadge({value}:{value:string}) {
 const good=["ON CONFIRMED","ON","YES","RESPONDED","GRANTED","CURRENT","UP TO DATE"].includes(value);
 const bad=["OFF CONFIRMED","OFF","NO","FAILED","MISSING","NOT INSTALLED","KEY MISMATCH","REINSTALL NEEDED"].includes(value);
 const pending=["PENDING","AVAILABLE","UPDATE AVAILABLE","DOWNLOADING","AWAITING_INSTALL","INSTALL PENDING"].includes(value);
 return <span className={`status-badge ${good?"good":bad?"bad":pending?"pending":"unknown"}`}>{value.replaceAll("_"," ")}</span>;
}
