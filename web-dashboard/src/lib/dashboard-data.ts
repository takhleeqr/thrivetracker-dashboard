import type { SupabaseClient } from "@supabase/supabase-js";
import type { AppSettings } from "@/lib/settings-data";
import { dateInputValue, endOfDayIso, formatTime, startOfDayIso, todayDateInputValue, zonedDateTimeToUtc } from "@/lib/timezone";

export type Profile = {
  id: string;
  email: string;
  full_name: string;
  role: "admin" | "va";
  is_active: boolean;
  last_seen_at: string | null;
  hourly_rate?: number;
  expected_hours_per_week?: number;
  schedule_type?: "flexible" | "fixed" | null;
  shift_start_time?: string | null;
  shift_end_time?: string | null;
  working_days?: string[];
};

export type Project = {
  id: string;
  is_active?: boolean;
  name: string;
};

export type TimeEntry = {
  id: string;
  user_id: string;
  project_id: string | null;
  started_at: string;
  stopped_at: string | null;
  duration_seconds: number | null;
  is_manual?: boolean;
  manual_note?: string | null;
  stop_reason: "manual" | "idle" | "app_close" | "crash" | "break" | "connection_lost" | null;
  device_id?: string | null;
  device_hostname?: string | null;
  device_os_username?: string | null;
  device_fingerprint?: string | null;
};

export type UserDevice = {
  id: string;
  user_id: string;
  hostname: string;
  os_username: string | null;
  first_seen_at: string;
  last_login_at: string;
  last_seen_at: string | null;
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
  isManual: boolean;
  isOpen: boolean;
};

export type AppUsage = {
  appName: string;
  minutes: number;
  averageActivityPercent: number;
};

export type TimeEntryWithMetrics = TimeEntry & {
  averageActivityPercent: number | null;
  idleMinutes: number;
  productivityScore: number;
  projectName: string;
  screenshotsTaken: number;
  totalKeystrokes: number;
  totalMouseClicks: number;
};

export type VaDetail = {
  profile: Profile;
  lastDevice: UserDevice | null;
  latestAgentHealth: AgentHealthSnapshot | null;
  totalHoursTodaySeconds: number;
  totalHoursWeekSeconds: number;
  totalHoursMonthSeconds: number;
  earningsThisWeek: number;
  earningsThisMonth: number;
  averageActivityPercent: number;
  productivityScore: number;
  screenshotCount: number;
  lastSeenAt: string | null;
  timeline: TimelineSegment[];
  screenshots: Screenshot[];
  activityLogs: ActivityLog[];
  appUsage: AppUsage[];
  agentEvents: AgentEvent[];
  dailyPay: Array<{ date: string; earnings: number; seconds: number }>;
  projectOptions: Project[];
  timeEntries: TimeEntryWithMetrics[];
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
  status: "working" | "sync_delayed" | "on_break" | "idle" | "stopped" | "offline" | "day_off";
  statusDetail: string;
  scheduleStatus: "on_time" | "late" | "no_show" | "day_off" | "flexible" | "not_set";
  currentProject: string;
  currentProjectId: string | null;
  hoursTodaySeconds: number;
  weeklyHoursSeconds: number;
  expectedWeekSeconds: number;
  earningsToday: number;
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
  type:
    | "low_activity"
    | "stale_heartbeat"
    | "missing_heartbeat"
    | "crash_closed"
    | "connection_loss_resumes"
    | "late_start"
    | "no_show"
    | "screenshot_sync"
    | "queue_backlog"
    | "restart_loop";
  title: string;
  message: string;
};

type PersistedDashboardAlert = {
  alert_key: string;
  user_id: string;
  va_name: string;
  severity: DashboardAlert["severity"];
  type: DashboardAlert["type"];
  title: string;
  message: string;
};

type AgentHealthSnapshot = {
  user_id: string;
  install_id: string;
  hostname: string | null;
  app_version: string | null;
  queue_size: number;
  oldest_queue_item_at: string | null;
  screenshot_failure_started_at: string | null;
  screenshot_failure_count: number;
  last_screenshot_uploaded_at: string | null;
  last_health_ping_at: string;
};

type AgentAppLaunchEvent = {
  user_id: string;
  launched_at: string;
  app_version?: string | null;
};

export type AgentEvent = {
  id: string;
  user_id: string;
  install_id: string | null;
  hostname: string | null;
  app_version: string | null;
  event_type: string;
  severity: "info" | "warning" | "error" | "critical";
  message: string;
  details: Record<string, unknown> | null;
  occurred_at: string;
};

export type DashboardSummary = {
  totalHoursTodaySeconds: number;
  totalHoursWeekSeconds: number;
  totalEarningsToday: number;
  onlineCount: number;
  averageActivityPercent: number;
  alertCount: number;
  alerts: DashboardAlert[];
  rows: DashboardRow[];
};

const LOW_ACTIVITY_THRESHOLD = 30;
const RECENT_ACTIVITY_MINUTES = 10;
const ONLINE_HEARTBEAT_MINUTES = 10;
const RECENT_NON_WORKING_MINUTES = 60;
const STALE_ENTRY_MINUTES = 10;
const CONNECTION_LOSS_RESUME_ALERT_COUNT = 3;
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

