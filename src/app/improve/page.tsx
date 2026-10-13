"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Btn, DiffView, Histogram, LevelBadge, ProtectBadge, Stat, copyText, inputCls } from "@/components/ui";
import { ExpertOnly, Term } from "@/components/Help";
import { EQUIPMENT_BY_ID, LINE_SPEED } from "@/data/equipment";
import { fmtDate, since, unitBreakdown } from "@/lib/analytics";
import { KIND_LABEL, type Proposal, type ProposalKind } from "@/lib/propose";
import { useData } from "@/lib/store";
import type { ProposalStatus } from "@/lib/types";

const GROUPS: { id: string; label: string; kinds: ProposalKind[] }[] = [
  { id: "all", label: "전체", kinds: ["debounce", "timer", "pm", "manual", "unit", "inspect", "external", "hold"] },
  { id: "ladder", label: "래더 수정", kinds: ["debounce", "timer"] },
  { id: "pm", label: "예방정비", kinds: ["pm"] },
  { id: "manual", label: "매뉴얼 보강", kinds: ["manual"] },
  { id: "check", label: "점검·협의", kinds: ["unit", "inspect", "external"] },
  { id: "hold", label: "판단 보류", kinds: ["hold"] },
];

const KIND_TONE: Record<ProposalKind, string> = {
  debounce: "bg-teal-500/15 text-teal-300 border-teal-500/40",
  timer: "bg-teal-500/15 text-teal-300 border-teal-500/40",
  pm: "bg-sky-500/15 text-sky-300 border-sky-500/40",
  manual: "bg-violet-500/15 text-violet-300 border-violet-500/40",
  unit: "bg-red-500/10 text-red-300 border-red-500/40",
  inspect: "bg-orange-500/10 text-orange-300 border-orange-500/40",
  external: "bg-violet-500/15 text-violet-300 border-violet-500/40",
  hold: "bg-slate-500/15 text-slate-300 border-slate-500/40",
};

const STATUS_TONE: Record<ProposalStatus, string> = {
  "검토 대기": "text-slate-300 border-slate-600",
  승인: "text-emerald-300 border-emerald-500/60 bg-emerald-500/10",
  보류: "text-amber-200 border-amber-400/60 bg-amber-400/10",
};

