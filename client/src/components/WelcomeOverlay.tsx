import { createPortal } from "react-dom";

export function WelcomeOverlay({
  onDismiss,
  demoMode,
}: {
  onDismiss: () => void;
  demoMode: boolean;
}) {
  return createPortal(
    <div
      className="welcome-overlay"
      role="dialog"
      aria-modal
      aria-label="Welcome to OpenFolio"
      onClick={onDismiss}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onDismiss();
        }
      }}
      tabIndex={-1}
    >
      <div className="welcome-overlay-content">
        <h2 className="welcome-overlay-title">Welcome to OpenFolio</h2>
        <p className="welcome-overlay-body">
          Track your trades, monitor live performance, and understand your portfolio in one private workspace.
        </p>
        <p className="welcome-overlay-hint">
          {demoMode
            ? "Click anywhere to explore the sample portfolio"
            : "Click anywhere to continue to your portfolio"}
        </p>
      </div>
    </div>,
    document.body
  );
}
