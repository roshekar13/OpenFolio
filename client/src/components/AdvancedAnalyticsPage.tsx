import {
  Component,
  type ErrorInfo,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { Components } from "react-markdown";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { AnalyticsReportDetail, AnalyticsReportKind, AnalyticsReportSummary } from "../api";
import {
  deleteAnalyticsReport,
  fetchAnalyticsModelPolicy,
  fetchAnalyticsReport,
  fetchAnalyticsReports,
  postAnalyzePortfolio,
  postInvestmentIdeas,
  postSaveAnalyticsReport,
} from "../api";

type LoadingKind = "analyze" | "ideas";

const STALE_DAYS = 30;

const markdownComponents: Partial<Components> = {
  a: ({ node: _node, ...props }) => (
    <a {...props} target="_blank" rel="noopener noreferrer" />
  ),
};

class MarkdownSafeBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError(): { hasError: boolean } {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Advanced analytics markdown render failed:", error, info.componentStack);
  }

  render() {
    if (this.state.hasError) return this.props.fallback;
    return this.props.children;
  }
}

function MarkdownBody({ body }: { body: string }) {
  const fallback = (
    <div
      className="analytics-md-fallback"
      style={{
        color: "var(--text)",
        fontSize: 14,
        lineHeight: 1.65,
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
      }}
    >
      {body}
    </div>
  );

  return (
    <MarkdownSafeBoundary key={`${body.length}:${body.slice(0, 120)}`} fallback={fallback}>
      <div className="analytics-md">
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
          {body}
        </ReactMarkdown>
      </div>
    </MarkdownSafeBoundary>
  );
}

function ResultBlock({ title, body }: { title: string; body: string }) {
  return (
    <div
      className="panel"
      style={{
        marginTop: 20,
        padding: "1rem 1.25rem",
      }}
    >
      <h2 className="section-title" style={{ margin: "0 0 12px" }}>
        {title}
      </h2>
      <MarkdownBody body={body} />
    </div>
  );
}

function SavedReportModal({
  report,
  onClose,
  onDelete,
}: {
  report: AnalyticsReportDetail;
  onClose: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      role="dialog"
      aria-modal
      aria-labelledby="saved-report-title"
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
          width: "min(720px, 100%)",
          maxHeight: "min(85vh, 820px)",
          overflowY: "auto",
          background: "var(--bg1)",
          border: "1px solid var(--stroke)",
          borderRadius: 18,
          padding: "1.25rem 1.35rem",
          boxShadow: "var(--shadow)",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            gap: 12,
            marginBottom: 14,
          }}
        >
          <div>
            <div
              id="saved-report-title"
              className="mono"
              style={{ fontSize: 13, color: "var(--muted)", marginBottom: 4 }}
            >
              {formatWhen(report.createdAt)}
            </div>
            <div style={{ fontSize: 17, fontWeight: 650 }}>{kindLabel(report.kind)}</div>
          </div>
          <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
            <button
              type="button"
              className="btn-ghost"
              style={{ padding: "6px 10px", fontSize: 12 }}
              onClick={() => void onDelete()}
            >
              Delete
            </button>
            <button type="button" className="btn-ghost" style={{ padding: "6px 10px" }} onClick={onClose}>
              Close
            </button>
          </div>
        </div>
        <MarkdownBody body={report.body} />
      </div>
    </div>
  );
}

