import { describe, expect, it } from "vitest";
import { EQUIPMENT } from "@/data/equipment";
import { MANUALS } from "@/data/manuals";
import { BUILTIN_PROGRAMS } from "@/data/programs";
import { generateSeedLogs } from "@/data/seed";
import { parseProgram } from "@/lib/ladder";
import { buildProposals, isInManual } from "@/lib/propose";

const NOW = new Date("2026-10-14T05:00:00Z");
const logs = generateSeedLogs(NOW);
const programs = new Map(BUILTIN_PROGRAMS.map((p) => [p.id, parseProgram(p)]));
const assignment = Object.fromEntries(EQUIPMENT.map((e) => [e.id, e.programId]));
const props = buildProposals({ logs, programs, assignment, manuals: MANUALS, now: NOW.getTime() });
const byId = new Map(props.map((p) => [p.id, p]));

describe("시드 데이터", () => {
  it("같은 시드면 같은 데이터", () => {
    expect(JSON.stringify(generateSeedLogs(NOW))).toBe(JSON.stringify(logs));
  });
  it("수백 건, 최근 90일 안", () => {
    expect(logs.length).toBeGreaterThan(400);
    const oldest = Math.min(...logs.map((l) => new Date(l.occurredAt).getTime()));
    expect(NOW.getTime() - oldest).toBeLessThanOrEqual(90 * 86400000);
  });
});

describe("개선 제안", () => {
  it("요약 출력", () => {
    for (const p of props)
      console.log(p.kind.padEnd(8), p.id.padEnd(34), `${p.effect.avoided}/${p.effect.total}`, `${Math.round(p.effect.perYearMin / 60)}h/yr`, "|", p.title);
  });
  it("리셋만으로 풀리는 순간 신호 → 디바운스 (E-1105, E-4401)", () => {
    const a = byId.get("debounce:NOTCH_V1:E-1105")!;
    expect(a).toBeTruthy();
    expect(a.change?.newDevice).toMatch(/^T\d+$/);
    expect(a.effect.avoided / a.effect.total).toBeGreaterThan(0.6);
    expect(a.appliesTo.length).toBe(12);
    expect(byId.get("debounce:PRESS_V1:E-4401")).toBeTruthy();
  });
  it("신호가 긴 리셋 알람은 디바운스 대신 점검 권고 (E-3020)", () => {
    expect(byId.get("debounce:COAT_V1:E-3020")).toBeUndefined();
    expect(byId.get("inspect:COAT_V1:E-3020")).toBeTruthy();
  });
  it("타이머 설정값 검토는 경알람만 (W-2502 T65), 기준을 늘리는 방향만", () => {
    const t = byId.get("timer:STACK_V1:W-2502")!;
    expect(t).toBeTruthy();
    expect(t.level).toBe("경");
    expect(t.change?.title).toMatch(/K120 → K1(2[1-9]|[3-7]\d|80)/);
    expect(t.verify?.length).toBeGreaterThan(0);
  });
  it("중알람 E-2041은 타이머 변경 대신 응답 지연 원인 개선 권고 (결정 4)", () => {
    expect(byId.get("timer:STACK_V1:E-2041")).toBeUndefined();
    const p = byId.get("inspect:STACK_V1:E-2041")!;
    expect(p).toBeTruthy();
    expect(p.change).toBeUndefined();
  });
  it("측정값이 기준보다 짧으면 타이머 제안을 만들지 않는다 (기준 축소 금지)", () => {
    const fake = Array.from({ length: 22 }, (_, i) => ({
      ...logs.find((l) => l.alarmCode === "W-2502")!,
      id: `F${i}`,
      measured: 1,
      actionType: "리셋" as const,
      result: "해결" as const,
    }));
    const others = logs.filter((l) => l.alarmCode !== "W-2502");
    const ps = buildProposals({ logs: [...others, ...fake], programs, assignment, manuals: MANUALS, now: NOW.getTime() });
    expect(ps.find((p) => p.id === "timer:STACK_V1:W-2502")).toBeUndefined();
  });
  it("예방정비 주기 (금형·흡착 패드·필터·그리스·집진)", () => {
    for (const id of ["pm:NOTCH_V1:E-1210", "pm:STACK_V1:E-2210", "pm:COAT_V1:E-3105", "pm:PRESS_V1:E-4012", "pm:NOTCH_V1:E-1302"])
      expect(byId.get(id), id).toBeTruthy();
    const pm = byId.get("pm:NOTCH_V1:E-1210")!;
    expect(pm.schedule!.length).toBe(12);
  });
  it("매뉴얼 보강 (E-1120 댄서롤 공압)", () => {
    const m = byId.get("manual:NOTCH_V1:E-1120")!;
    expect(m).toBeTruthy();
    expect(m.title).toContain("댄서롤");
  });
  it("한 대에 몰린 알람 → 설비 고유 점검 (NT-02)", () => {
    expect(byId.get("unit:NOTCH_V1:E-1023:NT-02")).toBeTruthy();
  });
  it("외부 신호 + 긴 대기 → 담당 부서 협의 (W-1401, E-4302)", () => {
    expect(byId.get("external:NOTCH_V1:W-1401")).toBeTruthy();
    expect(byId.get("external:PRESS_V1:E-4302")).toBeTruthy();
  });
  it("중알람·안전·설비 보호 알람은 래더 변경(디바운스·타이머) 제안 안 함", () => {
    for (const p of props.filter((x) => x.kind === "debounce" || x.kind === "timer")) {
      expect(p.protect === "안전" || p.protect === "설비 보호").toBe(false);
      expect(p.level).toBe("경");
    }
  });
  it("배기팬 트립(안전)은 점검 권고로", () => {
    const p = byId.get("inspect:COAT_V1:E-3020")!;
    expect(p.summary).toContain("안전");
  });
  it("품질 알람 디바운스에는 지연 동안 통과하는 전극 길이를 표시", () => {
    const p = byId.get("debounce:NOTCH_V1:E-1105")!;
    expect(p.checks!.join(" ")).toMatch(/전극 약 \d+mm/);
  });
  it("공용 원인 동시 다발 감지", () => {
    const p = byId.get("external:PRESS_V1:E-4302")!;
    expect(p.evidence.find((e) => e.label === "동시 다발")!.value).not.toBe("없음");
  });
  it("매뉴얼 비교", () => {
    const mans = MANUALS.filter((m) => m.alarmCode === "E-1105");
    expect(isInManual("센서 렌즈 청소 후 재가동", mans)).toBe(true);
    expect(
      isInManual(
        "댄서롤 공압 레귤레이터 0.25→0.30MPa 재조정",
        MANUALS.filter((m) => m.alarmCode === "E-1120"),
      ),
    ).toBe(false);
  });
});

