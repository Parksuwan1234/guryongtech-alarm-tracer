"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { StartBanner } from "@/components/Guide";
import { Term } from "@/components/Help";
import { LineBoard } from "@/components/LineBoard";
import { WhyNotView } from "@/components/Trace";
import { Btn, Card, EquipIcon, LevelBadge, SourceBadge, Stat, StatusBadge, inputCls } from "@/components/ui";
import { EQUIPMENT, EQUIPMENT_BY_ID } from "@/data/equipment";
import { STOP_REASONS } from "@/data/programs";
import { REPEAT_THRESHOLD, fmtMin, repeatCount, since } from "@/lib/analytics";
import { traceAlarm, whyNot } from "@/lib/ladder";
import { elapsed, useLive, type Speed } from "@/lib/live";
import { useData } from "@/lib/store";
import { withWa } from "@/lib/ko";
import { WORK_TONE, openWorkFor } from "@/lib/work";

const SPEEDS: { id: Speed; label: string }[] = [
  { id: "off", label: "멈춤" },
  { id: "slow", label: "느리게" },
  { id: "normal", label: "보통" },
  { id: "fast", label: "빠르게" },
];

export default function Dashboard() {
  const live = useLive();
  const data = useData();
  const [selected, setSelected] = useState<string | null>("NT-02");
  const [abnormalOnly, setAbnormalOnly] = useState(false);

  const list = Object.values(live.equips);
  const count = (s: string) => list.filter((e) => e.status === s).length;
  const heavy = list.filter((e) => e.status === "ALARM" && e.alarm?.level === "중").length;
  const light = list.filter((e) => e.status === "ALARM" && e.alarm?.level === "경").length;
  const availability = (count("RUN") / list.length) * 100;
  const yearly = data.proposals.reduce((s, p) => s + p.effect.perYearMin, 0);
  const ladderCount = data.proposals.filter((p) => p.kind === "debounce" || p.kind === "timer").length;

  // 동시 다발: 외부 신호가 원천인 같은 알람이 여러 설비에서 동시에 → 공용 원인(유틸리티·MES) 의심
  const shared = useMemo(() => {
    const groups = new Map<string, { code: string; name: string; device: string; comment: string; checkWith: string; units: string[] }>();
    for (const e of list) {
      if (e.status !== "ALARM" || !e.alarm) continue;
      const prog = data.programOf(e.id);
      if (!prog) continue;
      const t = traceAlarm(prog, e.alarm.code, e.values);
      const ext = t?.culprits.find((c) => c.sourceKind === "외부 신호");
      if (!ext) continue;
      const key = `${e.alarm.code}|${ext.device}`;
      const g = groups.get(key) ?? { code: e.alarm.code, name: e.alarm.name, device: ext.device, comment: ext.comment, checkWith: ext.checkWith, units: [] };
      g.units.push(e.id);
      groups.set(key, g);
    }
    return Array.from(groups.values()).filter((g) => g.units.length >= 2);
  }, [list, data]);

  const abnormal = useMemo(
    () =>
      list
        .filter((e) => e.status !== "RUN")
        .sort((a, b) => {
          const rank = (e: (typeof list)[number]) => (e.status === "ALARM" ? (e.alarm?.level === "중" ? 0 : 1) : e.status === "STOP" ? 2 : 3);
          return rank(a) - rank(b) || a.since - b.since;
        }),
    [list],
  );

  const first = abnormal[0];
  const heavyIds = abnormal.filter((e) => e.status === "ALARM" && e.alarm?.level === "중").map((e) => e.id);
  const lightIds = abnormal.filter((e) => e.status === "ALARM" && e.alarm?.level === "경").map((e) => e.id);
  const focusIds = heavyIds.length ? heavyIds : lightIds.length ? lightIds : abnormal.filter((e) => e.status === "STOP").map((e) => e.id);
  const focusLabel = heavyIds.length ? "중알람" : lightIds.length ? "경알람" : "알람 없는 정지";

  return (
    <div className="space-y-4">
      <StartBanner />

      {/* 한 줄 상황 요약 — 처음 보는 사람도 '어디부터'를 바로 알도록 */}
      <div
        className={`flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border px-4 py-3 ${
          heavyIds.length
            ? "border-red-500/50 bg-red-500/10"
            : abnormal.length
              ? "border-orange-400/40 bg-orange-500/5"
              : "border-emerald-500/40 bg-emerald-500/5"
        }`}
      >
        <div className="text-base">
          {abnormal.length ? (
            <>
              가상 설비 <b>{list.length}대</b> 중 <b className={heavyIds.length ? "text-red-300" : "text-orange-300"}>{abnormal.length - count("IDLE")}대</b>가
              알람이거나 멈춰 있습니다.
              {count("IDLE") > 0 && <> {count("IDLE")}대는 자재나 작업 지시를 기다리는 중입니다.</>}{" "}
              {focusIds.length > 0 && (
                <>
                  <b>{focusLabel}</b> <span className="mono font-semibold">{focusIds.join(", ")}</span>부터 확인하세요.
                </>
              )}
            </>
          ) : (
            <>모든 설비가 정상 가동 중입니다.</>
          )}
        </div>
        {first?.status === "ALARM" && first.alarm && (
          <Link
            href={`/alarm/${first.id}/${first.alarm.code}`}
            title="정렬 기준: 등록된 알람 등급(중알람 먼저), 같은 등급이면 오래된 것 먼저"
            className="ml-auto rounded-md border border-sky-500/60 px-3 py-1.5 text-sm font-semibold text-sky-200 hover:bg-sky-600/10"
          >
            먼저 볼 알람 열기 ({first.id}) →
          </Link>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <Link href="#abnormal" className="col-span-2 block sm:col-span-1 lg:col-span-2">
          <div className={`h-full rounded-lg border px-3 py-2 ${heavy ? "border-red-500/60 bg-red-500/10" : "border-slate-800 bg-slate-900/60"}`}>
            <div className="text-[11px] text-slate-400">지금 조치 필요</div>
            <div className="flex flex-wrap items-baseline gap-x-3">
              <span className="text-xl font-semibold tabular-nums">
                <span className={heavy ? "text-red-400" : "text-slate-300"}>중알람 {heavy}</span>
              </span>
              <span className="text-xl font-semibold tabular-nums">
                <span className={light ? "text-orange-300" : "text-slate-300"}>경알람 {light}</span>
              </span>
              <span className="text-sm tabular-nums text-slate-300">정지 {count("STOP")}</span>
            </div>
            <div className="text-[11px] text-slate-400">대기 {count("IDLE")}대는 자재·지시 대기(설비 이상 아님)</div>
          </div>
        </Link>
        <Stat label="가동" value={`${count("RUN")}대`} sub={`가동률 ${availability.toFixed(0)}% (대수 기준)`} tone="text-emerald-300" />
        <Stat label="최근 90일 조치이력" value={`${since(data.logs, 90).length}건`} sub="DB 기준" />
        <Link href="/improve" className="col-span-2 block">
          <Stat
            label="재발 방지 개선 제안"
            value={`${data.proposals.length}건`}
            sub={`래더 수정 검토 ${ladderCount}건, 가상 이력 기준 연 ${Math.round(yearly / 60)}시간 정지 감소 예상`}
            tone="text-sky-300"
          />
        </Link>
      </div>

      {shared.map((g) => (
        <div key={g.code + g.device} className="flex flex-wrap items-center gap-2 rounded-xl border border-violet-500/50 bg-violet-500/10 px-4 py-2.5 text-sm">
          <span className="rounded bg-violet-600 px-2 py-0.5 text-xs font-bold text-white">동시 다발</span>
          <span>
            <b className="mono">{g.units.join(", ")}</b>에서 <span className="mono">{g.code}</span> {g.name}
          </span>
          <span className="text-slate-300">
            모두 같은 외부 신호(<span className="mono">{g.device}</span> {g.comment})로 켜진 알람입니다. 설비 {g.units.length}대가 각각 고장 났다기보다 공용
            원인일 가능성이 큽니다. 하나씩 리셋하기 전에 <b>{g.checkWith}</b>
            {withWa(g.checkWith).slice(g.checkWith.length)} 신호 상태를 같이 확인하세요.
          </span>
        </div>
      ))}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_400px]">
        <Card
          title="라인 레이아웃 · 실시간 상태"
          right={
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <label className="flex items-center gap-1 text-slate-400">
                <input type="checkbox" checked={abnormalOnly} onChange={(e) => setAbnormalOnly(e.target.checked)} />
                이상 설비만 강조
              </label>
              <span className="text-slate-500">|</span>
              <span className="text-slate-400" title="무작위로 알람을 띄우는 빠르기">무작위 알람</span>
              {SPEEDS.map((s) => (
                <button
                  key={s.id}
                  onClick={() => live.setSpeed(s.id)}
                  className={`rounded px-1.5 py-0.5 ${live.speed === s.id ? "bg-slate-700 text-white" : "text-slate-400 hover:text-slate-200"}`}
                >
                  {s.label}
                </button>
              ))}
              <button
                onClick={live.triggerShared}
                className="rounded px-1.5 py-0.5 text-violet-300 hover:text-violet-200"
                title="공용 냉각수 압력이 떨어져 롤프레스 3대에 함께 알람이 뜹니다"
              >
                ⚡ 공용 유틸리티 장애
              </button>
              <button
                onClick={live.resetScene}
                className="rounded px-1.5 py-0.5 text-slate-400 hover:text-slate-200"
                title="시연 장면(알람 4대, 정지 2대, 대기 1대)으로 되돌립니다"
              >
                ↺ 시연 장면
              </button>
            </div>
          }
        >
          <LineBoard equips={live.equips} now={live.now} selected={selected} onSelect={setSelected} abnormalOnly={abnormalOnly} />
          <div className="mt-3 flex flex-wrap gap-3 text-[11px] text-slate-400">
            <Legend dot="bg-emerald-400" label="가동" />
            <Legend dot="bg-blue-300" label="대기(자재·지시)" />
            <Legend dot="bg-slate-400" label="정지(알람 없음)" />
            <Legend dot="bg-orange-400" label="경알람" />
            <Legend dot="bg-red-500" label="중알람(깜빡임)" />
            <span className="text-slate-400">설비 칸 아래 숫자는 가동한 시간, 또는 멈춘 뒤 지난 시간입니다</span>
            <span className="text-slate-400">선: 자재 흐름(알람은 설비마다 따로 뜸)</span>
          </div>
        </Card>

        <div className="space-y-4">
          <Card
            title={`대응 목록 · ${abnormal.length}대`}
            right={
              <span className="text-[11px] text-slate-400" title="같은 등급이면 오래된 것부터">
                중알람, 경알람, 정지, 대기 순
              </span>
            }
            bodyClass="p-2"
          >
            <ul id="abnormal" className="max-h-[272px] space-y-1 overflow-y-auto">
              {abnormal.map((e) => (
                <li key={e.id}>
                  <button
                    onClick={() => setSelected(e.id)}
                    className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-slate-800 ${selected === e.id ? "bg-slate-800" : ""}`}
                  >
                    <StatusBadge status={e.status} level={e.alarm?.level} />
                    <span className="mono font-semibold">{e.id}</span>
                    <span className="min-w-0 flex-1 truncate text-slate-300">{e.alarm ? `${e.alarm.code} ${e.alarm.name}` : e.reason}</span>
                    {e.alarm && repeatCount(data.logs, e.id, e.alarm.code, 7, live.now) >= REPEAT_THRESHOLD && (
                      <span
                        title="최근 7일 같은 설비, 같은 알람의 조치 기록 수. 한 번 고장에 기록이 여러 건일 수 있어 반복 의심으로만 봅니다(등급과 별개)."
                        className="shrink-0 rounded bg-violet-500/20 px-1 text-[10px] text-violet-200"
                      >
                        7일 기록 {repeatCount(data.logs, e.id, e.alarm.code, 7, live.now)}건
                      </span>
                    )}
                    {e.alarm &&
                      (() => {
                        const w = openWorkFor(data.work, e.id, e.alarm.code);
                        return (
                          <span
                            title={w?.owner ? `담당 ${w.owner}${w.nextAction ? ` · 다음: ${w.nextAction}` : ""}` : "아직 아무도 맡지 않음"}
                            className={`shrink-0 rounded-full border px-1.5 text-[10px] ${WORK_TONE[w?.status ?? "미접수"]}`}
                          >
                            {w?.status ?? "미접수"}
                            {w?.owner ? ` · ${w.owner}` : ""}
                          </span>
                        );
                      })()}
                    <span className="shrink-0 text-xs tabular-nums text-slate-400">{elapsed(e.since, live.now)}</span>
                  </button>
                </li>
              ))}
              {!abnormal.length && <li className="px-2 py-3 text-sm text-slate-400">모든 설비가 가동 중입니다.</li>}
            </ul>
          </Card>
          {selected ? <EquipPanel id={selected} onClose={() => setSelected(null)} /> : null}
          <Card title="이벤트" bodyClass="p-2">
            <ul className="max-h-[180px] space-y-0.5 overflow-y-auto text-xs">
              {live.events.slice(0, 30).map((ev, i) => (
                <li key={i} className="flex gap-2 px-2 py-0.5">
                  <span className="mono shrink-0 text-slate-400">{new Date(ev.t).toLocaleTimeString("ko-KR", { hour12: false })}</span>
                  <span
                    className={
                      ev.kind === "ALARM" ? "text-red-300" : ev.kind === "RUN" ? "text-emerald-300" : ev.kind === "IDLE" ? "text-blue-200" : "text-slate-300"
                    }
                  >
                    {ev.text}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Legend({ dot, label }: { dot: string; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <span className={`h-2 w-2 rounded-full ${dot}`} />
      {label}
    </span>
  );
}

function EquipPanel({ id, onClose }: { id: string; onClose: () => void }) {
  const live = useLive();
  const data = useData();
  const e = EQUIPMENT_BY_ID.get(id)!;
  const s = live.equips[id];
  const prog = data.programOf(id);
  const [demoAlarm, setDemoAlarm] = useState("");
  const [demoStop, setDemoStop] = useState("");

  const trace = useMemo(() => (prog && s?.alarm ? traceAlarm(prog, s.alarm.code, s.values) : null), [prog, s?.alarm, s?.values]);
  const why = useMemo(() => (prog && s && (s.status === "STOP" || s.status === "IDLE") ? whyNot(prog, "M0", s.values) : null), [prog, s]);

  const recent = since(data.logs, 30).filter((l) => l.equipmentId === id);
  const byCode = Object.entries(recent.reduce<Record<string, number>>((acc, l) => ((acc[l.alarmCode] = (acc[l.alarmCode] ?? 0) + 1), acc), {})).sort(
    (a, b) => b[1] - a[1],
  );
  const props = data.proposals.filter((p) => p.appliesTo.includes(id)).slice(0, 3);

  if (!s || !prog) return null;
  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          <EquipIcon process={e.process} className="h-5 w-5 text-slate-400" />
          <span className="mono">{e.id}</span>
          <span className="font-normal text-slate-400">{e.name}</span>
        </span>
      }
      right={
        <button onClick={onClose} className="text-xs text-slate-400 hover:text-slate-300">
          닫기
        </button>
      }
    >
      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
        <StatusBadge status={s.status} level={s.alarm?.level} />
        <span>{elapsed(s.since, live.now)} 경과</span>
        <span className="text-slate-500">|</span>
        <Link href="/plc" className="mono hover:text-slate-200">
          {prog.id}
        </Link>
        <Link href={`/equipment/${id}`} className="ml-auto text-sky-300 hover:underline">
          설비 상세 →
        </Link>
      </div>

      {s.status === "ALARM" && s.alarm && trace && (
        <div className={`mt-3 rounded-lg border p-3 ${s.alarm.level === "중" ? "border-red-500/50 bg-red-500/10" : "border-orange-500/50 bg-orange-500/10"}`}>
          <div className="flex items-center gap-2">
            <LevelBadge level={s.alarm.level} />
            <span className="mono font-semibold">{s.alarm.code}</span>
            <span className="font-medium">{s.alarm.name}</span>
          </div>
          <div className="mt-2 text-sm text-slate-300">
            {trace.culprits.length ? (
              <>
                <Term k="알람 성립 원인">알람을 켠 조건</Term>:{" "}
                {trace.culprits.map((c) => (
                  <span key={c.device} className="mr-2 inline-flex items-center gap-1">
                    <span className="mono font-semibold text-fuchsia-200">{c.device}</span>
                    <span>{c.comment}</span>
                    <SourceBadge kind={c.sourceKind} />
                  </span>
                ))}
              </>
            ) : (
              <>
                <Term k="알람 성립 원인">알람을 켠 조건</Term>: 래더 내부 판정 <SourceBadge kind="래더 로직" />{" "}
                {trace.timersInPath[0] && (
                  <span className="text-slate-400">
                    (타이머 {trace.timersInPath[0].device} {trace.timersInPath[0].setValue})
                  </span>
                )}
              </>
            )}
          </div>
          <Link
            href={`/alarm/${id}/${s.alarm.code}`}
            className="mt-3 flex items-center justify-center rounded-md bg-sky-700 px-3 py-2 text-sm font-semibold text-white hover:bg-sky-800"
          >
            원인과 할 일 보기 →
          </Link>
        </div>
      )}

      {why && (
        <div className="mt-3 rounded-lg border border-amber-400/40 bg-amber-400/5 p-3">
          <div className="mb-2 text-xs font-semibold text-amber-200">알람 없이 {s.status === "IDLE" ? "대기" : "정지"}한 이유 (자동운전 조건 역추적)</div>
          <WhyNotView r={why} equipmentId={id} />
          <Btn tone="success" className="mt-3 w-full" onClick={() => live.recover(id, `${id} 조건 복구 후 가동 복귀`)}>
            조건 복구 확인 후 가동
          </Btn>
        </div>
      )}

      {s.status === "RUN" && (
        <div className="mt-3 rounded-lg bg-emerald-500/5 p-3 text-sm text-emerald-300">정상 가동 중, 누적 생산 {s.count.toLocaleString()}개</div>
      )}

      <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
        <div>
          <div className="mb-1 text-slate-400">최근 30일 알람 {recent.length}건</div>
          <ul className="space-y-0.5">
            {byCode.slice(0, 4).map(([code, n]) => (
              <li key={code} className="flex justify-between">
                <span className="mono">{code}</span>
                <span className="tabular-nums text-slate-400">{n}건</span>
              </li>
            ))}
            {!byCode.length && <li className="text-slate-400">없음</li>}
          </ul>
        </div>
        <div>
          <div className="mb-1 text-slate-400">정지 시간(30일)</div>
          <div className="text-lg font-semibold tabular-nums">{fmtMin(recent.reduce((a, l) => a + l.durationMin, 0))}</div>
        </div>
      </div>

      {props.length > 0 && (
        <div className="mt-4">
          <div className="mb-1 text-xs text-slate-400">이 설비에 해당하는 개선 제안</div>
          <ul className="space-y-1">
            {props.map((p) => (
              <li key={p.id}>
                <Link href={`/improve#${encodeURIComponent(p.id)}`} className="block rounded-md bg-slate-800/60 px-2 py-1.5 text-xs hover:bg-slate-800">
                  <span className="text-sky-300">{p.kind === "debounce" || p.kind === "timer" ? "래더 수정" : p.kind === "pm" ? "예방정비" : "제안"}</span> ·{" "}
                  {p.title}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      <details className="mt-4 text-xs">
        <summary className="cursor-pointer text-slate-400">시연 도구 (알람, 정지 일으키기)</summary>
        <div className="mt-2 grid grid-cols-[1fr_auto] gap-2">
          <select className={inputCls} value={demoAlarm} onChange={(ev) => setDemoAlarm(ev.target.value)}>
            <option value="">알람 선택</option>
            {prog.alarms.map((a) => (
              <option key={a.code} value={a.code}>
                [{a.level}] {a.code} {a.name}
              </option>
            ))}
          </select>
          <Btn onClick={() => demoAlarm && live.triggerAlarm(id, demoAlarm)}>발생</Btn>
          <select className={inputCls} value={demoStop} onChange={(ev) => setDemoStop(ev.target.value)}>
            <option value="">정지/대기 사유 선택</option>
            {STOP_REASONS.map((r) => (
              <option key={r.id} value={r.id}>
                {r.status === "IDLE" ? "대기" : "정지"} · {r.label}
              </option>
            ))}
          </select>
          <Btn onClick={() => demoStop && live.triggerStop(id, demoStop)}>적용</Btn>
          {s.status !== "RUN" && (
            <Btn tone="ghost" className="col-span-2" onClick={() => live.recover(id)}>
              가동으로 되돌리기
            </Btn>
          )}
        </div>
      </details>
      <div className="sr-only">{EQUIPMENT.length}</div>
    </Card>
  );
}
