"use client";

import Link from "next/link";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { GLOSSARY, GLOSSARY_MAP } from "@/data/glossary";

// ── 도움말 창 열기/닫기 (헤더 버튼, 첫 화면 안내, 용어 밑줄에서 공용) ──
type ViewMode = "simple" | "full";
const HelpCtx = createContext<{ open: (tab?: HelpTab) => void; mode: ViewMode; setMode: (m: ViewMode) => void }>({
  open: () => {},
  mode: "full",
  setMode: () => {},
});
type HelpTab = "start" | "color" | "terms";

export function HelpProvider({ children }: { children: ReactNode }) {
  const [tab, setTab] = useState<HelpTab | null>(null);
  // 보기 모드: 쉽게(전문가용 세부 숨김) / 전체 — 이 브라우저에만 기억
  const [mode, setModeState] = useState<ViewMode>("full");
  useEffect(() => {
    try {
      if (window.localStorage.getItem("at-view") === "simple") setModeState("simple");
    } catch {
      /* 저장 불가 환경 */
    }
  }, []);
  const setMode = (m: ViewMode) => {
    setModeState(m);
    try {
      window.localStorage.setItem("at-view", m);
    } catch {
      /* 이번 화면에서만 */
    }
  };
  useEffect(() => {
    if (!tab) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setTab(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tab]);
  return (
    <HelpCtx.Provider value={{ open: (t = "start") => setTab(t), mode, setMode }}>
      {children}
      {tab && <HelpDialog tab={tab} setTab={setTab} onClose={() => setTab(null)} />}
    </HelpCtx.Provider>
  );
}

export const useHelp = () => useContext(HelpCtx);

/** 헤더의 보기 모드 전환 — '쉽게'는 래더 표·변경 diff·분포 같은 전문가용 세부를 접습니다 */
export function ViewToggle() {
  const { mode, setMode } = useHelp();
  const [note, setNote] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pick = (m: ViewMode) => {
    setMode(m);
    // 화면이 다시 그려진 뒤 이 화면에서 접히거나 펼쳐진 전문가용 영역 수를 센다
    setTimeout(() => {
      const n = document.querySelectorAll("[data-expert]").length;
      setNote(
        m === "simple"
          ? `쉽게 보기 — 이 화면의 전문가용 세부 ${n}곳(래더 표·변경 전후 래더·측정값 분포·검증 분해 등)을 점선 상자로 접었습니다. 할 일·근거 요약·흐름도·숫자는 그대로입니다.`
          : `전체 보기 — 이 화면의 전문가용 세부 ${n}곳을 모두 펼쳤습니다. 결론과 숫자는 쉽게 보기와 같습니다.`,
      );
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setNote(null), 6000);
    }, 50);
  };
  return (
    <span className="relative">
      <span className="flex overflow-hidden rounded-full border border-slate-700" role="group" aria-label="보기 모드">
        {(["simple", "full"] as const).map((m) => (
          <button
            key={m}
            onClick={() => pick(m)}
            aria-pressed={mode === m}
            title={
              m === "simple"
                ? "쉽게 보기: 할 일·근거 요약·흐름도만. 래더 표·변경 전후 래더·측정값 분포·검증 분해표는 접기"
                : "전체 보기: 전문가용 세부까지 모두 펼치기 (결론과 숫자는 같음)"
            }
            className={`whitespace-nowrap px-2 py-0.5 ${mode === m ? "bg-slate-700 text-white" : "text-slate-400 hover:text-slate-200"}`}
          >
            {m === "simple" ? "쉽게" : "전체"}
            <span className="hidden lg:inline"> 보기</span>
          </button>
        ))}
      </span>
      {note && (
        <span
          role="status"
          className="absolute right-0 top-full z-50 mt-2 block w-80 rounded-lg border border-slate-700 bg-slate-950 p-2.5 text-left text-xs leading-relaxed text-slate-200 shadow-xl"
        >
          {note}
        </span>
      )}
    </span>
  );
}

/** 쉽게 보기에서 접히는 전문가용 영역 */
export function ExpertOnly({ children, label, when = true }: { children: ReactNode; label: string; when?: boolean }) {
  const { mode, setMode } = useHelp();
  if (!when) return <>{children}</>;
  if (mode === "full")
    return (
      <div data-expert>{children}</div>
    );
  return (
    <button
      type="button"
      data-expert
      onClick={() => setMode("full")}
      className="w-full rounded-lg border border-dashed border-slate-700 px-3 py-2 text-left text-xs text-slate-400 hover:text-slate-200"
    >
      전문가용 세부 · {label} — &lsquo;전체&rsquo; 보기에서 펼쳐집니다
    </button>
  );
}

