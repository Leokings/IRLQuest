export type AssignmentStatus = "pending" | "verifying" | "completed" | "rejected" | "review";

export interface Quest {
  id: string;
  versionId: string;
  version: number;
  slug: string;
  title: string;
  prompt: string;
  description: string;
  category: string;
  difficulty: string;
  xp: number;
  icon: string;
  accent: string;
  captureTip: string;
  rules: string[];
}

export interface QuestAssignment {
  assignmentId: string;
  assignedDate: string;
  status: AssignmentStatus;
  submissionId: string | null;
  quest: Quest;
}

export interface Explorer {
  id: string;
  displayName: string;
  handle: string;
  avatarInitials: string;
  totalXp: number;
  currentStreak: number;
  longestStreak: number;
  completedQuests: number;
  rank: number | null;
  level: number;
  currentLevelXp: number;
  nextLevelXp: number;
  progress: number;
}

export interface ActivityItem {
  id: string;
  amount: number;
  reason: string;
  createdAt: string;
  questTitle: string | null;
  icon: string | null;
  accent: string | null;
}

export interface LeaderboardEntry {
  rank: number;
  userId: string;
  displayName: string;
  handle: string;
  avatarInitials: string;
  totalXp: number;
  currentStreak: number;
  longestStreak: number;
  completedQuests: number;
}

export interface BootstrapData {
  date: string;
  verifierMode: "local" | "genlayer";
  genLayerContractAddress: string | null;
  user: Explorer;
  dailyQuests: QuestAssignment[];
  weeklyQuest: QuestAssignment | null;
  activity: ActivityItem[];
  proofHistory: Submission[];
  leaderboard: LeaderboardEntry[];
  weeklyGoal: {
    completed: number;
    target: number;
    completedDays: Array<{
      date: string;
      count: number;
    }>;
  };
}

export interface ProofSession {
  id: string;
  assignmentId: string;
  challenge: string;
  expiresAt: string;
  sessionCode: string;
}

export interface VerificationVerdict {
  verdict: "PASS" | "FAIL" | "REVIEW";
  questSatisfied: boolean;
  challengeSatisfied: boolean;
  evidenceClear: boolean;
  safe: boolean;
  reasonCode: string;
  summary: string;
  verifier: string;
}

export interface Submission {
  id: string;
  assignmentId: string;
  questTitle: string;
  xp: number;
  status: "pending" | "accepted" | "rejected" | "review";
  verdict: VerificationVerdict | null;
  transactionHash: string | null;
  createdAt: string;
  verifiedAt: string | null;
}

export interface SubmissionPage {
  items: Submission[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}
