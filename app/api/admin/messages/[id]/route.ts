import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth";
import { MESSAGE_BUCKET } from "@/lib/message-server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminApi();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const { id } = await params;
    if (!id) return NextResponse.json({ error: "Conversation is required." }, { status: 400 });
    const admin = getSupabaseAdmin();
    const { data: thread } = await admin.from("message_threads").select("id").eq("id", id).maybeSingle();
    if (!thread) return NextResponse.json({ ok: true });

    const { data: entries } = await admin.from("message_entries").select("id").eq("thread_id", id);
    const entryIds = (entries ?? []).map((entry) => entry.id);
    if (entryIds.length) {
      const { data: attachments } = await admin.from("message_attachments").select("storage_path").in("message_id", entryIds);
      const paths = (attachments ?? []).map((attachment) => attachment.storage_path).filter(Boolean);
      if (paths.length) {
        const { error: storageError } = await admin.storage.from(MESSAGE_BUCKET).remove(paths);
        if (storageError) return NextResponse.json({ error: "Could not remove the conversation attachments. Nothing was deleted." }, { status: 500 });
      }
    }

    const { error } = await admin.from("message_threads").delete().eq("id", id);
    if (error) return NextResponse.json({ error: "Could not delete this conversation." }, { status: 500 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Admin conversation delete failed", error);
    return NextResponse.json({ error: "Could not delete this conversation." }, { status: 500 });
  }
}
