// 래더(명령어 리스트) 파싱 · 평가 · 역추적 · 변경안 생성
//
// 지원 명령: LD LDI AND ANI OR ORI (+ 비교 LD>= AND< OR= 등), OUT SET RST
// 실제 PLC의 블록 명령(ANB/ORB/MPS)은 시제품 범위에서 다루지 않는다.

import { parseCsv } from "./csv";
import type { AlarmDef, DeviceInfo, IlRow, ParsedProgram, PlcProgram, SourceKind } from "./types";

// ---------- 파싱 ----------

export function parseProgram(p: PlcProgram): ParsedProgram {
  const rows: IlRow[] = parseCsv(p.ladderCsv).map((r) => ({
    step: Number(r["스텝"] ?? r["step"] ?? 0),
    instr: (r["명령"] ?? r["instr"] ?? "").toUpperCase(),
    device: (r["디바이스"] ?? r["device"] ?? "").toUpperCase(),
    setValue: (r["설정값"] ?? r["setValue"] ?? "").toUpperCase(),
    comment: r["코멘트"] ?? r["comment"] ?? "",
  }));
  const devices = new Map<string, DeviceInfo>();
  for (const r of parseCsv(p.devicesCsv)) {
    const device = (r["디바이스"] ?? "").toUpperCase();
    if (!device) continue;
    const normalRaw = r["평상값"] ?? "";
    devices.set(device, {
      device,
      comment: r["코멘트"] ?? "",
      sourceKind: normalizeSourceKind(r["원천구분"] ?? "", device),
      normal: normalRaw === "" ? null : Number(normalRaw),
      role: r["역할"] === "리셋" ? "reset" : r["역할"] === "상태" ? "state" : "",
      checkWith: r["확인처"] ?? "",
      where: r["위치"] ?? "",
    });
  }
  const alarms: AlarmDef[] = parseCsv(p.alarmsCsv).map((r) => ({
    code: r["알람번호"] ?? "",
    device: (r["디바이스"] ?? "").toUpperCase(),
    level: (r["등급"] === "중" ? "중" : "경") as "경" | "중",
    name: r["알람명"] ?? "",
    protect: (["안전", "설비 보호", "품질"].includes(r["보호구분"] ?? "") ? r["보호구분"] : "") as AlarmDef["protect"],
  }));
  return { id: p.id, name: p.name, rows, devices, alarms };
}

function normalizeSourceKind(raw: string, device: string): SourceKind {
  if (raw === "현장 입력" || raw === "외부 신호" || raw === "래더 로직") return raw;
  // 구분이 비어 있으면 디바이스 종류로 추정
  if (/^X/.test(device)) return "현장 입력";
  if (/^(B|W|SB|SW)/.test(device)) return "외부 신호";
  return "래더 로직";
}

// ---------- 회로(Rung) 구성 ----------

export interface Contact {
  step: number;
  op: "LD" | "AND" | "OR";
  negated: boolean;
  device: string;
  compare: { op: string; value: string } | null;
  comment: string;
}

export interface Output {
  step: number;
  instr: "OUT" | "SET" | "RST";
  device: string;
  setValue: string;
  comment: string;
}

export interface Rung {
  index: number;
  contacts: Contact[];
  outputs: Output[];
  rows: IlRow[];
}

const CONTACT_RE = /^(LDI|LD|ANI|AND|ORI|OR)(<=|>=|<>|=|<|>)?$/;