function kindLabel(kind: AnalyticsReportKind): string {
  return kind === "portfolio_analysis" ? "Portfolio analysis" : "Investment ideas";
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function daysSince(iso: string): number {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return 0;
  return Math.floor((Date.now() - t) / (24 * 60 * 60 * 1000));
}

export function AdvancedAnalyticsPage() {
  const [portfolioAnalysis, setPortfolioAnalysis] = useState<string | null>(null);
  const [investmentIdeas, setInvestmentIdeas] = useState<string | null>(null);
  const [loading, setLoading] = useState<LoadingKind | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [modelPolicy, setModelPolicy] = useState<string | null>(null);
  const [downloadBusy, setDownloadBusy] = useState(false);
  const [reports, setReports] = useState<AnalyticsReportSummary[]>([]);
  const [reportsErr, setReportsErr] = useState<string | null>(null);
  const [popupReport, setPopupReport] = useState<AnalyticsReportDetail | null>(null);
  const analyticsPdfRef = useRef<HTMLDivElement>(null);

  const reloadReports = useCallback(async () => {
    setReportsErr(null);
    try {
      setReports(await fetchAnalyticsReports());
    } catch (e) {
      setReportsErr(e instanceof Error ? e.message : "Could not load saved reports.");
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void fetchAnalyticsModelPolicy()
      .then((p) => {
        if (!cancelled) setModelPolicy(p);
      })
      .catch(() => {
        if (!cancelled) setModelPolicy(null);
      });
    void reloadReports();
    return () => {
      cancelled = true;
    };
  }, [reloadReports]);

  const staleReminder = useMemo(() => {
    const latestAnalysis = reports.find((r) => r.kind === "portfolio_analysis");
    if (!latestAnalysis) return null;
    const days = daysSince(latestAnalysis.createdAt);
    if (days >= STALE_DAYS) {
      return `Your last saved portfolio analysis was ${days} days ago (${formatWhen(latestAnalysis.createdAt)}). Consider running a fresh review.`;
    }
    return null;
  }, [reports]);

  const busy = loading !== null;

  const runAnalyze = useCallback(async () => {
    setErr(null);
    setLoading("analyze");
    try {
      const { analysis } = await postAnalyzePortfolio();
      setPortfolioAnalysis(analysis);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Analysis failed.");
    } finally {
      setLoading(null);
    }
  }, []);

  const runIdeas = useCallback(async () => {
    setErr(null);
    setLoading("ideas");
    try {
      const { ideas } = await postInvestmentIdeas();
      setInvestmentIdeas(ideas);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not load investment ideas.");
    } finally {
      setLoading(null);
    }
  }, []);

  const clearView = useCallback(() => {
    if (busy) return;
    setPortfolioAnalysis(null);
    setInvestmentIdeas(null);
    setErr(null);
  }, [busy]);

  const openSavedReport = useCallback(async (id: string) => {
    setErr(null);
    try {
      const { report } = await fetchAnalyticsReport(id);
      setPopupReport(report);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not open report.");
    }
  }, []);

  const removeReport = useCallback(
    async (id: string) => {
      if (!window.confirm("Delete this saved report?")) return;
      try {
        await deleteAnalyticsReport(id);
        if (popupReport?.id === id) setPopupReport(null);
        await reloadReports();
      } catch (e) {
        window.alert(e instanceof Error ? e.message : "Delete failed.");
      }
    },
    [popupReport?.id, reloadReports]
  );

  const downloadReport = useCallback(async () => {
    const el = analyticsPdfRef.current;
    const hasP = Boolean(portfolioAnalysis?.trim());
    const hasI = Boolean(investmentIdeas?.trim());
    if (!el || (!hasP && !hasI)) return;
    const filename =
      hasP && hasI ? "openfolio-analytics.pdf" : hasP ? "openfolio-portfolio-analysis.pdf" : "openfolio-investment-ideas.pdf";
    setDownloadBusy(true);
    try {
      const { default: html2pdf } = await import("html2pdf.js");
      const injectPdfStyles = (clonedDoc: Document) => {
        const root = clonedDoc.querySelector('[data-pdf-capture="analytics-export"]');
        if (!root) return;
        const style = clonedDoc.createElement("style");
        style.textContent = `
          [data-pdf-capture="analytics-export"],
          [data-pdf-capture="analytics-export"] * {
            color: #111111 !important;
            border-color: #d1d5db !important;
            box-shadow: none !important;
          }
          [data-pdf-capture="analytics-export"] {
            background: #ffffff !important;
          }
          [data-pdf-capture="analytics-export"] .section-title {
            color: #374151 !important;
          }
          [data-pdf-capture="analytics-export"] a,
          [data-pdf-capture="analytics-export"] a * {
            color: #0b57d0 !important;
          }
          [data-pdf-capture="analytics-export"] .analytics-md h3 {
            color: #111111 !important;
          }
          [data-pdf-capture="analytics-export"] pre,
          [data-pdf-capture="analytics-export"] code {
            background: #f3f4f6 !important;
            color: #111111 !important;
          }
          [data-pdf-capture="analytics-export"] th {
            background: #f9fafb !important;
            color: #374151 !important;
          }
          [data-pdf-capture="analytics-export"] td {
            color: #111111 !important;
          }
          [data-pdf-capture="analytics-export"] blockquote {
            color: #374151 !important;
          }
        `;
        clonedDoc.head.appendChild(style);
      };
      await html2pdf()
        .set({
          margin: [14, 14, 14, 14],
          filename,
          image: { type: "jpeg", quality: 0.92 },
          html2canvas: {
            scale: 2,
            useCORS: true,
            logging: false,
            backgroundColor: "#ffffff",
            onclone: (clonedDoc: Document) => {
              injectPdfStyles(clonedDoc);
            },
          },
          jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
          pagebreak: { mode: ["css", "legacy"] },
        })
        .from(el)
        .save();

      if (hasP && portfolioAnalysis) {
        await postSaveAnalyticsReport("portfolio_analysis", portfolioAnalysis);
      }
      if (hasI && investmentIdeas) {
        await postSaveAnalyticsReport("investment_ideas", investmentIdeas);
      }
      await reloadReports();
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "Could not download or save report.");
    } finally {
      setDownloadBusy(false);
    }
  }, [portfolioAnalysis, investmentIdeas, reloadReports]);

  const hasPortfolioText = Boolean(portfolioAnalysis?.trim());
  const hasInvestmentIdeasText = Boolean(investmentIdeas?.trim());
  const hasReportContent = hasPortfolioText || hasInvestmentIdeasText;

  return (
    <section>
      <div className="analytics-layout">
        <div className="analytics-main">
          <p style={{ color: "var(--muted)", marginTop: 0, marginBottom: 10, lineHeight: 1.5, maxWidth: 720 }}>
            Server-side Google Gemini reads your OpenFolio snapshot (same data as Home / Breakdown / Ledger). Not
            financial advice. Requires <span className="mono">GEMINI_API_KEY</span>.
            {modelPolicy ? (
              <>
                {" "}
                <span className="mono" style={{ color: "var(--text)" }}>
                  {modelPolicy}
                </span>
              </>
            ) : null}
          </p>
          <p
            style={{
              color: "var(--muted)",
              marginTop: 0,
              marginBottom: 16,
              lineHeight: 1.5,
              fontSize: 13,
              maxWidth: 720,
            }}
          >
            <strong style={{ color: "var(--text)" }}>Analyze portfolio</strong> reviews your trades and positioning in
            plain language. <strong style={{ color: "var(--text)" }}>Investment Ideas</strong> sends a structured
            snapshot of your book and equity-only trade patterns to Gemini (FX/currency instruments excluded), then
            surfaces adjacent quality and growth names you do not already hold. Use{" "}
            <strong style={{ color: "var(--text)" }}>Download report</strong> to save a PDF locally and store the text
            in your account.
          </p>

          {staleReminder && (
            <div
              style={{
                marginBottom: 14,
                padding: "10px 14px",
                borderRadius: 12,
                border: "1px solid rgba(251,191,36,0.35)",
                background: "rgba(251,191,36,0.1)",
                color: "var(--text)",
                fontSize: 13,
                lineHeight: 1.5,
                maxWidth: 720,
              }}
            >
              {staleReminder}
            </div>
          )}

          <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
            <button type="button" className="btn-primary" disabled={busy} onClick={() => void runAnalyze()}>
              {loading === "analyze" ? "Analyzing…" : "Analyze portfolio"}
            </button>
            <button type="button" className="btn-primary" disabled={busy} onClick={() => void runIdeas()}>
              {loading === "ideas" ? "Generating…" : "Investment Ideas"}
            </button>
            <button type="button" className="btn-ghost" disabled={busy} onClick={clearView}>
              Clear view
            </button>
          </div>

          {err && (
            <div
              style={{
                marginTop: 16,
                padding: "12px 14px",
                borderRadius: 12,
                background: "rgba(251,113,133,0.12)",
                border: "1px solid rgba(251,113,133,0.35)",
                color: "#fecdd3",
                fontSize: 14,
                lineHeight: 1.45,
              }}
            >
              {err}
            </div>
          )}

          <div style={{ marginTop: 8, paddingBottom: 32 }}>
            {hasReportContent && (
              <>
                <div ref={analyticsPdfRef} data-pdf-capture="analytics-export">
                  {hasPortfolioText && portfolioAnalysis && (
                    <ResultBlock title="Portfolio analysis" body={portfolioAnalysis} />
                  )}
                  {hasInvestmentIdeasText && investmentIdeas && (
                    <ResultBlock title="Investment ideas" body={investmentIdeas} />
                  )}
                </div>
                <div style={{ display: "flex", justifyContent: "flex-start", marginTop: 10 }}>
                  <button
                    type="button"
                    className="btn-ghost"
                    disabled={downloadBusy}
                    style={{ padding: "8px 12px", fontSize: 13 }}
                    onClick={() => void downloadReport()}
                  >
                    {downloadBusy ? "Saving report…" : "Download report"}
                  </button>
                </div>
              </>
            )}
            {!hasReportContent && !busy && !err && (
              <p style={{ color: "var(--muted)", marginTop: 24 }}>
                Choose an action above to generate a report, then download it to save a copy.
              </p>
            )}
          </div>
        </div>

        <aside className="panel analytics-saved-panel">
          <h2 className="section-title" style={{ margin: "0 0 10px" }}>
            Saved reports
          </h2>
          {reportsErr && <p style={{ color: "var(--danger)", fontSize: 13 }}>{reportsErr}</p>}
          {!reportsErr && reports.length === 0 && (
            <p style={{ color: "var(--muted)", fontSize: 13, margin: 0 }}>Saved reports will show here</p>
          )}
          {reports.length > 0 && (
            <div className="analytics-saved-tabs">
              {reports.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  className="analytics-report-tab"
                  onClick={() => void openSavedReport(r.id)}
                >
                  <span className="analytics-report-tab-label">{kindLabel(r.kind)}</span>
                  <span className="analytics-report-tab-when">{formatWhen(r.createdAt)}</span>
                </button>
              ))}
            </div>
          )}
        </aside>
      </div>

      {popupReport && (
        <SavedReportModal
          report={popupReport}
          onClose={() => setPopupReport(null)}
          onDelete={() => void removeReport(popupReport.id)}
        />
      )}
    </section>
  );
}
