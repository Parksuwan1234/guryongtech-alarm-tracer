import { describe, expect, it } from "vitest";
import { ALARM_SCENARIO_VALUES, BUILTIN_PROGRAMS, RUN_VALUES, STOP_REASONS } from "@/data/programs";
import { buildRungs, debounceChange, lineDiff, parseProgram, timerChange, traceAlarm, whereUsed, whyNot } from "@/lib/ladder";

const progs = Object.fromEntries(BUILTIN_PROGRAMS.map((p) => [p.id, parseProgram(p)]));

describe("파싱", () => {
  it("4개 프로그램 모두 래더·디바이스·알람을 읽는다", () => {
    for (const p of Object.values(progs)) {
      expect(p.rows.length).toBeGreaterThan(30);
      expect(p.alarms.length).toBeGreaterThanOrEqual(5);
      for (const a of p.alarms) expect(p.devices.has(a.device)).toBe(true);
    }
  });
  it("회로는 OUT 뒤의 LD에서 나뉜다", () => {
    const rungs = buildRungs(progs.NOTCH_V1.rows);
    const m0 = rungs.find((r) => r.outputs.some((o) => o.device === "M0"))!;
    expect(m0.contacts.map((c) => c.device)).toEqual(["X00", "X01", "X02", "M1", "B0010", "X05"]);
  });
});

describe("역추적", () => {
  it("모든 알람이 시나리오 값에서 성립하고 원천에 도달한다", () => {
    for (const p of Object.values(progs)) {
      for (const a of p.alarms) {
        const values = { ...RUN_VALUES, ...ALARM_SCENARIO_VALUES[a.code] };
        const t = traceAlarm(p, a.code, values)!;
        expect(t, a.code).not.toBeNull();
        expect(t.root.value, `${a.code} 알람 코일이 켜져야 함`).toBe(1);
        expect(t.leaves.length, a.code).toBeGreaterThan(0);
        expect(t.primarySource, a.code).not.toBeNull();
      }
    }
  });

  it("E-1023: 범인 접점은 X1A3 하나 (온도 71℃는 기준 미만)", () => {
    const t = traceAlarm(progs.NOTCH_V1, "E-1023", { ...RUN_VALUES, ...ALARM_SCENARIO_VALUES["E-1023"] })!;
    expect(t.culprits.map((c) => c.device)).toEqual(["X1A3"]);
    expect(t.primarySource).toBe("현장 입력");
    const d200 = t.leaves.find((l) => l.device === "D200")!;
    expect(d200.satisfied).toBe(false);
  });

  it("자기유지·리셋 접점은 원인으로 따라가지 않는다", () => {
    const t = traceAlarm(progs.NOTCH_V1, "E-1105", { ...RUN_VALUES, ...ALARM_SCENARIO_VALUES["E-1105"] })!;
    const roles = t.root.children.map((c) => `${c.device}:${c.role}`);
    expect(roles).toContain("M510:selfhold");
    expect(roles).toContain("X0F:reset");
    expect(roles).toContain("M2:state");
    expect(t.culprits.map((c) => c.device)).toEqual(["X120"]);
  });

  it("E-2041: 타이머 T60(K30)을 거쳐 외부 신호 B0200에 도달", () => {
    const t = traceAlarm(progs.STACK_V1, "E-2041", { ...RUN_VALUES, ...ALARM_SCENARIO_VALUES["E-2041"] })!;
    expect(t.timersInPath.map((x) => `${x.device}:${x.setValue}`)).toEqual(["T60:K30"]);
    expect(t.culprits.map((c) => c.device)).toEqual(["B0200"]);
    expect(t.primarySource).toBe("외부 신호");
  });

  it("W-2502: 범인 접점이 없으면 래더 로직(시퀀스·타이머)으로 분류", () => {
    const t = traceAlarm(progs.STACK_V1, "W-2502", { ...RUN_VALUES, ...ALARM_SCENARIO_VALUES["W-2502"] })!;
    expect(t.primarySource).toBe("래더 로직");
    expect(t.timersInPath[0].setValue).toBe("K120");
  });

  it("값이 평상시면 알람이 성립하지 않는다", () => {
    const t = traceAlarm(progs.NOTCH_V1, "E-1023", RUN_VALUES)!;
    expect(t.root.value).toBe(0);
    expect(t.culprits.length).toBe(0);
  });

  it("같은 입력이면 결과가 매번 같다 (결정적)", () => {
    const v = { ...RUN_VALUES, ...ALARM_SCENARIO_VALUES["E-1120"] };
    const a = JSON.stringify(traceAlarm(progs.NOTCH_V1, "E-1120", v));
    const b = JSON.stringify(traceAlarm(progs.NOTCH_V1, "E-1120", v));
    expect(a).toBe(b);
  });
});

