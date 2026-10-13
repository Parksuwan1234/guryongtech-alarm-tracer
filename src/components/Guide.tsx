"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { GUIDE_STEPS, SIM_ALARM, USAGE_SLIDES } from "@/data/guide";
import { alreadyThere, offPage, stepAfterNavigate } from "@/lib/guideNav";
import { useLive, type Speed } from "@/lib/live";
import { useHelp } from "./Help";

/**
 * '▶ 시뮬레이션 시작' 안내와 첫 화면 '사용법' 팝업.
 * 시뮬레이션: 시연 장면으로 되돌리고 무작위 알람을 멈춘 뒤, 알람 하나를 일으켜 알림 → 알람 화면 → 흐름도 → 매뉴얼 → 기록 → 개선 제안까지
 * 화면 속 실제 요소를 노란 테두리로 짚으며 안내합니다. 화면 표시일 뿐 PLC에는 아무것도 하지 않습니다.
 */

const GuideCtx = createContext<{ active: boolean; ready: boolean; runId: number; start: () => void; stop: () => void; openUsage: () => void }>({
  active: false,
  ready: false,
  runId: 0,
  start: () => {},
  stop: () => {},
  openUsage: () => {},
});
export const useGuide = () => useContext(GuideCtx);

const USAGE_KEY = "at-usage-seen";

export function GuideProvider({ children }: { children: ReactNode }) {
  const live = useLive();
  const router = useRouter();
  const path = usePathname();
  const [active, setActive] = useState(false);
  const [i, setI] = useState(0);
  const [usage, setUsage] = useState(false);
  const [runId, setRunId] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startedAt = useRef(0);
  const speedBefore = useRef<Speed>("slow");
  // 화면을 떠날 때 예약해 둔 알람 발생을 취소
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  // 처음 온 브라우저에서만 사용법 팝업을 한 번 띄움
  useEffect(() => {
    try {
      if (window.localStorage.getItem(USAGE_KEY) !== "1") setUsage(true);
    } catch {
      setUsage(true);
    }
  }, []);
  const closeUsage = () => {
    setUsage(false);
    try {
      window.localStorage.setItem(USAGE_KEY, "1");
    } catch {
      /* 저장 불가 환경 — 이번 화면에서만 닫음 */
    }
  };

  const start = () => {
    // 설비 상태를 다 불러오기 전에는 시작하지 않음 (느린 첫 접속에서 알람이 사라지는 것 방지 — 버튼도 잠겨 있음)
    if (!live.ready) return;
    closeUsage();
    if (!active) speedBefore.current = live.speed;
    live.setSpeed("off");
    live.resetScene();
    setI(0);
    setActive(true);
    setRunId((x) => x + 1);
    startedAt.current = Date.now();
    prevPath.current = path;
    if (path !== "/") router.push("/");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => live.triggerAlarm(SIM_ALARM.equipmentId, SIM_ALARM.code), 1500);
  };
  const stop = () => {
    // 시작 버튼을 두 번 눌러 바로 꺼지는 것 방지
    if (Date.now() - startedAt.current < 1000) return;
    if (timer.current) clearTimeout(timer.current);
    setActive(false);
    live.setSpeed(speedBefore.current);
  };

  // 안내한 화면으로 이동하면 다음 단계로 — 주소가 실제로 바뀐 경우에만 (규칙은 lib/guideNav.ts)
  const iRef = useRef(i);
  iRef.current = i;
  const prevPath = useRef<string | null>(null);
  useEffect(() => {
    const before = prevPath.current;
    prevPath.current = path;
    if (!active) return;
    const next = stepAfterNavigate(GUIDE_STEPS, iRef.current, before, path);
    if (next !== iRef.current) setI(next);
  }, [path, active]);

  return (
    <GuideCtx.Provider value={{ active, ready: live.ready, runId, start, stop, openUsage: () => setUsage(true) }}>
      {children}
      {active && <GuideLayer i={i} setI={setI} stop={stop} />}
      {usage && <UsageDialog onClose={closeUsage} onStart={start} ready={live.ready} />}
    </GuideCtx.Provider>
  );
}

