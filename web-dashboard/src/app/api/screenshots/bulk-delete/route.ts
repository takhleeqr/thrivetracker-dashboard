import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  try {
    const supabase = createClient(requiredUrl(), requiredServiceRoleKey(), {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const adminError = await requireAdmin(request, supabase);
    if (adminError) return adminError;

    const payload = (await request.json()) as { ids?: string[] };
    const ids = [...new Set(payload.ids ?? [])].filter(Boolean);
    if (!ids.length) return new NextResponse("No screenshots selected.", { status: 400 });

    const { data, error } = await supabase.from("screenshots").select("id,storage_key").in("id", ids);
    if (error) throw error;

    const rows = (data ?? []) as Array<{ id: string; storage_key: string }>;
    const storageKeys = rows.map((row) => row.storage_key).filter(Boolean);
    if (storageKeys.length) {
      const { error: storageError } = await supabase.storage.from(storageBucket()).remove(storageKeys);
      if (storageError) throw storageError;
    }

    const { error: deleteError } = await supabase
      .from("screenshots")
      .delete()
      .in("id", rows.map((row) => row.id));
    if (deleteError) throw deleteError;

    return NextResponse.json({ deleted: rows.length, ok: true });
  } catch (error) {
    return new NextResponse(error instanceof Error ? error.message : "Could not delete screenshots.", { status: 500 });
  }
}

async function requireAdmin(request: NextRequest, supabase: any): Promise<NextResponse | null> {
  const token = request.headers.get("authorization")?.replace("Bearer ", "");
  if (!token) return new NextResponse("Not authenticated.", { status: 401 });

  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  if (userError || !userData.user) return new NextResponse("Not authenticated.", { status: 401 });

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("role,is_active")
    .eq("id", userData.user.id)
    .maybeSingle();
  if (profileError) throw profileError;
  if (!profile || profile.role !== "admin" || !profile.is_active) {
    return new NextResponse("Admin access required.", { status: 403 });
  }

  return null;
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
