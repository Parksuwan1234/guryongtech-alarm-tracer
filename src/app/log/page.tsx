"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Btn, Card, LevelBadge } from "@/components/ui";
import { EQUIPMENT_BY_ID } from "@/data/equipment";
import { maskSensitive } from "@/lib/mask";
import { useData } from "@/lib/store";

const SAMPLES: { id: string; label: string; text: string }[] = [
  { id: "A", label: "A. 알람 번호만", text: "NT-02 E-1023" },
  {
    id: "B",
    label: "B. 긴 설비 로그",
    text: [
      "2026-10-13 07:58:12.031 [INFO ] NT-02 PLC 192.168.10.21:5002 CONNECTED",
      "2026-10-13 07:58:40.556 [INFO ] NT-02 RECIPE LOAD OK (CELL-A55) LOT-A2610130042",
      "2026-10-13 07:59:01.003 [INFO ] NT-02 AUTO START 사번:2019034",
      "2026-10-13 08:03:15.877 [WARN ] NT-02 SERVO Z TEMP 68C",
      "2026-10-13 08:07:44.120 [WARN ] NT-02 SERVO Z TEMP 70C",
      "2026-10-13 08:11:02.310 [INFO ] NT-02 PUNCH COUNT 412,330",
      "2026-10-13 08:12:03.014 [ALARM] NT-02 E-1023 Z-AXIS SERVO AMP OVERHEAT (M500 ON)",
      "2026-10-13 08:12:03.015 [INFO ] NT-02 CYCLE STOP",
      "2026-10-13 08:12:20.442 [INFO ] NT-02 OPERATOR CALL 사번:2021117",
      "2026-10-13 08:14:51.900 [INFO ] NT-02 RESET PRESSED",
      "2026-10-13 08:14:52.001 [ALARM] NT-02 E-1023 Z-AXIS SERVO AMP OVERHEAT (M500 ON)",
    ].join("\n"),
  },
  {
    id: "C",
    label: "C. 반복 비전 알람",
    text: [
      "10/13 06:41:10 ST-01 W RECIPE CHANGED → CELL-HS (고속)",
      "10/13 06:52:31 ST-01 E-2041 VISION RESPONSE TIMEOUT 3.21s",
      "10/13 07:05:12 ST-01 E-2041 VISION RESPONSE TIMEOUT 3.38s",
      "10/13 07:31:47 ST-02 E-2041 VISION RESPONSE TIMEOUT 3.12s",
      "10/13 07:58:03 ST-01 E-2041 VISION RESPONSE TIMEOUT 3.44s",
    ].join("\n"),
  },
  {
    id: "D",
    label: "D. 외부 신호 대기",
    text: [
      "10/13 09:10:02 NT-07 W-1401 MES ORDER NOT RECEIVED (B0010 OFF) host=10.20.3.14",
      "10/13 09:10:02 NT-08 W-1401 MES ORDER NOT RECEIVED (B0010 OFF)",
    ].join("\n"),
  },
];

export default function LogPage() {
  const data = useData();
  const [text, setText] = useState(SAMPLES[1].text);
  const masked = useMemo(() => maskSensitive(text), [text]);
  const found = useMemo(() => {
    const out: { eq: string; code: string; count: number; values: string[] }[] = [];
    for (const line of text.split(/\r?\n/)) {
      const eq = line.match(/\b(CT|RP|NT|ST)-\d{2}\b/)?.[0];
      const codes = line.match(/\b[EW]-\d{4}\b/g) ?? [];
      for (const code of codes) {
        if (!eq) continue;
        const prog = data.programOf(eq);
        if (!prog?.alarms.some((a) => a.code === code)) continue;
        const cur = out.find((x) => x.eq === eq && x.code === code);
        const v = line.match(/(\d+\.\d+)s\b/)?.[1];
        if (cur) {
          cur.count++;
          if (v) cur.values.push(v);
        } else out.push({ eq, code, count: 1, values: v ? [v] : [] });
      }
    }
    return out;
  }, [text, data]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">로그 분석 (보조 입력)</h1>
        <p className="mt-1 text-sm text-slate-400">
          레이아웃에 없는 알람이나 지난 로그를 여기에 붙여 넣으면 해당 알람 상세(래더 역추적)로 갈 수 있습니다. 설비 번호와 알람 번호는 코드가 찾습니다. 외부
          AI로 보낼 때는 민감한 값을 먼저 가립니다.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {SAMPLES.map((s) => (
          <Btn key={s.id} tone="ghost" className="border border-slate-700" onClick={() => setText(s.text)}>
            {s.label}
          </Btn>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="원본 로그">
          <textarea
            className="mono h-72 w-full rounded-md border border-slate-700 bg-slate-950 p-2 text-xs text-slate-200"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </Card>
        <Card
          title={`AI로 보낼 때 (민감 값 ${masked.count}개 가림)`}
          right={
            <span className="text-[11px] text-slate-400">
              {Object.entries(masked.byRule)
                .map(([k, v]) => `${k} ${v}`)
                .join(" · ")}
            </span>
          }
        >
          <pre className="mono h-72 overflow-auto whitespace-pre-wrap rounded-md bg-black/40 p-2 text-xs text-slate-400">{masked.text}</pre>
        </Card>
      </div>
      <Card title={`찾은 알람 ${found.length}건`}>
        <ul className="space-y-2">
          {found.map((f) => {
            const prog = data.programOf(f.eq)!;
            const a = prog.alarms.find((x) => x.code === f.code)!;
            const props = data.proposals.filter((p) => p.alarmCode === f.code && p.programId === prog.id);
            return (
              <li key={f.eq + f.code} className="flex flex-wrap items-center gap-2 rounded-lg bg-slate-800/50 p-2 text-sm">
                <LevelBadge level={a.level} />
                <span className="mono font-semibold">{f.eq}</span>
                <span className="text-slate-400">{EQUIPMENT_BY_ID.get(f.eq)?.name}</span>
                <span className="mono">{f.code}</span> {a.name}
                <span className="text-xs text-slate-400">
                  로그 {f.count}회{f.values.length ? ` · 측정 ${f.values.join(", ")}초` : ""}
                </span>
                {props[0] && (
                  <Link href={`/improve#${encodeURIComponent(props[0].id)}`} className="text-xs text-sky-300 hover:underline">
                    재발 방지안 있음
                  </Link>
                )}
                <Link href={`/alarm/${f.eq}/${f.code}`} className="ml-auto rounded-md bg-sky-700 px-3 py-1 text-xs font-semibold text-white hover:bg-sky-800">
                  래더 역추적 →
                </Link>
              </li>
            );
          })}
          {!found.length && <li className="text-sm text-slate-400">설비 번호(예: NT-02)와 알람 번호(예: E-1023)가 같은 줄에 있어야 찾을 수 있습니다.</li>}
        </ul>
      </Card>
    </div>
  );
}
