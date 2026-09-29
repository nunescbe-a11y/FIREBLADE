import { supabaseRest } from "@/lib/supabase";

export function whatsappSessionKey(employeeId:string){return `fb_${employeeId.toLowerCase().replace(/[^a-z0-9_-]/g,'_')}`}
export async function bridgeRequest<T>(path:string,init?:RequestInit):Promise<T>{
 const base=process.env.FIREBLADE_WHATSAPP_BRIDGE_URL?.trim().replace(/\/$/,'');
 const secret=process.env.FIREBLADE_WHATSAPP_BRIDGE_KEY?.trim();
 if(!base||!secret)throw new Error('WhatsApp bridge is not configured');
 const r=await fetch(`${base}${path.startsWith('/')?path:`/${path}`}`,{...init,cache:'no-store',headers:{'Content-Type':'application/json','X-Fireblade-Bridge-Key':secret,...(init?.headers||{})},signal:init?.signal??AbortSignal.timeout(30000)});
 const text=await r.text();let data:any={};try{data=text?JSON.parse(text):{}}catch{data={error:text}}
 if(!r.ok)throw new Error(data.error||data.message||`WhatsApp bridge ${r.status}`);return data as T;
}
export async function ensureWhatsappConnection(employeeId:string){
 const rows=await supabaseRest<Array<{employee_id:string;session_key:string;whatsapp_number:string|null;status:string;connected_at:string|null;last_seen_at:string|null;last_error:string|null}>>(`fireblade_whatsapp_connections?select=*&employee_id=eq.${encodeURIComponent(employeeId)}&limit=1`);
 if(rows[0])return rows[0];
 const session_key=whatsappSessionKey(employeeId);
 const created=await supabaseRest<any[]>(`fireblade_whatsapp_connections`,{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify({employee_id:employeeId,session_key,status:'DISCONNECTED'})});
 return created[0];
}