export function buildRungs(rows: IlRow[]): Rung[] {
  const rungs: Rung[] = [];
  let cur: Rung | null = null;
  let lastWasOutput = false;
  for (const row of rows) {
    const m = row.instr.match(CONTACT_RE);
    if (m) {
      const base = m[1];
      const cmp = m[2] ?? null;
      const op: Contact["op"] = base.startsWith("LD") ? "LD" : base.startsWith("AN") ? "AND" : "OR";
      if (op === "LD" && (cur === null || lastWasOutput)) {
        cur = { index: rungs.length, contacts: [], outputs: [], rows: [] };
        rungs.push(cur);
      }
      if (!cur) continue;
      cur.contacts.push({
        step: row.step,
        op,
        negated: !cmp && (base === "LDI" || base === "ANI" || base === "ORI"),
        device: row.device,
        compare: cmp ? { op: cmp, value: row.setValue } : null,
        comment: row.comment,
      });
      cur.rows.push(row);
      lastWasOutput = false;
    } else if (row.instr === "OUT" || row.instr === "SET" || row.instr === "RST") {
      if (!cur) continue;
      cur.outputs.push({ step: row.step, instr: row.instr, device: row.device, setValue: row.setValue, comment: row.comment });
      cur.rows.push(row);
      lastWasOutput = true;
    }
  }
  return rungs;
}

// ---------- 평가 ----------

export type Values = Record<string, number>;