/** 헤더의 시뮬레이션 시작/끝내기 버튼 */
export function SimButton({ className = "" }: { className?: string }) {
  const { active, ready, start, stop } = useGuide();
  return active ? (
    <button
      onClick={stop}
      className={`whitespace-nowrap rounded-full border border-amber-400/60 px-3 py-0.5 font-semibold text-amber-200 hover:bg-amber-400/10 ${className}`}
    >
      ■ 체험 끝내기
    </button>
  ) : (
    <button
      onClick={start}
      disabled={!ready}
      title="알람 하나를 발생시켜, 알림 → 원인 확인 → 매뉴얼 → 조치 기록 → 개선 제안까지 화면을 짚으며 안내합니다"
      className={`whitespace-nowrap rounded-full bg-amber-400 px-3 py-0.5 font-semibold text-slate-950 hover:bg-amber-300 disabled:cursor-wait disabled:opacity-60 ${className}`}
    >
      {ready ? "▶ 시뮬레이션 시작" : "불러오는 중…"}
    </button>
  );
}

/** 헤더의 사용법 버튼 */
export function UsageButton() {
  const { openUsage } = useGuide();
  return (
    <button
      onClick={openUsage}
      className="flex items-center gap-1 whitespace-nowrap rounded-full border border-sky-500/50 px-2.5 py-0.5 text-sky-200 hover:bg-sky-600/10"
      title="알람이 발생하면 어떤 화면에서 무엇을 하는지 — 사용법"
    >
      <span className="grid h-4 w-4 place-items-center rounded-full bg-sky-500/30 text-[10px] font-bold">?</span>
      사용법
    </button>
  );
}

type Box = { left: number; top: number; width: number; height: number };

