// 추적 결과 → (1) AI에 보낼 요약 몇 줄, (2) AI 없이 쓰는 규칙 기반 설명

import type { CauseStat } from "./analytics";
import type { TraceResult } from "./ladder";
import type { Proposal } from "./propose";
import type { Equipment, ManualEntry } from "./types";

function nodeText(n: TraceResult["leaves"][number]): string {
  const v = n.compare ? `${n.value} (기준 ${n.compare.op} ${n.compare.value} ${n.satisfied ? "성립" : "불성립"})` : n.value ? "ON" : "OFF";
  return `${n.device}(${n.comment})=${v}`;
}

export function explainLines(eq: Equipment, t: TraceResult, manuals: ManualEntry[], causes: CauseStat[], spreadText: string, proposals: Proposal[]): string[] {
  const lines = [
    `알람: [${t.alarm.level}알람] ${t.alarm.code} ${t.alarm.name} / 설비 ${eq.id} ${eq.name}`,
    `래더 추적: ${t.alarm.device} ← ${t.leaves.map(nodeText).join(", ")}`,
    `알람 성립 원인 접점: ${t.culprits.length ? t.culprits.map((c) => `${nodeText(c)} [${c.sourceKind}]`).join(", ") : "없음(래더 로직 판단)"}`,
  ];
  if (t.timersInPath.length)
    lines.push(`경로의 타이머: ${t.timersInPath.map((x) => `${x.device} ${x.setValue}(${(Number(x.setValue.slice(1)) / 10).toFixed(1)}초)`).join(", ")}`);
  if (manuals.length) lines.push(`매뉴얼 조치: ${manuals[0].cause} → ${manuals[0].steps.join(" → ")}`);
  if (causes.length)
    lines.push(
      `과거 조치: ${causes
        .slice(0, 3)
        .map((c) => `${c.cause}/${c.action} 해결 ${c.resolved}/${c.tries}`)
        .join("; ")}`,
    );
  if (spreadText) lines.push(`설비군: ${spreadText}`);
  if (proposals.length) lines.push(`DB 개선 제안: ${proposals.map((p) => p.title).join("; ")}`);
  return lines;
}

export function ruleExplain(t: TraceResult, manuals: ManualEntry[], causes: CauseStat[], spreadText: string, proposals: Proposal[]): string {
  const out: string[] = [];
  const c = t.culprits[0];
  if (c) {
    const what = c.compare
      ? `${c.comment} 값이 ${c.value}로 기준(${c.compare.op} ${c.compare.value})을 넘어`
      : `${c.comment}(${c.device}) 신호가 ${c.value ? "켜져" : "꺼져"}`;
    out.push(`${what} ${t.alarm.name} 알람이 켜졌습니다. 원천은 ${c.sourceKind}입니다.`);
  } else {
    const tm = t.timersInPath[0];
    out.push(
      tm
        ? `래더의 ${tm.device} 타이머(${(Number(tm.setValue.slice(1)) / 10).toFixed(1)}초) 판정으로 알람이 켜졌고, 추적은 래더 내부 조건(${t.leaves.map((l) => l.device).join(", ")})에서 끝났습니다. 알람 쪽으로 성립한 현장 입력은 찾지 못했지만 센서 정상을 증명한 것은 아닙니다.`
        : `추적이 래더 내부 조건(${t.leaves.map((l) => l.device).join(", ")})에서 끝났습니다. 센서 정상을 증명한 것은 아니므로 시퀀스 프로그램도 확인하세요.`,
    );
  }
  if (c?.sourceKind === "외부 신호") out.push(`우리 설비가 아니라 ${c.checkWith || "신호를 보내는 쪽"}을 먼저 확인하세요.`);
  else if (manuals[0]) out.push(`먼저 '${manuals[0].steps[0]}'부터 하세요 (${manuals[0].cause} 가능성).`);
  const best = causes.find((x) => x.tries >= 2 && x.actionType !== "리셋");
  if (best) out.push(`과거에는 '${best.action}'으로 ${best.tries}번 중 ${best.resolved}번 해결됐습니다.`);
  if (spreadText) out.push(`설비군 비교: ${spreadText}.`);
  if (proposals[0]) out.push(`이력상 재발 방지안이 있습니다: ${proposals[0].title}.`);
  return out.join(" ");
}
