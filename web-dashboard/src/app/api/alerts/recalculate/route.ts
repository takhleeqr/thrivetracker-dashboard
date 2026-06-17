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
    const summary = await loadDashboardSummary(supabase, settings.timezone || defaultSettings.timezone, settings);
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

    return NextResponse.json({
      activeAlerts: activeAlerts.length,
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

  if (isVercelCronRequest(request)) {
    return null;
  }

  if (!configuredSecret) return new NextResponse("Missing CRON_SECRET.", { status: 500 });

  if (providedSecret !== configuredSecret) {
    return new NextResponse("Unauthorized.", { status: 401 });
  }

  return null;
}

function isVercelCronRequest(request: NextRequest) {
  const userAgent = request.headers.get("user-agent") ?? "";
  return process.env.VERCEL_ENV === "production" && userAgent.includes("vercel-cron");
}

function quotePostgrestValue(value: string) {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
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
