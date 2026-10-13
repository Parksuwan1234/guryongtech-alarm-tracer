"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useLive } from "@/lib/live";
import type { AlarmLevel } from "@/lib/types";
import { LevelBadge } from "./ui";

interface Toast {
  key: string;
  t: number;
  equipmentId: string;
  code: string;
  name: string;
  level: AlarmLevel;
}

const STAY_MS: Record<AlarmLevel, number> = { 중: 15000, 경: 9000 };
const MAX = 3;

/**
 * 새 알람이 나면 화면 오른쪽 위에 알림을 띄웁니다. 어느 화면을 보고 있어도 놓치지 않게.
 * 중알람은 더 오래 남고, '알람 열기'로 바로 상세 화면으로 갑니다. 알림은 화면 표시일 뿐 PLC에는 아무것도 하지 않습니다.
 */
export function AlarmToast() {
  const live = useLive();
  const seen = useRef<number>(0);
  const [toasts, setToasts] = useState<Toast[]>([]);

  // 처음 화면을 열 때 이미 있던 알람(시연 장면)은 알리지 않고, 그 뒤에 새로 난 것만
  useEffect(() => {
    if (!live.ready) return;
    if (!seen.current) {
      seen.current = live.events[0]?.t ?? Date.now();
      return;
    }
    const fresh = live.events.filter((e) => e.t > seen.current && e.kind === "ALARM");
    if (live.events[0]) seen.current = Math.max(seen.current, live.events[0].t);
    if (!fresh.length) return;
    const add: Toast[] = fresh
      .map((e) => {
        const m = e.text.match(/^(\S+) \[(중|경)\] (\S+) (.+)$/);
        if (!m) return null;
        return { key: `${e.t}-${m[1]}-${m[3]}`, t: e.t, equipmentId: m[1], level: m[2] as AlarmLevel, code: m[3], name: m[4] };
      })
      .filter((x): x is Toast => !!x);
    setToasts((cur) => [...add.reverse(), ...cur].slice(0, MAX));
  }, [live.events, live.ready]);

  // 시간이 지나면 저절로 닫힘 (중알람 15초, 경알람 9초)
  useEffect(() => {
    if (!toasts.length) return;
    const timer = setInterval(() => setToasts((cur) => cur.filter((x) => Date.now() - x.t < STAY_MS[x.level])), 1000);
    return () => clearInterval(timer);
  }, [toasts.length]);

  if (!toasts.length) return null;
  return (
    <div className="no-print pointer-events-none fixed right-4 top-16 z-50 flex w-[min(380px,calc(100vw-2rem))] flex-col gap-2" role="status" aria-live="polite">
      {toasts.map((x) => (
        <div
          key={x.key}
          className={`pointer-events-auto rounded-xl border bg-slate-950/95 p-3 shadow-xl ${x.level === "중" ? "border-red-500" : "border-orange-400"}`}
        >
          <div className="flex items-center gap-2 text-xs">
            <span className="font-semibold text-slate-100">새 알람</span>
            <LevelBadge level={x.level} />
            <span className="mono text-slate-300">{x.equipmentId}</span>
            <span className="ml-auto text-[11px] text-slate-400">{Math.max(0, Math.round((live.now - x.t) / 1000))}초 전</span>
            <button
              onClick={() => setToasts((cur) => cur.filter((y) => y.key !== x.key))}
              className="rounded px-1 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
              aria-label="알림 닫기"
            >
              ✕
            </button>
          </div>
          <div className="mt-1 text-sm text-slate-100">
            <span className="mono">{x.code}</span> {x.name}
          </div>
          <div className="mt-2 flex items-center gap-2">
            <Link
              href={`/alarm/${x.equipmentId}/${x.code}`}
              onClick={() => setToasts((cur) => cur.filter((y) => y.key !== x.key))}
              className="rounded-md bg-sky-700 px-2.5 py-1 text-xs font-semibold text-white hover:bg-sky-800"
            >
              알람 열기 → 켠 조건 보기
            </Link>
            <span className="text-[11px] text-slate-400">{x.level === "중" ? "15초 뒤 자동으로 닫힘" : "9초 뒤 자동으로 닫힘"}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
