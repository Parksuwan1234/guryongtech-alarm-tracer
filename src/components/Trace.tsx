"use client";

import Link from "next/link";
import type { TraceNode, WhyNotResult } from "@/lib/ladder";
import { SourceBadge } from "./ui";

function valueText(n: { device: string; value: number; compare: TraceNode["compare"] }): string {
  if (n.compare) return `${n.value}`;
  return n.value ? "ON" : "OFF";
}

function roleLabel(n: TraceNode): string | null {
  if (n.role === "selfhold") return "자기유지";
  if (n.role === "reset") return "해제 조건";
  if (n.role === "state") return "운전 상태";
  return null;
}

export function TraceTree({ node, depth = 0 }: { node: TraceNode; depth?: number }) {
  const role = roleLabel(node);
  const muted = node.role !== "condition";
  const isLeaf = node.children.length === 0 && node.role === "condition";
  return (
    <div className={depth ? "ml-5 border-l border-slate-700 pl-3" : ""}>
      <div
        className={`my-1 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md px-2 py-1.5 text-sm ${
          node.culprit ? "bg-fuchsia-500/15 ring-1 ring-fuchsia-400/80" : muted ? "opacity-60" : "bg-slate-800/50"
        }`}
      >
        {depth > 0 && <span className="mono text-[11px] text-slate-400">{node.instr}</span>}
        <span className={`mono font-semibold ${node.culprit ? "text-fuchsia-200" : "text-slate-100"}`}>{node.device}</span>
        {node.compare && (
          <span className="mono text-[11px] text-slate-400">
            {node.compare.op} {node.compare.value}
          </span>
        )}
        {node.timer && (
          <span className="mono rounded bg-teal-500/15 px-1 text-[11px] text-teal-300">
            타이머 {node.timer.setValue} = {(Number(node.timer.setValue.slice(1)) / 10).toFixed(1)}초
          </span>
        )}
        <span className="text-slate-300">{node.comment}</span>
        <span
          className={`mono rounded px-1.5 text-[11px] font-semibold ${
            node.compare
              ? node.satisfied
                ? "bg-red-500/20 text-red-300"
                : "bg-slate-700 text-slate-300"
              : node.value
                ? "bg-emerald-500/20 text-emerald-300"
                : "bg-slate-700 text-slate-300"
          }`}
          title="지금 값"
        >
          {valueText(node)}
        </span>
        {role && <span className="rounded border border-slate-600 px-1 text-[10px] text-slate-400">{role}</span>}
        {isLeaf && <SourceBadge kind={node.sourceKind} />}
        {node.culprit && <span className="rounded bg-fuchsia-600 px-1.5 text-[11px] font-bold text-white">◎ 알람 성립 원인</span>}
        {!muted && depth > 0 && !node.culprit && isLeaf && node.satisfied && !node.abnormal && (
          <span className="text-[10px] text-slate-400">{node.sourceKind === "래더 로직" ? "성립 · 래더 내부 조건" : "성립(평상값)"}</span>
        )}
        {!muted && depth > 0 && !node.satisfied && <span className="text-[10px] text-slate-400">불성립</span>}
        {!muted && depth > 0 && node.satisfied && !node.contributing && (
          <span className="text-[10px] text-slate-400">성립했지만 알람 경로 밖(병렬 분기 불성립)</span>
        )}
        {node.step > 0 && <span className="ml-auto mono text-[10px] text-slate-400">스텝 {node.step}</span>}
      </div>
      {node.children.map((c, i) => (
        <TraceTree key={`${c.device}-${i}`} node={c} depth={depth + 1} />
      ))}
    </div>
  );
}

export function WhyNotView({ r, equipmentId }: { r: WhyNotResult; equipmentId?: string }) {
  const failed = r.conditions.filter((c) => !c.ok);
  return (
    <div>
      <div className="mb-2 text-sm">
        {r.on ? (
          <span className="text-emerald-300">자동운전 조건 {r.totalConditions}개가 모두 맞습니다.</span>
        ) : (
          <>
            <span className="font-semibold text-amber-200">
              자동운전 조건 {r.totalConditions}개 중 {failed.length}개 미충족
            </span>
            <span className="text-slate-400">
              {" "}
              — {r.target}({r.targetComment})가 꺼져 있어 설비가 돌지 않습니다.
            </span>
          </>
        )}
      </div>
      <ul className="space-y-1">
        {r.conditions.map((c) => (
          <li
            key={c.step}
            className={`flex flex-wrap items-center gap-2 rounded-md px-2 py-1.5 text-sm ${c.ok ? "bg-slate-800/40 text-slate-400" : "bg-amber-400/10 ring-1 ring-amber-400/60"}`}
          >
            <span className={`w-4 text-center font-bold ${c.ok ? "text-emerald-400" : "text-amber-300"}`}>{c.ok ? "✓" : "✗"}</span>
            <span className="mono text-[11px] text-slate-400">{c.instr}</span>
            <span className={`mono font-semibold ${c.ok ? "" : "text-amber-200"}`}>{c.device}</span>
            <span className={c.ok ? "" : "text-slate-100"}>{c.comment}</span>
            {!c.ok && (
              <span className="mono text-[11px] text-slate-300">
                필요 {c.want} · 지금 {c.now ? "ON" : "OFF"}
              </span>
            )}
            {!c.ok && <SourceBadge kind={c.sourceKind} />}
            {!c.ok && c.device === "M1" && equipmentId && (
              <Link href={`/equipment/${equipmentId}`} className="text-xs text-sky-300 underline">
                중알람 확인
              </Link>
            )}
            <span className="ml-auto mono text-[10px] text-slate-400">스텝 {c.step}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
