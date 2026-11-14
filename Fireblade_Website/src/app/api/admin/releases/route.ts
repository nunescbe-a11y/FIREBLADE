import {createHash,randomUUID} from "node:crypto";
import {NextResponse} from "next/server";
import {requireUser,apiError,AccessError,audit,uuid} from "@/lib/admin";
import {supabaseRest} from "@/lib/supabase";
import {storageConfig,storageRequest} from "@/lib/storage";

export const maxDuration=60;

type Release={
  id:string;
  object_path:string;
  size_bytes:number;
  sha256:string;
  status:string;
  version_code:number;
  version_name:string;
  target_device_id:string|null;
};

type Device={device_id:string};

async function validateTarget(targetRaw:unknown){
  const target=String(targetRaw||"").trim().toUpperCase();
  if(!target)return null;
  if(!/^[A-Z0-9._-]{1,100}$/.test(target))throw new AccessError(400,"Invalid target device");
  const rows=await supabaseRest<Device[]>(`fireblade_devices?select=device_id&device_id=eq.${encodeURIComponent(target)}&active=eq.true&limit=1`);
  if(!rows[0])throw new AccessError(400,"Target phone is not an active registered Fireblade device");
  return target;
}

export async function GET(){
  try{
    await requireUser();
    const [releases,devices,health,updates,employees,assignments,departments]=await Promise.all([
      supabaseRest("fireblade_app_releases?select=*&order=version_code.desc&limit=30"),
      supabaseRest<Array<{device_id:string;device_name:string|null;company_phone_number:string|null}>>("fireblade_devices?select=device_id,device_name,company_phone_number&active=eq.true&order=device_id.asc"),
      supabaseRest("fireblade_device_health?select=device_id,apk_version,app_version_code,received_at,employee_name,battery_percent,collector_state,source_verified"),
      supabaseRest("fireblade_update_status?select=*"),
      supabaseRest<Array<{employee_id:string;employee_name:string;department_id:string}>>("fireblade_employees?select=employee_id,employee_name,department_id&active=eq.true"),
      supabaseRest<Array<{device_id:string;employee_id:string}>>("fireblade_device_assignments?select=device_id,employee_id&assigned_until=is.null"),
      supabaseRest<Array<{id:string;name:string}>>("fireblade_departments?select=id,name")
    ]);

    const empMap = new Map(employees.map(e => [e.employee_id, e]));
    const deptMap = new Map(departments.map(d => [d.id, d.name]));
    const assignMap = new Map(assignments.map(a => [a.device_id, a.employee_id]));

    const enrichedDevices = devices.map(d => {
      const empId = assignMap.get(d.device_id);
      const emp = empId ? empMap.get(empId) : undefined;
      return {
        ...d,
        employee_id: empId || null,
        employee_name: emp?.employee_name || null,
        department_name: emp?.department_id ? (deptMap.get(emp.department_id) || "Unassigned") : "Unassigned"
      };
    });

    return NextResponse.json({releases,devices:enrichedDevices,health,updates,push_configured:!!process.env.FIREBASE_SERVICE_ACCOUNT_JSON});
  }catch(e){return apiError(e);}
}

