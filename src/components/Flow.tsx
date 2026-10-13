"use client";

import { Fragment } from "react";
import type { TraceNode, TraceResult } from "@/lib/ladder";
import type { SeqCondition, SeqPosition, Sequence } from "@/lib/sequence";
import { josa } from "@/lib/ko";
import { SourceBadge } from "./ui";

// ───────────────────────── 알람 흐름도 ─────────────────────────
// 원천 신호(왼쪽) → 회로 조건(그리고/또는) → 타이머·내부 조건 → 알람(오른쪽)
// 자기유지·해제 조건·운전 상태 접점은 원인이 아니므로 그림에서 빼고 아래에 한 줄로 적는다.

const BOX_W = 232;
const BOX_H = 70;
const COL_GAP = 96;
const ROW_GAP = 18;
const PAD = 12;

interface Placed {
  node: TraceNode;
  x: number;
  y: number;
  depth: number;
}

function conditionChildren(n: TraceNode) {
  return n.children.filter((c) => c.role === "condition");
}

function gateOf(n: TraceNode): { label: string; title: string } | null {
  const kids = conditionChildren(n);
  if (kids.length < 2) return null;
  const hasOr = kids.slice(1).some((c) => c.instr.startsWith("OR"));
  const hasAnd = kids.slice(1).some((c) => c.instr.startsWith("AN"));
  if (hasOr && !hasAnd) return { label: "또는", title: "하나라도 성립하면 (OR)" };
  if (hasAnd && !hasOr) return { label: "그리고", title: "모두 성립해야 (AND)" };
  return { label: "조건식", title: "그리고·또는이 섞인 조건식 — 목록 보기에서 순서 확인" };
}

