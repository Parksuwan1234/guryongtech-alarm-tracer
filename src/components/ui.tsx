"use client";

import type { ReactNode } from "react";
import type { DiffLine } from "@/lib/ladder";
import type { HistogramBin } from "@/lib/propose";
import type { AlarmLevel, EquipStatus, ProcessKind, SourceKind } from "@/lib/types";

export const STATUS_META: Record<EquipStatus, { label: string; dot: string; text: string; ring: string; bg: string }> = {
  RUN: { label: "가동", dot: "bg-emerald-400", text: "text-emerald-300", ring: "ring-emerald-500/50", bg: "bg-emerald-500/10" },
  IDLE: { label: "대기", dot: "bg-blue-300", text: "text-blue-200", ring: "ring-blue-400/50", bg: "bg-blue-400/10" },
  STOP: { label: "정지", dot: "bg-slate-400", text: "text-slate-300", ring: "ring-slate-400/60", bg: "bg-slate-500/15" },
  ALARM: { label: "알람", dot: "bg-red-500", text: "text-red-300", ring: "ring-red-500/70", bg: "bg-red-500/15" },
};

export const LIGHT_ALARM = { dot: "bg-orange-400", text: "text-orange-300", ring: "ring-orange-400/80", bg: "bg-orange-500/15" };

export function statusTone(status: EquipStatus, level?: AlarmLevel | null) {
  if (status === "ALARM" && level === "경") return { ...STATUS_META.ALARM, ...LIGHT_ALARM, label: "경알람" };
  if (status === "ALARM") return { ...STATUS_META.ALARM, label: "중알람" };
  return STATUS_META[status];
}

export function StatusBadge({ status, level, className = "" }: { status: EquipStatus; level?: AlarmLevel | null; className?: string }) {
  const t = statusTone(status, level);
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${t.bg} ${t.text} ${className}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${t.dot}`} />
      {t.label}
    </span>
  );
}

/** 근거 표시: '충분' 같은 판정어 대신 관측 사실(참고 이력 n건)만 — 2건 이하면 표본 적음 경고 */
export function EvidenceTag({ n }: { n: number }) {
  const few = n <= 2;
  return (
    <span
      title="같은 알람의 과거 기록 수. 기록이 많아도 원인 분류·설비 조건 차이까지 보장하지는 않습니다."
      className={`rounded border px-1 py-px text-[10px] ${few ? "border-amber-500/50 text-amber-200" : "border-slate-600 text-slate-300"}`}
    >
      {few ? `표본 적음 · 이력 ${n}건` : `참고 이력 ${n}건`}
    </span>
  );
}

export function LevelBadge({ level }: { level: AlarmLevel }) {
  return level === "중" ? (
    <span className="rounded bg-red-600 px-1.5 py-0.5 text-[11px] font-bold text-white">중알람</span>
  ) : (
    <span className="rounded bg-orange-400 px-1.5 py-0.5 text-[11px] font-bold text-slate-950">경알람</span>
  );
}

export function ProtectBadge({ protect }: { protect: string }) {
  if (!protect) return null;
  const tone =
    protect === "안전"
      ? "border-red-400/60 text-red-200 bg-red-500/10"
      : protect === "설비 보호"
        ? "border-amber-400/60 text-amber-200 bg-amber-400/10"
        : "border-sky-400/50 text-sky-200 bg-sky-500/10";
  return (
    <span
      title="경·중 등급과 별개인 보호 구분 — 안전·설비 보호 알람은 래더 변경 제안 대상에서 제외"
      className={`rounded border px-1.5 py-0.5 text-[11px] ${tone}`}
    >
      {protect}
    </span>
  );
}

export const SOURCE_META: Record<SourceKind, { text: string; bg: string; border: string; desc: string }> = {
  "현장 입력": { text: "text-sky-300", bg: "bg-sky-500/15", border: "border-sky-500/50", desc: "센서·스위치·서보앰프 등 설비의 물리 입력" },
  "외부 신호": { text: "text-violet-300", bg: "bg-violet-500/15", border: "border-violet-500/50", desc: "MES·비전 PC·유틸리티 등 우리 설비 밖에서 오는 신호" },
  "래더 로직": { text: "text-teal-300", bg: "bg-teal-500/15", border: "border-teal-500/50", desc: "타이머 설정·시퀀스·연산 등 래더 자체의 판단" },
};

export function SourceBadge({ kind, className = "" }: { kind: SourceKind | null | undefined; className?: string }) {
  if (!kind) return null;
  const m = SOURCE_META[kind];
  return (
    <span title={m.desc} className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[11px] font-medium ${m.bg} ${m.text} ${m.border} ${className}`}>
      {kind}
    </span>
  );
}

