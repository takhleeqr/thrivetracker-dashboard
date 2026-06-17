import type { SupabaseClient } from "@supabase/supabase-js";

export type ManagedProject = {
  id: string;
  name: string;
  description: string | null;
  color: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  assignedUserIds: string[];
  assignedNames: string[];
  totalHoursSeconds: number;
  lastActivityAt: string | null;
};

export type VaOption = {
  id: string;
  full_name: string;
  email: string;
  is_active: boolean;
};

export type ProjectFormInput = {
  id?: string;
  name: string;
  description: string;
  color: string;
  isActive: boolean;
  assignedUserIds: string[];
};

type ProjectRow = {
  id: string;
  name: string;
  description: string | null;
  color: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

type AssignmentRow = {
  user_id: string;
  project_id: string;
};

type TimeEntryRow = {
  project_id: string | null;
  started_at: string;
  stopped_at: string | null;
  duration_seconds: number | null;
};

export async function loadProjectsManagement(supabase: SupabaseClient) {
  const [projectsResult, vasResult, assignmentsResult, entriesResult] = await Promise.all([
    supabase.from("projects").select("id,name,description,color,is_active,created_at,updated_at").order("created_at", {
      ascending: false,
    }),
    supabase
      .from("profiles")
      .select("id,full_name,email,is_active")
      .eq("role", "va")
      .order("full_name", { ascending: true }),
    supabase.from("project_assignments").select("user_id,project_id"),
    supabase
      .from("time_entries")
      .select("project_id,started_at,stopped_at,duration_seconds")
      .order("started_at", { ascending: false })
      .limit(5000),
  ]);

  if (projectsResult.error) throw projectsResult.error;
  if (vasResult.error) throw vasResult.error;
  if (assignmentsResult.error) throw assignmentsResult.error;
  if (entriesResult.error) throw entriesResult.error;

  const projects = (projectsResult.data ?? []) as ProjectRow[];
  const vas = (vasResult.data ?? []) as VaOption[];
  const assignments = (assignmentsResult.data ?? []) as AssignmentRow[];
  const entries = (entriesResult.data ?? []) as TimeEntryRow[];
  const vaNames = new Map(vas.map((va) => [va.id, va.full_name]));

  return {
    projects: projects.map((project) => {
      const projectAssignments = assignments.filter((assignment) => assignment.project_id === project.id);
      const projectEntries = entries.filter((entry) => entry.project_id === project.id);

      return {
        ...project,
        assignedUserIds: projectAssignments.map((assignment) => assignment.user_id),
        assignedNames: projectAssignments.map((assignment) => vaNames.get(assignment.user_id) ?? "Unknown VA"),
        totalHoursSeconds: projectEntries.reduce((sum, entry) => sum + (entry.duration_seconds ?? 0), 0),
        lastActivityAt: newestActivity(projectEntries),
      } satisfies ManagedProject;
    }),
    vas,
  };
}

export async function saveProject(supabase: SupabaseClient, input: ProjectFormInput, adminUserId: string): Promise<void> {
  const trimmedName = input.name.trim();
  if (!trimmedName) {
    throw new Error("Project name is required.");
  }

  const payload = {
    name: trimmedName,
    description: input.description.trim() || null,
    color: input.color || "#2563EB",
    is_active: input.isActive,
  };

  let projectId = input.id;

  if (projectId) {
    const { error } = await supabase.from("projects").update(payload).eq("id", projectId);
    if (error) throw error;
  } else {
    const { data, error } = await supabase
      .from("projects")
      .insert({ ...payload, created_by: adminUserId })
      .select("id")
      .single();

    if (error) throw error;
    projectId = data.id;
  }

  if (!projectId) {
    throw new Error("Project was saved but no project id was returned.");
  }

  await syncAssignments(supabase, projectId, input.assignedUserIds);
}

export async function deactivateProject(supabase: SupabaseClient, projectId: string): Promise<void> {
  const { error } = await supabase.from("projects").update({ is_active: false }).eq("id", projectId);
  if (error) throw error;
}

async function syncAssignments(supabase: SupabaseClient, projectId: string, assignedUserIds: string[]): Promise<void> {
  const { error: deleteError } = await supabase.from("project_assignments").delete().eq("project_id", projectId);
  if (deleteError) throw deleteError;

  if (!assignedUserIds.length) {
    return;
  }

  const rows = assignedUserIds.map((userId) => ({
    project_id: projectId,
    user_id: userId,
  }));
  const { error: insertError } = await supabase.from("project_assignments").insert(rows);
  if (insertError) throw insertError;
}

function newestActivity(entries: TimeEntryRow[]): string | null {
  const newest = [...entries].sort((first, second) => {
    const firstTime = new Date(first.stopped_at ?? first.started_at).getTime();
    const secondTime = new Date(second.stopped_at ?? second.started_at).getTime();
    return secondTime - firstTime;
  })[0];

  return newest ? newest.stopped_at ?? newest.started_at : null;
}
