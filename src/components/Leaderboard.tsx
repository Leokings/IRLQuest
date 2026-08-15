import { Flame, Trophy } from "lucide-react";
import { rankForXp } from "../ranks";
import type { LeaderboardEntry } from "../types";

export default function Leaderboard({
  entries,
  currentUserId,
}: {
  entries: LeaderboardEntry[];
  currentUserId: string;
}) {
  return (
    <section className="social-panel leaderboard-panel" id="leaderboard">
      <div className="social-panel-heading">
        <div>
          <span className="section-kicker">Explorer board</span>
          <h2>Leaderboard.</h2>
        </div>
        <Trophy size={22} />
      </div>
      <div className="leaderboard-list">
        {entries.map((entry) => (
          <article
            className={`leaderboard-row ${entry.userId === currentUserId ? "is-current" : ""}`}
            key={entry.userId}
          >
            <strong className="leader-rank">{String(entry.rank).padStart(2, "0")}</strong>
            <div className="leader-avatar">{entry.avatarInitials}</div>
            <div className="leader-copy">
              <strong>{entry.displayName}</strong>
              <span>@{entry.handle} · {rankForXp(entry.totalXp).title}</span>
            </div>
            <span className="leader-streak"><Flame size={14} /> {entry.currentStreak}</span>
            <strong className="leader-xp">{entry.totalXp.toLocaleString()} XP</strong>
          </article>
        ))}
      </div>
    </section>
  );
}
