// 개선 제안 엔진 — 조치이력 DB를 근거로 '알람 재발을 막는' 방법을 역으로 제안
//
// 규칙(모두 코드로 계산, 같은 데이터면 같은 결과):
//  1. debounce : 경알람이 리셋만으로 60% 이상 해결 + 신호 지속시간이 짧음 → 지속 판정 타이머 추가 래더안
//  2. inspect  : 리셋으로 풀리지만 신호가 길거나, 안전·설비 보호·중알람이라 래더로 거르면 안 됨 → 원인 점검 권고
//  3. timer    : 추적 경로에 타이머가 있고 측정 응답 시간이 설정값 바로 위에 몰림 → 설정값 변경안
//  4. pm       : 알람 뒤 같은 부품 교체·청소·보충 간격이 일정 → 예방정비 주기와 설비별 다음 권장일
//  5. manual   : 매뉴얼에 없는 조치로 반복 해결(7일 내 재발률 확인) → 매뉴얼 보강안
//  6. unit     : 설비군 중 1대에 알람이 몰림 → 설비 편중 원인 조사
//  7. external : 외부 신호가 원천이고 대기 시간이 김 → 송수신 경계 공동 점검 요청
//
// 안전 원칙
//  - 경·중 등급과 별개로 '보호 구분'(안전·설비 보호·품질)을 본다. 안전·설비 보호 알람과 중알람은 래더 변경을 제안하지 않는다.
//  - 효과는 '조치이력의 측정값으로 다시 계산한 추정치(가정 조건에서 억제되는 알람 수)'이며 실증 전 값이다.
//  - 래더 변경은 PLC 담당 검토·승인 후 반영. 이 도구는 PLC에 쓰지 않는다. 먼저 '섀도 모드'(래더는 그대로, 도구만 병행 계산)로 검증한다.

import { EQUIPMENT_BY_ID, LINE_SPEED } from "@/data/equipment";
import { causeStats, DAY_MS, fleetSpread, groupBy, mean, percentile, since, stdev } from "./analytics";
import { debounceChange, kToNumber, timerChange, traceAlarm, whereUsed, type LadderChange, type UsageRef } from "./ladder";
import type { ActionLog, AlarmLevel, ManualEntry, ParsedProgram, ProtectKind } from "./types";

export type ProposalKind = "debounce" | "timer" | "pm" | "manual" | "unit" | "external" | "inspect" | "hold";

// rules-1.3: 독립 기간 검증 대상 확장 — 리셋 해결·리셋 외 조치에 더해 '리셋 미해결' 기록의 억제 여부를 따로 셈 (10/13 검토 반영)
export const RULE_VERSION = "rules-1.3";
const TEST_DAYS = 30; // 마지막 30일은 검증용으로 떼어 둔다(기준은 그 앞 기간에서만 고른다)

export const KIND_LABEL: Record<ProposalKind, string> = {
  debounce: "래더 수정 · 지속 판정 추가",
  timer: "래더 수정 · 타이머 설정값",
  pm: "예방정비 주기",
  manual: "매뉴얼 보강",
  unit: "설비 편중 조사",
  external: "송수신 경계 공동 점검",
  inspect: "원인 점검 권고",
  hold: "판단 보류 (근거 부족)",
};

export interface Validation {
  trainPeriod: string;
  testPeriod: string;
  param: string;
  result: string;
  status: "통과" | "미달" | "보류" | "확인 필요";
  /** 조치 유형·결과별로 억제됨/유지됨을 따로 — '실제 이상 누락 없음'으로 합치지 않음 */
  breakdown?: { label: string; total: number; suppressed: number; note: string }[];
}

export interface Stage {
  name: string;
  state: "완료" | "미달" | "보류" | "미실시" | "확인 필요";
  detail: string;
}

export interface Pilot {
  target: string;
  tags: string[];
  plan: string;
  success: string;
  stop: string;
  owner: string;
}

export interface HistogramBin {
  from: number;
  to: number;
  count: number;
  avoided: boolean;
}

export interface Proposal {
  id: string;
  kind: ProposalKind;
  title: string;
  summary: string;
  programId: string;
  alarmCode: string;
  alarmName: string;
  level: AlarmLevel;
  protect: ProtectKind;
  appliesTo: string[];
  owner: string;
  evidence: { label: string; value: string }[];
  histogram?: { bins: HistogramBin[]; unit: string; threshold: number; thresholdLabel: string; current?: number; labels?: { avoid: string; keep: string } };
  effect: { avoided: number; total: number; downtimeSavedMin: number; perYearMin: number; note: string };
  change?: LadderChange;
  impact?: UsageRef[];
  schedule?: { equipmentId: string; last: string; next: string; overdue: boolean }[];
  manualDraft?: { cause: string; steps: string[] };
  alternatives?: string[];
  validation?: Validation;
  stages?: Stage[];
  pilot?: Pilot;
  meta?: { period: string; ruleVersion: string; computedAt: string; logCount: number; programId: string };
  needs?: string[]; // 판단 보류일 때 필요한 자료
  checks?: string[]; // 변경 전 확인 필요 항목
  verify?: string[]; // 검증 계획
  risks: string[];
  logIds: string[];
}

export interface ProposalInput {
  logs: ActionLog[];
  programs: Map<string, ParsedProgram>;
  assignment: Record<string, string>; // 설비 → 프로그램
  manuals: ManualEntry[];
  now?: number;
  days?: number;
}

const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);
const pct = (x: number) => `${Math.round(x * 100)}%`;
const sec = (x: number) => `${x.toFixed(x < 1 ? 2 : 1)}초`;

function histogram(values: number[], threshold: number, bins = 12, greenAbove = false): HistogramBin[] {
  if (!values.length) return [];
  const lo = Math.min(...values, threshold);
  const hi = Math.max(...values, threshold);
  const w = (hi - lo) / bins || 1;
  const out: HistogramBin[] = Array.from({ length: bins }, (_, i) => ({
    from: lo + i * w,
    to: lo + (i + 1) * w,
    count: 0,
    avoided: greenAbove ? lo + i * w >= threshold - 1e-9 : lo + (i + 1) * w <= threshold + 1e-9,
  }));
  for (const v of values) out[Math.min(bins - 1, Math.floor((v - lo) / w))].count++;
  return out;
}

