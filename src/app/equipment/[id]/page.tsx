"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useMemo } from "react";
import { WhyNotView } from "@/components/Trace";
import { Btn, Card, EquipIcon, HBars, LevelBadge, Stat, StatusBadge } from "@/components/ui";
import { EQUIPMENT_BY_ID, PROCESS_LABEL } from "@/data/equipment";
import { alarmStats, fmtDate, fmtMin, reliability, since, weeklyCounts } from "@/lib/analytics";
import { EQUIPMENT } from "@/data/equipment";
import { Term } from "@/components/Help";
import { whyNot } from "@/lib/ladder";
import { elapsed, useLive } from "@/lib/live";
import { KIND_LABEL } from "@/lib/propose";
import { useData } from "@/lib/store";

export default function EquipmentPage() {
  const { id } = useParams<{ id: string }>();
  const data = useData();
  const live = useLive();
  const e = EQUIPMENT_BY_ID.get(id);
  const s = live.equips[id];
  const prog = data.programOf(id);
  const why = useMemo(() => (prog && s ? whyNot(prog, "M0", s.values) : null), [prog, s]);
  const logs = useMemo(() => since(data.logs, 90).filter((l) => l.equipmentId === id), [data.logs, id]);
  const stats = useMemo(() => alarmStats(logs), [logs]);
  const props = data.proposals.filter((p) => p.appliesTo.includes(id));
  // 신뢰성 지표(최근 30일)와 같은 공정 평균 비교
  const rel = useMemo(() => {
    const recent = since(data.logs, 30);
    const mine = reliability(
      recent.filter((l) => l.equipmentId === id),
      30,
    );
    const peers = EQUIPMENT.filter((x) => x.process === e?.process);
    const fleet = peers.map((x) =>
      reliability(
        recent.filter((l) => l.equipmentId === x.id),
        30,
      ),
    );
    const avg = (f: (r: (typeof fleet)[number]) => number) => fleet.reduce((a, r) => a + f(r), 0) / Math.max(1, fleet.length);
    const rank = [...fleet].sort((a, b) => b.downMin - a.downMin).findIndex((r) => r === fleet[peers.findIndex((x) => x.id === id)]) + 1;
    return {
      mine,
      avgMtbf: avg((r) => r.mtbfH),
      avgMttr: avg((r) => r.mttrMin),
      avgDown: avg((r) => r.downMin),
      fleetCount: fleet.reduce((a, r) => a + r.count, 0),
      n: peers.length,
      rank,
    };
  }, [data.logs, id, e?.process]);
  const weeks = useMemo(
    () =>
      weeklyCounts(
        data.logs.filter((l) => l.equipmentId === id),
        13,
      ),
    [data.logs, id],
  );
  if (!e || !s || !prog) return <div className="text-slate-400">설비를 찾을 수 없습니다.</div>;
  const downtime = logs.reduce((a, l) => a + l.durationMin, 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/" className="text-sm text-slate-400 hover:text-slate-200">
          ← 실시간 현황
        </Link>
        <EquipIcon process={e.process} className="h-8 w-8 text-slate-300" />
        <h1 className="text-xl font-semibold">
          <span className="mono">{e.id}</span> {e.name}
        </h1>
        <StatusBadge status={s.status} level={s.alarm?.level} />
        <span className="text-sm text-slate-400">{elapsed(s.since, live.now)} 경과</span>
        <span className="ml-auto text-sm text-slate-400">
          {PROCESS_LABEL[e.process]} {e.polarity && `· ${e.polarity}`} · PLC <span className="mono">{prog.id}</span>
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Stat label="최근 90일 알람·조치" value={`${logs.length}건`} />
        <Stat label="정지 시간 합계" value={fmtMin(downtime)} />
        <Stat label="평균 조치 시간" value={logs.length ? `${Math.round(downtime / logs.length)}분` : "-"} />
        <Stat label="해당 개선 제안" value={`${props.length}건`} tone="text-sky-300" />
      </div>

      <Card
        title="조치 기록으로 본 지표 (최근 30일, 근사치)"
        right={
          <span className="text-[11px] text-amber-200/90">
            운전 시간과 고장 이벤트 기록이 없어 조치 기록으로 대신 계산했습니다. 기록을 많이 남긴 설비가 나빠 보일 수 있습니다. 실제 MTBF, MTTR은 PLC 정지
            이벤트로 계산합니다.
          </span>
        }
      >
        <div className="grid gap-4 md:grid-cols-[repeat(3,minmax(0,1fr))_minmax(0,1.4fr)]">
          <Metric
            label="조치 기록 건수"
            value={`${rel.mine.count}건`}
            sub={`같은 공정 평균 ${(rel.fleetCount / Math.max(1, rel.n)).toFixed(1)}건, 기록 간 평균 간격 ${rel.mine.mtbfH.toFixed(0)}시간(`}
            subTerm={<Term k="MTBF">MTBF 근사</Term>}
            bad={rel.mine.mtbfH < rel.avgMtbf * 0.8}
          />
          <Metric
            label={
              <>
                기록된 평균 조치 시간 (<Term k="MTTR">MTTR 근사</Term>)
              </>
            }
            value={`${rel.mine.mttrMin.toFixed(0)}분`}
            sub={`같은 공정 평균 ${rel.avgMttr.toFixed(0)}분`}
            bad={rel.mine.mttrMin > rel.avgMttr * 1.2}
          />
          <Metric
            label="기록된 조치 시간 합계"
            value={fmtMin(rel.mine.downMin)}
            sub={`같은 공정 ${rel.n}대 중 ${rel.rank}번째로 김`}
            bad={rel.rank === 1 && rel.mine.downMin > rel.avgDown}
          />
          <div>
            <div className="text-[11px] text-slate-400">주별 알람·조치 건수 (13주)</div>
            <div className="mt-1 flex h-12 items-end gap-1">
              {weeks.map((n, i) => (
                <div
                  key={i}
                  title={`${13 - i}주 전 · ${n}건`}
                  className={`flex-1 rounded-t ${i >= weeks.length - 4 ? "bg-sky-400/80" : "bg-slate-600"}`}
                  style={{ height: `${Math.max(4, (n / Math.max(1, ...weeks)) * 100)}%` }}
                />
              ))}
            </div>
            <div className="mt-1 text-[11px] text-slate-400">
              최근 4주 {weeks.slice(-4).reduce((a, b) => a + b, 0)}건 · 그 전 4주 {weeks.slice(-8, -4).reduce((a, b) => a + b, 0)}건
            </div>
          </div>
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="지금 상태">
          {s.alarm ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <LevelBadge level={s.alarm.level} />
                <span className="mono font-semibold">{s.alarm.code}</span>
                {s.alarm.name}
              </div>
              <Link
                href={`/alarm/${id}/${s.alarm.code}`}
                className="inline-block rounded-md bg-sky-700 px-3 py-2 text-sm font-semibold text-white hover:bg-sky-800"
              >
                원인과 할 일 보기 →
              </Link>
            </div>
          ) : null}
          {why && (
            <div className={s.alarm ? "mt-4 border-t border-slate-800 pt-3" : ""}>
              <div className="mb-2 text-xs text-slate-400">알람 없이 멈춘 이유 (자동운전 조건 역추적)</div>
              <WhyNotView r={why} equipmentId={id} />
              {s.status !== "RUN" && !s.alarm && (
                <Btn tone="success" className="mt-3" onClick={() => live.recover(id, `${id} 조건 복구 후 가동 복귀`)}>
                  조건 복구 확인 후 가동
                </Btn>
              )}
            </div>
          )}
        </Card>

        <Card title="알람별 정지 시간 (최근 90일)">
          {stats.length ? (
            <HBars
              items={stats.slice(0, 8).map((st) => ({
                label: (
                  <Link href={`/alarm/${id}/${st.alarmCode}`} className="hover:underline">
                    <span className="mono">{st.alarmCode}</span> {prog.alarms.find((a) => a.code === st.alarmCode)?.name}
                  </Link>
                ),
                value: Math.round(st.downtimeMin),
                tone: prog.alarms.find((a) => a.code === st.alarmCode)?.level === "중" ? "bg-red-500/70" : "bg-orange-400/70",
                sub: <span className="text-slate-400"> · {st.count}건</span>,
              }))}
              unit="분"
            />
          ) : (
            <div className="text-sm text-slate-400">기록 없음</div>
          )}
        </Card>
      </div>

      {props.length > 0 && (
        <Card title="이 설비에 해당하는 개선 제안" right={<span className="text-[11px] text-slate-400">정지 감소 시간은 과거 기록으로 낸 추정치</span>}>
          <div className="grid gap-2 md:grid-cols-2">
            {props.map((p) => (
              <Link
                key={p.id}
                href={`/improve#${encodeURIComponent(p.id)}`}
                className="rounded-lg border border-slate-800 bg-slate-800/40 p-3 hover:bg-slate-800"
              >
                <div className="text-[11px] text-sky-300">{KIND_LABEL[p.kind]}</div>
                <div className="text-sm">{p.title}</div>
                <div className="text-xs text-slate-400">연 {Math.round(p.effect.perYearMin / 60)}시간 정지 감소</div>
              </Link>
            ))}
          </div>
        </Card>
      )}

      <Card
        title="최근 조치이력"
        right={
          <Link href={`/history?eq=${id}`} className="text-xs text-sky-300 hover:underline">
            전체 보기 →
          </Link>
        }
        bodyClass="p-0"
      >
        <table className="w-full text-sm">
          <thead className="text-left text-[11px] text-slate-400">
            <tr className="border-b border-slate-800">
              <th className="px-3 py-1.5">시각</th>
              <th>알람</th>
              <th>원인</th>
              <th>조치</th>
              <th>결과</th>
              <th className="pr-3 text-right">시간</th>
            </tr>
          </thead>
          <tbody>
            {logs.slice(0, 12).map((l) => (
              <tr key={l.id} className="border-b border-slate-800/60">
                <td className="mono px-3 py-1.5 text-slate-400">{fmtDate(l.occurredAt)}</td>
                <td className="mono">{l.alarmCode}</td>
                <td>{l.cause}</td>
                <td className="text-slate-300">{l.action}</td>
                <td className={l.result === "해결" ? "text-emerald-300" : "text-red-300"}>{l.result}</td>
                <td className="pr-3 text-right tabular-nums text-slate-400">{l.durationMin}분</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

function Metric({ label, value, sub, subTerm, bad }: { label: React.ReactNode; value: string; sub: string; subTerm?: React.ReactNode; bad?: boolean }) {
  return (
    <div>
      <div className="text-[11px] text-slate-400">{label}</div>
      <div className={`text-xl font-semibold tabular-nums ${bad ? "text-orange-300" : "text-slate-100"}`}>{value}</div>
      <div className="text-[11px] text-slate-400">
        {sub}
        {subTerm && <>{subTerm})</>}
        {bad && <span className="text-orange-300"> · 같은 공정 평균보다 나쁨(기록 기준)</span>}
      </div>
    </div>
  );
}
