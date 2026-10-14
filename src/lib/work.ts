// 알람 대응 처리 상태 도우미 — 알람(PLC)과 업무 처리(사람)를 분리해서 다룹니다.

import { shiftStart } from "./analytics";
import type { ActionLog, AlarmWork, WorkStatus } from "./types";

export const OWNER_SUGGESTIONS = ["보전 A조", "보전 B조", "보전 C조", "PLC 담당", "공정 담당", "설비기술팀", "유틸리티팀", "품질팀"];

/** 같은 설비·알람의 아직 끝나지 않은(종결 전) 대응 건 — 알람이 다시 발생해도 같은 문제로 이어서 봅니다 */
export function openWorkFor(work: Map<string, AlarmWork>, equipmentId: string, alarmCode: string): AlarmWork | undefined {
  return Array.from(work.values())
    .filter((w) => w.equipmentId === equipmentId && w.alarmCode === alarmCode && w.status !== "종결")
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
}

export function newWorkId(equipmentId: string, alarmCode: string, startedAt: string): string {
  return `${equipmentId}|${alarmCode}|${startedAt}`;
}

export function draftWork(equipmentId: string, alarmCode: string, startedAt: string): Omit<AlarmWork, "updatedAt" | "history"> {
  return { id: newWorkId(equipmentId, alarmCode, startedAt), equipmentId, alarmCode, startedAt, status: "미접수", owner: "", nextAction: "", dueAt: "" };
}

/** 확인 예정 시각 선택지: 30분 뒤 · 1시간 뒤 · 다음 교대 시작 */
export function dueOptions(now: number): { label: string; value: string }[] {
  const next = shiftStart(new Date(now));
  next.setHours(next.getHours() + 8);
  return [
    { label: "30분 뒤", value: new Date(now + 30 * 60000).toISOString() },
    { label: "1시간 뒤", value: new Date(now + 60 * 60000).toISOString() },
    { label: `다음 교대 시작(${String(next.getHours()).padStart(2, "0")}시)`, value: next.toISOString() },
  ];
}

/**
 * 조치 기록을 저장한 뒤 대응 상태를 어떻게 바꿀지.
 * '해결' 기록은 운전 복구·재발 확인까지 끝났다는 뜻이 아니므로 자동으로 종결하지 않고 '후속 확인'으로 둔다 — 종결은 사람이 정한다.
 */
export function statusAfterLog(l: Pick<ActionLog, "result" | "actionType">): { status: WorkStatus; nextAction: string } {
  if (l.result === "미해결") return { status: "조치 중", nextAction: "미해결. 다음 근무조가 이어서 점검" };
  if (l.actionType === "리셋") return { status: "후속 확인", nextAction: "리셋으로만 풀림. 같은 알람이 다시 뜨는지 보고 종결" };
  return { status: "후속 확인", nextAction: "정상 가동과 재발 여부 확인 후 종결" };
}

export const WORK_TONE: Record<WorkStatus, string> = {
  미접수: "border-red-400/60 text-red-200",
  "조치 중": "border-sky-400/60 text-sky-200",
  "후속 확인": "border-violet-400/60 text-violet-200",
  종결: "border-emerald-500/50 text-emerald-300",
};