export default function ImprovePage() {
  const data = useData();
  const [group, setGroup] = useState("all");
  const [status, setStatus] = useState<"all" | ProposalStatus>("all");
  const [sel, setSel] = useState<string | null>(null);
  const detailRef = useRef<HTMLDivElement>(null);

  // 다른 화면에서 /improve#제안ID 로 들어오면 그 제안을 연다
  useEffect(() => {
    // 주소의 #뒷부분이 깨져 있어도 화면이 멈추지 않게 (못 읽으면 첫 제안)
    let h = "";
    try {
      h = decodeURIComponent(window.location.hash.slice(1));
    } catch {
      h = "";
    }
    if (h) setSel(h);
  }, []);

  const statusOf = (p: Proposal) => data.reviews.get(p.id)?.status ?? "검토 대기";
  const g = GROUPS.find((x) => x.id === group)!;
  const ORDER: ProposalKind[] = ["debounce", "timer", "inspect", "pm", "unit", "manual", "external", "hold"];
  const list = data.proposals
    .filter((p) => g.kinds.includes(p.kind) && (status === "all" || statusOf(p) === status))
    .sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind) || b.effect.perYearMin - a.effect.perYearMin);
  const current = list.find((p) => p.id === sel) ?? list[0] ?? null;
  const idx = current ? list.indexOf(current) : -1;
  const go = useCallback(
    (id: string) => {
      setSel(id);
      if (typeof window !== "undefined") window.history.replaceState(null, "", `#${id}`);
      const top = detailRef.current?.getBoundingClientRect().top ?? 0;
      if (top < 0) detailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    },
    [],
  );
  // ← → 키로 앞뒤 제안
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
      // 팝업이 떠 있거나 Alt·Ctrl·⌘ 조합(뒤로 가기 등)일 때는 넘기지 않음
      if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || document.querySelector('[aria-modal="true"]')) return;
      if (e.key === "ArrowRight" && idx >= 0 && idx < list.length - 1) go(list[idx + 1].id);
      if (e.key === "ArrowLeft" && idx > 0) go(list[idx - 1].id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [idx, list, go]);
  const total = data.proposals.reduce((s, p) => s + p.effect.perYearMin, 0);
  const avoided = data.proposals.filter((p) => p.kind === "debounce" || p.kind === "timer").reduce((s, p) => s + p.effect.avoided, 0);
  const approved = data.proposals.filter((p) => statusOf(p) === "승인").length;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">개선 제안 — 조치이력 DB가 알려 주는 &lsquo;재발을 막는 법&rsquo;</h1>
        <p className="mt-1 text-sm text-slate-400">
          최근 90일 조치이력을 코드로 분석해, 리셋만으로 풀리던 알람은 래더를 고치고, 반복 교체는 예방정비로, 현장 노하우는 매뉴얼로 옮기자고 제안합니다. 각
          제안에는 근거 수치와 &lsquo;과거에 적용했다면&rsquo; 다시 계산한 효과가 붙습니다.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
        <Stat label="제안" value={`${data.proposals.length}건`} />
        <Stat label="연간 정지 감소 (추정)" value={`${Math.round(total / 60)}시간`} tone="text-sky-300" sub="제안을 모두 적용했다고 가정 · 실증 전" />
        <Stat
          label="래더 검토안 가정 시 억제됐을 기록 (추정)"
          value={`${avoided}건 / 90일`}
          tone="text-teal-300"
          sub="조치이력 측정값으로 다시 계산 · 개선 실적 아님"
        />
        <Stat label="예방정비 전환" value={`${data.proposals.filter((p) => p.kind === "pm").length}건`} />
        <Stat label="승인" value={`${approved}건`} tone="text-emerald-300" />
      </div>

      <details className="rounded-lg border border-slate-800 bg-slate-900/40 p-3 text-sm text-slate-300">
        <summary className="cursor-pointer text-slate-200">제안 규칙 7가지 + 판단 보류 (모두 코드 계산 · 같은 데이터 = 같은 결과)</summary>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-slate-400">
          <li>
            경알람이 리셋만으로 60% 이상 해결되고 신호 지속이 짧으면 → 지속 판정 타이머를 끼운 래더안 (리셋 해결 건의 80%를 거르는 가장 짧은 시간, 1초 이하)
          </li>
          <li>리셋으로 풀려도 신호가 길면 → 래더로 숨기지 않고 하드웨어 점검 권고. 중알람은 지속 판정 대상에서 제외</li>
          <li>
            추적 경로에 타이머가 있고 응답이 기준보다 길되 1.5배 이내에서 풀린 건이 몰리면 → 경알람은 설정값 검토안(90% 값 + 여유, 상한 1.5배, 줄이는 제안
            없음), 중알람·안전·설비 보호는 기준 유지 + 응답 지연 원인 개선 권고
          </li>
          <li>알람 뒤 같은 부품 교체·청소·보충 간격이 일정하면(변동 35% 이하) → 평균 간격의 85% 주기 예방정비, 설비별 다음 권장일</li>
          <li>매뉴얼에 없는 조치로 3번 이상 해결되면 → 매뉴얼 보강 초안</li>
          <li>같은 프로그램 설비군 중 한 대에 알람이 몰리면 → 그 설비 고유 하드웨어 점검</li>
          <li>원천이 외부 신호이고 평균 대기가 15분 이상이면 → 담당 부서 협의 자료</li>
          <li className="list-none text-slate-300">+ 리셋 위주인데 측정값이 없으면 → 제안하지 않고 &lsquo;판단 보류&rsquo;, 필요한 자료만 표시</li>
        </ol>
        <p className="mt-2 text-xs text-slate-400">래더 변경안은 PLC 담당자 검토·승인 후 반영합니다. 이 도구는 PLC에 쓰지 않습니다.</p>
      </details>

      <div className="grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="space-y-2 xl:sticky xl:top-20 xl:self-start">
          <div className="flex flex-wrap items-center gap-1.5">
            {GROUPS.map((x) => (
              <button
                key={x.id}
                onClick={() => setGroup(x.id)}
                className={`rounded-full border px-2.5 py-0.5 text-xs ${group === x.id ? "border-sky-500 bg-sky-500/15 text-sky-200" : "border-slate-700 text-slate-400 hover:text-slate-200"}`}
              >
                {x.label} <span className="text-slate-400">{data.proposals.filter((p) => x.kinds.includes(p.kind)).length}</span>
              </button>
            ))}
          </div>
          <select className={`${inputCls} text-xs`} value={status} onChange={(e) => setStatus(e.target.value as typeof status)} aria-label="검토 상태로 거르기">
            <option value="all">검토 상태 전체</option>
            <option>검토 대기</option>
            <option>승인</option>
            <option>보류</option>
          </select>
          <ol className="max-h-[260px] space-y-1 overflow-y-auto pr-1 xl:max-h-[calc(100vh-15rem)]" aria-label="제안 목록">
            {list.map((p, i) => (
              <li key={p.id}>
                <button
                  onClick={() => go(p.id)}
                  aria-current={current?.id === p.id}
                  className={`w-full rounded-lg border px-2.5 py-2 text-left ${
                    current?.id === p.id ? "border-sky-500 bg-sky-500/10" : "border-slate-800 bg-slate-900/60 hover:border-slate-600"
                  }`}
                >
                  <div className="flex items-center gap-1.5">
                    <span className="mono w-5 shrink-0 text-[11px] text-slate-400">{i + 1}</span>
                    <span className={`rounded border px-1.5 text-[10px] font-semibold ${KIND_TONE[p.kind]}`}>{KIND_LABEL[p.kind]}</span>
                    <span className="mono text-xs text-slate-300">{p.alarmCode}</span>
                    <span className={`ml-auto rounded-full border px-1.5 text-[10px] ${STATUS_TONE[statusOf(p)]}`}>{statusOf(p)}</span>
                  </div>
                  <div className="mt-0.5 truncate pl-6 text-sm text-slate-100">{p.alarmName}</div>
                  <div className="truncate pl-6 text-[11px] text-slate-400">
                    {p.appliesTo.length}대 · {p.effect.perYearMin > 0 ? `연 ${Math.round(p.effect.perYearMin / 60)}시간 정지 감소(추정)` : "효과 계산 없음"}
                  </div>
                </button>
              </li>
            ))}
            {!list.length && <li className="text-sm text-slate-400">조건에 맞는 제안이 없습니다.</li>}
          </ol>
        </aside>

        <div ref={detailRef} className="scroll-mt-20 space-y-3">
          {current && (
            <>
              <Pager idx={idx} count={list.length} onPrev={() => go(list[idx - 1].id)} onNext={() => go(list[idx + 1].id)} />
              <ProposalCard key={current.id} p={current} focused={false} />
              <Pager idx={idx} count={list.length} onPrev={() => go(list[idx - 1].id)} onNext={() => go(list[idx + 1].id)} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Pager({ idx, count, onPrev, onNext }: { idx: number; count: number; onPrev: () => void; onNext: () => void }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <Btn tone="ghost" disabled={idx <= 0} onClick={onPrev}>
        ← 이전
      </Btn>
      <span className="mono text-slate-300">
        {idx + 1} / {count}
      </span>
      <Btn tone="ghost" disabled={idx >= count - 1} onClick={onNext}>
        다음 →
      </Btn>
      <span className="ml-auto hidden text-[11px] text-slate-400 sm:inline">키보드 ← → 로도 넘깁니다</span>
    </div>
  );
}

/** 호기별 분포 — 설비군 전체에 제안하더라도 실제로 한 호기에 몰렸는지, 호기마다 신호 길이가 다른지 */
function UnitSpread({ p }: { p: Proposal }) {
  const data = useData();
  const b = useMemo(() => {
    // 제안과 같은 기간(최근 90일)의 이 알람 기록 전부 — 근거 이력(억제됐을 기록)만이 아니라
    const logs = since(data.logs, 90);
    const unit = p.histogram?.unit === "s" || p.kind === "debounce" || p.kind === "timer" ? "s" : undefined;
    return unitBreakdown(logs, p.alarmCode, p.appliesTo, unit);
  }, [data.logs, p]);
  if (p.appliesTo.length < 2 || b.total === 0) return null;
  const max = Math.max(...b.rows.map((r) => r.count), 1);
  const top = b.rows[0];
  const medians = b.rows.filter((r) => r.median !== null).map((r) => r.median as number);
  const fmt = (v: number) => (v < 10 ? v.toFixed(2) : v.toFixed(0));
  const verdict =
    b.verdict === "single"
      ? `${top.unit}에 ${Math.round(b.topShare * 100)}%가 몰렸습니다 — 설비군 전체 변경보다 그 호기 점검이 먼저입니다.`
      : b.verdict === "common"
        ? `${b.rows.length}대 중 ${b.affected}대에서 발생했고, 가장 많은 ${top.unit}도 ${Math.round(b.topShare * 100)}%(${top.count}건)입니다 — 한 호기 문제가 아니라 설비군 공통으로 볼 근거입니다.`
        : `${b.affected}대에서만 발생했습니다 — 발생한 호기부터 먼저 확인하세요.`;
  return (
    <div data-guide="unit-spread" className="rounded-lg border border-slate-800 bg-black/20 p-3">
      <div className="mb-2 flex flex-wrap items-baseline gap-2">
        <span className="text-sm font-semibold text-slate-200">호기별 분포</span>
        <span className="text-[11px] text-slate-400">
          최근 90일 기록 {b.total}건{b.fleetMedian !== null ? ` · 전체 기록 신호 중앙값 ${fmt(b.fleetMedian)}${p.histogram?.unit ?? ""}` : ""}
          {medians.length > 1 ? ` · 호기별 중앙값 ${fmt(Math.min(...medians))}~${fmt(Math.max(...medians))}${p.histogram?.unit ?? ""}` : ""}
        </span>
      </div>
      <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4 lg:grid-cols-6">
        {b.rows.map((r) => {
          const odd = b.outliers.some((o) => o.unit === r.unit);
          return (
            <div
              key={r.unit}
              className={`rounded-md border px-2 py-1 text-[11px] ${odd ? "border-amber-400/70" : r.unit === top.unit && b.verdict === "single" ? "border-red-400/70" : "border-slate-800"}`}
              title={`${r.unit} · ${r.count}건 · 리셋으로 해결 ${r.resetResolved}건${r.median !== null ? ` · 측정값 중앙값 ${fmt(r.median)} (${r.measuredN}건)` : " · 측정값 없음"}`}
            >
              <div className="flex items-center justify-between">
                <span className="mono whitespace-nowrap text-slate-200">{r.unit}</span>
                <span className="whitespace-nowrap tabular-nums text-slate-300">{r.count}건</span>
              </div>
              <div className="mt-1 h-1.5 rounded bg-slate-800">
                <div className="h-1.5 rounded bg-sky-500/70" style={{ width: `${(r.count / max) * 100}%` }} />
              </div>
              <div className="mt-0.5 text-slate-400">{r.median !== null ? `중앙값 ${fmt(r.median)}${p.histogram?.unit ?? ""}` : "측정값 없음"}</div>
            </div>
          );
        })}
      </div>
      <p className={`mt-2 text-xs ${b.verdict === "single" ? "text-red-200" : "text-slate-300"}`}>
        {verdict}
        {b.outliers.length > 0 && (
          <span className="text-amber-200"> 신호 길이가 다른 호기: {b.outliers.map((o) => `${o.unit}(${fmt(o.median!)}${p.histogram?.unit ?? ""})`).join(", ")} — 따로 확인하세요.</span>
        )}
      </p>
    </div>
  );
}

function reviewSheet(p: Proposal): string {
  return [
    `[${KIND_LABEL[p.kind]} 검토서] ${p.title}`,
    `대상: ${p.programId} · ${p.appliesTo.join(", ")} · 알람 ${p.alarmCode} (${p.level}알람${p.protect ? ` · ${p.protect}` : ""})`,
    `요약: ${p.summary}`,
    "근거:",
    ...p.evidence.map((e) => `  - ${e.label}: ${e.value}`),
    p.change ? `변경 내용: ${p.change.title}\n${p.change.diff.map((d) => `  ${d.mark === " " ? " " : d.mark} ${d.text}`).join("\n")}` : "",
    p.impact ? `영향 범위: ${p.impact.map((u) => `스텝 ${u.step}(${u.kind} ${u.instr})`).join(", ")}` : "",
    `추정 효과: ${p.effect.note} (연 ${Math.round(p.effect.perYearMin / 60)}시간)`,
    ...(p.checks ? ["승인 전 확인:", ...p.checks.map((c) => `  □ ${c}`)] : []),
    ...(p.stages ? ["검증 단계:", ...p.stages.map((c) => `  - ${c.name}: ${c.state} — ${c.detail}`)] : []),
    ...(p.pilot ? [`1대 실증: ${p.pilot.target} / 신호 ${p.pilot.tags.join(", ")} / 성공 ${p.pilot.success} / 중단 ${p.pilot.stop}`] : []),
    ...(p.meta ? [`근거: ${p.meta.period}, 기록 ${p.meta.logCount}건, 규칙 ${p.meta.ruleVersion}, 계산 ${p.meta.computedAt.slice(0, 16)}`] : []),
    `검토 담당: ${p.owner}    검토자: ________    승인: ________`,
  ]
    .filter(Boolean)
    .join("\n");
}

function ProposalCard({ p, focused }: { p: Proposal; focused: boolean }) {
  const data = useData();
  const review = data.reviews.get(p.id);
  const [comment, setComment] = useState(review?.comment ?? "");
  const [reviewer, setReviewer] = useState(review?.reviewer ?? "");
  const st = review?.status ?? "검토 대기";
  // 같은 회로의 자기유지 접점은 제외하고, 다른 회로에서 쓰는 곳만 센다
  const usedElsewhere = useMemo(
    () =>
      (p.impact ?? []).filter(
        (u) =>
          u.kind === "접점" &&
          !u.outputDevices.some((o) => p.impact!.some((x) => x.kind === "출력" && x.outputDevices.includes(o) && x.rungIndex === u.rungIndex)),
      ),
    [p.impact],
  );

  return (
    <section id={p.id} data-guide="proposal" className={`scroll-mt-20 rounded-xl border bg-slate-900/60 ${focused ? "border-sky-500 ring-2 ring-sky-500/40" : "border-slate-800"}`}>
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-800 px-4 py-2.5">
        <span className={`rounded border px-2 py-0.5 text-[11px] font-semibold ${KIND_TONE[p.kind]}`}>{KIND_LABEL[p.kind]}</span>
        <LevelBadge level={p.level} />
        <ProtectBadge protect={p.protect} />
        <h2 className="font-semibold">{p.title}</h2>
        <span className={`ml-auto rounded-full border px-2 py-0.5 text-xs ${STATUS_TONE[st]}`}>{st}</span>
      </div>
      <PlainSummary p={p} />
      <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <div className="space-y-3">
          <p className="text-sm text-slate-200">{p.summary}</p>
          <UnitSpread p={p} />
          {p.kind === "debounce" && p.histogram && <DebounceSim p={p} />}
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
            {p.evidence.map((e) => (
              <div key={e.label} className="contents">
                <dt className="text-slate-400">{e.label}</dt>
                <dd className="text-slate-200">{e.value}</dd>
              </div>
            ))}
          </dl>
          <ExpertOnly label="측정값 분포" when={!!p.histogram}>
            {p.histogram && (
              <div className="rounded-lg border border-slate-800 bg-black/20 p-2">
                <div className="mb-1 text-[11px] text-slate-400">{p.kind === "pm" ? "조치 간격 분포" : "측정값 분포 (조치이력의 측정값 칸)"}</div>
                <Histogram
                  {...p.histogram}
                  avoidLabel={
                    p.histogram.labels?.avoid ??
                    (p.kind === "pm" ? "제안 주기 뒤에 발생한 고장 → 미리 정비로 막음" : p.kind === "inspect" ? "1초 안에 끝난 신호" : "억제되는 알람(추정)")
                  }
                  keepLabel={
                    p.histogram.labels?.keep ?? (p.kind === "pm" ? "제안 주기보다 먼저 발생한 고장" : p.kind === "inspect" ? "1초 넘게 이어진 신호" : "그대로 알람")
                  }
                />
              </div>
            )}
          </ExpertOnly>
          <ExpertOnly label="래더 변경 전후·영향 분석" when={!!p.change}>
            {p.change && (
              <div>
                <div className="mb-1 flex items-center gap-2 text-xs">
                  <span className="font-semibold text-teal-300">래더 변경안</span>
                  <span className="text-slate-400">{p.change.title}</span>
                </div>
                <DiffView diff={p.change.diff} />
                {p.impact && (
                  <div className="mt-2 text-xs text-slate-400">
                    <span className="text-slate-300">변경 영향 분석</span> · 이 디바이스를 쓰는 곳 {p.impact.length}곳:{" "}
                    {p.impact.map((u) => (
                      <span key={u.step + u.kind} className="mono mr-2">
                        스텝 {u.step}({u.instr}
                        {u.kind === "접점" ? `→${u.outputDevices.join(",")}` : ""})
                      </span>
                    ))}
                    {usedElsewhere.length > 0 && (
                      <span className="text-amber-200">
                        {" "}
                        — 다른 회로 {usedElsewhere.length}곳(스텝 {usedElsewhere.map((u) => u.step).join(", ")})의 동작 시점도 함께 바뀌니 확인
                      </span>
                    )}
                  </div>
                )}
              </div>
            )}
          </ExpertOnly>
          {p.manualDraft && (
            <div className="rounded-lg border border-violet-500/40 bg-violet-500/5 p-3 text-sm">
              <div className="mb-1 text-xs font-semibold text-violet-300">매뉴얼 추가 초안</div>
              <div>
                원인: <b>{p.manualDraft.cause}</b>
              </div>
              <ol className="mt-1 list-decimal pl-5 text-slate-300">
                {p.manualDraft.steps.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ol>
            </div>
          )}
          {p.schedule && (
            <div>
              <div className="mb-1 text-xs text-slate-400">설비별 다음 예방정비 권장일</div>
              <div className="flex flex-wrap gap-1.5">
                {p.schedule.map((s) => (
                  <span
                    key={s.equipmentId}
                    title={`마지막 ${fmtDate(s.last, false)}`}
                    className={`rounded border px-2 py-0.5 text-xs ${s.overdue ? "border-red-500/50 bg-red-500/10 text-red-300" : "border-slate-700 text-slate-300"}`}
                  >
                    <span className="mono">{s.equipmentId}</span> {fmtDate(s.next, false)}
                    {s.overdue && " 지남"}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="space-y-3">
          <div className="rounded-lg border border-sky-500/30 bg-sky-500/5 p-3">
            <div className="text-[11px] text-sky-300">조치이력으로 다시 계산한 추정 효과 (가정 조건 · 실증 전)</div>
            <div className="mt-1 flex items-baseline gap-3">
              {p.effect.avoided > 0 && (
                <div>
                  <span className="text-2xl font-bold tabular-nums">{p.effect.avoided}</span>
                  <span className="text-sm text-slate-400"> / {p.effect.total}건</span>
                  <div className="text-[11px] text-slate-400">
                    {p.kind === "pm" ? "계획 정비로 전환" : p.kind === "unit" || p.kind === "inspect" ? "근본 조치 시 최대(추정)" : "억제 추정"}
                  </div>
                </div>
              )}
              <div>
                <span className="text-2xl font-bold tabular-nums text-sky-200">{Math.round(p.effect.perYearMin / 60)}</span>
                <span className="text-sm text-slate-400">시간/년</span>
                <div className="text-[11px] text-slate-400">정지 시간 감소</div>
              </div>
            </div>
            <p className="mt-2 text-xs text-slate-400">{p.effect.note}</p>
          </div>

          <div className="text-xs">
            <div className="mb-1 text-slate-400">
              적용 대상 {p.appliesTo.length}대 · 검토 담당 <b className="text-slate-200">{p.owner}</b> · 프로그램 <span className="mono">{p.programId}</span>
            </div>
            <div className="flex flex-wrap gap-1">
              {p.appliesTo.map((e) => (
                <Link key={e} href={`/alarm/${e}/${p.alarmCode}`} className="mono rounded bg-slate-800 px-1.5 py-0.5 text-slate-300 hover:bg-slate-700">
                  {e}
                </Link>
              ))}
            </div>
          </div>

          <ExpertOnly label="대안" when={!!p.alternatives}>
            {p.alternatives && (
              <div>
                <div className="mb-1 text-xs text-slate-400">대안</div>
                <ul className="list-disc space-y-0.5 pl-4 text-xs text-slate-300">
                  {p.alternatives.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              </div>
            )}
          </ExpertOnly>
          {p.checks && (
            <div className="rounded-lg border border-amber-400/30 bg-amber-400/5 p-2">
              <div className="mb-1 text-xs font-semibold text-amber-200">승인 전 확인 항목</div>
              <ul className="space-y-0.5 text-xs text-slate-300">
                {p.checks.map((r) => (
                  <li key={r} className="flex gap-1.5">
                    <span className="text-amber-300">□</span>
                    {r}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {p.stages && (
            <div>
              <div className="mb-1 text-xs text-slate-400">검증 단계</div>
              <ol className="grid grid-cols-2 gap-1.5 text-xs">
                {p.stages.map((st, i) => (
                  <li
                    key={st.name}
                    title={st.detail}
                    className={`rounded-md border px-2 py-1 ${
                      st.state === "완료"
                        ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-200"
                        : st.state === "미달"
                          ? "border-red-500/50 bg-red-500/10 text-red-200"
                          : st.state === "보류" || st.state === "확인 필요"
                            ? "border-amber-400/50 bg-amber-400/10 text-amber-200"
                            : "border-slate-700 text-slate-400"
                    }`}
                  >
                    <div className="font-semibold">
                      {i + 1}. {st.name} · {st.state}
                    </div>
                    <div className="text-[11px] opacity-80">{st.detail}</div>
                  </li>
                ))}
              </ol>
              {p.validation && (
                <div className="mt-1 text-[11px] text-slate-400">
                  독립 기간 검증: 기준은 {p.validation.trainPeriod}에서만 고르고 {p.validation.testPeriod}에 적용 ({p.validation.param})
                </div>
              )}
              <ExpertOnly label="검증 기간 기록 분해표" when={!!p.validation?.breakdown}>
                {p.validation?.breakdown && (
                  <table className="mt-1 w-full text-[11px]">
                    <thead className="text-slate-400">
                      <tr>
                        <th className="text-left font-normal">검증 기간 기록(조치 유형·결과별)</th>
                        <th className="text-right font-normal">억제됨</th>
                        <th className="pl-2 text-left font-normal">의미</th>
                      </tr>
                    </thead>
                    <tbody>
                      {p.validation.breakdown.map((b) => (
                        <tr key={b.label} className="border-t border-slate-800/70">
                          <td className="py-0.5 text-slate-300">{b.label}</td>
                          <td
                            className={`text-right tabular-nums ${
                              b.label.startsWith("리셋으로") ? "text-slate-200" : b.suppressed > 0 ? "font-semibold text-amber-200" : "text-emerald-300"
                            }`}
                          >
                            {b.suppressed}/{b.total}
                          </td>
                          <td className="pl-2 text-slate-400">{b.note}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </ExpertOnly>
            </div>
          )}
          <ExpertOnly label="1대 실증 계획 세부" when={!!p.pilot}>
            {p.pilot && (
              <div className="rounded-lg border border-sky-500/30 bg-sky-500/5 p-2 text-xs">
                <div className="mb-1 font-semibold text-sky-200">1대 실증 계획</div>
                <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-slate-300">
                  <dt className="text-slate-400">대상</dt>
                  <dd>{p.pilot.target}</dd>
                  <dt className="text-slate-400">필요한 신호</dt>
                  <dd className="mono">{p.pilot.tags.join(", ")} (읽기 전용)</dd>
                  <dt className="text-slate-400">순서</dt>
                  <dd>{p.pilot.plan}</dd>
                  <dt className="text-slate-400">성공 조건</dt>
                  <dd>{p.pilot.success}</dd>
                  <dt className="text-slate-400">중단 조건</dt>
                  <dd>{p.pilot.stop}</dd>
                  <dt className="text-slate-400">책임</dt>
                  <dd>{p.pilot.owner}</dd>
                </dl>
              </div>
            )}
          </ExpertOnly>
          {p.needs && (
            <div className="rounded-lg border border-slate-600 bg-slate-800/40 p-2 text-xs">
              <div className="mb-1 font-semibold text-slate-200">판단에 필요한 자료</div>
              <ul className="list-disc pl-4 text-slate-300">
                {p.needs.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </div>
          )}
          <div>
            <div className="mb-1 text-xs text-slate-400">주의</div>
            <ul className="list-disc space-y-0.5 pl-4 text-xs text-slate-300">
              {p.risks.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </div>

          <div className="rounded-lg border border-slate-800 p-3">
            <div className="mb-2 text-xs text-slate-400">검토 (조치이력 DB에 함께 저장)</div>
            <div className="grid grid-cols-2 gap-2">
              <input className={inputCls} placeholder="검토자 (예: PLC 담당A)" value={reviewer} onChange={(e) => setReviewer(e.target.value)} />
              <input className={inputCls} placeholder="의견" value={comment} onChange={(e) => setComment(e.target.value)} />
            </div>
            <div className="mt-2 flex gap-2">
              {(["승인", "보류", "검토 대기"] as ProposalStatus[]).map((s) => (
                <Btn
                  key={s}
                  tone={s === "승인" ? "success" : s === "보류" ? "default" : "ghost"}
                  onClick={() => data.saveReview({ proposalId: p.id, status: s, comment, reviewer })}
                >
                  {s}
                </Btn>
              ))}
              <Btn tone="ghost" className="text-xs" onClick={() => copyText(reviewSheet(p))}>
                검토서 복사
              </Btn>
              <Link href={`/history?alarm=${p.alarmCode}`} className="ml-auto self-center text-xs text-sky-300 hover:underline">
                근거 이력 {p.logIds.length || p.effect.total}건 보기 →
              </Link>
            </div>
            {review && (
              <div className="mt-2 text-[11px] text-slate-400">
                마지막 검토: {review.reviewer || "-"} · {fmtDate(review.updatedAt)} {review.comment && `· “${review.comment}”`}
              </div>
            )}
            {p.meta && (
              <div className="mt-2 text-[10px] text-slate-400">
                입력 기간 {p.meta.period} · 기록 {p.meta.logCount}건 · 규칙 {p.meta.ruleVersion} · 프로그램 {p.meta.programId} · 계산{" "}
                {fmtDate(p.meta.computedAt)} · 승인은 적용 검토 결정이며 효과의 증거가 아닙니다
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

/** 처음 보는 사람용 한 줄 요약: 문제 / 바꿀 것 / 기대 효과(추정) / 누가 정하나 */
function PlainSummary({ p }: { p: Proposal }) {
  const change = p.title.includes(" — ") ? p.title.split(" — ").slice(1).join(" — ") : p.title;
  const cells: [string, string][] = [
    ["문제", `${p.alarmName} · ${p.evidence[0]?.value ?? ""}`],
    ["바꿀 것", change],
    [
      "기대 효과 (추정)",
      p.kind === "hold"
        ? "판단 보류 — 자료가 더 필요"
        : `${p.effect.avoided > 0 ? `과거 ${p.effect.total}건 중 ${p.effect.avoided}건 ${p.kind === "pm" ? "계획 정비로 전환" : p.kind === "unit" || p.kind === "inspect" ? "근본 조치 시 최대" : "억제"} · ` : ""}연 ${Math.round(p.effect.perYearMin / 60)}시간 정지 감소${
            p.validation ? ` · 독립 검증 ${p.validation.status}` : ""
          }`,
    ],
    ["누가 정하나", `${p.owner} 검토 → 승인 후 적용 (도구는 PLC에 쓰지 않음)`],
  ];
  return (
    <div className="grid gap-px border-b border-slate-800 bg-slate-800 sm:grid-cols-4">
      {cells.map(([k, v]) => (
        <div key={k} className="bg-slate-900/90 px-4 py-2">
          <div className="text-[11px] text-slate-400">{k}</div>
          <div className="text-sm text-slate-100">{v}</div>
        </div>
      ))}
    </div>
  );
}

/** 지속 판정 기준을 직접 움직여 보는 시뮬레이터 — 과거 기록에 다시 계산한 추정치, PLC 반영 아님 */
function DebounceSim({ p }: { p: Proposal }) {
  const data = useData();
  const rule = p.histogram!.threshold;
  const [th, setTh] = useState(rule);
  const logs = useMemo(
    () =>
      since(data.logs, 90).filter((l) => l.alarmCode === p.alarmCode && p.appliesTo.includes(l.equipmentId) && l.measuredUnit === "s" && l.measured !== null),
    [data.logs, p.alarmCode, p.appliesTo],
  );
  const resets = logs.filter((l) => l.actionType === "리셋" && l.result === "해결");
  const real = logs.filter((l) => l.actionType !== "리셋");
  const hit = logs.filter((l) => l.measured! < th);
  const resetHit = resets.filter((l) => l.measured! < th).length;
  const realHit = real.filter((l) => l.measured! < th).length;
  const resetFail = logs.filter((l) => l.actionType === "리셋" && l.result === "미해결" && l.measured! < th);
  const savedMin = hit.reduce((a, l) => a + l.durationMin, 0);
  const speed = LINE_SPEED[EQUIPMENT_BY_ID.get(p.appliesTo[0])?.process ?? "STACK"];
  const mm = speed ? Math.round((speed / 60) * th * 1000) : null;
  return (
    <div className="rounded-lg border border-teal-500/30 bg-teal-500/5 p-3">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="font-semibold text-teal-200">가정값 비교 — 설비 설정 변경 없음</span>
        <span className="text-slate-400">
          <Term k="지속 판정" /> 시간을 가정하면 과거 90일 기록이 어떻게 됐을지 다시 계산합니다. 제안·검토 상태는 바뀌지 않습니다.
        </span>
      </div>
      <div className="mt-2 flex items-center gap-3">
        <input
          type="range"
          min={0.05}
          max={1}
          step={0.05}
          value={th}
          onChange={(e) => setTh(Number(e.target.value))}
          className="w-full accent-teal-400"
          aria-label="지속 판정 시간(초)"
        />
        <span className="mono w-14 shrink-0 text-right text-lg font-semibold text-teal-100">{th.toFixed(2)}s</span>
        {Math.abs(th - rule) > 1e-9 && (
          <button type="button" onClick={() => setTh(rule)} className="shrink-0 text-xs text-slate-400 hover:text-slate-200">
            규칙값 {rule.toFixed(1)}s로
          </button>
        )}
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
        <div>
          <div className="text-[11px] text-slate-400">억제됐을 기록(추정)</div>
          <div className="tabular-nums">
            <b>{hit.length}</b>
            <span className="text-slate-400"> / {logs.length}건</span>
          </div>
        </div>
        <div>
          <div className="text-[11px] text-slate-400">그중 리셋으로 해결</div>
          <div className="tabular-nums">
            {resetHit}
            <span className="text-slate-400"> / {resets.length}건</span>
          </div>
        </div>
        <div>
          <div className="text-[11px] text-slate-400" title="억제되면 최초 알람이 늦어지는 기록 — 실제 이상인지는 현장 확인">
            추가 확인이 필요한 기록
          </div>
          <div className={`text-xs leading-snug tabular-nums ${realHit + resetFail.length ? "font-semibold text-amber-200" : "text-emerald-300"}`}>
            <div>
              리셋 외 조치 {realHit}/{real.length}건
            </div>
            <div>리셋 미해결 {resetFail.length}건</div>
          </div>
        </div>
        <div>
          <div className="text-[11px] text-slate-400">늦게 판정하는 동안</div>
          <div className="tabular-nums">{mm !== null ? `전극 약 ${mm}mm 통과` : "-"}</div>
        </div>
      </div>
      {resetFail.length > 0 && (
        <div className="mt-2 rounded border border-amber-500/40 bg-amber-500/5 px-2 py-1 text-[11px] text-amber-100">
          리셋했지만 풀리지 않은 짧은 신호 {resetFail.length}건({resetFail.map((l) => `${l.equipmentId} ${l.measured}s`).join(", ")})도 이 가정값이면 억제됩니다
          — 최초 알람이 억제·지연됐을 것은 그대로이며, 뒤이은 기록이 같은 이상인지는 현장 확인이 필요합니다.
        </div>
      )}
      <div className="mt-1 text-[11px] text-slate-400">
        정지 시간 감소(추정) 90일 {Math.round(savedMin)}분 · 억제 건수는 개선 성과가 아닙니다. 가정값을 늘릴수록 억제는 늘지만 확인이 필요한 기록과 불량 추적
        구간도 커집니다. 여기서 고른 값은 독립 검증된 값이 아니며, 검증 대상은 규칙값({rule.toFixed(1)}s)뿐입니다. 기준은 PLC·공정 담당 검토로 정합니다.
      </div>
    </div>
  );
}
