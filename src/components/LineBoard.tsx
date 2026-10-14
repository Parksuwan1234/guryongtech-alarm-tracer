"use client";

import { useEffect, useRef, useState } from "react";
import { EQUIPMENT, PROCESS_LABEL } from "@/data/equipment";
import { elapsed, hms, type LiveEquip } from "@/lib/live";
import type { ProcessKind } from "@/lib/types";
import { EquipIcon, statusTone } from "./ui";

const COL: Record<ProcessKind, number> = { COAT: 0, PRESS: 1, NOTCH: 2, STACK: 3 };
const TILE_W = 200;
const TILE_H = 46;
const COL_W = 292;
const ROW_H = 54;
const GROUP_GAP = 34;
const TOP = 34;
const LEFT = 8;

function rowY(i: number) {
  return TOP + i * ROW_H + (i >= 6 ? GROUP_GAP : 0);
}

function layout() {
  const pos = new Map<string, { x: number; y: number }>();
  const idx = (id: string) => Number(id.slice(3)) - 1;
  for (const e of EQUIPMENT) {
    const x = LEFT + COL[e.process] * COL_W;
    if (e.process === "PRESS" || e.process === "NOTCH") pos.set(e.id, { x, y: rowY(idx(e.id)) });
  }
  for (const e of EQUIPMENT) {
    const x = LEFT + COL[e.process] * COL_W;
    if (e.process === "COAT") {
      const c = idx(e.id);
      const ys = [0, 1, 2].map((k) => rowY(c * 3 + k));
      pos.set(e.id, { x, y: (ys[0] + ys[2]) / 2 });
    }
    if (e.process === "STACK") {
      const ys = e.upstream.map((u) => pos.get(u)!.y);
      pos.set(e.id, { x, y: ys.reduce((s, v) => s + v, 0) / ys.length });
    }
  }
  return pos;
}

const POS = layout();
const WIDTH = LEFT + 3 * COL_W + TILE_W + 8;
const HEIGHT = rowY(11) + TILE_H + 12;

export function LineBoard({
  equips,
  now,
  selected,
  onSelect,
  abnormalOnly,
}: {
  equips: Record<string, LiveEquip>;
  now: number;
  selected: string | null;
  onSelect: (id: string) => void;
  abnormalOnly: boolean;
}) {
  // 화면 폭에 맞춰 축소 — 노트북 화면에서도 마지막 공정(스태킹)까지 한눈에
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([entry]) => {
      const w = entry.contentRect.width;
      setScale(w > 0 ? Math.max(0.62, Math.min(1, w / WIDTH)) : 1);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={box} className="overflow-x-auto">
      <div style={{ width: WIDTH * scale, height: HEIGHT * scale }}>
        <div className="relative origin-top-left" style={{ width: WIDTH, height: HEIGHT, transform: scale < 1 ? `scale(${scale})` : undefined }}>
          {/* 공정 머리글 */}
          {(Object.keys(COL) as ProcessKind[]).map((p) => {
            const n = EQUIPMENT.filter((e) => e.process === p).length;
            const down = EQUIPMENT.filter((e) => e.process === p && equips[e.id]?.status !== "RUN").length;
            return (
              <div key={p} className="absolute top-0 flex items-baseline gap-2 text-xs" style={{ left: LEFT + COL[p] * COL_W, width: TILE_W }}>
                <span className="font-semibold text-slate-200">{PROCESS_LABEL[p]}</span>
                <span className="text-slate-400">{n}대</span>
                {down > 0 && <span className="text-orange-300">비가동 {down}</span>}
              </div>
            );
          })}
          {/* 양극·음극 구분 */}
          <div className="absolute left-0 right-0 border-t border-dashed border-slate-800" style={{ top: rowY(6) - GROUP_GAP / 2 - 4 }} />
          <div className="absolute text-[10px] font-semibold tracking-widest text-slate-500" style={{ left: LEFT + 2, top: rowY(0) - 14 + 0 }} />
          <div
            className="absolute rounded bg-slate-900 px-1.5 text-[10px] text-slate-400"
            style={{ left: LEFT + COL_W - 30, top: rowY(6) - GROUP_GAP / 2 - 11 }}
          >
            ▲ 양극 · 음극 ▼
          </div>

          {/* 자재 흐름 선 */}
          <svg className="pointer-events-none absolute inset-0" width={WIDTH} height={HEIGHT}>
            {EQUIPMENT.flatMap((e) =>
              e.upstream.map((u) => {
                const a = POS.get(u)!;
                const b = POS.get(e.id)!;
                const x1 = a.x + TILE_W;
                const y1 = a.y + TILE_H / 2;
                const x2 = b.x;
                const y2 = b.y + TILE_H / 2;
                const mx = (x1 + x2) / 2;
                const running = equips[u]?.status === "RUN" && equips[e.id]?.status === "RUN";
                return (
                  <path
                    key={`${u}-${e.id}`}
                    d={`M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`}
                    fill="none"
                    strokeWidth={1.3}
                    className={running ? "flow stroke-emerald-600/50" : "stroke-slate-700"}
                  />
                );
              }),
            )}
          </svg>

          {/* 설비 타일 */}
          {EQUIPMENT.map((e) => {
            const s = equips[e.id];
            if (!s) return null;
            const p = POS.get(e.id)!;
            const t0 = statusTone(s.status, s.alarm?.level);
            // 평상(가동)은 무채색으로 낮추고 예외(알람·정지·대기)만 색으로 드러냄
            const tone = s.status === "RUN" ? { ...t0, bg: "bg-slate-800/50", ring: "ring-slate-700" } : t0;
            const dim = abnormalOnly && s.status === "RUN";
            const heavy = s.status === "ALARM" && s.alarm?.level === "중";
            return (
              <button
                key={e.id}
                onClick={() => onSelect(e.id)}
                title={`${e.name} · ${tone.label}${s.status === "RUN" ? ` · 가동 ${hms(s.since, now)}(시:분:초) · 생산 ${s.count.toLocaleString()}개` : ""}`}
                className={`absolute flex items-center gap-2 rounded-lg px-2 text-left ring-1 transition hover:brightness-125 ${tone.bg} ${tone.ring} ${
                  heavy ? "blink-heavy" : ""
                } ${selected === e.id ? "outline outline-2 outline-offset-2 outline-white" : ""} ${dim ? "opacity-35" : ""}`}
                style={{ left: p.x, top: p.y, width: TILE_W, height: TILE_H }}
              >
                <span className={`${tone.text} shrink-0`}>
                  <EquipIcon process={e.process} className="h-7 w-7" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="mono text-[13px] font-semibold text-slate-100">{e.id}</span>
                    {e.polarity && <span className="text-[10px] text-slate-400">{e.polarity}</span>}
                    <span className={`ml-auto h-2 w-2 shrink-0 rounded-full ${tone.dot}`} />
                  </span>
                  <span className={`block truncate text-[11px] ${s.status === "RUN" ? "text-slate-400" : tone.text}`}>
                    {s.status === "ALARM" && s.alarm
                      ? `${s.alarm.code} · ${elapsed(s.since, now)}`
                      : s.status === "RUN"
                        ? `가동 ${hms(s.since, now)}`
                        : `${s.reason} · ${elapsed(s.since, now)}`}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
