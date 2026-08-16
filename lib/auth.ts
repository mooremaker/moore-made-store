import type { User } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export type AppRole = "customer" | "admin";

export async function getCurrentUser(): Promise<User | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();
  if (error) return null;
  return data.user ?? null;
}

export async function getUserRole(userId: string): Promise<AppRole> {
  const { data } = await getSupabaseAdmin()
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .maybeSingle();
  return data?.role === "admin" ? "admin" : "customer";
}

export async function getAdminAuthState() {
  const supabase = await createSupabaseServerClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  const user = userData.user ?? null;
  if (userError || !user) return { user: null, isAdmin: false, hasMfa: false, aal2: false };

  const role = await getUserRole(user.id);
  if (role !== "admin") return { user, isAdmin: false, hasMfa: false, aal2: false };

  const [{ data: factors }, { data: aal }] = await Promise.all([
    supabase.auth.mfa.listFactors(),
    supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
  ]);
  const hasMfa = Boolean(factors?.totp?.some((factor: { status: string }) => factor.status === "verified"));
  const aal2 = aal?.currentLevel === "aal2";
  return { user, isAdmin: true, hasMfa, aal2 };
}

export async function requireAdminApi() {
  const state = await getAdminAuthState();
  if (!state.user) return { ok: false as const, status: 401, error: "Sign in required." };
  if (!state.isAdmin) return { ok: false as const, status: 403, error: "Admin access required." };
  if (!state.hasMfa || !state.aal2) return { ok: false as const, status: 403, error: "Admin MFA verification required." };
  return { ok: true as const, user: state.user };
}

export async function claimVerifiedGuestRecords(user: User) {
  const email = user.email?.trim().toLowerCase();
  if (!email || !user.email_confirmed_at) return;
  const admin = getSupabaseAdmin();
  await Promise.all([
    admin.from("custom_requests").update({ customer_user_id: user.id }).is("customer_user_id", null).eq("email", email),
    admin.from("showcase_posts").update({ customer_user_id: user.id }).is("customer_user_id", null).eq("email", email),
  ]);
}
