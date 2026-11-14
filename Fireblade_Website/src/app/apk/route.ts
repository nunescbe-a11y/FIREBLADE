import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const url = process.env.SUPABASE_URL?.trim().replace(/\/$/, "");
  const key = process.env.SUPABASE_SECRET_KEY?.trim();

  if (!url || !key) {
    return NextResponse.json({ error: "Missing Supabase configuration" }, { status: 500 });
  }

  try {
    // Generate signed download URL for the stable v1.7.19 (code 34) release APK
    const signRes = await fetch(`${url}/storage/v1/object/sign/fireblade-releases/android/1.7.19/code34/app-release.apk`, {
      method: "POST",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ expiresIn: 3600 }), // 1 hour
    });

    if (!signRes.ok) {
      return NextResponse.json({ error: "Failed to sign APK download URL" }, { status: 500 });
    }

    const data = await signRes.json();
    const signedPath = data.signedURL || data.url;

    if (!signedPath) {
      return NextResponse.json({ error: "No signed URL returned" }, { status: 500 });
    }

    const downloadUrl = signedPath.startsWith("http") ? signedPath : `${url}/storage/v1${signedPath}`;
    return NextResponse.redirect(downloadUrl, 307);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Internal server error" }, { status: 500 });
  }
}