export function kToNumber(v: string): number {
  const m = v.match(/^K(-?\d+(?:\.\d+)?)$/i);
  if (m) return Number(m[1]);
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export class Evaluator {
  private memo = new Map<string, number>();
  private visiting = new Set<string>();
  constructor(
    private prog: ParsedProgram,
    private rungs: Rung[],
    private values: Values,
  ) {}

  /** 디바이스의 현재 값: 시나리오 값 → 다른 회로의 출력 → 평상값 → 0 */
  value(device: string): number {
    if (device in this.values) return this.values[device];
    if (this.memo.has(device)) return this.memo.get(device)!;
    const rung = this.rungs.find((r) => r.outputs.some((o) => o.device === device && o.instr !== "RST"));
    if (rung && !this.visiting.has(device)) {
      this.visiting.add(device);
      const v = this.rungTruth(rung, device) ? 1 : 0;
      this.visiting.delete(device);
      this.memo.set(device, v);
      return v;
    }
    const info = this.prog.devices.get(device);
    return info?.normal ?? 0;
  }

  contactTrue(c: Contact): boolean {
    if (c.compare) {
      const a = this.value(c.device);
      const b = kToNumber(c.compare.value);
      switch (c.compare.op) {
        case ">=":
          return a >= b;
        case "<=":
          return a <= b;
        case ">":
          return a > b;
        case "<":
          return a < b;
        case "=":
          return a === b;
        case "<>":
          return a !== b;
      }
      return false;
    }
    const v = this.value(c.device) !== 0;
    return c.negated ? !v : v;
  }

  /** 회로 조건이 참인지 (자기유지 접점은 '현재 출력 값'으로 평가) */
  rungTruth(r: Rung, selfDevice?: string): boolean {
    let acc = false;
    for (const c of r.contacts) {
      const t = selfDevice && c.device === selfDevice ? false : this.contactTrue(c);
      if (c.op === "LD") acc = t;
      else if (c.op === "AND") acc = acc && t;
      else acc = acc || t;
    }
    return acc;
  }
}

// ---------- 성립 분기 (병렬 회로 중 실제로 출력을 켠 접점) ----------

type Expr = { kind: "leaf"; i: number } | { kind: "and" | "or"; l: Expr; r: Expr };

/** IL의 왼쪽 결합 규칙(LD → AND/OR 순서대로 누적)을 식 트리로 만든다 */
function exprOf(r: Rung): Expr | null {
  let e: Expr | null = null;
  r.contacts.forEach((c, i) => {
    const leaf: Expr = { kind: "leaf", i };
    if (c.op === "LD" || !e) e = leaf;
    else e = { kind: c.op === "AND" ? "and" : "or", l: e, r: leaf };
  });
  return e;
}

function exprTruth(e: Expr, t: (i: number) => boolean): boolean {
  if (e.kind === "leaf") return t(e.i);
  return e.kind === "and" ? exprTruth(e.l, t) && exprTruth(e.r, t) : exprTruth(e.l, t) || exprTruth(e.r, t);
}

function exprContrib(e: Expr, t: (i: number) => boolean, out: Set<number>) {
  if (!exprTruth(e, t)) return;
  if (e.kind === "leaf") {
    out.add(e.i);
    return;
  }
  if (e.kind === "and") {
    exprContrib(e.l, t, out);
    exprContrib(e.r, t, out);
  } else {
    // OR: 성립한 분기만 원인 후보 (둘 다 성립하면 둘 다)
    if (exprTruth(e.l, t)) exprContrib(e.l, t, out);
    if (exprTruth(e.r, t)) exprContrib(e.r, t, out);
  }
}

/** 출력을 실제로 켠 분기에 속한 접점의 번호들 (자기유지 접점은 거짓으로 본다) */
export function contributingContacts(r: Rung, ev: Evaluator, selfDevice: string): Set<number> {
  const e = exprOf(r);
  const out = new Set<number>();
  if (!e) return out;
  const t = (i: number) => (r.contacts[i].device === selfDevice ? false : ev.contactTrue(r.contacts[i]));
  exprContrib(e, t, out);
  return out;
}

// ---------- 순차 동작(시퀀스) 단계 찾기 ----------
//
// 두 가지 흔한 방식만 읽는다.
//  (1) 단계 비트 SET/RST: LD 지금단계 AND 조건… SET 다음단계 RST 지금단계
//  (2) 자기유지 단계: LD 앞단계 AND 조건… OR 자기 ANI 다음단계 OUT 자기
// 단계 비트는 내부 릴레이(M·L·S)만 본다. 3단계 이상 이어진 것만 시퀀스로 본다.

export interface StepEdge {
  from: string;
  to: string;
  rung: Rung;
  /** 단계·자기유지·다음 단계 인터록을 뺀 '넘어가는 조건' */
  conditions: Contact[];
  /** 조건에 OR가 섞여 있으면 true (조건식을 그대로 보여 준다) */
  complex: boolean;
  style: "set-rst" | "self-hold";
}

const STEP_RE = /^(M|L|S)\d+$/;

export function findStepEdges(rungs: Rung[]): StepEdge[] {
  const edges: StepEdge[] = [];
  for (const r of rungs) {
    const first = r.contacts[0];
    if (!first || first.op !== "LD" || first.negated || first.compare || !STEP_RE.test(first.device)) continue;
    const from = first.device;
    const sets = r.outputs.filter((o) => o.instr === "SET" && STEP_RE.test(o.device) && o.device !== from);
    if (sets.length === 1 && r.outputs.some((o) => o.instr === "RST" && o.device === from)) {
      const conditions = r.contacts.slice(1);
      edges.push({ from, to: sets[0].device, rung: r, conditions, complex: conditions.some((c) => c.op === "OR"), style: "set-rst" });
      continue;
    }
    const out = r.outputs.find((o) => o.instr === "OUT" && STEP_RE.test(o.device) && o.device !== from);
    if (out && r.contacts.some((c) => c.op === "OR" && c.device === out.device && !c.negated)) {
      const conditions = r.contacts.slice(1).filter((c) => c.device !== out.device);
      edges.push({ from, to: out.device, rung: r, conditions, complex: false, style: "self-hold" });
    }
  }
  // 자기유지 방식은 앞 단계도 자기유지 회로로 켜지는 단계일 때만 인정, 다음 단계 인터록(ANI 다음단계)은 조건에서 뺀다
  const selfHeld = new Set(
    rungs.flatMap((r) => r.outputs.filter((o) => o.instr === "OUT" && r.contacts.some((c) => c.op === "OR" && c.device === o.device)).map((o) => o.device)),
  );
  const kept = edges.filter((e) => e.style === "set-rst" || selfHeld.has(e.from));
  const stepSet = new Set(kept.flatMap((e) => [e.from, e.to]));
  for (const e of kept) if (e.style === "self-hold") e.conditions = e.conditions.filter((c) => !(c.negated && stepSet.has(c.device)));
  // 3단계 이상으로 이어진 묶음만
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let r = x;
    while (parent.has(r) && parent.get(r) !== r) r = parent.get(r)!;
    parent.set(x, r);
    return r;
  };
  for (const d of stepSet) if (!parent.has(d)) parent.set(d, d);
  for (const e of kept) {
    const a = find(e.from);
    const b = find(e.to);
    if (a !== b) parent.set(a, b);
  }
  const size = new Map<string, number>();
  for (const d of stepSet) size.set(find(d), (size.get(find(d)) ?? 0) + 1);
  const big = new Set(Array.from(stepSet).filter((d) => (size.get(find(d)) ?? 0) >= 3));
  return kept.filter((e) => big.has(e.from) && big.has(e.to));
}