describe("검증 단계·보류 (ChatGPT 논의 반영)", () => {
  it("디바운스 제안은 독립 기간 검증 결과와 1대 실증 계획을 가진다", () => {
    const p = byId.get("debounce:NOTCH_V1:E-1105")!;
    expect(p.validation).toBeTruthy();
    expect(["통과", "미달", "보류", "확인 필요"]).toContain(p.validation!.status);
    expect(p.validation!.breakdown!.map((b) => b.label)).toEqual(["리셋으로 해결", "리셋 외 조치(청소·교체 등)", "리셋 미해결"]);
    expect(p.stages!.map((s) => s.name)).toEqual(["같은 기간 재계산", "독립 기간 검증", "섀도 모드 2주", "1대 시범"]);
    expect(p.stages![2].state).toBe("미실시");
    expect(p.pilot!.tags).toContain("M510");
    console.log("E-1105 독립 검증:", p.validation!.status, p.validation!.result);
  });
  it("E-1105: 리셋 미해결 짧은 신호가 억제 범위면 '통과'가 아니라 '확인 필요', 1대 시범은 진행하지 않음", () => {
    const p = byId.get("debounce:NOTCH_V1:E-1105")!;
    const fail = p.validation!.breakdown!.find((b) => b.label === "리셋 미해결")!;
    const real = p.validation!.breakdown!.find((b) => b.label.startsWith("리셋 외"))!;
    expect(real.suppressed).toBe(0);
    if (fail.suppressed > 0) {
      expect(p.validation!.status).toBe("확인 필요");
      expect(p.stages![3].detail).toContain("해소 전에는 진행하지 않음");
    }
    expect(p.effect.avoided).toBe(99);
    expect(p.effect.note).toContain("리셋 미해결");
  });
  it("최근 데이터뿐인 W-2502 타이머는 독립 검증을 '보류'로 정직하게 표시", () => {
    const p = byId.get("timer:STACK_V1:W-2502")!;
    expect(p.validation!.status).toBe("보류");
  });
  it("모든 제안에 입력 기간·규칙 버전·계산 시각", () => {
    for (const p of props) expect(p.meta?.ruleVersion).toBe("rules-1.3");
  });
  it("측정값 없는 리셋 반복은 제안 대신 판단 보류", () => {
    const base = logs.find((l) => l.alarmCode === "E-1105")!;
    const fake = Array.from({ length: 12 }, (_, i) => ({
      ...base,
      id: `H${i}`,
      measured: null,
      measuredUnit: "",
      actionType: "리셋" as const,
      result: "해결" as const,
    }));
    const others = logs.filter((l) => l.alarmCode !== "E-1105");
    const ps = buildProposals({ logs: [...others, ...fake], programs, assignment, manuals: MANUALS, now: NOW.getTime() });
    expect(ps.find((p) => p.id === "debounce:NOTCH_V1:E-1105")).toBeUndefined();
    const h = ps.find((p) => p.id === "hold:NOTCH_V1:E-1105")!;
    expect(h).toBeTruthy();
    expect(h.needs!.length).toBeGreaterThan(0);
  });
  it("기본 데이터의 제안 수는 15건 그대로 (보류 0건)", () => {
    expect(props.length).toBe(15);
    expect(props.filter((p) => p.kind === "hold").length).toBe(0);
  });
});
