"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { AlarmToast } from "@/components/AlarmToast";
import { GuideProvider, SimButton, UsageButton } from "@/components/Guide";
import { HelpProvider, ViewToggle } from "@/components/Help";
import { LiveProvider, useLive } from "@/lib/live";
import { DataProvider, useData } from "@/lib/store";
import { APP_VERSION } from "@/lib/version";

const NAV = [
  { href: "/", label: "실시간 현황" },
  { href: "/improve", label: "개선 제안" },
  { href: "/history", label: "조치이력 DB" },
  { href: "/report", label: "인수인계" },
  { href: "/plc", label: "PLC 프로그램" },
  { href: "/log", label: "로그 분석" },
];

function Header() {
  const path = usePathname();
  const data = useData();
  const live = useLive();
  const counts = Object.values(live.equips).reduce(
    (acc, e) => {
      if (e.status === "ALARM") acc[e.alarm?.level === "중" ? "heavy" : "light"]++;
      return acc;
    },
    { heavy: 0, light: 0 },
  );
  const pending = data.proposals.filter((p) => (data.reviews.get(p.id)?.status ?? "검토 대기") === "검토 대기").length;
  return (
    <header className="no-print sticky top-0 z-30 border-b border-slate-800 bg-[#070b14]/95 backdrop-blur">
      <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-x-6 gap-y-2 px-4 py-2.5">
        <Link href="/" className="flex items-center gap-2">
          <span className="grid h-7 w-7 place-items-center rounded-md bg-red-500/15 text-red-400">
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.2">
              <path d="M12 3 2 20h20L12 3z" />
              <path d="M12 10v4M12 17h.01" />
            </svg>
          </span>
          <span className="font-display font-semibold tracking-tight">알람 원인 추적</span>
          <span className="hidden text-xs text-slate-400 sm:inline">전극·조립 라인 · 31대</span>
        </Link>
        <nav className="flex flex-wrap gap-1">
          {NAV.map((n) => {
            const active = n.href === "/" ? path === "/" || path.startsWith("/alarm") || path.startsWith("/equipment") : path.startsWith(n.href);
            return (
              <Link
                key={n.href}
                data-guide={`nav-${n.href}`}
                href={n.href}
                className={`relative rounded-md px-3 py-1.5 text-sm transition ${active ? "bg-slate-800 text-white" : "text-slate-400 hover:bg-slate-900 hover:text-slate-200"}`}
              >
                {n.label}
                {n.href === "/" && counts.heavy + counts.light > 0 && (
                  <span className="ml-1.5 rounded bg-red-600 px-1.5 text-[11px] font-semibold text-white">{counts.heavy + counts.light}</span>
                )}
                {n.href === "/improve" && pending > 0 && (
                  <span className="ml-1.5 rounded bg-sky-500/80 px-1.5 text-[11px] font-semibold text-white">{pending}</span>
                )}
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto flex items-center gap-2 text-xs">
          <SimButton />
          <UsageButton />
          <ViewToggle />
          <span
            title={data.config.db === "supabase" ? "조치이력을 Supabase DB에 저장합니다" : "DB 키가 없어 이 브라우저에 저장합니다(공개 시연 모드)"}
            className={`hidden whitespace-nowrap rounded-full border px-2 py-0.5 sm:inline ${data.config.db === "supabase" ? "border-emerald-500/40 text-emerald-300" : "border-slate-700 text-slate-400"}`}
          >
            DB · {data.config.db === "supabase" ? "Supabase" : "브라우저 저장"}
          </span>
          <span
            title="AI는 래더 추적 결과를 쉬운 말로 풀어 주는 데만 씁니다"
            className={`hidden whitespace-nowrap rounded-full border px-2 py-0.5 sm:inline ${data.config.ai ? "border-violet-500/40 text-violet-300" : "border-slate-700 text-slate-400"}`}
          >
            AI 설명 · {data.config.ai ? "켜짐" : "규칙 문장"}
          </span>
        </div>
      </div>
      {data.error && <div className="bg-amber-500/10 px-4 py-1 text-center text-xs text-amber-300">{data.error}</div>}
    </header>
  );
}

function Gate({ children }: { children: ReactNode }) {
  const data = useData();
  const live = useLive();
  if (!data.ready || !live.ready) return <div className="grid min-h-[60vh] place-items-center text-sm text-slate-400">설비 상태와 조치이력을 불러오는 중…</div>;
  return <>{children}</>;
}

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <DataProvider>
      <LiveProvider>
        <HelpProvider>
          <GuideProvider>
          <Header />
          <AlarmToast />
          <main className="mx-auto max-w-[1600px] px-4 py-4">
            <Gate>{children}</Gate>
          </main>
          <footer className="no-print mx-auto max-w-[1600px] px-4 pb-6 pt-2 text-[11px] text-slate-400">
            모든 설비·래더·조치이력은 시연용 가상 데이터입니다. 래더 추적과 개선 제안은 코드가 계산하며(같은 입력 = 같은 결과), 이 도구는 PLC에 쓰지 않습니다. ·
            팀 구룡테크 · GEW KOREA 2026 기업가정신 챌린지 · {APP_VERSION}
          </footer>
          </GuideProvider>
        </HelpProvider>
      </LiveProvider>
    </DataProvider>
  );
}
