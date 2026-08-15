import { useState } from "react";
import type { FormEvent } from "react";
import { Check, Flame, LoaderCircle, LogOut, Pencil, Sparkles, Target, Trophy, X } from "lucide-react";
import { rankForXp } from "../ranks";
import type { Explorer } from "../types";

export default function ExplorerProfile({
  explorer,
  onUpdateHandle,
  onSignOut,
}: {
  explorer: Explorer;
  onUpdateHandle: (handle: string) => Promise<string>;
  onSignOut?: () => void;
}) {
  const [editingHandle, setEditingHandle] = useState(false);
  const [handleDraft, setHandleDraft] = useState(explorer.handle);
  const [handleError, setHandleError] = useState<string | null>(null);
  const [savingHandle, setSavingHandle] = useState(false);
  const xpRank = rankForXp(explorer.totalXp);

  function startEditingHandle() {
    setHandleDraft(explorer.handle);
    setHandleError(null);
    setEditingHandle(true);
  }

  function cancelEditingHandle() {
    setHandleDraft(explorer.handle);
    setHandleError(null);
    setEditingHandle(false);
  }

  async function submitHandle(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setHandleError(null);
    setSavingHandle(true);
    try {
      const updatedHandle = await onUpdateHandle(handleDraft);
      setHandleDraft(updatedHandle);
      setEditingHandle(false);
    } catch (error) {
      setHandleError(error instanceof Error ? error.message : "The username could not be changed.");
    } finally {
      setSavingHandle(false);
    }
  }

  return (
    <section className="social-panel profile-panel" id="profile">
      <div className="profile-identity">
        <div className="profile-avatar">{explorer.avatarInitials}</div>
        <div className="profile-copy">
          <span className="section-kicker">Explorer profile</span>
          <h2>{explorer.displayName}</h2>
          {editingHandle ? (
            <form className="profile-handle-form" onSubmit={(event) => void submitHandle(event)}>
              <label className="sr-only" htmlFor={`profile-handle-${explorer.id}`}>Username</label>
              <span aria-hidden="true">@</span>
              <input
                id={`profile-handle-${explorer.id}`}
                value={handleDraft}
                onChange={(event) => setHandleDraft(event.target.value)}
                minLength={3}
                maxLength={31}
                autoCapitalize="none"
                autoComplete="username"
                spellCheck={false}
                disabled={savingHandle}
                autoFocus
              />
              <button type="submit" disabled={savingHandle} aria-label="Save username">
                {savingHandle ? <LoaderCircle className="spin" size={15} /> : <Check size={15} />}
              </button>
              <button type="button" disabled={savingHandle} onClick={cancelEditingHandle} aria-label="Cancel username change">
                <X size={15} />
              </button>
              {handleError ? <small role="alert">{handleError}</small> : null}
            </form>
          ) : (
            <div className="profile-handle-row">
              <p>@{explorer.handle}</p>
              <button type="button" onClick={startEditingHandle} aria-label="Edit username">
                <Pencil size={13} /> Edit
              </button>
            </div>
          )}
        </div>
        <span className="profile-level" title={`Level ${explorer.level}`}>
          {xpRank.title} · L{explorer.level}
        </span>
        {onSignOut ? (
          <button className="profile-sign-out" type="button" onClick={onSignOut}>
            <LogOut size={16} /> Sign out
          </button>
        ) : null}
      </div>
      <div className="profile-stats">
        <div><Sparkles size={18} /><strong>{explorer.totalXp.toLocaleString()}</strong><span>Total XP</span></div>
        <div><Flame size={18} /><strong>{explorer.currentStreak}</strong><span>Day streak</span></div>
        <div><Target size={18} /><strong>{explorer.completedQuests}</strong><span>Quests cleared</span></div>
        <div><Trophy size={18} /><strong>{explorer.rank ? `#${explorer.rank}` : "—"}</strong><span>Global rank</span></div>
      </div>
      <div className="profile-progress">
        <span style={{ width: `${explorer.progress}%` }} />
      </div>
      <div className="profile-progression-copy">
        <small>{explorer.currentLevelXp} / {explorer.nextLevelXp} XP toward level {explorer.level + 1}</small>
        <small>
          {xpRank.nextRank
            ? `${xpRank.xpToNextRank.toLocaleString()} XP to ${xpRank.nextRank.title}`
            : "Highest title reached"}
        </small>
      </div>
    </section>
  );
}
