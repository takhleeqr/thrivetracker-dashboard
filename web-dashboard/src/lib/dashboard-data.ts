import type { SupabaseClient } from "@supabase/supabase-js";

export type Profile = {
  id: string;
  email: string;
  full_name: string;
  role: "admin" | "va";
  is_active: boolean;
  last_seen_at: string | null;
};

export type Project = {
  id: string;
  name: string;
};

export type TimeEntry = {
  id: string;
  user_id: string;
  project_id: string | null;
  started_at: string;
  stopped_at: string | null;
  duration_seconds: number | null;
  stop_reason: "manual" | "idle" | "app_close" | "crash" | null;
};

export type ActivityLog = {
  id: string;
  user_id: string;
  time_entry_id: string;
  timestamp: string;
  activity_percent: number;
  keystrokes_count?: number;
  mouse_clicks_count?: number;
  mouse_moved?: boolean;
  active_window_title?: string | null;
  active_app_name?: string | null;
};

export type Screenshot = {
  id: string;
  user_id: string;
  time_entry_id: string;
  project_id: string | null;
  captured_at: string;
  storage_key: string;
  file_size_bytes: number | null;
  activity_percent_at_capture: number | null;
  signedUrl: string | null;
};

export type TimelineSegment = {
  id: string;
  projectName: string;
  startedAt: string;
  stoppedAt: string | null;
  displayStartedAt: string;
  displayStoppedAt: string;
  durationSeconds: number;
  stopReason: TimeEntry["stop_reason"];
  isOpen: boolean;
};

export type AppUsage = {
  appName: string;
  minutes: number;
  averageActivityPercent: number;
};

export type VaDetail = {
  profile: Profile;
  totalHoursTodaySeconds: number;
  averageActivityPercent: number;
  productivityScore: number;
  screenshotCount: number;
  lastSeenAt: string | null;
  timeline: TimelineSegment[];
  screenshots: Screenshot[];
  activityLogs: ActivityLog[];
  appUsage: AppUsage[];
  timeEntries: Array<TimeEntry & { projectName: string }>;
  rangeStart: string;
  rangeEnd: string;
};

export type DetailDateRange = {
  start: string;
  end: string;
};

export type DashboardRow = {
  userId: string;
  name: string;
  email: string;
  status: "online" | "idle" | "offline";
  currentProject: string;
  currentProjectId: string | null;
  hoursTodaySeconds: number;
  activityPercent: number | null;
  productivityScore: number;
  lastSeenAt: string | null;
  alerts: DashboardAlert[];
  lastScreenshot: {
    capturedAt: string;
    signedUrl: string | null;
  } | null;
};

export type DashboardAlert = {
  id: string;
  userId: string;
  vaName: string;
  severity: "warning" | "critical";
  type: "low_activity" | "stale_heartbeat" | "missing_heartbeat" | "crash_closed";
  title: string;
  message: string;
};

export type DashboardSummary = {
  totalHoursTodaySeconds: number;
  onlineCount: number;
  averageActivityPercent: number;
  alertCount: number;
  alerts: DashboardAlert[];
  rows: DashboardRow[];
};

const LOW_ACTIVITY_THRESHOLD = 30;
const RECENT_ACTIVITY_MINUTES = 10;
const RECENT_IDLE_MINUTES = 30;
const ONLINE_HEARTBEAT_MINUTES = 5;
const STALE_ENTRY_MINUTES = 10;
const SCREENSHOT_BUCKET = process.env.NEXT_PUBLIC_SUPABASE_STORAGE_BUCKET ?? "screenshots";

export async function loadAdminProfile(supabase: SupabaseClient): Promise<Profile | null> {
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return null;
  }

  const { data, error } = await supabase
    .from("profiles")
    .select("id,email,full_name,role,is_active,last_seen_at")
    .eq("id", user.id)
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  return data as Profile;
}

