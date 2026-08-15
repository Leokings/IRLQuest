import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

const QUESTS = [
  {
    id: "quest_cup_find",
    slug: "cup-find",
    title: "Cup find",
    prompt: "Find a cup or mug.",
    description: "Photograph one clearly recognizable cup or mug.",
    category: "everyday",
    difficulty: "easy",
    xp: 50,
    icon: "CupSoda",
    accent: "coral",
    captureTip: "Place it down so the whole cup is easy to see.",
    rules: ["One clearly recognizable cup or mug is visible."],
  },
  {
    id: "quest_pen_find",
    slug: "pen-find",
    title: "Pen find",
    prompt: "Find a pen or pencil.",
    description: "Photograph one clearly recognizable pen or pencil.",
    category: "everyday",
    difficulty: "easy",
    xp: 55,
    icon: "PenLine",
    accent: "violet",
    captureTip: "Place it on a plain surface.",
    rules: ["One clearly recognizable pen or pencil is visible."],
  },
  {
    id: "quest_book_find",
    slug: "book-find",
    title: "Book find",
    prompt: "Find a book.",
    description: "Photograph one clearly recognizable book.",
    category: "everyday",
    difficulty: "easy",
    xp: 65,
    icon: "BookOpen",
    accent: "blue",
    captureTip: "An open or closed book works.",
    rules: ["One clearly recognizable book is visible."],
  },
  {
    id: "quest_bottle_find",
    slug: "bottle-find",
    title: "Bottle find",
    prompt: "Find a drink bottle.",
    description: "Photograph one clearly recognizable drink bottle.",
    category: "everyday",
    difficulty: "easy",
    xp: 60,
    icon: "Milk",
    accent: "aqua",
    captureTip: "Place the bottle upright if you can.",
    rules: ["One clearly recognizable drink bottle is visible."],
  },
  {
    id: "quest_spoon_find",
    slug: "spoon-find",
    title: "Spoon find",
    prompt: "Find a spoon.",
    description: "Photograph one clearly recognizable spoon.",
    category: "everyday",
    difficulty: "easy",
    xp: 45,
    icon: "Utensils",
    accent: "sunset",
    captureTip: "Place it on a surface with a different color.",
    rules: ["One clearly recognizable spoon is visible."],
  },
  {
    id: "quest_touch_grass",
    slug: "green-thing",
    title: "Green thing",
    prompt: "Find one green leaf or plant.",
    description: "Photograph one clearly green leaf or plant.",
    category: "wellbeing",
    difficulty: "easy",
    xp: 40,
    icon: "Sprout",
    accent: "lime",
    captureTip: "A houseplant or an outdoor plant both count.",
    rules: ["One clearly green leaf or plant is visible."],
  },
  {
    id: "quest_color_hunt",
    slug: "blue-find",
    title: "Blue find",
    prompt: "Find one blue thing.",
    description: "Photograph one everyday object that is clearly blue.",
    category: "creative",
    difficulty: "easy",
    xp: 70,
    icon: "Palette",
    accent: "blue",
    captureTip: "Make the blue object the main subject.",
    rules: ["One clearly blue everyday object is visible."],
  },
  {
    id: "quest_golden_hour",
    slug: "sky-snap",
    title: "Sky snap",
    prompt: "Point up and snap the sky.",
    description: "Take a photo with a clear patch of real sky.",
    category: "outdoors",
    difficulty: "easy",
    xp: 60,
    icon: "Sunset",
    accent: "sunset",
    captureTip: "Any daytime or evening sky works.",
    rules: ["A real outdoor sky is clearly visible."],
  },
  {
    id: "quest_found_face",
    slug: "round-thing",
    title: "Round thing",
    prompt: "Find one thing that is round.",
    description: "Photograph one everyday object that is clearly round.",
    category: "creative",
    difficulty: "easy",
    xp: 80,
    icon: "ScanFace",
    accent: "violet",
    captureTip: "Keep the round object easy to see.",
    rules: ["One everyday object with a clearly round shape is visible."],
  },
  {
    id: "quest_tiny_wonder",
    slug: "close-up",
    title: "Close-up",
    prompt: "Take a closer look.",
    description: "Photograph one small everyday object up close.",
    category: "creative",
    difficulty: "easy",
    xp: 75,
    icon: "Sparkles",
    accent: "aqua",
    captureTip: "Keep the object centered and in focus.",
    rules: ["One small everyday object is clearly visible in a close-up photo."],
  },
  {
    id: "quest_path_view",
    slug: "path-view",
    title: "Path view",
    prompt: "Find an outdoor path.",
    description: "Photograph a real outdoor sidewalk, path, or trail.",
    category: "outdoors",
    difficulty: "easy",
    xp: 65,
    icon: "Footprints",
    accent: "lime",
    captureTip: "Keep the path easy to see and avoid showing private addresses.",
    rules: ["One real outdoor path, sidewalk, or trail is clearly visible."],
    state: "testing",
    version: 1,
  },
  {
    id: "quest_open_air_view",
    slug: "open-air-view",
    title: "Open-air view",
    prompt: "Show the sky and ground together.",
    description: "Photograph one outdoor scene with real sky and ground both visible.",
    category: "outdoors",
    difficulty: "easy",
    xp: 70,
    icon: "CloudSun",
    accent: "blue",
    captureTip: "A yard, park, or quiet street view works; no landmark is needed.",
    rules: ["A real outdoor scene clearly shows both sky and ground."],
    state: "testing",
    version: 1,
  },
  {
    id: "quest_red_find",
    slug: "red-find",
    title: "Red find",
    prompt: "Find one red thing.",
    description: "Photograph one everyday object that is clearly red.",
    category: "creative",
    difficulty: "easy",
    xp: 55,
    icon: "Palette",
    accent: "coral",
    captureTip: "Make the red object the main subject.",
    rules: ["One clearly red everyday object is visible."],
    state: "testing",
    version: 1,
  },
  {
    id: "quest_yellow_find",
    slug: "yellow-find",
    title: "Yellow find",
    prompt: "Find one yellow thing.",
    description: "Photograph one everyday object that is clearly yellow.",
    category: "creative",
    difficulty: "easy",
    xp: 55,
    icon: "Sun",
    accent: "sunset",
    captureTip: "Make the yellow object the main subject.",
    rules: ["One clearly yellow everyday object is visible."],
    state: "testing",
    version: 1,
  },
  {
    id: "quest_hand_sign",
    slug: "hand-sign",
    title: "Hand sign",
    prompt: "Follow the live hand sign.",
    description: "During capture, make the simple hand gesture shown in your live challenge.",
    category: "creative",
    difficulty: "easy",
    xp: 60,
    icon: "Hand",
    accent: "violet",
    captureTip: "Keep your hand fully visible and well lit.",
    rules: ["A clear human hand gesture is visible."],
    state: "testing",
    version: 1,
  },
];

