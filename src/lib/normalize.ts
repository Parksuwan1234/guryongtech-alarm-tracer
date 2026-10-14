// 작업자의 자유 기록 → 조치이력 DB의 표준 칸 (규칙 기반, 사람이 확인 후 저장)
// 원칙: 원문에 없는 원인은 채우지 않는다(후보로만 보여 줌). 관찰("재가동됨")과 판단("해결")을 구분한다.
//       문장에서 뽑은 측정값은 '작업자 기재값'으로 표시하고 자동 계측값으로 취급하지 않는다.

import type { ActionResult, ActionType } from "./types";

export interface Normalized {
  actionType?: ActionType;
  causeCandidates: string[]; // 원문 낱말과 겹치는 원인 후보 (자동으로 채우지 않음)
  action?: string;
  result?: ActionResult;
  measured?: number | null;
  measuredUnit?: string;
  durationMin?: number;
  notes: string[]; // 판단 근거가 된 문구
  pending: string[]; // 사람이 확인해야 할 칸
  by: "규칙" | "AI";
}

const TYPE_RULES: [RegExp, ActionType][] = [
  [/교체|바꿈|바꿨/, "부품 교체"],
  [/청소|닦|탈진|털어/, "청소"],
  [/보충|채움|주입|그리스/, "보충"],
  [/설정값|파라미터|오프셋/, "파라미터 변경"],
  [/조정|보정|재체결|조임|정렬/, "점검·조정"],
  [/재시작|재부팅|요청|문의|연락/, "외부 확인"],
  [/리셋|reset/i, "리셋"],
];

// 바로 뒤에 붙으면 '하지 않음·앞으로 할 일'로 보는 표현
const NOT_DONE = /^\S{0,3}\s?(안\s?함|안\s?했|하지\s?않|못\s?함|못\s?했|예정|필요|할\s?것|해야)/;

export function ruleNormalize(text: string, causeOptions: string[]): Normalized {
  const t = text.trim();
  const out: Normalized = { causeCandidates: [], notes: [], pending: [], by: "규칙" };
  for (const [re, type] of TYPE_RULES) {
    const m = t.match(re);
    if (!m) continue;
    const after = t.slice((m.index ?? 0) + m[0].length);
    if (NOT_DONE.test(after)) {
      out.notes.push(`'${m[0]}${after.slice(0, 5)}' 부분은 안 했거나 할 예정이라 뺌`);
      continue;
    }
    out.actionType = type;
    out.notes.push(`조치 유형 ${type} ('${m[0]}')`);
    break;
  }
  if (!out.actionType) out.pending.push("조치 유형");

  if (/안\s?풀|안\s?됨|재발|미해결|계속|다시\s?(뜸|발생|남)/.test(t)) {
    out.result = "미해결";
    out.notes.push("결과 미해결 (재발이나 안 풀림 표현)");
  } else if (/해결|원인\s?제거|재발\s?없/.test(t)) {
    out.result = "해결";
    out.notes.push("결과 해결 ('해결' 표현)");
  } else {
    if (/재가동|가동|정상|돌아감|돌아갔/.test(t)) out.notes.push("재가동됐다고 해결은 아님 (확인 필요)");
    out.pending.push("결과(해결 여부)");
  }

  const sec = t.match(/(\d+(?:\.\d+)?)\s*(초|sec|s)(?![a-z])/i);
  const temp = t.match(/(\d+(?:\.\d+)?)\s*(℃|도|°C)/);
  const mpa = t.match(/(\d+(?:\.\d+)?)\s*MPa/i);
  const m = sec ? [sec[1], "s"] : temp ? [temp[1], "℃"] : mpa ? [mpa[1], "MPa"] : null;
  if (m) {
    out.measured = Number(m[0]);
    out.measuredUnit = m[1];
    out.notes.push(`측정값 ${m[0]}${m[1] === "s" ? "초" : m[1]} (작업자 기재값)`);
  }
  const dur = t.match(/(\d+)\s*분/);
  if (dur) {
    out.durationMin = Number(dur[1]);
    out.notes.push(`조치 시간 ${dur[1]}분`);
  }

  const words = (s: string) => s.split(/[\s,·()/]+/).filter((w) => w.length >= 2);
  out.causeCandidates = causeOptions
    .map((c) => ({ c, score: words(c).filter((w) => t.includes(w)).length }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((x) => x.c);
  if (/원인\s?(은\s?)?(아직\s?)?(모름|미확인|불명)/.test(t)) {
    out.causeCandidates = [];
    out.notes.push("원인 미확인 ('원인 모름' 표현)");
  }
  out.pending.push("원인 (후보에서 고르거나 직접 입력)");
  // 조치 내용 칸에는 '한 일'만: '10분', '해결', '지금 정상' 같은 시간·결과 조각은 위 칸으로 갔으므로 뺌
  const first = t.split(/[.\n]/)[0];
  const FILLER = /^(\d+\s*분(\s*(걸림|걸렸음|소요))?|(지금\s*)?(정상|해결|해결됨|미해결)|재가동(\s*후)?(\s*정상)?)$/;
  const kept = first
    .split(/\s*,\s*/)
    .map((x) => x.trim())
    .filter((x) => x && !FILLER.test(x));
  out.action = (kept.length ? kept.join(", ") : first).slice(0, 60);
  return out;
}
