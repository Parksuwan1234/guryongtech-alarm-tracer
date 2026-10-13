import { NextResponse } from "next/server";
import { supabaseConfigured } from "@/lib/server/supabase";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({ db: supabaseConfigured() ? "supabase" : "local", ai: Boolean(process.env.ANTHROPIC_API_KEY) });
}
