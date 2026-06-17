import type { SupabaseClient } from "@supabase/supabase-js";
import { dateInputValue, endOfDayIso, startOfDayIso } from "@/lib/timezone";

export type ReportFilter = {
  endDate: string;
  projectId?: string;
  startDate: string;
  timezone?: string;
  userId?: string;
};

export type ReportOption = {
  id: string;
  name: string;
};

export type TimeReportRow = {
  userId: string;
  vaName: string;
  totalSeconds: number;
  earnings: number;
  entryCount: number;
  manualEntries: number;
};

export type ActivityReportRow = {
  userId: string;
  vaName: string;
  averageActivity: number;
  activeMinutes: number;
  keystrokes: number;
  mouseClicks: number;
};

export type AppUsageReportRow = {
  appName: string;
  minutes: number;
  averageActivity: number;
};

export type AttendanceReportRow = {
  userId: string;
  vaName: string;
  daysWorked: number;
  firstStart: string | null;
  lastStop: string | null;
  totalSeconds: number;
};

export type ProjectReportRow = {
  projectId: string;
  projectName: string;
  totalSeconds: number;
  entryCount: number;
  vaCount: number;
};

export type PayrollReportRow = {
  date: string;
  earnings: number;
  hourlyRate: number;
  totalSeconds: number;
  userId: string;
  vaName: string;
};

export type ReportsData = {
  activityRows: ActivityReportRow[];
  appRows: AppUsageReportRow[];
  attendanceRows: AttendanceReportRow[];
  payrollRows: PayrollReportRow[];
  projectRows: ProjectReportRow[];
  timeRows: TimeReportRow[];
};

type ProfileRow = {
  id: string;
  full_name: string;
  hourly_rate: number;
};

type ProjectRow = {
  id: string;
  name: string;
};

type TimeEntryRow = {
  id: string;
  user_id: string;
  project_id: string | null;
  started_at: string;
  stopped_at: string | null;
  duration_seconds: number | null;
  is_manual: boolean;
};

type ActivityLogRow = {
  user_id: string;
  time_entry_id: string;
  timestamp: string;
  activity_percent: number;
  keystrokes_count: number;
  mouse_clicks_count: number;
  active_app_name: string | null;
  active_window_title: string | null;
};

export async function loadReportOptions(supabase: SupabaseClient): Promise<{
  projects: ReportOption[];
  vas: ReportOption[];
}> {
  const [profilesResult, projectsResult] = await Promise.all([
    supabase.from("profiles").select("id,full_name").eq("role", "va").order("full_name", { ascending: true }),
    supabase.from("projects").select("id,name").order("name", { ascending: true }),
  ]);

  if (profilesResult.error) throw profilesResult.error;
  if (projectsResult.error) throw projectsResult.error;

  return {
    vas: (profilesResult.data ?? []).map((profile) => ({ id: profile.id, name: profile.full_name })),
    projects: (projectsResult.data ?? []).map((project) => ({ id: project.id, name: project.name })),
  };
}

