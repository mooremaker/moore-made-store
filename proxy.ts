import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  if (process.env.MOORE_MADE_PREVIEW === "1") {
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method) || request.nextUrl.pathname.startsWith("/api/") || request.nextUrl.pathname.startsWith("/auth/")) {
      return NextResponse.json({ error: "Live actions are disabled in this preview workspace." }, { status: 403 });
    }
    return NextResponse.next();
  }
  return updateSession(request);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
