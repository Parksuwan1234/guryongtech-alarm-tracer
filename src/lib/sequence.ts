// 순차 동작(시퀀스) 흐름도 — 올린 래더에서 단계·전이 조건·단계별 출력·감시 타이머·연결된 알람을 찾아 그림으로 그릴 수 있게 정리한다.
// 남이 짠 래더도 "어떤 순서로 움직이고, 어디서 기다리다가 알람이 나는지"를 한눈에 보게 하는 것이 목적이다.
// 코드가 계산하므로 같은 래더·같은 값이면 늘 같은 결과가 나온다.

import { Evaluator, buildRungs, findStepEdges, kToNumber, sequenceRoots, type Contact, type Rung, type Values } from "./ladder";
import type { AlarmDef, ParsedProgram, SourceKind } from "./types";

export interface SeqCondition {
  device: string;
  comment: string;
  instr: string;
  negated: boolean;
  compare: Contact["compare"];
  ladderStep: number;
  sourceKind: SourceKind | null;
  where: string;
  checkWith: string;
}

export interface SeqTransition {
  from: string;
  to: string;
  conditions: SeqCondition[];
  /** 조건에 OR가 섞여 있어 '모두 성립'으로 읽으면 안 되는 경우 */
  complex: boolean;
  ladderStep: number;
  /** 마지막 단계에서 첫 단계로 돌아가는 전이 */
  loopBack: boolean;
}

export interface SeqAction {
  device: string;
  comment: string;
  ladderStep: number;
}

export interface SeqStep {
  device: string;
  label: string;
  order: number;
  actions: SeqAction[];
}

export interface SeqWatch {
  timer: string;
  seconds: number | null;
  comment: string;
  ladderStep: number;
  /** 이 타이머가 지켜보는 단계·단계 출력 */
  watches: { device: string; comment: string; negated: boolean }[];
  alarms: AlarmDef[];
}

export interface Sequence {
  id: string;
  title: string;
  style: "set-rst" | "self-hold";
  steps: SeqStep[];
  transitions: SeqTransition[];
  watches: SeqWatch[];
  /** 이 시퀀스를 거쳐서 켜지는 알람 */
  alarms: AlarmDef[];
  devices: Set<string>;
}

const label = (prog: ParsedProgram, device: string, fallback = "") => prog.devices.get(device)?.comment || fallback || device;

function contactInstr(c: Contact): string {
  if (c.compare) return `${c.op}${c.compare.op}`;
  if (c.op === "LD") return c.negated ? "LDI" : "LD";
  if (c.op === "AND") return c.negated ? "ANI" : "AND";
  return c.negated ? "ORI" : "OR";
}

function toCondition(prog: ParsedProgram, c: Contact): SeqCondition {
  const info = prog.devices.get(c.device);
  return {
    device: c.device,
    comment: info?.comment || c.comment || c.device,
    instr: contactInstr(c),
    negated: c.negated,
    compare: c.compare,
    ladderStep: c.step,
    sourceKind: info?.sourceKind ?? null,
    where: info?.where ?? "",
    checkWith: info?.checkWith ?? "",
  };
}

/** 어떤 디바이스를 켜는 회로들을 거꾸로 따라가 닿는 디바이스 전부 (깊이 제한) */
function upstream(rungs: Rung[], device: string, depth = 10): Set<string> {
  const seen = new Set<string>();
  const walk = (d: string, k: number) => {
    if (seen.has(d) || k > depth) return;
    seen.add(d);
    for (const r of rungs) if (r.outputs.some((o) => o.device === d && o.instr !== "RST")) for (const c of r.contacts) walk(c.device, k + 1);
  };
  walk(device, 0);
  return seen;
}

