import { NextRequest, NextResponse } from "next/server";



type VaPayload = {
  assignedProjectIds?: string[];
  id?: string;
  fullName?: string;
  email?: string;
  expectedHoursPerWeek?: string | number;
  password?: string;
  hourlyRate?: string | number;
  isActive?: boolean;
  workingDays?: string[];
};

const validWorkingDays = new Set(["mon", "tue", "wed", "thu", "fri", "sat", "sun"]);

export async function POST(request: NextRequest) {
  try {
    const adminError = await requireAdmin(request);
    if (adminError) return adminError;

    const payload = (await request.json()) as VaPayload;
    const fullName = payload.fullName?.trim();
    const email = payload.email?.trim();

    if (!fullName || !email || !payload.password) {
      return textError("Name, email, and password are required.", 400);
    }

    const createdUser = await supabaseAdminFetch<{ id?: string; user?: { id: string } }>("/auth/v1/admin/users", {
      body: JSON.stringify({
        email,
        email_confirm: true,
        password: payload.password,
        user_metadata: { full_name: fullName },
      }),
      method: "POST",
    });

    const userId = createdUser.user?.id ?? createdUser.id;
    if (!userId) return textError("Supabase did not return the new user id.", 500);

    await upsertProfile({
      email,
      expectedHoursPerWeek: numberFromPayload(payload.expectedHoursPerWeek, 0),
      fullName,
      hourlyRate: numberFromPayload(payload.hourlyRate, 0),
      id: userId,
      isActive: payload.isActive ?? true,
      workingDays: safeWorkingDays(payload.workingDays),
    });
    await syncAssignments(userId, payload.assignedProjectIds ?? []);

    return NextResponse.json({ id: userId });
  } catch (error: any) {
    return textError(`[POST Error]: ${error.message}`, 500);
  }
}

export async function PATCH(request: NextRequest) {
  const adminError = await requireAdmin(request);
  if (adminError) return adminError;

  const payload = (await request.json()) as VaPayload;
  const fullName = payload.fullName?.trim();
  const email = payload.email?.trim();

  if (!payload.id || !fullName || !email) {
    return textError("VA id, name, and email are required.", 400);
  }

  await supabaseAdminFetch(`/auth/v1/admin/users/${payload.id}`, {
    body: JSON.stringify({
      email,
      ...(payload.password ? { password: payload.password } : {}),
      user_metadata: { full_name: fullName },
    }),
    method: "PUT",
  });

  await updateProfile(payload.id, {
    email,
    expected_hours_per_week: numberFromPayload(payload.expectedHoursPerWeek, 0),
    full_name: fullName,
    hourly_rate: numberFromPayload(payload.hourlyRate, 0),
    is_active: payload.isActive ?? true,
    working_days: safeWorkingDays(payload.workingDays),
  });
  await syncAssignments(payload.id, payload.assignedProjectIds ?? []);

  return NextResponse.json({ ok: true });
}

export async function DELETE(request: NextRequest) {
  const adminError = await requireAdmin(request);
  if (adminError) return adminError;

  const payload = (await request.json()) as VaPayload;
  if (!payload.id) return textError("VA id is required.", 400);

  await updateProfile(payload.id, { is_active: false });
  return NextResponse.json({ ok: true });
}

async function requireAdmin(request: NextRequest): Promise<NextResponse | null> {
  const authHeader = request.headers.get("authorization");
  const cookieHeader = request.headers.get("cookie");
  const accessToken = authHeader?.replace("Bearer ", "") ?? extractSupabaseToken(cookieHeader);

  if (!accessToken) return textError("Not authenticated.", 401);

  const userResponse = await fetch(`${requiredUrl()}/auth/v1/user`, {
    headers: {
      apikey: requiredServiceRoleKey(),
      authorization: `Bearer ${accessToken}`,
    },
  });

  if (!userResponse.ok) return textError("Not authenticated.", 401);

  const user = (await userResponse.json()) as { id?: string };
  if (!user.id) return textError("Not authenticated.", 401);

  const profiles = await supabaseAdminFetch<Array<{ role: string; is_active: boolean }>>(
    `/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}&select=role,is_active`,
  );
  const profile = profiles[0];

  if (!profile || profile.role !== "admin" || !profile.is_active) {
    return textError("Admin access required.", 403);
  }

  return null;
}

async function upsertProfile(input: {
  email: string;
  expectedHoursPerWeek: number;
  fullName: string;
  hourlyRate: number;
  id: string;
  isActive: boolean;
  workingDays: string[];
}) {
  await supabaseAdminFetch("/rest/v1/profiles?on_conflict=id", {
    body: JSON.stringify({
      email: input.email,
      expected_hours_per_week: input.expectedHoursPerWeek,
      full_name: input.fullName,
      hourly_rate: input.hourlyRate,
      id: input.id,
      is_active: input.isActive,
      role: "va",
      working_days: input.workingDays,
    }),
    headers: { prefer: "resolution=merge-duplicates" },
    method: "POST",
  });
}

async function updateProfile(id: string, payload: Record<string, string | boolean | number | string[]>) {
  await supabaseAdminFetch(`/rest/v1/profiles?id=eq.${encodeURIComponent(id)}`, {
    body: JSON.stringify(payload),
    headers: { prefer: "return=minimal" },
    method: "PATCH",
  });
}

function numberFromPayload(value: string | number | undefined, fallback: number) {
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return parsed;
}

function safeWorkingDays(value: string[] | undefined) {
  return [...new Set(value ?? [])].filter((day) => validWorkingDays.has(day));
}

async function syncAssignments(userId: string, assignedProjectIds: string[]) {
  await supabaseAdminFetch(`/rest/v1/project_assignments?user_id=eq.${encodeURIComponent(userId)}`, {
    headers: { prefer: "return=minimal" },
    method: "DELETE",
  });

  if (!assignedProjectIds.length) return;

  await supabaseAdminFetch("/rest/v1/project_assignments", {
    body: JSON.stringify(
      assignedProjectIds.map((projectId) => ({
        project_id: projectId,
        user_id: userId,
      })),
    ),
    headers: { prefer: "return=minimal" },
    method: "POST",
  });
}

async function supabaseAdminFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${requiredUrl()}${path}`, {
    ...init,
    headers: {
      apikey: requiredServiceRoleKey(),
      authorization: `Bearer ${requiredServiceRoleKey()}`,
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  const text = await response.text();
  if (!text) return {} as T;
  return JSON.parse(text) as T;
}

function extractSupabaseToken(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  const tokenCookie = cookieHeader
    .split(";")
    .map((cookie) => cookie.trim())
    .find((cookie) => cookie.includes("auth-token") || cookie.includes("supabase"));

  if (!tokenCookie) return null;

  try {
    const value = decodeURIComponent(tokenCookie.split("=").slice(1).join("="));
    const parsed = JSON.parse(value) as { access_token?: string } | Array<{ access_token?: string }>;
    if (Array.isArray(parsed)) return parsed[0]?.access_token ?? null;
    return parsed.access_token ?? null;
  } catch {
    return null;
  }
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

function textError(message: string, status: number): NextResponse {
  return new NextResponse(message, { status });
}
