// 조치이력 통계 (KPI · 파레토 · 설비군 비교 · 원인별 해결률 · 교대 구분)

import type { ActionLog } from "./types";

export const DAY_MS = 86400000;

export function since(logs: ActionLog[], days: number, now = Date.now()): ActionLog[] {
  const from = now - days * DAY_MS;
  return logs.filter((l) => new Date(l.occurredAt).getTime() >= from);
}

export function mean(xs: number[]): number {
  return xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0;
}

export function stdev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1));
}

export function percentile(xs: number[], p: number): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const idx = (s.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return s[lo] + (s[hi] - s[lo]) * (idx - lo);
}

export function groupBy<T>(xs: T[], key: (x: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const x of xs) {
    const k = key(x);
    const arr = m.get(k);
    if (arr) arr.push(x);
    else m.set(k, [x]);
  }
  return m;
}

export interface AlarmStat {
  alarmCode: string;
  count: number;
  downtimeMin: number;
  mttrMin: number;
  resolveRate: number;
  units: number;
}

export function alarmStats(logs: ActionLog[]): AlarmStat[] {
  return Array.from(groupBy(logs, (l) => l.alarmCode).entries())
    .map(([alarmCode, ls]) => ({
      alarmCode,
      count: ls.length,
      downtimeMin: ls.reduce((s, l) => s + l.durationMin, 0),
      mttrMin: mean(ls.map((l) => l.durationMin)),
      resolveRate: ls.filter((l) => l.result === "해결").length / ls.length,
      units: new Set(ls.map((l) => l.equipmentId)).size,
    }))
    .sort((a, b) => b.downtimeMin - a.downtimeMin);
}

export interface CauseStat {
  cause: string;
  action: string;
  actionType: string;
  tries: number;
  resolved: number;
  avgMin: number;
  lastAt: string; // 마지막으로 이 조치를 한 시각
  evidence: Evidence;
}

/** 근거 강도: 1/1(100%)과 80/100(80%)을 같은 무게로 보지 않도록 표본 수로 구분 */
export type Evidence = "근거 충분" | "근거 보통" | "표본 적음";
export function evidenceOf(n: number): Evidence {
  return n >= 5 ? "근거 충분" : n >= 3 ? "근거 보통" : "표본 적음";
}

/** 해결률의 윌슨 하한(95%) — 표본이 적은 100%가 표본 많은 80%를 앞지르지 않게 정렬에 사용 */
export function wilsonLower(success: number, n: number, z = 1.96): number {
  if (n === 0) return 0;
  const p = success / n;
  const d = 1 + (z * z) / n;
  const c = p + (z * z) / (2 * n);
  const m = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return (c - m) / d;
}

/** 같은 알람의 과거 원인·조치별 해결률 ('해결 x/y'), 표본 수로 보정한 순서 */
export function causeStats(logs: ActionLog[]): CauseStat[] {
  return Array.from(groupBy(logs, (l) => `${l.cause}|${l.action}`).values())
    .map((ls) => ({
      cause: ls[0].cause,
      action: ls[0].action,
      actionType: ls[0].actionType,
      tries: ls.length,
      resolved: ls.filter((l) => l.result === "해결").length,
      avgMin: mean(ls.map((l) => l.durationMin)),
      lastAt: ls.reduce((m, l) => (l.occurredAt > m ? l.occurredAt : m), ""),
      evidence: evidenceOf(ls.length),
    }))
    .sort((a, b) => wilsonLower(b.resolved, b.tries) - wilsonLower(a.resolved, a.tries) || b.tries - a.tries);
}

/** 설비군 비교: 같은 알람이 몇 대에서 났는지, 한 대에 몰렸는지 */
export function fleetSpread(logs: ActionLog[], code: string, units: string[]) {
  const ls = logs.filter((l) => l.alarmCode === code && units.includes(l.equipmentId));
  const counts = units.map((u) => ({ unit: u, count: ls.filter((l) => l.equipmentId === u).length }));
  const total = ls.length;
  const top = [...counts].sort((a, b) => b.count - a.count)[0];
  const affected = counts.filter((c) => c.count > 0).length;
  const topShare = total ? top.count / total : 0;
  let verdict: "single" | "common" | "few" | "none" = "none";
  if (total === 0) verdict = "none";
  else if (topShare >= 0.6 && units.length >= 3) verdict = "single";
  else if (affected >= Math.max(2, Math.ceil(units.length * 0.5))) verdict = "common";
  else verdict = "few";
  return { counts, total, affected, top, topShare, verdict };
}

export type Shift = "주간" | "오후" | "야간";

export function shiftOf(d: Date): Shift {
  const h = d.getHours();
  if (h >= 6 && h < 14) return "주간";
  if (h >= 14 && h < 22) return "오후";
  return "야간";
}

