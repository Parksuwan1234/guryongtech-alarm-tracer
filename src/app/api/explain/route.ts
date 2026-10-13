// AI 쉬운 설명: 래더 추적 '결과 몇 줄'만 받아, 민감 값을 가린 뒤 Claude에 보냅니다.
// 래더 원본·조치이력 원본은 보내지 않습니다. 키가 없거나 실패하면 204를 돌려주고 화면은 규칙 기반 문장을 씁니다.
import Anthropic from "@anthropic-ai/sdk";
import { NextResponse, type NextRequest } from "next/server";
import { maskSensitive } from "@/lib/mask";
import { aiAllowed } from "@/lib/server/guard";

export const dynamic = "force-dynamic";

const SYSTEM = `너는 2차전지 공장의 설비 보전 선배다. 아래는 PLC 래더를 코드로 역추적한 '확정된 결과'다.
결과를 바꾸거나 새 원인을 지어내지 말고, 현장 오퍼레이터가 바로 이해하도록 한국어 2~3문장으로 풀어 써라.
1문장: 어떤 조건(접점)이 알람을 성립시켰는지와 그 의미. 2문장: 지금 먼저 할 일. 3문장(있을 때만): 과거 이력이 말해 주는 점.
래더가 증명하는 것은 '알람을 켠 조건'까지다. 그 뒤의 물리 원인은 단정하지 말고 '후보'로 말하라.
말투는 짧고 단정하게. 목록·머리말·인사 없이 문장만.`;

export async function POST(req: NextRequest) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return new NextResponse(null, { status: 204 });
  if (!aiAllowed(req)) return new NextResponse(null, { status: 204 }); // 화면은 규칙 문장으로 대신 보여줌
  let lines: string[] = [];
  try {
    const body = await req.json();
    lines = Array.isArray(body?.lines) ? body.lines.slice(0, 30).map((x: unknown) => String(x).slice(0, 300)) : [];
  } catch {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }
  if (!lines.length) return NextResponse.json({ error: "empty" }, { status: 400 });
  const masked = maskSensitive(lines.join("\n"));
  const client = new Anthropic({ apiKey: key });
  const models = [process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5", "claude-haiku-4-5"];
  for (const model of models) {
    try {
      const msg = await client.messages.create({
        model,
        max_tokens: 400,
        system: SYSTEM,
        messages: [{ role: "user", content: masked.text }],
      });
      const text = msg.content
        .filter((b) => b.type === "text")
        .map((b) => (b as { text: string }).text)
        .join("")
        .trim();
      return NextResponse.json({ text, model, masked: masked.count });
    } catch {
      continue;
    }
  }
  return new NextResponse(null, { status: 204 });
}
