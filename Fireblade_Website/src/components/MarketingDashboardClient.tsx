"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { IncomingCall, SessionUser } from "@/lib/types";
import { formatIST } from "@/lib/format";
import EmployeeAvatar from "@/components/EmployeeAvatar";

function todayIST(){return new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Kolkata",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date())}
function greetingIST(){
  const hour = Number(new Intl.DateTimeFormat("en-US",{timeZone:"Asia/Kolkata",hour:"2-digit",hourCycle:"h23"}).format(new Date()));
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

export default function MarketingDashboardClient({user}:{user:SessionUser}){
  const [calls,setCalls]=useState<IncomingCall[]>([]);
  const [callback,setCallback]=useState({pending:0,resolved:0,callback_rate:0,average_callback_minutes:null as number|null});
  const [loading,setLoading]=useState(true),[error,setError]=useState("");
  const load=async()=>{try{const [cr,rr]=await Promise.all([fetch("/api/calls?limit=1000&today=true",{cache:"no-store"}),fetch(`/api/callbacks?date=${todayIST()}`,{cache:"no-store"})]);const [c,j]=await Promise.all([cr.json(),rr.json()]);if(!cr.ok)throw Error(c.error||"Could not load calls");if(!rr.ok)throw Error(j.error||"Could not load callbacks");setCalls(c.calls||[]);setCallback(j.metrics||callback);setError("")}catch(e){setError(e instanceof Error?e.message:"Could not load dashboard")}finally{setLoading(false)}};
  useEffect(()=>{void load();const t=setInterval(()=>{if(!document.hidden)void load()},30000);return()=>clearInterval(t)},[]);
  const answered=calls.filter(c=>c.direction==="INCOMING_ANSWERED").length;
  const missed=calls.filter(c=>c.direction==="INCOMING_MISSED").length;
  const name=user.employee_name||user.username;
  return <>
    <section className="employee-welcome-card">
      <EmployeeAvatar employeeId={user.employee_id} employeeName={name} photoUpdatedAt={user.profile_photo_updated_at} size="xl"/>
      <div className="employee-welcome-copy"><p className="eyebrow">My Fireblade workspace</p><h1>{greetingIST()}, {name} 👋</h1><p>{user.department_name||"Marketing"} · {user.employee_id} · Here is your call activity and follow-up for today.</p></div>
      <div className="header-actions"><Link className="secondary-button" href="/callbacks">Open My Callbacks</Link><Link className="primary-button" href="/whatsapp">Share Products</Link></div>
    </section>
    {error&&<div className="error-banner">{error}</div>}
    <div className="health-summary-grid"><div className="stat-card"><span>Incoming Today</span><strong>{loading?"—":calls.length}</strong></div><div className="stat-card"><span>Answered</span><strong>{loading?"—":answered}</strong></div><div className="stat-card"><span>Missed</span><strong>{loading?"—":missed}</strong></div><div className="stat-card callback-pending"><span>Pending Callback</span><strong>{loading?"—":callback.pending}</strong></div><div className="stat-card"><span>Resolved Callback</span><strong>{loading?"—":callback.resolved}</strong></div></div>
    <div className="dashboard-grid"><section className="panel"><div className="panel-heading"><h2>Recent Calls</h2><Link href="/calls">View all</Link></div><div className="recent-list">{calls.slice(0,8).map(c=><div className="recent-item" key={c.call_id}><div className={`call-icon ${c.direction==="INCOMING_MISSED"?"missed":"ok"}`}>{c.direction==="INCOMING_MISSED"?"!":"✓"}</div><div><strong>{c.phone_number_normalized||c.phone_number_raw||"Unknown"}</strong><span>{c.person_name||c.company_name||c.device_id}</span></div><time>{formatIST(c.started_at_epoch_ms)}</time></div>)}{!loading&&!calls.length&&<div className="empty-panel">No incoming calls today.</div>}</div></section><section className="panel"><h2>My Follow-up</h2><div className="employee-followup"><p><span>Callback rate</span><strong>{callback.callback_rate}%</strong></p><p><span>Average response</span><strong>{callback.average_callback_minutes==null?"—":`${callback.average_callback_minutes} min`}</strong></p><p><span>Pending customers</span><strong>{callback.pending}</strong></p></div><div className="quick-actions"><Link className="primary-button" href="/callbacks">Work Pending Callbacks</Link><Link className="secondary-button" href="/whatsapp">Send Catalogue / Specifications</Link></div></section></div>
  </>;
}