/** 교대 시작 시각 (야간은 22시 시작, 자정 이후는 전날 22시) */
export function shiftStart(d: Date): Date {
  const s = new Date(d);
  s.setMinutes(0, 0, 0);
  const h = d.getHours();
  if (h >= 6 && h < 14) s.setHours(6);
  else if (h >= 14 && h < 22) s.setHours(14);
  else {
    if (h < 6) s.setDate(s.getDate() - 1);
    s.setHours(22);
  }
  return s;
}

export function fmtMin(min: number): string {
  if (min < 60) return `${Math.round(min)}분`;
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return m ? `${h}시간 ${m}분` : `${h}시간`;
}

export function fmtDate(iso: string | number | Date, withTime = true): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  const date = `${p(d.getMonth() + 1)}/${p(d.getDate())}`;
  return withTime ? `${date} ${p(d.getHours())}:${p(d.getMinutes())}` : date;
}

/** 설비 신뢰성 지표 — 조치이력 1건을 정지 1회로 본 근사치 (실제는 PLC 정지 이벤트로 계산) */
export function reliability(logs: ActionLog[], days: number) {
  const count = logs.length;
  const downMin = logs.reduce((s, l) => s + l.durationMin, 0);
  const totalMin = days * 24 * 60;
  return {
    count,
    downMin,
    mttrMin: count ? downMin / count : 0, // 평균 복구 시간
    mtbfH: count ? (totalMin - downMin) / count / 60 : totalMin / 60, // 평균 고장 간격(시간)
    availability: totalMin ? (totalMin - downMin) / totalMin : 1,
  };
}

/** 최근 n주 주별 건수(오래된 주 → 최근 주) */
export function weeklyCounts(logs: ActionLog[], weeks: number, now = Date.now()): number[] {
  const out = Array(weeks).fill(0) as number[];
  const W = 7 * 86400000;
  for (const l of logs) {
    const age = now - new Date(l.occurredAt).getTime();
    const i = weeks - 1 - Math.floor(age / W);
    if (i >= 0 && i < weeks) out[i]++;
  }
  return out;
}

/** 같은 설비·같은 알람이 최근 며칠 안에 몇 번 났는가 — 반복 알람 표시용 */
export function repeatCount(logs: ActionLog[], equipmentId: string, alarmCode: string, days = 7, now = Date.now()): number {
  const from = now - days * 86400000;
  return logs.filter((l) => l.equipmentId === equipmentId && l.alarmCode === alarmCode && new Date(l.occurredAt).getTime() >= from).length;
}
export const REPEAT_THRESHOLD = 3; // 7일 3회 이상이면 '반복 알람'

export interface UnitRow {
  unit: string;
  count: number;
  share: number;
  resetResolved: number;
  /** 측정값(신호 지속 등) 중앙값 — 측정값이 없으면 null */
  median: number | null;
  measuredN: number;
}

/**
 * 호기별 분포: 같은 프로그램 설비군에 한 번에 제안하더라도, 실제 기록이 한 대에 몰렸는지·호기마다 신호가 다른지 본다.
 * (설비군 전체 중앙값만 보면 한 호기의 문제를 전체 문제로 오해할 수 있다)
 */
export function unitBreakdown(logs: ActionLog[], code: string, units: string[], measuredUnit?: string) {
  const ls = logs.filter((l) => l.alarmCode === code && units.includes(l.equipmentId));
  const total = ls.length;
  const rows: UnitRow[] = units
    .map((unit) => {
      const u = ls.filter((l) => l.equipmentId === unit);
      const m = u.filter((l) => l.measured !== null && (!measuredUnit || l.measuredUnit === measuredUnit)).map((l) => l.measured as number);
      return {
        unit,
        count: u.length,
        share: total ? u.length / total : 0,
        resetResolved: u.filter((l) => l.actionType === "리셋" && l.result === "해결").length,
        median: m.length ? percentile(m, 0.5) : null,
        measuredN: m.length,
      };
    })
    .sort((a, b) => b.count - a.count || a.unit.localeCompare(b.unit));
  const all = ls.filter((l) => l.measured !== null && (!measuredUnit || l.measuredUnit === measuredUnit)).map((l) => l.measured as number);
  const fleetMedian = all.length ? percentile(all, 0.5) : null;
  const spread = fleetSpread(logs, code, units);
  // 다른 호기와 신호 길이가 크게 다른 호기(중앙값이 설비군 중앙값의 2배 이상 또는 절반 이하, 기록 3건 이상)
  const outliers = rows.filter(
    (r) => r.median !== null && fleetMedian !== null && fleetMedian > 0 && r.measuredN >= 3 && (r.median >= fleetMedian * 2 || r.median <= fleetMedian / 2),
  );
  return { rows, total, fleetMedian, topShare: spread.topShare, affected: spread.affected, verdict: spread.verdict, outliers };
}