export function HelpButton() {
  const { open } = useHelp();
  return (
    <button
      onClick={() => open("start")}
      className="flex items-center gap-1 whitespace-nowrap rounded-full border border-sky-500/50 px-2.5 py-0.5 text-sky-200 hover:bg-sky-600/10"
      title="처음 보는 분을 위한 사용법과 용어 풀이"
    >
      <span className="grid h-4 w-4 place-items-center rounded-full bg-sky-500/30 text-[10px] font-bold">?</span>
      처음 보는 분
    </button>
  );
}

/** 점선 밑줄 용어 — 눌러서(또는 마우스를 올려서) 쉬운 풀이를 봅니다. */
export function Term({ k, children }: { k: string; children?: ReactNode }) {
  const g = GLOSSARY_MAP.get(k);
  const [show, setShow] = useState(false);
  if (!g) return <>{children ?? k}</>;
  return (
    <span className="relative inline-block" onMouseEnter={() => setShow(true)} onMouseLeave={() => setShow(false)}>
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setShow((v) => !v);
        }}
        className="cursor-help underline decoration-slate-500 decoration-dotted underline-offset-4"
        aria-label={`${g.term}: ${g.plain}`}
      >
        {children ?? k}
      </button>
      {show && (
        <span
          role="tooltip"
          className="absolute left-0 top-full z-40 mt-1 block w-64 rounded-lg border border-slate-700 bg-slate-950 p-2.5 text-left text-xs font-normal leading-relaxed text-slate-200 shadow-xl"
        >
          <b className="text-sky-200">{g.term}</b> — {g.plain}
        </span>
      )}
    </span>
  );
}

