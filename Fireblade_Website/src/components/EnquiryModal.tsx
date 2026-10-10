"use client";

import { useEffect, useState } from "react";
import type { Contact, IncomingCall } from "@/lib/types";
import { cleanStatus, formatDuration, formatIST } from "@/lib/format";

export default function EnquiryModal({
  call,
  onClose,
  onSaved,
}: {
  call: IncomingCall;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [contactId, setContactId] = useState(call.contact_id || "");
  const [personName, setPersonName] = useState(call.person_name || call.phone_contact_name || "");
  const [companyName, setCompanyName] = useState(call.company_name || "");
  const [productName, setProductName] = useState(call.product_name || "");
  const [requirementDetails, setRequirementDetails] = useState(call.requirement_details || "");
  const [notes, setNotes] = useState(call.notes || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!call.phone_number_normalized) return;
    fetch(`/api/contacts?phone=${encodeURIComponent(call.phone_number_normalized)}`)
      .then((r) => r.json())
      .then((data) => setContacts(data.contacts || []))
      .catch(() => undefined);
  }, [call.phone_number_normalized]);

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

  const save = async () => {
    setSaving(true);
    setError("");
    try {
      if (!personName.trim()) throw new Error("Person name is required");
      if (!productName.trim()) throw new Error("Product / requirement is required");

      const response = await fetch("/api/enquiries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          callId: call.call_id,
          contactId,
          personName: personName.trim(),
          companyName: companyName.trim(),
          productName: productName.trim(),
          requirementDetails: requirementDetails.trim(),
          notes: notes.trim(),
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

  const isFormValid = Boolean(personName.trim() && productName.trim());

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal-card enquiry-modal-card" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <p className="eyebrow">Incoming call</p>
            <h2>Customer / Enquiry Details</h2>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <div className="call-proof-grid">
          <div>
            <span>Phone</span>
            <strong>{call.phone_number_normalized || call.phone_number_raw || "Unknown"}</strong>
          </div>
          <div>
            <span>Call status</span>
            <strong>{cleanStatus(call.direction)}</strong>
          </div>
          <div>
            <span>Date / time</span>
            <strong>{formatIST(call.started_at_epoch_ms)}</strong>
          </div>
          <div>
            <span>Duration</span>
            <strong>{formatDuration(call.duration_seconds)}</strong>
          </div>
        </div>

        {contacts.length > 0 && (
          <div className="known-caller-box">
            <div>
              <strong>Known number</strong>
              <span>
                {contacts.length} saved contact{contacts.length > 1 ? "s" : ""} for this number
              </span>
            </div>
            <select value={contactId} onChange={(e) => chooseContact(e.target.value)}>
              <option value="">Add another person for this number</option>
              {contacts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.person_name}
                  {c.company_name ? ` — ${c.company_name}` : ""}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="form-grid two-col">
          <label>
            <span>Person name *</span>
            <input
              value={personName}
              onChange={(e) => setPersonName(e.target.value)}
              placeholder="e.g. Rajesh Kumar"
              required
            />
          </label>
          <label>
            <span>Company name</span>
            <input
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              placeholder="Optional"
            />
          </label>
          <label className="full">
            <span>Product / Requirement *</span>
            <input
              value={productName}
              onChange={(e) => setProductName(e.target.value)}
              placeholder="e.g. Digital Pressure Gauge"
              required
            />
          </label>
          <label className="full">
            <span>Requirement details</span>
            <textarea
              value={requirementDetails}
              onChange={(e) => setRequirementDetails(e.target.value)}
              placeholder="Range, quantity, model, application..."
              rows={3}
            />
          </label>
          <label className="full">
            <span>Notes / Remarks</span>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Customer notes, quotation details or follow-up remarks"
              rows={3}
            />
          </label>
        </div>

        {error && <div className="error-banner">{error}</div>}
        <div className="modal-actions">
          <button className="secondary-button" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button
            className="primary-button"
            disabled={saving || !isFormValid}
            onClick={save}
          >
            {saving ? "Saving..." : "Save Details"}
          </button>
        </div>
      </div>
    </div>
  );
}