export async function loadReports(supabase: SupabaseClient, filter: ReportFilter): Promise<ReportsData> {
  const { start, end } = buildReportRange(filter);

  const [profilesResult, projectsResult, entriesResult, activityResult] = await Promise.all([
    supabase.from("profiles").select("id,full_name,hourly_rate").eq("role", "va"),
    supabase.from("projects").select("id,name"),
    supabase
      .from("time_entries")
      .select("id,user_id,project_id,started_at,stopped_at,duration_seconds,is_manual")
      .gte("started_at", start)
      .lte("started_at", end)
      .order("started_at", { ascending: true })
      .limit(10000),
    supabase
      .from("activity_logs")
      .select("user_id,time_entry_id,timestamp,activity_percent,keystrokes_count,mouse_clicks_count,active_app_name,active_window_title")
      .gte("timestamp", start)
      .lte("timestamp", end)
      .order("timestamp", { ascending: true })
      .limit(20000),
  ]);

  if (profilesResult.error) throw profilesResult.error;
  if (projectsResult.error) throw projectsResult.error;
  if (entriesResult.error) throw entriesResult.error;
  if (activityResult.error) throw activityResult.error;

  const profiles = (profilesResult.data ?? []) as ProfileRow[];
  const projects = (projectsResult.data ?? []) as ProjectRow[];
  const profileNames = new Map(profiles.map((profile) => [profile.id, profile.full_name]));
  const hourlyRates = new Map(profiles.map((profile) => [profile.id, Number(profile.hourly_rate ?? 0)]));
  const projectNames = new Map(projects.map((project) => [project.id, project.name]));

  const entries = ((entriesResult.data ?? []) as TimeEntryRow[]).filter((entry) => {
    if (filter.userId && entry.user_id !== filter.userId) return false;
    if (filter.projectId && entry.project_id !== filter.projectId) return false;
    return true;
  });
  const allowedEntryIds = new Set(entries.map((entry) => entry.id));
  const activityLogs = ((activityResult.data ?? []) as ActivityLogRow[]).filter((log) => {
    if (filter.userId && log.user_id !== filter.userId) return false;
    if (filter.projectId && !allowedEntryIds.has(log.time_entry_id)) return false;
    return true;
  });

  return {
    timeRows: buildTimeRows(entries, profileNames, hourlyRates),
    activityRows: buildActivityRows(activityLogs, profileNames),
    appRows: buildAppRows(activityLogs),
    attendanceRows: buildAttendanceRows(entries, profileNames),
    payrollRows: buildPayrollRows(entries, profileNames, hourlyRates, filter.timezone ?? "Asia/Karachi"),
    projectRows: buildProjectRows(entries, projectNames),
  };
}

export function buildReportRange(filter: ReportFilter) {
  const timezone = filter.timezone ?? "Asia/Karachi";

  return {
    start: startOfDayIso(filter.startDate, timezone),
    end: endOfDayIso(filter.endDate, timezone),
  };
}

function buildTimeRows(entries: TimeEntryRow[], profileNames: Map<string, string>, hourlyRates: Map<string, number>): TimeReportRow[] {
  const rows = new Map<string, TimeReportRow>();

  for (const entry of entries) {
    const row = rows.get(entry.user_id) ?? {
      userId: entry.user_id,
      vaName: profileNames.get(entry.user_id) ?? "Unknown VA",
      totalSeconds: 0,
      earnings: 0,
      entryCount: 0,
      manualEntries: 0,
    };
    row.totalSeconds += entry.duration_seconds ?? 0;
    row.earnings = earningsForSeconds(row.totalSeconds, hourlyRates.get(entry.user_id) ?? 0);
    row.entryCount += 1;
    row.manualEntries += entry.is_manual ? 1 : 0;
    rows.set(entry.user_id, row);
  }

  return [...rows.values()].sort((first, second) => second.totalSeconds - first.totalSeconds);
}

function buildPayrollRows(
  entries: TimeEntryRow[],
  profileNames: Map<string, string>,
  hourlyRates: Map<string, number>,
  timezone: string,
): PayrollReportRow[] {
  const rows = new Map<string, PayrollReportRow>();

  for (const entry of entries) {
    const date = dateInputValue(entry.started_at, timezone);
    const hourlyRate = hourlyRates.get(entry.user_id) ?? 0;
    const key = `${entry.user_id}-${date}`;
    const row = rows.get(key) ?? {
      date,
      earnings: 0,
      hourlyRate,
      totalSeconds: 0,
      userId: entry.user_id,
      vaName: profileNames.get(entry.user_id) ?? "Unknown VA",
    };
    row.totalSeconds += entry.duration_seconds ?? 0;
    row.earnings = earningsForSeconds(row.totalSeconds, hourlyRate);
    rows.set(key, row);
  }

  return [...rows.values()].sort((first, second) => first.date.localeCompare(second.date) || first.vaName.localeCompare(second.vaName));
}

