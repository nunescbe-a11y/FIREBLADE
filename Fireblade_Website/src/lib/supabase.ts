import dns from "node:dns";

try { dns.setDefaultResultOrder("ipv4first"); } catch {}

export const getSupabaseConfig = () => {
  const url = process.env.SUPABASE_URL?.trim().replace(/\/$/, "");
  const key = process.env.SUPABASE_SECRET_KEY?.trim();
  if (!url || !key) throw new Error("Supabase server environment is not configured");
  if (!/^https:\/\//i.test(url)) throw new Error("SUPABASE_URL must start with https://");
  return { url, key };
};

function getSupabaseAuthKey() {
  // User/password sign-in should use the low-privilege publishable key.
  // The secret-key fallback keeps existing Fireblade deployments compatible
  // while they migrate from the legacy server-only configuration.
  return process.env.SUPABASE_PUBLISHABLE_KEY?.trim() || getSupabaseConfig().key;
}


function serverKeyHeaders(key: string) {
  return {
    apikey: key,
    ...(key.startsWith("eyJ") ? { Authorization: `Bearer ${key}` } : {}),
  };
}

function networkErrorMessage(error: unknown) {
  const e = error as Error & { cause?: { code?: string; message?: string; errno?: string | number } };
  const code = e?.cause?.code || e?.cause?.errno;
  const cause = e?.cause?.message;
  const parts = ["Supabase network connection failed"];
  if (code) parts.push(`(${String(code)})`);
  if (cause) parts.push(cause); else if (e?.message) parts.push(e.message);
  return parts.join(" ");
}

async function configuredFetch(url: string, init: RequestInit, timeout = 15000) {
  try {
    return await fetch(url, { ...init, cache: "no-store", signal: init.signal ?? AbortSignal.timeout(timeout) });
  } catch (error) {
    throw new Error(networkErrorMessage(error));
  }
}

export async function supabaseRest<T>(path: string, init?: RequestInit): Promise<T> {
  const { url, key } = getSupabaseConfig();
  const response = await configuredFetch(`${url}/rest/v1/${path}`, {
    ...init,
    headers: {
      ...serverKeyHeaders(key),
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Supabase ${response.status}: ${body.slice(0, 800)}`);
  }
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  return text ? (JSON.parse(text) as T) : (undefined as T);
}

export async function supabaseAuthPassword(email: string, password: string) {
  const { url } = getSupabaseConfig();
  const key = getSupabaseAuthKey();
  const response = await configuredFetch(`${url}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: key, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) return { ok: false as const, status: response.status, error: data?.msg || data?.message || "Invalid login" };
  return { ok: true as const, data };
}

export async function supabaseAuthAdmin(path: string, init?: RequestInit) {
  const { url, key } = getSupabaseConfig();
  const response = await configuredFetch(`${url}/auth/v1/admin/${path.replace(/^\//, "")}`, {
    ...init,
    headers: {
      ...serverKeyHeaders(key),
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(`Supabase Auth ${response.status}: ${data?.msg || data?.message || text.slice(0, 500)}`);
  return data;
}

export async function supabaseStorageSignedUrl(bucket: string, objectPath: string, expiresIn = 600) {
  const { url, key } = getSupabaseConfig();
  const encoded = objectPath.split("/").map(encodeURIComponent).join("/");
  const response = await configuredFetch(`${url}/storage/v1/object/sign/${encodeURIComponent(bucket)}/${encoded}`, {
    method: "POST",
    headers: { ...serverKeyHeaders(key), "Content-Type": "application/json" },
    body: JSON.stringify({ expiresIn }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data?.signedURL) throw new Error(`Could not sign product asset: ${data?.message || response.status}`);
  return `${url}/storage/v1${data.signedURL}`;
}

export async function supabaseStorageCreateSignedUploadUrl(bucket: string, objectPath: string) {
  const { url, key } = getSupabaseConfig();
  const encoded = objectPath.split("/").map(encodeURIComponent).join("/");
  const response = await configuredFetch(`${url}/storage/v1/object/upload/sign/${encodeURIComponent(bucket)}/${encoded}`, {
    method: "POST",
    headers: { ...serverKeyHeaders(key), "Content-Type": "application/json", "x-upsert": "false" },
    body: "{}",
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data?.url) throw new Error(`Could not create product upload URL: ${data?.message || response.status}`);
  const signedUrl = String(data.url).startsWith("http") ? String(data.url) : `${url}/storage/v1${data.url}`;
  return { signedUrl, path: objectPath };
}

export async function supabaseStorageObjectInfo(bucket: string, objectPath: string) {
  const { url, key } = getSupabaseConfig();
  const encoded = objectPath.split("/").map(encodeURIComponent).join("/");
  const response = await configuredFetch(`${url}/storage/v1/object/info/${encodeURIComponent(bucket)}/${encoded}`, {
    method: "GET",
    headers: { ...serverKeyHeaders(key) },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Uploaded product file is not available: ${data?.message || response.status}`);
  return data;
}