const STOP_WORDS = new Set(["후", "및", "또는", "에", "의"]);

/** 조치 문구가 매뉴얼에 이미 있는지 (핵심 낱말 60% 이상 포함) */
export function isInManual(action: string, manuals: ManualEntry[]): boolean {
  const known = manuals.map((m) => [m.cause, m.owner, ...m.steps].join(" ")).join(" ");
  const tokens = action.split(/[\s,·/()]+/).filter((t) => t.length >= 1 && !/\d/.test(t) && !STOP_WORDS.has(t));
  if (!tokens.length) return true;
  const hit = tokens.filter((t) => known.includes(t)).length;
  return hit / tokens.length >= 0.6;
}

/** 같은 알람이 여러 설비에서 15분 안에 함께 발생한 횟수 (공용 유틸리티·MES 장애 의심) */
export function simultaneousClusters(logs: ActionLog[], windowMin = 15): { at: string; units: string[] }[] {
  const sorted = [...logs].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  const out: { at: string; units: string[] }[] = [];
  let i = 0;
  while (i < sorted.length) {
    const t0 = new Date(sorted[i].occurredAt).getTime();
    const group = sorted.filter((l, k) => k >= i && new Date(l.occurredAt).getTime() - t0 <= windowMin * 60000);
    const units = Array.from(new Set(group.map((l) => l.equipmentId)));
    if (units.length >= 2) {
      out.push({ at: sorted[i].occurredAt, units: units.sort() });
      i += group.length;
    } else i++;
  }
  return out;
}