function GuideLayer({ i, setI, stop }: { i: number; setI: (n: number) => void; stop: () => void }) {
  const s = GUIDE_STEPS[i];
  const path = usePathname();
  const away = offPage(s, path);
  const [rect, setRect] = useState<Box | null>(null);
  const panel = useRef<HTMLDivElement>(null);

  // 짚을 요소를 찾아 테두리 위치를 따라감 (가려져 있으면 한 번 스크롤 — 위는 실제 헤더 높이, 아래는 안내 상자 높이만큼 비킴)
  useEffect(() => {
    if (away) {
      setRect(null);
      return;
    }
    let scrolled = false;
    const tick = () => {
      // 쉼표로 적은 후보 중 앞의 것부터 (예: 멈춘 단계 → 없으면 흐름도 전체)
      const el = s.target
        .split(",")
        .map((x) => document.querySelector(x.trim()) as HTMLElement | null)
        .find(Boolean) as HTMLElement | null;
      if (!el) {
        setRect(null);
        return;
      }
      const b = el.getBoundingClientRect();
      if (!scrolled) {
        scrolled = true;
        const headerBottom = document.querySelector("header")?.getBoundingClientRect().bottom ?? 64;
        const panelH = (panel.current?.offsetHeight ?? 190) + 24;
        const viewTop = headerBottom + 8;
        const viewBottom = window.innerHeight - panelH;
        const hidden = b.top < viewTop || b.bottom > viewBottom;
        const fixed = getComputedStyle(el.closest("[role=status]") ?? el).position === "fixed";
        if (hidden && !fixed) {
          const room = viewBottom - viewTop;
          const offset = b.height > room ? viewTop + 8 : viewTop + (room - b.height) / 2;
          window.scrollTo({ top: Math.max(0, window.scrollY + b.top - offset), behavior: "smooth" });
        }
      }
      const r = el.getBoundingClientRect();
      const next = { left: Math.round(r.left), top: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) };
      setRect((cur) =>
        cur && cur.left === next.left && cur.top === next.top && cur.width === next.width && cur.height === next.height ? cur : next,
      );
    };
    tick();
    const t = setInterval(tick, 200);
    return () => clearInterval(t);
  }, [s.target, away]);

  return (
    <>
      {rect && (
        <div
          aria-hidden
          className="no-print pointer-events-none fixed z-[55] animate-pulse rounded-xl border-2 border-amber-400 shadow-[0_0_0_6px_rgba(251,191,36,0.22)]"
          style={{ left: rect.left - 6, top: rect.top - 6, width: rect.width + 12, height: rect.height + 12 }}
        />
      )}
      <div
        ref={panel}
        role="dialog"
        aria-label="시뮬레이션 안내"
        className="no-print fixed bottom-4 left-4 z-[60] w-[min(440px,calc(100vw-2rem))] rounded-xl border border-amber-400 bg-slate-950/95 p-4 shadow-2xl"
      >
        <div className="flex items-center gap-2 text-xs">
          <span className="rounded-full bg-amber-400/20 px-2 py-0.5 font-semibold text-amber-200">
            시뮬레이션 체험 {i + 1}/{GUIDE_STEPS.length}
          </span>
          <span className="flex gap-1" aria-hidden>
            {GUIDE_STEPS.map((_, k) => (
              <span key={k} className={`h-1.5 w-4 rounded-full ${k <= i ? "bg-amber-400" : "bg-slate-700"}`} />
            ))}
          </span>
          <button onClick={stop} className="ml-auto rounded px-1.5 text-slate-400 hover:bg-slate-800 hover:text-slate-200" aria-label="체험 끝내기">
            끝내기 ✕
          </button>
        </div>
        <div className="mt-2 font-semibold text-slate-100">{s.title}</div>
        <p className="mt-1 text-sm leading-relaxed text-slate-300">{s.body}</p>
        {away && s.page && (
          <p className="mt-1 text-[11px] text-amber-200">
            다른 화면으로 왔습니다. 아래 &lsquo;{s.page.label.replace(" →", "")}&rsquo;를 누르면 이어서 볼 수 있습니다.
          </p>
        )}
        {!away && !rect && !s.action && <p className="mt-1 text-[11px] text-slate-400">짚을 곳을 찾는 중… 화면을 조금 내려 보세요.</p>}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {i > 0 && (
            <button onClick={() => setI(i - 1)} className="rounded-md px-2 py-1 text-sm text-slate-300 hover:bg-slate-800">
              ← 이전
            </button>
          )}
          {away && s.page && (
            <Link href={s.page.href} className="rounded-md border border-amber-400/70 px-2.5 py-1 text-sm text-amber-100 hover:bg-amber-400/10">
              {s.page.label}
            </Link>
          )}
          {s.action && !alreadyThere(s, path) && (
            <Link href={s.action.href} className="rounded-md border border-slate-600 px-2.5 py-1 text-sm text-slate-200 hover:bg-slate-800">
              {s.action.label}
            </Link>
          )}
          {(s.next || (!s.finish && alreadyThere(s, path))) && (
            <button onClick={() => setI(i + 1)} className="ml-auto rounded-md bg-amber-400 px-3 py-1 text-sm font-semibold text-slate-950 hover:bg-amber-300">
              다음 →
            </button>
          )}
          {s.finish && (
            <button onClick={stop} className="ml-auto rounded-md bg-amber-400 px-3 py-1 text-sm font-semibold text-slate-950 hover:bg-amber-300">
              체험 끝내기
            </button>
          )}
        </div>
      </div>
    </>
  );
}

