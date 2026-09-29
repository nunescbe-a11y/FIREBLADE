import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { supabaseRest } from "@/lib/supabase";
import type { CallbackTask } from "@/lib/types";

function todayIST(){return new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Kolkata",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date())}
function metrics(rows:CallbackTask[]){const resolved=rows.filter(r=>r.callback_status==='RESOLVED');const pending=rows.length-resolved.length;const mins=resolved.map(r=>Number(r.callback_minutes)).filter(Number.isFinite);return {total_missed:rows.length,pending,resolved:resolved.length,callback_rate:rows.length?Math.round(resolved.length*1000/rows.length)/10:0,average_callback_minutes:mins.length?Math.round(mins.reduce((a,b)=>a+b,0)*10/mins.length)/10:null}}

export async function GET(request:Request){
 const user=await getSession(); if(!user)return NextResponse.json({error:'Unauthorized'},{status:401});
 const url=new URL(request.url); const date=(url.searchParams.get('date')||todayIST()).trim();
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return NextResponse.json({error:'Invalid date'},{status:400});
 const employeeParam=url.searchParams.get('employee')?.trim()||''; const departmentParam=url.searchParams.get('department')?.trim()||'';
 const employeeId=user.role==='MARKETING'?(user.employee_id||''):employeeParam;
 let path=`fireblade_missed_call_tasks?select=*&missed_date_ist=eq.${date}&order=missed_at_epoch_ms.desc&limit=5000`;
 if(user.role==='MARKETING'){if(!employeeId)return NextResponse.json({error:'Employee account is not linked'},{status:403});path+=`&employee_id=eq.${encodeURIComponent(employeeId)}`}
 try{
   const all=await supabaseRest<CallbackTask[]>(path);
   const departmentMap=new Map<string,{department_id:string;department_name:string;rows:CallbackTask[]}>();
   for(const row of all){const key=row.department_id||'UNASSIGNED';const current=departmentMap.get(key)||{department_id:key,department_name:row.department_name||'Unassigned',rows:[]};current.rows.push(row);departmentMap.set(key,current)}
   const departments=[...departmentMap.values()].map(d=>({...d,...metrics(d.rows),rows:undefined})).sort((a,b)=>a.department_name.localeCompare(b.department_name));
   const narrowedDepartment=departmentParam?all.filter(r=>(r.department_id||'UNASSIGNED')===departmentParam):all;
   const photoRows = user.role === 'MARKETING' ? [] : await supabaseRest<Array<{employee_id:string;profile_photo_updated_at:string|null}>>("fireblade_employees?select=employee_id,profile_photo_updated_at&active=eq.true");
   const photoByEmployee = new Map(photoRows.map(r => [r.employee_id, r.profile_photo_updated_at]));
   const employeeMap=new Map<string,{employee_id:string;employee_name:string;rows:CallbackTask[]}>();
   for(const row of narrowedDepartment){const key=row.employee_id;const current=employeeMap.get(key)||{employee_id:key,employee_name:row.employee_name||key,rows:[]};current.rows.push(row);employeeMap.set(key,current)}
   const employees=[...employeeMap.values()].map(e=>({...e,...metrics(e.rows),profile_photo_updated_at:photoByEmployee.get(e.employee_id)||null,rows:undefined})).sort((a,b)=>a.employee_name.localeCompare(b.employee_name));
   const rows=employeeId?narrowedDepartment.filter(r=>r.employee_id===employeeId):narrowedDepartment;
   return NextResponse.json({date,user,metrics:metrics(user.role==='MARKETING'?all:(employeeId?rows:(departmentParam?narrowedDepartment:all))),departments,employees,rows:user.role==='MARKETING'||employeeId?rows:[]});
 }catch(error){console.error('[Fireblade Gen2 callbacks]',error);return NextResponse.json({error:error instanceof Error?error.message:'Could not load callback report'},{status:500})}
}
