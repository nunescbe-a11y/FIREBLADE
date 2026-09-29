"use client";

import { useEffect, useMemo, useState } from "react";
import type { IncomingCall, SessionUser } from "@/lib/types";
import { formatIST } from "@/lib/format";

type SearchProduct = {
  id: string;
  product_code: string;
  canonical_name: string;
  brand: string | null;
  manufacturer: string | null;
  category: string | null;
  subcategory: string | null;
  primary_model: string | null;
  spec_count: number;
  asset_count: number;
  has_customer_price: boolean;
};

type ProductPackage = {
  product: SearchProduct & { current_revision_id?: string | null };
  models: string[];
  specs: Array<{ id: string; spec_label: string; value_text: string; unit: string | null }>;
  customer_prices: Array<{ id: string; amount: string | number; currency: string; tax_note: string | null; commercial_note: string | null }>;
  current_price: null | { id: string; amount: string | number; currency: string; tax_note: string | null; commercial_note: string | null };
  current_price_text: string | null;
  assets: Array<{ id: string; asset_type: string; title: string; revision_label: string | null; drive_file_id?: string | null; storage_object_path?: string | null }>;
  automation: { specs: number; customer_prices: number; attachments: number; source: string };
};

export default function MyWhatsAppClient({ user }: { user: SessionUser }) {
  const [status, setStatus] = useState<any>({ status: "LOADING" });
  const [calls, setCalls] = useState<IncomingCall[]>([]);
  const [callId, setCallId] = useState("");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchProduct[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<SearchProduct | null>(null);
  const [pkg, setPkg] = useState<ProductPackage | null>(null);
  const [greeting, setGreeting] = useState("");
  const [closing, setClosing] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const loadStatus = async () => {
    try {
      const r = await fetch("/api/whatsapp/status", { cache: "no-store" });
      const j = await r.json();
      setStatus(j);
    } catch {
      setStatus({ status: "UNAVAILABLE" });
    }
  };

  useEffect(() => {
    const requestedCallId = new URLSearchParams(window.location.search).get("call_id");
    if (requestedCallId) setCallId(requestedCallId);
    void loadStatus();
    fetch("/api/calls?limit=5000", { cache: "no-store" })
      .then(r => r.json())
      .then(j => setCalls(j.calls || []))
      .catch(() => setCalls([]));
    const t = setInterval(() => {
      if (!document.hidden) void loadStatus();
    }, 5000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const r = await fetch(`/api/products/search?q=${encodeURIComponent(q)}`, { cache: "no-store", signal: controller.signal });
        const j = await r.json();
        if (!r.ok) throw Error(j.error || "Product search failed");
        setResults(j.products || []);
      } catch (e) {
        if ((e as Error)?.name !== "AbortError") setError(e instanceof Error ? e.message : "Product search failed");
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [query]);


  const changeProductQuery = (value: string) => {
    setSelected(null);
    setPkg(null);
    setQuery(value);
  };

  const recent = useMemo(() => calls, [calls]);
  const chosenCall = recent.find(c => String(c.call_id) === callId);

  const chooseProduct = async (product: SearchProduct) => {
    setSelected(product);
    setPkg(null);
    setBusy(true);
    setError("");
    try {
      const r = await fetch(`/api/products/package?product_id=${encodeURIComponent(product.id)}`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw Error(j.error || "Could not prepare product package");
      setPkg(j);
      setResults([]);
      setQuery(product.canonical_name);
    } catch (e) {
      setSelected(null);
      setError(e instanceof Error ? e.message : "Could not prepare product package");
    } finally {
      setBusy(false);
    }
  };

  const start = async () => {
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/whatsapp/status", { method: "POST" });
      const j = await r.json();
      if (!r.ok) throw Error(j.error);
      await loadStatus();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start WhatsApp");
    } finally {
      setBusy(false);
    }
  };

  const send = async () => {
    if (!chosenCall || !selected || !pkg) return;
    setBusy(true);
    setNotice("");
    setError("");
    try {
      const r = await fetch("/api/whatsapp/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          call_id: chosenCall.call_id,
          product_id: selected.id,
          greeting,
          closing,
          idempotency_key: crypto.randomUUID(),
        }),
      });
      const j = await r.json();
      if (!r.ok) throw Error(j.error || "Send failed");
      setNotice(`Fireblade sent ${j.product_name} to ${j.recipient}: ${j.specifications} specification(s), ${j.attachments} attachment(s)${j.price_included ? ", customer price included" : ""}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Send failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="page-header">
        <div>
          <p className="eyebrow">Employee-scoped product communication</p>
          <h1>My WhatsApp</h1>
          <p>Choose your customer call, type a product name/model/code, and Fireblade automatically assembles the available customer package from the master catalogue.</p>
        </div>
      </div>
      {error && <div className="error-banner">{error}</div>}
      {notice && <div className="success-banner">{notice}</div>}

      <div className="whatsapp-grid">
        <section className="panel wa-connection">
          <div className="panel-heading">
            <h2>My WhatsApp Connection</h2>
            <span className={`status-pill ${status.status === "READY" ? "success" : status.status === "QR_READY" ? "warning" : "neutral"}`}>{status.status || "UNKNOWN"}</span>
          </div>
          <p className="muted">This connection belongs only to {user.employee_name || user.username}. Product packages are sent from this employee's linked WhatsApp.</p>
          {status.number && <p><strong>Connected number:</strong> {status.number}</p>}
          {status.status === "QR_READY" && status.qr_data_url && (
            <div className="qr-box">
              <img src={status.qr_data_url} alt="WhatsApp connection QR code" />
              <p>Open WhatsApp on your phone → Linked devices → Link a device, then scan this QR.</p>
            </div>
          )}
          {status.status !== "READY" && (
            <button className="primary-button" disabled={busy} onClick={() => void start()}>{busy ? "Starting…" : status.status === "QR_READY" ? "Refresh QR" : "Connect / Reconnect WhatsApp"}</button>
          )}
          {status.error && <p className="muted">{status.error}</p>}
        </section>

        <section className="panel wa-share">
          <div>
            <p className="eyebrow">1 · Customer</p>
            <h2>Send Product Package</h2>
          </div>

          <label>
            <span>Customer call</span>
            <select value={callId} onChange={e => setCallId(e.target.value)}>
              <option value="">Select one of my calls…</option>
              {recent.map(c => (
                <option key={c.call_id} value={c.call_id}>{formatIST(c.started_at_epoch_ms)} · {c.phone_number_normalized || c.phone_number_raw || "Unknown"} · {c.direction === "INCOMING_MISSED" ? "Missed" : "Answered"}</option>
              ))}
            </select>
          </label>
          {chosenCall && (
            <div className="selected-customer">
              <strong>{chosenCall.phone_number_normalized || chosenCall.phone_number_raw}</strong>
              <span>{chosenCall.person_name || chosenCall.company_name || "Customer"}</span>
            </div>
          )}

          <div className="product-search-block">
            <p className="eyebrow">2 · Product</p>
            <label>
              <span>Type product name, model or code</span>
              <input value={query} onChange={e => changeProductQuery(e.target.value)} placeholder="e.g. Digital pH Meter VT 10, PM8000, lux meter…" autoComplete="off" />
            </label>
            {searching && <div className="search-state">Searching the master catalogue…</div>}
            {!searching && query.trim().length >= 2 && !selected && results.length === 0 && <div className="empty-panel">No matching published product found. Try model number, product code, or fewer words.</div>}
            {results.length > 0 && !selected && (
              <div className="product-search-results">
                {results.map(p => (
                  <button type="button" className="product-result" key={p.id} onClick={() => void chooseProduct(p)}>
                    <div>
                      <strong>{p.canonical_name}</strong>
                      <span>{[p.primary_model, p.product_code, p.brand].filter(Boolean).join(" · ")}</span>
                    </div>
                    <small>{p.spec_count} specs · {p.asset_count} files · {p.has_customer_price ? "customer price available" : "price on quotation"}</small>
                  </button>
                ))}
              </div>
            )}
          </div>

          {selected && pkg && (
            <div className="auto-package">
              <div className="auto-package-head">
                <div>
                  <p className="eyebrow">3 · Fireblade assembled automatically</p>
                  <h3>{pkg.product.canonical_name}</h3>
                  <span>{[pkg.models[0], pkg.product.product_code, pkg.product.brand].filter(Boolean).join(" · ")}</span>
                </div>
                <button type="button" className="mini-button" onClick={() => { setSelected(null); setPkg(null); setQuery(""); }}>Change product</button>
              </div>
              <div className="package-metrics">
                <div><b>{pkg.specs.length}</b><span>Specifications</span></div>
                <div><b>{pkg.assets.length}</b><span>Related files</span></div>
                <div><b>{pkg.current_price_text || "Quote"}</b><span>Customer price</span></div>
              </div>
              {pkg.current_price_text && (
                <div className="package-price"><strong>{pkg.current_price_text}</strong>{pkg.current_price?.tax_note && <span>{pkg.current_price.tax_note}</span>}{pkg.current_price?.commercial_note && <span>{pkg.current_price.commercial_note}</span>}</div>
              )}
              {!pkg.current_price_text && <div className="package-price muted"><strong>Price will not expose internal purchase cost.</strong><span>No customer-sendable price is currently available; the WhatsApp message will say quotation on request.</span></div>}
              <div className="package-specs">
                {pkg.specs.slice(0, 12).map(s => <p key={s.id}><span>{s.spec_label}</span><b>{s.value_text}{s.unit && !s.value_text.includes(s.unit) ? ` ${s.unit}` : ""}</b></p>)}
                {pkg.specs.length > 12 && <small>+ {pkg.specs.length - 12} additional specifications will be included within the message character limit.</small>}
              </div>
              <div className="package-files">
                <strong>Automatic attachments</strong>
                {pkg.assets.length ? pkg.assets.map(a => <span key={a.id}>{a.asset_type.replaceAll("_", " ")} · {a.title}{a.revision_label ? ` · ${a.revision_label}` : ""}</span>) : <span>No matching customer-facing catalogue file is indexed yet.</span>}
              </div>
            </div>
          )}

          <div className="personal-message-grid">
            <label><span>Personal greeting (optional)</span><textarea value={greeting} onChange={e => setGreeting(e.target.value)} placeholder="Hello Mr. Sharma, as discussed over the phone…" /></label>
            <label><span>Personal closing (optional)</span><textarea value={closing} onChange={e => setClosing(e.target.value)} placeholder={`Regards,\n${user.employee_name || user.username}`} /></label>
          </div>

          <button className="primary-button" disabled={busy || status.status !== "READY" || !chosenCall || !selected || !pkg} onClick={() => void send()}>
            {busy ? "Sending…" : "Send Complete Product Package via My WhatsApp"}
          </button>
          <small className="muted">Fireblade controls the product facts, customer price eligibility and attachments. The employee can only personalize the greeting and closing.</small>
        </section>
      </div>
    </>
  );
}
