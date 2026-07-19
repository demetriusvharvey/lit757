"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

type Method = "email" | "phone" | "website" | "manual";
type ClaimRecord = {
  venueName: string;
  contactName: string;
  businessEmail: string;
  phone: string;
  role: string;
  method: Method;
  proof: string;
  status: "pending";
  submittedAt: string;
};

const CLAIMS_KEY = "lit757-business-claims";

function getVenueName(sheet: Element) {
  return sheet.querySelector(".utility-head h2")?.textContent?.trim() || "this business";
}

export default function ClaimBusinessEnhancer() {
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [venueName, setVenueName] = useState("");
  const [step, setStep] = useState(1);
  const [method, setMethod] = useState<Method>("email");
  const [contactName, setContactName] = useState("");
  const [businessEmail, setBusinessEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState("Owner");
  const [proof, setProof] = useState("");
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const install = () => {
      document.querySelectorAll(".utility-sheet").forEach((sheet) => {
        const title = getVenueName(sheet);
        if (!title || title === "Your watchlist" || title === "We’ll tell you when to go" || title === "Your 757") return;
        if (sheet.querySelector(".claim-business-entry")) return;
        const entry = document.createElement("div");
        entry.className = "claim-business-entry";
        entry.innerHTML = `<small>BUSINESS OWNER?</small><strong>Manage this listing</strong><p>Verify ownership to upload the official cover photo, update business details, publish events, and view activity insights.</p><button type="button">🏢 Claim this business</button>`;
        entry.querySelector("button")?.addEventListener("click", () => {
          setVenueName(title);
          setStep(1);
          setSubmitted(false);
          setOpen(true);
        });
        sheet.appendChild(entry);
      });
    };
    install();
    const observer = new MutationObserver(install);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  const verificationLabel = useMemo(() => {
    if (method === "email") return "Business email address";
    if (method === "phone") return "Public business phone";
    if (method === "website") return "Official website URL";
    return "Describe the documents you can provide";
  }, [method]);

  const canContinue = step === 1
    ? Boolean(contactName.trim() && businessEmail.trim() && phone.trim())
    : Boolean(proof.trim());

  function close() {
    setOpen(false);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (step < 2) {
      setStep(2);
      return;
    }
    const record: ClaimRecord = {
      venueName,
      contactName: contactName.trim(),
      businessEmail: businessEmail.trim(),
      phone: phone.trim(),
      role,
      method,
      proof: proof.trim(),
      status: "pending",
      submittedAt: new Date().toISOString(),
    };
    try {
      const existing = JSON.parse(localStorage.getItem(CLAIMS_KEY) || "[]") as ClaimRecord[];
      localStorage.setItem(CLAIMS_KEY, JSON.stringify([record, ...existing.filter((item) => item.venueName !== venueName)]));
    } catch {}
    setSubmitted(true);
    setStep(3);
  }

  if (!mounted || !open) return null;

  return createPortal(
    <div className="claim-business-backdrop" onClick={close}>
      <section className="claim-business-sheet" onClick={(event) => event.stopPropagation()}>
        <div className="claim-business-handle" />
        <div className="claim-business-head">
          <div>
            <span>CLAIM BUSINESS</span>
            <h2>{venueName}</h2>
            <p>Only verified representatives can manage this listing or upload its official venue photography.</p>
          </div>
          <button className="claim-business-close" onClick={close} aria-label="Close">×</button>
        </div>

        <div className="claim-progress">
          <span className={step >= 1 ? "active" : ""}>1. Business info</span>
          <span className={step >= 2 ? "active" : ""}>2. Verify</span>
          <span className={step >= 3 ? "active" : ""}>3. Review</span>
        </div>

        {submitted ? (
          <div className="claim-success">
            <i>✓</i>
            <h3>Claim submitted</h3>
            <p>Your request is pending verification. Until approval, this listing remains public and no business-managed photo or detail changes will appear.</p>
            <div className="claim-actions" style={{ gridTemplateColumns: "1fr" }}>
              <button className="claim-next" onClick={close}>Done</button>
            </div>
          </div>
        ) : (
          <form onSubmit={submit}>
            {step === 1 ? (
              <div className="claim-panel">
                <label>Your name<input value={contactName} onChange={(event) => setContactName(event.target.value)} placeholder="Full name" /></label>
                <label>Role<select value={role} onChange={(event) => setRole(event.target.value)}><option>Owner</option><option>General manager</option><option>Marketing manager</option><option>Authorized representative</option></select></label>
                <label>Business email<input type="email" value={businessEmail} onChange={(event) => setBusinessEmail(event.target.value)} placeholder="you@business.com" /></label>
                <label>Business phone<input inputMode="tel" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="Public or direct business number" /></label>
                <div className="claim-note">A claim does not grant access immediately. LIT757 verifies ownership before enabling uploads, edits, event publishing, analytics, or follower messaging.</div>
              </div>
            ) : (
              <div className="claim-panel">
                <div className="claim-methods">
                  <button type="button" className={`claim-method ${method === "email" ? "selected" : ""}`} onClick={() => { setMethod("email"); setProof(""); }}><i>✉</i><span><strong>Business email</strong><small>Verify through an email matching the official business website domain.</small></span><b>›</b></button>
                  <button type="button" className={`claim-method ${method === "phone" ? "selected" : ""}`} onClick={() => { setMethod("phone"); setProof(""); }}><i>☎</i><span><strong>Listed phone</strong><small>Send a one-time code to the phone publicly associated with the business.</small></span><b>›</b></button>
                  <button type="button" className={`claim-method ${method === "website" ? "selected" : ""}`} onClick={() => { setMethod("website"); setProof(""); }}><i>⌘</i><span><strong>Website verification</strong><small>Add a temporary verification code to the official site or DNS.</small></span><b>›</b></button>
                  <button type="button" className={`claim-method ${method === "manual" ? "selected" : ""}`} onClick={() => { setMethod("manual"); setProof(""); }}><i>▤</i><span><strong>Manual review</strong><small>Use official documents when automated verification is unavailable.</small></span><b>›</b></button>
                </div>
                <label>{verificationLabel}{method === "manual" ? <textarea value={proof} onChange={(event) => setProof(event.target.value)} placeholder="Business license, lease, utility bill, authorization letter…" /> : <input value={proof} onChange={(event) => setProof(event.target.value)} placeholder={method === "email" ? businessEmail || "owner@business.com" : method === "phone" ? phone || "Business phone" : "https://business.com"} />}</label>
                <div className="claim-note">For this first release, requests are stored as pending for admin review. Automated email, phone, and website challenges come next.</div>
              </div>
            )}

            <div className="claim-actions">
              <button type="button" className="claim-back" onClick={() => step === 1 ? close() : setStep(1)}>{step === 1 ? "Cancel" : "Back"}</button>
              <button className="claim-next" disabled={!canContinue}>{step === 1 ? "Continue" : "Submit claim"}</button>
            </div>
          </form>
        )}
      </section>
    </div>,
    document.body
  );
}
