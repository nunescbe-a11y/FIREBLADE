export function storageConfig() {
 const url=process.env.SUPABASE_URL?.replace(/\/$/,""),key=process.env.SUPABASE_SECRET_KEY;
 if(!url?.startsWith("https://")||!key)throw Error("Storage is not configured");
 return {url,key};
}
export async function storageRequest(path:string,init:RequestInit={}) {
 const {url,key}=storageConfig();
 const r=await fetch(`${url}/storage/v1/${path}`,{...init,cache:"no-store",headers:{apikey:key,...(key.startsWith("eyJ")?{Authorization:`Bearer ${key}`}:{ }),...(init.headers||{})},signal:init.signal||AbortSignal.timeout(15000)});
 if(!r.ok)throw Error(`App storage request failed (${r.status})`);
 return r;
}