describe("알람 없는 정지 진단(Why-not)", () => {
  it("안전도어가 열리면 자동운전 조건 7개 중 X01이 막는다", () => {
    const door = STOP_REASONS.find((s) => s.id === "door")!;
    const r = whyNot(progs.NOTCH_V1, "M0", door.values)!;
    expect(r.on).toBe(false);
    expect(r.totalConditions).toBe(6);
    expect(r.blocking.map((b) => b.device)).toEqual(["X01"]);
  });
  it("중알람이 있으면 M1(중알람 있음)이 막는다", () => {
    const r = whyNot(progs.PRESS_V1, "M0", { ...RUN_VALUES, ...ALARM_SCENARIO_VALUES["E-4210"] })!;
    expect(r.blocking.map((b) => b.device)).toEqual(["M1"]);
  });
  it("모든 조건이 맞으면 막힌 조건이 없다", () => {
    const r = whyNot(progs.COAT_V1, "M0", {})!;
    expect(r.on).toBe(true);
    expect(r.blocking).toEqual([]);
  });
});

describe("래더 변경안", () => {
  it("디바운스: 트리거 뒤에 지속 판정 타이머를 끼우고 자기유지·리셋은 유지", () => {
    const c = debounceChange(progs.NOTCH_V1, "M510", 3)!;
    const T = c.newDevice!;
    expect(T).toBe("T24"); // 기존 T20~T23 다음 빈 번호
    const added = c.diff.filter((d) => d.mark === "+").map((d) => d.text);
    expect(added.some((t) => t.includes("OUT") && t.includes(T) && t.includes("K3"))).toBe(true);
    expect(added.some((t) => t.startsWith("LD") && t.includes(T))).toBe(true);
    expect(c.after.some((t) => t.includes("ANI") && t.includes("X0F"))).toBe(true);
  });
  it("디바운스 적용 후 순간 신호로는 알람이 켜지지 않는 구조가 된다", () => {
    const c = debounceChange(progs.NOTCH_V1, "M510", 3)!;
    const idxOutT = c.after.findIndex((t) => t.includes(c.newDevice!) && t.startsWith("OUT"));
    const idxCoil = c.after.findIndex((t) => t.startsWith("OUT") && t.includes("M510"));
    expect(idxOutT).toBeGreaterThan(-1);
    expect(idxCoil).toBeGreaterThan(idxOutT);
  });
  it("타이머 설정값 변경안", () => {
    const c = timerChange(progs.STACK_V1, "T60", 38)!;
    expect(c.title).toContain("K30 → K38");
    expect(c.diff.filter((d) => d.mark === "-").length).toBe(1);
    expect(c.diff.filter((d) => d.mark === "+").length).toBe(1);
  });
  it("사용처 검색: T60은 출력 1곳, 접점 1곳", () => {
    const u = whereUsed(progs.STACK_V1, "T60");
    expect(u.filter((x) => x.kind === "출력").length).toBe(1);
    expect(u.filter((x) => x.kind === "접점").length).toBe(1);
  });
  it("줄 비교", () => {
    const d = lineDiff(["a", "b", "c"], ["a", "x", "c"]);
    expect(d.map((x) => x.mark).join("")).toBe(" -+ ");
  });
});

describe("병렬 분기 (ChatGPT 검토 2번)", () => {
  const prog = parseProgram({
    id: "T",
    name: "분기 시험",
    ladderCsv:
      "스텝,명령,디바이스,설정값,코멘트\n0,LD,B1,,외부 신호\n1,AND,X2,,현장 입력 A\n2,OR,X3,,현장 입력 B\n3,OR,M900,,자기유지\n4,ANI,X0F,,리셋\n5,OUT,M900,,시험 알람",
    devicesCsv:
      "디바이스,코멘트,원천구분,평상값,역할,확인처\nB1,외부 신호,외부 신호,0,,\nX2,현장 A,현장 입력,0,,\nX3,현장 B,현장 입력,0,,\nX0F,리셋,현장 입력,0,리셋,",
    alarmsCsv: "알람번호,디바이스,등급,알람명\nE-9000,M900,경,시험",
  });
  it("B1·X2 분기가 불성립이면 B1은 원인이 아니고 X3만 원인", () => {
    const t = traceAlarm(prog, "E-9000", { B1: 1, X2: 0, X3: 1 })!;
    expect(t.root.value).toBe(1);
    expect(t.culprits.map((c) => c.device)).toEqual(["X3"]);
    expect(t.primarySource).toBe("현장 입력");
    expect(t.leaves.find((l) => l.device === "B1")!.contributing).toBe(false);
  });
  it("두 분기가 모두 성립하면 둘 다 원인 후보", () => {
    const t = traceAlarm(prog, "E-9000", { B1: 1, X2: 1, X3: 1 })!;
    expect(t.culprits.map((c) => c.device).sort()).toEqual(["B1", "X2", "X3"]);
  });
});
