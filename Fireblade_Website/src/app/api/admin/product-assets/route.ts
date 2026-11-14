import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { supabaseRest, supabaseStorageCreateSignedUploadUrl, supabaseStorageObjectInfo } from "@/lib/supabase";

const BUCKET = "fireblade-product-assets";
const MAX_BYTES = 20 * 1024 * 1024;
const ALLOWED_MIME = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]);
const ALLOWED_ASSET_TYPES = new Set(["CATALOGUE", "MINI_CATALOGUE", "DATASHEET", "IMAGE", "MANUAL", "CERTIFICATE", "APPLICATION_NOTE", "OTHER"]);

type ProductRow = { id:string; product_code:string; canonical_name:string; brand:string|null; manufacturer:string|null; category:string|null; subcategory:string|null; current_revision_id:string|null };
type AssetRow = { id:string; product_id:string; asset_type:string; title:string; storage_bucket:string|null; storage_object_path:string|null; revision_label:string|null; revision_date:string|null; verification_status:string; customer_sendable:boolean; active:boolean; created_by:string; created_at:string };

function cleanFilename(value:string){return value.trim().replace(/[^a-zA-Z0-9._-]+/g,"-").replace(/^-+|-+$/g,"").slice(0,120)||"catalogue"}
async function approvedProduct(productId:string){
  const rows=await supabaseRest<ProductRow[]>(`fireblade_products?select=id,product_code,canonical_name,brand,manufacturer,category,subcategory,current_revision_id&id=eq.${encodeURIComponent(productId)}&lifecycle_status=eq.ACTIVE&publish_status=eq.PUBLISHED&verification_status=eq.VERIFIED&limit=1`);
  return rows[0]||null;
}

export async function GET(){
  const user=await getSession();
  if(!user||user.role!=="ADMIN")return NextResponse.json({error:"Forbidden"},{status:403});
  try{
    const assets=await supabaseRest<AssetRow[]>(`fireblade_product_assets?select=id,product_id,asset_type,title,storage_bucket,storage_object_path,revision_label,revision_date,verification_status,customer_sendable,active,created_by,created_at&order=created_at.desc&limit=100`);
    return NextResponse.json({assets,bucket:BUCKET,max_bytes:MAX_BYTES,mode:"EXCEPTIONS_AND_OVERRIDES"});
  }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Could not load product assets"},{status:500})}
}

export async function POST(request:Request){
  const user=await getSession();
  if(!user||user.role!=="ADMIN")return NextResponse.json({error:"Forbidden"},{status:403});
  const body=await request.json().catch(()=>({}));
  const action=String(body.action||"");
  try{
    if(action==="sign_upload"){
      const productId=String(body.product_id||"");
      const assetType=String(body.asset_type||"").toUpperCase();
      const filename=cleanFilename(String(body.filename||""));
      const contentType=String(body.content_type||"").toLowerCase();
      const size=Number(body.size||0);
      if(!productId||!await approvedProduct(productId))return NextResponse.json({error:"Product is not approved for customer sharing"},{status:400});
      if(!ALLOWED_ASSET_TYPES.has(assetType))return NextResponse.json({error:"Invalid asset type"},{status:400});
      if(!ALLOWED_MIME.has(contentType))return NextResponse.json({error:"Only PDF, JPEG, PNG and WebP files are allowed"},{status:400});
      if(!Number.isFinite(size)||size<1||size>MAX_BYTES)return NextResponse.json({error:"File must be between 1 byte and 20 MB"},{status:400});
      const path=`${productId}/${Date.now()}-${crypto.randomUUID()}-${filename}`;
      const signed=await supabaseStorageCreateSignedUploadUrl(BUCKET,path);
      return NextResponse.json({ok:true,upload_url:signed.signedUrl,object_path:path,bucket:BUCKET,max_bytes:MAX_BYTES});
    }

    if(action==="finalize_upload"){
      const productId=String(body.product_id||"");
      const assetType=String(body.asset_type||"").toUpperCase();
      const objectPath=String(body.object_path||"");
      const title=String(body.title||"").trim().slice(0,200);
      const revisionLabel=String(body.revision_label||"").trim().slice(0,80)||null;
      if(!productId||!await approvedProduct(productId))return NextResponse.json({error:"Product is not approved for customer sharing"},{status:400});
      if(!ALLOWED_ASSET_TYPES.has(assetType))return NextResponse.json({error:"Invalid asset type"},{status:400});
      if(!objectPath.startsWith(`${productId}/`))return NextResponse.json({error:"Invalid product asset path"},{status:400});
      if(!title)return NextResponse.json({error:"Asset title is required"},{status:400});
      await supabaseStorageObjectInfo(BUCKET,objectPath);
      const created=await supabaseRest<AssetRow[]>("fireblade_product_assets",{method:"POST",headers:{Prefer:"return=representation"},body:JSON.stringify({product_id:productId,asset_type:assetType,title,storage_bucket:BUCKET,storage_object_path:objectPath,revision_label:revisionLabel,verification_status:"VERIFIED",customer_sendable:true,active:true,created_by:user.username})});
      return NextResponse.json({ok:true,asset:created[0]});
    }

    if(action==="set_active"){
      const id=String(body.id||"");
      const active=Boolean(body.active);
      if(!id)return NextResponse.json({error:"Asset ID is required"},{status:400});
      await supabaseRest(`fireblade_product_assets?id=eq.${encodeURIComponent(id)}`,{method:"PATCH",headers:{Prefer:"return=minimal"},body:JSON.stringify({active,customer_sendable:active})});
      return NextResponse.json({ok:true});
    }

    return NextResponse.json({error:"Unknown action"},{status:400});
  }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Product asset operation failed"},{status:500})}
}