export function detectSequences(prog: ParsedProgram): Sequence[] {
  const rungs = buildRungs(prog.rows);
  const edges = findStepEdges(rungs);
  if (!edges.length) return [];
  const roots = sequenceRoots(edges);
  const byRoot = new Map<string, typeof edges>();
  for (const e of edges) {
    const r = roots.get(e.from)!;
    byRoot.set(r, [...(byRoot.get(r) ?? []), e]);
  }

  const result: Sequence[] = [];
  for (const [root, es] of byRoot) {
    // 단계 순서: 첫 단계에서 전이를 따라간다 (갈림길은 나온 순서대로)
    const order: string[] = [];
    const queue = [root];
    while (queue.length) {
      const d = queue.shift()!;
      if (order.includes(d)) continue;
      order.push(d);
      for (const e of es.filter((x) => x.from === d)) if (!order.includes(e.to)) queue.push(e.to);
    }
    const stepSet = new Set(order);
    const setRow = (d: string) => es.find((e) => e.to === d)?.rung.outputs.find((o) => o.device === d);
    const edgeRungs = new Set(es.map((e) => e.rung.index));

    // 단계별 출력: 단계 비트(들)만으로 켜지는 OUT
    const actions = new Map<string, SeqAction[]>();
    const devices = new Set<string>(stepSet);
    for (const r of rungs) {
      if (edgeRungs.has(r.index) || !r.contacts.length) continue;
      if (!r.contacts.every((c) => !c.negated && !c.compare && c.op !== "AND" && stepSet.has(c.device))) continue;
      for (const o of r.outputs) {
        if (o.instr === "RST") continue;
        devices.add(o.device);
        for (const c of r.contacts)
          actions.set(c.device, [...(actions.get(c.device) ?? []), { device: o.device, comment: label(prog, o.device, o.comment), ladderStep: o.step }]);
      }
    }

    const steps: SeqStep[] = order.map((d, i) => ({ device: d, label: label(prog, d, setRow(d)?.comment), order: i, actions: actions.get(d) ?? [] }));
    const transitions: SeqTransition[] = es
      .slice()
      .sort((a, b) => order.indexOf(a.from) - order.indexOf(b.from))
      .map((e) => ({
        from: e.from,
        to: e.to,
        conditions: e.conditions.map((c) => toCondition(prog, c)),
        complex: e.complex,
        ladderStep: e.rung.contacts[0]?.step ?? 0,
        loopBack: order.indexOf(e.to) <= order.indexOf(e.from),
      }));

    // 감시 타이머: 단계나 단계 출력을 조건으로 쓰는 타이머
    const watches: SeqWatch[] = [];
    for (const r of rungs) {
      const t = r.outputs.find((o) => o.instr === "OUT" && /^T\d+$/.test(o.device));
      if (!t) continue;
      const w = r.contacts.filter((c) => devices.has(c.device));
      if (!w.length) continue;
      const alarms = prog.alarms.filter((a) => upstream(rungs, a.device).has(t.device));
      watches.push({
        timer: t.device,
        seconds: /^K\d+$/.test(t.setValue) ? kToNumber(t.setValue) / 10 : null,
        comment: label(prog, t.device, t.comment),
        ladderStep: t.step,
        watches: w.map((c) => ({ device: c.device, comment: label(prog, c.device, c.comment), negated: c.negated })),
        alarms,
      });
    }

    const alarms = prog.alarms.filter((a) => {
      const up = upstream(rungs, a.device);
      return Array.from(devices).some((d) => up.has(d)) || watches.some((w) => up.has(w.timer));
    });

    const first = steps[0];
    const last = steps[steps.length - 1];
    result.push({
      id: root,
      title: `${first.device}~${last.device} · ${steps.length}단계`,
      style: es[0].style,
      steps,
      transitions,
      watches,
      alarms,
      devices,
    });
  }
  return result;
}

export interface SeqPosition {
  /** 스냅샷에 단계 비트 값이 있어 현재 단계를 알 수 있는가 */
  known: boolean;
  active: {
    step: SeqStep;
    next: {
      transition: SeqTransition;
      conditions: (SeqCondition & { value: number; ok: boolean })[];
      /** 모든 조건이 성립했는가 (complex면 판단하지 않음) */
      ready: boolean | null;
    }[];
  }[];
}

/** 스냅샷 값으로 '지금 어느 단계에서, 어떤 조건을 기다리는지' */
export function sequencePosition(prog: ParsedProgram, seq: Sequence, values: Values): SeqPosition {
  const known = seq.steps.some((s) => s.device in values);
  if (!known) return { known, active: [] };
  const rungs = buildRungs(prog.rows);
  const ev = new Evaluator(prog, rungs, values);
  const active = seq.steps
    .filter((s) => (values[s.device] ?? 0) !== 0)
    .map((step) => ({
      step,
      next: seq.transitions
        .filter((t) => t.from === step.device)
        .map((transition) => {
          const conditions = transition.conditions.map((c) => {
            const contact: Contact = { step: c.ladderStep, op: "AND", negated: c.negated, device: c.device, compare: c.compare, comment: c.comment };
            return { ...c, value: ev.value(c.device), ok: ev.contactTrue(contact) };
          });
          return { transition, conditions, ready: transition.complex ? null : conditions.every((c) => c.ok) };
        }),
    }));
  return { known, active };
}

/** 알람과 이어진 시퀀스 (역추적이 시퀀스에서 멈춘 경우) */
export function sequencesForAlarm(seqs: Sequence[], alarmCode: string): Sequence[] {
  return seqs.filter((s) => s.alarms.some((a) => a.code === alarmCode));
}
