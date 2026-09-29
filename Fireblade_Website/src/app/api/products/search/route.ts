import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { supabaseRest } from "@/lib/supabase";

const MAX_RESULTS = 20;

type SearchRow = {
  id: string;
  product_code: string;
  canonical_name: string;
  brand: string | null;
  manufacturer: string | null;
  category: string | null;
  subcategory: string | null;
  primary_model: string | null;
  score: number | string;
};

export async function GET(request: Request) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { searchParams } = new URL(request.url);
  const q = String(searchParams.get("q") || "").trim().slice(0, 120);
  if (q.length < 2) return NextResponse.json({ products: [], query: q });

  try {
    const rows = await supabaseRest<SearchRow[]>("rpc/fireblade_search_products", {
      method: "POST",
      body: JSON.stringify({ p_query: q, p_limit: MAX_RESULTS }),
    });
    if (!rows.length) return NextResponse.json({ products: [], query: q });

    const ids = rows.map(row => row.id).join(",");
    const [specRows, assetRows, priceRows] = await Promise.all([
      supabaseRest<Array<{ product_id: string }>>(
        `fireblade_product_specs?select=product_id&product_id=in.(${ids})&active=eq.true&verification_status=eq.VERIFIED&valid_until=is.null`,
      ),
      supabaseRest<Array<{ product_id: string }>>(
        `fireblade_product_assets?select=product_id&product_id=in.(${ids})&active=eq.true&verification_status=eq.VERIFIED&customer_sendable=eq.true`,
      ),
      supabaseRest<Array<{ product_id: string }>>(
        `fireblade_product_prices?select=product_id&product_id=in.(${ids})&active=eq.true&verification_status=eq.VERIFIED&customer_sendable=eq.true`,
      ),
    ]);

    const count = (items: Array<{ product_id: string }>, id: string) => items.reduce((n, item) => n + Number(item.product_id === id), 0);
    return NextResponse.json({
      query: q,
      products: rows.map(row => ({
        ...row,
        score: Number(row.score || 0),
        spec_count: count(specRows, row.id),
        asset_count: count(assetRows, row.id),
        has_customer_price: priceRows.some(item => item.product_id === row.id),
      })),
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Product search failed" }, { status: 500 });
  }
}
