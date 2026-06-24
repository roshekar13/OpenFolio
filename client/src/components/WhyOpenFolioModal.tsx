import type { ReactNode } from "react";

function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  return (
    <div
      role="dialog"
      aria-modal
      aria-labelledby="why-openfolio-title"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.55)",
        display: "grid",
        placeItems: "center",
        zIndex: 80,
        padding: 16,
      }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          width: "min(520px, 100%)",
          maxHeight: "min(85vh, 720px)",
          overflowY: "auto",
          background: "var(--bg1)",
          border: "1px solid var(--stroke)",
          borderRadius: 18,
          padding: "1.25rem 1.35rem",
          boxShadow: "var(--shadow)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <div id="why-openfolio-title" style={{ fontSize: 18, fontWeight: 650 }}>
            {title}
          </div>
          <button type="button" className="btn-ghost" style={{ padding: "6px 10px" }} onClick={onClose}>
            Close
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function TrustSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section style={{ marginBottom: 18 }}>
      <h3 style={{ margin: "0 0 8px", fontSize: 15, fontWeight: 650, color: "var(--analytics-h3)" }}>{title}</h3>
      <div style={{ color: "var(--muted)", fontSize: 14, lineHeight: 1.65 }}>{children}</div>
    </section>
  );
}

export function WhyOpenFolioModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;

  return (
    <Modal title="Why OpenFolio?" onClose={onClose}>
      <p style={{ margin: "0 0 16px", color: "var(--text)", fontSize: 14, lineHeight: 1.65 }}>
        OpenFolio is built for investors who want a clear picture of their own trades — without handing their
        financial history to an opaque third party.
      </p>

      <TrustSection title="Your data stays yours">
        Each account has a private ledger, watchlist, and analytics history stored in{" "}
        <strong style={{ color: "var(--text)", fontWeight: 600 }}>MongoDB Atlas</strong>, a managed database with
        encryption in transit (TLS), automated backups, and strict per-user isolation. Your transactions are never
        mixed with another user’s records.
      </TrustSection>

      <TrustSection title="Secure sign-in">
        Passwords are hashed with <strong style={{ color: "var(--text)", fontWeight: 600 }}>bcrypt</strong> before
        storage — we never save or display plain-text passwords. Sessions use signed tokens over HTTPS, and API
        access is scoped to your account only.
      </TrustSection>

      <TrustSection title="No hidden data brokering">
        OpenFolio does not sell your portfolio data. Market prices are fetched only to display your holdings and
        watchlist; your ledger is used for your dashboards and optional AI reviews that you explicitly request.
      </TrustSection>

      <TrustSection title="Transparent by design">
        You can inspect every transaction in the ledger, export via CSV import workflows, and see exactly how capital
        deployment, recycled proceeds, and XIRR are calculated from your own trade history — not black-box estimates.
      </TrustSection>

      <TrustSection title="You control the workspace">
        Create an account in seconds, switch between USD and SGD display, manage a personal watchlist, and delete
        transactions or analytics reports whenever you choose. Sign out anytime; your data remains in your account
        until you remove it.
      </TrustSection>

      <p style={{ margin: 0, fontSize: 13, color: "var(--muted)", lineHeight: 1.6 }}>
        Ready to track your own portfolio? Use the account button in the top-right corner to register or sign in.
      </p>
    </Modal>
  );
}