/** 시퀀스 단계 비트와, 단계 비트만으로 켜지는 출력(예: 1사이클 완료) — 역추적이 멈출 곳 */
export function sequenceDevices(rungs: Rung[], edges = findStepEdges(rungs)): Set<string> {
  const steps = new Set(edges.flatMap((e) => [e.from, e.to]));
  const out = new Set(steps);
  const edgeRungs = new Set(edges.map((e) => e.rung.index));
  for (const r of rungs) {
    if (edgeRungs.has(r.index) || !r.contacts.length) continue;
    if (r.contacts.every((c) => !c.negated && !c.compare && c.op !== "AND" && steps.has(c.device)))
      for (const o of r.outputs) if (o.instr !== "RST") out.add(o.device);
  }
  return out;
}

/** 단계 디바이스 → 그 시퀀스의 대표(첫 단계) */
export function sequenceRoots(edges: StepEdge[]): Map<string, string> {
  const adj = new Map<string, string[]>();
  for (const e of edges) {
    adj.set(e.from, [...(adj.get(e.from) ?? []), e.to]);
    adj.set(e.to, [...(adj.get(e.to) ?? []), e.from]);
  }
  const indeg = new Map<string, number>();
  for (const e of edges) indeg.set(e.to, (indeg.get(e.to) ?? 0) + 1);
  const root = new Map<string, string>();
  const seen = new Set<string>();
  const addr = (d: string) => Number(d.replace(/^\D+/, ""));
  for (const start of adj.keys()) {
    if (seen.has(start)) continue;
    const comp: string[] = [];
    const stack = [start];
    while (stack.length) {
      const d = stack.pop()!;
      if (seen.has(d)) continue;
      seen.add(d);
      comp.push(d);
      for (const n of adj.get(d) ?? []) if (!seen.has(n)) stack.push(n);
    }
    const noIn = comp.filter((d) => !indeg.get(d)).sort((a, b) => addr(a) - addr(b));
    const head = noIn[0] ?? comp.slice().sort((a, b) => addr(a) - addr(b))[0];
    for (const d of comp) root.set(d, head);
  }
  return root;
}

// ---------- 역추적 ----------

export type NodeRole = "condition" | "selfhold" | "reset" | "state";

export interface TraceNode {
  device: string;
  comment: string;
  step: number;
  instr: string; // 접점 명령 (LD, ANI, LD>= ...)
  negated: boolean;
  compare: Contact["compare"];
  role: NodeRole;
  value: number;
  satisfied: boolean; // 이 접점 자체가 성립했는가
  contributing: boolean; // 알람을 실제로 켠 분기 안에 있는가 (병렬 분기 중 불성립 분기는 false)
  abnormal: boolean; // 평상값과 다른가
  sourceKind: SourceKind | null; // 끝점일 때만
  checkWith: string;
  timer: { device: string; setValue: string } | null; // 이 노드가 타이머이면 설정값
  culprit: boolean; // 알람 성립 원인 접점
  children: TraceNode[];
  rungOutputStep: number | null;
  /** 이 노드가 순차 동작(시퀀스)의 단계 비트이거나 단계에서 나온 출력이면, 그 시퀀스의 첫 단계 디바이스 — 역추적은 여기서 멈추고 시퀀스 흐름도로 넘긴다 */
  sequence?: string | null;
}

