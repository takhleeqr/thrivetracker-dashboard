import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

export type ManagedVa = {
  id: string;
  full_name: string;
  email: string;
  is_active: boolean;
  created_at: string;
  expectedHoursPerWeek: number;
  lastSeenAt: string | null;
  hourlyRate: number;
  totalHoursSeconds: number;
  assignedProjectIds: string[];
  assignedProjects: {
    id: string;
    name: string;
    isActive: boolean;
  }[];
  scheduleType: "flexible" | "fixed";
  shiftStartTime: string | null;
  shiftEndTime: string | null;
  workingDays: string[];
  lastDevice: {
    hostname: string;
    os_username: string | null;
    first_seen_at: string;
    last_login_at: string;
    last_seen_at: string | null;
  } | null;
  latestAgentVersion: string | null;
};

export type VaFormInput = {
  id?: string;
  fullName: string;
  email: string;
  password?: string;
  isActive: boolean;
  expectedHoursPerWeek: string;
  hourlyRate: string;
  assignedProjectIds: string[];
  scheduleType: "flexible" | "fixed";
  shiftStartTime: string;
  shiftEndTime: string;
  workingDays: string[];
};

export type TeamProjectOption = {
  id: string;
  name: string;
};

type ProfileRow = {
  id: string;
  full_name: string;
  email: string;
  is_active: boolean;
  expected_hours_per_week: number;
  hourly_rate: number;
  created_at: string;
  last_seen_at: string | null;
  schedule_type: "flexible" | "fixed" | null;
  shift_start_time: string | null;
  shift_end_time: string | null;
  working_days: string[];
};

type TimeEntryRow = {
  user_id: string;
  duration_seconds: number | null;
};

type AssignmentRow = {
  user_id: string;
  project_id: string;
};

type ProjectRow = {
  id: string;
  name: string;
  is_active: boolean;
};

type UserDeviceRow = {
  id: string;
  user_id: string;
  hostname: string;
  os_username: string | null;
  first_seen_at: string;
  last_login_at: string;
  last_seen_at: string | null;
};

type AgentHealthRow = {
  user_id: string;
  app_version: string | null;
  last_health_ping_at: string;
};