export async function loadDashboardSummary(supabase: SupabaseClient): Promise<DashboardSummary> {
  const todayStart = startOfTodayIso();
  const activitySince = minutesAgoIso(RECENT_ACTIVITY_MINUTES);

  const [profilesResult, projectsResult, entriesResult, activityResult, screenshotsResult] = await Promise.all([
    supabase
      .from("profiles")
      .select("id,email,full_name,role,is_active,last_seen_at")
      .eq("role", "va")
      .eq("is_active", true)
      .order("full_name", { ascending: true }),
    supabase.from("projects").select("id,name"),
    supabase
      .from("time_entries")
      .select("id,user_id,project_id,started_at,stopped_at,duration_seconds,stop_reason")
      .gte("started_at", todayStart),
    supabase
      .from("activity_logs")
      .select("id,user_id,time_entry_id,timestamp,activity_percent")
      .gte("timestamp", todayStart)
      .order("timestamp", { ascending: false })
      .limit(1000),
    supabase
      .from("screenshots")
      .select("id,user_id,time_entry_id,project_id,captured_at,storage_key,file_size_bytes,activity_percent_at_capture")
      .gte("captured_at", todayStart)
      .order("captured_at", { ascending: false })
      .limit(500),
  ]);

  if (profilesResult.error) throw profilesResult.error;
  if (projectsResult.error) throw projectsResult.error;
  if (entriesResult.error) throw entriesResult.error;
  if (activityResult.error) throw activityResult.error;
  if (screenshotsResult.error) throw screenshotsResult.error;

  const profiles = (profilesResult.data ?? []) as Profile[];
  const projects = (projectsResult.data ?? []) as Project[];
  const entries = (entriesResult.data ?? []) as TimeEntry[];
  const activityLogs = (activityResult.data ?? []) as ActivityLog[];
  const screenshots = await addSignedScreenshotUrls(supabase, latestScreenshotPerUser((screenshotsResult.data ?? []) as Omit<Screenshot, "signedUrl">[]));
  const screenshotsByUser = new Map(screenshots.map((screenshot) => [screenshot.user_id, screenshot]));
  const projectNames = new Map(projects.map((project) => [project.id, project.name]));
  const now = Date.now();

  const rows = profiles.map((profile) => {
    const userEntries = entries.filter((entry) => entry.user_id === profile.id);
    const activeEntry = userEntries.find((entry) => !entry.stopped_at) ?? null;
    const latestEntry = newestEntry(userEntries);
    const userLogs = activityLogs.filter((log) => log.user_id === profile.id);
    const latestLog = newestActivity(userLogs);
    const recentLogs = userLogs.filter((log) => new Date(log.timestamp).getTime() >= new Date(activitySince).getTime());
    const activityPercent = averageActivity(recentLogs) ?? latestLog?.activity_percent ?? null;
    const status = getStatus(activeEntry, latestEntry, profile.last_seen_at, now);
    const rowAlerts = buildDashboardAlerts({
      activeEntry,
      activityPercent,
      latestEntry,
      now,
      profile,
      status,
    });

    return {
      userId: profile.id,
      name: profile.full_name,
      email: profile.email,
      status,
      currentProject: activeEntry?.project_id ? projectNames.get(activeEntry.project_id) ?? "Assigned Project" : "-",
      currentProjectId: activeEntry?.project_id ?? null,
      hoursTodaySeconds: totalSecondsToday(userEntries, now, profile.last_seen_at, status),
      activityPercent,
      productivityScore: productivityScore(activityPercent),
      lastSeenAt: profile.last_seen_at ?? latestLog?.timestamp ?? latestEntry?.stopped_at ?? latestEntry?.started_at ?? null,
      alerts: rowAlerts,
      lastScreenshot: screenshotsByUser.has(profile.id)
        ? {
            capturedAt: screenshotsByUser.get(profile.id)?.captured_at ?? "",
            signedUrl: screenshotsByUser.get(profile.id)?.signedUrl ?? null,
          }
        : null,
    } satisfies DashboardRow;
  });

  const totalHoursTodaySeconds = rows.reduce((sum, row) => sum + row.hoursTodaySeconds, 0);
  const onlineRows = rows.filter((row) => row.status === "online");
  const averageActivityPercent = averageActivity(
    rows
      .filter((row) => row.activityPercent !== null)
      .map((row) => ({ activity_percent: row.activityPercent ?? 0 }) as ActivityLog),
  ) ?? 0;
  const alerts = rows.flatMap((row) => row.alerts);

  return {
    totalHoursTodaySeconds,
    onlineCount: onlineRows.length,
    averageActivityPercent,
    alertCount: alerts.length,
    alerts,
    rows,
  };
}