export interface TraceResult {
  alarm: AlarmDef;
  rungSteps: number[];
  root: TraceNode; // 알람 디바이스 자신
  leaves: TraceNode[]; // 끝점(원천) 목록 (조건 역할만)
  culprits: TraceNode[];
  primarySource: SourceKind | null;
  timersInPath: { device: string; setValue: string; comment: string; step: number }[];
}

export function traceAlarm(prog: ParsedProgram, alarmCode: string, values: Values = {}): TraceResult | null {
  const alarm = prog.alarms.find((a) => a.code === alarmCode);
  if (!alarm) return null;
  const rungs = buildRungs(prog.rows);
  const ev = new Evaluator(prog, rungs, values);
  const rungSteps: number[] = [];
  const timersInPath: TraceResult["timersInPath"] = [];
  const edges = findStepEdges(rungs);
  const seqStop = sequenceDevices(rungs, edges);
  const seqRoot = sequenceRoots(edges);
  const seqOf = (d: string): string | null => {
    if (!seqStop.has(d)) return null;
    if (seqRoot.has(d)) return seqRoot.get(d)!;
    // 단계에서 나온 출력: 그 출력을 켜는 단계의 시퀀스
    const r = rungs.find((x) => x.outputs.some((o) => o.device === d && o.instr !== "RST"));
    const st = r?.contacts.find((c) => seqRoot.has(c.device));
    return st ? seqRoot.get(st.device)! : null;
  };

  const build = (device: string, contact: Contact | null, depth: number, path: Set<string>, onPath: boolean): TraceNode => {
    const info = prog.devices.get(device);
    const rung = rungs.find((r) => r.outputs.some((o) => o.device === device && o.instr !== "RST"));
    const outputDef = rung?.outputs.find((o) => o.device === device);
    const isTimer = /^T\d+/.test(device) && outputDef ? { device, setValue: outputDef.setValue } : null;
    const value = ev.value(device);
    const satisfied = contact ? ev.contactTrue(contact) : value !== 0;
    // 비교 접점(아날로그 값)은 '비교 조건이 성립했는가'가 곧 이상 여부
    const abnormal = contact?.compare ? satisfied : info?.normal !== null && info?.normal !== undefined ? value !== info.normal : false;
    const node: TraceNode = {
      device,
      comment: info?.comment || outputDef?.comment || contact?.comment || "",
      step: contact?.step ?? outputDef?.step ?? 0,
      instr: contact ? contactInstr(contact) : (outputDef?.instr ?? "OUT"),
      negated: contact?.negated ?? false,
      compare: contact?.compare ?? null,
      role: "condition",
      value,
      satisfied,
      contributing: onPath && (contact ? satisfied : value !== 0),
      abnormal,
      sourceKind: null,
      checkWith: info?.checkWith ?? "",
      timer: isTimer,
      culprit: false,
      children: [],
      rungOutputStep: outputDef?.step ?? null,
      sequence: depth > 0 ? seqOf(device) : null,
    };
    if (isTimer) timersInPath.push({ device, setValue: outputDef!.setValue, comment: node.comment, step: outputDef!.step });
    if (rung && depth < 8 && !path.has(device) && !node.sequence) {
      rungSteps.push(...rung.rows.map((r) => r.step));
      const nextPath = new Set(path).add(device);
      const contrib = node.contributing ? contributingContacts(rung, ev, device) : new Set<number>();
      rung.contacts.forEach((c, ci) => {
        const cInfo = prog.devices.get(c.device);
        let role: NodeRole = "condition";
        if (c.device === device) role = "selfhold";
        else if (cInfo?.role === "reset") role = "reset";
        else if (cInfo?.role === "state") role = "state";
        if (role !== "condition") {
          node.children.push({
            device: c.device,
            comment: cInfo?.comment || c.comment,
            step: c.step,
            instr: contactInstr(c),
            negated: c.negated,
            compare: c.compare,
            role,
            value: ev.value(c.device),
            satisfied: role === "selfhold" ? false : ev.contactTrue(c),
            contributing: contrib.has(ci),
            abnormal: false,
            sourceKind: null,
            checkWith: "",
            timer: null,
            culprit: false,
            children: [],
            rungOutputStep: null,
          });
          return;
        }
        node.children.push(build(c.device, c, depth + 1, nextPath, contrib.has(ci)));
      });
    } else {
      node.sourceKind = info?.sourceKind ?? normalizeSourceKind("", device);
    }
    return node;
  };

  const root = build(alarm.device, null, 0, new Set(), true);
  const leaves: TraceNode[] = [];
  const walk = (n: TraceNode) => {
    if (n.role !== "condition") return;
    if (n.children.length === 0 && n !== root) leaves.push(n);
    n.children.forEach(walk);
  };
  walk(root);

  // 알람 성립 원인 접점: 알람을 실제로 켠 분기 안에서 성립했고, 평상값과 다른 끝점
  let culprits = leaves.filter((l) => l.contributing && l.abnormal);
  if (culprits.length === 0) culprits = leaves.filter((l) => l.contributing && l.sourceKind !== "래더 로직");
  culprits.forEach((c) => (c.culprit = true));
  const primarySource = culprits[0]?.sourceKind ?? leaves[0]?.sourceKind ?? null;
  return {
    alarm,
    rungSteps: Array.from(new Set(rungSteps)).sort((a, b) => a - b),
    root,
    leaves,
    culprits,
    primarySource,
    timersInPath,
  };
}