export async function loadDashboardSummary(
  supabase: SupabaseClient,
  timezone = "Asia/Karachi",
  settings?: Partial<
    Pick<
      AppSettings,
      | "low_activity_threshold"
      | "low_activity_minimum_minutes"
      | "connectivity_grace_minutes"
      | "screenshot_failure_alert_minutes"
      | "offline_queue_alert_count"
      | "offline_queue_alert_minutes"
      | "restart_loop_alert_count"
    >
  >,
  options: { includePersistedAlerts?: boolean; range?: DetailDateRange } = {},
): Promise<DashboardSummary> {
  const includePersistedAlerts = options.includePersistedAlerts ?? false;
  const todayStart = startOfTodayIso(timezone);
  const todayEnd = new Date().toISOString();
  const weekStart = currentWeekRange(timezone).start;
  const selectedRange = options.range ?? { start: todayStart, end: todayEnd };
  const queryStart = earliestIso([selectedRange.start, todayStart, weekStart]);
  const queryEnd = latestIso([selectedRange.end, todayEnd]);
  const activitySince = minutesAgoIso(RECENT_ACTIVITY_MINUTES);

  const [profilesResult, projectsResult, entriesResult, activityResult, screenshotsResult, persistedAlertsResult, agentHealthResult, appLaunchesResult] = await Promise.all([
    supabase
      .from("profiles")
      .select("id,email,full_name,role,is_active,last_seen_at,hourly_rate,expected_hours_per_week,schedule_type,shift_start_time,shift_end_time,working_days")
      .eq("role", "va")
      .eq("is_active", true)
      .order("full_name", { ascending: true }),
    supabase.from("projects").select("id,name"),
    supabase
      .from("time_entries")
      .select("id,user_id,project_id,started_at,stopped_at,duration_seconds,is_manual,manual_note,stop_reason,device_id,device_hostname,device_os_username,device_fingerprint")
      .lte("started_at", queryEnd)
      .or(`stopped_at.is.null,stopped_at.gte.${queryStart}`),
    supabase
      .from("activity_logs")
      .select("id,user_id,time_entry_id,timestamp,activity_percent")
      .gte("timestamp", earliestIso([selectedRange.start, todayStart]))
      .lte("timestamp", queryEnd)
      .order("timestamp", { ascending: false })
      .limit(1000),
    supabase
      .from("screenshots")
      .select("id,user_id,time_entry_id,project_id,captured_at,storage_key,file_size_bytes,activity_percent_at_capture")
      .gte("captured_at", selectedRange.start)
      .lte("captured_at", selectedRange.end)
      .order("captured_at", { ascending: false })
      .limit(500),
    supabase
      .from("dashboard_alerts")
      .select("alert_key,user_id,va_name,severity,type,title,message")
      .eq("is_active", true),
    supabase
      .from("agent_health_snapshots")
      .select("user_id,install_id,hostname,app_version,queue_size,oldest_queue_item_at,screenshot_failure_started_at,screenshot_failure_count,last_screenshot_uploaded_at,last_health_ping_at"),
    supabase
      .from("agent_app_launch_events")
      .select("user_id,launched_at,app_version")
      .gte("launched_at", todayStart),
  ]);

  if (profilesResult.error) throw profilesResult.error;
  if (projectsResult.error) throw projectsResult.error;
  if (entriesResult.error) throw entriesResult.error;
  if (activityResult.error) throw activityResult.error;
  if (screenshotsResult.error) throw screenshotsResult.error;
  if (persistedAlertsResult.error && persistedAlertsResult.error.code !== "42P01") throw persistedAlertsResult.error;
  if (agentHealthResult.error && agentHealthResult.error.code !== "42P01") throw agentHealthResult.error;
  if (appLaunchesResult.error && appLaunchesResult.error.code !== "42P01") throw appLaunchesResult.error;

  const profiles = (profilesResult.data ?? []) as Profile[];
  const projects = (projectsResult.data ?? []) as Project[];
  const entries = (entriesResult.data ?? []) as TimeEntry[];
  const activityLogs = (activityResult.data ?? []) as ActivityLog[];
  const screenshots = await addSignedScreenshotUrls(supabase, latestScreenshotPerUser((screenshotsResult.data ?? []) as Omit<Screenshot, "signedUrl">[]));
  const persistedAlerts = (includePersistedAlerts ? ((persistedAlertsResult.data ?? []) as PersistedDashboardAlert[]) : []).map((alert) => ({
    id: alert.alert_key,
    message: alert.message,
    severity: alert.severity,
    title: alert.title,
    type: alert.type,
    userId: alert.user_id,
    vaName: alert.va_name,
  }));
  const persistedAlertsByUser = groupAlertsByUser(persistedAlerts);
  const agentHealthByUser = newestHealthSnapshotByUser((agentHealthResult.data ?? []) as AgentHealthSnapshot[]);
  const launchEventsByUser = groupLaunchEventsByUser((appLaunchesResult.data ?? []) as AgentAppLaunchEvent[]);
  const screenshotsByUser = new Map(screenshots.map((screenshot) => [screenshot.user_id, screenshot]));
  const projectNames = new Map(projects.map((project) => [project.id, project.name]));
  const now = Date.now();

  const rows = profiles.map((profile) => {
    const userEntries = entries.filter((entry) => entry.user_id === profile.id);
    const userTodayEntries = userEntries.filter((entry) => new Date(entry.started_at).getTime() >= new Date(todayStart).getTime());
    const activeEntry = userEntries.find((entry) => !entry.stopped_at) ?? null;
    const latestEntry = newestEntry(userEntries);
    const userLogs = activityLogs.filter((log) => log.user_id === profile.id);
    const userRangeLogs = userLogs.filter((log) => isWithinRange(log.timestamp, selectedRange));
    const latestLog = newestActivity(userLogs);
    const recentLogs = userLogs.filter((log) => new Date(log.timestamp).getTime() >= new Date(activitySince).getTime());
    const activityPercent = averageActivity(userRangeLogs) ?? latestLog?.activity_percent ?? null;
    const baseStatus = getStatus(activeEntry, latestEntry, profile.last_seen_at, now);
    const status = getDisplayStatus(profile, activeEntry, latestEntry, userTodayEntries, baseStatus, timezone, now);
    const scheduleStatus = getScheduleStatus(profile, userTodayEntries, timezone, now);
    const connectivityGraceMinutes = Number(settings?.connectivity_grace_minutes ?? "10");
    const hoursTodaySeconds = totalSecondsInRange(userEntries, selectedRange, now, profile.last_seen_at, status, connectivityGraceMinutes);
    const weeklyHoursSeconds = totalSecondsInRange(userEntries, currentWeekRange(timezone), now, profile.last_seen_at, status, connectivityGraceMinutes);
    const hourlyRate = Number(profile.hourly_rate ?? 0);
    const lowActivityThreshold = Number(settings?.low_activity_threshold ?? LOW_ACTIVITY_THRESHOLD);
    const calculatedAlerts = buildDashboardAlerts({
      activeEntry,
      agentHealth: agentHealthByUser.get(profile.id) ?? null,
      activityPercent,
      appLaunches: launchEventsByUser.get(profile.id) ?? [],
      latestEntry,
      lowActivityMinimumMinutes: Number((settings as Partial<AppSettings> | undefined)?.low_activity_minimum_minutes ?? "15"),
      lowActivityStreakMinutes: lowActivityStreakMinutes(userLogs, lowActivityThreshold),
      now,
      queueAlertCount: Number(settings?.offline_queue_alert_count ?? "5"),
      queueAlertMinutes: Number(settings?.offline_queue_alert_minutes ?? "10"),
      connectionLossResumeAlertCount: CONNECTION_LOSS_RESUME_ALERT_COUNT,
      todayEntries: userTodayEntries,
      profile,
      restartLoopAlertCount: Number(settings?.restart_loop_alert_count ?? "3"),
      scheduleStatus,
      screenshotFailureAlertMinutes: Number(settings?.screenshot_failure_alert_minutes ?? "15"),
      status,
      threshold: lowActivityThreshold,
      timezone,
    });
    const rowAlerts = mergeAlerts(calculatedAlerts, persistedAlertsByUser.get(profile.id) ?? []);

    const displayProjectEntry = activeEntry ?? (status === "on_break" || status === "idle" || status === "stopped" ? latestEntry : null);

    return {
      userId: profile.id,
      name: profile.full_name,
      email: profile.email,
      status,
      statusDetail: buildStatusDetail(status, latestEntry, profile.last_seen_at, now),
      scheduleStatus,
      currentProject: displayProjectEntry?.project_id ? projectNames.get(displayProjectEntry.project_id) ?? "Assigned Project" : "-",
      currentProjectId: displayProjectEntry?.project_id ?? null,
      hoursTodaySeconds,
      weeklyHoursSeconds,
      expectedWeekSeconds: Math.round(Number(profile.expected_hours_per_week ?? 0) * 3600),
      earningsToday: earningsForSeconds(hoursTodaySeconds, hourlyRate),
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
  const totalHoursWeekSeconds = rows.reduce((sum, row) => sum + row.weeklyHoursSeconds, 0);
  const totalEarningsToday = rows.reduce((sum, row) => sum + row.earningsToday, 0);
  const onlineRows = rows.filter((row) => row.status === "working" || row.status === "on_break");
  const averageActivityPercent = averageActivity(
    rows
      .filter((row) => row.activityPercent !== null)
      .map((row) => ({ activity_percent: row.activityPercent ?? 0 }) as ActivityLog),
  ) ?? 0;
  const alerts = rows.flatMap((row) => row.alerts);

  return {
    totalHoursTodaySeconds,
    totalHoursWeekSeconds,
    totalEarningsToday,
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

export async function loadVaDetail(
  supabase: SupabaseClient,
  userId: string,
  range?: DetailDateRange,
  timezone = "Asia/Karachi",
  settings?: Partial<Pick<AppSettings, "connectivity_grace_minutes">>,
): Promise<VaDetail> {
  const selectedRange = range ?? { start: startOfTodayIso(timezone), end: new Date().toISOString() };

  const [profileResult, projectsResult, assignmentsResult, entriesResult, activityResult, screenshotsResult, userDevicesResult, agentHealthResult, agentEventsResult] = await Promise.all([
    supabase
      .from("profiles")
      .select("id,email,full_name,role,is_active,last_seen_at,hourly_rate,schedule_type,shift_start_time,shift_end_time,working_days")
      .eq("id", userId)
      .eq("role", "va")
      .maybeSingle(),
    supabase.from("projects").select("id,name,is_active"),
    supabase.from("project_assignments").select("project_id").eq("user_id", userId),
    supabase
      .from("time_entries")
      .select("id,user_id,project_id,started_at,stopped_at,duration_seconds,is_manual,manual_note,stop_reason,device_id,device_hostname,device_os_username,device_fingerprint")
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
      .limit(1000),
    supabase
      .from("user_devices")
      .select("id,user_id,hostname,os_username,first_seen_at,last_login_at,last_seen_at")
      .eq("user_id", userId),
    supabase
      .from("agent_health_snapshots")
      .select("user_id,install_id,hostname,app_version,queue_size,oldest_queue_item_at,screenshot_failure_started_at,screenshot_failure_count,last_screenshot_uploaded_at,last_health_ping_at")
      .eq("user_id", userId)
      .order("last_health_ping_at", { ascending: false })
      .limit(1),
    supabase
      .from("agent_events")
      .select("id,user_id,install_id,hostname,app_version,event_type,severity,message,details,occurred_at")
      .eq("user_id", userId)
      .gte("occurred_at", selectedRange.start)
      .lte("occurred_at", selectedRange.end)
      .order("occurred_at", { ascending: false })
      .limit(50),
  ]);

  if (profileResult.error) throw profileResult.error;
  if (projectsResult.error) throw projectsResult.error;
  if (assignmentsResult.error) throw assignmentsResult.error;
  if (entriesResult.error) throw entriesResult.error;
  if (activityResult.error) throw activityResult.error;
  if (screenshotsResult.error) throw screenshotsResult.error;
  if (userDevicesResult.error) throw userDevicesResult.error;
  if (agentHealthResult.error) throw agentHealthResult.error;
  if (agentEventsResult.error) throw agentEventsResult.error;
  if (!profileResult.data) throw new Error("VA profile was not found.");

  const profile = profileResult.data as Profile;
  const projects = (projectsResult.data ?? []) as Project[];
  const assignedProjectIds = new Set((assignmentsResult.data ?? []).map((assignment) => assignment.project_id as string));
  const entries = (entriesResult.data ?? []) as TimeEntry[];
  const activityLogs = (activityResult.data ?? []) as ActivityLog[];
  const screenshotRows = (screenshotsResult.data ?? []) as Omit<Screenshot, "signedUrl">[];
  const userDevices = (userDevicesResult.data ?? []) as UserDevice[];
  const latestAgentHealth = ((agentHealthResult.data ?? []) as AgentHealthSnapshot[])[0] ?? null;
  const agentEvents = (agentEventsResult.data ?? []) as AgentEvent[];
  const screenshots = await addSignedScreenshotUrls(supabase, screenshotRows.slice(0, 60));
  const screenshotsForMetrics = screenshotRows.map((screenshot) => ({ ...screenshot, signedUrl: null }));
  const projectNames = new Map(projects.map((project) => [project.id, project.name]));
  const activeEntry = entries.find((entry) => !entry.stopped_at) ?? null;
  const latestEntry = newestEntry(entries);
  const lastDevice = newestDevice(userDevices);
  const status = getStatus(activeEntry, latestEntry, profile.last_seen_at, Date.now());
  const connectivityGraceMinutes = Number(settings?.connectivity_grace_minutes ?? "10");
  const hourlyRate = Number(profile.hourly_rate ?? 0);
  const weekRange = currentWeekRange(timezone);
  const monthRange = currentMonthRange(timezone);
  const weekSeconds = totalSecondsInRange(entries, weekRange, Date.now(), profile.last_seen_at, status, connectivityGraceMinutes);
  const monthSeconds = totalSecondsInRange(entries, monthRange, Date.now(), profile.last_seen_at, status, connectivityGraceMinutes);

  return {
    profile,
    lastDevice,
    latestAgentHealth,
    totalHoursTodaySeconds: totalSecondsInRange(entries, selectedRange, Date.now(), profile.last_seen_at, status, connectivityGraceMinutes),
    totalHoursWeekSeconds: weekSeconds,
    totalHoursMonthSeconds: monthSeconds,
    earningsThisWeek: earningsForSeconds(weekSeconds, hourlyRate),
    earningsThisMonth: earningsForSeconds(monthSeconds, hourlyRate),
    averageActivityPercent: averageActivity(activityLogs) ?? 0,
    productivityScore: productivityScore(averageActivity(activityLogs) ?? 0),
    screenshotCount: screenshotRows.length,
    lastSeenAt: profile.last_seen_at,
    timeline: entries.map((entry) => toTimelineSegment(entry, projectNames, selectedRange, profile.last_seen_at, status, connectivityGraceMinutes)),
    screenshots,
    activityLogs,
    appUsage: buildAppUsage(activityLogs),
    agentEvents,
    dailyPay: buildDailyPay(entries, selectedRange, timezone, hourlyRate, Date.now(), profile.last_seen_at, status, connectivityGraceMinutes),
    projectOptions: projects
      .filter((project) => project.is_active !== false && assignedProjectIds.has(project.id))
      .sort((first, second) => first.name.localeCompare(second.name)),
    timeEntries: entries.map((entry) => ({
      ...entry,
      ...timeEntryMetrics(entry, activityLogs, screenshotsForMetrics),
      projectName: entry.project_id ? projectNames.get(entry.project_id) ?? "Assigned Project" : "-",
    })),
    rangeStart: selectedRange.start,
    rangeEnd: selectedRange.end,
  };
}

function currentWeekRange(timezone: string): DetailDateRange {
  const todayInput = todayDateInputValue(timezone);
  const startDate = dateFromInput(todayInput);
  const daysSinceMonday = (startDate.getDay() + 6) % 7;
  startDate.setDate(startDate.getDate() - daysSinceMonday);
  return {
    start: startOfDayIso(inputFromDate(startDate), timezone),
    end: new Date().toISOString(),
  };
}

function currentMonthRange(timezone: string): DetailDateRange {
  const todayInput = todayDateInputValue(timezone);
  const startDate = dateFromInput(todayInput);
  startDate.setDate(1);
  return {
    start: startOfDayIso(inputFromDate(startDate), timezone),
    end: new Date().toISOString(),
  };
}

function startOfTodayIso(timezone: string): string {
  return startOfDayIso(todayDateInputValue(timezone), timezone);
}

function earliestIso(values: string[]): string {
  return values.reduce((earliest, value) => (new Date(value).getTime() < new Date(earliest).getTime() ? value : earliest));
}

function latestIso(values: string[]): string {
  return values.reduce((latest, value) => (new Date(value).getTime() > new Date(latest).getTime() ? value : latest));
}

function isWithinRange(value: string, range: DetailDateRange) {
  const timestamp = new Date(value).getTime();
  return timestamp >= new Date(range.start).getTime() && timestamp <= new Date(range.end).getTime();
}

function minutesAgoIso(minutes: number): string {
  return new Date(Date.now() - minutes * 60 * 1000).toISOString();
}

function newestEntry(entries: TimeEntry[]): TimeEntry | null {
  return [...entries].sort((a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime())[0] ?? null;
}

function newestDevice(devices: UserDevice[]): UserDevice | null {
  return (
    [...devices].sort((first, second) => latestDeviceTimestamp(second) - latestDeviceTimestamp(first))[0] ?? null
  );
}

function newestActivity(logs: ActivityLog[]): ActivityLog | null {
  return [...logs].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())[0] ?? null;
}

function latestDeviceTimestamp(device: UserDevice) {
  return Math.max(
    new Date(device.last_seen_at ?? device.first_seen_at).getTime(),
    new Date(device.last_login_at ?? device.first_seen_at).getTime(),
  );
}

function getDisplayStatus(
  profile: Profile,
  activeEntry: TimeEntry | null,
  latestEntry: TimeEntry | null,
  todayEntries: TimeEntry[],
  baseStatus: DashboardRow["status"],
  timezone: string,
  now: number,
): DashboardRow["status"] {
  const scheduleType = normalizedScheduleType(profile);
  const workingDays = profile.working_days ?? [];
  if (baseStatus !== "offline") return baseStatus;
  if (scheduleType === "fixed" && workingDays.length && !workingDays.includes(weekdayKey(new Date(), timezone)) && !todayEntries.length) {
    return "day_off";
  }
  return "offline";
}

function getScheduleStatus(
  profile: Profile,
  todayEntries: TimeEntry[],
  timezone: string,
  now: number,
): DashboardRow["scheduleStatus"] {
  const scheduleType = normalizedScheduleType(profile);
  if (scheduleType !== "fixed") return "flexible";

  const workingDays = profile.working_days ?? [];
  if (!workingDays.length || !profile.shift_start_time || !profile.shift_end_time) return "not_set";
  if (!workingDays.includes(weekdayKey(new Date(), timezone))) return "day_off";

  const todayInput = todayDateInputValue(timezone);
  const lateStartAt = zonedDateTimeToUtc(todayInput, safeTime(profile.shift_start_time, "09:00"), timezone).getTime();
  const workEndAt = zonedDateTimeToUtc(todayInput, safeTime(profile.shift_end_time, "17:00"), timezone).getTime();
  const firstEntry = [...todayEntries].sort((first, second) => new Date(first.started_at).getTime() - new Date(second.started_at).getTime())[0];

  if (firstEntry) {
    return new Date(firstEntry.started_at).getTime() <= lateStartAt ? "on_time" : "late";
  }

  if (now >= workEndAt) return "no_show";
  if (now >= lateStartAt) return "late";
  return "on_time";
}

function weekdayKey(value: Date, timezone: string) {
  return new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "short" }).format(value).toLowerCase().slice(0, 3);
}

function normalizedScheduleType(profile: Profile) {
  if (profile.schedule_type === "fixed") return "fixed";
  if ((profile.working_days ?? []).length > 0) return "fixed";
  return "flexible";
}

function safeTime(value: string | undefined, fallback: string) {
  return /^\d{2}:\d{2}$/.test(value ?? "") ? value! : fallback;
}

function totalSecondsToday(
  entries: TimeEntry[],
  now: number,
  lastSeenAt: string | null,
  status: DashboardRow["status"],
  connectivityGraceMinutes: number,
): number {
  return entries.reduce((sum, entry) => {
    if (entry.stopped_at) {
      return sum + (entry.duration_seconds ?? 0);
    }

    const endTime = resolvedOpenEntryEndTime(now, lastSeenAt, status, connectivityGraceMinutes);
    return sum + Math.max(0, Math.floor((endTime - new Date(entry.started_at).getTime()) / 1000));
  }, 0);
}

function totalSecondsInRange(
  entries: TimeEntry[],
  range: DetailDateRange,
  now: number,
  lastSeenAt: string | null,
  status: DashboardRow["status"],
  connectivityGraceMinutes: number,
): number {
  const rangeStart = new Date(range.start).getTime();
  const rangeEnd = new Date(range.end).getTime();

  return entries.reduce((sum, entry) => {
    const entryStart = new Date(entry.started_at).getTime();
    const entryEnd = entry.stopped_at
      ? new Date(entry.stopped_at).getTime()
      : Math.min(resolvedOpenEntryEndTime(now, lastSeenAt, status, connectivityGraceMinutes), rangeEnd);
    const clampedStart = Math.max(entryStart, rangeStart);
    const clampedEnd = Math.min(entryEnd, rangeEnd);
    return sum + Math.max(0, Math.floor((clampedEnd - clampedStart) / 1000));
  }, 0);
}

function buildDailyPay(
  entries: TimeEntry[],
  range: DetailDateRange,
  timezone: string,
  hourlyRate: number,
  now: number,
  lastSeenAt: string | null,
  status: DashboardRow["status"],
  connectivityGraceMinutes: number,
) {
  const rows = new Map<string, number>();
  const rangeStart = new Date(range.start).getTime();
  const rangeEnd = new Date(range.end).getTime();

  for (const entry of entries) {
    const entryStart = new Date(entry.started_at).getTime();
    const entryEnd = entry.stopped_at
      ? new Date(entry.stopped_at).getTime()
      : Math.min(resolvedOpenEntryEndTime(now, lastSeenAt, status, connectivityGraceMinutes), rangeEnd);
    const clampedStart = Math.max(entryStart, rangeStart);
    const clampedEnd = Math.min(entryEnd, rangeEnd);
    const seconds = Math.max(0, Math.floor((clampedEnd - clampedStart) / 1000));
    if (!seconds) continue;

    const dateKey = dateInputValue(new Date(clampedStart), timezone);
    rows.set(dateKey, (rows.get(dateKey) ?? 0) + seconds);
  }

  return [...rows.entries()]
    .sort(([first], [second]) => first.localeCompare(second))
    .map(([date, seconds]) => ({
      date,
      earnings: earningsForSeconds(seconds, hourlyRate),
      seconds,
    }));
}

function earningsForSeconds(seconds: number, hourlyRate: number) {
  return Number(((seconds / 3600) * hourlyRate).toFixed(2));
}

function dateFromInput(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date();
  date.setFullYear(year, month - 1, day);
  date.setHours(0, 0, 0, 0);
  return date;
}

function inputFromDate(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function averageActivity(logs: Array<Pick<ActivityLog, "activity_percent">>): number | null {
  if (!logs.length) return null;
  return logs.reduce((sum, log) => sum + Number(log.activity_percent ?? 0), 0) / logs.length;
}

function lowActivityStreakMinutes(logs: ActivityLog[], threshold: number): number {
  const sortedLogs = [...logs].sort((first, second) => new Date(second.timestamp).getTime() - new Date(first.timestamp).getTime());
  let minutes = 0;

  for (const log of sortedLogs) {
    if (Number(log.activity_percent ?? 0) >= threshold) break;
    minutes += 1;
  }

  return minutes;
}

function productivityScore(activityPercent: number | null): number {
  if (activityPercent === null) return 0;
  return Math.max(0, Math.min(100, Math.round(activityPercent)));
}

function timeEntryMetrics(entry: TimeEntry, logs: ActivityLog[], screenshots: Screenshot[]) {
  const entryLogs = logs.filter((log) => log.time_entry_id === entry.id && isWithinEntryBounds(log.timestamp, entry));
  const averageActivityPercent = averageActivity(entryLogs);

  return {
    averageActivityPercent,
    idleMinutes: entryLogs.filter((log) => Number(log.activity_percent ?? 0) === 0).length,
    productivityScore: productivityScore(averageActivityPercent),
    screenshotsTaken: screenshots.filter((screenshot) => screenshot.time_entry_id === entry.id && isWithinEntryBounds(screenshot.captured_at, entry)).length,
    totalKeystrokes: entryLogs.reduce((sum, log) => sum + Number(log.keystrokes_count ?? 0), 0),
    totalMouseClicks: entryLogs.reduce((sum, log) => sum + Number(log.mouse_clicks_count ?? 0), 0),
  };
}

function isWithinEntryBounds(value: string, entry: TimeEntry) {
  const timestamp = new Date(value).getTime();
  const startedAt = new Date(entry.started_at).getTime();
  const rawEndedAt = entry.stopped_at ? new Date(entry.stopped_at).getTime() : Number.POSITIVE_INFINITY;
  const endedAt = Math.max(startedAt, rawEndedAt);

  return timestamp >= startedAt && timestamp <= endedAt;
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

function groupAlertsByUser(alerts: DashboardAlert[]) {
  const grouped = new Map<string, DashboardAlert[]>();
  for (const alert of alerts) {
    grouped.set(alert.userId, [...(grouped.get(alert.userId) ?? []), alert]);
  }
  return grouped;
}

function mergeAlerts(calculatedAlerts: DashboardAlert[], persistedAlerts: DashboardAlert[]) {
  const merged = new Map<string, DashboardAlert>();
  for (const alert of [...persistedAlerts, ...calculatedAlerts]) {
    merged.set(alert.id, alert);
  }
  return [...merged.values()].sort((first, second) => severityRank(second.severity) - severityRank(first.severity));
}

function newestHealthSnapshotByUser(snapshots: AgentHealthSnapshot[]) {
  const result = new Map<string, AgentHealthSnapshot>();
  for (const snapshot of snapshots) {
    const current = result.get(snapshot.user_id);
    if (!current || new Date(snapshot.last_health_ping_at).getTime() > new Date(current.last_health_ping_at).getTime()) {
      result.set(snapshot.user_id, snapshot);
    }
  }
  return result;
}

function groupLaunchEventsByUser(events: AgentAppLaunchEvent[]) {
  const result = new Map<string, AgentAppLaunchEvent[]>();
  for (const event of events) {
    const bucket = result.get(event.user_id) ?? [];
    bucket.push(event);
    result.set(event.user_id, bucket);
  }
  return result;
}

function severityRank(severity: DashboardAlert["severity"]) {
  return severity === "critical" ? 2 : 1;
}

function buildDashboardAlerts({
  activeEntry,
  agentHealth,
  activityPercent,
  appLaunches,
  latestEntry,
  lowActivityMinimumMinutes,
  lowActivityStreakMinutes,
  now,
  queueAlertCount,
  queueAlertMinutes,
  connectionLossResumeAlertCount,
  profile,
  restartLoopAlertCount,
  scheduleStatus,
  screenshotFailureAlertMinutes,
  status,
  threshold,
  todayEntries,
  timezone,
}: {
  activeEntry: TimeEntry | null;
  agentHealth: AgentHealthSnapshot | null;
  activityPercent: number | null;
  appLaunches: AgentAppLaunchEvent[];
  todayEntries: TimeEntry[];
  latestEntry: TimeEntry | null;
  lowActivityMinimumMinutes: number;
  lowActivityStreakMinutes: number;
  now: number;
  queueAlertCount: number;
  queueAlertMinutes: number;
  connectionLossResumeAlertCount: number;
  profile: Profile;
  restartLoopAlertCount: number;
  scheduleStatus: DashboardRow["scheduleStatus"];
  screenshotFailureAlertMinutes: number;
  status: DashboardRow["status"];
  threshold: number;
  timezone: string;
}): DashboardAlert[] {
  const alerts: DashboardAlert[] = [];
  const lastSeenAgeMinutes = profile.last_seen_at ? (now - new Date(profile.last_seen_at).getTime()) / 60000 : null;
  const healthPingAgeMinutes = agentHealth ? (now - new Date(agentHealth.last_health_ping_at).getTime()) / 60000 : null;

  if (status === "working" && activityPercent !== null && lowActivityStreakMinutes >= lowActivityMinimumMinutes) {
    alerts.push({
      id: `${profile.id}-low-activity`,
      userId: profile.id,
      vaName: profile.full_name,
      severity: "warning",
      type: "low_activity",
      title: "Low activity",
      message: `${Math.round(activityPercent)}% recent activity after ${lowActivityStreakMinutes}+ low-activity minutes.`,
    });
  }

  if (scheduleStatus === "late") {
    alerts.push({
      id: `${profile.id}-late-start`,
      userId: profile.id,
      vaName: profile.full_name,
      severity: "warning",
      type: "late_start",
      title: "Late start",
      message: "Scheduled VA has not started on time today.",
    });
  }

  if (scheduleStatus === "no_show") {
    alerts.push({
      id: `${profile.id}-no-show`,
      userId: profile.id,
      vaName: profile.full_name,
      severity: "critical",
      type: "no_show",
      title: "No show",
      message: "Scheduled VA did not track any time today.",
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

  if ((latestEntry?.stop_reason === "crash" || latestEntry?.stop_reason === "connection_lost") && latestEntry.stopped_at && new Date(latestEntry.stopped_at).getTime() >= new Date(startOfTodayIso(timezone)).getTime()) {
    alerts.push({
      id: `${profile.id}-crash-closed-${latestEntry.id}`,
      userId: profile.id,
      vaName: profile.full_name,
      severity: "critical",
      type: "crash_closed",
      title: "Session auto-closed",
      message:
        latestEntry.stop_reason === "connection_lost"
          ? `Tracking stopped after connection loss at ${formatTime(latestEntry.stopped_at, timezone)}.`
          : `A stale open timer was closed as a crash at ${formatTime(latestEntry.stopped_at, timezone)}.`,
    });
  }

  const connectionLossResumeCount = countConnectionLossResumesToday(todayEntries);
  if (connectionLossResumeCount >= connectionLossResumeAlertCount) {
    alerts.push({
      id: `${profile.id}-connection-loss-resumes`,
      userId: profile.id,
      vaName: profile.full_name,
      severity: "warning",
      type: "connection_loss_resumes",
      title: "Repeated connection-loss resumes",
      message: `Tracking had to be resumed ${connectionLossResumeCount} time${connectionLossResumeCount === 1 ? "" : "s"} today after connection loss.`,
    });
  }

  if (
    agentHealth?.screenshot_failure_started_at &&
    healthPingAgeMinutes !== null &&
    healthPingAgeMinutes <= ONLINE_HEARTBEAT_MINUTES &&
    (now - new Date(agentHealth.screenshot_failure_started_at).getTime()) / 60000 >= screenshotFailureAlertMinutes
  ) {
    alerts.push({
      id: `${profile.id}-screenshot-sync`,
      userId: profile.id,
      vaName: profile.full_name,
      severity: "warning",
      type: "screenshot_sync",
      title: "Screenshot sync failing",
      message: `Screenshot uploads have been failing for ${Math.floor((now - new Date(agentHealth.screenshot_failure_started_at).getTime()) / 60000)} minutes.`,
    });
  }

  if (
    agentHealth &&
    healthPingAgeMinutes !== null &&
    healthPingAgeMinutes <= ONLINE_HEARTBEAT_MINUTES &&
    agentHealth.queue_size >= queueAlertCount &&
    agentHealth.oldest_queue_item_at &&
    (now - new Date(agentHealth.oldest_queue_item_at).getTime()) / 60000 >= queueAlertMinutes
  ) {
    alerts.push({
      id: `${profile.id}-queue-backlog`,
      userId: profile.id,
      vaName: profile.full_name,
      severity: "warning",
      type: "queue_backlog",
      title: "Offline queue backlog",
      message: `${agentHealth.queue_size} queued sync items are waiting, and the oldest has been stuck for ${Math.floor((now - new Date(agentHealth.oldest_queue_item_at).getTime()) / 60000)} minutes.`,
    });
  }

  const launchCount = launchesInCurrentShift(profile, appLaunches, timezone, now);
  if (launchCount >= restartLoopAlertCount) {
    alerts.push({
      id: `${profile.id}-restart-loop`,
      userId: profile.id,
      vaName: profile.full_name,
      severity: "critical",
      type: "restart_loop",
      title: "Possible crash loop",
      message: `The desktop app has started ${launchCount} times in the current shift window.`,
    });
  }

  return alerts;
}

function launchesInCurrentShift(profile: Profile, appLaunches: AgentAppLaunchEvent[], timezone: string, now: number) {
  if (!appLaunches.length) return 0;

  let windowStart = new Date(startOfTodayIso(timezone)).getTime();
  if (normalizedScheduleType(profile) === "fixed" && profile.shift_start_time && (profile.working_days ?? []).includes(weekdayKey(new Date(now), timezone))) {
    windowStart = zonedDateTimeToUtc(todayDateInputValue(timezone), safeTime(profile.shift_start_time, "09:00"), timezone).getTime();
  }

  return appLaunches.filter((event) => new Date(event.launched_at).getTime() >= windowStart).length;
}

function countConnectionLossResumesToday(entries: TimeEntry[]) {
  const sorted = [...entries].sort((first, second) => new Date(first.started_at).getTime() - new Date(second.started_at).getTime());
  let resumes = 0;

  for (let index = 0; index < sorted.length - 1; index += 1) {
    if (sorted[index]?.stop_reason !== "connection_lost") continue;
    if (new Date(sorted[index + 1].started_at).getTime() > new Date(sorted[index].started_at).getTime()) {
      resumes += 1;
    }
  }

  return resumes;
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
  connectivityGraceMinutes: number,
): TimelineSegment {
  const rangeStart = new Date(range.start).getTime();
  const rangeEnd = new Date(range.end).getTime();
  const rawEndTime = entry.stopped_at
    ? new Date(entry.stopped_at).getTime()
    : resolvedOpenEntryEndTime(Date.now(), lastSeenAt, status, connectivityGraceMinutes);
  const displayStartTime = Math.max(new Date(entry.started_at).getTime(), rangeStart);
  // Never let a rendered segment end before it begins, even when stale heartbeat
  // data makes an open session's derived cutoff earlier than its recorded start.
  const displayEndTime = Math.max(displayStartTime, Math.min(rawEndTime, rangeEnd));
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
    isManual: Boolean(entry.is_manual),
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
    if (lastSeenAgeMinutes <= ONLINE_HEARTBEAT_MINUTES) return "working";
    return "sync_delayed";
  }

  if (activeEntry) {
    return "sync_delayed";
  }

  if (!latestEntry) {
    return "offline";
  }

  const stoppedAtMs = latestEntry.stopped_at ? new Date(latestEntry.stopped_at).getTime() : null;
  const stoppedAgeMinutes = stoppedAtMs === null ? null : (now - stoppedAtMs) / 60000;

  if (latestEntry.stop_reason === "break") {
    const lastSeenAgeMinutes = lastSeenAt ? (now - new Date(lastSeenAt).getTime()) / 60000 : null;
    if (lastSeenAgeMinutes !== null && lastSeenAgeMinutes <= ONLINE_HEARTBEAT_MINUTES) return "on_break";
    return "stopped";
  }

  if (latestEntry.stop_reason === "idle") {
    if (stoppedAgeMinutes !== null && stoppedAgeMinutes <= RECENT_NON_WORKING_MINUTES) return "idle";
    return "stopped";
  }

  if (latestEntry.stop_reason === "manual") {
    return "stopped";
  }

  if (latestEntry.stop_reason === "app_close" || latestEntry.stop_reason === "crash" || latestEntry.stop_reason === "connection_lost") {
    return "offline";
  }

  return "offline";
}

function buildStatusDetail(
  status: DashboardRow["status"],
  latestEntry: TimeEntry | null,
  lastSeenAt: string | null,
  now: number,
) {
  if (status === "working") {
    return lastSeenAt ? `Last activity ${relativeTimeFrom(lastSeenAt, now)}` : "Working now";
  }

  if (status === "sync_delayed") {
    return lastSeenAt ? `Sync delayed, last heartbeat ${relativeTimeFrom(lastSeenAt, now)}` : "Sync delayed, waiting for heartbeat";
  }

  if (status === "on_break") {
    return latestEntry?.stopped_at ? `Break started ${relativeTimeFrom(latestEntry.stopped_at, now)}` : "On break";
  }

  if (status === "idle") {
    return latestEntry?.stopped_at ? `Idle since ${relativeTimeFrom(latestEntry.stopped_at, now)}` : "Idle";
  }

  if (status === "stopped") {
    return latestEntry?.stopped_at ? `Stopped ${relativeTimeFrom(latestEntry.stopped_at, now)}` : "Not working";
  }

  if (status === "day_off") {
    return "Scheduled day off";
  }

  if (latestEntry?.stop_reason === "app_close" && latestEntry.stopped_at) {
    return `App closed ${relativeTimeFrom(latestEntry.stopped_at, now)}`;
  }

  if (latestEntry?.stop_reason === "crash" && latestEntry.stopped_at) {
    return `Connection lost ${relativeTimeFrom(latestEntry.stopped_at, now)}`;
  }

  if (lastSeenAt) {
    return `Last active ${relativeTimeFrom(lastSeenAt, now)}`;
  }

  return "No recent activity";
}

function relativeTimeFrom(value: string, now: number) {
  const minutes = Math.max(0, Math.floor((now - new Date(value).getTime()) / 60000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours < 24) {
    return remainingMinutes ? `${hours}h ${remainingMinutes}m ago` : `${hours}h ago`;
  }
  const days = Math.floor(hours / 24);
  return days === 1 ? "1 day ago" : `${days} days ago`;
}

function resolvedOpenEntryEndTime(
  now: number,
  lastSeenAt: string | null,
  status: DashboardRow["status"],
  connectivityGraceMinutes: number,
) {
  if (status === "working") return now;
  if (!lastSeenAt) return now;
  return Math.min(new Date(lastSeenAt).getTime() + Math.max(1, connectivityGraceMinutes) * 60 * 1000, now);
}
