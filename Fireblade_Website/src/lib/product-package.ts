import { supabaseRest } from "@/lib/supabase";

export type ProductSpecRow = {
  id: string;
  product_id: string;
  spec_key: string;
  spec_label: string;
  value_text: string;
  unit: string | null;
  customer_priority: number;
};

export type ProductPriceRow = {
  id: string;
  product_id: string;
  variant_id: string | null;
  amount: number | string;
  currency: string;
  tax_note: string | null;
  commercial_note: string | null;
  effective_from: string | null;
  effective_until: string | null;
  price_kind?: string | null;
  customer_sendable?: boolean;
};

export type ProductAssetRow = {
  id: string;
  product_id: string;
  variant_id?: string | null;
  asset_type: string;
  title: string;
  storage_bucket: string | null;
  storage_object_path: string | null;
  source_file_id?: string | null;
  revision_label: string | null;
  sha256: string | null;
  drive_file_id?: string | null;
  drive_web_view_url?: string | null;
  mime_type?: string | null;
};

export type ProductPackage = {
  product: {
    id: string;
    product_code: string;
    canonical_name: string;
    brand: string | null;
    manufacturer: string | null;
    category: string | null;
    subcategory: string | null;
    current_revision_id: string | null;
  };
  models: string[];
  specs: ProductSpecRow[];
  customer_prices: ProductPriceRow[];
  current_price: ProductPriceRow | null;
  assets: ProductAssetRow[];
};

function uniqueStrings(values: Array<string | null | undefined>) {
  return [...new Set(values.map(v => String(v || "").trim()).filter(Boolean))];
}

function isPriceCurrent(price: ProductPriceRow, today: string) {
  return (!price.effective_from || price.effective_from <= today) && (!price.effective_until || price.effective_until >= today);
}

const ASSET_PRIORITY: Record<string, number> = {
  CATALOGUE: 10,
  MINI_CATALOGUE: 20,
  DATASHEET: 30,
  IMAGE: 40,
  MANUAL: 50,
  CERTIFICATE: 60,
  DRAWING: 70,
  APPLICATION_NOTE: 80,
  PRICE_LIST: 90,
  OTHER: 100,
};

export async function loadProductPackage(productId: string): Promise<ProductPackage | null> {
  const products = await supabaseRest<ProductPackage["product"][]>(
    `fireblade_products?select=id,product_code,canonical_name,brand,manufacturer,category,subcategory,current_revision_id&id=eq.${encodeURIComponent(productId)}&lifecycle_status=eq.ACTIVE&publish_status=eq.PUBLISHED&verification_status=eq.VERIFIED&limit=1`,
  );
  const product = products[0];
  if (!product) return null;

  const [specs, prices, assets, variants] = await Promise.all([
    supabaseRest<ProductSpecRow[]>(
      `fireblade_product_specs?select=id,product_id,spec_key,spec_label,value_text,unit,customer_priority&product_id=eq.${encodeURIComponent(productId)}&active=eq.true&verification_status=eq.VERIFIED&valid_until=is.null&order=customer_priority.desc,spec_label.asc`,
    ),
    supabaseRest<ProductPriceRow[]>(
      `fireblade_product_prices?select=id,product_id,variant_id,amount,currency,tax_note,commercial_note,effective_from,effective_until,price_kind,customer_sendable&product_id=eq.${encodeURIComponent(productId)}&active=eq.true&verification_status=eq.VERIFIED&customer_sendable=eq.true&order=effective_from.desc.nullslast,created_at.desc`,
    ),
    supabaseRest<ProductAssetRow[]>(
      `fireblade_product_assets?select=id,product_id,variant_id,asset_type,title,storage_bucket,storage_object_path,source_file_id,revision_label,sha256&product_id=eq.${encodeURIComponent(productId)}&active=eq.true&customer_sendable=eq.true&verification_status=eq.VERIFIED&order=asset_type.asc,title.asc`,
    ),
    supabaseRest<Array<{ model_code: string | null; variant_name: string | null }>>(
      `fireblade_product_variants?select=model_code,variant_name&product_id=eq.${encodeURIComponent(productId)}&status=eq.ACTIVE&verified=eq.true&order=created_at.asc`,
    ),
  ]);

  const sourceIds = uniqueStrings(assets.map(a => a.source_file_id));
  let sourceMap = new Map<string, { drive_file_id: string; web_view_url: string | null; mime_type: string | null }>();
  if (sourceIds.length) {
    const sourceRows = await supabaseRest<Array<{ id: string; drive_file_id: string; web_view_url: string | null; mime_type: string | null }>>(
      `fireblade_product_source_files?select=id,drive_file_id,web_view_url,mime_type&id=in.(${sourceIds.join(",")})`,
    );
    sourceMap = new Map(sourceRows.map(row => [row.id, row]));
  }

  const hydratedAssets = assets
    .map(asset => {
      const source = asset.source_file_id ? sourceMap.get(asset.source_file_id) : undefined;
      return {
        ...asset,
        drive_file_id: source?.drive_file_id || null,
        drive_web_view_url: source?.web_view_url || null,
        mime_type: source?.mime_type || null,
      };
    })
    .sort((a, b) => (ASSET_PRIORITY[a.asset_type] ?? 999) - (ASSET_PRIORITY[b.asset_type] ?? 999) || a.title.localeCompare(b.title));

  const today = new Date().toISOString().slice(0, 10);
  const currentPrices = prices.filter(price => isPriceCurrent(price, today));
  return {
    product,
    models: uniqueStrings(variants.flatMap(v => [v.model_code, v.variant_name])),
    specs,
    customer_prices: currentPrices,
    current_price: currentPrices[0] || null,
    assets: hydratedAssets,
  };
}

export function formatMoney(price: ProductPriceRow | null) {
  if (!price) return null;
  const amount = Number(price.amount);
  if (!Number.isFinite(amount)) return null;
  try {
    return new Intl.NumberFormat("en-IN", { style: "currency", currency: price.currency || "INR", maximumFractionDigits: 2 }).format(amount);
  } catch {
    return `${price.currency || "INR"} ${amount.toFixed(2)}`;
  }
}