const WEEKLY_QUEST = {
  id: "quest_wearable_find",
  slug: "wearable-find",
  title: "Wearable find",
  prompt: "Find one thing you can wear.",
  description: "Photograph one clearly recognizable wearable item.",
  category: "weekly",
  difficulty: "easy",
  xp: 250,
  icon: "Rabbit",
  accent: "ink",
  captureTip: "A shoe, hat, or shirt works.",
  rules: ["One clearly recognizable shoe, hat, shirt, or other wearable item is visible."],
};

function isoDay(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function addDays(day, amount) {
  const date = new Date(`${day}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return isoDay(date);
}

function startOfIsoWeek(day) {
  const date = new Date(`${day}T12:00:00.000Z`);
  const weekday = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() - weekday + 1);
  return isoDay(date);
}

function validTimeZone(value) {
  if (typeof value !== "string" || value.length > 64) return "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(new Date());
    return value;
  } catch {
    return "UTC";
  }
}

function dayInTimeZone(instant, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(instant));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function levelForXp(totalXp) {
  const perLevel = 250;
  const level = Math.floor(totalXp / perLevel) + 1;
  const levelFloor = (level - 1) * perLevel;
  return {
    level,
    currentLevelXp: totalXp - levelFloor,
    nextLevelXp: perLevel,
    progress: Math.min(100, Math.round(((totalXp - levelFloor) / perLevel) * 100)),
  };
}

function questFromRow(row) {
  return {
    id: row.quest_id,
    versionId: row.quest_version_id,
    version: Number(row.version || 1),
    slug: row.slug,
    title: row.title,
    prompt: row.prompt,
    description: row.description,
    category: row.category,
    difficulty: row.difficulty,
    xp: Number(row.xp),
    icon: row.icon,
    accent: row.accent,
    captureTip: row.capture_tip,
    rules: JSON.parse(row.verification_rules),
  };
}

export function createDatabase({ databasePath = ":memory:" } = {}) {
  if (databasePath !== ":memory:") mkdirSync(dirname(databasePath), { recursive: true });
  const db = new DatabaseSync(databasePath);
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      handle TEXT NOT NULL UNIQUE,
      avatar_initials TEXT NOT NULL,
      current_streak INTEGER NOT NULL DEFAULT 0,
      longest_streak INTEGER NOT NULL DEFAULT 0,
      last_completed_date TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS quests (
      id TEXT PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      prompt TEXT NOT NULL,
      description TEXT NOT NULL,
      category TEXT NOT NULL,
      difficulty TEXT NOT NULL,
      xp INTEGER NOT NULL CHECK (xp > 0),
      icon TEXT NOT NULL,
      accent TEXT NOT NULL,
      capture_tip TEXT NOT NULL,
      verification_rules TEXT NOT NULL,
      cadence TEXT NOT NULL DEFAULT 'daily',
      active INTEGER NOT NULL DEFAULT 1,
      state TEXT NOT NULL DEFAULT 'active' CHECK (state IN ('testing', 'active', 'paused'))
    );

    CREATE TABLE IF NOT EXISTS quest_versions (
      id TEXT PRIMARY KEY,
      quest_id TEXT NOT NULL REFERENCES quests(id),
      version INTEGER NOT NULL CHECK (version > 0),
      slug TEXT NOT NULL,
      title TEXT NOT NULL,
      prompt TEXT NOT NULL,
      description TEXT NOT NULL,
      category TEXT NOT NULL,
      difficulty TEXT NOT NULL,
      xp INTEGER NOT NULL CHECK (xp > 0),
      icon TEXT NOT NULL,
      accent TEXT NOT NULL,
      capture_tip TEXT NOT NULL,
      verification_rules TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(quest_id, version)
    );

    CREATE TABLE IF NOT EXISTS daily_assignments (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      quest_id TEXT NOT NULL REFERENCES quests(id),
      quest_version_id TEXT REFERENCES quest_versions(id),
      assigned_date TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      submission_id TEXT,
      UNIQUE(user_id, quest_id, assigned_date)
    );

    CREATE TABLE IF NOT EXISTS proof_sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      assignment_id TEXT NOT NULL REFERENCES daily_assignments(id),
      nonce TEXT NOT NULL UNIQUE,
      challenge TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      used_at TEXT
    );

    CREATE TABLE IF NOT EXISTS submissions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      assignment_id TEXT NOT NULL REFERENCES daily_assignments(id),
      proof_session_id TEXT NOT NULL REFERENCES proof_sessions(id),
      evidence_path TEXT NOT NULL,
      evidence_mime TEXT NOT NULL,
      evidence_hash TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      verdict_json TEXT,
      transaction_hash TEXT,
      created_at TEXT NOT NULL,
      verified_at TEXT,
      evidence_deleted_at TEXT
    );

    CREATE TABLE IF NOT EXISTS xp_events (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      submission_id TEXT UNIQUE,
      quest_id TEXT REFERENCES quests(id),
      amount INTEGER NOT NULL,
      reason TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS rate_limits (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      action TEXT NOT NULL,
      window_started_at INTEGER NOT NULL,
      request_count INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (user_id, action, window_started_at)
    );

    CREATE INDEX IF NOT EXISTS idx_assignments_user_day
      ON daily_assignments(user_id, assigned_date);
    CREATE INDEX IF NOT EXISTS idx_submissions_user_created
      ON submissions(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_xp_user_created
      ON xp_events(user_id, created_at DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_submissions_evidence_hash
      ON submissions(evidence_hash);
  `);

  const assignmentColumns = db.prepare("PRAGMA table_info(daily_assignments)").all();
  if (!assignmentColumns.some((column) => column.name === "quest_version_id")) {
    db.exec("ALTER TABLE daily_assignments ADD COLUMN quest_version_id TEXT;");
  }

  const questColumns = db.prepare("PRAGMA table_info(quests)").all();
  if (!questColumns.some((column) => column.name === "state")) {
    db.exec("ALTER TABLE quests ADD COLUMN state TEXT NOT NULL DEFAULT 'active';");
  }

  const submissionColumns = db.prepare("PRAGMA table_info(submissions)").all();
  if (!submissionColumns.some((column) => column.name === "evidence_deleted_at")) {
    db.exec("ALTER TABLE submissions ADD COLUMN evidence_deleted_at TEXT;");
  }

  db.exec("UPDATE quests SET active = 0, state = 'paused';");

  const upsertQuest = db.prepare(`
    INSERT INTO quests (
      id, slug, title, prompt, description, category, difficulty, xp, icon,
      accent, capture_tip, verification_rules, cadence, active, state
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      slug = excluded.slug,
      title = excluded.title,
      prompt = excluded.prompt,
      description = excluded.description,
      category = excluded.category,
      difficulty = excluded.difficulty,
      xp = excluded.xp,
      icon = excluded.icon,
      accent = excluded.accent,
      capture_tip = excluded.capture_tip,
      verification_rules = excluded.verification_rules,
      cadence = excluded.cadence,
      active = excluded.active,
      state = excluded.state
  `);

  for (const quest of QUESTS) {
    upsertQuest.run(
      quest.id,
      quest.slug,
      quest.title,
      quest.prompt,
      quest.description,
      quest.category,
      quest.difficulty,
      quest.xp,
      quest.icon,
      quest.accent,
      quest.captureTip,
      JSON.stringify(quest.rules),
      "daily",
      quest.state === "testing" ? 0 : 1,
      quest.state || "active",
    );
  }
  upsertQuest.run(
    WEEKLY_QUEST.id,
    WEEKLY_QUEST.slug,
    WEEKLY_QUEST.title,
    WEEKLY_QUEST.prompt,
    WEEKLY_QUEST.description,
    WEEKLY_QUEST.category,
    WEEKLY_QUEST.difficulty,
    WEEKLY_QUEST.xp,
    WEEKLY_QUEST.icon,
    WEEKLY_QUEST.accent,
    WEEKLY_QUEST.captureTip,
    JSON.stringify(WEEKLY_QUEST.rules),
    "weekly",
    1,
    "active",
  );

  const insertQuestVersion = db.prepare(`
    INSERT OR IGNORE INTO quest_versions (
      id, quest_id, version, slug, title, prompt, description, category,
      difficulty, xp, icon, accent, capture_tip, verification_rules, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const quest of [...QUESTS, WEEKLY_QUEST]) {
    const version = Number(quest.version || 2);
    insertQuestVersion.run(
      `${quest.id}_v${version}`,
      quest.id,
      version,
      quest.slug,
      quest.title,
      quest.prompt,
      quest.description,
      quest.category,
      quest.difficulty,
      quest.xp,
      quest.icon,
      quest.accent,
      quest.captureTip,
      JSON.stringify(quest.rules),
      new Date().toISOString(),
    );
  }
  db.exec(`
    UPDATE daily_assignments
    SET quest_version_id = (
      SELECT qv.id
      FROM quest_versions qv
      WHERE qv.quest_id = daily_assignments.quest_id
      ORDER BY qv.version DESC
      LIMIT 1
    )
    WHERE quest_version_id IS NULL;
  `);

  const today = isoDay();
  db.prepare(`
    INSERT OR IGNORE INTO users (
      id, display_name, handle, avatar_initials, current_streak, longest_streak,
      last_completed_date, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run("demo_explorer", "Alex Morgan", "alexoutside", "AM", 4, 11, addDays(today, -1), new Date().toISOString());
  db.prepare(`
    INSERT OR IGNORE INTO users (
      id, display_name, handle, avatar_initials, current_streak, longest_streak,
      last_completed_date, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run("demo_rival", "Maya Chen", "mayamoves", "MC", 2, 7, addDays(today, -1), new Date().toISOString());

  const seedEvents = [
    ["seed_xp_welcome", 600, "Founding explorer bonus", -12, "quest_color_hunt"],
    ["seed_xp_book", 550, "Completed Book find", -3, "quest_book_find"],
    ["seed_xp_grass", 530, "Completed Green thing", -1, "quest_touch_grass"],
  ];
  const insertSeedXp = db.prepare(`
    INSERT OR IGNORE INTO xp_events
      (id, user_id, submission_id, quest_id, amount, reason, created_at)
    VALUES (?, 'demo_explorer', NULL, ?, ?, ?, ?)
  `);
  for (const [id, amount, reason, daysAgo, questId] of seedEvents) {
    insertSeedXp.run(id, questId, amount, reason, `${addDays(today, daysAgo)}T18:20:00.000Z`);
  }
  db.prepare(`
    INSERT OR IGNORE INTO xp_events
      (id, user_id, submission_id, quest_id, amount, reason, created_at)
    VALUES (?, 'demo_rival', NULL, ?, ?, ?, ?)
  `).run("seed_xp_rival", "quest_color_hunt", 920, "Explorer progress", `${addDays(today, -1)}T17:00:00.000Z`);

  const insertAssignment = db.prepare(`
    INSERT OR IGNORE INTO daily_assignments
      (id, user_id, quest_id, quest_version_id, assigned_date, status)
    VALUES (?, ?, ?, ?, ?, 'pending')
  `);

  function ensureAssignments(userId, assignedDate = isoDay()) {
    const daily = db.prepare(`
      SELECT
        q.id,
        q.state,
        (
          SELECT qv.id FROM quest_versions qv
          WHERE qv.quest_id = q.id
          ORDER BY qv.version DESC
          LIMIT 1
        ) AS quest_version_id
      FROM quests q
      WHERE q.state IN ('active', 'testing') AND q.cadence = 'daily'
      ORDER BY CASE q.state WHEN 'testing' THEN 0 ELSE 1 END, q.id
    `).all();
    const existing = db.prepare(`
      SELECT a.quest_id
      FROM daily_assignments a
      JOIN quests q ON q.id = a.quest_id
      WHERE a.user_id = ? AND a.assigned_date = ?
        AND q.state IN ('active', 'testing') AND q.cadence = 'daily'
    `).all(userId, assignedDate).map((row) => row.quest_id);
    const seed = [...assignedDate].reduce((sum, character) => sum + character.charCodeAt(0), 0);
    const chosen = [];
    const needed = Math.max(0, Math.min(3, daily.length) - existing.length);
    const testing = daily.filter((quest) => quest.state === "testing");
    const active = daily.filter((quest) => quest.state === "active");
    const selectionPool = testing.length >= needed ? testing : [...testing, ...active];
    for (let offset = 0; chosen.length < needed; offset += 1) {
      const candidate = selectionPool[(seed + offset) % selectionPool.length];
      if (!existing.includes(candidate.id) && !chosen.some((item) => item.id === candidate.id)) {
        chosen.push(candidate);
      }
    }
    for (const quest of chosen) {
      insertAssignment.run(
        `${userId}_${assignedDate}_${quest.id}`,
        userId,
        quest.id,
        quest.quest_version_id,
        assignedDate,
      );
    }
    const weeklyVersion = db.prepare(`
      SELECT id FROM quest_versions
      WHERE quest_id = ?
      ORDER BY version DESC
      LIMIT 1
    `).get(WEEKLY_QUEST.id)?.id;
    insertAssignment.run(
      `${userId}_${assignedDate}_${WEEKLY_QUEST.id}`,
      userId,
      WEEKLY_QUEST.id,
      weeklyVersion,
      assignedDate,
    );
  }

  function getBootstrap(userId = "demo_explorer", assignedDate = isoDay(), requestedTimeZone = "UTC") {
    const timeZone = validTimeZone(requestedTimeZone);
    const weekStart = startOfIsoWeek(assignedDate);
    const weekEnd = addDays(weekStart, 7);
    ensureAssignments(userId, assignedDate);
    const profile = db.prepare(`
      SELECT
        u.*,
        COALESCE(SUM(x.amount), 0) AS total_xp
      FROM users u
      LEFT JOIN xp_events x ON x.user_id = u.id
      WHERE u.id = ?
      GROUP BY u.id
    `).get(userId);
    if (!profile) return null;

    const assignmentRows = db.prepare(`
      SELECT
        a.id AS assignment_id,
        a.quest_id,
        a.quest_version_id,
        a.assigned_date,
        a.status,
        a.submission_id,
        q.cadence,
        v.version,
        v.slug,
        v.title,
        v.prompt,
        v.description,
        v.category,
        v.difficulty,
        v.xp,
        v.icon,
        v.accent,
        v.capture_tip,
        v.verification_rules
      FROM daily_assignments a
      JOIN quests q ON q.id = a.quest_id
      JOIN quest_versions v ON v.id = a.quest_version_id
       WHERE a.user_id = ? AND a.assigned_date = ?
         AND q.state IN ('active', 'testing')
      ORDER BY CASE q.cadence WHEN 'daily' THEN 0 ELSE 1 END, v.xp ASC
    `).all(userId, assignedDate);

    const dailyQuests = assignmentRows
      .filter((row) => row.cadence === "daily")
      .map((row) => ({
        assignmentId: row.assignment_id,
        assignedDate: row.assigned_date,
        status: row.status,
        submissionId: row.submission_id,
        quest: questFromRow(row),
      }));
    const weeklyRow = assignmentRows.find((row) => row.cadence === "weekly");

    const activity = db.prepare(`
      SELECT x.id, x.amount, x.reason, x.created_at, q.title, q.icon, q.accent
      FROM xp_events x
      LEFT JOIN quests q ON q.id = x.quest_id
      WHERE x.user_id = ?
      ORDER BY x.created_at DESC
      LIMIT 5
    `).all(userId).map((row) => ({
      id: row.id,
      amount: Number(row.amount),
      reason: row.reason,
      createdAt: row.created_at,
      questTitle: row.title,
      icon: row.icon,
      accent: row.accent,
    }));

    const proofHistory = db.prepare(`
      SELECT
        s.id,
        s.assignment_id,
        s.status,
        s.verdict_json,
        s.transaction_hash,
        s.created_at,
        s.verified_at,
        v.title,
        v.xp
      FROM submissions s
      JOIN daily_assignments a ON a.id = s.assignment_id
      JOIN quest_versions v ON v.id = a.quest_version_id
      WHERE s.user_id = ?
      ORDER BY s.created_at DESC
      LIMIT 6
    `).all(userId).map((row) => ({
      id: row.id,
      assignmentId: row.assignment_id,
      questTitle: row.title,
      xp: Number(row.xp),
      status: row.status,
      verdict: row.verdict_json ? JSON.parse(row.verdict_json) : null,
      transactionHash: row.transaction_hash,
      createdAt: row.created_at,
      verifiedAt: row.verified_at,
    }));

    const leaderboard = db.prepare(`
      SELECT
        u.id,
        u.display_name,
        u.handle,
        u.avatar_initials,
        u.current_streak,
        u.longest_streak,
        COALESCE(SUM(x.amount), 0) AS total_xp,
        COUNT(x.submission_id) AS completed_quests
      FROM users u
      LEFT JOIN xp_events x ON x.user_id = u.id
      GROUP BY u.id
      ORDER BY total_xp DESC, u.current_streak DESC, u.handle ASC
      LIMIT 10
    `).all().map((row, index) => ({
      rank: index + 1,
      userId: row.id,
      displayName: row.display_name,
      handle: row.handle,
      avatarInitials: row.avatar_initials,
      totalXp: Number(row.total_xp),
      currentStreak: Number(row.current_streak),
      longestStreak: Number(row.longest_streak),
      completedQuests: Number(row.completed_quests),
    }));

    const totalXp = Number(profile.total_xp);
    const level = levelForXp(totalXp);
    const leaderboardProfile = leaderboard.find((entry) => entry.userId === userId);
    const weeklyCompletionCounts = new Map();
    const weeklyCompletions = db.prepare(`
      SELECT COALESCE(verified_at, created_at) AS completed_at
      FROM submissions
      WHERE user_id = ?
        AND status = 'accepted'
        AND COALESCE(verified_at, created_at) >= ?
        AND COALESCE(verified_at, created_at) < ?
    `).all(
      userId,
      `${addDays(weekStart, -1)}T00:00:00.000Z`,
      `${addDays(weekEnd, 1)}T00:00:00.000Z`,
    );
    for (const completion of weeklyCompletions) {
      const completionDay = dayInTimeZone(completion.completed_at, timeZone);
      if (completionDay < weekStart || completionDay >= weekEnd) continue;
      weeklyCompletionCounts.set(
        completionDay,
        (weeklyCompletionCounts.get(completionDay) ?? 0) + 1,
      );
    }
    const completedDays = [...weeklyCompletionCounts.entries()]
      .map(([date, count]) => ({ date, count }))
      .sort((left, right) => left.date.localeCompare(right.date));
    const weeklyCompleted = completedDays.reduce((sum, item) => sum + item.count, 0);
    return {
      date: assignedDate,
      verifierMode: process.env.IRLQUEST_VERIFIER_MODE === "genlayer" ? "genlayer" : "local",
      genLayerContractAddress: process.env.GENLAYER_CONTRACT_ADDRESS || null,
      user: {
        id: profile.id,
        displayName: profile.display_name,
        handle: profile.handle,
        avatarInitials: profile.avatar_initials,
        totalXp,
        currentStreak: Number(profile.current_streak),
        longestStreak: Number(profile.longest_streak),
        completedQuests: leaderboardProfile?.completedQuests ?? 0,
        rank: leaderboardProfile?.rank ?? null,
        ...level,
      },
      dailyQuests,
      weeklyQuest: weeklyRow ? {
        assignmentId: weeklyRow.assignment_id,
        assignedDate: weeklyRow.assigned_date,
        status: weeklyRow.status,
        submissionId: weeklyRow.submission_id,
        quest: questFromRow(weeklyRow),
      } : null,
      activity,
      proofHistory,
      leaderboard,
      weeklyGoal: {
        completed: Math.min(5, weeklyCompleted),
        target: 5,
        completedDays,
      },
    };
  }

  function updateProfileHandle(userId, handle) {
    const result = db.prepare("UPDATE users SET handle = ? WHERE id = ?").run(handle, userId);
    if (!result.changes) return null;
    return db.prepare("SELECT handle FROM users WHERE id = ?").get(userId);
  }

  function getAssignment(assignmentId, userId = "demo_explorer") {
    const row = db.prepare(`
      SELECT a.*, v.version, v.slug, v.title, v.prompt, v.description, v.category,
             v.difficulty, v.xp, v.icon, v.accent, v.capture_tip,
             v.verification_rules
      FROM daily_assignments a
      JOIN quest_versions v ON v.id = a.quest_version_id
      WHERE a.id = ? AND a.user_id = ?
    `).get(assignmentId, userId);
    if (!row) return null;
    return {
      assignmentId: row.id,
      assignedDate: row.assigned_date,
      status: row.status,
      submissionId: row.submission_id,
      quest: questFromRow({ ...row, quest_id: row.quest_id }),
    };
  }

  function createProofSession({ id, userId, assignmentId, nonce, challenge, expiresAt, createdAt }) {
    db.prepare(`
      INSERT INTO proof_sessions
        (id, user_id, assignment_id, nonce, challenge, expires_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, userId, assignmentId, nonce, challenge, expiresAt, createdAt);
    return getProofSession(id, userId);
  }

  function getProofSession(id, userId = "demo_explorer") {
    const row = db.prepare(`
      SELECT p.*, a.status AS assignment_status, a.quest_id, a.quest_version_id,
             a.assigned_date, v.title, v.prompt, v.description,
             v.verification_rules, v.xp
      FROM proof_sessions p
      JOIN daily_assignments a ON a.id = p.assignment_id
      JOIN quest_versions v ON v.id = a.quest_version_id
      WHERE p.id = ? AND p.user_id = ?
    `).get(id, userId);
    if (!row) return null;
    return {
      id: row.id,
      userId: row.user_id,
      assignmentId: row.assignment_id,
      assignmentStatus: row.assignment_status,
      questId: row.quest_id,
      questVersionId: row.quest_version_id,
      questTitle: row.title,
      questPrompt: row.description,
      verificationRules: row.verification_rules,
      xp: Number(row.xp),
      assignedDate: row.assigned_date,
      nonce: row.nonce,
      challenge: row.challenge,
      expiresAt: row.expires_at,
      createdAt: row.created_at,
      usedAt: row.used_at,
    };
  }

  function createSubmission({ id, userId, proofSessionId, evidencePath, evidenceMime, evidenceHash, createdAt }) {
    db.exec("BEGIN IMMEDIATE;");
    try {
      const session = getProofSession(proofSessionId, userId);
      if (!session) throw new Error("PROOF_SESSION_NOT_FOUND");
      if (session.usedAt) throw new Error("PROOF_SESSION_USED");
      if (new Date(session.expiresAt).getTime() <= Date.now()) throw new Error("PROOF_SESSION_EXPIRED");
      if (session.assignmentStatus === "completed" || session.assignmentStatus === "verifying") {
        throw new Error("ASSIGNMENT_NOT_AVAILABLE");
      }
      if (db.prepare("SELECT 1 FROM submissions WHERE evidence_hash = ?").get(evidenceHash)) {
        throw new Error("EVIDENCE_ALREADY_USED");
      }
      db.prepare(`
        INSERT INTO submissions (
          id, user_id, assignment_id, proof_session_id, evidence_path,
          evidence_mime, evidence_hash, status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)
      `).run(
        id,
        userId,
        session.assignmentId,
        proofSessionId,
        evidencePath,
        evidenceMime,
        evidenceHash,
        createdAt,
      );
      db.prepare("UPDATE proof_sessions SET used_at = ? WHERE id = ?").run(createdAt, proofSessionId);
      db.prepare(`
        UPDATE daily_assignments SET status = 'verifying', submission_id = ? WHERE id = ?
      `).run(id, session.assignmentId);
      db.exec("COMMIT;");
      return getSubmission(id, userId);
    } catch (error) {
      db.exec("ROLLBACK;");
      throw error;
    }
  }

  function getSubmission(id, userId = "demo_explorer") {
    const row = db.prepare(`
      SELECT s.*, a.quest_id, a.quest_version_id, a.assigned_date,
             v.title, v.description, v.verification_rules, v.xp,
             p.challenge, p.nonce
      FROM submissions s
      JOIN daily_assignments a ON a.id = s.assignment_id
      JOIN quest_versions v ON v.id = a.quest_version_id
      JOIN proof_sessions p ON p.id = s.proof_session_id
      WHERE s.id = ? AND s.user_id = ?
    `).get(id, userId);
    if (!row) return null;
    return {
      id: row.id,
      userId: row.user_id,
      assignmentId: row.assignment_id,
      assignedDate: row.assigned_date,
      questId: row.quest_id,
      questVersionId: row.quest_version_id,
      questTitle: row.title,
      questPrompt: row.description,
      verificationRules: row.verification_rules,
      xp: Number(row.xp),
      proofSessionId: row.proof_session_id,
      challenge: row.challenge,
      nonce: row.nonce,
      evidencePath: row.evidence_path,
      evidenceMime: row.evidence_mime,
      evidenceHash: row.evidence_hash,
      status: row.status,
      verdict: row.verdict_json ? JSON.parse(row.verdict_json) : null,
      transactionHash: row.transaction_hash,
      createdAt: row.created_at,
      verifiedAt: row.verified_at,
    };
  }

  function listSubmissionPage(userId = "demo_explorer", page = 1, pageSize = 8, status = null) {
    const safePage = Number.isInteger(page) && page > 0 ? Math.min(page, 10_000) : 1;
    const safePageSize = Number.isInteger(pageSize) && pageSize > 0 ? Math.min(pageSize, 20) : 8;
    const safeStatus = status === "accepted" ? "accepted" : null;
    const total = Number(
      db.prepare("SELECT COUNT(*) AS count FROM submissions WHERE user_id = ? AND (? IS NULL OR status = ?)")
        .get(userId, safeStatus, safeStatus).count,
    );
    const rows = db.prepare(`
      SELECT
        s.id,
        s.assignment_id,
        s.status,
        s.verdict_json,
        s.transaction_hash,
        s.created_at,
        s.verified_at,
        v.title,
        v.xp
      FROM submissions s
      JOIN daily_assignments a ON a.id = s.assignment_id
      JOIN quest_versions v ON v.id = a.quest_version_id
      WHERE s.user_id = ?
        AND (? IS NULL OR s.status = ?)
      ORDER BY s.created_at DESC
      LIMIT ? OFFSET ?
    `).all(userId, safeStatus, safeStatus, safePageSize, (safePage - 1) * safePageSize);
    return {
      items: rows.map((row) => ({
        id: row.id,
        assignmentId: row.assignment_id,
        questTitle: row.title,
        xp: Number(row.xp),
        status: row.status,
        verdict: row.verdict_json ? JSON.parse(row.verdict_json) : null,
        transactionHash: row.transaction_hash,
        createdAt: row.created_at,
        verifiedAt: row.verified_at,
      })),
      page: safePage,
      pageSize: safePageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / safePageSize)),
    };
  }

  function listPendingSubmissions() {
    return db.prepare(`
      SELECT id FROM submissions WHERE status = 'pending' ORDER BY created_at ASC
    `).all().map((row) => row.id);
  }

  function takeRateLimit(userId, action, limit, windowSeconds, now = Date.now()) {
    const windowStartedAt = Math.floor(now / (windowSeconds * 1000)) * windowSeconds;
    const result = db.prepare(`
      INSERT INTO rate_limits (user_id, action, window_started_at, request_count)
      VALUES (?, ?, ?, 1)
      ON CONFLICT(user_id, action, window_started_at) DO UPDATE SET
        request_count = request_count + 1
      WHERE request_count < ?
    `).run(userId, action, windowStartedAt, limit);
    return Number(result.changes) > 0;
  }

  function listExpiredEvidence(cutoff, limit = 20) {
    return db.prepare(`
      SELECT id, evidence_path
      FROM submissions
      WHERE status <> 'pending'
        AND evidence_deleted_at IS NULL
        AND created_at < ?
      ORDER BY created_at ASC
      LIMIT ?
    `).all(cutoff, limit).map((row) => ({ id: row.id, evidencePath: row.evidence_path }));
  }

  function markEvidenceDeleted(submissionId, deletedAt = new Date().toISOString()) {
    db.prepare(`
      UPDATE submissions SET evidence_deleted_at = ? WHERE id = ?
    `).run(deletedAt, submissionId);
  }

  function verificationHealth() {
    const stuck = Number(db.prepare(`
      SELECT COUNT(*) AS count
      FROM submissions
      WHERE status = 'pending' AND created_at < ?
    `).get(new Date(Date.now() - 10 * 60 * 1000).toISOString()).count);
    const repeatedFailures = Number(db.prepare(`
      SELECT COUNT(*) AS count FROM (
        SELECT a.quest_id
        FROM submissions s
        JOIN daily_assignments a ON a.id = s.assignment_id
        WHERE s.created_at >= ? AND s.status IN ('accepted', 'rejected', 'review')
        GROUP BY a.quest_id
        HAVING COUNT(*) >= 3
          AND SUM(CASE WHEN s.status IN ('rejected', 'review') THEN 1 ELSE 0 END) >= 3
      )
    `).get(new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()).count);
    return { stuckSubmissions: stuck, repeatedFailureQuests: repeatedFailures };
  }

  function finalizeSubmission({ submissionId, status, verdict, transactionHash = null, verifiedAt = new Date().toISOString() }) {
    db.exec("BEGIN IMMEDIATE;");
    try {
      const submission = db.prepare(`
        SELECT s.*, a.quest_id, a.quest_version_id, a.assigned_date, v.xp, v.title
        FROM submissions s
        JOIN daily_assignments a ON a.id = s.assignment_id
        JOIN quest_versions v ON v.id = a.quest_version_id
        WHERE s.id = ?
      `).get(submissionId);
      if (!submission) throw new Error("SUBMISSION_NOT_FOUND");
      if (submission.status !== "pending") {
        db.exec("COMMIT;");
        return getSubmission(submissionId, submission.user_id);
      }

      db.prepare(`
        UPDATE submissions
        SET status = ?, verdict_json = ?, transaction_hash = ?, verified_at = ?
        WHERE id = ?
      `).run(status, JSON.stringify(verdict), transactionHash, verifiedAt, submissionId);

      if (status === "accepted") {
        db.prepare(`
          UPDATE daily_assignments SET status = 'completed', submission_id = ? WHERE id = ?
        `).run(submissionId, submission.assignment_id);
        db.prepare(`
          INSERT OR IGNORE INTO xp_events
            (id, user_id, submission_id, quest_id, amount, reason, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(
          `xp_${submissionId}`,
          submission.user_id,
          submissionId,
          submission.quest_id,
          Number(submission.xp),
          `Completed ${submission.title}`,
          verifiedAt,
        );

        const user = db.prepare(`
          SELECT current_streak, longest_streak, last_completed_date FROM users WHERE id = ?
        `).get(submission.user_id);
        let streak = Number(user.current_streak);
        if (user.last_completed_date !== submission.assigned_date) {
          streak = user.last_completed_date === addDays(submission.assigned_date, -1) ? streak + 1 : 1;
        }
        db.prepare(`
          UPDATE users
          SET current_streak = ?, longest_streak = ?, last_completed_date = ?
          WHERE id = ?
        `).run(streak, Math.max(streak, Number(user.longest_streak)), submission.assigned_date, submission.user_id);
      } else {
        db.prepare(`
          UPDATE daily_assignments SET status = 'pending', submission_id = NULL WHERE id = ?
        `).run(submission.assignment_id);
      }
      db.exec("COMMIT;");
      return getSubmission(submissionId, submission.user_id);
    } catch (error) {
      db.exec("ROLLBACK;");
      throw error;
    }
  }

  return {
    raw: db,
    close: () => db.close(),
    ensureAssignments,
    getBootstrap,
    listSubmissionPage,
    updateProfileHandle,
    getAssignment,
    createProofSession,
    getProofSession,
    createSubmission,
    getSubmission,
    listPendingSubmissions,
    takeRateLimit,
    listExpiredEvidence,
    markEvidenceDeleted,
    verificationHealth,
    finalizeSubmission,
  };
}

export const dateHelpers = { isoDay, addDays };
