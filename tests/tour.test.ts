import { describe, expect, it } from "vitest";
import { EQUIPMENT_BY_ID } from "@/data/equipment";
import { BUILTIN_PROGRAMS } from "@/data/programs";
import { TOUR } from "@/data/tour";
import { parseProgram } from "@/lib/ladder";
import { detectSequences } from "@/lib/sequence";

const progs = new Map(BUILTIN_PROGRAMS.map((p) => [p.id, parseProgram(p)]));

describe("5분 체험 순서", () => {
  it("모든 단계에 열 화면이나 실행 버튼이 있다", () => {
    for (const s of TOUR) expect(Boolean(s.href) || Boolean(s.trigger)).toBe(true);
  });

  it("단계가 가리키는 설비와 알람이 실제 데이터에 있다", () => {
    for (const s of TOUR.filter((x) => x.eq)) {
      const eq = EQUIPMENT_BY_ID.get(s.eq!);
      expect(eq, s.title).toBeTruthy();
      const prog = progs.get(eq!.programId)!;
      expect(prog.alarms.some((a) => a.code === s.code), `${s.eq} ${s.code}`).toBe(true);
    }
  });

  it("PLC 화면 링크의 프로그램에서 순차 동작을 찾는다", () => {
    const plc = TOUR.find((s) => s.href?.startsWith("/plc"))!;
    const id = new URL(plc.href!, "https://x").searchParams.get("view")!;
    expect(detectSequences(progs.get(id)!).length).toBeGreaterThan(0);
  });

  it("개선 제안 링크는 노칭 E-1105 제안을 가리킨다", () => {
    const imp = TOUR.find((s) => s.href?.startsWith("/improve"))!;
    expect(decodeURIComponent(imp.href!.split("#")[1])).toBe("debounce:NOTCH_V1:E-1105");
  });
});
