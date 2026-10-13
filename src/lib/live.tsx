"use client";

// 실시간 설비 상태 (가동·대기·정지·알람)
// 시제품은 PLC 대신 시뮬레이터가 상태와 디바이스 값을 만듭니다.
// 실제 적용 시에는 PLC 게이트웨이(MC 프로토콜·OPC UA)가 같은 모양의 값을 이 자리에 넣습니다.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { EQUIPMENT } from "@/data/equipment";
import { ALARM_SCENARIO_VALUES, RUN_VALUES, STOP_REASONS } from "@/data/programs";
import { useData } from "./store";
import type { ActiveAlarm, EquipStatus } from "./types";

export interface LiveEquip {
  id: string;
  status: EquipStatus;
  since: number;
  alarm: ActiveAlarm | null;
  reasonId: string | null;
  reason: string;
  values: Record<string, number>;
  count: number;
  pinned: boolean;
  recoverAt: number | null;
}

export interface LiveEvent {
  t: number;
  equipmentId: string;
  kind: EquipStatus;
  text: string;
}

export type Speed = "off" | "slow" | "normal" | "fast";

interface LiveState {
  ready: boolean;
  now: number;
  equips: Record<string, LiveEquip>;
  events: LiveEvent[];
  speed: Speed;
  setSpeed(s: Speed): void;
  triggerAlarm(equipmentId: string, code: string): void;
  triggerStop(equipmentId: string, reasonId: string): void;
  recover(equipmentId: string, text?: string): void;
  resetScene(): void;
  triggerShared(): void;
}

const Ctx = createContext<LiveState | null>(null);

const RATE: Record<string, number> = { COAT: 3, PRESS: 3, NOTCH: 6, STACK: 1 };
const SPEED_P: Record<Speed, number> = { off: 0, slow: 0.03, normal: 0.07, fast: 0.15 };

function valuesFor(alarmCode: string | null, reasonId: string | null): Record<string, number> {
  const v = { ...RUN_VALUES };
  if (alarmCode) Object.assign(v, ALARM_SCENARIO_VALUES[alarmCode] ?? {});
  if (reasonId) Object.assign(v, STOP_REASONS.find((s) => s.id === reasonId)?.values ?? {});
  return v;
}

