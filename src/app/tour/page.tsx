"use client";

import Link from "next/link";
import { useState } from "react";
import { TOUR } from "@/data/tour";
import { useLive } from "@/lib/live";
import { SimButton } from "@/components/Guide";
import { Btn, Card } from "@/components/ui";

/**
 * 심사위원·처음 보는 분용 5분 체험 순서.
 * 설치·로그인 없이 각 단계 버튼만 누르면 됩니다. 누르고 기록한 것은 이 브라우저에만 남습니다.
 */
export default function TourPage() {
  const live = useLive();
  const [fired, setFired] = useState(false);

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="rounded-xl border border-sky-500/40 bg-sky-500/10 p-4">
        <h1 className="font-display text-xl font-semibold text-slate-100">5분 체험 순서</h1>
        <p className="mt-1 text-sm leading-relaxed text-slate-300">
          설치나 로그인 없이 이 순서대로 버튼만 누르면 됩니다. 이 도구는 배터리 라인 설비에 알람이 뜨면 PLC 래더를 읽어{" "}
          <b className="text-slate-100">무엇이 알람을 켰는지</b>, <b className="text-slate-100">어느 단계에서 멈췄는지</b>를 그림으로 보여 줍니다. 쌓인
          기록으로는 <b className="text-slate-100">재발을 막을 방법</b>을 정리합니다.
        </p>
        <ul className="mt-2 list-disc space-y-0.5 pl-4 text-xs text-slate-400">
          <li>누르고 기록한 것은 이 브라우저에만 남고 다른 사람에게는 안 보입니다. 처음 상태로 돌리려면 실시간 현황에서 &lsquo;↺ 시연 장면&rsquo;을 누르세요.</li>
          <li>PC로 보는 게 편합니다(휴대폰에서도 열립니다). AI 설명은 꺼져 있어서 규칙으로 만든 문장이 나옵니다.</li>
        </ul>
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-400/40 bg-amber-400/10 p-4">
        <div className="min-w-0 flex-1 text-sm text-slate-300">
          <b className="block text-amber-200">가장 쉬운 방법</b>
          시뮬레이션을 시작하면 알람이 하나 뜹니다. 원인 확인부터 매뉴얼, 조치 기록, 개선 제안까지 화면을 노란 테두리로 짚어 가며 안내합니다.
        </div>
        <SimButton className="py-1 text-sm" />
      </div>
      <p className="text-xs text-slate-400">아니면 아래 순서대로 화면을 하나씩 열어 보세요.</p>

      <ol className="space-y-3">
        {TOUR.map((s, i) => (
          <li key={s.title}>
            <Card bodyClass="p-4">
              <div className="flex items-start gap-3">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-sky-700 font-bold text-white">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <h2 className="text-base font-semibold text-slate-100">{s.title}</h2>
                    <span className="text-xs text-slate-400">약 {s.time}</span>
                  </div>
                  <p className="mt-1 text-sm leading-relaxed text-slate-300">{s.what}</p>
                  <p className="mt-1 text-xs leading-relaxed text-slate-400">
                    <span className="text-sky-300">볼 곳:</span> {s.look}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {s.trigger ? (
                      <>
                        <Btn
                          tone="primary"
                          onClick={() => {
                            live.triggerAlarm(s.trigger!.equipmentId, s.trigger!.code);
                            setFired(true);
                          }}
                        >
                          알람 하나 일으키기
                        </Btn>
                        {fired && <span className="text-xs text-amber-200">오른쪽 위 알림을 보세요 ↗</span>}
                      </>
                    ) : (
                      <Link href={s.href!} className="rounded-md bg-sky-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-800">
                        화면 열기 →
                      </Link>
                    )}
                    {s.href && s.trigger === undefined && (
                      <span className="mono truncate text-[11px] text-slate-400">{s.href.split("#")[0]}</span>
                    )}
                  </div>
                </div>
              </div>
            </Card>
          </li>
        ))}
      </ol>

      <p className="text-xs text-slate-400">
        이 순서는 위쪽 &lsquo;사용법&rsquo;을 누르고 아래쪽 &lsquo;5분 체험 순서&rsquo;로 다시 열 수 있습니다. 점선 밑줄 단어를 누르면 쉬운 풀이가 나옵니다.
      </p>
    </div>
  );
}