function UsageDialog({ onClose, onStart, ready }: { onClose: () => void; onStart: () => void; ready: boolean }) {
  const [k, setK] = useState(0);
  const help = useHelp();
  const s = USAGE_SLIDES[k];
  const last = k === USAGE_SLIDES.length - 1;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") setK((x) => Math.min(x + 1, USAGE_SLIDES.length - 1));
      if (e.key === "ArrowLeft") setK((x) => Math.max(x - 1, 0));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="no-print fixed inset-0 z-[70] grid place-items-center bg-black/70 p-3" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="사용법"
        className="max-h-[94vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-slate-700 bg-[#0b1220] p-4 shadow-2xl sm:p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2">
          <h2 className="font-display text-lg font-semibold text-slate-100">사용법 — 알람이 발생하면 이렇게 씁니다</h2>
          <button onClick={onClose} className="ml-auto rounded px-2 py-1 text-sm text-slate-400 hover:bg-slate-800" aria-label="사용법 닫기">
            닫기 ✕
          </button>
        </div>
        <div className="mt-3 flex gap-1" role="tablist" aria-label="사용법 단계">
          {USAGE_SLIDES.map((x, n) => (
            <button
              key={x.title}
              role="tab"
              aria-selected={n === k}
              onClick={() => setK(n)}
              className={`h-1.5 flex-1 rounded-full ${n <= k ? "bg-sky-400" : "bg-slate-700"}`}
              aria-label={x.title}
            />
          ))}
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={s.img} alt={s.alt} className="mt-3 aspect-video w-full rounded-lg border border-slate-800 bg-black object-contain" />
        <h3 className="mt-3 text-base font-semibold text-slate-100">{s.title}</h3>
        <p className="mt-1 text-sm leading-relaxed text-slate-300">{s.body}</p>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            onClick={() => setK(Math.max(k - 1, 0))}
            disabled={k === 0}
            className="rounded-md px-2.5 py-1.5 text-sm text-slate-300 hover:bg-slate-800 disabled:opacity-30"
          >
            ← 이전
          </button>
          <span className="text-xs text-slate-400 tabular-nums">
            {k + 1} / {USAGE_SLIDES.length}
          </span>
          {!last && (
            <button onClick={() => setK(k + 1)} className="rounded-md border border-slate-600 px-3 py-1.5 text-sm text-slate-100 hover:bg-slate-800">
              다음 →
            </button>
          )}
          <button
            onClick={onStart}
            disabled={!ready}
            autoFocus
            className="ml-auto rounded-md bg-amber-400 px-3 py-1.5 text-sm font-semibold text-slate-950 hover:bg-amber-300 disabled:cursor-wait disabled:opacity-60"
          >
            {ready ? "▶ 시뮬레이션으로 직접 해 보기" : "불러오는 중…"}
          </button>
        </div>
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t border-slate-800 pt-3 text-xs text-slate-400">
          <Link href="/tour" onClick={onClose} className="text-sky-300 hover:underline">
            5분 체험 순서(바로가기 목록)
          </Link>
          <button
            onClick={() => {
              onClose();
              help.open("terms");
            }}
            className="text-sky-300 hover:underline"
          >
            용어 풀이
          </button>
          <button
            onClick={() => {
              onClose();
              help.open("color");
            }}
            className="text-sky-300 hover:underline"
          >
            색과 표시
          </button>
          <span className="ml-auto">모든 데이터는 시연용 가상 데이터 · 도구는 PLC에 쓰지 않음 · 다시 보려면 위쪽 &lsquo;사용법&rsquo;</span>
        </div>
      </div>
    </div>
  );
}

/** 실시간 현황 위쪽의 짧은 안내 — 닫으면 이 브라우저에서는 다시 안 보입니다. */
export function StartBanner() {
  const { openUsage } = useGuide();
  const [hidden, setHidden] = useState(true);
  useEffect(() => {
    try {
      setHidden(window.localStorage.getItem("at-guide-dismissed") === "1");
    } catch {
      setHidden(false);
    }
  }, []);
  if (hidden) return null;
  const dismiss = () => {
    setHidden(true);
    try {
      window.localStorage.setItem("at-guide-dismissed", "1");
    } catch {
      /* 이번 화면에서만 닫음 */
    }
  };
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-amber-400/40 bg-amber-400/10 px-4 py-2.5 text-sm">
      <b className="text-amber-200">처음 보시나요?</b>
      <span className="text-slate-300">
        위쪽 <b className="text-amber-200">▶ 시뮬레이션 시작</b>을 누르면 알람 하나가 발생하고, 알림 → 원인 확인 → 매뉴얼 → 조치 기록 → 개선 제안까지 화면을 짚으며
        안내합니다. 설치·로그인은 필요 없습니다.
      </span>
      <span className="ml-auto flex flex-wrap items-center gap-2">
        <SimButton />
        <button onClick={openUsage} className="whitespace-nowrap rounded-md border border-sky-500/50 px-2 py-0.5 text-sky-200 hover:bg-sky-600/10">
          사용법
        </button>
        <Link href="/tour" className="whitespace-nowrap rounded-md border border-sky-500/50 px-2 py-0.5 text-sky-200 hover:bg-sky-600/10">
          5분 체험 순서
        </Link>
        <button onClick={dismiss} className="whitespace-nowrap rounded-md px-2 py-0.5 text-slate-400 hover:bg-slate-800">
          닫기
        </button>
      </span>
    </div>
  );
}
