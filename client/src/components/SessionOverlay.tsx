export function SessionOverlay({ message }: { message: string }) {
  return (
    <div className="session-overlay" role="status" aria-live="polite" aria-busy="true">
      <div className="session-overlay-panel">
        <div className="session-overlay-spinner" aria-hidden="true" />
        <p>{message}</p>
      </div>
    </div>
  );
}
