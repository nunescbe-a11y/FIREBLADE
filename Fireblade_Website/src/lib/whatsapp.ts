import { supabaseRest } from "@/lib/supabase";

export function whatsappSessionKey(employeeId:string){return `fb_${employeeId.toLowerCase().replace(/[^a-z0-9_-]/g,'_')}`}
export async function bridgeRequest<T>(path:string,init?:RequestInit):Promise<T>{
 const base=process.env.FIREBLADE_WHATSAPP_BRIDGE_URL?.trim().replace(/\/$/,'');
 const secret=process.env.FIREBLADE_WHATSAPP_BRIDGE_KEY?.trim();
 if(!base||!secret)throw new Error('WhatsApp bridge is not configured');

 // Guard: localhost/127.0.0.1 URLs are unreachable from Vercel serverless.
 // FIREBLADE_WHATSAPP_BRIDGE_URL must point to the Cloudflare Tunnel public
 // hostname (e.g. https://bridge.example.com) in Vercel Production.
 if(process.env.VERCEL){
  try{
   const u=new URL(base);
   if(u.hostname==='localhost'||u.hostname==='127.0.0.1'||u.hostname==='[::1]'){
    throw new Error(
     'FIREBLADE_WHATSAPP_BRIDGE_URL points at localhost which is unreachable from Vercel. '+
     'Set it to the Cloudflare Tunnel public hostname for the WhatsApp bridge.'
    );
   }
  }catch(e){
   if(e instanceof Error && e.message.includes('unreachable from Vercel'))throw e;
   throw new Error(`FIREBLADE_WHATSAPP_BRIDGE_URL is not a valid URL: ${base}`);
  }
 }

 const url=`${base}${path.startsWith('/')?path:`/${path}`}`;
 let r:Response;
 try{
  r=await fetch(url,{...init,cache:'no-store',headers:{'Content-Type':'application/json','X-Fireblade-Bridge-Key':secret,...(init?.headers||{})},signal:init?.signal??AbortSignal.timeout(30000)});
 }catch(fetchError){
  const msg=fetchError instanceof Error?fetchError.message:String(fetchError);
  throw new Error(`WhatsApp bridge network error (${url}): ${msg}`);
 }
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
