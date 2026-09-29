import crypto from "crypto";
import { cookies } from "next/headers";
import type { FirebladeTheme, SessionUser, UserRole } from "@/lib/types";
import { supabaseAuthPassword, supabaseRest } from "@/lib/supabase";

const COOKIE_NAME = "fireblade_session";
const MAX_AGE_SECONDS = 60 * 60 * 12;

type Account = { username: string; password: string; role: UserRole; displayName: string; departmentName: string };
type ProfileRow = {
  auth_user_id: string;
  username: string;
  login_email: string;
  role: UserRole;
  employee_id: string | null;
  active: boolean;
  force_password_change: boolean;
  session_version: number;
};
type EmployeeJoin = { employee_id: string; employee_name: string; department_id: string | null; profile_photo_updated_at: string | null; department?: { name?: string } | null };
type PreferenceRow = { principal: string; theme: FirebladeTheme };

function envOrDev(name: string, fallback: string) {
  const value = process.env[name];
  if (value) return value;
  if (process.env.NODE_ENV !== "production") return fallback;
  return "";
}

function displayEnv(name: string, fallback: string) {
  return process.env[name]?.trim() || fallback;
}

function legacyAccounts(): Account[] {
  const accounts: Account[] = [
    {
      username: envOrDev("FIREBLADE_ADMIN_USER", "admin"),
      password: envOrDev("FIREBLADE_ADMIN_PASSWORD", "fireblade-admin"),
      role: "ADMIN",
      displayName: displayEnv("FIREBLADE_ADMIN_DISPLAY_NAME", "Administrator"),
      departmentName: "Administration",
    },
    {
      username: envOrDev("FIREBLADE_MD_USER", "management"),
      password: envOrDev("FIREBLADE_MD_PASSWORD", "fireblade-management"),
      role: "MANAGEMENT",
      displayName: displayEnv("FIREBLADE_MD_DISPLAY_NAME", "MD"),
      departmentName: "Management",
    },
  ];
  return accounts.filter(a => Boolean(a.username && a.password));
}

function sessionSecret() {
  const configured = process.env.FIREBLADE_SESSION_SECRET;
  if (configured) return configured;
  if (process.env.NODE_ENV !== "production") return "fireblade-dev-session-secret-change-in-production";
  throw new Error("FIREBLADE_SESSION_SECRET is not configured");
}
function sign(payload: string) { return crypto.createHmac("sha256", sessionSecret()).update(payload).digest("base64url"); }

function principalFor(user: SessionUser) {
  return user.auth_user_id ? `AUTH:${user.auth_user_id}` : `${user.role}:${user.username.toLowerCase()}`;
}

async function preferenceFor(user: SessionUser): Promise<FirebladeTheme> {
  try {
    const principal = encodeURIComponent(principalFor(user));
    const rows = await supabaseRest<PreferenceRow[]>(`fireblade_user_preferences?select=principal,theme&principal=eq.${principal}&limit=1`);
    return rows[0]?.theme || user.theme || "STANDARD";
  } catch {
    return user.theme || "STANDARD";
  }
}

async function hydrateProfile(row: ProfileRow): Promise<SessionUser | null> {
  if (!row.active) return null;
  let employee_name: string | null = null;
  let department_id: string | null = null;
  let department_name: string | null = null;
  let profile_photo_updated_at: string | null = null;
  if (row.employee_id) {
    const employees = await supabaseRest<EmployeeJoin[]>(`fireblade_employees?select=employee_id,employee_name,department_id,profile_photo_updated_at,department:fireblade_departments(name)&employee_id=eq.${encodeURIComponent(row.employee_id)}&active=eq.true&limit=1`);
    const e = employees[0];
    if (!e) return null;
    employee_name = e.employee_name;
    department_id = e.department_id;
    department_name = e.department?.name || null;
    profile_photo_updated_at = e.profile_photo_updated_at || null;
  }
  const base: SessionUser = {
    username: row.username,
    role: row.role,
    auth_user_id: row.auth_user_id,
    employee_id: row.employee_id,
    employee_name,
    department_id,
    department_name,
    profile_photo_updated_at,
    force_password_change: row.force_password_change,
    session_version: Number(row.session_version || 1),
  };
  return { ...base, theme: await preferenceFor(base) };
}