function contactInstr(c: Contact): string {
  if (c.compare) return `${c.op}${c.compare.op}`;
  if (c.op === "LD") return c.negated ? "LDI" : "LD";
  if (c.op === "AND") return c.negated ? "ANI" : "AND";
  return c.negated ? "ORI" : "OR";
}

// ---------- 래더 변경안 ----------

export interface DiffLine {
  mark: " " | "+" | "-";
  text: string;
}

export interface LadderChange {
  kind: "timer" | "debounce";
  title: string;
  before: string[];
  after: string[];
  diff: DiffLine[];
  newDevice?: string;
}

export function formatRow(r: { instr: string; device: string; setValue: string; comment: string }): string {
  const parts = [r.instr.padEnd(5), r.device.padEnd(6), (r.setValue || "").padEnd(5)].join(" ").trimEnd();
  return r.comment ? `${parts.padEnd(20)} // ${r.comment}` : parts;
}

/** 타이머 설정값 변경안 (예: OUT T60 K30 → OUT T60 K45) */
export function timerChange(prog: ParsedProgram, timer: string, newK: number): LadderChange | null {
  const rungs = buildRungs(prog.rows);
  const rung = rungs.find((r) => r.outputs.some((o) => o.device === timer));
  if (!rung) return null;
  const before = rung.rows.map(formatRow);
  const afterRows = rung.rows.map((r) => (r.device === timer && r.instr === "OUT" ? { ...r, setValue: `K${newK}` } : r));
  const after = afterRows.map(formatRow);
  const old = rung.outputs.find((o) => o.device === timer)?.setValue ?? "";
  return {
    kind: "timer",
    title: `${timer} 설정값 ${old} → K${newK} (${(kToNumber(old) / 10).toFixed(1)}초 → ${(newK / 10).toFixed(1)}초)`,
    before,
    after,
    diff: lineDiff(before, after),
  };
}

