"use client";

import { useEffect, useMemo, useState } from "react";
import { fmtDate } from "@/lib/analytics";
import { useData } from "@/lib/store";
import { WORK_STATUSES, type AlarmWork, type WorkStatus } from "@/lib/types";
import { OWNER_SUGGESTIONS, WORK_TONE, draftWork, dueOptions, openWorkFor } from "@/lib/work";
import { Btn, inputCls } from "./ui";

/**
 * 알람 대응 처리 상태 + 이 건의 경과.
 * 알람 상태(PLC)와 업무 처리 상태(사람)를 분리 — 알람이 꺼져도 원인이 남을 수 있고, 여기서 '종결'해도 PLC 알람은 리셋되지 않습니다.
 */
export function WorkPanel({
  equipmentId,
  alarmCode,
  startedAt,
  active,
  now,
  suggestOwner,
}: {
  equipmentId: string;
  alarmCode: string;
  startedAt: string;
  active: boolean;
  now: number;
  suggestOwner?: string;
}) {
  const data = useData();
  const current = openWorkFor(data.work, equipmentId, alarmCode);
  const base = current ?? { ...draftWork(equipmentId, alarmCode, startedAt), updatedAt: "", history: [] as AlarmWork["history"] };
  const [status, setStatus] = useState<WorkStatus>(base.status);
  const [owner, setOwner] = useState(base.owner);
  const [nextAction, setNextAction] = useState(base.nextAction);
  const [dueAt, setDueAt] = useState(base.dueAt);
  const [saved, setSaved] = useState<string | null>(null);

  useEffect(() => {
    setStatus(base.status);
    setOwner(base.owner);
    setNextAction(base.nextAction);
    setDueAt(base.dueAt);
  }, [base.id, base.updatedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  const dirty = status !== base.status || owner !== base.owner || nextAction !== base.nextAction || dueAt !== base.dueAt;
  const options = useMemo(() => dueOptions(now), [Math.floor(now / 60000)]); // eslint-disable-line react-hooks/exhaustive-deps

  // 이 건의 경과: 발생 → 처리 기록 → 조치이력 → (해제)
  const timeline = useMemo(() => {
    const t0 = base.startedAt || startedAt;
    const items: { at: string; label: string; tone: string }[] = [{ at: t0, label: "알람 발생 · 발생 순간 신호값 기록(스냅샷)", tone: "text-red-300" }];
    for (const h of base.history) items.push({ at: h.at, label: `처리 상태: ${h.note}`, tone: "text-sky-200" });
    for (const l of data.logs)
      if (l.equipmentId === equipmentId && l.alarmCode === alarmCode && l.occurredAt >= t0)
        items.push({
          at: l.occurredAt,
          label: `조치 기록: ${l.action || l.actionType} → ${l.result}`,
          tone: l.result === "해결" ? "text-emerald-300" : "text-amber-200",
        });
    if (!active) items.push({ at: "", label: "알람 해제됨(현재 발생 중 아님)", tone: "text-slate-400" });
    return items.sort((a, b) => (a.at && b.at ? a.at.localeCompare(b.at) : a.at ? -1 : 1));
  }, [base.startedAt, base.history, data.logs, equipmentId, alarmCode, startedAt, active]);

  async function save() {
    const w = await data.saveWork({ ...base, status, owner: owner.trim(), nextAction: nextAction.trim(), dueAt });
    setSaved(`저장했습니다 · ${w.status}${w.owner ? ` · 담당 ${w.owner}` : ""}`);
    setTimeout(() => setSaved(null), 2500);
  }

  return (
    <div className="rounded-xl border border-slate-700 bg-slate-900/60 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold">대응 상태</h2>
        <span className={`rounded-full border px-2 py-0.5 text-xs ${WORK_TONE[base.status]}`}>{current ? base.status : "미접수"}</span>
        {current?.owner && <span className="text-xs text-slate-300">담당 {current.owner}</span>}
        {current?.updatedAt && <span className="text-xs text-slate-400">· 마지막 갱신 {fmtDate(current.updatedAt)}</span>}
        <span className="ml-auto text-[11px] text-slate-400">대시보드의 업무 기록입니다 — PLC 알람 리셋·등급과는 별개</span>
      </div>
      <div className="mt-3 grid gap-3 lg:grid-cols-[auto_minmax(0,160px)_minmax(0,1fr)_minmax(0,190px)_auto] lg:items-end">
        <div>
          <div className="mb-1 text-[11px] text-slate-400">처리 단계</div>
          <div className="flex flex-wrap gap-1">
            {WORK_STATUSES.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setStatus(s)}
                className={`rounded-md border px-2 py-1 text-xs ${status === s ? `${WORK_TONE[s]} bg-slate-800` : "border-slate-700 text-slate-400 hover:text-slate-200"}`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
        <label className="block">
          <div className="mb-1 text-[11px] text-slate-400">담당</div>
          <input
            list="owner-suggest"
            value={owner}
            onChange={(e) => setOwner(e.target.value)}
            placeholder={suggestOwner || "예: 보전 B조"}
            className={inputCls}
          />
          <datalist id="owner-suggest">
            {[...(suggestOwner ? [suggestOwner] : []), ...OWNER_SUGGESTIONS].map((o) => (
              <option key={o} value={o} />
            ))}
          </datalist>
        </label>
        <label className="block">
          <div className="mb-1 text-[11px] text-slate-400">다음 확인 사항</div>
          <input
            value={nextAction}
            onChange={(e) => setNextAction(e.target.value)}
            placeholder="예: 냉각팬 교체 후 1시간 온도 추세 확인"
            className={inputCls}
          />
        </label>
        <label className="block">
          <div className="mb-1 text-[11px] text-slate-400">확인 예정</div>
          <select value={dueAt} onChange={(e) => setDueAt(e.target.value)} className={inputCls}>
            <option value="">미정</option>
            {dueAt && !options.some((o) => o.value === dueAt) && <option value={dueAt}>{fmtDate(dueAt)}</option>}
            {options.map((o) => (
              <option key={o.label} value={o.value}>
                {o.label} · {fmtDate(o.value)}
              </option>
            ))}
          </select>
        </label>
        <Btn tone={dirty ? "primary" : "ghost"} disabled={!dirty} onClick={save}>
          {saved ? "저장됨" : "상태 저장"}
        </Btn>
      </div>
      {saved && <div className="mt-2 text-xs text-emerald-300">{saved}</div>}
      <div className="mt-3 border-t border-slate-800 pt-3">
        <div className="mb-1 text-[11px] text-slate-400">이 건의 경과</div>
        <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
          {timeline.map((t, i) => (
            <li key={i} className="flex items-center gap-2">
              {i > 0 && <span className="text-slate-500">→</span>}
              <span className={t.tone}>
                {t.at && <span className="mono mr-1 text-slate-400">{fmtDate(t.at)}</span>}
                {t.label}
              </span>
            </li>
          ))}
        </ol>
        <div className="mt-1 text-[11px] text-slate-400">
          발생 전후 신호 파형: 미수집 — 실제 도입 시 PLC 게이트웨이(읽기 전용)가 신호 변화를 기록해야 볼 수 있습니다.
        </div>
      </div>
    </div>
  );
}
