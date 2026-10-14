"use client";

import { useMemo, useState } from "react";
import { EQUIPMENT } from "@/data/equipment";
import { MANUALS } from "@/data/manuals";
import { ruleNormalize, type Normalized } from "@/lib/normalize";
import { useData } from "@/lib/store";
import type { ActionLog, ActionResult, ActionType } from "@/lib/types";
import { Btn, Field, inputCls } from "./ui";

export const ACTION_TYPES: ActionType[] = ["리셋", "부품 교체", "점검·조정", "청소", "보충", "파라미터 변경", "외부 확인", "기타"];

function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export type Draft = Omit<ActionLog, "id"> & { id?: string };

export function emptyDraft(partial: Partial<Draft> = {}): Draft {
  return {
    occurredAt: new Date().toISOString(),
    equipmentId: "NT-02",
    alarmCode: "",
    sourceDevice: "",
    cause: "",
    actionType: "점검·조정",
    action: "",
    result: "해결",
    durationMin: 10,
    measured: null,
    measuredUnit: "",
    worker: "",
    note: "",
    ...partial,
  };
}

export function ActionForm({
  initial,
  onSave,
  onCancel,
  onDelete,
  lockEquipment = false,
  submitLabel = "저장",
}: {
  initial: Draft;
  onSave: (d: Draft) => void | Promise<void>;
  onCancel?: () => void;
  onDelete?: () => void;
  lockEquipment?: boolean;
  submitLabel?: string;
}) {
  const data = useData();
  const [d, setD] = useState<Draft>(initial);
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));
  const prog = data.programOf(d.equipmentId);
  const causeOptions = useMemo(() => {
    const fromManual = MANUALS.filter((m) => m.programId === prog?.id && m.alarmCode === d.alarmCode).map((m) => m.cause);
    const fromLogs = data.logs.filter((l) => l.alarmCode === d.alarmCode).map((l) => l.cause);
    return Array.from(new Set([...fromManual, ...fromLogs])).filter(Boolean);
  }, [prog, d.alarmCode, data.logs]);
  const actionOptions = useMemo(() => {
    const fromManual = MANUALS.filter((m) => m.programId === prog?.id && m.alarmCode === d.alarmCode && (!d.cause || m.cause === d.cause)).flatMap(
      (m) => m.steps,
    );
    const fromLogs = data.logs.filter((l) => l.alarmCode === d.alarmCode && (!d.cause || l.cause === d.cause)).map((l) => l.action);
    return Array.from(new Set([...fromLogs, ...fromManual]))
      .filter(Boolean)
      .slice(0, 12);
  }, [prog, d.alarmCode, d.cause, data.logs]);
  // 자주 한 조치 — 눌러서 한 번에 채우기 (신입도 표준 표현으로 남기도록)
  const quick = useMemo(() => {
    const m = new Map<string, { action: string; actionType: ActionType; cause: string; n: number }>();
    for (const l of data.logs) {
      if (l.alarmCode !== d.alarmCode || !l.action) continue;
      const k = l.action;
      const cur = m.get(k) ?? { action: l.action, actionType: l.actionType, cause: l.cause, n: 0 };
      cur.n++;
      m.set(k, cur);
    }
    const list = Array.from(m.values())
      .sort((a, b) => b.n - a.n)
      .slice(0, 6);
    if (!list.some((q) => q.actionType === "리셋")) list.push({ action: "알람 리셋 후 재가동", actionType: "리셋", cause: "", n: 0 });
    return list;
  }, [data.logs, d.alarmCode]);
  const valid = d.equipmentId && d.alarmCode && d.action.trim() && d.worker.trim();
  const [memo, setMemo] = useState("");
  const [norm, setNorm] = useState<Normalized | null>(null);
  const [normBusy, setNormBusy] = useState(false);

  /** 자유 기록 → 표준 칸. AI가 있으면 선택지 안에서만 고르고, 없으면 키워드 규칙. 저장 전 사람이 확인 */
  async function organize() {
    if (!memo.trim()) return;
    setNormBusy(true);
    let r: Normalized = ruleNormalize(memo, causeOptions);
    try {
      const res = await fetch("/api/normalize", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: memo, causes: causeOptions }),
      });
      if (res.status === 200) {
        // 실험 기능(AI_NORMALIZE=true): AI도 정해진 선택지 안에서만, 결과는 똑같이 사람이 확인
        const ai = (await res.json()) as Partial<Normalized>;
        r = {
          ...r,
          actionType: ai.actionType ?? r.actionType,
          result: ai.result ?? r.result,
          causeCandidates: Array.from(new Set([...(ai.causeCandidates ?? []), ...r.causeCandidates])).slice(0, 3),
          notes: [...(ai.notes ?? []), ...r.notes],
          by: "AI",
        };
      }
    } catch {
      /* 규칙 결과 사용 */
    }
    setD((x) => ({
      ...x,
      actionType: r.actionType ?? x.actionType,
      action: r.action ?? x.action,
      result: r.result ?? x.result,
      measured: r.measured !== undefined ? r.measured : x.measured,
      measuredUnit: r.measuredUnit ?? x.measuredUnit,
      durationMin: r.durationMin ?? x.durationMin,
      note: `원문: ${memo.slice(0, 300)}${r.measured !== undefined && r.measured !== null ? " (측정값은 작업자 기재값)" : ""}`,
    }));
    setNorm(r);
    setNormBusy(false);
  }

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (!valid) return;
        setSaving(true);
        try {
          await onSave(d);
        } finally {
          setSaving(false);
        }
      }}
      className="grid grid-cols-2 gap-3"
    >
      <Field label="발생 시각">
        <input
          type="datetime-local"
          className={inputCls}
          value={toLocalInput(d.occurredAt)}
          onChange={(e) => e.target.value && set("occurredAt", new Date(e.target.value).toISOString())}
        />
      </Field>
      <Field label="설비">
        <select className={inputCls} value={d.equipmentId} disabled={lockEquipment} onChange={(e) => set("equipmentId", e.target.value)}>
          {EQUIPMENT.map((e) => (
            <option key={e.id} value={e.id}>
              {e.id} {e.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="알람">
        <select className={inputCls} value={d.alarmCode} disabled={lockEquipment} onChange={(e) => set("alarmCode", e.target.value)}>
          <option value="">선택</option>
          {prog?.alarms.map((a) => (
            <option key={a.code} value={a.code}>
              [{a.level}] {a.code} {a.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="원천 디바이스">
        <input
          className={`${inputCls} mono`}
          value={d.sourceDevice}
          onChange={(e) => set("sourceDevice", e.target.value.toUpperCase())}
          placeholder="예: X1A3"
        />
      </Field>
      <div className="col-span-2 rounded-lg border border-violet-500/30 bg-violet-500/5 p-2">
        <div className="mb-1 flex items-center gap-2 text-xs">
          <span className="font-semibold text-violet-200">현장 메모</span>
          <span className="text-slate-400">말하듯 적고 &lsquo;정리&rsquo;를 누르면 아래 칸이 채워집니다. 저장 전에 확인하세요.</span>
        </div>
        <div className="flex gap-2">
          <input
            className={inputCls}
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            placeholder="예: 앰프 팬 안 돌아서 팬 교체함, 40분 걸림, 온도 72도까지 올라갔었음, 지금 정상"
          />
          <Btn tone="default" className="shrink-0 whitespace-nowrap" onClick={organize} disabled={!memo.trim() || normBusy}>
            {normBusy ? "정리 중…" : "정리"}
          </Btn>
        </div>
        {norm && (
          <div className="mt-1 space-y-1 text-[11px] text-slate-400">
            <div>
              {norm.by === "AI" ? "AI(실험 기능)가 정해진 선택지 안에서 정리했습니다." : "키워드 규칙으로 정리했습니다."} 근거: {norm.notes.join(" / ") || "없음"}
            </div>
            {norm.causeCandidates.length > 0 && (
              <div className="flex flex-wrap items-center gap-1">
                <span>원인 후보(눌러서 선택):</span>
                {norm.causeCandidates.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => set("cause", c)}
                    className="rounded border border-slate-600 px-1.5 py-0.5 text-slate-200 hover:bg-slate-800"
                  >
                    {c}
                  </button>
                ))}
              </div>
            )}
            {norm.pending.length > 0 && <div className="text-amber-200">확인 필요: {norm.pending.join(", ")}</div>}
          </div>
        )}
      </div>
      {d.alarmCode && quick.length > 0 && (
        <div className="col-span-2">
          <div className="mb-1 text-[11px] text-slate-400">자주 한 조치 (눌러서 채우기)</div>
          <div className="flex flex-wrap gap-1.5">
            {quick.map((q) => (
              <button
                key={q.action}
                type="button"
                onClick={() => setD((x) => ({ ...x, action: q.action, actionType: q.actionType, cause: q.cause || x.cause }))}
                className={`rounded-full border px-2.5 py-1 text-xs hover:bg-slate-800 ${d.action === q.action ? "border-sky-400 bg-sky-500/10 text-sky-100" : "border-slate-600 text-slate-200"}`}
              >
                {q.action}
                <span className="ml-1 text-slate-400">{q.n ? `${q.n}회` : q.actionType}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      <Field label="원인" className="col-span-2">
        <input
          className={inputCls}
          list="cause-options"
          value={d.cause}
          onChange={(e) => set("cause", e.target.value)}
          placeholder="목록에서 고르거나 직접 입력"
        />
        <datalist id="cause-options">
          {causeOptions.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
      </Field>
      <Field label="조치 유형">
        <select className={inputCls} value={d.actionType} onChange={(e) => set("actionType", e.target.value as ActionType)}>
          {ACTION_TYPES.map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
      </Field>
      <Field label="결과">
        <div className="flex gap-2">
          {(["해결", "미해결"] as ActionResult[]).map((r) => (
            <button
              type="button"
              key={r}
              onClick={() => set("result", r)}
              className={`flex-1 rounded-md border px-2 py-1.5 text-sm ${
                d.result === r
                  ? r === "해결"
                    ? "border-emerald-500 bg-emerald-500/15 text-emerald-300"
                    : "border-red-500 bg-red-500/15 text-red-300"
                  : "border-slate-700 text-slate-400"
              }`}
            >
              {r}
            </button>
          ))}
        </div>
      </Field>
      <Field label="조치 내용" className="col-span-2">
        <input className={inputCls} list="action-options" value={d.action} onChange={(e) => set("action", e.target.value)} placeholder="예: 앰프 냉각팬 교체" />
        <datalist id="action-options">
          {actionOptions.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
      </Field>
      <Field label="조치 시간(분)">
        <input type="number" min={0} className={inputCls} value={d.durationMin} onChange={(e) => set("durationMin", Number(e.target.value))} />
      </Field>
      <Field label="측정값 (있으면: 신호 지속 시간, 응답 시간, 온도 등)">
        <div className="flex gap-1">
          <input
            type="number"
            step="any"
            className={inputCls}
            value={d.measured ?? ""}
            onChange={(e) => set("measured", e.target.value === "" ? null : Number(e.target.value))}
          />
          <select className={`${inputCls} w-24`} value={d.measuredUnit} onChange={(e) => set("measuredUnit", e.target.value)}>
            {["", "s", "℃", "N", "MPa", "kPa", "㎛"].map((u) => (
              <option key={u} value={u}>
                {u || "단위"}
              </option>
            ))}
          </select>
        </div>
      </Field>
      <Field label="작업자 (가명)">
        <input className={inputCls} value={d.worker} onChange={(e) => set("worker", e.target.value)} placeholder="예: 보전A" />
      </Field>
      <Field label="메모">
        <input className={inputCls} value={d.note} onChange={(e) => set("note", e.target.value)} />
      </Field>
      <div className="col-span-2 flex items-center gap-2 pt-1">
        <Btn type="submit" tone="primary" disabled={!valid || saving}>
          {saving ? "저장 중…" : submitLabel}
        </Btn>
        {onCancel && (
          <Btn tone="ghost" onClick={onCancel}>
            취소
          </Btn>
        )}
        {!valid && <span className="text-xs text-slate-400">설비, 알람, 조치 내용, 작업자는 꼭 적어 주세요</span>}
        {onDelete && (
          <Btn tone="danger" className="ml-auto" onClick={onDelete}>
            삭제
          </Btn>
        )}
      </div>
    </form>
  );
}
