"use client";

import Link from "next/link";

/** 화면에서 예상 못 한 오류가 나도 흰 화면 대신 돌아갈 길을 보여 줌 */
export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="grid min-h-[50vh] place-items-center text-center">
      <div className="space-y-3">
        <h1 className="text-xl font-semibold text-slate-100">이 화면을 그리는 중 문제가 생겼습니다</h1>
        <p className="text-sm text-slate-400">다시 시도하거나 처음 화면으로 돌아가세요. 저장한 기록은 그대로 남아 있습니다.</p>
        <div className="flex justify-center gap-2">
          <button onClick={reset} className="rounded-md border border-slate-600 px-3 py-1.5 text-sm text-slate-100 hover:bg-slate-800">
            다시 시도
          </button>
          <Link href="/" className="rounded-md bg-sky-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-800">
            실시간 현황으로 →
          </Link>
        </div>
      </div>
    </div>
  );
}
