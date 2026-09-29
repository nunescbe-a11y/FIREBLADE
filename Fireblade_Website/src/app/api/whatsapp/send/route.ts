import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { formatMoney, loadProductPackage } from "@/lib/product-package";
import { supabaseRest, supabaseStorageSignedUrl } from "@/lib/supabase";
import { bridgeRequest, ensureWhatsappConnection } from "@/lib/whatsapp";

const MAX_ATTACHMENTS = 20;
const MAX_TEXT = 11000;

function safeText(value: unknown, max = 1200) {
  return String(value || "").trim().slice(0, max);
}

function customerProductText(pkg: NonNullable<Awaited<ReturnType<typeof loadProductPackage>>>) {
  const lines: string[] = [];
  const product = pkg.product;
  lines.push(`*${product.canonical_name}*${product.product_code ? ` (${product.product_code})` : ""}`);
  if (pkg.models.length) lines.push(`Model: ${pkg.models.slice(0, 3).join(", ")}`);
  if (product.brand) lines.push(`Brand: ${product.brand}`);
  else if (product.manufacturer) lines.push(`Manufacturer: ${product.manufacturer}`);
  if (product.category) lines.push(`Category: ${product.category}${product.subcategory ? ` / ${product.subcategory}` : ""}`);

  const priceText = formatMoney(pkg.current_price);
  if (priceText) {
    lines.push(`Price: ${priceText}`);
    if (pkg.current_price?.tax_note) lines.push(`Tax: ${pkg.current_price.tax_note}`);
    if (pkg.current_price?.commercial_note) lines.push(`Commercial note: ${pkg.current_price.commercial_note}`);
  } else {
    lines.push("Price: Please contact us for the current customer quotation.");
  }

  if (pkg.specs.length) {
    lines.push("", "*Specifications*");
    let omitted = 0;
    for (const spec of pkg.specs) {
      const value = `${spec.value_text}${spec.unit && !String(spec.value_text).includes(spec.unit) ? ` ${spec.unit}` : ""}`;
      const next = `${spec.spec_label}: ${value}`;
      if ((lines.join("\n").length + next.length + 2) > 9200) {
        omitted++;
        continue;
      }
      lines.push(next);
    }
    if (omitted) lines.push(`+ ${omitted} additional specification(s) are available in the attached product documents.`);
  }

  if (pkg.assets.length) {
    lines.push("", `Product documents: ${Math.min(pkg.assets.length, MAX_ATTACHMENTS)} attachment(s) included.`);
    if (pkg.assets.length > MAX_ATTACHMENTS) lines.push(`Additional documents available: ${pkg.assets.length - MAX_ATTACHMENTS}.`);
  }
  return lines.join("\n").slice(0, MAX_TEXT);
}