export function LiveProvider({ children }: { children: ReactNode }) {
  const data = useData();
  const [equips, setEquips] = useState<Record<string, LiveEquip>>({});
  const [events, setEvents] = useState<LiveEvent[]>([]);
  const [now, setNow] = useState(0);
  const [speed, setSpeed] = useState<Speed>("slow");
  const [ready, setReady] = useState(false);
  const dataRef = useRef(data);
  dataRef.current = data;

  const alarmMeta = useCallback((equipmentId: string, code: string): ActiveAlarm | null => {
    const prog = dataRef.current.programOf(equipmentId);
    const a = prog?.alarms.find((x) => x.code === code);
    if (!a) return null;
    return { equipmentId, code, level: a.level, name: a.name, since: Date.now() };
  }, []);

  const scene = useCallback((): Record<string, LiveEquip> => {
    const t = Date.now();
    const base: Record<string, LiveEquip> = {};
    EQUIPMENT.forEach((e, i) => {
      base[e.id] = {
        id: e.id,
        status: "RUN",
        since: t - (20 + ((i * 37) % 180)) * 60000,
        alarm: null,
        reasonId: null,
        reason: "",
        values: valuesFor(null, null),
        count: 1200 + ((i * 7919) % 3000),
        pinned: false,
        recoverAt: null,
      };
    });
    // 시연 장면: 알람 4건 · 알람 없는 정지 2건 · 대기 1건
    const demo: [string, string | null, string | null, number][] = [
      ["NT-02", "E-1023", null, 4],
      ["ST-01", "E-2041", null, 2],
      ["NT-05", "E-1105", null, 1],
      ["RP-08", "E-4401", null, 0.5],
      ["RP-05", null, "door", 3],
      ["NT-10", null, "manual", 12],
      ["CT-03", null, "material", 6],
    ];
    for (const [id, code, reasonId, ago] of demo) {
      const since = t - ago * 60000;
      if (code) {
        const a = alarmMeta(id, code);
        base[id] = { ...base[id], status: "ALARM", since, alarm: a && { ...a, since }, values: valuesFor(code, null), pinned: true };
      } else if (reasonId) {
        const r = STOP_REASONS.find((s) => s.id === reasonId)!;
        base[id] = { ...base[id], status: r.status, since, reasonId, reason: r.label, values: valuesFor(null, reasonId), pinned: true };
      }
    }
    return base;
  }, [alarmMeta]);

  useEffect(() => {
    if (!data.ready || ready) return;
    setEquips(scene());
    setNow(Date.now());
    setEvents([{ t: Date.now(), equipmentId: "-", kind: "RUN", text: "시연 장면을 불러왔습니다 (알람 4 · 정지 2 · 대기 1)" }]);
    setReady(true);
  }, [data.ready, ready, scene]);

  const push = (e: Omit<LiveEvent, "t">) => setEvents((xs) => [{ ...e, t: Date.now() }, ...xs].slice(0, 60));

  // 알람 발생 가중치: 조치이력의 최근 발생 빈도에 비례
  const weights = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of data.logs) m.set(`${l.equipmentId}|${l.alarmCode}`, (m.get(`${l.equipmentId}|${l.alarmCode}`) ?? 0) + 1);
    return m;
  }, [data.logs]);

  useEffect(() => {
    if (!ready) return;
    const timer = setInterval(() => {
      const t = Date.now();
      setNow(t);
      setEquips((cur) => {
        const next = { ...cur };
        const newEvents: Omit<LiveEvent, "t">[] = [];
        for (const e of Object.values(next)) {
          if (e.status === "RUN") next[e.id] = { ...e, count: e.count + (Math.random() < 0.5 ? RATE[EQUIPMENT.find((x) => x.id === e.id)!.process] : 0) };
          else if (!e.pinned && e.recoverAt && t >= e.recoverAt) {
            next[e.id] = { ...e, status: "RUN", since: t, alarm: null, reasonId: null, reason: "", values: valuesFor(null, null), recoverAt: null };
            newEvents.push({ equipmentId: e.id, kind: "RUN", text: `${e.id} 가동 복귀 (${e.alarm ? `${e.alarm.code} 리셋` : e.reason})` });
          }
        }
        const p = SPEED_P[speed];
        const down = Object.values(next).filter((e) => e.status !== "RUN").length;
        if (p > 0 && down < 10 && Math.random() < p) {
          const runs = Object.values(next).filter((e) => e.status === "RUN");
          const target = runs[Math.floor(Math.random() * runs.length)];
          const prog = target && dataRef.current.programOf(target.id);
          if (target && prog) {
            const roll = Math.random();
            const recoverAt = t + (30 + Math.random() * 90) * 1000;
            if (roll < 0.72) {
              const ws = prog.alarms.map((a) => 1 + (weights.get(`${target.id}|${a.code}`) ?? 0));
              let x = Math.random() * ws.reduce((s, w) => s + w, 0);
              let alarm = prog.alarms[0];
              for (let i = 0; i < ws.length; i++)
                if ((x -= ws[i]) <= 0) {
                  alarm = prog.alarms[i];
                  break;
                }
              next[target.id] = {
                ...target,
                status: "ALARM",
                since: t,
                alarm: { equipmentId: target.id, code: alarm.code, level: alarm.level, name: alarm.name, since: t },
                values: valuesFor(alarm.code, null),
                recoverAt,
              };
              newEvents.push({ equipmentId: target.id, kind: "ALARM", text: `${target.id} [${alarm.level}] ${alarm.code} ${alarm.name}` });
            } else {
              const r = roll < 0.9 ? STOP_REASONS.find((s) => s.id === "material")! : STOP_REASONS.find((s) => s.id === "manual")!;
              next[target.id] = { ...target, status: r.status, since: t, reasonId: r.id, reason: r.label, values: valuesFor(null, r.id), recoverAt };
              newEvents.push({ equipmentId: target.id, kind: r.status, text: `${target.id} ${r.status === "IDLE" ? "대기" : "정지"} · ${r.label}` });
            }
          }
        }
        if (newEvents.length) setEvents((xs) => [...newEvents.map((e) => ({ ...e, t })), ...xs].slice(0, 60));
        return next;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [ready, speed, weights]);

  const value: LiveState = {
    ready,
    now,
    equips,
    events,
    speed,
    setSpeed,
    triggerAlarm(equipmentId, code) {
      const a = alarmMeta(equipmentId, code);
      if (!a) return;
      setEquips((cur) => ({
        ...cur,
        [equipmentId]: {
          ...cur[equipmentId],
          status: "ALARM",
          since: a.since,
          alarm: a,
          reasonId: null,
          reason: "",
          values: valuesFor(code, null),
          pinned: true,
          recoverAt: null,
        },
      }));
      push({ equipmentId, kind: "ALARM", text: `${equipmentId} [${a.level}] ${code} ${a.name}` });
    },
    triggerStop(equipmentId, reasonId) {
      const r = STOP_REASONS.find((s) => s.id === reasonId);
      if (!r) return;
      setEquips((cur) => ({
        ...cur,
        [equipmentId]: {
          ...cur[equipmentId],
          status: r.status,
          since: Date.now(),
          alarm: null,
          reasonId,
          reason: r.label,
          values: valuesFor(null, reasonId),
          pinned: true,
          recoverAt: null,
        },
      }));
      push({ equipmentId, kind: r.status, text: `${equipmentId} ${r.status === "IDLE" ? "대기" : "정지"} · ${r.label}` });
    },
    recover(equipmentId, text) {
      setEquips((cur) => {
        const e = cur[equipmentId];
        if (!e || e.status === "RUN") return cur;
        return {
          ...cur,
          [equipmentId]: {
            ...e,
            status: "RUN",
            since: Date.now(),
            alarm: null,
            reasonId: null,
            reason: "",
            values: valuesFor(null, null),
            pinned: false,
            recoverAt: null,
          },
        };
      });
      push({ equipmentId, kind: "RUN", text: text ?? `${equipmentId} 가동 복귀` });
    },
    triggerShared() {
      // 공용 냉각수 배관 압력 저하 → 롤프레스 3대가 거의 동시에 같은 외부 신호 알람 (설비 간 연쇄가 아님)
      const t = Date.now();
      const targets = ["RP-02", "RP-03", "RP-06"];
      setEquips((cur) => {
        const next = { ...cur };
        targets.forEach((id, i) => {
          const a = alarmMeta(id, "E-4302");
          if (a)
            next[id] = {
              ...next[id],
              status: "ALARM",
              since: t - i * 20000,
              alarm: { ...a, since: t - i * 20000 },
              reasonId: null,
              reason: "",
              values: valuesFor("E-4302", null),
              pinned: true,
              recoverAt: null,
            };
        });
        return next;
      });
      targets.forEach((id) => push({ equipmentId: id, kind: "ALARM", text: `${id} [중] E-4302 냉각수 유량 부족` }));
    },
    resetScene() {
      setEquips(scene());
      push({ equipmentId: "-", kind: "RUN", text: "시연 장면으로 되돌렸습니다" });
    },
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useLive(): LiveState {
  const v = useContext(Ctx);
  if (!v) throw new Error("LiveProvider 필요");
  return v;
}

export function elapsed(since: number, now: number): string {
  const s = Math.max(0, Math.floor((now - since) / 1000));
  if (s < 60) return `${s}초`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}분 ${String(s % 60).padStart(2, "0")}초`;
  return `${Math.floor(m / 60)}시간 ${m % 60}분`;
}

/** 가동 시간처럼 길게 이어지는 시간은 시:분:초로 (예: 1:23:45) */
export function hms(since: number, now: number): string {
  const s = Math.max(0, Math.floor((now - since) / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}:${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}
