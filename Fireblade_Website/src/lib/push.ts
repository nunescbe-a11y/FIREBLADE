import { createSign } from "node:crypto";
let cached: { token: string; expires: number } | undefined;
let tokenRequest: Promise<string> | undefined;
type ServiceAccount = { project_id: string; client_email: string; private_key: string };
async function accessToken(account: ServiceAccount): Promise<string> {
  if (cached && cached.expires > Date.now()) return cached.token;
  if (tokenRequest) return tokenRequest;
  tokenRequest = (async () => {
    const now = Math.floor(Date.now() / 1000);
    const encode = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");
    const unsigned = `${encode({ alg: "RS256", typ: "JWT" })}.${encode({ iss: account.client_email, scope: "https://www.googleapis.com/auth/firebase.messaging", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 })}`;
    const signature = createSign("RSA-SHA256").update(unsigned).sign(account.private_key, "base64url");
    const response = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${signature}` }), signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error("Push authentication failed");
    const result = await response.json();
    if (!result.access_token) throw new Error("Push token missing");
    cached = { token: result.access_token, expires: Date.now() + 50 * 60 * 1000 };
    return cached.token;
  })();
  try { return await tokenRequest; } finally { tokenRequest = undefined; }
}
export async function sendCheck(token: string | undefined, requestId: string) {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) return "NOT_CONFIGURED";
  if (!token) return "NO_PUSH_TOKEN";
  try {
    const account: ServiceAccount = JSON.parse(raw);
    if (!/^[a-z0-9-]+$/.test(account.project_id)) return "FAILED";
    const bearer = await accessToken(account);
    const r = await fetch(`https://fcm.googleapis.com/v1/projects/${account.project_id}/messages:send`, {
      method: "POST", headers: { Authorization: `Bearer ${bearer}`, "Content-Type": "application/json" },
      body: JSON.stringify({ message: { token, data: { command: "CHECK_NOW", request_id: requestId }, android: { priority: "HIGH", ttl: "90s" } } }),
      signal: AbortSignal.timeout(10000),
    });
    return r.ok ? "SENT" : "FAILED";
  } catch { return "FAILED"; }
}
