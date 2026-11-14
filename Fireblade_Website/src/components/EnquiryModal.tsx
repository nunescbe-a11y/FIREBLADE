"use client";

import { useEffect, useMemo, useState } from "react";
import type { Contact, IncomingCall } from "@/lib/types";
import { cleanStatus, formatDuration, formatIST } from "@/lib/format";

type InformationType = {
  id: string;
  code: string;
  label: string;
  sort_order: number;
  active: boolean;
  require_remark_when_no: boolean;
};

type InformationResponse = {
  information_type_id: string;
  sent: boolean;
  remarks: string | null;
};

type Answer = {
  sent: boolean | null;
  remarks: string;
};

const COMMON_REMARK_CODES = new Set(["QUOTATION", "CATALOGUE", "IMAGE"]);

export default function EnquiryModal({ call, onClose, onSaved }: { call: IncomingCall; onClose: () => void; onSaved: () => void }) {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [contactId, setContactId] = useState(call.contact_id || "");
  const [personName, setPersonName] = useState(call.person_name || call.phone_contact_name || "");
  const [companyName, setCompanyName] = useState(call.company_name || "");
  const [productName, setProductName] = useState(call.product_name || "");
  const [requirementDetails, setRequirementDetails] = useState(call.requirement_details || "");
  const [notes, setNotes] = useState(call.notes || "");
  const [informationTypes, setInformationTypes] = useState<InformationType[]>([]);
  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  const [commonRemarks, setCommonRemarks] = useState("");
  const [informationLoading, setInformationLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!call.phone_number_normalized) return;
    fetch(`/api/contacts?phone=${encodeURIComponent(call.phone_number_normalized)}`)
      .then((r) => r.json())
      .then((data) => setContacts(data.contacts || []))
      .catch(() => undefined);
  }, [call.phone_number_normalized]);

  useEffect(() => {
    let cancelled = false;
    setInformationLoading(true);
    const query = call.enquiry_id ? `?enquiryId=${encodeURIComponent(call.enquiry_id)}` : "";
    fetch(`/api/information-types${query}`, { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Could not load information checklist");
        if (cancelled) return;
        const types = (data.types || []) as InformationType[];
        const responses = (data.responses || []) as InformationResponse[];
        const responseMap = new Map(responses.map((item) => [item.information_type_id, item]));
        const next: Record<string, Answer> = {};
        for (const type of types) {
          const existing = responseMap.get(type.id);
          next[type.id] = {
            sent: existing ? Boolean(existing.sent) : null,
            remarks: existing?.remarks || "",
          };
        }
        const existingCommonRemarks = Array.from(new Set(
          responses
            .filter((item) => String(item.remarks || "").trim())
            .map((item) => String(item.remarks || "").trim()),
        )).join(" | ");
        setInformationTypes(types);
        setAnswers(next);
        setCommonRemarks(existingCommonRemarks);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not load information checklist");
      })
      .finally(() => {
        if (!cancelled) setInformationLoading(false);
      });
    return () => { cancelled = true; };
  }, [call.enquiry_id]);

  const chooseContact = (id: string) => {
    setContactId(id);
    const c = contacts.find((x) => x.id === id);
    if (c) {
      setPersonName(c.person_name);
      setCompanyName(c.company_name || "");
    } else {
      setPersonName(call.phone_contact_name || "");
      setCompanyName("");
    }
  };

  const setSent = (id: string, sent: boolean) => {
    setAnswers((current) => ({
      ...current,
      [id]: { sent, remarks: current[id]?.remarks || "" },
    }));
  };

  const commonRemarkRequired = useMemo(() => (
    informationTypes.some((type) => COMMON_REMARK_CODES.has(type.code) && answers[type.id]?.sent === false)
  ), [answers, informationTypes]);

  const informationComplete = useMemo(() => {
    if (informationLoading) return false;
    if (!informationTypes.every((type) => answers[type.id]?.sent != null)) return false;
    if (commonRemarkRequired && !commonRemarks.trim()) return false;
    return true;
  }, [answers, commonRemarkRequired, commonRemarks, informationLoading, informationTypes]);

  const save = async () => {
    setSaving(true);
    setError("");
    try {
      if (!informationComplete) throw new Error("Please answer Yes or No for every Information Sent item. If any item is No, enter the Common Remarks.");
      const response = await fetch("/api/enquiries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          callId: call.call_id,
          contactId,
          personName,
          companyName,
          productName,
          requirementDetails,
          notes,
          commonRemarks: commonRemarks.trim(),
          informationSent: informationTypes.map((type) => ({
            informationTypeId: type.id,
            sent: answers[type.id]?.sent,
            remarks: COMMON_REMARK_CODES.has(type.code) ? commonRemarks.trim() : (answers[type.id]?.remarks || ""),
          })),
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not save enquiry");
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save enquiry");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal-card enquiry-modal-card" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div><p className="eyebrow">Incoming call</p><h2>Customer / Enquiry Details</h2></div>
          <button className="icon-button" onClick={onClose}>×</button>
        </div>

        <div className="call-proof-grid">
          <div><span>Phone</span><strong>{call.phone_number_normalized || call.phone_number_raw || "Unknown"}</strong></div>
          <div><span>Call status</span><strong>{cleanStatus(call.direction)}</strong></div>
          <div><span>Date / time</span><strong>{formatIST(call.started_at_epoch_ms)}</strong></div>
          <div><span>Duration</span><strong>{formatDuration(call.duration_seconds)}</strong></div>
        </div>

        {contacts.length > 0 && (
          <div className="known-caller-box">
            <div><strong>Known number</strong><span>{contacts.length} saved contact{contacts.length > 1 ? "s" : ""} for this number</span></div>
            <select value={contactId} onChange={(e) => chooseContact(e.target.value)}>
              <option value="">Add another person for this number</option>
              {contacts.map((c) => <option key={c.id} value={c.id}>{c.person_name}{c.company_name ? ` — ${c.company_name}` : ""}</option>)}
            </select>
          </div>
        )}

        <div className="form-grid two-col">
          <label><span>Person name *</span><input value={personName} onChange={(e) => setPersonName(e.target.value)} placeholder="e.g. Rajesh Kumar" /></label>
          <label><span>Company name</span><input value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="Optional" /></label>
          <label className="full"><span>Product / Requirement *</span><input value={productName} onChange={(e) => setProductName(e.target.value)} placeholder="e.g. Digital Pressure Gauge" /></label>
          <label className="full"><span>Requirement details</span><textarea value={requirementDetails} onChange={(e) => setRequirementDetails(e.target.value)} placeholder="Range, quantity, model, application..." rows={3} /></label>
          <label className="full"><span>Notes</span><textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Follow-up or quotation notes" rows={3} /></label>
        </div>

        <section className="information-sent-editor" aria-labelledby="information-sent-heading">
          <div className="information-sent-heading">
            <div>
              <p className="eyebrow">Customer communication</p>
              <h3 id="information-sent-heading">Information Sent</h3>
              <p>Select Yes or No for every item. Use one Common Remarks box for Quotation, Catalogue and Image.</p>
            </div>
          </div>

          {informationLoading ? (
            <div className="information-loading">Loading checklist...</div>
          ) : informationTypes.length === 0 ? (
            <div className="information-loading">No active information items are configured.</div>
          ) : (
            <div className="information-sent-list">
              {informationTypes.map((type) => {
                const answer = answers[type.id] || { sent: null, remarks: "" };
                return (
                  <fieldset className="information-sent-item" key={type.id}>
                    <legend>{type.label}</legend>
                    <div className="yes-no-control" aria-label={`${type.label} sent`}>
                      <button type="button" className={answer.sent === true ? "selected yes" : ""} onClick={() => setSent(type.id, true)}>Yes</button>
                      <button type="button" className={answer.sent === false ? "selected no" : ""} onClick={() => setSent(type.id, false)}>No</button>
                    </div>
                  </fieldset>
                );
              })}
            </div>
          )}

          {!informationLoading && informationTypes.length > 0 && (
            <label className="information-remarks common-information-remarks">
              <span>Common Remarks{commonRemarkRequired ? " *" : ""}</span>
              <textarea
                rows={3}
                value={commonRemarks}
                onChange={(e) => setCommonRemarks(e.target.value)}
                placeholder={commonRemarkRequired ? "Required because one or more items are No" : "Optional when all items are Yes"}
              />
              {commonRemarkRequired && !commonRemarks.trim() && <small>Required when Quotation, Catalogue or Image is marked No.</small>}
            </label>
          )}
        </section>

        {error && <div className="error-banner">{error}</div>}
        <div className="modal-actions">
          <button className="secondary-button" onClick={onClose}>Cancel</button>
          <button className="primary-button" disabled={saving || informationLoading || !informationComplete || !personName.trim() || !productName.trim()} onClick={save}>
            {saving ? "Saving..." : "Save Details"}
          </button>
        </div>
      </div>
    </div>
  );
}