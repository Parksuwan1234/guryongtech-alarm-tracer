// AI 호출 비용 통제: 다른 사이트 호출 거절, 접속지당 분당 6회, 서버 인스턴스당 하루 AI_DAILY_LIMIT회(기본 300)
import type { NextRequest } from "next/server";

const perIp = new Map<string, number[]>();
let day = "";
let dayCount = 0;

export function aiAllowed(req: NextRequest): boolean {
  const origin = req.headers.get("origin");
  if (origin && new URL(origin).host !== req.headers.get("host")) return false;
  const today = new Date().toISOString().slice(0, 10);
  if (today !== day) {
    day = today;
    dayCount = 0;
  }
  if (dayCount >= Number(process.env.AI_DAILY_LIMIT || 300)) return false;
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "unknown";
  const now = Date.now();
  const recent = (perIp.get(ip) ?? []).filter((t) => now - t < 60000);
  if (recent.length >= 6) return false;
  recent.push(now);
  perIp.set(ip, recent);
  dayCount++;
  return true;
}