export function Card({
  title,
  right,
  children,
  className = "",
  bodyClass = "p-4",
  id,
}: {
  title?: ReactNode;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClass?: string;
  id?: string;
}) {
  return (
    <section id={id} className={`rounded-xl border border-slate-800 bg-slate-900/60 ${className}`}>
      {(title || right) && (
        <div className="flex items-center gap-2 border-b border-slate-800 px-4 py-2.5">
          <h2 className="text-sm font-semibold text-slate-200">{title}</h2>
          <div className="ml-auto">{right}</div>
        </div>
      )}
      <div className={bodyClass}>{children}</div>
    </section>
  );
}

export function Stat({ label, value, sub, tone = "text-slate-100" }: { label: string; value: ReactNode; sub?: ReactNode; tone?: string }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2">
      <div className="text-[11px] text-slate-400">{label}</div>
      <div className={`text-xl font-semibold tabular-nums ${tone}`}>{value}</div>
      {sub && <div className="text-[11px] text-slate-400">{sub}</div>}
    </div>
  );
}

export function Btn({
  children,
  onClick,
  tone = "default",
  className = "",
  type = "button",
  disabled,
  title,
}: {
  children: ReactNode;
  onClick?: () => void;
  tone?: "default" | "primary" | "danger" | "ghost" | "success";
  className?: string;
  type?: "button" | "submit";
  disabled?: boolean;
  title?: string;
}) {
  const tones = {
    default: "border border-slate-700 bg-slate-800 text-slate-100 hover:bg-slate-700",
    primary: "bg-sky-700 text-white hover:bg-sky-800",
    success: "bg-emerald-700 text-white hover:bg-emerald-800",
    danger: "border border-red-500/40 bg-red-500/10 text-red-300 hover:bg-red-500/20",
    ghost: "text-slate-300 hover:bg-slate-800",
  };
  return (
    <button
      type={type}
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${tones[tone]} ${className}`}
    >
      {children}
    </button>
  );
}

/** 설비 종류별 단순 아이콘 (공개 시연용. 사내 버전에서는 CAD 썸네일로 교체) */
export function EquipIcon({ process, className = "h-7 w-7" }: { process: ProcessKind; className?: string }) {
  const common = { fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  switch (process) {
    case "COAT":
      return (
        <svg viewBox="0 0 32 32" className={className} {...common}>
          <circle cx="6" cy="22" r="3.5" />
          <circle cx="26" cy="22" r="3.5" />
          <rect x="10" y="7" width="12" height="8" rx="1" />
          <path d="M6 18.5 10 15M26 18.5 22 15M9.5 22h13" />
          <path d="M13 10h6" />
        </svg>
      );
    case "PRESS":
      return (
        <svg viewBox="0 0 32 32" className={className} {...common}>
          <circle cx="16" cy="10" r="5" />
          <circle cx="16" cy="22" r="5" />
          <path d="M3 16h26" />
          <path d="M16 10h.01M16 22h.01" />
        </svg>
      );
    case "NOTCH":
      return (
        <svg viewBox="0 0 32 32" className={className} {...common}>
          <path d="M8 4h16v6H8z" />
          <path d="M16 10v5" />
          <path d="M11 15h10l-2 4h-6z" />
          <path d="M3 24h26" />
          <path d="M9 24v3M15 24v3M21 24v3" />
        </svg>
      );
    case "STACK":
      return (
        <svg viewBox="0 0 32 32" className={className} {...common}>
          <path d="M6 22h20M6 18h20M6 14h20" />
          <path d="M9 10h14" />
          <path d="M16 4v6M13 7l3 3 3-3" />
          <path d="M5 26h22" />
        </svg>
      );
  }
}

/** 측정값 분포 + 기준선 (거를 수 있는 구간은 초록) */
export function Histogram({
  bins,
  threshold,
  current,
  unit,
  thresholdLabel,
  avoidLabel = "억제되는 알람(추정)",
  keepLabel = "그대로 알람",
}: {
  bins: HistogramBin[];
  threshold: number;
  current?: number;
  unit: string;
  thresholdLabel: string;
  avoidLabel?: string;
  keepLabel?: string;
}) {
  if (!bins.length) return null;
  const W = 520;
  const H = 150;
  const pad = { l: 28, r: 8, t: 18, b: 28 };
  const lo = bins[0].from;
  const hi = bins[bins.length - 1].to;
  const max = Math.max(...bins.map((b) => b.count), 1);
  const x = (v: number) => pad.l + ((v - lo) / (hi - lo || 1)) * (W - pad.l - pad.r);
  const y = (c: number) => H - pad.b - (c / max) * (H - pad.t - pad.b);
  const fmt = (v: number) => (Math.abs(v) < 10 ? v.toFixed(Math.abs(v) < 1 ? 2 : 1) : v.toFixed(0));
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
        {bins.map((b, i) => (
          <g key={i}>
            <rect
              x={x(b.from) + 1}
              y={y(b.count)}
              width={Math.max(1, x(b.to) - x(b.from) - 2)}
              height={H - pad.b - y(b.count)}
              rx={2}
              className={b.avoided ? "fill-emerald-500/70" : "fill-slate-500/70"}
            />
            {b.count > 0 && (
              <text x={(x(b.from) + x(b.to)) / 2} y={y(b.count) - 3} textAnchor="middle" className="fill-slate-300 text-[10px]">
                {b.count}
              </text>
            )}
          </g>
        ))}
        <line x1={pad.l} x2={W - pad.r} y1={H - pad.b} y2={H - pad.b} className="stroke-slate-700" />
        {[0, 0.25, 0.5, 0.75, 1].map((f) => {
          const v = lo + (hi - lo) * f;
          return (
            <text key={f} x={x(v)} y={H - pad.b + 14} textAnchor="middle" className="fill-slate-500 text-[10px]">
              {fmt(v)}
            </text>
          );
        })}
        <text x={W - pad.r} y={H - 2} textAnchor="end" className="fill-slate-500 text-[10px]">
          ({unit})
        </text>
        {current !== undefined && (
          <g>
            <line x1={x(current)} x2={x(current)} y1={pad.t - 6} y2={H - pad.b} className="stroke-amber-300" strokeDasharray="3 3" />
            <text
              x={x(current) < 80 ? x(current) + 4 : x(current) - 4}
              y={pad.t + 10}
              textAnchor={x(current) < 80 ? "start" : "end"}
              className="fill-amber-300 text-[10px]"
            >
              현재 {fmt(current)}
            </text>
          </g>
        )}
        <line x1={x(threshold)} x2={x(threshold)} y1={pad.t - 6} y2={H - pad.b} className="stroke-emerald-300" strokeWidth={2} />
        <text x={x(threshold) + 3} y={pad.t - 8} className="fill-emerald-300 text-[10px] font-semibold">
          {thresholdLabel}
        </text>
      </svg>
      <div className="mt-1 flex gap-4 text-[11px] text-slate-400">
        <span className="flex items-center gap-1">
          <span className="h-2 w-3 rounded-sm bg-emerald-500/70" /> {avoidLabel}
        </span>
        <span className="flex items-center gap-1">
          <span className="h-2 w-3 rounded-sm bg-slate-500/70" /> {keepLabel}
        </span>
      </div>
    </div>
  );
}

export function HBars({
  items,
  unit = "",
  max,
}: {
  items: { label: ReactNode; value: number; tone?: string; sub?: ReactNode }[];
  unit?: string;
  max?: number;
}) {
  const m = max ?? Math.max(...items.map((i) => i.value), 1);
  return (
    <div className="space-y-1.5">
      {items.map((it, i) => (
        <div key={i} className="grid grid-cols-[minmax(0,9rem)_1fr_auto] items-center gap-2 text-xs">
          <div className="truncate text-slate-300">{it.label}</div>
          <div className="h-3 rounded bg-slate-800">
            <div className={`h-3 rounded ${it.tone ?? "bg-sky-500/70"}`} style={{ width: `${(it.value / m) * 100}%` }} />
          </div>
          <div className="whitespace-nowrap text-right tabular-nums text-slate-400">
            {Number.isInteger(it.value) ? it.value : it.value.toFixed(1)}
            {unit}
            {it.sub}
          </div>
        </div>
      ))}
    </div>
  );
}

export function DiffView({ diff }: { diff: DiffLine[] }) {
  return (
    <pre className="mono overflow-x-auto rounded-lg border border-slate-800 bg-black/40 p-3 text-[12px] leading-5">
      {diff.map((d, i) => (
        <div
          key={i}
          className={
            d.mark === "+"
              ? "bg-emerald-500/15 text-emerald-300"
              : d.mark === "-"
                ? "bg-red-500/15 text-red-300 line-through decoration-red-400/50"
                : "text-slate-300"
          }
        >
          <span className="mr-2 inline-block w-3 select-none text-slate-400">{d.mark === " " ? "" : d.mark}</span>
          {d.text}
        </div>
      ))}
    </pre>
  );
}

export function Field({ label, children, className = "" }: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={`block text-xs ${className}`}>
      <span className="mb-1 block text-slate-400">{label}</span>
      {children}
    </label>
  );
}

export const inputCls =
  "w-full rounded-md border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-sm text-slate-100 placeholder:text-slate-500 focus:border-sky-500 focus:outline-none";

export function copyText(text: string): Promise<boolean> {
  try {
    return navigator.clipboard.writeText(text).then(
      () => true,
      () => false,
    );
  } catch {
    return Promise.resolve(false);
  }
}