export async function authenticate(username: string, password: string): Promise<SessionUser | null> {
  const rawUser = username.trim();
  const legacy = legacyAccounts().find(a => a.username.toLowerCase() === rawUser.toLowerCase() && a.password === password);
  if (legacy) {
    const u: SessionUser = {
      username: legacy.username,
      role: legacy.role,
      employee_name: legacy.displayName,
      department_name: legacy.departmentName,
      force_password_change: false,
    };
    if (process.env.NODE_ENV !== "production") {
      return { ...u, theme: "STANDARD" };
    }
    return { ...u, theme: await preferenceFor(u) };
  }

  const normalized = rawUser.toUpperCase();
  const rows = await supabaseRest<ProfileRow[]>(`fireblade_user_profiles?select=auth_user_id,username,login_email,role,employee_id,active,force_password_change,session_version&username=eq.${encodeURIComponent(normalized)}&active=eq.true&limit=1`);
  const profile = rows[0];
  if (!profile || profile.role !== "MARKETING") return null;
  const result = await supabaseAuthPassword(profile.login_email, password);
  if (!result.ok) return null;
  if (result.data?.user?.id !== profile.auth_user_id) return null;
  return hydrateProfile(profile);
}

export function encodeSession(user: SessionUser) {
  const payload = Buffer.from(JSON.stringify({ ...user, exp: Date.now() + MAX_AGE_SECONDS * 1000 })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function decodeSession(token: string | undefined): SessionUser | null {
  if (!token) return null;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;
  const expected = sign(payload);
  if (signature.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!parsed.exp || parsed.exp < Date.now()) return null;
    if (!parsed.username || !["ADMIN", "MARKETING", "MANAGEMENT"].includes(parsed.role)) return null;
    return parsed as SessionUser;
  } catch { return null; }
}

export async function getSession(): Promise<SessionUser | null> {
  const store = await cookies();
  const decoded = decodeSession(store.get(COOKIE_NAME)?.value);
  if (!decoded) return null;
  if (!decoded.auth_user_id) {
    const legacy = legacyAccounts().find(account => account.role === decoded.role && account.username.toLowerCase() === decoded.username.toLowerCase());
    if (!legacy) return decoded;
    return {
      ...decoded,
      employee_name: legacy.displayName,
      department_name: legacy.departmentName,
    };
  }
  try {
    const rows = await supabaseRest<ProfileRow[]>(`fireblade_user_profiles?select=auth_user_id,username,login_email,role,employee_id,active,force_password_change,session_version&auth_user_id=eq.${encodeURIComponent(decoded.auth_user_id)}&active=eq.true&limit=1`);
    const row = rows[0];
    if (!row) return null;
    if (Number(decoded.session_version || 0) !== Number(row.session_version || 1)) return null;
    return hydrateProfile(row);
  } catch {
    // Managed employee sessions fail closed. If Supabase is unavailable, the
    // application data is unavailable too, so keeping a stale auth cookie alive
    // would only weaken account disable/password-reset semantics.
    return null;
  }
}

export async function setSession(user: SessionUser) {
  const store = await cookies();
  store.set(COOKIE_NAME, encodeSession(user), { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: MAX_AGE_SECONDS });
}
export async function clearSession() {
  const store = await cookies();
  store.set(COOKIE_NAME, "", { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 0 });
}
export async function updateSessionTheme(theme: FirebladeTheme) {
  const store = await cookies();
  const current = decodeSession(store.get(COOKIE_NAME)?.value);
  if (!current) return;
  await setSession({ ...current, theme });
}
export { principalFor };

