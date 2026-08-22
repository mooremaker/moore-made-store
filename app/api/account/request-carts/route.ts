import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

const BUCKET = "request-cart-files";
const MAX_CARTS = 30;
const MAX_CART_ITEMS = 20;
const MAX_FILE_BYTES = 20 * 1024 * 1024;

function text(value: unknown, max = 500) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function validUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function safeName(value: string) {
  return value.normalize("NFKD").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-").replace(/^[-.]+|[-.]+$/g, "").slice(0, 100) || "artwork";
}

function cartPaths(items: unknown) {
  if (!Array.isArray(items)) return [] as string[];
  return items.flatMap((item) => {
    const row = item && typeof item === "object" ? item as Record<string, unknown> : {};
    const views = Array.isArray(row.views) ? row.views : [];
    return views.map((rawView) => {
      const view = rawView && typeof rawView === "object" ? rawView as Record<string, unknown> : {};
      const file = view.savedFile && typeof view.savedFile === "object" ? view.savedFile as Record<string, unknown> : {};
      return text(file.path, 1000);
    }).filter(Boolean);
  });
}

function sanitizeItems(value: unknown, userId: string, cartId: string) {
  if (!Array.isArray(value)) return [];
  const items = value.slice(0, MAX_CART_ITEMS).map((rawItem) => {
    const item = rawItem && typeof rawItem === "object" ? structuredClone(rawItem as Record<string, unknown>) : {};
    delete item.file;
    if (Array.isArray(item.views)) {
      item.views = item.views.slice(0, 2).map((rawView) => {
        const view = rawView && typeof rawView === "object" ? rawView as Record<string, unknown> : {};
        delete view.file;
        if (view.savedFile && typeof view.savedFile === "object") {
          const saved = view.savedFile as Record<string, unknown>;
          const path = text(saved.path, 1000);
          view.savedFile = path.startsWith(`${userId}/${cartId}/`) ? {
            path,
            name: text(saved.name, 300) || "Artwork",
            type: text(saved.type, 160),
            size: Math.max(0, Math.min(MAX_FILE_BYTES, Number(saved.size) || 0)),
          } : null;
        }
        return view;
      });
    }
    return item;
  });
  if (JSON.stringify(items).length > 1_500_000) throw new Error("This saved cart is too large.");
  return items;
}

async function requireCustomer() {
  const user = await getCurrentUser();
  return user ?? null;
}

export async function GET() {
  try {
    const user = await requireCustomer();
    if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
    const admin = getSupabaseAdmin();
    const { data, error } = await admin.from("saved_request_carts").select("id,name,cart_items,created_at,updated_at").eq("customer_user_id", user.id).order("updated_at", { ascending: false }).limit(MAX_CARTS);
    if (error) throw error;

    const rows = data ?? [];
    const paths = Array.from(new Set(rows.flatMap((row) => cartPaths(row.cart_items))));
    const signedByPath = new Map<string, string>();
    if (paths.length) {
      const { data: signed } = await admin.storage.from(BUCKET).createSignedUrls(paths, 60 * 60);
      for (const result of signed ?? []) if (result.path && result.signedUrl) signedByPath.set(result.path, result.signedUrl);
    }

    const carts = rows.map((row) => ({
      id: row.id,
      name: row.name,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      items: Array.isArray(row.cart_items) ? row.cart_items.map((item: Record<string, unknown>) => ({
        ...item,
        views: Array.isArray(item.views) ? item.views.map((view: Record<string, unknown>) => {
          const saved = view.savedFile && typeof view.savedFile === "object" ? view.savedFile as Record<string, unknown> : null;
          const path = saved ? text(saved.path, 1000) : "";
          return { ...view, file: null, savedFile: saved ? { ...saved, url: signedByPath.get(path) || null } : null };
        }) : [],
      })) : [],
    }));
    return NextResponse.json({ carts });
  } catch (error) {
    console.error("Saved request cart list failed", error);
    return NextResponse.json({ error: "Could not load saved carts." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireCustomer();
    if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
    const body = await request.json();
    const action = text(body.action, 40);
    const cartId = text(body.cartId, 80);
    if (!validUuid(cartId)) return NextResponse.json({ error: "Invalid saved cart." }, { status: 400 });
    const admin = getSupabaseAdmin();

    if (action === "prepare_uploads") {
      const files = Array.isArray(body.files) ? body.files.slice(0, 40) : [];
      const targets = [] as Array<{ index: number; path: string; token: string }>;
      for (let index = 0; index < files.length; index += 1) {
        const raw = files[index] && typeof files[index] === "object" ? files[index] as Record<string, unknown> : {};
        const size = Number(raw.size) || 0;
        if (size < 1 || size > MAX_FILE_BYTES) continue;
        const itemId = safeName(text(raw.itemId, 120));
        const view = text(raw.view, 20) === "back" ? "back" : "front";
        const path = `${user.id}/${cartId}/${Date.now()}-${index}-${itemId}-${view}-${safeName(text(raw.name, 300))}`;
        const { data, error } = await admin.storage.from(BUCKET).createSignedUploadUrl(path);
        if (!error && data?.token) targets.push({ index, path, token: data.token });
      }
      return NextResponse.json({ targets });
    }

    if (action === "save") {
      const { data: existing } = await admin.from("saved_request_carts").select("id,customer_user_id,cart_items").eq("id", cartId).maybeSingle();
      if (existing && existing.customer_user_id !== user.id) return NextResponse.json({ error: "Saved cart not found." }, { status: 404 });
      if (!existing) {
        const { count } = await admin.from("saved_request_carts").select("id", { count: "exact", head: true }).eq("customer_user_id", user.id);
        if ((count || 0) >= MAX_CARTS) return NextResponse.json({ error: `You can save up to ${MAX_CARTS} carts.` }, { status: 400 });
      }
      const name = text(body.name, 120) || "Saved request cart";
      const items = sanitizeItems(body.items, user.id, cartId);
      if (!items.length) return NextResponse.json({ error: "Add at least one design before saving this cart." }, { status: 400 });
      const oldPaths = new Set(cartPaths(existing?.cart_items));
      const nextPaths = new Set(cartPaths(items));
      const orphaned = Array.from(oldPaths).filter((path) => !nextPaths.has(path));
      if (orphaned.length) await admin.storage.from(BUCKET).remove(orphaned);
      const payload = { id: cartId, customer_user_id: user.id, name, cart_items: items, updated_at: new Date().toISOString() };
      const { error } = await admin.from("saved_request_carts").upsert(payload, { onConflict: "id" });
      if (error) throw error;
      return NextResponse.json({ ok: true, cartId });
    }

    return NextResponse.json({ error: "Unsupported saved-cart action." }, { status: 400 });
  } catch (error) {
    console.error("Saved request cart write failed", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not save this cart." }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const user = await requireCustomer();
    if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
    const body = await request.json();
    const cartId = text(body.cartId, 80);
    if (!validUuid(cartId)) return NextResponse.json({ error: "Invalid saved cart." }, { status: 400 });
    const admin = getSupabaseAdmin();
    const { data: row } = await admin.from("saved_request_carts").select("id,cart_items").eq("id", cartId).eq("customer_user_id", user.id).maybeSingle();
    if (!row) return NextResponse.json({ ok: true });
    const paths = cartPaths(row.cart_items);
    if (paths.length) await admin.storage.from(BUCKET).remove(paths);
    const { error } = await admin.from("saved_request_carts").delete().eq("id", cartId).eq("customer_user_id", user.id);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Saved request cart delete failed", error);
    return NextResponse.json({ error: "Could not delete this saved cart." }, { status: 500 });
  }
}
