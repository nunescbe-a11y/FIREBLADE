import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { formatMoney, loadProductPackage } from "@/lib/product-package";

export async function GET(request: Request) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { searchParams } = new URL(request.url);
  const productId = String(searchParams.get("product_id") || "").trim();
  if (!productId) return NextResponse.json({ error: "Product is required" }, { status: 400 });

  try {
    const pkg = await loadProductPackage(productId);
    if (!pkg) return NextResponse.json({ error: "Product is not available for customer sharing" }, { status: 404 });
    return NextResponse.json({
      ...pkg,
      current_price_text: formatMoney(pkg.current_price),
      automation: {
        specs: pkg.specs.length,
        customer_prices: pkg.customer_prices.length,
        attachments: pkg.assets.length,
        source: "Fireblade master catalogue",
      },
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not assemble product package" }, { status: 500 });
  }
}