/** 디바운스 변경안: 알람 조건이 K x 100ms 이상 '지속'될 때만 알람을 켜도록 타이머를 끼워 넣는다 */
export function debounceChange(prog: ParsedProgram, alarmDevice: string, k: number): LadderChange | null {
  const rungs = buildRungs(prog.rows);
  const rung = rungs.find((r) => r.outputs.some((o) => o.device === alarmDevice));
  if (!rung) return null;
  const resetDevices = new Set(
    Array.from(prog.devices.values())
      .filter((d) => d.role === "reset")
      .map((d) => d.device),
  );
  // 조건부(트리거) = 자기유지·리셋 접점이 나오기 전까지
  const cut = rung.contacts.findIndex((c) => c.device === alarmDevice || resetDevices.has(c.device));
  const trigger = cut === -1 ? rung.contacts : rung.contacts.slice(0, cut);
  const triggerSteps = new Set(trigger.map((c) => c.step));
  const newTimer = nextFreeTimer(prog);
  const triggerRows = rung.rows.filter((r) => triggerSteps.has(r.step));
  const restRows = rung.rows.filter((r) => !triggerSteps.has(r.step));
  const sec = (k / 10).toFixed(1);
  const afterRows = [
    ...triggerRows,
    { step: 0, instr: "OUT", device: newTimer, setValue: `K${k}`, comment: `알람 조건 ${sec}초 지속 판정 (추가)` },
    { step: 0, instr: "LD", device: newTimer, setValue: "", comment: "" },
    ...restRows,
  ];
  const before = rung.rows.map(formatRow);
  const after = afterRows.map(formatRow);
  return {
    kind: "debounce",
    title: `${newTimer}(${sec}초) 지속 판정 추가 — 순간 신호로는 알람이 켜지지 않게`,
    before,
    after,
    diff: lineDiff(before, after),
    newDevice: newTimer,
  };
}

export function nextFreeTimer(prog: ParsedProgram): string {
  const nums = prog.rows
    .map((r) => r.device)
    .filter((d) => /^T\d+$/.test(d))
    .map((d) => Number(d.slice(1)));
  const max = nums.length ? Math.max(...nums) : 0;
  return `T${max + 1}`;
}

/** 아주 단순한 LCS 기반 줄 비교 */
export function lineDiff(a: string[], b: string[]): DiffLine[] {
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ mark: " ", text: a[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) out.push({ mark: "-", text: a[i++] });
    else out.push({ mark: "+", text: b[j++] });
  }
  while (i < n) out.push({ mark: "-", text: a[i++] });
  while (j < m) out.push({ mark: "+", text: b[j++] });
  return out;
}

// ---------- 디바이스 사용처(교차 참조) ----------

export interface UsageRef {
  step: number;
  instr: string;
  kind: "출력" | "접점";
  rungIndex: number;
  outputDevices: string[]; // 이 접점이 영향을 주는 회로의 출력
  comment: string;
}

/** 디바이스가 래더 어디에서 쓰이는지 (변경 영향 분석에 사용) */
export function whereUsed(prog: ParsedProgram, device: string): UsageRef[] {
  const rungs = buildRungs(prog.rows);
  const out: UsageRef[] = [];
  for (const r of rungs) {
    const outs = r.outputs.map((o) => o.device);
    for (const c of r.contacts)
      if (c.device === device) out.push({ step: c.step, instr: contactInstr(c), kind: "접점", rungIndex: r.index, outputDevices: outs, comment: c.comment });
    for (const o of r.outputs)
      if (o.device === device) out.push({ step: o.step, instr: o.instr, kind: "출력", rungIndex: r.index, outputDevices: outs, comment: o.comment });
  }
  return out.sort((a, b) => a.step - b.step);
}

// ---------- 알람 없는 정지 진단 (Why-not) ----------

export interface BlockingCondition {
  device: string;
  comment: string;
  step: number;
  instr: string;
  want: "ON" | "OFF" | string; // 회로가 켜지려면 필요한 상태
  now: number;
  sourceKind: SourceKind;
  checkWith: string;
  alternative: boolean; // OR 병렬 조건(여럿 중 하나만 맞으면 됨)
  children: BlockingCondition[]; // 이 조건이 다른 회로의 출력이면, 그 회로에서 막힌 조건
}

