import { useCallback, useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import {
  ArrowRight,
  Bell,
  Camera,
  Check,
  CircleUserRound,
  Flame,
  Home,
  LoaderCircle,
  LockKeyhole,
  LogOut,
  Rabbit,
  ShieldCheck,
  Sparkles,
  Trophy,
  UserRound,
  X,
  Zap,
} from "lucide-react";
import { createProofSession, loadBootstrap, updateProfileHandle } from "./api";
import CaptureSheet from "./components/CaptureSheet";
import ExplorerProfile from "./components/ExplorerProfile";
import Leaderboard from "./components/Leaderboard";
import NotificationsPanel, { type NotificationPanelView } from "./components/NotificationsPanel";
import QuestCard from "./components/QuestCard";
import { iconFor } from "./quest-icons";
import { rankForXp } from "./ranks";
import { isSupabaseConfigured, supabase } from "./supabase";
import type { BootstrapData, ProofSession, QuestAssignment, Submission } from "./types";

async function makeResultCard(submission: Submission, explorer: BootstrapData["user"]) {
  const canvas = document.createElement("canvas");
  canvas.width = 1200;
  canvas.height = 630;
  const context = canvas.getContext("2d");
  if (!context) return null;

  context.fillStyle = "#f7f4ec";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#c9ff4a";
  context.fillRect(0, 0, 42, canvas.height);
  context.fillStyle = "#171a16";
  context.font = "700 34px system-ui, sans-serif";
  context.fillText("IRLQUEST", 92, 90);
  context.font = "800 70px system-ui, sans-serif";
  context.fillText("QUEST CLEARED.", 92, 210);
  context.font = "700 46px system-ui, sans-serif";
  context.fillText(submission.questTitle.slice(0, 34), 92, 300);
  context.fillStyle = "#6c7168";
  context.font = "500 28px system-ui, sans-serif";
  context.fillText(`@${explorer.handle} · ${rankForXp(explorer.totalXp).title} · Level ${explorer.level}`, 92, 365);
  context.fillStyle = "#171a16";
  context.font = "800 54px system-ui, sans-serif";
  context.fillText(`+${submission.xp} XP`, 92, 480);
  context.fillStyle = "#6c7168";
  context.font = "500 24px system-ui, sans-serif";
  context.fillText("Small adventures. Real proof.", 92, 550);

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  return blob ? new File([blob], "irlquest-result.png", { type: "image/png" }) : null;
}

function greetingForHour(hour: number) {
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function formatReset(milliseconds: number) {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  return `${hours}h ${String(minutes).padStart(2, "0")}m`;
}

function millisecondsToMidnight() {
  const now = new Date();
  const midnight = new Date(now);
  midnight.setHours(24, 0, 0, 0);
  return midnight.getTime() - now.getTime();
}

const NOTIFICATION_STATE_VERSION = 1;

function notificationStorageKey(userId: string) {
  return `irlquest:notifications:v${NOTIFICATION_STATE_VERSION}:${userId}`;
}

function readNotificationSeenAt(userId: string) {
  try {
    const raw = window.localStorage.getItem(notificationStorageKey(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { version?: number; seenAt?: string };
    if (parsed.version !== NOTIFICATION_STATE_VERSION || typeof parsed.seenAt !== "string") return null;
    return Number.isNaN(new Date(parsed.seenAt).getTime()) ? null : parsed.seenAt;
  } catch {
    return null;
  }
}

function writeNotificationSeenAt(userId: string, seenAt: string) {
  try {
    window.localStorage.setItem(
      notificationStorageKey(userId),
      JSON.stringify({ version: NOTIFICATION_STATE_VERSION, seenAt }),
    );
  } catch {
    // Reading results still works when browser storage is unavailable.
  }
}

function submissionEventTime(submission: Submission) {
  return new Date(submission.verifiedAt ?? submission.createdAt).getTime();
}

function relativeDate(isoDate: string) {
  const delta = Date.now() - new Date(isoDate).getTime();
  const hours = Math.floor(delta / 3_600_000);
  if (hours < 1) return "just now";
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

const WEEK_DAYS = [
  { short: "M", long: "Monday" },
  { short: "T", long: "Tuesday" },
  { short: "W", long: "Wednesday" },
  { short: "T", long: "Thursday" },
  { short: "F", long: "Friday" },
  { short: "S", long: "Saturday" },
  { short: "S", long: "Sunday" },
] as const;

function addCalendarDays(day: string, amount: number) {
  const date = new Date(`${day}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function weeklyRhythmDays(day: string, completedDays: BootstrapData["weeklyGoal"]["completedDays"]) {
  const date = new Date(`${day}T12:00:00.000Z`);
  const weekday = date.getUTCDay() || 7;
  const weekStart = addCalendarDays(day, -weekday + 1);
  const completionCounts = new Map(completedDays.map((item) => [item.date, item.count]));
  return WEEK_DAYS.map((label, index) => {
    const calendarDate = addCalendarDays(weekStart, index);
    return { ...label, date: calendarDate, count: completionCounts.get(calendarDate) ?? 0 };
  });
}

function BrandMark() {
  return (
    <div className="brand-mark" aria-hidden="true">
      <span>Q</span>
      <Zap size={13} fill="currentColor" />
    </div>
  );
}

function LoadingView() {
  return (
    <div className="loading-view">
      <BrandMark />
      <span className="loading-line" />
      <p>Loading today’s quests…</p>
    </div>
  );
}

function AuthView({
  error,
  signingIn,
  onSignIn,
}: {
  error: string | null;
  signingIn: boolean;
  onSignIn: () => void;
}) {
  return (
    <main className="auth-view">
      <section className="auth-panel">
        <a className="auth-brand" href="/" aria-label="IRLQuest home">
          <BrandMark />
          <span>IRL<strong>QUEST</strong></span>
        </a>
        <div className="auth-kicker"><Sparkles size={15} /> Small adventures. Real proof.</div>
        <h1>Make the real world your next quest.</h1>
        <p>Sign in to get a fresh daily drop, capture time-limited proof, and keep every piece of evidence private.</p>
        <button className="google-button" type="button" onClick={onSignIn} disabled={signingIn}>
          {signingIn ? <LoaderCircle className="spin" size={20} /> : <span className="google-mark" aria-hidden="true">G</span>}
          {signingIn ? "Opening Google…" : "Continue with Google"}
        </button>
        {error && <p className="auth-error" role="alert">{error}</p>}
        <div className="auth-trust">
          <span><LockKeyhole size={15} /> Private evidence</span>
          <span><ShieldCheck size={15} /> Verifiable outcomes</span>
        </div>
      </section>
      <aside className="auth-art" aria-hidden="true">
        <div className="auth-grid" />
        <span className="auth-orbit orbit-one" />
        <span className="auth-orbit orbit-two" />
        <div className="auth-stamp"><Zap size={34} fill="currentColor" /><strong>GO<br />IRL.</strong></div>
        <p>YOUR CITY<br />ISN’T THE GAME.<br /><em>YOUR DAY IS.</em></p>
      </aside>
    </main>
  );
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(!isSupabaseConfigured);
  const [authError, setAuthError] = useState<string | null>(null);
  const [signingIn, setSigningIn] = useState(false);
  const [data, setData] = useState<BootstrapData | null>(null);
  const [loadingError, setLoadingError] = useState<string | null>(null);
  const [startingId, setStartingId] = useState<string | null>(null);
  const [capture, setCapture] = useState<{ assignment: QuestAssignment; session: ProofSession } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [notificationPanelView, setNotificationPanelView] = useState<NotificationPanelView | null>(null);
  const [notificationReadState, setNotificationReadState] = useState<{ userId: string; seenAt: string | null } | null>(null);
  const [resetIn, setResetIn] = useState(millisecondsToMidnight());
  const now = useMemo(() => new Date(), []);
  const closeNotificationPanel = useCallback(() => setNotificationPanelView(null), []);

  const reload = useCallback(async () => {
    if (isSupabaseConfigured && !session) return;
    try {
      const next = await loadBootstrap();
      setData(next);
      setLoadingError(null);
    } catch (error) {
      setLoadingError(error instanceof Error ? error.message : "IRLQuest could not load.");
    }
  }, [session]);

  useEffect(() => {
    if (!supabase) return;
    let active = true;
    void supabase.auth.getSession().then(({ data: authData, error }) => {
      if (!active) return;
      setSession(authData.session);
      setAuthError(error?.message ?? null);
      setAuthReady(true);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!active) return;
      setSession(nextSession);
      setAuthReady(true);
      if (!nextSession) {
        setData(null);
        setCapture(null);
        setNotificationPanelView(null);
      }
    });
    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!authReady || (isSupabaseConfigured && !session)) return;
    void reload();
  }, [authReady, reload, session]);

  useEffect(() => {
    const timer = window.setInterval(() => setResetIn(millisecondsToMidnight()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!data?.dailyQuests.some((item) => item.status === "verifying") && data?.weeklyQuest?.status !== "verifying") return;
    const timer = window.setInterval(() => void reload(), 1800);
    return () => window.clearInterval(timer);
  }, [data, reload]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 3200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!data?.user.id) {
      setNotificationReadState(null);
      return;
    }
    setNotificationReadState({
      userId: data.user.id,
      seenAt: readNotificationSeenAt(data.user.id),
    });
  }, [data?.user.id]);

  async function startQuest(assignment: QuestAssignment) {
    setStartingId(assignment.assignmentId);
    try {
      const session = await createProofSession(assignment.assignmentId);
      setCapture({ assignment, session });
    } catch (error) {
      setToast(error instanceof Error ? error.message : "The camera quest could not start.");
      await reload();
    } finally {
      setStartingId(null);
    }
  }

  async function handleVerified(submission: Submission) {
    if (submission.status === "accepted") setToast(`Quest cleared. +${submission.xp} XP!`);
    await reload();
  }

  function closeCapture() {
    setCapture(null);
    void reload();
  }

  async function changeProfileHandle(handle: string) {
    const updatedHandle = await updateProfileHandle(data!.user.id, handle);
    await reload();
    setToast(`Username changed to @${updatedHandle}.`);
    return updatedHandle;
  }

  async function signInWithGoogle() {
    if (!supabase) return;
    setSigningIn(true);
    setAuthError(null);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/`,
        queryParams: { prompt: "select_account" },
      },
    });
    if (error) {
      setAuthError(error.message);
      setSigningIn(false);
    }
  }

  async function signOut() {
    if (!supabase) return;
    const { error } = await supabase.auth.signOut();
    if (error) setToast(error.message);
  }

  async function shareResult(submission: Submission) {
    const text = `I cleared “${submission.questTitle}” on IRLQuest and earned ${submission.xp} XP.`;
    try {
      const card = await makeResultCard(submission, data!.user);
      const shareData: ShareData = {
        title: "IRLQuest result",
        text,
        url: window.location.origin,
      };
      if (card && navigator.canShare?.({ files: [card] })) shareData.files = [card];
      if (navigator.share) {
        await navigator.share(shareData);
        setToast("Result shared.");
        return;
      }
      await navigator.clipboard.writeText(`${text} ${window.location.origin}`);
      setToast("Result copied to share.");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setToast("Couldn’t share that result.");
    }
  }

  function openNotificationPanel(view: NotificationPanelView) {
    if (!data) return;
    const seenAt = new Date().toISOString();
    writeNotificationSeenAt(data.user.id, seenAt);
    setNotificationReadState({ userId: data.user.id, seenAt });
    setNotificationPanelView(view);
  }

  if (isSupabaseConfigured && !authReady) return <LoadingView />;
  if (isSupabaseConfigured && !session) {
    return <AuthView error={authError} signingIn={signingIn} onSignIn={() => void signInWithGoogle()} />;
  }
  if (!data && !loadingError) return <LoadingView />;
  if (!data) {
    return (
      <div className="error-view">
        <BrandMark />
        <h1>Couldn’t reach base camp.</h1>
        <p>{loadingError}</p>
        <button className="primary-button" type="button" onClick={() => void reload()}>Try again</button>
      </div>
    );
  }

  const completedToday = data.dailyQuests.filter((item) => item.status === "completed").length;
  const WeeklyIcon = data.weeklyQuest ? iconFor(data.weeklyQuest.quest.icon) : Rabbit;
  const userRank = rankForXp(data.user.totalXp);
  const notificationStateReady = notificationReadState?.userId === data.user.id;
  const notificationSeenAt = notificationStateReady && notificationReadState.seenAt
    ? new Date(notificationReadState.seenAt).getTime()
    : Number.NEGATIVE_INFINITY;
  const unreadCount = notificationStateReady
    ? data.proofHistory.filter((submission) => submissionEventTime(submission) > notificationSeenAt).length
    : 0;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#today" aria-label="IRLQuest home">
          <BrandMark />
          <span>IRL<span>QUEST</span></span>
        </a>

        <nav className="side-nav" aria-label="Primary navigation">
          <p>Explore</p>
          <a className="active" href="#today"><Home size={19} /> Today <span>{data.dailyQuests.length}</span></a>
          <button type="button" onClick={() => openNotificationPanel("proofs")}><Camera size={19} /> My proofs</button>
          <p>Social</p>
          <a href="#leaderboard"><Trophy size={19} /> Leaderboard</a>
          <a href="#profile"><CircleUserRound size={19} /> Profile</a>
        </nav>

        <div className="sidebar-spacer" />
        <div className="sidebar-profile">
          <div className="avatar">{data.user.avatarInitials}<span /></div>
          <span><strong>{data.user.displayName}</strong><small>@{data.user.handle}</small></span>
          {isSupabaseConfigured && (
            <button className="sidebar-sign-out" type="button" onClick={() => void signOut()} aria-label="Sign out">
              <LogOut size={17} />
            </button>
          )}
        </div>
      </aside>

      <main className="main-content" id="today">
        <header className="topbar">
          <div className="mobile-brand"><BrandMark /><strong>IRLQUEST</strong></div>
          <div className="topbar-context">
            <span>{greetingForHour(now.getHours())}, {data.user.displayName.split(" ")[0]}</span>
            <strong>{now.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}</strong>
          </div>
          <div className="topbar-actions">
            <button
              className="notification-button"
              type="button"
              onClick={() => openNotificationPanel("updates")}
              aria-label={unreadCount > 0 ? `Open updates, ${unreadCount} unread` : "Open updates"}
            >
              <Bell size={19} />
              {unreadCount > 0 ? <span>{unreadCount > 9 ? "9+" : unreadCount}</span> : null}
            </button>
            <div className="xp-pill"><Sparkles size={15} /> <strong>{data.user.totalXp.toLocaleString()}</strong><span>XP</span></div>
            <a className="topbar-avatar" href="#profile" aria-label="Open profile">{data.user.avatarInitials}</a>
          </div>
        </header>

        <div className="content-wrap">
          <section className="hero-panel">
            <div className="hero-grid" aria-hidden="true" />
            <div className="hero-scribble" aria-hidden="true">↗</div>
            <div className="hero-copy">
              <div className="eyebrow"><span /> Daily drop · {data.dailyQuests.length - completedToday} quests left</div>
              <h1>MAKE TODAY<br /><em>COUNT.</em></h1>
              <p>Small adventures. Real-world proof.<br />A better story by midnight.</p>
              <a href="#daily-quests" className="hero-action">See today’s quests <ArrowRight size={18} /></a>
            </div>
            <div className="hero-stat-card hero-level-card">
              <span>{userRank.title} rank</span>
              <strong>{String(data.user.level).padStart(2, "0")}</strong>
              <div className="level-track"><span style={{ width: `${data.user.progress}%` }} /></div>
              <small>{data.user.currentLevelXp} / {data.user.nextLevelXp} XP to level {data.user.level + 1}</small>
            </div>
            <div className="hero-stat-card hero-streak-card">
              <Flame size={25} fill="currentColor" />
              <span>Current streak</span>
              <strong>{data.user.currentStreak}<small>days</small></strong>
              <p>Personal best · {data.user.longestStreak}</p>
            </div>
          </section>

          <section className="section-block" id="daily-quests">
            <div className="section-heading">
              <div>
                <span className="section-kicker">Your daily three</span>
                <h2>Pick your next move.</h2>
              </div>
              <div className="reset-clock"><span>New drop in</span><strong>{formatReset(resetIn)}</strong></div>
            </div>
            <div className="quest-grid">
              {data.dailyQuests.map((assignment, index) => (
                <QuestCard
                  key={assignment.assignmentId}
                  assignment={assignment}
                  index={index}
                  starting={startingId === assignment.assignmentId}
                  onStart={(item) => void startQuest(item)}
                />
              ))}
            </div>
          </section>

          <section className="dashboard-grid">
            {data.weeklyQuest && (
              <article className="weekly-card">
                <div className="weekly-art" aria-hidden="true">
                  <span className="weekly-moon" />
                  <span className="weekly-floor" />
                  <WeeklyIcon size={130} strokeWidth={1.1} />
                  <span className="weekly-star star-one">✦</span>
                  <span className="weekly-star star-two">✧</span>
                </div>
                <div className="weekly-content">
                  <span className="weekly-label"><Trophy size={14} /> Weekly boss quest</span>
                  <h2>{data.weeklyQuest.quest.title}</h2>
                  <p>{data.weeklyQuest.quest.description}</p>
                  <div className="weekly-meta">
                    <span><Sparkles size={15} /> {data.weeklyQuest.quest.xp} XP</span>
                    <span>{data.weeklyQuest.quest.difficulty}</span>
                  </div>
                  <button
                    className="weekly-button"
                    type="button"
                    disabled={data.weeklyQuest.status === "completed" || data.weeklyQuest.status === "verifying" || startingId === data.weeklyQuest.assignmentId}
                    onClick={() => void startQuest(data.weeklyQuest!)}
                  >
                    {data.weeklyQuest.status === "completed" ? <><Check size={18} /> Quest cleared</> :
                      data.weeklyQuest.status === "verifying" ? <><LoaderCircle className="spin" size={18} /> Checking proof</> :
                        startingId === data.weeklyQuest.assignmentId ? <><LoaderCircle className="spin" size={18} /> Opening camera</> :
                          <>Accept the challenge <ArrowRight size={18} /></>}
                  </button>
                </div>
              </article>
            )}

            <div className="side-widgets">
              <article className="goal-card">
                <div className="widget-heading"><span>Weekly rhythm</span><Flame size={20} /></div>
                <div className="goal-number"><strong>{data.weeklyGoal.completed}</strong><span>/ {data.weeklyGoal.target} quests</span></div>
                <div className="goal-track"><span style={{ width: `${Math.min(100, (data.weeklyGoal.completed / data.weeklyGoal.target) * 100)}%` }} /></div>
                <div className="week-dots">
                  {weeklyRhythmDays(data.date, data.weeklyGoal.completedDays).map((day) => {
                    const isToday = day.date === data.date;
                    const className = [day.count > 0 ? "done" : "", isToday ? "today" : ""]
                      .filter(Boolean)
                      .join(" ");
                    const completionLabel = `${day.count} quest${day.count === 1 ? "" : "s"} completed`;
                    return (
                      <span
                        key={day.date}
                        className={className}
                        aria-label={`${day.long}${isToday ? ", today" : ""}: ${completionLabel}`}
                        title={`${day.long}: ${completionLabel}`}
                      >
                        <i aria-hidden="true">
                          {day.count > 1 ? <b>{day.count}</b> : day.count === 1 ? <Check size={12} /> : null}
                        </i>
                        {day.short}
                      </span>
                    );
                  })}
                </div>
              </article>

              <article className="activity-card">
                <div className="widget-heading"><span>Recent snaps</span></div>
                <div className="activity-list">
                  {data.activity.slice(0, 3).map((item) => {
                    const ActivityIcon = iconFor(item.icon);
                    return (
                      <div className="activity-item" key={item.id}>
                        <div className={`activity-icon accent-${item.accent || "lime"}`}><ActivityIcon size={18} /></div>
                        <span><strong>{item.questTitle || "Explorer bonus"}</strong><small>{relativeDate(item.createdAt)}</small></span>
                        <em>+{item.amount}</em>
                      </div>
                    );
                  })}
                </div>
              </article>
            </div>
          </section>

          <section className="social-grid" aria-label="Explorer community">
            <ExplorerProfile
              explorer={data.user}
              onUpdateHandle={changeProfileHandle}
              onSignOut={isSupabaseConfigured ? () => void signOut() : undefined}
            />
            <Leaderboard entries={data.leaderboard} currentUserId={data.user.id} />
          </section>

          <footer className="app-footer">
            <span><LockKeyhole size={15} /> Evidence stays private by default</span>
            <span>IRLQuest</span>
          </footer>
        </div>
      </main>

      <nav className="mobile-nav" aria-label="Mobile navigation">
        <a href="#today" className="active"><Home size={20} /><span>Today</span></a>
        <button type="button" onClick={() => openNotificationPanel("proofs")}><Camera size={20} /><span>Proofs</span></button>
        <button
          type="button"
          className="mobile-capture-button"
          aria-label="Start the first available quest"
          onClick={() => data.dailyQuests.find((item) => item.status === "pending") && void startQuest(data.dailyQuests.find((item) => item.status === "pending")!)}
        ><Camera size={24} /></button>
        <a href="#leaderboard"><Trophy size={20} /><span>Leaders</span></a>
        <a href="#profile"><UserRound size={20} /><span>Profile</span></a>
      </nav>

      {capture && (
        <CaptureSheet
          assignment={capture.assignment}
          session={capture.session}
          onClose={closeCapture}
          onVerified={(submission) => void handleVerified(submission)}
        />
      )}

      {notificationPanelView && (
        <NotificationsPanel
          initialView={notificationPanelView}
          recentItems={data.proofHistory}
          onClose={closeNotificationPanel}
          onShare={(submission) => void shareResult(submission)}
        />
      )}

      {toast && (
        <div className="toast" role="status">
          <Sparkles size={17} /> <span>{toast}</span>
          <button type="button" onClick={() => setToast(null)} aria-label="Dismiss"><X size={16} /></button>
        </div>
      )}
    </div>
  );
}
