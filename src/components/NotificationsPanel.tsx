import { useCallback, useEffect, useRef, useState } from "react";
import {
  Bell,
  Camera,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  History,
  LoaderCircle,
  Share2,
  X,
  XCircle,
} from "lucide-react";
import { loadSubmissionPage } from "../api";
import type { Submission, SubmissionPage } from "../types";

export type NotificationPanelView = "updates" | "proofs";

function resultStatus(submission: Submission) {
  if (submission.status === "accepted") {
    return {
      label: "Accepted",
      detail: `You earned ${submission.xp} XP.`,
      className: "accepted",
      Icon: CheckCircle2,
    };
  }
  if (submission.status === "pending") {
    return {
      label: "Still checking",
      detail: "We’ll update you when it’s ready.",
      className: "processing",
      Icon: Clock3,
    };
  }
  return {
    label: "Couldn’t verify",
    detail: "Try this quest again.",
    className: "failed",
    Icon: XCircle,
  };
}

function resultDate(submission: Submission) {
  return new Date(submission.verifiedAt ?? submission.createdAt).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

export default function NotificationsPanel({
  initialView,
  recentItems,
  onClose,
  onShare,
}: {
  initialView: NotificationPanelView;
  recentItems: Submission[];
  onClose: () => void;
  onShare: (submission: Submission) => void;
}) {
  const [view, setView] = useState<NotificationPanelView>(initialView);
  const [proofPage, setProofPage] = useState<SubmissionPage | null>(null);
  const [loadingPage, setLoadingPage] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);
  const panelRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  const loadPage = useCallback(async (page: number) => {
    setLoadingPage(true);
    setPageError(null);
    try {
      setProofPage(await loadSubmissionPage(page, 8, "accepted"));
    } catch (error) {
      setPageError(error instanceof Error ? error.message : "Accepted proofs could not be loaded.");
    } finally {
      setLoadingPage(false);
    }
  }, []);

  useEffect(() => {
    const previouslyFocusedElement = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    closeButtonRef.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.key !== "Tab" || !panelRef.current) return;
      const focusableElements = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>("button:not(:disabled), a[href], input:not(:disabled), [tabindex]:not([tabindex='-1'])"),
      ).filter((element) => element.getClientRects().length > 0);
      const first = focusableElements[0];
      const last = focusableElements.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    if (initialView === "proofs") void loadPage(1);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
      previouslyFocusedElement?.focus();
    };
  }, [initialView, loadPage, onClose]);

  function showProofs() {
    setView("proofs");
    if (!proofPage && !loadingPage) void loadPage(1);
  }

  const acceptedProofs = proofPage?.items ?? [];

  return (
    <div
      className="notifications-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <aside ref={panelRef} className="notifications-panel" role="dialog" aria-modal="true" aria-labelledby="notifications-title">
        <header className="notifications-header">
          <div className="notifications-heading-icon">
            {view === "updates" ? <Bell size={20} /> : <Camera size={20} />}
          </div>
          <div>
            <span className="section-kicker">{view === "updates" ? "Quest notifications" : "Accepted archive"}</span>
            <h2 id="notifications-title">{view === "updates" ? "Updates." : "My proofs."}</h2>
          </div>
          <button ref={closeButtonRef} type="button" onClick={onClose} aria-label="Close result panel">
            <X size={19} />
          </button>
        </header>

        <div className="notifications-tabs" role="tablist" aria-label="Result views">
          <button
            type="button"
            role="tab"
            aria-selected={view === "updates"}
            className={view === "updates" ? "active" : ""}
            onClick={() => setView("updates")}
          >
            Notifications
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view === "proofs"}
            className={view === "proofs" ? "active" : ""}
            onClick={showProofs}
          >
            Accepted proofs
          </button>
        </div>

        {view === "updates" ? (
          <div className="notifications-content" role="tabpanel">
            {recentItems.length === 0 ? (
              <div className="notifications-empty">
                <Bell size={28} />
                <strong>No quest updates yet</strong>
                <span>Your proof results will appear here.</span>
              </div>
            ) : (
              <div className="notification-list">
                {recentItems.map((submission) => {
                  const status = resultStatus(submission);
                  return (
                    <article className="notification-item" key={`${submission.id}-${submission.status}`}>
                      <div className={`notification-status ${status.className}`}><status.Icon size={19} /></div>
                      <div className="notification-copy">
                        <strong>{submission.questTitle}</strong>
                        <span>{status.label}. {status.detail}</span>
                      </div>
                      <time dateTime={submission.verifiedAt ?? submission.createdAt}>{resultDate(submission)}</time>
                    </article>
                  );
                })}
              </div>
            )}
            <button className="notifications-view-all" type="button" onClick={showProofs}>
              <History size={17} /> View accepted proofs <ChevronRight size={17} />
            </button>
          </div>
        ) : (
          <div className="notifications-content results-archive" role="tabpanel">
            {loadingPage && !proofPage ? (
              <div className="notifications-empty"><LoaderCircle className="spin" size={28} /><strong>Loading proofs</strong></div>
            ) : pageError ? (
              <div className="notifications-empty">
                <XCircle size={28} />
                <strong>Couldn’t load accepted proofs</strong>
                <span>{pageError}</span>
                <button type="button" onClick={() => void loadPage(proofPage?.page ?? 1)}>Try again</button>
              </div>
            ) : acceptedProofs.length === 0 ? (
              <div className="notifications-empty">
                <CheckCircle2 size={28} />
                <strong>No accepted proofs yet</strong>
                <span>Accepted quest results will be saved here.</span>
              </div>
            ) : (
              <div className="archive-list" aria-busy={loadingPage}>
                {acceptedProofs.map((submission) => (
                  <article className="archive-item" key={submission.id}>
                    <div className="notification-status accepted"><CheckCircle2 size={18} /></div>
                    <div className="notification-copy">
                      <strong>{submission.questTitle}</strong>
                      <span>+{submission.xp} XP earned</span>
                    </div>
                    <time dateTime={submission.verifiedAt ?? submission.createdAt}>{resultDate(submission)}</time>
                    <button
                      className="archive-share"
                      type="button"
                      onClick={() => onShare(submission)}
                      aria-label={`Share ${submission.questTitle} proof`}
                    >
                      <Share2 size={16} />
                      <span>Share</span>
                    </button>
                  </article>
                ))}
              </div>
            )}

            {proofPage ? (
              <footer className="archive-pagination">
                <button
                  type="button"
                  disabled={proofPage.page <= 1 || loadingPage}
                  onClick={() => void loadPage(proofPage.page - 1)}
                  aria-label="Previous accepted proofs page"
                >
                  <ChevronLeft size={17} />
                </button>
                <span>Page {proofPage.page} of {proofPage.totalPages} · {proofPage.total} accepted proofs</span>
                <button
                  type="button"
                  disabled={proofPage.page >= proofPage.totalPages || loadingPage}
                  onClick={() => void loadPage(proofPage.page + 1)}
                  aria-label="Next accepted proofs page"
                >
                  <ChevronRight size={17} />
                </button>
              </footer>
            ) : null}
          </div>
        )}
      </aside>
    </div>
  );
}
