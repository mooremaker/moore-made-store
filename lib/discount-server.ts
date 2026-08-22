import type { SupabaseClient } from "@supabase/supabase-js";
import { discountAmountCents, normalizeDiscountCode, type DiscountCodeRecord } from "@/lib/discount-types";

type ValidationInput = {
  code: string;
  eligibleCents: number;
  customerEmail: string;
  quoteId?: string | null;
};

export async function validateDiscountCode(supabase: SupabaseClient, input: ValidationInput) {
  const normalized = normalizeDiscountCode(input.code);
  if (!normalized) return { code: null as DiscountCodeRecord | null, discountCents: 0 };

  const { data, error } = await supabase
    .from("discount_codes")
    .select("id,code,description,kind,percent_off,amount_off_cents,min_order_cents,max_uses,per_customer_limit,starts_at,expires_at,active,retired_at,created_at,updated_at")
    .eq("code", normalized)
    .maybeSingle();

  if (error || !data) throw new Error("That discount code is not valid.");
  const code = data as DiscountCodeRecord;
  const now = Date.now();
  if (!code.active || code.retired_at) throw new Error("That discount code is no longer active.");
  if (code.starts_at && now < new Date(code.starts_at).getTime()) throw new Error("That discount code is not active yet.");
  if (code.expires_at && now > new Date(code.expires_at).getTime()) throw new Error("That discount code has expired.");
  if (input.eligibleCents < Number(code.min_order_cents || 0)) throw new Error("This order does not meet the minimum for that discount code.");

  const { data: existingForQuote } = input.quoteId
    ? await supabase.from("discount_redemptions").select("id").eq("discount_code_id", code.id).eq("quote_id", input.quoteId).maybeSingle()
    : { data: null };

  if (!existingForQuote) {
    if (code.max_uses) {
      const { count } = await supabase.from("discount_redemptions").select("id", { count: "exact", head: true }).eq("discount_code_id", code.id);
      if ((count || 0) >= code.max_uses) throw new Error("That discount code has reached its usage limit.");
    }
    if (code.per_customer_limit) {
      const { count } = await supabase.from("discount_redemptions").select("id", { count: "exact", head: true }).eq("discount_code_id", code.id).ilike("customer_email", input.customerEmail.trim().toLowerCase());
      if ((count || 0) >= code.per_customer_limit) throw new Error("That discount code has already been used the maximum number of times for this customer.");
    }
  }

  return { code, discountCents: discountAmountCents(code, input.eligibleCents) };
}