export async function POST(request:Request){
  try{
    const user=await requireUser(request);
    const b=await request.json();

    if(b.action==="PREPARE"){
      if(!Number.isInteger(b.version_code)||b.version_code<=5||b.version_code>2100000000)throw new AccessError(400,"Version code must be a whole number above 5");
      if(typeof b.version_name!=="string"||!/^\d+\.\d+\.\d+[A-Za-z0-9._-]*$/.test(b.version_name))throw new AccessError(400,"Enter a version such as 1.3.0");
      if(!Number.isInteger(b.size_bytes)||b.size_bytes<1||b.size_bytes>157286400||!String(b.sha256).match(/^[a-f0-9]{64}$/))throw new AccessError(400,"Invalid APK size or checksum");

      const target_device_id=await validateTarget(b.target_device_id);
      const previous=await supabaseRest<Release[]>("fireblade_app_releases?select=*&order=version_code.desc&limit=1");
      const retry=previous[0]?.version_code===b.version_code&&previous[0]?.status==="DRAFT"&&previous[0]?.sha256===b.sha256&&previous[0]?.size_bytes===b.size_bytes&&previous[0]?.version_name===b.version_name&&(previous[0]?.target_device_id||null)===target_device_id?previous[0]:null;
      if(previous[0]&&previous[0].version_code>=b.version_code&&!retry)throw new AccessError(409,"Use a higher version code, or retry the identical APK for the latest draft");

      const id=retry?.id||randomUUID();
      const object_path=retry?.object_path||`${id}/fireblade.apk`;
      const signed=await (await storageRequest(`object/upload/sign/fireblade-releases/${object_path}`,{
        method:"POST",headers:{"Content-Type":"application/json","x-upsert":"true"},body:"{}"
      })).json();
      if(typeof signed.url!=="string"||!signed.url.startsWith("/object/upload/sign/"))throw Error("Upload link was not returned");

      if(!retry){
        await supabaseRest("fireblade_app_releases",{method:"POST",body:JSON.stringify({
          id,version_code:b.version_code,version_name:b.version_name,object_path,size_bytes:b.size_bytes,
          sha256:b.sha256,notes:String(b.notes||"").slice(0,2000),created_by:user.username,target_device_id
        })});
      }
      return NextResponse.json({id,upload_url:`${storageConfig().url}/storage/v1${signed.url}`},{headers:{"Cache-Control":"no-store"}});
    }

    if(b.action==="PROMOTE"){
      if(!uuid(b.id))throw new AccessError(400,"Invalid release");
      const rows=await supabaseRest<Release[]>(`fireblade_app_releases?select=*&id=eq.${b.id}&status=eq.PUBLISHED&limit=1`);
      const release=rows[0];
      if(!release)throw new AccessError(404,"Published release not found");
      if(!release.target_device_id)throw new AccessError(409,"Release is already available to all devices");
      await supabaseRest(`fireblade_app_releases?id=eq.${release.id}&status=eq.PUBLISHED`,{method:"PATCH",body:JSON.stringify({target_device_id:null})});
      await audit(user.username,"APP_RELEASE_PROMOTED",release.id,{version_code:release.version_code,version_name:release.version_name,from_device:release.target_device_id});
      return NextResponse.json({ok:true});
    }

    if(b.action!=="PUBLISH"||!uuid(b.id))throw new AccessError(400,"Invalid release action");
    const rows=await supabaseRest<Release[]>(`fireblade_app_releases?select=*&id=eq.${b.id}&status=eq.DRAFT&limit=1`);
    const release=rows[0];
    if(!release)throw new AccessError(404,"Draft release not found");

    const response=await storageRequest(`object/authenticated/fireblade-releases/${release.object_path}`,{signal:AbortSignal.timeout(45000)});
    const reader=response.body?.getReader();
    if(!reader)throw Error("Empty APK upload");
    const hash=createHash("sha256");
    let size=0;
    const prefix:number[]=[];
    try{
      while(true){
        const {done,value}=await reader.read();
        if(done)break;
        size+=value.byteLength;
        if(size>release.size_bytes)throw Error("APK size does not match");
        hash.update(value);
        if(prefix.length<4)prefix.push(...Array.from(value.slice(0,4-prefix.length)));
      }
    }finally{await reader.cancel();}
    if(size!==release.size_bytes||hash.digest("hex")!==release.sha256||prefix.join(",")!=="80,75,3,4")throw new AccessError(400,"APK upload failed integrity verification");

    await supabaseRest(`fireblade_app_releases?id=eq.${release.id}&status=eq.DRAFT`,{method:"PATCH",body:JSON.stringify({status:"PUBLISHED",published_at:new Date().toISOString()})});
    await audit(user.username,"APP_RELEASE_PUBLISHED",release.id,{
      version_code:release.version_code,version_name:release.version_name,sha256:release.sha256,target_device_id:release.target_device_id
    });
    return NextResponse.json({ok:true});
  }catch(e){return apiError(e);}
}