export async function closeStaleTimeEntries(supabase: SupabaseClient): Promise<number> {
  const { data, error } = await supabase.rpc("close_stale_time_entries", {
    stale_after_minutes: STALE_ENTRY_MINUTES,
  });

  if (error) throw error;
  return Number(data ?? 0);
}

export async function loadVaDetail(supabase: SupabaseClient, userId: string, range?: DetailDateRange): Promise<VaDetail> {
  const selectedRange = range ?? { start: startOfTodayIso(), end: new Date().toISOString() };

  const [profileResult, projectsResult, entriesResult, activityResult, screenshotsResult] = await Promise.all([
    supabase
      .from("profiles")
      .select("id,email,full_name,role,is_active,last_seen_at")
      .eq("id", userId)
      .eq("role", "va")
      .maybeSingle(),
    supabase.from("projects").select("id,name"),
    supabase
      .from("time_entries")
      .select("id,user_id,project_id,started_at,stopped_at,duration_seconds,stop_reason")
      .eq("user_id", userId)
      .lte("started_at", selectedRange.end)
      .or(`stopped_at.is.null,stopped_at.gte.${selectedRange.start}`)
      .order("started_at", { ascending: true }),
    supabase
      .from("activity_logs")
      .select(
        "id,user_id,time_entry_id,timestamp,activity_percent,keystrokes_count,mouse_clicks_count,mouse_moved,active_window_title,active_app_name",
      )
      .eq("user_id", userId)
      .gte("timestamp", selectedRange.start)
      .lte("timestamp", selectedRange.end)
      .order("timestamp", { ascending: true })
      .limit(1440),
    supabase
      .from("screenshots")
      .select("id,user_id,time_entry_id,project_id,captured_at,storage_key,file_size_bytes,activity_percent_at_capture")
      .eq("user_id", userId)
      .gte("captured_at", selectedRange.start)
      .lte("captured_at", selectedRange.end)
      .order("captured_at", { ascending: false })
      .limit(60),
  ]);

  if (profileResult.error) throw profileResult.error;
  if (projectsResult.error) throw projectsResult.error;
  if (entriesResult.error) throw entriesResult.error;
  if (activityResult.error) throw activityResult.error;
  if (screenshotsResult.error) throw screenshotsResult.error;
  if (!profileResult.data) throw new Error("VA profile was not found.");

  const profile = profileResult.data as Profile;
  const projects = (projectsResult.data ?? []) as Project[];
  const entries = (entriesResult.data ?? []) as TimeEntry[];
  const activityLogs = (activityResult.data ?? []) as ActivityLog[];
  const screenshots = await addSignedScreenshotUrls(supabase, (screenshotsResult.data ?? []) as Omit<Screenshot, "signedUrl">[]);
  const projectNames = new Map(projects.map((project) => [project.id, project.name]));
  const activeEntry = entries.find((entry) => !entry.stopped_at) ?? null;
  const latestEntry = newestEntry(entries);
  const status = getStatus(activeEntry, latestEntry, profile.last_seen_at, Date.now());

  return {
    profile,
    totalHoursTodaySeconds: totalSecondsInRange(entries, selectedRange, Date.now(), profile.last_seen_at, status),
    averageActivityPercent: averageActivity(activityLogs) ?? 0,
    productivityScore: productivityScore(averageActivity(activityLogs) ?? 0),
    screenshotCount: screenshots.length,
    lastSeenAt: profile.last_seen_at,
    timeline: entries.map((entry) => toTimelineSegment(entry, projectNames, selectedRange, profile.last_seen_at, status)),
    screenshots,
    activityLogs,
    appUsage: buildAppUsage(activityLogs),
    timeEntries: entries.map((entry) => ({
      ...entry,
      projectName: entry.project_id ? projectNames.get(entry.project_id) ?? "Assigned Project" : "-",
    })),
    rangeStart: selectedRange.start,
    rangeEnd: selectedRange.end,
  };
}

function startOfTodayIso(): string {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date.toISOString();
}

function minutesAgoIso(minutes: number): string {
  return new Date(Date.now() - minutes * 60 * 1000).toISOString();
}

function newestEntry(entries: TimeEntry[]): TimeEntry | null {
  return [...entries].sort((a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime())[0] ?? null;
}

function newestActivity(logs: ActivityLog[]): ActivityLog | null {
  return [...logs].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())[0] ?? null;
}

