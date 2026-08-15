import { ArrowUpRight, Check, Clock3, LoaderCircle, Sparkles } from "lucide-react";
import { iconFor } from "../quest-icons";
import type { QuestAssignment } from "../types";

interface QuestCardProps {
  assignment: QuestAssignment;
  index: number;
  starting: boolean;
  onStart: (assignment: QuestAssignment) => void;
}

export default function QuestCard({ assignment, index, starting, onStart }: QuestCardProps) {
  const { quest, status } = assignment;
  const Icon = iconFor(quest.icon);
  const completed = status === "completed";
  const verifying = status === "verifying";

  return (
    <article
      className={`quest-card accent-${quest.accent} ${completed ? "is-complete" : ""}`}
      style={{ "--quest-delay": `${index * 70}ms` } as React.CSSProperties}
    >
      <div className="quest-card-topline">
        <span className="quest-number">0{index + 1}</span>
        <span className="quest-category">{quest.category}</span>
        <span className="quest-xp"><Sparkles size={13} /> {quest.xp} XP</span>
      </div>

      <div className="quest-illustration" aria-hidden="true">
        <span className="quest-orbit quest-orbit-one" />
        <span className="quest-orbit quest-orbit-two" />
        <Icon strokeWidth={1.55} />
      </div>

      <div className="quest-copy">
        <p className="quest-difficulty">{quest.difficulty} quest</p>
        <h3>{quest.title}</h3>
        <p>{quest.prompt}</p>
      </div>

      <button
        className="quest-action"
        type="button"
        disabled={completed || verifying || starting}
        onClick={() => onStart(assignment)}
        aria-label={`${completed ? "Completed" : "Start"} ${quest.title}`}
      >
        {completed ? (
          <><Check size={18} /> Completed</>
        ) : verifying ? (
          <><LoaderCircle className="spin" size={18} /> Checking proof</>
        ) : starting ? (
          <><LoaderCircle className="spin" size={18} /> Opening camera</>
        ) : (
          <><Clock3 size={17} /> Start quest <ArrowUpRight size={18} /></>
        )}
      </button>
    </article>
  );
}