export async function POST(request: Request) {
  const user = await getSession();
  if (!user || user.role !== "MARKETING" || !user.employee_id) {
    return NextResponse.json({ error: "Marketing employee account required" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const callId = Number(body.call_id);
  const productId = String(body.product_id || (Array.isArray(body.product_ids) ? body.product_ids[0] : "") || "").trim();
  const greeting = safeText(body.greeting, 500);
  const closing = safeText(body.closing, 500);
  const idempotency = String(body.idempotency_key || crypto.randomUUID());
  if (!Number.isInteger(callId) || callId <= 0 || !productId) {
    return NextResponse.json({ error: "Customer call and product are required" }, { status: 400 });
  }

  try {
    const calls = await supabaseRest<any[]>(
      `fireblade_incoming_calls?select=call_id,phone_number_normalized,phone_number_raw,enquiry_id&call_id=eq.${callId}&registered_employee_id=eq.${encodeURIComponent(user.employee_id)}&limit=1`,
    );
    const call = calls[0];
    if (!call) return NextResponse.json({ error: "Call does not belong to this employee" }, { status: 403 });
    const recipient = call.phone_number_normalized || call.phone_number_raw;
    if (!recipient) return NextResponse.json({ error: "Customer phone number is unavailable" }, { status: 400 });

    const existing = await supabaseRest<any[]>(
      `fireblade_message_bundles?select=id,status,sent_at&idempotency_key=eq.${encodeURIComponent(idempotency)}&limit=1`,
    );
    if (existing[0]?.status === "SENT") {
      return NextResponse.json({ ok: true, duplicate: true, bundle_id: existing[0].id, sent_at: existing[0].sent_at });
    }
    if (existing[0]?.status === "SENDING") return NextResponse.json({ error: "This product package is already being sent" }, { status: 409 });

    const pkg = await loadProductPackage(productId);
    if (!pkg) return NextResponse.json({ error: "Product is not published and verified for customer sharing" }, { status: 400 });

    const controlledProductText = customerProductText(pkg);
    const text = [
      greeting || "Hello, thank you for your enquiry. As discussed, please find the requested product information below.",
      controlledProductText,
      closing || `Regards,\n${user.employee_name || user.username}`,
    ].filter(Boolean).join("\n\n").slice(0, MAX_TEXT);

    const eligibleAssets = pkg.assets.slice(0, MAX_ATTACHMENTS);
    const payloadSnapshot = {
      product_id: pkg.product.id,
      product_code: pkg.product.product_code,
      product_revision_id: pkg.product.current_revision_id,
      customer_price_id: pkg.current_price?.id || null,
      specification_ids: pkg.specs.map(spec => spec.id),
      eligible_asset_ids: pkg.assets.map(asset => asset.id),
      send_asset_ids: eligibleAssets.map(asset => asset.id),
    };
    const revisionSnapshot = [{
      product_id: pkg.product.id,
      product_code: pkg.product.product_code,
      revision_id: pkg.product.current_revision_id,
      customer_price_id: pkg.current_price?.id || null,
    }];

    let bundleId = existing[0]?.id;
    if (!bundleId) {
      const created = await supabaseRest<any[]>("fireblade_message_bundles", {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({
          enquiry_id: call.enquiry_id || null,
          call_id: callId,
          employee_id: user.employee_id,
          channel: "WHATSAPP",
          recipient_number: recipient,
          mode: "SESSION",
          rendered_text: text,
          payload_snapshot: payloadSnapshot,
          product_revision_snapshot: revisionSnapshot,
          status: "SENDING",
          idempotency_key: idempotency,
          created_by: user.username,
        }),
      });
      bundleId = created[0]?.id;
    } else {
      await supabaseRest(`fireblade_message_bundles?id=eq.${bundleId}`, {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ status: "SENDING", error_message: null, failed_at: null, rendered_text: text, payload_snapshot: payloadSnapshot, product_revision_snapshot: revisionSnapshot }),
      });
    }

    const connection = await ensureWhatsappConnection(user.employee_id);
    const media: Array<{ asset: (typeof eligibleAssets)[number]; url?: string; drive_file_id?: string }> = [];
    for (const asset of eligibleAssets) {
      if (asset.storage_bucket && asset.storage_object_path) {
        try {
          media.push({ asset, url: await supabaseStorageSignedUrl(asset.storage_bucket, asset.storage_object_path, 900) });
          continue;
        } catch {}
      }
      if (asset.drive_file_id) media.push({ asset, drive_file_id: asset.drive_file_id });
    }

    const result = await bridgeRequest<any>(`/sessions/${encodeURIComponent(connection.session_key)}/send`, {
      method: "POST",
      body: JSON.stringify({
        to: recipient,
        text,
        media: media.map(item => ({
          url: item.url,
          drive_file_id: item.drive_file_id,
          filename: item.asset.title,
          type: item.asset.asset_type,
        })),
      }),
    });

    await supabaseRest("fireblade_whatsapp_messages", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        bundle_id: bundleId,
        direction: "OUTBOUND",
        recipient_number: recipient,
        sender_number: result.number || connection.whatsapp_number || null,
        message_type: "TEXT",
        provider_message_id: result.text_message_id || null,
        status: "SENT",
        payload: { text, product_id: pkg.product.id, customer_price_id: pkg.current_price?.id || null },
        provider_response: result,
      }),
    });

    for (let i = 0; i < media.length; i++) {
      const item = media[i];
      const bundleAsset = await supabaseRest<any[]>("fireblade_message_bundle_assets", {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({ bundle_id: bundleId, asset_id: item.asset.id, item_order: i + 1, asset_sha256: item.asset.sha256 || null }),
      });
      await supabaseRest("fireblade_whatsapp_messages", {
        method: "POST",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({
          bundle_id: bundleId,
          direction: "OUTBOUND",
          recipient_number: recipient,
          sender_number: result.number || connection.whatsapp_number || null,
          message_type: item.asset.asset_type === "IMAGE" ? "IMAGE" : "DOCUMENT",
          bundle_asset_id: bundleAsset[0]?.id || null,
          provider_message_id: result.media_message_ids?.[i] || null,
          status: "SENT",
          payload: { title: item.asset.title, asset_id: item.asset.id, source: item.drive_file_id ? "GOOGLE_DRIVE" : "SUPABASE_STORAGE" },
        }),
      });
    }

    await supabaseRest(`fireblade_message_bundles?id=eq.${bundleId}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ status: "SENT", sent_at: new Date().toISOString() }),
    });

    return NextResponse.json({
      ok: true,
      bundle_id: bundleId,
      recipient,
      product_name: pkg.product.canonical_name,
      specifications: pkg.specs.length,
      attachments: media.length,
      eligible_attachments: pkg.assets.length,
      price_included: Boolean(pkg.current_price),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "WhatsApp send failed";
    try {
      await supabaseRest(`fireblade_message_bundles?idempotency_key=eq.${encodeURIComponent(idempotency)}`, {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ status: "FAILED", failed_at: new Date().toISOString(), error_message: message.slice(0, 800) }),
      });
    } catch {}
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