export async function loadTeamManagement(supabase: SupabaseClient): Promise<{ projects: TeamProjectOption[]; team: ManagedVa[] }> {
  const weekStart = startOfWeekIso();
  const [profilesResult, entriesResult, projectsResult, assignmentsResult, devicesResult, agentHealthResult] = await Promise.all([
    supabase
      .from("profiles")
      .select("id,full_name,email,is_active,created_at,last_seen_at,hourly_rate,expected_hours_per_week,schedule_type,shift_start_time,shift_end_time,working_days")
      .eq("role", "va")
      .order("full_name", { ascending: true }),
    supabase.from("time_entries").select("user_id,duration_seconds").gte("started_at", weekStart),
    supabase.from("projects").select("id,name,is_active"),
    supabase.from("project_assignments").select("user_id,project_id"),
    supabase.from("user_devices").select("id,user_id,hostname,os_username,first_seen_at,last_login_at,last_seen_at"),
    supabase.from("agent_health_snapshots").select("user_id,app_version,last_health_ping_at"),
  ]);

  if (profilesResult.error) throw profilesResult.error;
  if (entriesResult.error) throw entriesResult.error;
  if (projectsResult.error) throw projectsResult.error;
  if (assignmentsResult.error) throw assignmentsResult.error;
  if (devicesResult.error) throw devicesResult.error;
  if (agentHealthResult.error && agentHealthResult.error.code !== "42P01") throw agentHealthResult.error;

  const profiles = (profilesResult.data ?? []) as ProfileRow[];
  const entries = (entriesResult.data ?? []) as TimeEntryRow[];
  const assignments = (assignmentsResult.data ?? []) as AssignmentRow[];
  const projects = (projectsResult.data ?? []) as ProjectRow[];
  const devices = (devicesResult.data ?? []) as UserDeviceRow[];
  const healthRows = (agentHealthResult.data ?? []) as AgentHealthRow[];
  const projectById = new Map(projects.map((project) => [project.id, project]));
  const latestDeviceByUser = new Map<string, UserDeviceRow>();
  const latestVersionByUser = new Map<string, AgentHealthRow>();

  for (const device of devices) {
    const current = latestDeviceByUser.get(device.user_id);
    if (!current || latestDeviceTimestamp(device) > latestDeviceTimestamp(current)) {
      latestDeviceByUser.set(device.user_id, device);
    }
  }

  for (const health of healthRows) {
    const current = latestVersionByUser.get(health.user_id);
    if (!current || new Date(health.last_health_ping_at).getTime() > new Date(current.last_health_ping_at).getTime()) {
      latestVersionByUser.set(health.user_id, health);
    }
  }

  return {
    team: profiles.map((profile) => {
      const userEntries = entries.filter((entry) => entry.user_id === profile.id);
      const userAssignments = assignments.filter((assignment) => assignment.user_id === profile.id);
      const assignedProjects = userAssignments.map((assignment) => {
        const project = projectById.get(assignment.project_id);

        return {
          id: assignment.project_id,
          isActive: project?.is_active ?? false,
          name: project?.name ?? "Unknown project",
        };
      });

      return {
        id: profile.id,
        full_name: profile.full_name,
        email: profile.email,
        expectedHoursPerWeek: Number(profile.expected_hours_per_week ?? 0),
        hourlyRate: Number(profile.hourly_rate ?? 0),
        is_active: profile.is_active,
        created_at: profile.created_at,
        lastSeenAt: profile.last_seen_at,
        totalHoursSeconds: userEntries.reduce((sum, entry) => sum + (entry.duration_seconds ?? 0), 0),
        assignedProjectIds: assignedProjects.filter((project) => project.isActive).map((project) => project.id),
        assignedProjects,
        scheduleType: profile.schedule_type === "fixed" ? "fixed" : "flexible",
        shiftStartTime: profile.shift_start_time,
        shiftEndTime: profile.shift_end_time,
        workingDays: profile.working_days ?? [],
        lastDevice: latestDeviceByUser.get(profile.id) ?? null,
        latestAgentVersion: latestVersionByUser.get(profile.id)?.app_version ?? null,
      };
    }),
    projects: projects.filter((project) => project.is_active).map((project) => ({ id: project.id, name: project.name })),
  };
}

function latestDeviceTimestamp(device: UserDeviceRow) {
  return Math.max(
    new Date(device.last_seen_at ?? device.first_seen_at).getTime(),
    new Date(device.last_login_at ?? device.first_seen_at).getTime(),
  );
}

export async function saveVa(input: VaFormInput): Promise<void> {
  const response = await fetch("/api/team", {
    body: JSON.stringify(input),
    headers: await authHeaders(),
    method: input.id ? "PATCH" : "POST",
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }
}

export async function deactivateVa(userId: string): Promise<void> {
  const response = await fetch("/api/team", {
    body: JSON.stringify({ id: userId }),
    headers: await authHeaders(),
    method: "DELETE",
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }
}

export async function reactivateVa(va: ManagedVa): Promise<void> {
  await saveVa({
    assignedProjectIds: va.assignedProjectIds,
    email: va.email,
    expectedHoursPerWeek: String(va.expectedHoursPerWeek ?? 0),
    fullName: va.full_name,
    hourlyRate: String(va.hourlyRate ?? 0),
    id: va.id,
    isActive: true,
    password: "",
    scheduleType: va.scheduleType,
    shiftEndTime: va.shiftEndTime ?? "17:00",
    shiftStartTime: va.shiftStartTime ?? "09:00",
    workingDays: va.workingDays,
  });
}

async function authHeaders(): Promise<HeadersInit> {
  const {
    data: { session },
  } = await supabase.auth.getSession();

  return {
    authorization: `Bearer ${session?.access_token ?? ""}`,
    "content-type": "application/json",
  };
}

function startOfWeekIso(): string {
  const date = new Date();
  const day = date.getDay();
  const daysSinceMonday = (day + 6) % 7;
  date.setDate(date.getDate() - daysSinceMonday);
  date.setHours(0, 0, 0, 0);
  return date.toISOString();
}
