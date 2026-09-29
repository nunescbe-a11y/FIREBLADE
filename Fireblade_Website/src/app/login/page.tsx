"use client";

import Image from "next/image";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { FIREBLADE_PRODUCT_NAME } from "@/lib/version";

export default function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const login = async (e: React.FormEvent) => {
    e.preventDefault(); setLoading(true); setError("");
    try {
      const response = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Login failed");
      router.replace(data.user?.force_password_change ? "/account/password" : "/dashboard");
    } catch (e) { setError(e instanceof Error ? e.message : "Login failed"); }
    finally { setLoading(false); }
  };

  return <div className="login-page"><div className="login-visual"><div className="login-brand"><div className="brand-mark large" aria-hidden="true"><Image src="/s-mark.svg" alt="" width={42} height={42}/></div><strong>{FIREBLADE_PRODUCT_NAME}</strong></div><div className="visual-copy"><p className="eyebrow">Nunes Instrumentation</p><h1>Your team.<br/>Your calls.<br/>One clear view.</h1></div></div><div className="login-panel"><form className="login-card" onSubmit={login}><h2>Welcome back</h2><p>Employees use Employee ID. Admin and MD use their company account.</p><label><span>Employee ID / Username</span><input required autoComplete="username" value={username} onChange={e => setUsername(e.target.value)} /></label><label><span>Password</span><input required autoComplete="current-password" type="password" value={password} onChange={e => setPassword(e.target.value)}/></label>{error && <div className="error-banner" role="alert">{error}</div>}<button className="primary-button login-button" disabled={loading || !username || !password}>{loading ? "Signing in…" : "Sign In"}</button></form></div></div>;
}
