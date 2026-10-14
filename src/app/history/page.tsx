"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { ACTION_TYPES, ActionForm, emptyDraft, type Draft } from "@/components/ActionForm";
import { Btn, Card, HBars, Stat, inputCls } from "@/components/ui";
import { EQUIPMENT, EQUIPMENT_BY_ID, PROCESS_LABEL } from "@/data/equipment";
import { alarmStats, fmtDate, fmtMin, since } from "@/lib/analytics";
import { parseCsv, toCsv } from "@/lib/csv";
import { newLogId } from "@/lib/repo";
import { useData } from "@/lib/store";
import type { ActionLog, AuditEntry, ProcessKind } from "@/lib/types";

const FIELD_LABEL: Partial<Record<keyof ActionLog, string>> = {
  occurredAt: "시각",
  equipmentId: "설비",
  alarmCode: "알람",
  sourceDevice: "원천",
  cause: "원인",
  actionType: "조치 유형",
  action: "조치",
  result: "결과",
  durationMin: "시간",
  measured: "측정값",
  measuredUnit: "단위",
  worker: "작업자",
  note: "메모",
};

function changes(e: AuditEntry): string {
  if (e.op === "추가" || e.op === "복원") return `${e.after?.equipmentId} ${e.after?.alarmCode} · ${e.after?.action}`;
  if (e.op === "삭제") return `${e.before?.equipmentId} ${e.before?.alarmCode} · ${e.before?.action}`;
  if (e.op === "가져오기") return `CSV ${e.logId}`;
  if (!e.before || !e.after) return "";
  return (Object.keys(FIELD_LABEL) as (keyof ActionLog)[])
    .filter((k) => String(e.before![k]) !== String(e.after![k]))
    .map((k) => `${FIELD_LABEL[k]}: ${e.before![k] ?? ""} → ${e.after![k] ?? ""}`)
    .join(" · ");
}

