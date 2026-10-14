"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ActionForm, emptyDraft } from "@/components/ActionForm";
import { AlarmFlow, SequenceFlow } from "@/components/Flow";
import { TraceTree } from "@/components/Trace";
import { ExpertOnly, Term } from "@/components/Help";
import { WorkPanel } from "@/components/WorkPanel";
import { Btn, Card, EvidenceTag, HBars, LevelBadge, ProtectBadge, SOURCE_META, SourceBadge, StatusBadge, copyText } from "@/components/ui";
import { EQUIPMENT_BY_ID, PROCESS_LABEL } from "@/data/equipment";
import { manualsFor } from "@/data/manuals";
import { ALARM_SCENARIO_VALUES, RUN_VALUES } from "@/data/programs";
import { REPEAT_THRESHOLD, causeStats, fleetSpread, fmtDate, repeatCount, since } from "@/lib/analytics";
import { explainLines, ruleExplain } from "@/lib/explain";
import { buildRungs, formatRow, programRev, traceAlarm } from "@/lib/ladder";
import { elapsed, useLive } from "@/lib/live";
import { KIND_LABEL } from "@/lib/propose";
import { detectSequences, sequencePosition, sequencesForAlarm } from "@/lib/sequence";
import { useData } from "@/lib/store";
import { josa, withWa } from "@/lib/ko";
import { draftWork, openWorkFor, statusAfterLog } from "@/lib/work";