export interface WhyNotResult {
  target: string;
  targetComment: string;
  on: boolean;
  totalConditions: number;
  blocking: BlockingCondition[];
  conditions: { device: string; comment: string; instr: string; step: number; ok: boolean; now: number; want: string; sourceKind: SourceKind }[];
  rungSteps: number[];
}

/** 출력(예: M0 자동운전 조건)이 왜 꺼져 있는지, 막고 있는 접점을 찾는다 */
export function whyNot(prog: ParsedProgram, target: string, values: Values = {}): WhyNotResult | null {
  const rungs = buildRungs(prog.rows);
  const rung = rungs.find((r) => r.outputs.some((o) => o.device === target && o.instr !== "RST"));
  if (!rung) return null;
  const ev = new Evaluator(prog, rungs, values);
  const on = ev.value(target) !== 0;

  const blockersOf = (r: Rung, self: string, depth: number, seen: Set<string>): BlockingCondition[] => {
    const res: BlockingCondition[] = [];
    // OR 다음에 오는 접점은 앞 조건과 병렬
    const hasOr = r.contacts.map((c, i) => c.op === "OR" || r.contacts[i + 1]?.op === "OR");
    r.contacts.forEach((c, i) => {
      if (c.device === self) return; // 자기유지
      const info = prog.devices.get(c.device);
      if (info?.role === "reset") return;
      if (ev.contactTrue(c)) return;
      const want = c.compare ? `${c.compare.op} ${c.compare.value}` : c.negated ? "OFF" : "ON";
      const sub = rungs.find((x) => x.outputs.some((o) => o.device === c.device && o.instr !== "RST"));
      const children =
        sub && !c.negated && !c.compare && depth < 4 && !seen.has(c.device) ? blockersOf(sub, c.device, depth + 1, new Set(seen).add(c.device)) : [];
      res.push({
        device: c.device,
        comment: info?.comment || c.comment,
        step: c.step,
        instr: contactInstr(c),
        want,
        now: ev.value(c.device),
        sourceKind: sub ? "래더 로직" : (info?.sourceKind ?? normalizeSourceKind("", c.device)),
        checkWith: info?.checkWith ?? "",
        alternative: hasOr[i],
        children,
      });
    });
    return res;
  };

  const blocking = on ? [] : blockersOf(rung, target, 0, new Set([target]));
  const info = prog.devices.get(target);
  const conditions = rung.contacts
    .filter((c) => c.device !== target && prog.devices.get(c.device)?.role !== "reset")
    .map((c) => {
      const ci = prog.devices.get(c.device);
      const sub = rungs.some((x) => x.outputs.some((o) => o.device === c.device && o.instr !== "RST"));
      return {
        device: c.device,
        comment: ci?.comment || c.comment,
        instr: contactInstr(c),
        step: c.step,
        ok: ev.contactTrue(c),
        now: ev.value(c.device),
        want: c.compare ? `${c.compare.op} ${c.compare.value}` : c.negated ? "OFF" : "ON",
        sourceKind: (sub ? "래더 로직" : (ci?.sourceKind ?? normalizeSourceKind("", c.device))) as SourceKind,
      };
    });
  return {
    target,
    targetComment: info?.comment || rung.outputs.find((o) => o.device === target)?.comment || "",
    on,
    totalConditions: rung.contacts.filter((c) => c.device !== target && prog.devices.get(c.device)?.role !== "reset").length,
    blocking,
    conditions,
    rungSteps: rung.rows.map((r) => r.step),
  };
}

/** 프로그램 리비전 표시용 짧은 지문(FNV-1a) — 어느 래더 버전으로 추적했는지 남기기 위함 (보안용 해시 아님) */
export function programRev(p: { ladderCsv: string; devicesCsv: string; alarmsCsv: string }): string {
  let h = 0x811c9dc5;
  const s = `${p.ladderCsv}\u0000${p.devicesCsv}\u0000${p.alarmsCsv}`;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0").slice(0, 6);
}
