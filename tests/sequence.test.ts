import { describe, expect, it } from "vitest";
import { ALARM_SCENARIO_VALUES, BUILTIN_PROGRAMS, RUN_VALUES } from "@/data/programs";
import { parseProgram, traceAlarm } from "@/lib/ladder";
import { detectSequences, sequencePosition, sequencesForAlarm } from "@/lib/sequence";
import type { PlcProgram } from "@/lib/types";

const progs = Object.fromEntries(BUILTIN_PROGRAMS.map((p) => [p.id, parseProgram(p)]));

describe("순차 동작(시퀀스) 찾기", () => {
  const [seq] = detectSequences(progs.STACK_V1);

  it("스태킹 적층 시퀀스 7단계를 순서대로 찾는다", () => {
    expect(detectSequences(progs.STACK_V1).length).toBe(1);
    expect(seq.steps.map((s) => s.device)).toEqual(["M400", "M401", "M402", "M403", "M404", "M405", "M406"]);
    expect(seq.steps[4].label).toBe("S4 적층 하강");
    expect(seq.style).toBe("set-rst");
  });

  it("넘어가는 조건에서 지금 단계 비트는 빼고, 마지막 단계는 처음으로 돌아간다", () => {
    const t0 = seq.transitions.find((t) => t.from === "M400")!;
    expect(t0.to).toBe("M401");
    expect(t0.conditions.map((c) => c.device)).toEqual(["M2", "X240"]);
    expect(t0.conditions[1].where).toContain("상승단");
    const back = seq.transitions.find((t) => t.from === "M406")!;
    expect(back.to).toBe("M400");
    expect(back.loopBack).toBe(true);
    expect(back.conditions).toEqual([]);
  });

  it("단계별 출력과 1사이클 완료 비트를 단계에 붙인다", () => {
    const s1 = seq.steps.find((s) => s.device === "M401")!;
    expect(s1.actions.map((a) => a.device)).toEqual(["Y240", "Y241"]);
    expect(seq.steps.find((s) => s.device === "M406")!.actions.map((a) => a.device)).toEqual(["M65"]);
  });

  it("감시 타이머 T65(12.0초)와 W-2502를 시퀀스에 잇는다 — 시퀀스와 무관한 E-2041은 잇지 않는다", () => {
    const w = seq.watches.find((x) => x.timer === "T65")!;
    expect(w.seconds).toBe(12);
    expect(w.watches).toEqual([{ device: "M65", comment: "적층 1사이클 완료", negated: true }]);
    expect(w.alarms.map((a) => a.code)).toEqual(["W-2502"]);
    expect(seq.alarms.map((a) => a.code)).toContain("W-2502");
    expect(seq.alarms.map((a) => a.code)).not.toContain("E-2041");
    expect(sequencesForAlarm([seq], "W-2502").length).toBe(1);
  });

  it("시퀀스가 없는 프로그램(사이클 자기유지 M2만 있는 곳)은 시퀀스로 보지 않는다", () => {
    for (const id of ["NOTCH_V1", "COAT_V1", "PRESS_V1"]) expect(detectSequences(progs[id])).toEqual([]);
  });

  it("알람 순간 값으로 '지금 단계와 기다리는 조건'을 계산한다 (W-2502: S4에서 X243 대기)", () => {
    const pos = sequencePosition(progs.STACK_V1, seq, { ...RUN_VALUES, ...ALARM_SCENARIO_VALUES["W-2502"] });
    expect(pos.known).toBe(true);
    expect(pos.active.map((a) => a.step.device)).toEqual(["M404"]);
    const n = pos.active[0].next[0];
    expect(n.transition.to).toBe("M405");
    expect(n.ready).toBe(false);
    expect(n.conditions.map((c) => `${c.device}:${c.ok}`)).toEqual(["X243:false"]);
  });

  it("단계 값이 스냅샷에 없으면 '모름'으로 둔다 (지어내지 않음)", () => {
    expect(sequencePosition(progs.STACK_V1, seq, RUN_VALUES)).toEqual({ known: false, active: [] });
  });

  it("역추적은 시퀀스 비트에서 멈추고, 어느 시퀀스인지 표시한다", () => {
    const t = traceAlarm(progs.STACK_V1, "W-2502", { ...RUN_VALUES, ...ALARM_SCENARIO_VALUES["W-2502"] })!;
    const m65 = t.leaves.find((l) => l.device === "M65")!;
    expect(m65.sequence).toBe("M400");
    expect(m65.children).toEqual([]);
    expect(t.primarySource).toBe("래더 로직");
  });

  it("자기유지 방식 단계(LD 앞단계 AND 조건 OR 자기 ANI 다음단계 OUT 자기)도 찾는다", () => {
    const csv = (rows: string[][]) => ["스텝,명령,디바이스,설정값,코멘트", ...rows.map((r, i) => [i, ...r].join(","))].join("\n");
    const p: PlcProgram = {
      id: "T",
      name: "t",
      ladderCsv: csv([
        ["LD", "X0", "", "시작"], ["OR", "M10", "", ""], ["ANI", "M11", "", ""], ["OUT", "M10", "", "1단계"],
        ["LD", "M10", "", ""], ["AND", "X1", "", "1단계 완료"], ["OR", "M11", "", ""], ["ANI", "M12", "", ""], ["OUT", "M11", "", "2단계"],
        ["LD", "M11", "", ""], ["AND", "X2", "", "2단계 완료"], ["OR", "M12", "", ""], ["ANI", "M13", "", ""], ["OUT", "M12", "", "3단계"],
        ["LD", "M12", "", ""], ["AND", "X3", "", "3단계 완료"], ["OR", "M13", "", ""], ["OUT", "M13", "", "4단계"],
      ]),
      devicesCsv: "디바이스,코멘트\n",
      alarmsCsv: "알람번호,디바이스,등급,알람명\n",
    };
    const s = detectSequences(parseProgram(p));
    expect(s.length).toBe(1);
    expect(s[0].steps.map((x) => x.device)).toEqual(["M10", "M11", "M12", "M13"]);
    expect(s[0].style).toBe("self-hold");
    expect(s[0].transitions.find((t) => t.from === "M11")!.conditions.map((c) => c.device)).toEqual(["X2"]);
  });

  it("같은 래더면 결과가 매번 같다", () => {
    const a = JSON.stringify(detectSequences(progs.STACK_V1), (_, v) => (v instanceof Set ? Array.from(v) : v));
    const b = JSON.stringify(detectSequences(progs.STACK_V1), (_, v) => (v instanceof Set ? Array.from(v) : v));
    expect(a).toBe(b);
  });
});
