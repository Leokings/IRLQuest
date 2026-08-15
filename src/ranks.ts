export const XP_RANKS = [
  { title: "Explorer", minimumXp: 0 },
  { title: "Adventurer", minimumXp: 500 },
  { title: "Trailblazer", minimumXp: 1_500 },
  { title: "Pathfinder", minimumXp: 3_500 },
  { title: "Voyager", minimumXp: 7_500 },
  { title: "Vanguard", minimumXp: 15_000 },
  { title: "Legend", minimumXp: 25_000 },
] as const;

export type XpRankTitle = (typeof XP_RANKS)[number]["title"];

export function rankForXp(totalXp: number) {
  const safeXp = Math.max(0, totalXp);
  let rank: (typeof XP_RANKS)[number] = XP_RANKS[0];
  for (const candidate of XP_RANKS) {
    if (safeXp < candidate.minimumXp) break;
    rank = candidate;
  }
  const rankIndex = XP_RANKS.indexOf(rank);
  const nextRank = XP_RANKS[rankIndex + 1] ?? null;
  return {
    ...rank,
    nextRank,
    xpToNextRank: nextRank ? nextRank.minimumXp - safeXp : 0,
  };
}