function totalSecondsToday(
  entries: TimeEntry[],
  now: number,
  lastSeenAt: string | null,
  status: DashboardRow["status"],
): number {
  return entries.reduce((sum, entry) => {
    if (entry.stopped_at) {
      return sum + (entry.duration_seconds ?? 0);
    }

    const endTime = status === "online" ? now : lastSeenAt ? new Date(lastSeenAt).getTime() : now;
    return sum + Math.max(0, Math.floor((endTime - new Date(entry.started_at).getTime()) / 1000));
  }, 0);
}

function totalSecondsInRange(
  entries: TimeEntry[],
  range: DetailDateRange,
  now: number,
  lastSeenAt: string | null,
  status: DashboardRow["status"],
): number {
  const rangeStart = new Date(range.start).getTime();
  const rangeEnd = new Date(range.end).getTime();

  return entries.reduce((sum, entry) => {
    const entryStart = new Date(entry.started_at).getTime();
    const entryEnd = entry.stopped_at
      ? new Date(entry.stopped_at).getTime()
      : status === "online"
        ? Math.min(now, rangeEnd)
        : lastSeenAt
          ? Math.min(new Date(lastSeenAt).getTime(), rangeEnd)
          : rangeEnd;
    const clampedStart = Math.max(entryStart, rangeStart);
    const clampedEnd = Math.min(entryEnd, rangeEnd);
    return sum + Math.max(0, Math.floor((clampedEnd - clampedStart) / 1000));
  }, 0);
}

function averageActivity(logs: Array<Pick<ActivityLog, "activity_percent">>): number | null {
  if (!logs.length) return null;
  return logs.reduce((sum, log) => sum + Number(log.activity_percent ?? 0), 0) / logs.length;
}

function productivityScore(activityPercent: number | null): number {
  if (activityPercent === null) return 0;
  return Math.max(0, Math.min(100, Math.round(activityPercent)));
}

function latestScreenshotPerUser(screenshots: Array<Omit<Screenshot, "signedUrl">>) {
  const latestByUser = new Map<string, Omit<Screenshot, "signedUrl">>();

  for (const screenshot of screenshots) {
    const current = latestByUser.get(screenshot.user_id);
    if (!current || new Date(screenshot.captured_at).getTime() > new Date(current.captured_at).getTime()) {
      latestByUser.set(screenshot.user_id, screenshot);
    }
  }

  return [...latestByUser.values()];
}

function buildDashboardAlerts({
  activeEntry,
  activityPercent,
  latestEntry,
  now,
  profile,
  status,
}: {
  activeEntry: TimeEntry | null;
  activityPercent: number | null;
  latestEntry: TimeEntry | null;
  now: number;
  profile: Profile;
  status: DashboardRow["status"];
}): DashboardAlert[] {
  const alerts: DashboardAlert[] = [];
  const lastSeenAgeMinutes = profile.last_seen_at ? (now - new Date(profile.last_seen_at).getTime()) / 60000 : null;

  if (status === "online" && activityPercent !== null && activityPercent < LOW_ACTIVITY_THRESHOLD) {
    alerts.push({
      id: `${profile.id}-low-activity`,
      userId: profile.id,
      vaName: profile.full_name,
      severity: "warning",
      type: "low_activity",
      title: "Low activity",
      message: `${Math.round(activityPercent)}% activity in the recent tracking window.`,
    });
  }

  if (activeEntry && !profile.last_seen_at) {
    alerts.push({
      id: `${profile.id}-missing-heartbeat`,
      userId: profile.id,
      vaName: profile.full_name,
      severity: "critical",
      type: "missing_heartbeat",
      title: "Missing heartbeat",
      message: "Timer appears open, but the desktop app has not sent a heartbeat yet.",
    });
  }

  if (activeEntry && lastSeenAgeMinutes !== null && lastSeenAgeMinutes > ONLINE_HEARTBEAT_MINUTES) {
    alerts.push({
      id: `${profile.id}-stale-heartbeat`,
      userId: profile.id,
      vaName: profile.full_name,
      severity: lastSeenAgeMinutes > STALE_ENTRY_MINUTES ? "critical" : "warning",
      type: "stale_heartbeat",
      title: "Stale heartbeat",
      message: `Timer is open, but last heartbeat was ${Math.floor(lastSeenAgeMinutes)} minutes ago.`,
    });
  }

  if (latestEntry?.stop_reason === "crash" && latestEntry.stopped_at && new Date(latestEntry.stopped_at).getTime() >= new Date(startOfTodayIso()).getTime()) {
    alerts.push({
      id: `${profile.id}-crash-closed-${latestEntry.id}`,
      userId: profile.id,
      vaName: profile.full_name,
      severity: "critical",
      type: "crash_closed",
      title: "Session auto-closed",
      message: `A stale open timer was closed as a crash at ${new Date(latestEntry.stopped_at).toLocaleTimeString()}.`,
    });
  }

  return alerts;
}