function AuditView() {
  const data = useData();
  const ids = new Set(data.logs.map((l) => l.id));
  return (
    <Card
      title={`변경 기록 ${data.audit.length}건`}
      right={<span className="text-[11px] text-slate-400">고치거나 지워도 원본은 남습니다 (감사 추적)</span>}
      bodyClass="p-0"
    >
      <table className="w-full text-sm">
        <thead className="text-left text-[11px] text-slate-400">
          <tr className="border-b border-slate-800">
            <th className="px-3 py-1.5">시각</th>
            <th>변경</th>
            <th>기록 ID</th>
            <th>내용</th>
            <th className="pr-3" />
          </tr>
        </thead>
        <tbody>
          {data.audit.slice(0, 200).map((e) => (
            <tr key={e.id} className="border-b border-slate-800/60">
              <td className="mono px-3 py-1.5 text-slate-400">{fmtDate(e.at)}</td>
              <td className={e.op === "삭제" ? "text-red-300" : e.op === "수정" ? "text-amber-200" : "text-emerald-300"}>
                {e.op}
                {e.status && e.status !== "완료" && (
                  <span className={`ml-1 text-[10px] ${e.status === "실패" ? "text-red-400" : "text-slate-400"}`}>({e.status})</span>
                )}
              </td>
              <td className="mono text-xs text-slate-400">{e.logId}</td>
              <td className="text-slate-300">{changes(e)}</td>
              <td className="pr-3 text-right">
                {e.op === "삭제" && (e.status ?? "완료") === "완료" && e.before && !ids.has(e.before.id) && (
                  <Btn tone="ghost" className="text-xs" onClick={() => data.restoreLog(e)}>
                    복원
                  </Btn>
                )}
              </td>
            </tr>
          ))}
          {!data.audit.length && (
            <tr>
              <td colSpan={5} className="px-3 py-6 text-center text-slate-400">
                아직 변경이 없습니다. 기록을 추가하거나 고치거나 지우면 여기에 남습니다.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </Card>
  );
}

const PAGE = 40;
const CSV_COLS: (keyof ActionLog)[] = [
  "id",
  "occurredAt",
  "equipmentId",
  "alarmCode",
  "sourceDevice",
  "cause",
  "actionType",
  "action",
  "result",
  "durationMin",
  "measured",
  "measuredUnit",
  "worker",
  "note",
];

export default function HistoryPage() {
  return (
    <Suspense>
      <History />
    </Suspense>
  );
}

function History() {
  const data = useData();
  const sp = useSearchParams();
  const [days, setDays] = useState(90);
  const [process, setProcess] = useState<"" | ProcessKind>("");
  const [eq, setEq] = useState(sp.get("eq") ?? "");
  const [alarm, setAlarm] = useState(sp.get("alarm") ?? "");
  const [type, setType] = useState("");
  const [result, setResult] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(0);
  const [editing, setEditing] = useState<Draft | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [tab, setTab] = useState<"logs" | "audit">("logs");
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => setPage(0), [days, process, eq, alarm, type, result, q]);

  const alarmCodes = useMemo(() => Array.from(new Set(data.logs.map((l) => l.alarmCode))).sort(), [data.logs]);
  const filtered = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return since(data.logs, days).filter((l) => {
      const e = EQUIPMENT_BY_ID.get(l.equipmentId);
      if (process && e?.process !== process) return false;
      if (eq && l.equipmentId !== eq) return false;
      if (alarm && l.alarmCode !== alarm) return false;
      if (type && l.actionType !== type) return false;
      if (result && l.result !== result) return false;
      if (ql && ![l.cause, l.action, l.note, l.worker, l.sourceDevice, l.alarmCode, l.equipmentId].join(" ").toLowerCase().includes(ql)) return false;
      return true;
    });
  }, [data.logs, days, process, eq, alarm, type, result, q]);

  const downtime = filtered.reduce((s, l) => s + l.durationMin, 0);
  const resolved = filtered.filter((l) => l.result === "해결").length;
  const pareto = useMemo(() => alarmStats(filtered).slice(0, 8), [filtered]);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE));
  const rows = filtered.slice(page * PAGE, page * PAGE + PAGE);
  const alarmName = (code: string, eqId: string) => data.programOf(eqId)?.alarms.find((a) => a.code === code)?.name ?? "";

  function exportCsv() {
    const csv = "﻿" + toCsv(filtered as unknown as Record<string, unknown>[], CSV_COLS as string[]);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `조치이력_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function importCsv(file: File) {
    const rows = parseCsv(await file.text());
    const logs: ActionLog[] = rows
      .filter((r) => r.equipmentId && r.alarmCode)
      .map((r) => ({
        id: r.id || newLogId(),
        occurredAt: r.occurredAt ? new Date(r.occurredAt).toISOString() : new Date().toISOString(),
        equipmentId: r.equipmentId,
        alarmCode: r.alarmCode,
        sourceDevice: r.sourceDevice ?? "",
        cause: r.cause ?? "",
        actionType: (ACTION_TYPES.includes(r.actionType as never) ? r.actionType : "기타") as ActionLog["actionType"],
        action: r.action ?? "",
        result: r.result === "미해결" ? "미해결" : "해결",
        durationMin: Number(r.durationMin) || 0,
        measured: r.measured === "" || r.measured === undefined ? null : Number(r.measured),
        measuredUnit: r.measuredUnit ?? "",
        worker: r.worker ?? "",
        note: r.note ?? "",
      }));
    await data.importLogs(logs);
    setMsg(`${logs.length}건을 가져왔습니다. 개선 제안에도 바로 반영됩니다.`);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">조치이력 DB</h1>
        <span className="text-sm text-slate-400">
          {data.config.db === "supabase" ? "Supabase 테이블 action_logs" : "이 브라우저에 저장 (DB 키를 넣으면 Supabase로 전환)"} · 전체 {data.logs.length}건
        </span>
        <div className="ml-auto flex flex-wrap gap-2">
          <Btn tone="primary" onClick={() => setEditing(emptyDraft({ equipmentId: eq || "NT-02", alarmCode: alarm }))}>
            + 조치 기록
          </Btn>
          <Btn onClick={exportCsv}>CSV 내보내기</Btn>
          <Btn onClick={() => fileRef.current?.click()}>CSV 가져오기</Btn>
          <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => e.target.files?.[0] && importCsv(e.target.files[0])} />
          <Btn
            tone="ghost"
            disabled={data.config.db === "supabase"}
            title={data.config.db === "supabase" ? "공용 DB는 관리자가 supabase/seed.sql 로 초기화합니다" : "이 브라우저의 데이터를 시연용 처음 상태로 되돌립니다"}
            onClick={async () => {
              if (window.confirm("조치이력, 검토 결과, 올린 프로그램을 시연용 처음 데이터로 되돌릴까요?")) {
                await data.resetDemo();
                setMsg("시연용 처음 데이터로 되돌렸습니다.");
              }
            }}
          >
            시연 데이터 초기화
          </Btn>
        </div>
      </div>
      {msg && <div className="rounded-md bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">{msg}</div>}
      <div className="flex gap-1">
        {(
          [
            ["logs", `조치이력 ${data.logs.length}건`],
            ["audit", `변경 기록 ${data.audit.length}건`],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`rounded-md px-3 py-1.5 text-sm ${tab === id ? "bg-slate-800 text-white" : "text-slate-400 hover:text-slate-200"}`}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "audit" ? (
        <AuditView />
      ) : (
        <>
          <div className="grid gap-2 rounded-xl border border-slate-800 bg-slate-900/60 p-3 sm:grid-cols-3 lg:grid-cols-7">
            <select className={inputCls} value={days} onChange={(e) => setDays(Number(e.target.value))}>
              {[7, 30, 90, 365].map((d) => (
                <option key={d} value={d}>
                  최근 {d}일
                </option>
              ))}
            </select>
            <select className={inputCls} value={process} onChange={(e) => setProcess(e.target.value as "" | ProcessKind)}>
              <option value="">공정 전체</option>
              {(Object.keys(PROCESS_LABEL) as ProcessKind[]).map((p) => (
                <option key={p} value={p}>
                  {PROCESS_LABEL[p]}
                </option>
              ))}
            </select>
            <select className={inputCls} value={eq} onChange={(e) => setEq(e.target.value)}>
              <option value="">설비 전체</option>
              {EQUIPMENT.filter((e) => !process || e.process === process).map((e) => (
                <option key={e.id} value={e.id}>
                  {e.id}
                </option>
              ))}
            </select>
            <select className={inputCls} value={alarm} onChange={(e) => setAlarm(e.target.value)}>
              <option value="">알람 전체</option>
              {alarmCodes.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
            <select className={inputCls} value={type} onChange={(e) => setType(e.target.value)}>
              <option value="">조치 유형 전체</option>
              {ACTION_TYPES.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
            <select className={inputCls} value={result} onChange={(e) => setResult(e.target.value)}>
              <option value="">결과 전체</option>
              <option>해결</option>
              <option>미해결</option>
            </select>
            <input className={inputCls} placeholder="검색 (원인·조치·작업자)" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
            <Card bodyClass="p-0">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[860px] text-sm">
                  <thead className="text-left text-[11px] text-slate-400">
                    <tr className="border-b border-slate-800">
                      <th className="px-3 py-2">시각</th>
                      <th>설비</th>
                      <th>알람</th>
                      <th>원인</th>
                      <th>조치</th>
                      <th>결과</th>
                      <th className="text-right">시간</th>
                      <th className="text-right">측정값</th>
                      <th className="pr-3">작업자</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((l) => (
                      <tr key={l.id} onClick={() => setEditing(l)} className="cursor-pointer border-b border-slate-800/60 hover:bg-slate-800/50">
                        <td className="mono whitespace-nowrap px-3 py-1.5 text-slate-400">{fmtDate(l.occurredAt)}</td>
                        <td className="mono whitespace-nowrap">{l.equipmentId}</td>
                        <td>
                          <span className="mono">{l.alarmCode}</span> <span className="text-xs text-slate-400">{alarmName(l.alarmCode, l.equipmentId)}</span>
                        </td>
                        <td>{l.cause}</td>
                        <td className="text-slate-300">
                          <span className="mr-1 rounded bg-slate-800 px-1 text-[10px] text-slate-400">{l.actionType}</span>
                          {l.action}
                        </td>
                        <td className={`whitespace-nowrap px-1 ${l.result === "해결" ? "text-emerald-300" : "text-red-300"}`}>{l.result}</td>
                        <td className="whitespace-nowrap px-1 text-right tabular-nums text-slate-400">{l.durationMin}분</td>
                        <td className="whitespace-nowrap px-1 text-right tabular-nums text-slate-400">
                          {l.measured !== null ? `${l.measured}${l.measuredUnit}` : ""}
                        </td>
                        <td className="whitespace-nowrap px-3 text-slate-400">{l.worker}</td>
                      </tr>
                    ))}
                    {!rows.length && (
                      <tr>
                        <td colSpan={9} className="px-3 py-6 text-center text-slate-400">
                          조건에 맞는 기록이 없습니다.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              <div className="flex items-center gap-2 px-3 py-2 text-xs text-slate-400">
                <span>
                  {filtered.length}건 중 {filtered.length ? page * PAGE + 1 : 0}–{Math.min(filtered.length, page * PAGE + PAGE)}
                </span>
                <Btn tone="ghost" className="ml-auto" disabled={page === 0} onClick={() => setPage(page - 1)}>
                  이전
                </Btn>
                <span>
                  {page + 1}/{pages}
                </span>
                <Btn tone="ghost" disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>
                  다음
                </Btn>
              </div>
            </Card>

            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-2">
                <Stat label="건수" value={filtered.length} />
                <Stat label="기록된 조치 시간" value={fmtMin(downtime)} />
                <Stat label="평균 조치 시간(기록 기준)" value={filtered.length ? `${Math.round(downtime / filtered.length)}분` : "-"} />
                <Stat label="해결률" value={filtered.length ? `${Math.round((resolved / filtered.length) * 100)}%` : "-"} tone="text-emerald-300" />
              </div>
              <Card title="정지 시간 파레토 (알람별)">
                <HBars
                  items={pareto.map((p) => ({
                    label: (
                      <button className="mono hover:underline" onClick={() => setAlarm(p.alarmCode)}>
                        {p.alarmCode}
                      </button>
                    ),
                    value: Math.round(p.downtimeMin / 60),
                    sub: <span className="text-slate-400"> · {p.count}건</span>,
                  }))}
                  unit="시간"
                />
              </Card>
            </div>
          </div>
        </>
      )}

      {editing && (
        <div className="fixed inset-0 z-40 grid place-items-center bg-black/60 p-4" onClick={() => setEditing(null)}>
          <div className="w-full max-w-2xl rounded-xl border border-slate-700 bg-slate-900 p-4" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center gap-2">
              <h2 className="font-semibold">{editing.id ? "조치이력 수정" : "조치 기록 추가"}</h2>
              {editing.id && <span className="mono text-xs text-slate-400">{editing.id}</span>}
            </div>
            <ActionForm
              initial={editing}
              onCancel={() => setEditing(null)}
              onDelete={
                editing.id
                  ? async () => {
                      if (window.confirm("이 기록을 삭제할까요?")) {
                        await data.deleteLog(editing.id!);
                        setEditing(null);
                        setMsg("삭제했습니다.");
                      }
                    }
                  : undefined
              }
              onSave={async (d) => {
                if (d.id) await data.updateLog(d as ActionLog);
                else await data.addLog(d);
                setEditing(null);
                setMsg(d.id ? "수정했습니다." : "추가했습니다. 개선 제안에도 바로 반영됩니다.");
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
