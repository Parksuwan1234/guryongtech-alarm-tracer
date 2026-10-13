// AI 기록 정리: 자유 기록을 '정해진 선택지 안에서만' 표준 칸으로 옮긴다. 판단(원인 추적·개선 제안)은 코드가 한다.
// 키가 없거나 한도를 넘으면 204 → 화면은 키워드 규칙 결과를 쓴다.
import Anthropic from "@anthropic-ai/sdk";
import { NextResponse, type NextRequest } from "next/server";
import { maskSensitive } from "@/lib/mask";
import { aiAllowed } from "@/lib/server/guard";

export const dynamic = "force-dynamic";

const TYPES = ["리셋", "부품 교체", "점검·조정", "청소", "보충", "파라미터 변경", "외부 확인", "기타"];

export async function POST(req: NextRequest) {
  const key = process.env.ANTHROPIC_API_KEY;
  // 결정 2(판단은 코드, AI는 보조)에 따라 기본은 꺼 둔다. AI_NORMALIZE=true 일 때만 실험 기능으로 동작
  if (!key || process.env.AI_NORMALIZE !== "true" || !aiAllowed(req)) return new NextResponse(null, { status: 204 });
  let text = "";
  let causes: string[] = [];
  try {
    const body = await req.json();
    text = String(body?.text ?? "").slice(0, 500);
    causes = Array.isArray(body?.causes) ? body.causes.slice(0, 20).map((c: unknown) => String(c).slice(0, 60)) : [];
  } catch {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }
  if (!text.trim()) return NextResponse.json({ error: "empty" }, { status: 400 });
  const masked = maskSensitive(text).text;
  const system = `설비 조치 기록을 표준 칸으로 옮겨라. JSON 한 줄만 출력한다.
{"actionType": ${JSON.stringify(TYPES)} 중 하나, "cause": 원인 선택지 중 하나 또는 "", "action": 조치 내용 40자 이내, "result": "해결"|"미해결"|"", "measured": 숫자|null, "measuredUnit": "s"|"℃"|"MPa"|"kPa"|"N"|"㎛"|"", "durationMin": 숫자|null}
원인 선택지: ${JSON.stringify(causes)}
기록에 없는 내용은 지어내지 말고 빈 값으로 둔다.`;
  try {
    const client = new Anthropic({ apiKey: key });
    const msg = await client.messages.create({
      model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5",
      max_tokens: 300,
      system,
      messages: [{ role: "user", content: masked }],
    });
    const raw = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("");
    const j = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1));
    // 선택지 밖의 값은 버린다
    // 선택지 밖의 값은 버리고, 원인은 '후보'로만 돌려준다(자동으로 채우지 않음)
    const out = {
      actionType: TYPES.includes(j.actionType) ? j.actionType : undefined,
      causeCandidates: causes.includes(j.cause) ? [j.cause] : [],
      result: j.result === "해결" || j.result === "미해결" ? j.result : undefined,
      notes: ["AI 실험 기능: 정해진 선택지 안에서만 정리, 민감 값은 가린 뒤 전송"],
      by: "AI",
    };
    return NextResponse.json(out);
  } catch {
    return new NextResponse(null, { status: 204 });
  }
}
