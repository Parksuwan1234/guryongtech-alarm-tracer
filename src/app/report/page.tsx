"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Btn, Card, LevelBadge, Stat, StatusBadge, copyText, inputCls } from "@/components/ui";
import { alarmStats, fmtDate, fmtMin, shiftOf, shiftStart, type Shift } from "@/lib/analytics";
import { elapsed, useLive } from "@/lib/live";
import { useData } from "@/lib/store";
import type { AlarmWork } from "@/lib/types";
import { WORK_TONE, openWorkFor } from "@/lib/work";

const SHIFT_HOURS: Record<Shift, number> = { 주간: 6, 오후: 14, 야간: 22 };

export default function ReportPage() {
  const data = useData();
  const live = useLive();
  const now = new Date(live.now || Date.now());
  const options = useMemo(() => {
    const cur = shiftStart(now);
    const shifts = Array.from({ length: 6 }, (_, i) => {
      const s = new Date(cur.getTime() - i * 8 * 3600000);
      return {
        start: s,
        hours: 8,
        label: `${fmtDate(s, false)} ${shiftOf(s)} (${String(SHIFT_HOURS[shiftOf(s)]).padStart(2, "0")}시~)${i === 0 ? " · 현재" : ""}`,
      };
    });
    return [{ start: new Date(now.getTime() - 24 * 3600000), hours: 24, label: "최근 24시간 (3교대)" }, ...shifts];
  }, [now.getHours()]); // eslint-disable-line react-hooks/exhaustive-deps
  const [idx, setIdx] = useState(0);
  const sel = options[Math.min(idx, options.length - 1)];
  const from = sel.start.getTime();
  const to = from + sel.hours * 3600000;
  const logs = data.logs.filter((l) => {
    const t = new Date(l.occurredAt).getTime();
    return t >= from && t < to;
  });
  const downtime = logs.reduce((s, l) => s + l.durationMin, 0);
  const unresolved = logs.filter((l) => l.result === "미해결");
  const top = alarmStats(logs).slice(0, 5);
  const ongoing = Object.values(live.equips).filter((e) => e.status !== "RUN");
  const pending = data.proposals.filter((p) => (data.reviews.get(p.id)?.status ?? "검토 대기") === "검토 대기").slice(0, 3);
  const overduePm = data.proposals
    .filter((p) => p.kind === "pm")
    .flatMap((p) =>
      (p.schedule ?? [])
        .filter((s) => new Date(s.next).getTime() < to + 86400000)
        .map((s) => ({ ...s, title: p.alarmName, action: p.title.split(": ")[1] ?? "" })),
    )
    .slice(0, 8);
  const name = (code: string, eq: string) => data.programOf(eq)?.alarms.find((a) => a.code === code)?.name ?? "";
  const urgency = (e: (typeof ongoing)[number] | null) => (!e ? 1.5 : e.status === "ALARM" ? (e.alarm?.level === "중" ? 0 : 1) : e.status === "STOP" ? 2 : 3);
  // 다음 행동: 지금 이상 설비 + 알람은 꺼졌지만 아직 종결되지 않은 대응 건(후속 확인 등)
  const lastLog = (eq: string, code: string) => data.logs.find((l) => l.equipmentId === eq && l.alarmCode === code);
  const handoff: { key: string; eq: string; code: string; label: string; live: (typeof ongoing)[number] | null; w: AlarmWork | undefined }[] = [
    ...ongoing.map((e) => ({
      key: e.id,
      eq: e.id,
      code: e.alarm?.code ?? "",
      label: e.alarm ? `${e.alarm.code} ${e.alarm.name}` : e.reason,
      live: e,
      w: e.alarm ? openWorkFor(data.work, e.id, e.alarm.code) : undefined,
    })),
    ...Array.from(data.work.values())
      .filter((w) => w.status !== "종결" && !ongoing.some((e) => e.id === w.equipmentId && e.alarm?.code === w.alarmCode))
      .map((w) => ({ key: w.id, eq: w.equipmentId, code: w.alarmCode, label: `${w.alarmCode} ${name(w.alarmCode, w.equipmentId)}`, live: null, w })),
  ].sort((a, b) => urgency(a.live) - urgency(b.live));
  // 이번 발생 건의 조치와 지난 발생 때 조치를 구분
  const startOf = (h: (typeof handoff)[number]) => h.w?.startedAt ?? (h.live ? new Date(h.live.since).toISOString() : "");
  const lastText = (h: (typeof handoff)[number]) => {
    const ll = h.code ? lastLog(h.eq, h.code) : undefined;
    if (!ll) return "기록 없음";
    const t = `${ll.action || ll.actionType} → ${ll.result} (${fmtDate(ll.occurredAt)})`;
    return ll.occurredAt >= startOf(h) ? `이번 건: ${t}` : `이번 건 조치 없음 · 지난번: ${t}`;
  };
  const [copied, setCopied] = useState(false);

  const text = [
    `[교대 인수인계] ${sel.label.replace(" · 현재", "")}`,
    `■ 조치 ${logs.length}건 · 정지 ${fmtMin(downtime)} · 미해결 ${unresolved.length}건`,
    `■ 다음 행동 (이어받을 것 ${handoff.length}건)`,
    ...handoff.map((h) => {
      return `  - ${h.eq} ${h.label}${h.live ? ` (${elapsed(h.live.since, live.now)})` : " (알람 해제)"} · ${h.w?.status ?? (h.code ? "미접수" : "-")}${h.w?.owner ? ` · 담당 ${h.w.owner}` : ""}${h.code ? ` · ${lastText(h)}` : ""}${h.w?.nextAction ? ` · 다음: ${h.w.nextAction}` : ""}${h.w?.dueAt ? ` (${fmtDate(h.w.dueAt)}까지)` : ""}`;
    }),
    `■ 미해결 건`,
    ...(unresolved.length ? unresolved.map((l) => `  - ${l.equipmentId} ${l.alarmCode} ${l.cause} / 시도: ${l.action} (${l.worker})`) : ["  - 없음"]),
    `■ 많이 난 알람`,
    ...top.map((t) => `  - ${t.alarmCode} ${t.count}건 · ${fmtMin(t.downtimeMin)}`),
    `■ 다가오는 예방정비`,
    ...(overduePm.length ? overduePm.map((s) => `  - ${s.equipmentId} ${s.action} (권장 ${fmtDate(s.next, false)})`) : ["  - 없음"]),
    `■ 검토 대기 개선 제안`,
    ...pending.map((p) => `  - ${p.title}`),
  ].join("\n");

  return (
    <div className="space-y-4">
      <div className="no-print flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">교대 인수인계 리포트</h1>
        <select className={`${inputCls} max-w-xs`} value={idx} onChange={(e) => setIdx(Number(e.target.value))}>
          {options.map((o, i) => (
            <option key={i} value={i}>
              {o.label}
            </option>
          ))}
        </select>
        <div className="ml-auto flex gap-2">
          <Btn
            onClick={async () => {
              setCopied(await copyText(text));
              setTimeout(() => setCopied(false), 1500);
            }}
          >
            {copied ? "복사됨" : "메신저용 텍스트 복사"}
          </Btn>
          <Btn onClick={() => window.print()}>인쇄</Btn>
        </div>
      </div>
      <p className="text-sm text-slate-400">
        근무조 동안의 조치이력(DB)과 지금 설비 상태를 한 장으로 묶었습니다. 매일 쓰는 화면이라 기록이 쌓이는 이유가 됩니다.
      </p>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Stat label="조치" value={`${logs.length}건`} />
        <Stat label="정지 시간" value={fmtMin(downtime)} />
        <Stat label="미해결" value={`${unresolved.length}건`} tone={unresolved.length ? "text-red-300" : "text-slate-200"} />
        <Stat label="이어받을 것" value={`${handoff.length}건`} sub={`미접수 ${handoff.filter((h) => h.code && !h.w).length}건`} tone="text-orange-300" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card
          title={`다음 행동 · 이어받을 것 ${handoff.length}건`}
          right={<span className="text-[11px] text-slate-400">처리 상태는 알람 상세에서 바꿉니다</span>}
        >
          <ul className="space-y-2 text-sm">
            {handoff.map((h) => {
              const overdue = h.w?.dueAt && new Date(h.w.dueAt).getTime() < live.now;
              return (
                <li key={h.key} className="rounded-md bg-slate-800/40 p-2">
                  <div className="flex flex-wrap items-center gap-2">
                    {h.live ? (
                      <StatusBadge status={h.live.status} level={h.live.alarm?.level} />
                    ) : (
                      <span className="rounded-full border border-slate-600 px-2 text-[11px] text-slate-400">알람 해제</span>
                    )}
                    <Link href={h.code ? `/alarm/${h.eq}/${h.code}` : `/equipment/${h.eq}`} className="mono font-semibold hover:underline">
                      {h.eq}
                    </Link>
                    <span className="min-w-0 flex-1 truncate text-slate-300">{h.label}</span>
                    {h.code && (
                      <span className={`rounded-full border px-1.5 text-[10px] ${WORK_TONE[h.w?.status ?? "미접수"]}`}>{h.w?.status ?? "미접수"}</span>
                    )}
                    {h.live && <span className="text-xs text-slate-400">{elapsed(h.live.since, live.now)}</span>}
                  </div>
                  {h.code && (
                    <div className="mt-1 grid gap-x-4 gap-y-0.5 text-xs text-slate-400 sm:grid-cols-2">
                      <span>담당: {h.w?.owner || <span className="text-red-300">미지정</span>}</span>
                      <span>{lastText(h)}</span>
                      <span className="sm:col-span-2">
                        다음: {h.w?.nextAction || "—"}
                        {h.w?.dueAt && (
                          <span className={overdue ? "text-red-300" : ""}>
                            {" "}
                            · {fmtDate(h.w.dueAt)}까지{overdue ? " (지남)" : ""}
                          </span>
                        )}
                      </span>
                    </div>
                  )}
                </li>
              );
            })}
            {!handoff.length && <li className="text-slate-400">없음</li>}
          </ul>
        </Card>
        <Card title={`미해결 ${unresolved.length}건`}>
          <ul className="space-y-2 text-sm">
            {unresolved.map((l) => (
              <li key={l.id} className="rounded-md bg-red-500/5 p-2">
                <div>
                  <span className="mono font-semibold">{l.equipmentId}</span> <span className="mono">{l.alarmCode}</span> {name(l.alarmCode, l.equipmentId)}
                </div>
                <div className="text-xs text-slate-400">
                  {fmtDate(l.occurredAt)} · {l.cause} · 시도: {l.action} · {l.worker}
                </div>
              </li>
            ))}
            {!unresolved.length && <li className="text-slate-400">없음</li>}
          </ul>
        </Card>
        <Card title="이 근무조에 많이 난 알람">
          <ul className="space-y-1 text-sm">
            {top.map((t) => (
              <li key={t.alarmCode} className="flex gap-2">
                <span className="mono">{t.alarmCode}</span>
                <span className="text-slate-300">
                  {logs.find((l) => l.alarmCode === t.alarmCode) && name(t.alarmCode, logs.find((l) => l.alarmCode === t.alarmCode)!.equipmentId)}
                </span>
                <span className="ml-auto tabular-nums text-slate-400">
                  {t.count}건 · {fmtMin(t.downtimeMin)}
                </span>
              </li>
            ))}
            {!top.length && <li className="text-slate-400">기록 없음</li>}
          </ul>
        </Card>
        <Card title="다가오는 예방정비 · 검토 대기 제안">
          <ul className="space-y-1 text-sm">
            {overduePm.map((s) => (
              <li key={s.equipmentId + s.title} className="flex gap-2">
                <span className="mono">{s.equipmentId}</span>
                <span className="text-slate-300">{s.action}</span>
                <span className={`ml-auto text-xs ${s.overdue ? "text-red-300" : "text-slate-400"}`}>권장 {fmtDate(s.next, false)}</span>
              </li>
            ))}
          </ul>
          <div className="mt-3 border-t border-slate-800 pt-2">
            {pending.map((p) => (
              <Link key={p.id} href={`/improve#${encodeURIComponent(p.id)}`} className="flex items-center gap-2 py-0.5 text-sm hover:underline">
                <LevelBadge level={p.level} />
                <span className="truncate">{p.title}</span>
              </Link>
            ))}
          </div>
        </Card>
      </div>

      <Card title="조치 기록 (이 근무조)" bodyClass="p-0">
        <table className="w-full text-sm">
          <tbody>
            {logs.map((l) => (
              <tr key={l.id} className="border-b border-slate-800/60">
                <td className="mono px-3 py-1.5 text-slate-400">{fmtDate(l.occurredAt)}</td>
                <td className="mono">{l.equipmentId}</td>
                <td className="mono">{l.alarmCode}</td>
                <td>{l.cause}</td>
                <td className="text-slate-300">{l.action}</td>
                <td className={l.result === "해결" ? "text-emerald-300" : "text-red-300"}>{l.result}</td>
                <td className="pr-3 text-right text-slate-400">{l.durationMin}분</td>
              </tr>
            ))}
            {!logs.length && (
              <tr>
                <td className="px-3 py-4 text-slate-400">이 근무조에는 기록이 없습니다.</td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
