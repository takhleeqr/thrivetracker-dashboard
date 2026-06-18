import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

import { loadDashboardSummary } from "@/lib/dashboard-data";
import { defaultSettings, loadSettings } from "@/lib/settings-data";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  return recalculateAlerts(request);
}

export async function POST(request: NextRequest) {
  return recalculateAlerts(request);
}

async function recalculateAlerts(request: NextRequest) {
  try {
    const authError = requireCronSecret(request);
    if (authError) return authError;

    const supabase = createClient(requiredUrl(), requiredServiceRoleKey(), {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const settings = await loadSettings(supabase);
    const summary = await loadDashboardSummary(supabase, settings.timezone || defaultSettings.timezone, settings, {
      includePersistedAlerts: false,
    });
    const activeAlerts = summary.alerts;
    const activeKeys = activeAlerts.map((alert) => alert.id);

    if (activeAlerts.length) {
      const { error: upsertError } = await supabase.from("dashboard_alerts").upsert(
        activeAlerts.map((alert) => ({
          alert_key: alert.id,
          is_active: true,
          last_seen_at: new Date().toISOString(),
          message: alert.message,
          resolved_at: null,
          severity: alert.severity,
          title: alert.title,
          type: alert.type,
          user_id: alert.userId,
          va_name: alert.vaName,
        })),
        { onConflict: "alert_key" },
      );

      if (upsertError) throw upsertError;
    }

    let resolveQuery = supabase
      .from("dashboard_alerts")
      .update({
        is_active: false,
        resolved_at: new Date().toISOString(),
      })
      .eq("is_active", true);

    if (activeKeys.length) {
      resolveQuery = resolveQuery.not("alert_key", "in", `(${activeKeys.map(quotePostgrestValue).join(",")})`);
    }

    const { error: resolveError } = await resolveQuery;
    if (resolveError) throw resolveError;

    const cleanupResult = await cleanupOldData(supabase, Number(settings.data_retention_days ?? "90"));

    return NextResponse.json({
      activeAlerts: activeAlerts.length,
      cleanup: cleanupResult,
      ok: true,
      timezone: settings.timezone,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Alert recalculation failed.";
    return new NextResponse(message, { status: 500 });
  }
}

function requireCronSecret(request: NextRequest): NextResponse | null {
  const configuredSecret = process.env.CRON_SECRET;
  const bearerToken = request.headers.get("authorization")?.replace("Bearer ", "");
  const headerToken = request.headers.get("x-cron-secret");
  const queryToken = request.nextUrl.searchParams.get("secret");
  const providedSecret = bearerToken || headerToken || queryToken;

  if (configuredSecret && providedSecret === configuredSecret) {
    return null;
  }

  if (!configuredSecret) return new NextResponse("Missing CRON_SECRET.", { status: 500 });

  if (providedSecret !== configuredSecret) {
    return new NextResponse("Unauthorized.", { status: 401 });
  }

  return null;
}

function quotePostgrestValue(value: string) {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

async function cleanupOldData(supabase: any, retentionDays: number) {
  if (!Number.isFinite(retentionDays) || retentionDays < 1) {
    return { activityLogsDeleted: 0, screenshotsDeleted: 0 };
  }

  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
  const { data: screenshots, error: screenshotsError } = await supabase
    .from("screenshots")
    .select("id,storage_key")
    .lt("captured_at", cutoff)
    .limit(500);

  if (screenshotsError) throw screenshotsError;

  const screenshotRows = (screenshots ?? []) as Array<{ id: string; storage_key: string }>;
  if (screenshotRows.length) {
    const storageKeys = screenshotRows.map((row) => row.storage_key).filter(Boolean);
    if (storageKeys.length) {
      const { error: storageError } = await supabase.storage.from(storageBucket()).remove(storageKeys);
      if (storageError) throw storageError;
    }

    const { error: deleteScreenshotsError } = await supabase
      .from("screenshots")
      .delete()
      .in("id", screenshotRows.map((row) => row.id));
    if (deleteScreenshotsError) throw deleteScreenshotsError;
  }

  const { count: activityLogsDeleted, error: activityError } = await supabase
    .from("activity_logs")
    .delete({ count: "exact" })
    .lt("timestamp", cutoff);
  if (activityError) throw activityError;

  return {
    activityLogsDeleted: activityLogsDeleted ?? 0,
    screenshotsDeleted: screenshotRows.length,
  };
}

function requiredUrl(): string {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL.");
  return url;
}

function requiredServiceRoleKey(): string {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY.");
  return key;
}

function storageBucket(): string {
  return process.env.NEXT_PUBLIC_SUPABASE_STORAGE_BUCKET ?? process.env.SUPABASE_STORAGE_BUCKET ?? "screenshots";
}