const md = (t: number) => {
  const d = new Date(t);
  return `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
};

/** 리셋 해결 건의 80% 이상을 거르는 가장 짧은 지속 판정(0.1~1.0초) */
function chooseK(secResets: number[]): number | null {
  if (secResets.length < 5) return null;
  for (let K = 1; K <= 10; K++) if (secResets.filter((x) => x < K / 10).length / secResets.length >= 0.8) return K;
  return null;
}

const tOf = (l: ActionLog) => new Date(l.occurredAt).getTime();

function stagesOf(avoided: number, total: number, v: Validation, pilotTarget: string): Stage[] {
  return [
    { name: "같은 기간 재계산", state: "완료", detail: `${total}건 중 ${avoided}건 억제(추정)` },
    { name: "독립 기간 검증", state: v.status === "통과" ? "완료" : v.status, detail: v.result },
    { name: "섀도 모드 2주", state: "미실시", detail: "래더는 그대로 두고 도구가 같은 판정을 병행 계산" },
    {
      name: "1대 시범",
      state: "미실시",
      detail: v.status === "통과" ? `${pilotTarget} · PLC 담당 승인 후` : `${pilotTarget} · 독립 검증 '${v.status}' 해소 전에는 진행하지 않음`,
    },
  ];
}

const SHADOW_PLAN = [
  "1단계 섀도 모드(2주): 래더는 그대로 두고, 이 도구가 같은 조건을 병행 계산해 '억제됐을 알람'과 실제 고장을 대조",
  "2단계 시범 적용: 1대에만 반영, PLC 담당 입회 하 동작 확인(정상·고장 모의 신호)",
  "3단계 확대: 2주 데이터로 효과·부작용 확인 후 같은 프로그램 설비에 적용",
];

export function buildProposals(input: ProposalInput): Proposal[] {
  const now = input.now ?? Date.now();
  const days = input.days ?? 90;
  const perYear = 365 / days;
  const recent = since(input.logs, days, now);
  const unitsOf = (programId: string) =>
    Object.entries(input.assignment)
      .filter(([, p]) => p === programId)
      .map(([e]) => e)
      .sort();
  const out: Proposal[] = [];

  const groups = groupBy(recent, (l) => `${input.assignment[l.equipmentId] ?? "?"}|${l.alarmCode}`);
  for (const [key, ls] of Array.from(groups.entries())) {
    const [programId, code] = key.split("|");
    const prog = input.programs.get(programId);
    const alarm = prog?.alarms.find((a) => a.code === code);
    if (!prog || !alarm) continue;
    const units = unitsOf(programId);
    const affected = Array.from(new Set(ls.map((l) => l.equipmentId))).sort();
    const trace = traceAlarm(prog, code);
    if (!trace) continue;
    const n = ls.length;
    const base = {
      programId,
      alarmCode: code,
      alarmName: alarm.name,
      level: alarm.level,
      protect: alarm.protect,
    };
    const protectedAlarm = alarm.protect === "안전" || alarm.protect === "설비 보호";
    const process = EQUIPMENT_BY_ID.get(units[0] ?? "")?.process;
    const speed = process ? LINE_SPEED[process] : null;
    const resetOk = ls.filter((l) => l.actionType === "리셋" && l.result === "해결");
    const resetShare = resetOk.length / n;
    const secLogs = ls.filter((l) => l.measuredUnit === "s" && l.measured !== null);
    const timer = trace.timersInPath[0];

    // ── 1·2. 리셋만으로 풀리는 알람 → 지속 판정 추가 또는 원인 점검 ──
    const secResets = resetOk.filter((l) => l.measuredUnit === "s" && l.measured !== null).map((l) => l.measured!);
    // ── 0. 판단 보류: 리셋 반복 패턴은 보이지만 판단에 필요한 측정값이 없음 ──
    if (n >= 8 && resetShare >= 0.6 && (timer ? secLogs.length < 5 : secResets.length < 5)) {
      out.push({
        ...base,
        id: `hold:${programId}:${code}`,
        kind: "hold",
        title: `${code} ${alarm.name} — 리셋 반복, 측정값이 없어 판단 보류`,
        summary: `리셋만으로 ${pct(resetShare)}가 풀렸지만 ${timer ? "응답 시간" : "원천 신호 지속 시간"} 기록이 ${timer ? secLogs.length : secResets.length}건뿐이라 래더 검토안을 만들지 않았습니다. 잘못된 확신보다 보류가 안전합니다.`,
        appliesTo: affected,
        owner: "보전",
        evidence: [
          { label: "최근 발생", value: `${days}일 ${n}건 · 리셋 해결 ${resetOk.length}건` },
          { label: "측정값 기록", value: `${timer ? secLogs.length : secResets.length}건 (최소 5건 필요)` },
          { label: "보호 구분", value: alarm.protect || "운영" },
        ],
        needs: [
          timer
            ? "요청·응답 신호를 짝지은 응답 시간(PLC 자동 계측)"
            : `원천 신호(${trace.leaves.map((l) => l.device).join(", ")})의 켜짐·꺼짐 시각(PLC 자동 계측)`,
          "조치 기록에 측정값 칸 입력(작업자 기재값으로 따로 표시)",
        ],
        effect: { avoided: 0, total: n, downtimeSavedMin: 0, perYearMin: 0, note: "판단 보류 — 효과를 계산하지 않았습니다." },
        risks: ["측정값 없이 기준을 정하면 실제 이상을 가릴 수 있습니다."],
        logIds: resetOk.map((l) => l.id),
      });
    }

    if (!timer && n >= 8 && resetShare >= 0.6 && secResets.length >= 5) {
      let k: number | null = null;
      for (let K = 1; K <= 10; K++) {
        if (secResets.filter((x) => x < K / 10).length / secResets.length >= 0.8) {
          k = K;
          break;
        }
      }
      const med = percentile(secResets, 0.5);
      const p90 = percentile(secResets, 0.9);
      if (k !== null && alarm.level === "경" && !protectedAlarm) {
        const th = k / 10;
        const avoidedLogs = secLogs.filter((l) => l.measured! < th);
        const saved = sum(avoidedLogs.map((l) => l.durationMin));
        const mm = speed ? Math.round((speed / 60) * th * 1000) : null;
        // 독립 기간 검증: 앞 기간에서 기준을 고르고, 마지막 30일에 그대로 적용
        const cut = now - TEST_DAYS * DAY_MS;
        const trainK = chooseK(resetOk.filter((l) => tOf(l) < cut && l.measuredUnit === "s" && l.measured !== null).map((l) => l.measured!));
        const testSec = secLogs.filter((l) => tOf(l) >= cut);
        const testResets = testSec.filter((l) => l.actionType === "리셋" && l.result === "해결");
        const testReal = testSec.filter((l) => l.actionType !== "리셋");
        let validation: Validation;
        if (trainK === null || testSec.length < 5) {
          validation = {
            trainPeriod: `${md(now - days * DAY_MS)}~${md(cut)}`,
            testPeriod: `${md(cut)}~${md(now)}`,
            param: "-",
            result: "검증에 쓸 측정값이 부족해 보류",
            status: "보류",
          };
        } else {
          const tth = trainK / 10;
          const okRate = testResets.length ? testResets.filter((l) => l.measured! < tth).length / testResets.length : 0;
          const realHidden = testReal.filter((l) => l.measured! < tth).length;
          const testResetFail = testSec.filter((l) => l.actionType === "리셋" && l.result === "미해결");
          const failHidden = testResetFail.filter((l) => l.measured! < tth).length;
          validation = {
            trainPeriod: `${md(now - days * DAY_MS)}~${md(cut)}`,
            testPeriod: `${md(cut)}~${md(now)}`,
            param: `앞 기간에서 고른 기준 ${tth.toFixed(1)}초`,
            result:
              `최근 30일 리셋 해결 ${testResets.length}건 중 ${pct(okRate)} 억제(추정) · 리셋 외 조치 기록 ${testReal.length}건 중 ${realHidden}건 억제` +
              (testResetFail.length ? ` · 리셋 미해결 ${testResetFail.length}건 중 ${failHidden}건 억제${failHidden ? " → 추가 확인 필요" : ""}` : ""),
            status: okRate < 0.7 || realHidden > 0 ? "미달" : failHidden > 0 ? "확인 필요" : "통과",
            breakdown: [
              { label: "리셋으로 해결", total: testResets.length, suppressed: testResets.filter((l) => l.measured! < tth).length, note: "억제 대상(기대)" },
              { label: "리셋 외 조치(청소·교체 등)", total: testReal.length, suppressed: realHidden, note: "억제되면 안 됨" },
              { label: "리셋 미해결", total: testResetFail.length, suppressed: failHidden, note: "억제되면 최초 알람이 늦어짐 — 확인 대상" },
            ],
          };
        }
        const pilotTarget = Array.from(groupBy(ls, (l) => l.equipmentId).entries()).sort((a, b) => b[1].length - a[1].length)[0][0];
        const pilot: Pilot = {
          target: `${pilotTarget} (발생이 가장 많은 설비, 최종 선정은 현장 협의)`,
          tags: Array.from(new Set([alarm.device, ...trace.leaves.map((l) => l.device)])),
          plan: "읽기 전용 수집 → 섀도 2주(래더 그대로) → PLC 담당 승인 → 1대 반영 2주 → 확대 판단",
          success: "섀도 기간에 억제 판정된 건 중 리셋 외 조치가 필요했던 건 0건, 리셋 해결 건 억제율 70% 이상",
          stop: "실제 이상을 억제 판정한 사례 1건 이상, 또는 해당 구간 품질 불량 증가",
          owner: "PLC 담당 + 공정 담당",
        };
        out.push({
          ...base,
          id: `debounce:${programId}:${code}`,
          kind: "debounce",
          title: `${code} ${alarm.name} — ${th.toFixed(1)}초 지속될 때만 알람`,
          summary: `리셋만으로 ${pct(resetShare)}가 풀렸고, 리셋으로 풀린 기록의 신호 지속 시간 중앙값은 ${sec(med)}입니다. 리셋으로 풀렸다고 원인이 해결된 것은 아니므로, 순간 신호를 거르는 지속 판정을 '검토 요청'합니다.`,
          appliesTo: units,
          owner: "PLC 담당 + 공정 담당",
          evidence: [
            { label: "최근 발생", value: `${days}일 ${n}건 · ${affected.length}/${units.length}대` },
            { label: "리셋만으로 해결", value: `${resetOk.length}건 (${pct(resetShare)})` },
            { label: "신호 지속 시간", value: `리셋 해결 ${secResets.length}건 기준 중앙값 ${sec(med)} · 90% ${sec(p90)} 이하 (측정값 기록 전체 ${secLogs.length}건)` },
            { label: "판정 기준", value: `리셋 해결 건의 80% 이상을 거르는 가장 짧은 시간 = ${th.toFixed(1)}초` },
            { label: "보호 구분", value: alarm.protect ? `${alarm.protect} — 공정 담당 검토 필수` : "운영" },
          ],
          histogram: {
            bins: histogram(
              secLogs.map((l) => l.measured!),
              th,
            ),
            unit: "초",
            threshold: th,
            thresholdLabel: `지속 판정 ${th.toFixed(1)}초`,
          },
          effect: {
            avoided: avoidedLogs.length,
            total: n,
            downtimeSavedMin: saved,
            perYearMin: saved * perYear,
            note: `측정값이 기록된 이력에 ${th.toFixed(1)}초 지속 판정을 가정해 다시 계산한 추정치입니다(억제됐을 것으로 추정되는 기록 ${avoidedLogs.length}건${(() => {
              const f = avoidedLogs.filter((l) => l.actionType === "리셋" && l.result === "미해결").length;
              return f ? `, 그중 리셋 미해결 ${f}건 포함` : "";
            })()}). '불필요한 알람 제거' 실적이 아니며, 섀도 모드로 실증합니다.`,
          },
          change: debounceChange(prog, alarm.device, k) ?? undefined,
          impact: whereUsed(prog, alarm.device),
          alternatives: [
            "대안 A(보호 기능 유지): 래더는 그대로 두고 FMCS·HMI 화면의 반복 표시만 묶어 보여주기(알람 플러드 억제)",
            "대안 B(근본): 전극 펄럭임·사행 원인(장력·가이드롤) 개선 후 재평가",
          ],
          checks: [
            `지연 ${th.toFixed(1)}초 동안 ${mm ? `전극 약 ${mm}mm가 통과(이송 ${speed}m/min 가정)` : "설비가 계속 동작"} — 이 구간 불량을 추적(마킹·배출)할 수 있는가`,
            ...(() => {
              // 리셋했지만 풀리지 않은 짧은 신호 — 기준 아래라 억제되는데, 같은 설비의 후속 신호로 다시 잡혔는지 확인
              const failed = secLogs.filter((l) => l.actionType === "리셋" && l.result === "미해결" && l.measured! < th);
              if (!failed.length) return [];
              const caught = failed.filter((f) =>
                secLogs.some((x) => x.equipmentId === f.equipmentId && x !== f && tOf(x) >= tOf(f) && tOf(x) - tOf(f) <= DAY_MS && x.measured! >= th),
              ).length;
              const rest = failed.length - caught;
              return [
                `리셋으로 풀리지 않은 짧은 신호 ${failed.length}건도 억제 범위 — 최초 알람이 억제·지연됐을 것은 그대로입니다. ` +
                  (caught
                    ? `${caught}건은 24시간 안에 같은 설비에 기준 이상 신호 기록이 있으나 같은 이상인지는 미확인${rest ? `, ${rest}건은 후속 기록 없음` : ""}`
                    : `${failed.length}건 모두 24시간 안에 같은 설비의 기준 이상 신호 기록이 없어 현장 확인 필요`),
              ];
            })(),
            "이 신호가 다른 인터록·동작 허가에 쓰이지 않는가 (아래 사용처 확인)",
            "센서 제조사 권장 응답 시간·필터 설정과 겹치지 않는가",
          ],
          verify: SHADOW_PLAN,
          validation,
          pilot,
          stages: stagesOf(avoidedLogs.length, n, validation, pilotTarget),
          risks: [
            "알람으로 설비가 멈추면서 신호가 짧게 기록됐을 수 있습니다. 짧다는 이유만으로 불필요한 알람이라 단정하지 말고 정지 전후 신호를 함께 확인하세요.",
            `신호가 ${th.toFixed(1)}초 이상 이어진 ${secLogs.length - avoidedLogs.length}건(오염·위치 틀어짐 등)은 이 데이터에서는 그대로 알람이 발생합니다.`,
            `같은 프로그램(${programId})을 쓰는 ${units.length}대에 함께 영향을 줍니다. 1대 시범 적용 후 확대하세요.`,
          ],
          logIds: avoidedLogs.map((l) => l.id),
        });
      } else {
        const fixes = causeStats(ls.filter((l) => l.actionType !== "리셋"));
        const best = fixes.find((f) => f.resolved >= 2);
        const saved = sum(resetOk.map((l) => l.durationMin));
        const why = protectedAlarm
          ? `${alarm.protect} 알람이라 래더로 거르지 않습니다`
          : alarm.level === "중"
            ? "중알람이라 래더로 거르지 않습니다"
            : `신호가 중앙값 ${sec(med)}로 길어, 지속 판정으로 거르면 실제 이상까지 가려집니다`;
        out.push({
          ...base,
          id: `inspect:${programId}:${code}`,
          kind: "inspect",
          title: `${code} ${alarm.name} — 리셋으로 덮지 말고 원인 점검`,
          summary: `리셋만으로 ${pct(resetShare)}가 풀렸지만, ${why}. 리셋으로 덮어 온 반복 정지를 근본 조치로 바꿉니다.`,
          appliesTo: affected,
          owner: "보전",
          evidence: [
            { label: "최근 발생", value: `${days}일 ${n}건 · ${affected.length}/${units.length}대` },
            { label: "리셋만으로 해결", value: `${resetOk.length}건 (${pct(resetShare)})` },
            { label: "신호 지속 시간", value: `리셋 해결 ${secResets.length}건 기준 중앙값 ${sec(med)} · 90% ${sec(p90)} 이하` },
            { label: "보호 구분", value: alarm.protect || "운영" },
            ...(best ? [{ label: "근본 조치 후보(이력)", value: `${best.action} — 해결 ${best.resolved}/${best.tries}` }] : []),
          ],
          histogram: {
            bins: histogram(
              secLogs.map((l) => l.measured!),
              1,
            ),
            unit: "초",
            threshold: 1,
            thresholdLabel: "지속 판정 상한 1.0초",
          },
          effect: {
            avoided: resetOk.length,
            total: n,
            downtimeSavedMin: saved,
            perYearMin: saved * perYear,
            note: "근본 원인을 없앴을 때의 최대치(추정)입니다. 리셋으로 덮어 온 정지 시간입니다.",
          },
          risks: [
            alarm.protect === "안전" ? "안전 관련 알람입니다. 리셋 반복 자체를 안전 담당과 공유하세요." : "리셋으로 계속 덮으면 같은 고장이 커질 수 있습니다.",
          ],
          logIds: resetOk.map((l) => l.id),
        });
      }
    }

    // ── 3. 타이머 설정값 ──
    // 응답이 '현재 기준보다 길고 1.5배 이내'(S < 측정 ≤ 1.5S)인 건만 본다. 기준을 줄이는 제안은 만들지 않는다.
    if (timer && secLogs.length >= 5) {
      const S = kToNumber(timer.setValue) / 10;
      const falseAlarms = secLogs.filter(
        (l) => l.result === "해결" && (l.actionType === "리셋" || l.actionType === "외부 확인") && l.measured! > S && l.measured! <= S * 1.5,
      );
      const p90 = falseAlarms.length
        ? percentile(
            falseAlarms.map((l) => l.measured!),
            0.9,
          )
        : 0;
      const newS = Math.min(Math.ceil((p90 + Math.max(0.2, S * 0.05)) * 10) / 10, S * 1.5);
      if (falseAlarms.length >= 5 && falseAlarms.length / secLogs.length >= 0.5 && newS > S) {
        const evidence = [
          { label: "최근 발생", value: `${days}일 ${n}건 · ${affected.length}/${units.length}대` },
          { label: "현재 기준", value: `${timer.device} ${timer.setValue} = ${S.toFixed(1)}초 (스텝 ${timer.step})` },
          { label: `기준보다 길고 ${(S * 1.5).toFixed(1)}초 이내에서 풀린 건`, value: `${falseAlarms.length}/${secLogs.length}건 · 90%가 ${sec(p90)} 이하` },
        ];
        if (alarm.level === "중" || protectedAlarm) {
          // 결정 4: 중알람·안전·설비 보호 알람은 기준을 늘리는 래더 변경을 제안하지 않는다 → 응답 쪽 개선을 권고
          out.push({
            ...base,
            id: `inspect:${programId}:${code}`,
            kind: "inspect",
            title: `${code} ${alarm.name} — 기준(${timer.device})은 그대로, 응답 지연 원인 개선`,
            summary: `응답이 기준 ${S.toFixed(1)}초를 조금 넘겨 리셋·재시작으로 풀린 건이 ${falseAlarms.length}건입니다. ${alarm.level === "중" ? "중알람" : `${alarm.protect} 알람`}이라 래더 기준을 늘리는 변경은 제안하지 않고, 응답이 느려진 원인(레시피 변경 후 처리 시간 등)을 개선하도록 권고합니다.`,
            appliesTo: units,
            owner: prog.devices.get(trace.leaves.find((l) => l.sourceKind === "외부 신호")?.device ?? "")?.checkWith || "설비기술",
            evidence: [...evidence, { label: "래더 변경", value: `제안 안 함 (${alarm.level === "중" ? "중알람" : alarm.protect})` }],
            histogram: {
              bins: histogram(
                secLogs.map((l) => l.measured!),
                S * 1.5,
              ),
              unit: "초",
              threshold: S * 1.5,
              thresholdLabel: `기준의 1.5배 ${(S * 1.5).toFixed(1)}초`,
              current: S,
              labels: { avoid: "기준을 조금 넘긴 응답(응답 쪽 개선 대상)", keep: "크게 넘긴 응답(실제 고장 의심)" },
            },
            effect: {
              avoided: falseAlarms.length,
              total: n,
              downtimeSavedMin: sum(falseAlarms.map((l) => l.durationMin)),
              perYearMin: sum(falseAlarms.map((l) => l.durationMin)) * perYear,
              note: "응답을 기준 안으로 되돌렸을 때의 최대치(추정)입니다. 래더는 바꾸지 않습니다.",
            },
            alternatives: ["응답 측 처리 시간 개선(레시피별 검사 항목·영상 처리 부하 점검)", "레시피 변경 전후 응답 시간 비교 자료를 담당 부서와 공유"],
            checks: ["레시피 변경 시점과 응답 증가 시점이 맞는가", "응답 측 장비의 부하·버전 변경 이력"],
            risks: ["기준을 늘리면 실제 고장 검출이 늦어집니다. 중알람은 기준 유지가 원칙입니다."],
            logIds: falseAlarms.map((l) => l.id),
          });
        } else {
          const K = Math.round(newS * 10);
          const avoidedLogs = secLogs.filter((l) => l.measured! < newS);
          const remain = secLogs.filter((l) => l.measured! >= newS);
          const saved = sum(avoidedLogs.map((l) => l.durationMin));
          // 독립 기간 검증: 앞 기간의 응답으로 검토값을 고르고 마지막 30일에 적용
          const cut = now - TEST_DAYS * DAY_MS;
          const isFalse = (l: ActionLog) =>
            l.result === "해결" && (l.actionType === "리셋" || l.actionType === "외부 확인") && l.measured! > S && l.measured! <= S * 1.5;
          const trainFalse = secLogs.filter((l) => tOf(l) < cut && isFalse(l));
          const testSec = secLogs.filter((l) => tOf(l) >= cut);
          let validation: Validation;
          if (trainFalse.length < 5 || testSec.length < 5) {
            validation = {
              trainPeriod: `${md(now - days * DAY_MS)}~${md(cut)}`,
              testPeriod: `${md(cut)}~${md(now)}`,
              param: "-",
              result: `앞 기간 측정값 ${trainFalse.length}건으로는 기준을 고를 수 없어 보류 (최근 데이터 위주 — 레시피 변경 이후 발생)`,
              status: "보류",
            };
          } else {
            const tS = Math.min(
              Math.ceil(
                (percentile(
                  trainFalse.map((l) => l.measured!),
                  0.9,
                ) +
                  Math.max(0.2, S * 0.05)) *
                  10,
              ) / 10,
              S * 1.5,
            );
            const tf = testSec.filter(isFalse);
            const okRate = tf.length ? tf.filter((l) => l.measured! < tS).length / tf.length : 0;
            const realHidden = testSec.filter((l) => !isFalse(l) && l.measured! < tS).length;
            validation = {
              trainPeriod: `${md(now - days * DAY_MS)}~${md(cut)}`,
              testPeriod: `${md(cut)}~${md(now)}`,
              param: `앞 기간에서 고른 검토값 ${tS.toFixed(1)}초`,
              result: `최근 30일 기준 바로 위 응답 ${tf.length}건 중 ${pct(okRate)} 억제(추정) · 그 외 ${testSec.length - tf.length}건 중 ${realHidden}건이 함께 가려짐`,
              status: okRate >= 0.7 && realHidden === 0 ? "통과" : "미달",
            };
          }
          const pilotTarget = Array.from(groupBy(ls, (l) => l.equipmentId).entries()).sort((a, b) => b[1].length - a[1].length)[0][0];
          const pilot: Pilot = {
            target: `${pilotTarget} (발생이 가장 많은 설비, 최종 선정은 현장 협의)`,
            tags: Array.from(new Set([alarm.device, timer.device, ...trace.leaves.map((l) => l.device)])),
            plan: "읽기 전용 수집(요청·응답 신호 짝지어 측정) → 섀도 2주 → PLC 담당 승인 → 1대 반영 2주 → 확대 판단",
            success: "섀도 기간에 검토값으로 억제된 건 중 실제 고장 0건",
            stop: "실제 고장 검출이 늦어진 사례 1건 이상",
            owner: "PLC 담당 + 설비기술",
          };
          out.push({
            ...base,
            id: `timer:${programId}:${code}`,
            kind: "timer",
            title: `${code} ${alarm.name} — ${timer.device} ${S.toFixed(1)}초 → ${newS.toFixed(1)}초 검토`,
            summary: `측정된 ${secLogs.length}건 중 ${falseAlarms.length}건이 기준 ${S.toFixed(1)}초를 넘긴 뒤 ${(S * 1.5).toFixed(1)}초 안에서 리셋·재시작으로 풀렸습니다. 기준이 현재 공정 속도와 맞는지 검토를 요청합니다.`,
            appliesTo: units,
            owner: "PLC 담당 + 설비기술",
            evidence: [...evidence, { label: "검토 출발값", value: `90% 값 + 여유 = ${newS.toFixed(1)}초 (통계값일 뿐 안전 근거는 아님)` }],
            histogram: {
              bins: histogram(
                secLogs.map((l) => l.measured!),
                newS,
              ),
              unit: "초",
              threshold: newS,
              thresholdLabel: `검토값 ${newS.toFixed(1)}초`,
              current: S,
            },
            effect: {
              avoided: avoidedLogs.length,
              total: n,
              downtimeSavedMin: saved,
              perYearMin: saved * perYear,
              note: `측정값이 기록된 이력에 검토값을 가정하면 ${avoidedLogs.length}건이 억제됩니다(추정). ${remain.length}건(${remain.length ? sec(Math.min(...remain.map((l) => l.measured!))) + " 이상" : "-"})은 이 데이터에서 알람이 유지되지만, 고장 검출이 늦어질 수 있습니다.`,
            },
            change: timerChange(prog, timer.device, K) ?? undefined,
            impact: whereUsed(prog, timer.device),
            alternatives: ["대안(근본): 응답 쪽(처리 시간·사이클 시퀀스) 개선 후 기준 유지", "대안: 1회 재요청 후 판정하도록 시퀀스 변경"],
            checks: [
              "이 타이머의 역할(통신 감시·안전 감시·품질 판정)과 최대 허용 검출 시간",
              "장비 제조사가 제시한 응답 허용치",
              `검출이 최대 ${(newS - S).toFixed(1)}초 늦어질 때 생기는 영향`,
              "최근 레시피 변경 이후 데이터 위주인지 — 레시피를 되돌리면 재검토",
            ],
            verify: SHADOW_PLAN,
            validation,
            pilot,
            stages: stagesOf(avoidedLogs.length, n, validation, pilotTarget),
            risks: ["통계값(90% + 여유)은 안전 근거가 아닙니다. 확인 항목을 채운 뒤 승인하세요."],
            logIds: avoidedLogs.map((l) => l.id),
          });
        }
      }
    }

    // ── 4. 예방정비 주기 ──
    const maint = ls.filter((l) => l.actionType === "부품 교체" || l.actionType === "청소" || l.actionType === "보충");
    if (maint.length >= 6) {
      const top = Array.from(groupBy(maint, (l) => l.action).entries()).sort((a, b) => b[1].length - a[1].length)[0];
      const [action, dl] = top;
      const intervals: number[] = [];
      const lastBy = new Map<string, number>();
      for (const [unit, ul] of Array.from(groupBy(dl, (l) => l.equipmentId).entries())) {
        const ts = ul.map((l) => new Date(l.occurredAt).getTime()).sort((a, b) => a - b);
        for (let i = 1; i < ts.length; i++) intervals.push((ts[i] - ts[i - 1]) / DAY_MS);
        lastBy.set(unit, ts[ts.length - 1]);
      }
      const m = mean(intervals);
      const cv = m ? stdev(intervals) / m : 1;
      if (intervals.length >= 4 && cv <= 0.35) {
        const pmDays = Math.max(1, Math.floor(m * 0.85));
        const saved = sum(dl.map((l) => l.durationMin)) * 0.3;
        const schedule = Array.from(lastBy.entries())
          .map(([equipmentId, last]) => {
            const next = last + pmDays * DAY_MS;
            return { equipmentId, last: new Date(last).toISOString(), next: new Date(next).toISOString(), overdue: next < now };
          })
          .sort((a, b) => a.next.localeCompare(b.next));
        const nUnits = lastBy.size;
        out.push({
          ...base,
          id: `pm:${programId}:${code}`,
          kind: "pm",
          title: `${code} ${alarm.name} — ${pmDays}일 주기 예방정비: ${action}`,
          summary: `알람이 발생한 뒤에 '${action}'을 한 간격이 평균 ${m.toFixed(1)}일로 일정합니다(변동 ${pct(cv)}). 알람 전에 계획 정비로 바꾸는 것을 제안합니다.`,
          appliesTo: Array.from(lastBy.keys()).sort(),
          owner: "보전",
          evidence: [
            { label: "알람 후 같은 조치", value: `${dl.length}건 · ${nUnits}대` },
            { label: "조치 간격", value: `평균 ${m.toFixed(1)}일 · 표준편차 ${stdev(intervals).toFixed(1)}일 (변동 ${pct(cv)})` },
            { label: "제안 주기", value: `평균의 85% = ${pmDays}일 (첫 적용 값, 운전 실적으로 보정)` },
            { label: "부품·작업 횟수", value: `연 ${Math.round((365 / m) * nUnits)}회 → ${Math.round((365 / pmDays) * nUnits)}회` },
          ],
          histogram: { bins: histogram(intervals, pmDays, 10, true), unit: "일", threshold: pmDays, thresholdLabel: `제안 주기 ${pmDays}일` },
          effect: {
            avoided: dl.length,
            total: n,
            downtimeSavedMin: saved,
            perYearMin: saved * perYear,
            note: "돌발 정지가 계획 정비로 바뀝니다. 호출·대기·부품 수급 시간이 없어져 정지 시간이 30% 준다고 가정한 추정치입니다.",
          },
          schedule,
          checks: [
            "간격이 일정한 이유가 기존 정기점검 일정 때문은 아닌가 (여기서는 알람 뒤 조치만 집계)",
            "달력 일수보다 운전 시간·처리량(타발 수·m) 기준 주기가 더 맞지 않는가",
            "교체품의 실제 마모 상태",
          ],
          risks: ["주기가 짧아지는 만큼 부품·작업 횟수가 늘어납니다.", "첫 2~3회는 교체품 마모 상태를 기록해 주기를 보정하세요."],
          logIds: dl.map((l) => l.id),
        });
      }
    }

    // ── 5. 매뉴얼 보강 ──
    const manuals = input.manuals.filter((m) => m.programId === programId && m.alarmCode === code);
    const resolvedBy = groupBy(
      ls.filter((l) => l.result === "해결" && l.actionType !== "리셋"),
      (l) => l.action,
    );
    const unresolved = ls.filter((l) => l.result === "미해결");
    const recurrence = (al: ActionLog[]) => {
      let again = 0;
      for (const l of al) {
        const t = new Date(l.occurredAt).getTime();
        if (
          input.logs.some(
            (x) =>
              x.equipmentId === l.equipmentId &&
              x.alarmCode === code &&
              new Date(x.occurredAt).getTime() > t &&
              new Date(x.occurredAt).getTime() - t <= 7 * DAY_MS,
          )
        )
          again++;
      }
      return again;
    };
    const missing = Array.from(resolvedBy.entries())
      .map(([action, al]) => ({ action, al, tries: ls.filter((l) => l.action === action).length }))
      .filter((x) => x.al.length >= 3 && x.al.length / x.tries >= 0.7 && !isInManual(x.action, manuals))
      .sort((a, b) => b.al.length - a.al.length);
    if (missing.length && (n >= 6 || unresolved.length / n >= 0.25)) {
      const top = missing[0];
      const avgFix = mean(top.al.map((l) => l.durationMin));
      const avgOther = mean(ls.filter((l) => l.action !== top.action).map((l) => l.durationMin));
      const unresolvedMin = sum(unresolved.map((l) => l.durationMin));
      const again = recurrence(top.al);
      const temporary = again / top.al.length > 0.5;
      out.push({
        ...base,
        id: `manual:${programId}:${code}`,
        kind: "manual",
        title: `${code} ${alarm.name} — 매뉴얼에 '${top.action}' 추가 검토`,
        summary: temporary
          ? `매뉴얼에 없는 조치로 ${top.al.length}번 풀렸지만 7일 안에 ${again}번 재발했습니다. 임시 조치일 수 있어 원인 조치와 함께 검토합니다.`
          : `매뉴얼에 없는 조치로 ${top.al.length}번 해결됐고 7일 안 재발은 ${again}번입니다. 매뉴얼대로 한 조치는 ${unresolved.length}건이 미해결이었습니다.`,
        appliesTo: affected,
        owner: "보전·운영",
        evidence: [
          { label: "최근 발생", value: `${days}일 ${n}건 · 미해결 ${unresolved.length}건 (${pct(unresolved.length / n)})` },
          { label: "매뉴얼 밖 조치", value: `${top.action} — 해결 ${top.al.length}/${top.tries}` },
          { label: "조치 후 7일 안 재발", value: `${again}/${top.al.length}건${temporary ? " (임시 조치 의심)" : ""}` },
          { label: "평균 조치 시간", value: `이 조치 ${Math.round(avgFix)}분 · 그 외 ${Math.round(avgOther)}분` },
          {
            label: "처음 쓴 사람",
            value: Array.from(new Set(top.al.map((l) => l.worker)))
              .slice(0, 3)
              .join(", "),
          },
        ],
        effect: {
          avoided: 0,
          total: n,
          downtimeSavedMin: unresolvedMin * 0.5,
          perYearMin: unresolvedMin * 0.5 * perYear,
          note: "알람 수는 그대로지만, 미해결로 길어진 시간이 절반으로 준다고 가정한 추정치입니다.",
        },
        manualDraft: {
          cause: top.al[0].cause,
          steps: [`${top.al[0].cause} 여부 확인`, top.action, "조치 후 알람 재발 여부 10분 관찰"],
        },
        checks: ["인터록 우회·임시 조치가 섞이지 않았는가", "조치 내용이 설비 사양(설정 범위) 안인가", "해결 판단 근거(재발 없음 기간)"],
        risks: ["매뉴얼 반영 전 보전 담당이 조치의 안전성과 적절성을 확인하세요."],
        logIds: top.al.map((l) => l.id),
      });
    }

    // ── 6. 설비 편중 ──
    const spread = fleetSpread(recent, code, units);
    if (spread.total >= 5 && spread.top.count >= 5 && spread.topShare >= Math.max(0.6, 2.5 / units.length)) {
      const unitLogs = ls.filter((l) => l.equipmentId === spread.top.unit);
      const cs = causeStats(unitLogs);
      const saved = sum(unitLogs.map((l) => l.durationMin));
      out.push({
        ...base,
        id: `unit:${programId}:${code}:${spread.top.unit}`,
        kind: "unit",
        title: `${spread.top.unit} ${alarm.name} — 설비 편중 원인 조사`,
        summary: `같은 프로그램 ${units.length}대 중 ${spread.top.unit}에서 전체의 ${pct(spread.topShare)}가 발생했습니다. 같은 래더인데 한 대에 몰렸으므로 래더보다 이 설비의 조건(부품·레시피·가동 시간) 차이를 먼저 조사합니다.`,
        appliesTo: [spread.top.unit],
        owner: "보전",
        evidence: [
          { label: "설비군 분포", value: `${units.length}대 중 ${spread.affected}대 발생 · ${spread.top.unit} ${spread.top.count}/${spread.total}건` },
          ...cs.slice(0, 2).map((c) => ({ label: `${c.cause}`, value: `${c.action} — 해결 ${c.resolved}/${c.tries}` })),
          { label: "미해결", value: `${unitLogs.filter((l) => l.result === "미해결").length}건` },
        ],
        effect: {
          avoided: unitLogs.length,
          total: n,
          downtimeSavedMin: saved,
          perYearMin: saved * perYear,
          note: "편중 원인을 없앴을 때의 최대치(추정)입니다.",
        },
        checks: [
          "가동 시간·생산량이 다른 설비와 비슷한가 (시간당 발생률로 비교)",
          "이 설비만 다른 레시피·프로그램 버전·개조 이력이 있는가",
          "같은 조치 반복 대신 관련 부품(앰프·배선 등) 함께 점검",
        ],
        risks: ["가동 시간 차이만으로도 편중이 생길 수 있습니다."],
        logIds: unitLogs.map((l) => l.id),
      });
    }

    // ── 7. 외부 신호 원천 ──
    const srcCount = Array.from(groupBy(ls, (l) => l.sourceDevice).entries()).sort((a, b) => b[1].length - a[1].length)[0];
    const srcInfo = srcCount ? prog.devices.get(srcCount[0]) : undefined;
    const avgMin = mean(ls.map((l) => l.durationMin));
    const externalShare = ls.filter((l) => l.actionType === "외부 확인").length / n;
    if (srcInfo?.sourceKind === "외부 신호" && externalShare >= 0.5 && n >= 5 && avgMin >= 15) {
      const saved = sum(ls.map((l) => l.durationMin)) * 0.5;
      const clusters = simultaneousClusters(ls);
      const byShift = groupBy(ls, (l) => {
        const h = new Date(l.occurredAt).getHours();
        return h >= 6 && h < 14 ? "주간" : h >= 14 && h < 22 ? "오후" : "야간";
      });
      out.push({
        ...base,
        id: `external:${programId}:${code}`,
        kind: "external",
        title: `${code} ${alarm.name} — 송수신 경계 공동 점검: ${srcInfo.checkWith || "담당 부서"}`,
        summary: `원천이 외부 신호(${srcInfo.device} ${srcInfo.comment})이고 평균 ${Math.round(avgMin)}분을 기다렸습니다.${clusters.length ? ` 여러 설비가 15분 안에 함께 멈춘 적이 ${clusters.length}번 있어 공용 원인이 의심됩니다.` : ""} 어느 쪽 책임인지보다 송신·수신 경계를 함께 점검하자고 제안합니다.`,
        appliesTo: affected,
        owner: `${srcInfo.checkWith || "담당 부서"} + 우리 보전`,
        evidence: [
          { label: "최근 발생", value: `${days}일 ${n}건 · ${affected.length}대` },
          { label: "평균 대기·조치", value: `${Math.round(avgMin)}분 (총 ${Math.round(sum(ls.map((l) => l.durationMin)) / 60)}시간, 대기 포함)` },
          { label: "동시 다발", value: clusters.length ? `${clusters.length}회 — 예: ${clusters[0].units.join(", ")}` : "없음" },
          { label: "교대별", value: ["주간", "오후", "야간"].map((s) => `${s} ${byShift.get(s)?.length ?? 0}`).join(" · ") },
        ],
        effect: {
          avoided: 0,
          total: n,
          downtimeSavedMin: saved,
          perYearMin: saved * perYear,
          note: "대응 시간을 절반으로 줄였을 때의 추정치입니다. 이 화면을 협의 자료로 그대로 공유하세요.",
        },
        checks: [
          "송신 측(MES·유틸리티) 기록과 시각 대조",
          "수신 PLC 쪽 통신 설정·로컬 네트워크·신호선 상태",
          "동시 다발 시각의 공용 설비(압공·냉각수·서버) 이벤트",
        ],
        risks: ["우리 설비 래더를 바꿔 숨기지 마세요.", "수신 PLC·로컬 네트워크 문제일 수도 있습니다."],
        logIds: ls.map((l) => l.id),
      });
    }
  }

  const computedAt = new Date(now).toISOString();
  for (const p of out)
    p.meta = {
      period: `${md(now - days * DAY_MS)}~${md(now)} (${days}일)`,
      ruleVersion: RULE_VERSION,
      computedAt,
      logCount: p.effect.total,
      programId: p.programId,
    };
  return out.sort((a, b) => b.effect.perYearMin - a.effect.perYearMin);
}
