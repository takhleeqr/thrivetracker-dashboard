import type { SupabaseClient } from "@supabase/supabase-js";

export type AppSettings = {
  app_categories_unproductive: string;
  connectivity_grace_minutes: string;
  data_retention_days: string;
  idle_timeout_minutes: string;
  late_start_time: string;
  low_activity_minimum_minutes: string;
  low_activity_threshold: string;
  max_screenshots_per_day: string;
  offline_queue_alert_count: string;
  offline_queue_alert_minutes: string;
  restart_loop_alert_count: string;
  screenshot_interval_minutes: string;
  screenshot_failure_alert_minutes: string;
  screenshot_quality: string;
  shift_start_reminder_delay_minutes: string;
  timezone: string;
  work_end_time: string;
  work_start_time: string;
};

export const defaultSettings: AppSettings = {
  app_categories_unproductive: "[]",
  connectivity_grace_minutes: "10",
  data_retention_days: "90",
  idle_timeout_minutes: "5",
  late_start_time: "10:00",
  low_activity_minimum_minutes: "15",
  low_activity_threshold: "30",
  max_screenshots_per_day: "200",
  offline_queue_alert_count: "5",
  offline_queue_alert_minutes: "10",
  restart_loop_alert_count: "3",
  screenshot_interval_minutes: "5",
  screenshot_failure_alert_minutes: "15",
  screenshot_quality: "60",
  shift_start_reminder_delay_minutes: "10",
  timezone: "Asia/Karachi",
  work_end_time: "17:00",
  work_start_time: "09:00",
};

export async function loadSettings(supabase: SupabaseClient): Promise<AppSettings> {
  const { data, error } = await supabase.from("settings").select("key,value");
  if (error) throw error;

  const nextSettings = { ...defaultSettings };
  for (const row of data ?? []) {
    if (row.key in nextSettings) {
      nextSettings[row.key as keyof AppSettings] = row.value;
    }
  }

  return nextSettings;
}

export async function saveSettings(supabase: SupabaseClient, settings: AppSettings): Promise<void> {
  validateSettings(settings);

  const rows = Object.entries(settings).map(([key, value]) => ({
    key,
    value,
    description: descriptionForKey(key),
  }));

  const { error } = await supabase.from("settings").upsert(rows, { onConflict: "key" });
  if (error) throw error;
}

function validateSettings(settings: AppSettings) {
  ensureNumber(settings.screenshot_interval_minutes, "Screenshot interval", 1, 120);
  ensureNumber(settings.screenshot_quality, "Screenshot quality", 1, 100);
  ensureNumber(settings.idle_timeout_minutes, "Idle timeout", 1, 120);
  ensureNumber(settings.connectivity_grace_minutes, "Connection-loss grace", 1, 30);
  ensureNumber(settings.low_activity_threshold, "Low activity threshold", 0, 100);
  ensureNumber(settings.low_activity_minimum_minutes, "Low activity minutes", 1, 240);
  ensureNumber(settings.data_retention_days, "Retention days", 1, 3650);
  ensureNumber(settings.max_screenshots_per_day, "Max screenshots per day", 1, 2000);
  ensureNumber(settings.offline_queue_alert_count, "Offline queue alert count", 1, 500);
  ensureNumber(settings.offline_queue_alert_minutes, "Offline queue alert age", 1, 240);
  ensureNumber(settings.restart_loop_alert_count, "Restart loop alert count", 2, 25);
  ensureNumber(settings.screenshot_failure_alert_minutes, "Screenshot failure alert age", 1, 240);
  ensureNumber(settings.shift_start_reminder_delay_minutes, "Shift reminder delay", 1, 180);
  validateJsonArray(settings.app_categories_unproductive, "Unproductive app categories");
}

function ensureNumber(value: string, label: string, min: number, max: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    throw new Error(`${label} must be between ${min} and ${max}.`);
  }
}

function descriptionForKey(key: string): string {
  const descriptions: Record<string, string> = {
    app_categories_unproductive: "JSON array of app names marked as unproductive",
    connectivity_grace_minutes: "Minutes to allow brief connection loss before tracked time is stopped",
    data_retention_days: "Auto-delete screenshots older than this",
    idle_timeout_minutes: "Minutes of no activity before auto-pause",
    late_start_time: "Scheduled-day time after which missing VAs are marked late",
    low_activity_minimum_minutes: "Consecutive low-activity minutes before alert fires",
    low_activity_threshold: "Activity percent below this triggers alerts",
    max_screenshots_per_day: "Safety cap per VA per day",
    offline_queue_alert_count: "Queued sync items before an admin alert fires",
    offline_queue_alert_minutes: "Minutes the oldest queued sync item can remain before an admin alert fires",
    restart_loop_alert_count: "App launches within one shift before a restart-loop alert fires",
    screenshot_interval_minutes: "Minutes between screenshot captures",
    screenshot_failure_alert_minutes: "Minutes of ongoing screenshot upload failures before an admin alert fires",
    screenshot_quality: "JPEG quality from 1 to 100",
    shift_start_reminder_delay_minutes: "Minutes after a fixed shift starts before the VA gets a reminder",
    timezone: "Company timezone for reports",
    work_end_time: "Expected work end time",
    work_start_time: "Expected work start time",
  };

  return descriptions[key] ?? key;
}

function validateJsonArray(value: string, label: string) {
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) {
      throw new Error();
    }
  } catch {
    throw new Error(`${label} must be a valid JSON array.`);
  }
}
