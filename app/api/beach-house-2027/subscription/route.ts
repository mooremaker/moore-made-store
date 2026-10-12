import { publicSiteUrl } from "@/lib/email";
import { sameOrigin } from "@/lib/beach-house-email";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export async function POST(request: Request) {
  if (!sameOrigin(request)) return new Response("Please use the confirmation page.", { status: 403 });
  const redirect = (result: string) => Response.redirect(`${publicSiteUrl()}/beach-house-2027/email?result=${result}`, 303);
  try {
    const form = await request.formData();
    const token = String(form.get("token") || "");
    const action = String(form.get("action") || "");
    if (!/^[a-f0-9]{64}$/.test(token) || !["confirm", "unsubscribe"].includes(action)) return redirect("expired");
    const db = getSupabaseAdmin();
    if (action === "unsubscribe") {
      const { data, error } = await db.from("beach_house_subscribers").update({ status: "stopped" }).eq("unsubscribe_token", token).select("id").maybeSingle();
      if (error) throw error;
      return redirect(data ? "stopped" : "expired");
    }
    const { data, error } = await db.from("beach_house_subscribers").update({ status: "active", confirmed_at: new Date().toISOString() }).eq("confirmation_token", token).eq("status", "pending").gt("confirmation_expires_at", new Date().toISOString()).select("id").maybeSingle();
    if (error) throw error;
    if (data) return redirect("confirmed");
    // Re-opening an already confirmed link is safe; stopped subscriptions cannot be reactivated this way.
    const { data: active, error: activeError } = await db.from("beach_house_subscribers").select("id").eq("confirmation_token", token).eq("status", "active").maybeSingle();
    if (activeError) throw activeError;
    return redirect(active ? "confirmed" : "expired");
  } catch {
    console.error("Beach house subscription could not be updated.");
    return redirect("unavailable");
  }
}