function HelpDialog({ tab, setTab, onClose }: { tab: HelpTab; setTab: (t: HelpTab) => void; onClose: () => void }) {
  const TABS: { id: HelpTab; label: string }[] = [
    { id: "start", label: "화면별 사용법" },
    { id: "color", label: "색과 표시" },
    { id: "terms", label: "용어 풀이" },
  ];
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="도움말"
        className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-slate-700 bg-[#0b1220] p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold">이 화면은 이렇게 씁니다</h2>
          <button onClick={onClose} className="ml-auto rounded px-2 py-1 text-sm text-slate-400 hover:bg-slate-800" aria-label="닫기">
            닫기 ✕
          </button>
        </div>
        <p className="mt-1 text-sm text-slate-400">
          배터리 라인 설비 31대에서 알람이 발생하면, 설비를 움직이는 프로그램(PLC 래더)을 거꾸로 따라가 <b className="text-slate-200">무엇이 알람을 켰는지</b>와{" "}
          <b className="text-slate-200">먼저 할 일</b>을 보여 줍니다. 조치를 기록하면 쌓인 기록으로 <b className="text-slate-200">재발을 막는 방법</b>을
          제안합니다. 모든 데이터는 시연용 가상 데이터입니다.
        </p>
        <Link
          href="/tour"
          onClick={onClose}
          className="mt-3 flex items-center justify-between rounded-lg border border-sky-500/50 bg-sky-500/10 px-3 py-2 text-sm text-sky-100 hover:bg-sky-500/20"
        >
          <span>
            <b>5분 체험 순서</b> — 처음이면 이 순서대로 버튼만 누르세요 (설치·로그인 없음)
          </span>
          <span aria-hidden>→</span>
        </Link>
        <div className="mt-4 flex gap-1 border-b border-slate-800">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`-mb-px rounded-t-md border-b-2 px-3 py-1.5 text-sm ${tab === t.id ? "border-sky-400 text-white" : "border-transparent text-slate-400 hover:text-slate-200"}`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === "start" && (
          <ol className="mt-4 space-y-3">
            {[
              [
                "빨간·주황 칸을 누르세요",
                "실시간 현황에서 빨간 칸은 중알람(설비 멈춤), 주황 칸은 경알람(주의)입니다. 오른쪽 '대응 목록'은 급한 순서로 정렬돼 있고, 새 알람이 발생하면 오른쪽 위에 알림이 뜹니다.",
              ],
              [
                "알람 상세에서 먼저 할 일을 확인하세요",
                "'지금 할 일'에 안전 확인 → 먼저 볼 곳 → 과거에 해결된 조치가 순서대로 나옵니다. 아래 흐름도는 알람을 켠 조건(남이 짠 래더도)과, 순차 동작이면 멈춘 단계를 그림으로 보여 줍니다.",
              ],
              [
                "조치가 끝나면 기록하세요",
                "현장 메모를 말하듯 적고 '정리'를 누르면 표준 칸으로 나눠 줍니다. 저장 전에 사람이 확인합니다. 기록이 쌓일수록 '개선 제안'이 정확해집니다.",
              ],
            ].map(([t, d], i) => (
              <li key={t} className="flex gap-3 rounded-lg bg-slate-900/70 p-3">
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-sky-700 font-bold text-white">{i + 1}</span>
                <span>
                  <b>{t}</b>
                  <span className="mt-0.5 block text-sm text-slate-400">{d}</span>
                </span>
              </li>
            ))}
            <li className="rounded-lg border border-slate-800 p-3 text-sm text-slate-400">
              <b className="text-slate-200">쉽게 보기와 전체 보기</b> — 쉽게 보기는 할 일·근거 요약·흐름도만 보여 주고, 래더 표·변경 전후 래더·측정값 분포·검증
              분해표 같은 전문가용 세부는 점선 상자로 접어 둡니다(누르면 펼침). 전체 보기는 모두 펼칩니다. 결론과 숫자는 두 보기에서 같습니다.
            </li>
            <li className="rounded-lg border border-slate-800 p-3 text-sm text-slate-400">
              도구는 PLC에 아무것도 쓰지 않습니다. 래더를 바꾸자는 제안도 검토서로만 나오고, 안전·설비 보호·중알람은 래더 변경 제안에서 뺍니다. 효과 숫자는 모두
              과거 기록에 다시 계산한 <b className="text-slate-200">추정</b>입니다.
            </li>
          </ol>
        )}

        {tab === "color" && (
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {[
              ["bg-red-500", "중알람 (깜빡임)", "설비가 멈춘 심각한 알람 — 가장 먼저"],
              ["bg-orange-400", "경알람", "주의 알람 — 품질·속도 영향"],
              ["bg-slate-400", "정지(알람 없음)", "자동운전 조건이 막힘 — 설비 상세에서 막힌 조건 확인"],
              ["bg-blue-300", "대기", "자재·작업 지시 대기 — 설비 문제 아님"],
              ["bg-emerald-400", "가동", "정상"],
            ].map(([dot, label, desc]) => (
              <div key={label} className="flex items-start gap-2 rounded-lg bg-slate-900/70 p-3 text-sm">
                <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${dot}`} />
                <span>
                  <b>{label}</b>
                  <span className="block text-slate-400">{desc}</span>
                </span>
              </div>
            ))}
            <div className="rounded-lg bg-slate-900/70 p-3 text-sm sm:col-span-2">
              <b>원인 표시</b>
              <span className="mt-1 block text-slate-400">
                <span className="text-sky-300">현장 입력</span> = 우리 설비 센서·스위치 · <span className="text-violet-300">외부 신호</span> = 다른
                설비·유틸리티에서 온 신호 · <span className="text-teal-300">래더 로직</span> = 타이머·내부 조건에서 추적이 끝남
              </span>
            </div>
            <div className="rounded-lg bg-slate-900/70 p-3 text-sm sm:col-span-2">
              <b>점선 밑줄 단어</b>
              <span className="mt-1 block text-slate-400">누르면 쉬운 풀이가 나옵니다.</span>
            </div>
          </div>
        )}

        {tab === "terms" && (
          <div className="mt-4 space-y-4">
            {(["기본", "래더 추적", "개선 제안", "공정"] as const).map((grp) => (
              <div key={grp}>
                <div className="mb-1 text-xs font-semibold text-slate-400">{grp}</div>
                <dl className="divide-y divide-slate-800/70 rounded-lg bg-slate-900/70">
                  {GLOSSARY.filter((g) => g.group === grp).map((g) => (
                    <div key={g.term} className="grid grid-cols-[110px_1fr] gap-3 px-3 py-2 text-sm">
                      <dt className="font-semibold text-slate-100">{g.term}</dt>
                      <dd className="text-slate-400">{g.plain}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