export default function AlarmDetail() {
  const params = useParams<{ eq: string; code: string }>();
  const eqId = decodeURIComponent(params.eq);
  const code = decodeURIComponent(params.code);
  const router = useRouter();
  const data = useData();
  const live = useLive();
  const eq = EQUIPMENT_BY_ID.get(eqId);
  const prog = data.programOf(eqId);
  const state = live.equips[eqId];
  const active = state?.alarm?.code === code;
  const values = useMemo(() => (active ? state!.values : { ...RUN_VALUES, ...(ALARM_SCENARIO_VALUES[code] ?? {}) }), [active, state, code]);
  const trace = useMemo(() => (prog ? traceAlarm(prog, code, values) : null), [prog, code, values]);
  // 순차 동작(시퀀스)을 거쳐 켜지는 알람이면, 알람 순간 어느 단계에서 무엇을 기다렸는지
  const seqs = useMemo(() => (prog ? sequencesForAlarm(detectSequences(prog), code) : []), [prog, code]);
  const seqPos = useMemo(() => (prog ? seqs.map((s) => ({ seq: s, pos: sequencePosition(prog, s, values) })) : []), [prog, seqs, values]);
  const [traceView, setTraceView] = useState<"flow" | "list">("flow");

  const units = useMemo(
    () =>
      Object.entries(data.assignment)
        .filter(([, p]) => p === prog?.id)
        .map(([e]) => e)
        .sort(),
    [data.assignment, prog],
  );
  const recent = useMemo(() => since(data.logs, 90), [data.logs]);
  const alarmLogs = useMemo(() => recent.filter((l) => l.alarmCode === code && units.includes(l.equipmentId)), [recent, code, units]);
  const causes = useMemo(() => causeStats(alarmLogs), [alarmLogs]);
  const spread = useMemo(() => fleetSpread(recent, code, units), [recent, code, units]);
  const thisUnit = alarmLogs.filter((l) => l.equipmentId === eqId);
  const related = data.proposals.filter((p) => p.alarmCode === code && p.programId === prog?.id);

  const sourceDevices = trace?.culprits.length ? trace.culprits.map((c) => c.device) : (trace?.leaves.map((l) => l.device) ?? []);
  const manuals = useMemo(() => {
    if (!prog) return [];
    const list = sourceDevices.flatMap((d) => manualsFor(prog.id, code, d));
    return Array.from(new Map(list.map((m) => [m.id, m])).values());
  }, [prog, code, sourceDevices.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  const spreadText =
    spread.verdict === "single"
      ? `${units.length}대 중 ${spread.top.unit}에 ${spread.top.count}/${spread.total}건이 몰려 있습니다. 이 설비만의 문제일 수 있습니다`
      : spread.verdict === "common"
        ? `${units.length}대 중 ${spread.affected}대에서 났습니다. 래더나 레시피 같은 공통 문제일 수 있습니다`
        : spread.total
          ? `${units.length}대 중 ${spread.affected}대에서 ${spread.total}건`
          : "";

  const [manualIdx, setManualIdx] = useState(0);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [safety, setSafety] = useState(false);
  const [ai, setAi] = useState<{ text: string; model?: string; masked?: number } | null>(null);
  const [aiState, setAiState] = useState<"idle" | "loading" | "none">("idle");
  const [saved, setSaved] = useState<string | null>(null);
  // 방금 저장한 조치 — 저장 후 인수인계 메모에 반영 (설비가 가동으로 바뀌어도 발생 시각·조치가 남도록)
  const [savedLog, setSavedLog] = useState<{ occurredAt: string; action: string; result: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const rule = trace ? ruleExplain(trace, manuals, causes, spreadText, related) : "";
  const lines = trace && eq ? explainLines(eq, trace, manuals, causes, spreadText, related) : [];

  useEffect(() => {
    setAi(null);
    setAiState("idle");
  }, [eqId, code]);

  async function askAi() {
    setAiState("loading");
    try {
      const res = await fetch("/api/explain", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ lines }) });
      if (res.status === 200) {
        setAi(await res.json());
        setAiState("idle");
      } else setAiState("none");
    } catch {
      setAiState("none");
    }
  }

  useEffect(() => {
    if (data.config.ai && trace && aiState === "idle" && !ai) askAi();
  }, [data.config.ai, trace]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!eq || !prog) return <div className="text-slate-400">설비를 찾을 수 없습니다.</div>;
  if (!trace)
    return (
      <div className="text-slate-400">
        {prog.id}에 알람 {josa(code, "이")} 없습니다.
      </div>
    );

  const rungs = buildRungs(prog.rows);
  const stepSet = new Set(trace.rungSteps);
  const culpritSet = new Set(trace.culprits.map((c) => c.device));
  const pathRows = prog.rows.filter((r) => stepSet.has(r.step));
  const manual = manuals[manualIdx];
  const kind = trace.primarySource;
  const openWork = openWorkFor(data.work, eqId, code);
  // 근거 데이터의 출처: 어떤 시점의 값과 어떤 래더 버전으로 판단했는가
  const srcProg = data.programs.find((p) => p.id === prog.id);
  const rev = srcProg ? programRev(srcProg) : "-";
  const pathDevices = Array.from(new Set(trace.leaves.map((l) => l.device)));
  const missing = pathDevices.filter((d) => !(d in values));
  const c0 = trace.culprits[0];
  const where = c0 ? (prog.devices.get(c0.device)?.where ?? "") : "";
  const normalOf = (d: string) => prog.devices.get(d)?.normal;
  const tm0 = trace.timersInPath[0];
  const seqLeaf = trace.leaves.find((l) => l.sequence);
  const factText = c0
    ? c0.compare
      ? `${c0.comment} 값이 ${josa(String(c0.value), "으로")} 기준(${c0.compare.op} ${c0.compare.value})을 넘었습니다. 그래서 스텝 ${c0.step} 조건이 맞아 ${trace.alarm.device}(알람)이 켜졌습니다.`
      : `${josa(`${c0.comment}(${c0.device})`, "이")} ${josa(`${c0.value ? "ON" : "OFF"}${normalOf(c0.device) != null ? `(평상시 ${normalOf(c0.device) ? "ON" : "OFF"})` : ""}`, "이")} 됐습니다. 그래서 스텝 ${c0.step} 조건이 맞아 ${trace.alarm.device}(알람)이 켜졌습니다.`
    : tm0 && seqLeaf
      ? `${tm0.device} 타이머(${(Number(tm0.setValue.slice(1)) / 10).toFixed(1)}초)가 다 차서 알람이 켜졌습니다. 추적은 ${josa(`${seqLeaf.device} ${seqLeaf.comment}`, "을")} 거쳐 순차 동작(${seqs[0]?.title ?? seqLeaf.sequence})으로 이어집니다. 센서가 정상이라는 뜻은 아닙니다.`
      : tm0
      ? `${tm0.device} 타이머(${(Number(tm0.setValue.slice(1)) / 10).toFixed(1)}초)가 다 차서 알람이 켜졌습니다. 추적은 래더 내부 조건(${trace.leaves.map((l) => l.device).join(", ")})에서 끝났습니다. 센서가 정상이라는 뜻은 아닙니다.`
      : `추적이 래더 내부 조건(${trace.leaves.map((l) => l.device).join(", ")})에서 끝났습니다. 센서가 정상이라는 뜻은 아닙니다.`;
  const stuck = seqPos
    .flatMap(({ seq, pos }) => pos.active.map((a) => ({ seq, a, wait: a.next.flatMap((n) => n.conditions.filter((c) => !c.ok)) })))
    .find((x) => x.wait.length);
  const seqNote = stuck
    ? `알람이 울릴 때 설비는 '${stuck.a.step.label}' 단계에서 ${josa(stuck.wait.map((c) => `${c.device} ${c.comment}`).join(", "), "을")} 기다리고 있었습니다(지금 ${stuck.wait.map((c) => (c.value ? "켜짐" : "꺼짐")).join(", ")}). 이 신호가 들어와야 다음 단계로 넘어갑니다.`
    : "";
  // 처음 보는 사람용 한 문장 — 무엇 때문에 알람이 울렸나 (PLC 주소 없이)
  const secOf = (t: { setValue: string }) => (Number(t.setValue.slice(1)) / 10).toFixed(1).replace(/\.0$/, "");
  const quoted = (w: string, k: "을" | "이") => `'${w}'${josa(w, k).slice(w.length)}`;
  const plain = (() => {
    if (stuck) {
      const w0 = stuck.wait[0];
      const base = `'${stuck.a.step.label.replace(/^S\d+\s*/, "")}' 동작에서 '${w0.comment}' 신호를 기다리`;
      return tm0 ? `${base}고 있었습니다. 그러다 감시 시간(${secOf(tm0)}초)을 넘겨 알람이 울렸습니다.` : `${base}다 멈춰 알람이 울렸습니다.`;
    }
    if (c0) {
      if (c0.compare) return `${quoted(c0.comment, "이")} ${josa(String(c0.value), "으로")} 기준을 넘어 알람이 울렸습니다.`;
      const on = Boolean(c0.value);
      const nm = normalOf(c0.device);
      const head =
        nm != null && Boolean(nm) !== on ? `평소 ${nm ? "켜져" : "꺼져"} 있어야 할 '${c0.comment}' 신호가` : `'${c0.comment}' 신호가`;
      const tail = kind === "외부 신호" ? ` 우리 설비 밖${c0.checkWith ? `(${c0.checkWith})` : ""}에서 온 신호입니다.` : "";
      return `${head} ${on ? "켜져서" : "꺼져서"} 알람이 울렸습니다.${tail}`;
    }
    if (tm0) return `감시 시간(${secOf(tm0)}초) 안에 동작이 끝나지 않아 알람이 울렸습니다.`;
    return "";
  })();
  const nonReset = causes.filter((x) => x.actionType !== "리셋");
  const best = nonReset.find((x) => x.tries >= 3) ?? nonReset[0];
  const todo: { title: string; body: string; note?: string; detail?: string; warn?: boolean }[] = [
    {
      title: "안전 먼저",
      body: manual && manual.safety !== "-" ? manual.safety : "설비가 멈춘 상태인지 확인하고 기본 보호구를 착용하세요.",
      note: trace.alarm.protect === "안전" ? "안전 알람입니다. 원인을 확인하기 전에는 리셋하거나 재가동하지 마세요." : undefined,
      warn: true,
    },
    kind === "외부 신호"
      ? {
          title: "보내는 쪽과 같이 확인",
          body: `우리 쪽 수신값(${c0?.device ?? "-"})과 통신 상태를 먼저 보세요. 그다음 ${withWa(c0?.checkWith || "신호를 보내는 부서")} ${c0?.comment ?? "신호"} 상태를 같이 점검하세요.`,
          note: "보내는 쪽 고장이라고 바로 단정하지는 마세요.",
        }
      : kind === "래더 로직"
        ? {
            title: stuck ? "멈춘 곳 확인 (PLC 담당과 함께)" : "래더 조건 확인 (PLC 담당과 함께)",
            body: stuck
              ? `먼저 ${josa(stuck.wait[0].where || `${stuck.wait[0].comment} 센서`, "이")} ${quoted(stuck.wait[0].comment, "을")} 제대로 감지하는지 보세요. 이상이 없으면 ${tm0 ? `${secOf(tm0)}초 기준과 ` : ""}동작 순서가 맞는지 PLC 담당과 확인하세요.`
              : `알람을 켠 조건이 래더 안에 있습니다. ${tm0 ? `${secOf(tm0)}초 기준과 ` : ""}동작 순서가 맞는지 PLC 담당과 확인하세요.`,
            detail: stuck
              ? `PLC 담당에게 알려 줄 것: ${stuck.a.step.label} 단계 / 기다린 신호 ${stuck.wait.map((c) => c.device).join(", ")}${tm0 ? ` / 타이머 ${tm0.device} ${(Number(tm0.setValue.slice(1)) / 10).toFixed(1)}초(스텝 ${tm0.step})` : ""}`
              : `PLC 담당에게 알려 줄 것: 추적이 멈춘 곳 ${trace.leaves.map((l) => l.device).join(", ")}${tm0 ? ` / 타이머 ${tm0.device} ${(Number(tm0.setValue.slice(1)) / 10).toFixed(1)}초(스텝 ${tm0.step})` : ""}`,
          }
        : {
            title: "먼저 볼 곳",
            body: `${josa(where || c0?.comment || "원천 센서", "을")} 먼저 확인하세요.${manual ? ` 매뉴얼 첫 단계: ${manual.steps[0]}.` : ""}`,
            detail: c0 ? `PLC 담당에게 알려 줄 것: 신호 ${c0.device} (${c0.comment})` : undefined,
          },
    best
      ? {
          title: "과거에 해결된 조치",
          body: `${best.action} (${best.tries}건 중 ${best.resolved}건 해결, 평균 ${Math.round(best.avgMin)}분)`,
          note: `${best.tries <= 2 ? "기록이 적으니 참고만 하세요." : "현장 상태를 먼저 확인하세요."} 최근 조치 ${best.lastAt ? fmtDate(best.lastAt, false) : "-"}`,
        }
      : { title: "과거 기록 없음", body: "아래 매뉴얼 순서대로 점검하세요. 이번 기록이 첫 근거가 됩니다." },
  ];

  const handover = [
    `[인수인계] ${eq.id} ${eq.name} [${trace.alarm.level}알람] ${code} ${trace.alarm.name}`,
    `- 발생: ${active ? `${fmtDate(state!.since)} (${elapsed(state!.since, live.now)} 경과)` : savedLog ? fmtDate(savedLog.occurredAt) : "-"}`,
    `- 래더 추적: ${trace.culprits.map((c) => `${c.device}(${c.comment})`).join(", ") || "래더 로직(타이머 판정)"}에서 ${trace.alarm.device}(알람) 켜짐 [${kind}]`,
    `- 진행한 조치: ${[manual ? manual.steps.filter((s) => checked[s]).join(", ") : "", savedLog ? `${savedLog.action} (${savedLog.result})` : ""].filter(Boolean).join(" / ") || "아직 없음"}`,
    best ? `- 과거 해결 사례: ${best.action} (해결 ${best.resolved}/${best.tries})` : "",
    related[0] ? `- 재발 방지안 (${related[0].title})` : "",
  ]
    .filter(Boolean)
    .join("\n");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <button onClick={() => router.back()} className="text-sm text-slate-400 hover:text-slate-200">
          ← 뒤로
        </button>
        <LevelBadge level={trace.alarm.level} />
        <ProtectBadge protect={trace.alarm.protect} />
        {repeatCount(data.logs, eqId, code, 7, live.now) >= REPEAT_THRESHOLD && (
          <span className="rounded bg-violet-500/20 px-1.5 py-0.5 text-[11px] text-violet-200">
            <Term k="반복 알람">반복 의심</Term> · 최근 7일 조치 기록 {repeatCount(data.logs, eqId, code, 7, live.now)}건
          </span>
        )}
        <h1 className="text-xl font-semibold">
          <span className="mono">{code}</span> {trace.alarm.name}
        </h1>
        <span className="text-slate-400">
          <Link href={`/equipment/${eq.id}`} className="mono hover:text-slate-200">
            {eq.id}
          </Link>{" "}
          {eq.name} · {PROCESS_LABEL[eq.process]} · <span className="mono">{prog.id}</span>
        </span>
        <span className="ml-auto text-sm">
          {active ? (
            <span className="flex items-center gap-2">
              <StatusBadge status="ALARM" level={trace.alarm.level} /> {elapsed(state!.since, live.now)} 경과
            </span>
          ) : (
            <span className="text-slate-400">지금 떠 있는 알람 아님 (대표 시나리오 값으로 추적)</span>
          )}
        </span>
      </div>

      {/* 결론: 확인된 사실 / 원인 후보 / 지금 할 일을 나눠서 — 문단 하나에 섞지 않음 */}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <div className={`rounded-xl border p-4 ${kind ? SOURCE_META[kind].border : "border-slate-700"} bg-slate-900/70`}>
          <div className="flex flex-wrap items-center gap-2 text-lg">
            <span className="text-slate-400">
              <Term k="알람 성립 원인" />
            </span>
            <SourceBadge kind={kind} className="text-sm" />
            {trace.culprits.map((c) => (
              <span key={c.device} className="flex items-center gap-1.5">
                <span className="mono font-semibold text-fuchsia-300">{c.device}</span>
                <span>{c.comment}</span>
                <span className="mono rounded bg-fuchsia-500/20 px-1.5 text-sm text-fuchsia-200">{c.compare ? c.value : c.value ? "ON" : "OFF"}</span>
              </span>
            ))}
            {!trace.culprits.length && trace.timersInPath[0] && (
              <span>
                타이머 <span className="mono">{trace.timersInPath[0].device}</span> {trace.timersInPath[0].setValue} 판정{" "}
                {seqLeaf ? "(추적이 순차 동작으로 이어짐)" : "(추적이 래더 내부 조건에서 끝남)"}
              </span>
            )}
          </div>
          <dl className="mt-3 space-y-2 text-sm">
            {plain && (
              <div className="grid grid-cols-[92px_1fr] gap-2 rounded-md bg-sky-500/10 px-2 py-1.5">
                <dt className="font-semibold text-sky-200">쉽게 말하면</dt>
                <dd className="text-[15px] leading-relaxed text-slate-100">{plain}</dd>
              </div>
            )}
            <div className="grid grid-cols-[92px_1fr] gap-2">
              <dt className="text-slate-400">확인된 사실</dt>
              <dd className="text-slate-200">{factText}</dd>
            </div>
            {seqNote && (
              <div className="grid grid-cols-[92px_1fr] gap-2">
                <dt className="text-slate-400">순차 동작</dt>
                <dd className="text-slate-200">
                  {seqNote}{" "}
                  <a href="#sequence" className="text-sky-300 underline-offset-2 hover:underline">
                    흐름도 보기 ↓
                  </a>
                </dd>
              </div>
            )}
            {where && (
              <div className="grid grid-cols-[92px_1fr] gap-2">
                <dt className="text-slate-400">현장 위치</dt>
                <dd className="text-slate-200">{where}</dd>
              </div>
            )}
            <div className="grid grid-cols-[92px_1fr] gap-2">
              <dt className="text-slate-400">원인 후보</dt>
              <dd className="text-slate-300">
                {manual ? (
                  <>
                    <b className="text-slate-100">{manual.cause}</b> (매뉴얼 {manual.id})
                  </>
                ) : (
                  "매뉴얼 항목 없음"
                )}
                {best && (
                  <span className="mt-0.5 block">
                    과거 해결: &lsquo;{best.action}&rsquo; {best.resolved}/{best.tries}건 <EvidenceTag n={best.tries} />
                  </span>
                )}
              </dd>
            </div>
            {spreadText && (
              <div className="grid grid-cols-[92px_1fr] gap-2">
                <dt className="text-slate-400">설비군 비교</dt>
                <dd className="text-slate-300">{spreadText}</dd>
              </div>
            )}
            {ai?.text && (
              <div className="grid grid-cols-[92px_1fr] gap-2">
                <dt className="text-violet-300">쉬운 말 (AI)</dt>
                <dd className="text-slate-200">{ai.text}</dd>
              </div>
            )}
          </dl>
          <p className="mt-3 text-xs text-slate-400">
            {active ? "알람이 뜬 순간" : "대표 시나리오"}의 신호값으로 어떤 조건이 알람을 켰는지 찾습니다. 실제 고장 원인은 매뉴얼과 과거 조치에서 후보로 봅니다.
          </p>
          <div className="mt-2 rounded-md bg-black/20 px-2 py-1.5 text-[11px] text-slate-400">
            근거: {active ? `${fmtDate(state!.since)} 알람 순간 신호값` : "대표 시나리오 값"} {pathDevices.length - missing.length}/{pathDevices.length}개 확보, 적용 래더{" "}
            <span title={`${srcProg?.builtIn ? "기본 제공" : `업로드 ${srcProg?.uploadedAt ? fmtDate(srcProg.uploadedAt, false) : ""}`}, 파일 지문 ${rev}`}>{prog.id}</span>
            {missing.length > 0 && <span className="text-amber-200"> · 값 없음: {missing.join(", ")}</span>}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-slate-400">
            {ai ? (
              <span>
                AI 설명({ai.model}), 민감한 값 {ai.masked ?? 0}개는 가리고 보냄. 원인 판단은 래더 추적 그대로입니다.
              </span>
            ) : (
              <span>AI 추정 없이 래더와 조치이력 DB로 계산해서, 늘 같은 결과가 나옵니다.</span>
            )}
            {data.config.ai && (
              <button onClick={askAi} className="text-violet-300 hover:underline" disabled={aiState === "loading"}>
                {aiState === "loading" ? "AI 설명 작성 중…" : "AI로 다시 설명"}
              </button>
            )}
            <details>
              <summary className="cursor-pointer">한 문단 설명 보기</summary>
              <p className="mt-1 max-w-3xl text-xs leading-relaxed text-slate-300">{rule}</p>
            </details>
            <details>
              <summary className="cursor-pointer">AI에 보내는 내용 보기</summary>
              <pre className="mono mt-1 whitespace-pre-wrap rounded bg-black/40 p-2 text-[11px] text-slate-400">{lines.join("\n")}</pre>
            </details>
          </div>
        </div>

        <div data-guide="todo" className="order-first rounded-xl border border-sky-500/40 bg-sky-500/5 p-4 xl:order-none">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold text-sky-100">지금 할 일</h2>
            <span className="text-[11px] text-slate-400">위에서부터 차례로</span>
          </div>
          {plain && <p className="mt-2 rounded-md bg-sky-500/10 px-2 py-1.5 text-sm text-slate-100 xl:hidden">쉽게 말하면: {plain}</p>}
          <ol className="mt-3 space-y-2">
            {todo.map((t, i) => (
              <li key={t.title} className={`flex gap-3 rounded-lg p-2.5 ${t.warn ? "border border-amber-500/50 bg-amber-500/10" : "bg-slate-900/70"}`}>
                <span
                  className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-bold ${t.warn ? "bg-amber-400 text-black" : "bg-sky-700 text-white"}`}
                >
                  {i + 1}
                </span>
                <span className="min-w-0 text-sm">
                  <b className="text-slate-100">{t.title}</b>
                  <span className="mt-0.5 block text-slate-300">{t.body}</span>
                  {t.note && <span className="mt-0.5 block text-xs text-slate-400">{t.note}</span>}
                  {t.detail && <span className="mono mt-1 block text-[11px] text-slate-400">{t.detail}</span>}
                </span>
              </li>
            ))}
          </ol>
          <a href="#record" className="mt-3 flex items-center justify-center rounded-md bg-sky-700 px-3 py-2 text-sm font-semibold text-white hover:bg-sky-800">
            조치 끝나면 기록하기 ↓
          </a>
        </div>
      </div>

      <Card
        id="trace-flow"
        title={traceView === "flow" ? "알람이 켜지는 흐름도" : "래더 역추적 경로"}
        right={
          <div className="flex items-center gap-2">
            <span className="hidden text-[11px] text-slate-400 sm:inline">래더 그대로 계산 (늘 같은 결과)</span>
            <div className="flex rounded-md border border-slate-700 text-xs" role="tablist" aria-label="보기 방식">
              {(
                [
                  ["flow", "흐름도"],
                  ["list", "목록"],
                ] as const
              ).map(([v, l]) => (
                <button
                  key={v}
                  role="tab"
                  aria-selected={traceView === v}
                  onClick={() => setTraceView(v)}
                  className={`px-2 py-0.5 ${traceView === v ? "bg-slate-700 text-white" : "text-slate-400 hover:text-slate-200"}`}
                >
                  {l}
                </button>
              ))}
            </div>
          </div>
        }
      >
        {traceView === "flow" ? (
          <AlarmFlow trace={trace} onSequence={() => document.getElementById("sequence")?.scrollIntoView({ behavior: "smooth" })} />
        ) : (
          <TraceTree node={trace.root} />
        )}
        <div className="mt-3 flex flex-wrap gap-3 text-[11px] text-slate-400">
          <span>
            <span className="rounded bg-fuchsia-600 px-1 font-bold text-white">◎ 알람 성립 원인</span> 평상값과 달라져 알람을 켠 끝 접점 (이 색은 알람
            등급과 상관없음)
          </span>
          <span>자기유지, 해제 조건, 운전 상태 접점은 원인에서 뺐습니다</span>
        </div>
      </Card>

      {seqPos.map(({ seq, pos }) => (
        <Card
          key={seq.id}
          id="sequence"
          title={`순차 동작 흐름도 · ${seq.title}`}
          right={<span className="text-[11px] text-slate-400">{pos.known ? "알람이 뜬 순간의 단계 표시" : "단계 값 없음"}</span>}
        >
          <SequenceFlow seq={seq} position={pos} />
        </Card>
      ))}


      {(active || openWork) && (
        <WorkPanel
          equipmentId={eqId}
          alarmCode={code}
          startedAt={active ? new Date(state!.since).toISOString() : openWork!.startedAt}
          active={active}
          now={live.now}
          suggestOwner={manual?.owner}
        />
      )}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <div className="space-y-4">
          <ExpertOnly label="관련 래더 표">
            <Card title={`관련 래더 (스텝 ${trace.rungSteps[0]}~${trace.rungSteps[trace.rungSteps.length - 1]})`} bodyClass="p-0">
              <table className="w-full text-sm">
                <thead className="text-left text-[11px] text-slate-400">
                  <tr className="border-b border-slate-800">
                    <th className="px-3 py-1.5">스텝</th>
                    <th>명령</th>
                    <th>디바이스</th>
                    <th>설정값</th>
                    <th>코멘트</th>
                    <th className="pr-3 text-right">지금 값</th>
                  </tr>
                </thead>
                <tbody className="mono">
                  {pathRows.map((r) => {
                    const isOut = /^(OUT|SET|RST)$/.test(r.instr);
                    const v = r.device in values ? values[r.device] : undefined;
                    return (
                      <tr
                        key={r.step}
                        className={`border-b border-slate-800/60 ${culpritSet.has(r.device) && !isOut ? "bg-fuchsia-500/10 text-fuchsia-200" : isOut ? "text-sky-200" : "text-slate-300"}`}
                      >
                        <td className="px-3 py-1 text-slate-400">{r.step}</td>
                        <td>{r.instr}</td>
                        <td className="font-semibold">{r.device}</td>
                        <td>{r.setValue}</td>
                        <td className="font-sans text-slate-400">{prog.devices.get(r.device)?.comment || r.comment}</td>
                        <td className="pr-3 text-right">{v === undefined ? "" : r.device.startsWith("D") ? v : v ? "ON" : "OFF"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <div className="px-3 py-2 text-[11px] text-slate-400">
                회로 {rungs.length}개 중 이 알람과 관련된 것만 보입니다. 전체 래더는 PLC 프로그램 화면에서 보세요.
              </div>
            </Card>
          </ExpertOnly>

          <Card
            title={`과거 조치 (최근 90일, ${prog.id} ${units.length}대)`}
            right={
              <span className="text-[11px] text-slate-400" title="기록이 적으면 해결률을 낮춰 잡아 정렬합니다(윌슨 하한). 1/1이 5/6보다 앞에 오지 않습니다.">
                기록 수 반영 순
              </span>
            }
          >
            {causes.length ? (
              <table className="w-full text-sm">
                <thead className="text-left text-[11px] text-slate-400">
                  <tr>
                    <th className="pb-1">원인</th>
                    <th>조치</th>
                    <th className="text-right">해결</th>
                    <th className="pl-2">이력</th>
                    <th className="text-right">평균 시간</th>
                    <th className="text-right">마지막</th>
                  </tr>
                </thead>
                <tbody>
                  {causes.slice(0, 6).map((c) => (
                    <tr key={c.cause + c.action} className="border-t border-slate-800/60">
                      <td className="py-1.5 pr-2">{c.cause}</td>
                      <td className="pr-2 text-slate-300">{c.action}</td>
                      <td
                        className={`text-right tabular-nums ${c.resolved / c.tries >= 0.8 ? "text-emerald-300" : c.resolved / c.tries < 0.5 ? "text-red-300" : "text-amber-200"}`}
                      >
                        {c.resolved}/{c.tries}
                      </td>
                      <td className="pl-2">
                        <EvidenceTag n={c.tries} />
                      </td>
                      <td className="text-right tabular-nums text-slate-400">{Math.round(c.avgMin)}분</td>
                      <td className="text-right tabular-nums text-slate-400">{c.lastAt ? fmtDate(c.lastAt, false) : "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="text-sm text-slate-400">아직 기록이 없습니다. 아래에서 첫 조치를 기록하세요.</div>
            )}
            <div className="mt-4">
              <div className="mb-2 flex items-center gap-2 text-xs">
                <span className="text-slate-400">설비군 비교</span>
                <span className={spread.verdict === "single" ? "text-red-300" : spread.verdict === "common" ? "text-sky-300" : "text-slate-400"}>
                  {spreadText || "기록 없음"}
                </span>
              </div>
              <HBars
                items={spread.counts
                  .filter((c) => c.count > 0 || c.unit === eqId)
                  .sort((a, b) => b.count - a.count)
                  .slice(0, 12)
                  .map((c) => ({
                    label: (
                      <span className={`mono ${c.unit === eqId ? "text-white" : ""}`}>
                        {c.unit}
                        {c.unit === eqId ? " (이 설비)" : ""}
                      </span>
                    ),
                    value: c.count,
                    tone: c.unit === eqId ? "bg-red-500/70" : "bg-slate-500/70",
                  }))}
                unit="건"
              />
              <div className="mt-1 text-[11px] text-slate-400">이 설비 최근 90일 {thisUnit.length}건</div>
            </div>
          </Card>
        </div>

        <div className="space-y-4">
          <Card id="guide-manual" title="원천별 조치 가이드 (매뉴얼)" right={<SourceBadge kind={kind} />}>
            {kind === "외부 신호" && (
              <div className="mb-3 rounded-lg border border-violet-500/40 bg-violet-500/10 p-3 text-sm">
                <div className="font-semibold text-violet-200">보내는 쪽부터 확인하세요</div>
                <div className="mt-1 text-slate-300">
                  확인처: <b>{trace.culprits[0]?.checkWith || "-"}</b>. 우리 래더를 바꿔 알람을 숨기지는 마세요.
                </div>
              </div>
            )}
            {kind === "래더 로직" && (
              <div className="mb-3 rounded-lg border border-teal-500/40 bg-teal-500/10 p-3 text-sm">
                <div className="font-semibold text-teal-200">센서가 아니라 래더 안의 조건(시간 감시 등)이 켠 알람입니다</div>
                <div className="mt-1 text-xs text-slate-400">
                  센서 점검과 함께, 추적이 멈춘 곳({trace.leaves.map((l) => l.device).join(", ")})의 동작도 PLC 담당과 확인하세요.
                </div>
                <div className="mt-1 text-slate-300">
                  감시 시간{" "}
                  {trace.timersInPath.map((t) => `${t.device} ${t.setValue}(${(Number(t.setValue.slice(1)) / 10).toFixed(1)}초, 스텝 ${t.step})`).join(", ")}이
                  지금 공정 속도에 맞는지는 아래 개선 제안에서 보세요. 래더는 PLC 담당이 검토한 뒤에 바꿉니다.
                </div>
              </div>
            )}
            {manuals.length > 1 && (
              <div className="mb-2 flex flex-wrap gap-1">
                {manuals.map((m, i) => {
                  const hist = causes.find((c) => c.cause === m.cause);
                  return (
                    <button
                      key={m.id}
                      onClick={() => {
                        setManualIdx(i);
                        setChecked({});
                      }}
                      className={`rounded-md border px-2 py-1 text-xs ${i === manualIdx ? "border-sky-500 bg-sky-500/15 text-sky-200" : "border-slate-700 text-slate-400"}`}
                    >
                      {m.cause}
                      {hist && (
                        <span className="ml-1 text-slate-400">
                          (이력 {hist.resolved}/{hist.tries})
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
            {manual ? (
              <div>
                <div className="mb-2 text-sm">
                  <span className="text-slate-400">원인 후보:</span> <b>{manual.cause}</b>{" "}
                  <span className="text-xs text-slate-400">
                    ({manual.id}, 담당 {manual.owner}, 원천 <span className="mono">{manual.sourceDevice}</span>)
                  </span>
                </div>
                <label
                  className={`mb-2 flex items-start gap-2 rounded-md border p-2 text-sm ${safety ? "border-emerald-600/50 bg-emerald-500/5" : "border-amber-500/50 bg-amber-500/10"}`}
                >
                  <input type="checkbox" checked={safety} onChange={(e) => setSafety(e.target.checked)} className="mt-1" />
                  <span>
                    <b className="text-amber-200">안전 확인:</b> {manual.safety === "-" ? "따로 정한 안전 조치는 없습니다. 기본 보호구를 착용했는지 확인하세요." : manual.safety}
                  </span>
                </label>
                <ol className="space-y-1">
                  {manual.steps.map((s, i) => (
                    <li key={s}>
                      <label
                        className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-sm ${!safety ? "opacity-50" : ""} ${checked[s] ? "bg-emerald-500/10 text-emerald-200" : "bg-slate-800/50"}`}
                      >
                        <input
                          type="checkbox"
                          disabled={!safety}
                          checked={!!checked[s]}
                          onChange={(e) => setChecked((c) => ({ ...c, [s]: e.target.checked }))}
                        />
                        <span className="w-5 text-slate-400">{i + 1}</span>
                        {s}
                      </label>
                    </li>
                  ))}
                </ol>
              </div>
            ) : (
              <div className="text-sm text-slate-400">이 신호에 맞는 매뉴얼 항목이 없습니다. 조치 후 기록하면 매뉴얼 보강 제안에 들어갑니다.</div>
            )}
          </Card>

          {related.length > 0 && (
            <Card title="재발 방지 제안" right={<span className="text-[11px] text-slate-400">조치이력 기준 추정치</span>}>
              <ul className="space-y-2">
                {related.map((p) => (
                  <li key={p.id}>
                    <Link
                      href={`/improve#${encodeURIComponent(p.id)}`}
                      className="block rounded-lg border border-sky-500/30 bg-sky-500/5 p-3 hover:bg-sky-600/10"
                    >
                      <div className="text-[11px] text-sky-300">{KIND_LABEL[p.kind]}</div>
                      <div className="text-sm font-medium">{p.title}</div>
                      <div className="mt-1 text-xs text-slate-400">
                        {p.effect.avoided > 0
                          ? p.kind === "pm"
                            ? `과거 ${p.effect.total}건 중 ${p.effect.avoided}건을 계획 정비로 돌림, `
                            : p.kind === "unit" || p.kind === "inspect"
                              ? `근본 조치하면 과거 ${p.effect.total}건 중 최대 ${p.effect.avoided}건 줄어듦, `
                              : `과거 ${p.effect.total}건 중 ${p.effect.avoided}건 억제, `
                          : ""}
                        {`연 ${Math.round(p.effect.perYearMin / 60)}시간 정지 감소`}
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <div id="record" className="scroll-mt-20" />
          <Card id="guide-record" title="조치 기록 (조치이력 DB에 저장)">
            {saved ? (
              <div className="space-y-2 text-sm">
                <div className="rounded-md bg-emerald-500/10 p-3 text-emerald-300">{saved}</div>
                <Btn onClick={() => setSaved(null)}>하나 더 기록</Btn>
              </div>
            ) : (
              <ActionForm
                key={`${eqId}-${code}-${manualIdx}`}
                lockEquipment
                submitLabel="기록 저장"
                initial={emptyDraft({
                  equipmentId: eqId,
                  alarmCode: code,
                  sourceDevice: trace.culprits[0]?.device ?? manual?.sourceDevice ?? "",
                  cause: manual?.cause ?? "",
                  action: manual ? manual.steps.filter((s) => checked[s]).join(", ") : "",
                  actionType: kind === "외부 신호" ? "외부 확인" : "점검·조정",
                  durationMin: active ? Math.max(1, Math.round((live.now - state!.since) / 60000)) : 10,
                  occurredAt: active ? new Date(state!.since).toISOString() : new Date().toISOString(),
                })}
                onSave={async (d) => {
                  await data.addLog(d);
                  setSavedLog({ occurredAt: d.occurredAt, action: d.action, result: d.result });
                  // 조치 기록 → 대응 상태 자동 갱신 (리셋만으로 풀리면 '후속 확인'으로 남김)
                  if (active || openWork) {
                    const base = openWork ?? draftWork(eqId, code, new Date(state!.since).toISOString());
                    const next = statusAfterLog(d);
                    await data
                      .saveWork(
                        { ...base, status: next.status, owner: base.owner || d.worker || "", nextAction: next.nextAction || base.nextAction },
                        `조치 기록 저장(${d.result}), ${josa(next.status, "으로")} 바꿈`,
                      )
                      .catch(() => undefined);
                  }
                  if (d.result === "해결" && active) live.recover(eqId, `${eqId} 가동 복귀 (${code} 조치 완료: ${d.action})`);
                  setSaved(
                    d.result === "해결"
                      ? `저장했습니다. ${active ? `${josa(eqId, "이")} 가동으로 바뀌었습니다. ` : ""}이 기록은 다음 진단과 개선 제안에 바로 들어갑니다.`
                      : "미해결로 저장했습니다. 인수인계 메모를 복사해 다음 근무조에 넘기세요.",
                  );
                }}
              />
            )}
            <div className="mt-3 border-t border-slate-800 pt-3">
              <Btn
                tone="ghost"
                onClick={async () => {
                  setCopied(await copyText(handover));
                  setTimeout(() => setCopied(false), 1500);
                }}
              >
                {copied ? "복사됨" : "인수인계 메모 복사"}
              </Btn>
              <pre className="mt-2 whitespace-pre-wrap rounded bg-black/30 p-2 text-[11px] text-slate-400">{handover}</pre>
            </div>
          </Card>
        </div>
      </div>
      <div className="text-[11px] text-slate-400">
        래더 {prog.rows.length}줄, 디바이스 코멘트 {prog.devices.size}개{formatRow(prog.rows[0]).length > 0 ? " (IL 명령어 목록 형식)" : ""}
      </div>
    </div>
  );
}
