import { describe, expect, it } from "vitest";
import { bestMatchingHistory, matchingHistory, ruleExplain, explainLines } from "@/lib/explain";
import type { CauseStat } from "@/lib/analytics";
import { MANUALS } from "@/data/manuals";
import { EQUIPMENT } from "@/data/equipment";
import { BUILTIN_PROGRAMS, RUN_VALUES, ALARM_SCENARIO_VALUES } from "@/data/programs";
import { parseProgram, traceAlarm } from "@/lib/ladder";
const row = (cause: string, action: string, extra: Partial<CauseStat> = {}): CauseStat => ({
  cause, action, actionType: "청소", tries: 13, resolved: 13, avgMin: 5, lastAt: "2026-10-15", evidence: "근거 충분", ...extra,
});
const rows = [row("렌즈 오염", "센서 청소"), row("전극 펄럭임", "장력 확인", { tries: 3, resolved: 2 }), row("전극 펄럭임", "리셋", {actionType:"리셋"})];
describe("원인과 조치 이력 연결 회귀", () => {
  it("펄럭임 후보에 렌즈 청소 13/13을 붙이지 않는다", () => expect(bestMatchingHistory(rows, "전극 펄럭임")?.action).toBe("장력 확인"));
  it("선택을 바꾸면 해당 원인의 이력으로 바뀐다", () => expect(bestMatchingHistory(rows, "렌즈 오염")?.action).toBe("센서 청소"));
  it("일치 항목이 없으면 다른 원인으로 대체하지 않는다", () => expect(bestMatchingHistory(rows, "단선")).toBeUndefined());
  it("후보가 없으면 추천하지 않는다", () => expect(matchingHistory(rows)).toEqual([]));
  it("리셋 기록을 해결 조치로 추천하지 않는다", () => expect(bestMatchingHistory([rows[2]], "전극 펄럭임")).toBeUndefined());
  it("해결 0건을 과거 해결 사례로 추천하지 않는다", () => expect(bestMatchingHistory([row("단선", "확인", {resolved:0})], "단선")).toBeUndefined());
  const prog = parseProgram(BUILTIN_PROGRAMS.find(p => p.id === "NOTCH_V1")!);
  const trace = traceAlarm(prog, "E-1023", {...RUN_VALUES, ...ALARM_SCENARIO_VALUES["E-1023"]})!;
  const manual = {...MANUALS[0], cause:"전극 펄럭임"};
  it("규칙 설명은 선택한 원인의 조치만 연결한다", () => {
    const result = ruleExplain(trace, [manual], rows, "", []);
    expect(result).toContain("장력 확인"); expect(result).not.toContain("센서 청소");
  });
  it("AI 근거에도 다른 원인의 조치를 섞지 않는다", () => {
    const result = explainLines(EQUIPMENT[0], trace, [manual], rows, "", []).join("\n");
    expect(result).toContain("장력 확인"); expect(result).not.toContain("센서 청소");
  });
});