function cut(s: string, n: number) {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

function valueLabel(n: TraceNode): string {
  if (n.compare) return `${n.value} (${n.compare.op} ${n.compare.value.replace(/^K/, "")})`;
  return n.value ? "ON" : "OFF";
}

function conditionHint(n: TraceNode): string {
  if (n.timer) return `타이머 ${(Number(n.timer.setValue.slice(1)) / 10).toFixed(1)}초`;
  if (n.compare) return `${n.compare.op} ${n.compare.value.replace(/^K/, "")}이면 성립`;
  if (n.negated) return "OFF일 때 성립";
  return "ON일 때 성립";
}

export function AlarmFlow({ trace, onSequence }: { trace: TraceResult; onSequence?: (id: string) => void }) {
  // 배치: 뿌리(알람)를 오른쪽 끝, 깊을수록 왼쪽. 끝점부터 위에서 아래로 쌓고 부모는 자식들의 가운데.
  const placed: Placed[] = [];
  let maxDepth = 0;
  const measure = (n: TraceNode, d: number) => {
    maxDepth = Math.max(maxDepth, d);
    conditionChildren(n).forEach((c) => measure(c, d + 1));
  };
  measure(trace.root, 0);
  let cursor = PAD;
  const place = (n: TraceNode, d: number): number => {
    const kids = conditionChildren(n);
    let y: number;
    if (!kids.length) {
      y = cursor;
      cursor += BOX_H + ROW_GAP;
    } else {
      const ys = kids.map((c) => place(c, d + 1));
      y = (ys[0] + ys[ys.length - 1]) / 2;
    }
    placed.push({ node: n, x: PAD + (maxDepth - d) * (BOX_W + COL_GAP), y, depth: d });
    return y;
  };
  place(trace.root, 0);
  const width = PAD * 2 + (maxDepth + 1) * BOX_W + maxDepth * COL_GAP;
  const height = Math.max(cursor - ROW_GAP + PAD, BOX_H + PAD * 2);
  const at = new Map(placed.map((p) => [p.node, p]));

  const edges: { from: Placed; to: Placed; on: boolean; gate: { x: number; y: number } | null }[] = [];
  const gates: { x: number; y: number; label: string; title: string; on: boolean }[] = [];
  for (const p of placed) {
    const kids = conditionChildren(p.node);
    if (!kids.length) continue;
    const g = gateOf(p.node);
    const gx = p.x - COL_GAP / 2;
    const gy = p.y + BOX_H / 2;
    if (g) gates.push({ x: gx, y: gy, label: g.label, title: g.title, on: p.node.contributing });
    for (const k of kids) edges.push({ from: at.get(k)!, to: p, on: k.contributing, gate: g ? { x: gx, y: gy } : null });
  }

  const others = new Map<string, TraceNode>();
  const collect = (n: TraceNode) => {
    for (const c of n.children) {
      if (c.role !== "condition" && c.role !== "selfhold") others.set(`${c.device}:${c.role}`, c);
      else if (c.role === "condition") collect(c);
    }
  };
  collect(trace.root);

  return (
    <div>
      <div className="overflow-x-auto">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          width="100%"
          style={{ maxWidth: width }}
          className="h-auto"
          role="img"
          aria-label={`${trace.alarm.code} 알람이 켜지는 흐름도`}
        >
          {edges.map((e, i) => {
            const x1 = e.from.x + BOX_W;
            const y1 = e.from.y + BOX_H / 2;
            const x2 = e.to.x;
            const y2 = e.to.y + BOX_H / 2;
            const mx = e.gate ? e.gate.x : (x1 + x2) / 2;
            const my = e.gate ? e.gate.y : y2;
            const d = e.gate
              ? `M${x1},${y1} C${x1 + 30},${y1} ${mx - 30},${my} ${mx - 14},${my}`
              : `M${x1},${y1} C${(x1 + x2) / 2},${y1} ${(x1 + x2) / 2},${y2} ${x2},${y2}`;
            return (
              <path
                key={i}
                d={d}
                fill="none"
                strokeWidth={e.on ? 2 : 1.4}
                strokeDasharray={e.on ? undefined : "5 4"}
                className={e.on ? "stroke-sky-400" : "stroke-slate-600"}
              />
            );
          })}
          {gates.map((g, i) => (
            <g key={i}>
              <title>{g.title}</title>
              <path d={`M${g.x + 14},${g.y} L${g.x + COL_GAP / 2},${g.y}`} strokeWidth={g.on ? 2 : 1.4} className={g.on ? "stroke-sky-400" : "stroke-slate-600"} />
              <rect
                x={g.x - 26}
                y={g.y - 12}
                width={52}
                height={24}
                rx={12}
                className={g.on ? "fill-sky-950 stroke-sky-400" : "fill-slate-900 stroke-slate-600"}
              />
              <text x={g.x} y={g.y + 4} textAnchor="middle" className={`text-[11px] font-semibold ${g.on ? "fill-sky-200" : "fill-slate-400"}`}>
                {g.label}
              </text>
            </g>
          ))}
          {placed.map((p, i) => {
            const n = p.node;
            const isRoot = p.depth === 0;
            const tone = isRoot
              ? "fill-red-950/60 stroke-red-500"
              : n.culprit
                ? "fill-fuchsia-950/70 stroke-fuchsia-400"
                : n.sequence
                  ? "fill-teal-950/60 stroke-teal-400"
                  : n.contributing
                    ? "fill-slate-900 stroke-sky-500"
                    : "fill-slate-900 stroke-slate-700";
            const valueOn = n.compare ? n.satisfied : n.value !== 0;
            return (
              <g
                key={i}
                className={n.sequence && onSequence ? "cursor-pointer" : undefined}
                onClick={n.sequence && onSequence ? () => onSequence(n.sequence!) : undefined}
              >
                <title>{`${n.device} ${n.comment}`}</title>
                <rect x={p.x} y={p.y} width={BOX_W} height={BOX_H} rx={8} strokeWidth={n.culprit || isRoot ? 2 : 1.2} className={tone} />
                <text x={p.x + 10} y={p.y + 20} className="mono fill-slate-100 text-[13px] font-semibold">
                  {n.device}
                </text>
                <text
                  x={p.x + BOX_W - 10}
                  y={p.y + 20}
                  textAnchor="end"
                  className={`mono text-[12px] font-semibold ${isRoot ? (n.value ? "fill-red-300" : "fill-slate-400") : valueOn ? "fill-emerald-300" : "fill-slate-400"}`}
                >
                  {isRoot ? (n.value ? "알람 ON" : "OFF") : valueLabel(n)}
                </text>
                <text x={p.x + 10} y={p.y + 40} className="fill-slate-200 text-[12px]">
                  {cut(isRoot ? `${trace.alarm.code} ${trace.alarm.name}` : n.comment, 17)}
                </text>
                <text
                  x={p.x + 10}
                  y={p.y + 58}
                  className={`text-[11px] ${n.culprit ? "fill-fuchsia-200 font-semibold" : n.sequence ? "fill-teal-200" : "fill-slate-400"}`}
                >
                  {isRoot
                    ? `알람 코일 · 스텝 ${n.step}`
                    : n.culprit
                      ? "◎ 알람 성립 원인"
                      : n.sequence
                        ? "순차 동작에서 나온 신호 → 아래 흐름도"
                        : `${conditionHint(n)}${n.step ? ` · 스텝 ${n.step}` : ""}`}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-400">
        <span>
          <span className="mr-1 inline-block h-0.5 w-5 bg-sky-400 align-middle" />
          알람을 실제로 켠 길
        </span>
        <span>
          <span className="mr-1 inline-block w-5 border-t border-dashed border-slate-500 align-middle" />
          성립하지 않은 갈래
        </span>
        <span>왼쪽 신호에서 오른쪽 알람 쪽으로 읽습니다</span>
        {others.size > 0 && (
          <span>
            그림에서 뺀 조건(원인 아님):{" "}
            {Array.from(others.values())
              .map((o) => `${o.device} ${o.comment}${o.role === "reset" ? "(해제)" : o.role === "state" ? "(운전 상태)" : ""}`)
              .join(" · ")}
          </span>
        )}
      </div>
    </div>
  );
}

// ───────────────────────── 시퀀스 흐름도 ─────────────────────────

function condText(c: SeqCondition) {
  if (c.compare) return `${c.compare.op} ${c.compare.value.replace(/^K/, "")}`;
  return c.negated ? "OFF일 때" : "ON일 때";
}

export function SequenceFlow({ seq, position, compact = false }: { seq: Sequence; position?: SeqPosition | null; compact?: boolean }) {
  const activeSet = new Set(position?.active.map((a) => a.step.device) ?? []);
  const nextOf = (from: string) => position?.active.find((a) => a.step.device === from)?.next ?? [];
  const steps = seq.steps;

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,860px)_minmax(0,320px)]">
      <ol className="space-y-0">
        {steps.map((s, i) => {
          const active = activeSet.has(s.device);
          const outs = seq.transitions.filter((t) => t.from === s.device);
          const toNext = outs.find((t) => t.to === steps[i + 1]?.device);
          const jumps = outs.filter((t) => t !== toNext);
          const live = nextOf(s.device);
          const liveNext = toNext ? live.find((l) => l.transition === toNext) : undefined;
          return (
            <Fragment key={s.device}>
              <li
                className={`relative rounded-lg border px-3 py-2 ${
                  active ? "border-sky-400 bg-sky-500/10 ring-1 ring-sky-400/60" : "border-slate-700 bg-slate-900/70"
                }`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-bold ${active ? "bg-sky-700 text-white" : "bg-slate-800 text-slate-300"}`}
                  >
                    {i + 1}
                  </span>
                  <span className="font-semibold text-slate-100">{s.label}</span>
                  <span className="mono text-[11px] text-slate-400">{s.device}</span>
                  {active && <span className="ml-auto rounded bg-sky-700 px-1.5 py-0.5 text-[11px] font-semibold text-white">알람 순간 이 단계</span>}
                </div>
                {!compact && s.actions.length > 0 && (
                  <div className="mt-1 flex flex-wrap items-center gap-1 pl-8 text-[11px]">
                    <span className="text-slate-400">하는 일</span>
                    {s.actions.map((a) => (
                      <span key={a.device} className="rounded border border-slate-700 bg-slate-800/60 px-1.5 py-0.5 text-slate-200">
                        <span className="mono">{a.device}</span> {a.comment}
                      </span>
                    ))}
                  </div>
                )}
                {jumps.map((t) => {
                  const target = steps.find((x) => x.device === t.to);
                  return (
                    <div key={t.to} className="mt-1 pl-8 text-[11px] text-slate-400">
                      {t.loopBack ? "↩ " : "↪ "}
                      {josa(target ? `${steps.indexOf(target) + 1}. ${target.label}` : t.to, "으로")}
                      {t.loopBack ? " 돌아감" : " 갈래"}
                      {t.conditions.length ? ` — 조건 ${t.conditions.map((c) => `${c.device} ${c.comment}`).join(", ")}` : " — 조건 없이 바로"}
                    </div>
                  );
                })}
              </li>
              {toNext && (
                <li className="flex gap-3 py-1 pl-5" aria-label={`${i + 1}단계에서 ${i + 2}단계로 넘어가는 조건`}>
                  <div className={`w-0.5 shrink-0 ${liveNext && !liveNext.ready ? "bg-amber-400" : "bg-slate-600"}`} />
                  <div className="min-w-0 py-1 text-xs">
                    <div className="mb-1 text-[11px] text-slate-400">
                      ↓ 넘어가는 조건{toNext.complex ? " (그리고·또는 섞임 — 래더에서 순서 확인)" : toNext.conditions.length > 1 ? " (모두)" : ""}
                      <span className="mono ml-1">스텝 {toNext.ladderStep}</span>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {toNext.conditions.length === 0 && <span className="text-slate-400">조건 없이 바로</span>}
                      {toNext.conditions.map((c) => {
                        const lc = liveNext?.conditions.find((x) => x.device === c.device);
                        const blocked = lc && !lc.ok;
                        return (
                          <span
                            key={c.device}
                            className={`rounded border px-1.5 py-0.5 ${
                              blocked
                                ? "border-amber-400 bg-amber-400/10 text-amber-100"
                                : lc
                                  ? "border-emerald-600/60 text-emerald-200"
                                  : "border-slate-700 text-slate-200"
                            }`}
                            title={c.where ? `현장 위치: ${c.where}` : undefined}
                          >
                            <span className="mono font-semibold">{c.device}</span> {c.comment}
                            {(c.negated || c.compare) && <span className="text-slate-400"> {condText(c)}</span>}
                            {lc && <b className="ml-1">{blocked ? `지금 ${lc.value ? "ON" : "OFF"} — 기다리는 중` : "성립"}</b>}
                          </span>
                        );
                      })}
                    </div>
                    {liveNext && !liveNext.ready && (
                      <div className="mt-1 text-[11px] text-amber-200">
                        여기서 다음 단계로 못 넘어갔습니다
                        {liveNext.conditions
                          .filter((c) => !c.ok && c.where)
                          .map((c) => ` · ${c.device} 위치: ${c.where}`)
                          .join("")}
                      </div>
                    )}
                  </div>
                </li>
              )}
            </Fragment>
          );
        })}
      </ol>

      <div className="space-y-3 text-xs">
        <div className="rounded-lg border border-slate-700 bg-slate-900/70 p-3">
          <div className="mb-1 text-[11px] text-slate-400">시간 감시 · 이어진 알람</div>
          {seq.watches.length === 0 && <div className="text-slate-400">이 시퀀스를 지켜보는 타이머가 없습니다.</div>}
          {seq.watches.map((w) => (
            <div key={w.timer} className="mb-2 last:mb-0">
              <div>
                <span className="mono font-semibold text-slate-100">{w.timer}</span>{" "}
                <span className="text-slate-300">{w.comment}</span>
                {w.seconds != null && <span className="mono ml-1 rounded bg-teal-500/15 px-1 text-teal-300">{w.seconds.toFixed(1)}초</span>}
              </div>
              <div className="mt-0.5 text-slate-400">
                {w.watches.map((x) => (x.negated ? `${josa(`${x.device} ${x.comment}`, "이")} 켜지기 전까지` : `${x.device} ${x.comment} 동안`)).join(", ")} 시간을 잽니다
                {w.alarms.length > 0 && (
                  <>
                    {" → 넘으면 "}
                    {w.alarms.map((a) => (
                      <span key={a.code} className="text-red-300">
                        <span className="mono">{a.code}</span> {a.name}{" "}
                      </span>
                    ))}
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
        {seq.alarms.length > 0 && (
          <div className="rounded-lg border border-slate-700 bg-slate-900/70 p-3">
            <div className="mb-1 text-[11px] text-slate-400">이 순차 동작을 거쳐 켜지는 알람</div>
            <div className="flex flex-wrap gap-1">
              {seq.alarms.map((a) => (
                <span key={a.code} className="rounded border border-red-500/40 px-1.5 py-0.5 text-red-200">
                  <span className="mono">{a.code}</span> {a.name}
                </span>
              ))}
            </div>
          </div>
        )}
        <div className="rounded-lg border border-dashed border-slate-700 p-3 text-[11px] leading-relaxed text-slate-400">
          단계별 걸린 시간: 미수집 — 실제 도입 시 PLC 게이트웨이(읽기 전용)가 단계 비트가 바뀐 시각을 기록하면, 어느 단계가 느려졌는지 볼 수 있습니다.
          {position && !position.known && " 이 스냅샷에는 단계 비트 값이 없어 현재 단계를 표시하지 않았습니다."}
        </div>
        <div className="flex flex-wrap gap-1 text-[11px] text-slate-400">
          <SourceBadge kind="래더 로직" /> 단계 비트 {seq.style === "set-rst" ? "SET/RST" : "자기유지"} 방식으로 찾음
        </div>
      </div>
    </div>
  );
}
