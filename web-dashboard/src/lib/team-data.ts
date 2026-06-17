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
  assignedProjects: string[];
  workingDays: string[];
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
};

export async function loadTeamManagement(supabase: SupabaseClient): Promise<{ projects: TeamProjectOption[]; team: ManagedVa[] }> {
  const weekStart = startOfWeekIso();
  const [profilesResult, entriesResult, projectsResult, assignmentsResult] = await Promise.all([
    supabase
      .from("profiles")
      .select("id,full_name,email,is_active,created_at,last_seen_at,hourly_rate,expected_hours_per_week,working_days")
      .eq("role", "va")
      .order("full_name", { ascending: true }),
    supabase.from("time_entries").select("user_id,duration_seconds").gte("started_at", weekStart),
    supabase.from("projects").select("id,name"),
    supabase.from("project_assignments").select("user_id,project_id"),
  ]);

  if (profilesResult.error) throw profilesResult.error;
  if (entriesResult.error) throw entriesResult.error;
  if (projectsResult.error) throw projectsResult.error;
  if (assignmentsResult.error) throw assignmentsResult.error;

  const profiles = (profilesResult.data ?? []) as ProfileRow[];
  const entries = (entriesResult.data ?? []) as TimeEntryRow[];
  const assignments = (assignmentsResult.data ?? []) as AssignmentRow[];
  const projects = (projectsResult.data ?? []) as ProjectRow[];
  const projectNames = new Map(projects.map((project) => [project.id, project.name]));

  return {
    team: profiles.map((profile) => {
      const userEntries = entries.filter((entry) => entry.user_id === profile.id);
      const userAssignments = assignments.filter((assignment) => assignment.user_id === profile.id);

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
        assignedProjectIds: userAssignments.map((assignment) => assignment.project_id),
        assignedProjects: userAssignments.map((assignment) => projectNames.get(assignment.project_id) ?? "Unknown"),
        workingDays: profile.working_days ?? [],
      };
    }),
    projects: projects.map((project) => ({ id: project.id, name: project.name })),
  };
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