async function addSignedScreenshotUrls(
  supabase: SupabaseClient,
  screenshots: Array<Omit<Screenshot, "signedUrl">>,
): Promise<Screenshot[]> {
  return Promise.all(
    screenshots.map(async (screenshot) => {
      const { data, error } = await supabase.storage
        .from(SCREENSHOT_BUCKET)
        .createSignedUrl(screenshot.storage_key, 10 * 60);

      return {
        ...screenshot,
        signedUrl: error ? null : data.signedUrl,
      };
    }),
  );
}

function toTimelineSegment(
  entry: TimeEntry,
  projectNames: Map<string, string>,
  range: DetailDateRange,
  lastSeenAt: string | null,
  status: DashboardRow["status"],
): TimelineSegment {
  const rangeStart = new Date(range.start).getTime();
  const rangeEnd = new Date(range.end).getTime();
  const rawEndAt = entry.stopped_at ?? (status === "online" ? new Date().toISOString() : lastSeenAt);
  const rawEndTime = rawEndAt ? new Date(rawEndAt).getTime() : rangeEnd;
  const displayStartTime = Math.max(new Date(entry.started_at).getTime(), rangeStart);
  const displayEndTime = Math.min(rawEndTime, rangeEnd);
  const endAt = new Date(displayEndTime).toISOString();
  const durationSeconds = Math.max(0, Math.floor((displayEndTime - displayStartTime) / 1000));

  return {
    id: entry.id,
    projectName: entry.project_id ? projectNames.get(entry.project_id) ?? "Assigned Project" : "-",
    startedAt: entry.started_at,
    stoppedAt: entry.stopped_at,
    displayStartedAt: new Date(displayStartTime).toISOString(),
    displayStoppedAt: endAt,
    durationSeconds,
    stopReason: entry.stop_reason,
    isOpen: !entry.stopped_at,
  };
}

function buildAppUsage(logs: ActivityLog[]): AppUsage[] {
  const usage = new Map<string, { minutes: number; activityTotal: number }>();

  for (const log of logs) {
    const appName = cleanAppName(log.active_app_name || log.active_window_title || "Unknown");
    const current = usage.get(appName) ?? { minutes: 0, activityTotal: 0 };
    current.minutes += 1;
    current.activityTotal += Number(log.activity_percent ?? 0);
    usage.set(appName, current);
  }

  return [...usage.entries()]
    .map(([appName, value]) => ({
      appName,
      minutes: value.minutes,
      averageActivityPercent: value.activityTotal / value.minutes,
    }))
    .sort((first, second) => second.minutes - first.minutes)
    .slice(0, 8);
}

function cleanAppName(value: string): string {
  const trimmed = value.trim();
  return trimmed.length > 48 ? `${trimmed.slice(0, 45)}...` : trimmed || "Unknown";
}

function getStatus(
  activeEntry: TimeEntry | null,
  latestEntry: TimeEntry | null,
  lastSeenAt: string | null,
  now: number,
): DashboardRow["status"] {
  if (activeEntry && lastSeenAt) {
    const lastSeenAgeMinutes = (now - new Date(lastSeenAt).getTime()) / 60000;
    if (lastSeenAgeMinutes <= ONLINE_HEARTBEAT_MINUTES) return "online";
  }

  if (latestEntry?.stop_reason === "idle" && latestEntry.stopped_at) {
    const idleAgeMinutes = (now - new Date(latestEntry.stopped_at).getTime()) / 60000;
    if (idleAgeMinutes <= RECENT_IDLE_MINUTES) return "idle";
  }

  return "offline";
}
