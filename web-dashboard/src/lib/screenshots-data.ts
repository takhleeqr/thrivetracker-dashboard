import type { SupabaseClient } from "@supabase/supabase-js";
import { endOfDayIso, startOfDayIso, zonedDateTimeToUtc } from "@/lib/timezone";

export type ScreenshotFilter = {
  userId?: string;
  projectId?: string;
  date: string;
  startTime?: string;
  endTime?: string;
  timezone?: string;
  offset: number;
  limit: number;
};

export type ScreenshotBrowserItem = {
  id: string;
  user_id: string;
  project_id: string | null;
  time_entry_id: string;
  captured_at: string;
  storage_key: string;
  file_size_bytes: number | null;
  activity_percent_at_capture: number | null;
  signedUrl: string | null;
  vaName: string;
  projectName: string;
};

export type ScreenshotOption = {
  id: string;
  name: string;
};

type ScreenshotRow = Omit<ScreenshotBrowserItem, "signedUrl" | "vaName" | "projectName">;

const SCREENSHOT_BUCKET = process.env.NEXT_PUBLIC_SUPABASE_STORAGE_BUCKET ?? "screenshots";

export async function loadScreenshotFilters(supabase: SupabaseClient): Promise<{
  projects: ScreenshotOption[];
  vas: ScreenshotOption[];
}> {
  const [vasResult, projectsResult] = await Promise.all([
    supabase.from("profiles").select("id,full_name").eq("role", "va").order("full_name", { ascending: true }),
    supabase.from("projects").select("id,name").order("name", { ascending: true }),
  ]);

  if (vasResult.error) throw vasResult.error;
  if (projectsResult.error) throw projectsResult.error;

  return {
    vas: (vasResult.data ?? []).map((va) => ({ id: va.id, name: va.full_name })),
    projects: (projectsResult.data ?? []).map((project) => ({ id: project.id, name: project.name })),
  };
}

export async function loadScreenshots(
  supabase: SupabaseClient,
  filter: ScreenshotFilter,
): Promise<{
  hasMore: boolean;
  items: ScreenshotBrowserItem[];
}> {
  const { start, end } = buildScreenshotRange(filter);
  let query = supabase
    .from("screenshots")
    .select("id,user_id,project_id,time_entry_id,captured_at,storage_key,file_size_bytes,activity_percent_at_capture")
    .gte("captured_at", start)
    .lte("captured_at", end)
    .order("captured_at", { ascending: false })
    .range(filter.offset, filter.offset + filter.limit);

  if (filter.userId) {
    query = query.eq("user_id", filter.userId);
  }

  if (filter.projectId) {
    query = query.eq("project_id", filter.projectId);
  }

  const { data, error } = await query;
  if (error) throw error;

  const rows = (data ?? []) as ScreenshotRow[];
  const visibleRows = rows.slice(0, filter.limit);
  if (!visibleRows.length) {
    return {
      hasMore: false,
      items: [],
    };
  }

  const [profilesResult, projectsResult] = await Promise.all([
    supabase.from("profiles").select("id,full_name").in("id", unique(visibleRows.map((row) => row.user_id))),
    supabase.from("projects").select("id,name").in("id", unique(visibleRows.map((row) => row.project_id).filter(Boolean) as string[])),
  ]);

  if (profilesResult.error) throw profilesResult.error;
  if (projectsResult.error) throw projectsResult.error;

  const vaNames = new Map((profilesResult.data ?? []).map((profile) => [profile.id, profile.full_name]));
  const projectNames = new Map((projectsResult.data ?? []).map((project) => [project.id, project.name]));

  const items = await Promise.all(
    visibleRows.map(async (row) => {
      const { data: signedUrlData, error: signedUrlError } = await supabase.storage
        .from(SCREENSHOT_BUCKET)
        .createSignedUrl(row.storage_key, 10 * 60);

      return {
        ...row,
        signedUrl: signedUrlError ? null : signedUrlData.signedUrl,
        vaName: vaNames.get(row.user_id) ?? "Unknown VA",
        projectName: row.project_id ? projectNames.get(row.project_id) ?? "Project" : "-",
      } satisfies ScreenshotBrowserItem;
    }),
  );

  return {
    hasMore: rows.length > filter.limit,
    items,
  };
}

function buildScreenshotRange(filter: ScreenshotFilter) {
  const timezone = filter.timezone ?? "Asia/Karachi";
  const start = filter.startTime ? zonedDateTimeToUtc(filter.date, filter.startTime, timezone).toISOString() : startOfDayIso(filter.date, timezone);
  const end = filter.endTime ? zonedDateTimeToUtc(filter.date, filter.endTime, timezone, 59, 999).toISOString() : endOfDayIso(filter.date, timezone);

  return {
    start,
    end,
  };
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