function buildActivityRows(logs: ActivityLogRow[], profileNames: Map<string, string>): ActivityReportRow[] {
  const grouped = new Map<string, { activityTotal: number; logs: number; keystrokes: number; mouseClicks: number }>();

  for (const log of logs) {
    const row = grouped.get(log.user_id) ?? { activityTotal: 0, logs: 0, keystrokes: 0, mouseClicks: 0 };
    row.activityTotal += Number(log.activity_percent ?? 0);
    row.logs += 1;
    row.keystrokes += Number(log.keystrokes_count ?? 0);
    row.mouseClicks += Number(log.mouse_clicks_count ?? 0);
    grouped.set(log.user_id, row);
  }

  return [...grouped.entries()]
    .map(([userId, row]) => ({
      userId,
      vaName: profileNames.get(userId) ?? "Unknown VA",
      averageActivity: row.logs ? row.activityTotal / row.logs : 0,
      activeMinutes: row.logs,
      keystrokes: row.keystrokes,
      mouseClicks: row.mouseClicks,
    }))
    .sort((first, second) => second.averageActivity - first.averageActivity);
}

function buildAppRows(logs: ActivityLogRow[]): AppUsageReportRow[] {
  const rows = new Map<string, { activityTotal: number; minutes: number }>();

  for (const log of logs) {
    const appName = cleanName(log.active_app_name || log.active_window_title || "Unknown");
    const row = rows.get(appName) ?? { activityTotal: 0, minutes: 0 };
    row.activityTotal += Number(log.activity_percent ?? 0);
    row.minutes += 1;
    rows.set(appName, row);
  }

  return [...rows.entries()]
    .map(([appName, row]) => ({
      appName,
      minutes: row.minutes,
      averageActivity: row.minutes ? row.activityTotal / row.minutes : 0,
    }))
    .sort((first, second) => second.minutes - first.minutes);
}

function buildAttendanceRows(entries: TimeEntryRow[], profileNames: Map<string, string>): AttendanceReportRow[] {
  const rows = new Map<string, AttendanceReportRow & { daySet: Set<string> }>();

  for (const entry of entries) {
    const row = rows.get(entry.user_id) ?? {
      userId: entry.user_id,
      vaName: profileNames.get(entry.user_id) ?? "Unknown VA",
      daysWorked: 0,
      firstStart: null,
      lastStop: null,
      totalSeconds: 0,
      daySet: new Set<string>(),
    };
    const dayKey = entry.started_at.slice(0, 10);
    row.daySet.add(dayKey);
    row.firstStart = earliest(row.firstStart, entry.started_at);
    row.lastStop = latest(row.lastStop, entry.stopped_at ?? entry.started_at);
    row.totalSeconds += entry.duration_seconds ?? 0;
    rows.set(entry.user_id, row);
  }

  return [...rows.values()]
    .map(({ daySet, ...row }) => ({
      ...row,
      daysWorked: daySet.size,
    }))
    .sort((first, second) => second.totalSeconds - first.totalSeconds);
}

function buildProjectRows(entries: TimeEntryRow[], projectNames: Map<string, string>): ProjectReportRow[] {
  const rows = new Map<string, ProjectReportRow & { vaIds: Set<string> }>();

  for (const entry of entries) {
    const projectId = entry.project_id ?? "unassigned";
    const row = rows.get(projectId) ?? {
      projectId,
      projectName: entry.project_id ? projectNames.get(entry.project_id) ?? "Project" : "Unassigned",
      totalSeconds: 0,
      entryCount: 0,
      vaCount: 0,
      vaIds: new Set<string>(),
    };
    row.totalSeconds += entry.duration_seconds ?? 0;
    row.entryCount += 1;
    row.vaIds.add(entry.user_id);
    rows.set(projectId, row);
  }

  return [...rows.values()]
    .map(({ vaIds, ...row }) => ({
      ...row,
      vaCount: vaIds.size,
    }))
    .sort((first, second) => second.totalSeconds - first.totalSeconds);
}

function cleanName(value: string): string {
  const trimmed = value.trim();
  return trimmed.length > 64 ? `${trimmed.slice(0, 61)}...` : trimmed || "Unknown";
}

function earliest(current: string | null, candidate: string): string {
  if (!current) return candidate;
  return new Date(candidate).getTime() < new Date(current).getTime() ? candidate : current;
}

function latest(current: string | null, candidate: string): string {
  if (!current) return candidate;
  return new Date(candidate).getTime() > new Date(current).getTime() ? candidate : current;
}

function earningsForSeconds(seconds: number, hourlyRate: number) {
  return Number(((seconds / 3600) * hourlyRate).toFixed(2));
}
