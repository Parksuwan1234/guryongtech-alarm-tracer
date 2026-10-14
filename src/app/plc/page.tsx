"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { SequenceFlow } from "@/components/Flow";
import { Btn, Card, Field, SourceBadge, inputCls } from "@/components/ui";
import { EQUIPMENT, PROCESS_LABEL } from "@/data/equipment";
import { buildRungs, parseProgram, traceAlarm, whereUsed } from "@/lib/ladder";
import { josa } from "@/lib/ko";
import { detectSequences } from "@/lib/sequence";
import { useData } from "@/lib/store";
import type { PlcProgram, ProcessKind } from "@/lib/types";

function download(name: string, text: string) {
  const blob = new Blob(["﻿" + text], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

function validate(p: PlcProgram) {
  const errors: string[] = [];
  const notes: string[] = [];
  let parsed;
  try {
    parsed = parseProgram(p);
  } catch (e) {
    return { errors: [`읽기 실패: ${e instanceof Error ? e.message : e}`], notes, parsed: null };
  }
  if (!parsed.rows.length) errors.push("래더 CSV에 행이 없습니다 (머리글: 스텝,명령,디바이스,설정값,코멘트)");
  if (!parsed.alarms.length) errors.push("알람표 CSV에 행이 없습니다 (머리글: 알람번호,디바이스,등급,알람명)");
  const rungs = buildRungs(parsed.rows);
  const outs = new Set(rungs.flatMap((r) => r.outputs.map((o) => o.device)));
  for (const a of parsed.alarms) {
    if (!outs.has(a.device)) errors.push(`${a.code}: 알람 디바이스 ${josa(a.device, "을")} 켜는 OUT/SET이 래더에 없습니다`);
    else {
      const t = traceAlarm(parsed, a.code);
      if (t && !t.leaves.length) notes.push(`${a.code}: 원천까지 따라갈 접점이 없습니다`);
    }
  }
  const seqs = detectSequences(parsed);
  if (seqs.length)
    notes.push(`순차 동작 ${seqs.length}개를 찾았습니다: ${seqs.map((q) => `${q.title}${q.alarms.length ? `(관련 알람 ${q.alarms.map((a) => a.code).join(", ")})` : ""}`).join(" / ")}`);
  const unsupported = parsed.rows.filter((r) => !/^(LDI|LD|ANI|AND|ORI|OR)(<=|>=|<>|=|<|>)?$/.test(r.instr) && !/^(OUT|SET|RST)$/.test(r.instr));
  if (unsupported.length)
    notes.push(
      `추적하지 않는 명령 ${unsupported.length}개: ${Array.from(new Set(unsupported.map((r) => r.instr)))
        .slice(0, 6)
        .join(", ")}. 이 명령이 들어간 회로는 추적이 덜 될 수 있습니다`,
    );
  const used = new Set(parsed.rows.map((r) => r.device));
  const noComment = Array.from(used).filter((d) => !parsed!.devices.has(d));
  if (noComment.length)
    notes.push(
      `코멘트 없는 디바이스 ${noComment.length}개: ${noComment.slice(0, 8).join(", ")}${noComment.length > 8 ? " …" : ""} (원천 구분은 X=현장 입력, B/W=외부 신호로 추정)`,
    );
  return { errors, notes, parsed };
}

export default function PlcPage() {
  const data = useData();
  const [view, setView] = useState(data.programs[0]?.id ?? "");
  const [q, setQ] = useState("");
  const [dev, setDev] = useState<string | null>(null);
  const [draft, setDraft] = useState<PlcProgram>({ id: "", name: "", ladderCsv: "", devicesCsv: "", alarmsCsv: "" });
  const [msg, setMsg] = useState<string | null>(null);

  // 체험 순서·자료에서 바로 열기: /plc?view=STACK_V1#sequence (처음 한 번만 — 저장 뒤에 다시 스크롤하지 않게)
  const deepLinked = useRef(false);
  useEffect(() => {
    if (deepLinked.current) return;
    try {
      const v = new URLSearchParams(window.location.search).get("view");
      if (v && data.parsed.has(v)) {
        deepLinked.current = true;
        setView(v);
        if (window.location.hash === "#sequence") setTimeout(() => document.getElementById("sequence")?.scrollIntoView({ block: "start" }), 150);
      }
    } catch {
      /* 주소를 못 읽으면 기본 프로그램 */
    }
  }, [data.parsed]);

  const prog = data.parsed.get(view);
  const check = useMemo(() => (draft.ladderCsv && draft.alarmsCsv ? validate(draft) : null), [draft]);
  const rows = useMemo(() => {
    if (!prog) return [];
    const ql = q.trim().toUpperCase();
    return prog.rows.filter(
      (r) => !ql || r.device.includes(ql) || r.instr.includes(ql) || (prog.devices.get(r.device)?.comment ?? r.comment).toUpperCase().includes(ql),
    );
  }, [prog, q]);
  const usage = useMemo(() => (prog && dev ? whereUsed(prog, dev) : []), [prog, dev]);
  const seqs = useMemo(() => (prog ? detectSequences(prog) : []), [prog]);
  const unitsOf = (id: string) =>
    Object.entries(data.assignment)
      .filter(([, p]) => p === id)
      .map(([e]) => e);

  async function readFile(f: File | undefined, key: "ladderCsv" | "devicesCsv" | "alarmsCsv") {
    if (!f) return;
    const text = await f.text();
    setDraft((d) => ({ ...d, [key]: text }));
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">PLC 프로그램 · 설비 연결</h1>
        <p className="mt-1 text-sm text-slate-400">
          프로그램(래더, 디바이스 코멘트, 알람표)과 설비를 따로 관리합니다. 같은 기종은 같은 프로그램을 쓰고, 개조한 설비만 다른 프로그램을 지정하면 됩니다.
          실제로 쓸 때는 PLC 툴에서 내보낸 CSV를 같은 형식으로 올립니다.
        </p>
        <p className="mt-1 text-xs text-slate-400">
          추적하는 명령: LD, LDI, AND, ANI, OR, ORI, 비교 접점(&gt;, &gt;=, &lt;, &lt;=, =, &lt;&gt;), OUT, SET, RST, 타이머(100ms), 순차 동작(단계 비트
          SET/RST 방식, 자기유지 방식). 블록 명령(ANB, ORB, MPS), 펑션 블록, 간접 지정은 아직 추적하지 않습니다. 이런 명령이 있으면 올릴 때 알려 줍니다.
          제조사마다 다른 내보내기 형식은 읽는 부분만 바꿔 붙이면 됩니다.
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {data.programs.map((p) => {
          const pp = data.parsed.get(p.id);
          return (
            <div key={p.id} className={`rounded-xl border p-3 ${view === p.id ? "border-sky-500 bg-sky-500/5" : "border-slate-800 bg-slate-900/60"}`}>
              <button className="w-full text-left" onClick={() => setView(p.id)}>
                <div className="mono font-semibold">{p.id}</div>
                <div className="text-sm text-slate-400">{p.name}</div>
                <div className="mt-1 text-xs text-slate-400">
                  {p.builtIn ? "기본" : `업로드 ${p.uploadedAt ? new Date(p.uploadedAt).toLocaleDateString("ko-KR") : ""}`} · 래더 {pp?.rows.length ?? 0}
                  행 · 알람 {pp?.alarms.length ?? 0}개 · 적용 {unitsOf(p.id).length}대
                </div>
              </button>
              <div className="mt-2 flex flex-wrap gap-1">
                <Btn tone="ghost" className="px-2 py-0.5 text-xs" onClick={() => download(`${p.id}_ladder.csv`, p.ladderCsv)}>
                  래더 CSV
                </Btn>
                <Btn tone="ghost" className="px-2 py-0.5 text-xs" onClick={() => download(`${p.id}_devices.csv`, p.devicesCsv)}>
                  코멘트 CSV
                </Btn>
                <Btn tone="ghost" className="px-2 py-0.5 text-xs" onClick={() => download(`${p.id}_alarms.csv`, p.alarmsCsv)}>
                  알람표 CSV
                </Btn>
                {!p.builtIn && (
                  <Btn tone="danger" className="px-2 py-0.5 text-xs" onClick={() => data.deleteProgram(p.id)}>
                    삭제
                  </Btn>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <Card
          title={
            <span>
              래더 보기 <span className="mono text-slate-400">{prog?.id}</span>
            </span>
          }
          right={<input className={`${inputCls} w-56`} placeholder="디바이스, 코멘트 검색 (예: T60)" value={q} onChange={(e) => setQ(e.target.value)} />}
          bodyClass="p-0"
        >
          <div className="grid lg:grid-cols-[minmax(0,1fr)_260px]">
            <div className="max-h-[560px] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-slate-900 text-left text-[11px] text-slate-400">
                  <tr>
                    <th className="px-3 py-1.5">스텝</th>
                    <th>명령</th>
                    <th>디바이스</th>
                    <th>설정값</th>
                    <th>코멘트</th>
                  </tr>
                </thead>
                <tbody className="mono">
                  {rows.map((r) => (
                    <tr
                      key={r.step}
                      onClick={() => setDev(r.device)}
                      className={`cursor-pointer border-t border-slate-800/60 hover:bg-slate-800/60 ${dev === r.device ? "bg-sky-500/10" : ""} ${/^(OUT|SET|RST)$/.test(r.instr) ? "text-sky-200" : "text-slate-300"}`}
                    >
                      <td className="px-3 py-1 text-slate-400">{r.step}</td>
                      <td>{r.instr}</td>
                      <td className="font-semibold">{r.device}</td>
                      <td>{r.setValue}</td>
                      <td className="font-sans text-slate-400">{prog?.devices.get(r.device)?.comment || r.comment}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="border-t border-slate-800 p-3 text-sm lg:border-l lg:border-t-0">
              {dev && prog ? (
                <div>
                  <div className="mono text-lg font-semibold">{dev}</div>
                  <div className="text-slate-300">{prog.devices.get(dev)?.comment ?? "코멘트 없음"}</div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    <SourceBadge kind={prog.devices.get(dev)?.sourceKind} />
                    {prog.devices.get(dev)?.role && (
                      <span className="rounded border border-slate-600 px-1 text-[10px] text-slate-400">
                        {prog.devices.get(dev)?.role === "reset" ? "리셋" : "운전 상태"}
                      </span>
                    )}
                  </div>
                  {prog.devices.get(dev)?.checkWith && <div className="mt-1 text-xs text-slate-400">확인처: {prog.devices.get(dev)?.checkWith}</div>}
                  {prog.devices.get(dev)?.where && <div className="mt-1 text-xs text-slate-300">현장 위치: {prog.devices.get(dev)?.where}</div>}
                  <div className="mt-3 text-xs text-slate-400">사용처 {usage.length}곳 (바꾸면 영향이 가는 곳)</div>
                  <ul className="mt-1 space-y-1">
                    {usage.map((u) => (
                      <li key={u.step + u.kind} className="rounded bg-slate-800/60 px-2 py-1 text-xs">
                        <span className="mono">스텝 {u.step}</span> · {u.kind} <span className="mono">{u.instr}</span>
                        {u.kind === "접점" && <span className="text-slate-400"> (출력 {u.outputDevices.join(", ")})</span>}
                      </li>
                    ))}
                  </ul>
                  {prog.alarms.some((a) => a.device === dev) && (
                    <div className="mt-2 text-xs text-red-300">
                      알람{" "}
                      {prog.alarms
                        .filter((a) => a.device === dev)
                        .map((a) => a.code)
                        .join(", ")}
                      의 코일입니다.
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-slate-400">행을 누르면 그 디바이스의 코멘트, 원천 구분, 사용처(교차 참조)가 나옵니다.</div>
              )}
            </div>
          </div>
        </Card>

        <div className="space-y-4">
          <Card title="설비별 프로그램 지정">
            <div className="space-y-3">
              {(Object.keys(PROCESS_LABEL) as ProcessKind[]).map((pk) => (
                <div key={pk}>
                  <div className="mb-1 text-xs text-slate-400">{PROCESS_LABEL[pk]}</div>
                  <div className="grid grid-cols-2 gap-1 sm:grid-cols-3">
                    {EQUIPMENT.filter((e) => e.process === pk).map((e) => (
                      <label key={e.id} className="flex items-center gap-1 text-xs">
                        <span className="mono w-12 shrink-0 whitespace-nowrap text-slate-300">{e.id}</span>
                        <select
                          className={`${inputCls} px-1 py-0.5 text-xs ${data.assignment[e.id] !== e.programId ? "border-amber-400/60 text-amber-200" : ""}`}
                          value={data.assignment[e.id]}
                          onChange={(ev) => data.setAssignment(e.id, ev.target.value)}
                        >
                          {data.programs.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.id}
                            </option>
                          ))}
                        </select>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <p className="mt-2 text-[11px] text-slate-400">
              노란 칸은 기본과 다른 프로그램을 쓰는 설비입니다(개조 설비 등). 바꾸면 래더 추적과 개선 제안을 바로 다시 계산합니다.
            </p>
          </Card>

          <Card title="프로그램 올리기 (CSV 3개)">
            <div className="grid grid-cols-2 gap-2">
              <Field label="프로그램 ID">
                <input
                  className={`${inputCls} mono`}
                  placeholder="STACK_V1_ST01"
                  value={draft.id}
                  onChange={(e) => setDraft({ ...draft, id: e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, "") })}
                />
              </Field>
              <Field label="이름">
                <input
                  className={inputCls}
                  placeholder="스태킹 1호 개조 프로그램"
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                />
              </Field>
              <Field label="래더 (스텝,명령,디바이스,설정값,코멘트)">
                <input type="file" accept=".csv" className="text-xs" onChange={(e) => readFile(e.target.files?.[0], "ladderCsv")} />
              </Field>
              <Field label="디바이스 코멘트 (디바이스,코멘트,원천구분,평상값,역할,확인처,위치)">
                <input type="file" accept=".csv" className="text-xs" onChange={(e) => readFile(e.target.files?.[0], "devicesCsv")} />
              </Field>
              <Field label="알람표 (알람번호,디바이스,등급,알람명)">
                <input type="file" accept=".csv" className="text-xs" onChange={(e) => readFile(e.target.files?.[0], "alarmsCsv")} />
              </Field>
              <div className="flex items-end">
                <Btn
                  tone="ghost"
                  className="text-xs"
                  onClick={() => {
                    const base = data.programs.find((p) => p.id === "STACK_V1")!;
                    setDraft({
                      id: "STACK_V1_ST01",
                      name: "스태킹 1호 개조 프로그램(예시: 표준 프로그램 사본)",
                      ladderCsv: base.ladderCsv,
                      devicesCsv: base.devicesCsv,
                      alarmsCsv: base.alarmsCsv,
                    });
                  }}
                >
                  예시 채우기
                </Btn>
              </div>
            </div>
            {check && (
              <div className="mt-3 space-y-1 text-xs">
                {check.parsed && (
                  <div className="text-slate-300">
                    읽음: 래더 {check.parsed.rows.length}행 · 코멘트 {check.parsed.devices.size}개 · 알람 {check.parsed.alarms.length}개
                  </div>
                )}
                {check.errors.map((e) => (
                  <div key={e} className="text-red-300">
                    ✗ {e}
                  </div>
                ))}
                {check.notes.map((e) => (
                  <div key={e} className="text-amber-200">
                    ! {e}
                  </div>
                ))}
                {!check.errors.length && <div className="text-emerald-300">✓ 모든 알람이 래더에서 원천까지 추적됩니다.</div>}
              </div>
            )}
            <div className="mt-3 flex items-center gap-2">
              <Btn
                tone="primary"
                disabled={
                  !draft.id || !draft.ladderCsv || !draft.alarmsCsv || !!check?.errors.length || data.programs.some((p) => p.builtIn && p.id === draft.id)
                }
                onClick={async () => {
                  await data.saveProgram(draft);
                  setMsg(`${josa(draft.id, "을")} 저장했습니다. 위 '설비별 프로그램 지정'에서 적용할 설비를 고르세요.`);
                  setView(draft.id);
                  setDraft({ id: "", name: "", ladderCsv: "", devicesCsv: "", alarmsCsv: "" });
                }}
              >
                저장
              </Btn>
              {msg && <span className="text-xs text-emerald-300">{msg}</span>}
            </div>
          </Card>
        </div>
      </div>

      <Card
        id="sequence"
        title={
          <span>
            순차 동작(시퀀스) 흐름도 <span className="mono text-slate-400">{prog?.id}</span>
          </span>
        }
        right={<span className="text-[11px] text-slate-400">래더에서 단계 비트를 찾아 순서대로 그립니다. 남이 짠 래더도 똑같이 읽습니다.</span>}
      >
        {seqs.length === 0 ? (
          <div className="text-sm text-slate-400">
            <p>이 프로그램에서는 순차 단계를 찾지 못했습니다. 지금은 아래 두 방식만 읽고, 3단계 이상 이어진 것만 봅니다.</p>
            <ol className="mt-1 list-decimal pl-5">
              <li>단계 비트 SET/RST: LD 지금 단계, AND 조건, SET 다음 단계, RST 지금 단계</li>
              <li>자기유지 단계: LD 앞 단계, AND 조건, OR 자기, ANI 다음 단계, OUT 자기</li>
            </ol>
            <p className="mt-1">스텝 레지스터(MOV) 방식과 STL 방식은 아직 못 읽습니다. 나중에 넣을 계획입니다.</p>
          </div>
        ) : (
          <div className="space-y-6">
            {seqs.map((q) => (
              <div key={q.id}>
                <div className="mb-2 text-sm text-slate-300">
                  <span className="font-semibold text-slate-100">{q.title}</span>
                  <span className="ml-2 text-slate-400">단계를 누르면 위 래더 표에서 그 디바이스를 찾습니다.</span>
                </div>
                <SequenceFlow seq={q} />
                <div className="mt-2 flex flex-wrap gap-1">
                  {q.steps.map((st) => (
                    <button
                      key={st.device}
                      onClick={() => {
                        setQ(st.device);
                        setDev(st.device);
                      }}
                      className="mono rounded border border-slate-700 px-1.5 py-0.5 text-[11px] text-slate-300 hover:bg-slate-800"
                    >
                      {st.device}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
