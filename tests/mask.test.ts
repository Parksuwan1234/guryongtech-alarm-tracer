import { describe, expect, it } from "vitest";
import { maskSensitive } from "@/lib/mask";

describe("마스킹", () => {
  it("LOT·사번·IP를 가린다", () => {
    const r = maskSensitive("2026-10-13 08:12 NT-02 E-1023 LOT-A2610130042 사번:2019034 192.168.10.21:502 담당 a.kim@corp.com");
    expect(r.text).not.toMatch(/A2610130042|2019034|192\.168|a\.kim/);
    expect(r.text).toContain("NT-02");
    expect(r.text).toContain("E-1023");
    expect(r.byRule).toMatchObject({ IP: 1, LOT: 1, 사번: 1, 이메일: 1 });
  });
  it("알람번호·설비번호·시각은 남긴다", () => {
    const r = maskSensitive("08:12:03 ST-01 W-2502 T65 K120");
    expect(r.count).toBe(0);
  });
});

import { ruleNormalize } from "@/lib/normalize";

describe("현장 메모 정리(규칙)", () => {
  const causes = ["서보앰프 냉각팬 정지", "냉각팬 필터 막힘"];
  it("교체·시간·온도는 칸으로, 원인은 후보로만", () => {
    const r = ruleNormalize("앰프 팬 안 돌아서 냉각팬 교체함, 40분 걸림, 온도 72도까지 올라갔었음, 원인 제거 확인", causes);
    expect(r.actionType).toBe("부품 교체");
    expect(r.durationMin).toBe(40);
    expect(r.measured).toBe(72);
    expect(r.measuredUnit).toBe("℃");
    expect(r.result).toBe("해결");
    expect(r.causeCandidates[0]).toBe("서보앰프 냉각팬 정지");
    expect(r.notes.join(" ")).toContain("작업자 기재값");
  });
  it("리셋해도 안 풀림 → 리셋 + 미해결", () => {
    const r = ruleNormalize("리셋해도 안 풀림 0.15초 미감지 다시 뜸", []);
    expect(r.actionType).toBe("리셋");
    expect(r.result).toBe("미해결");
    expect(r.measured).toBe(0.15);
  });
  it("리셋 안 함·청소 예정은 실시로 보지 않음", () => {
    expect(ruleNormalize("리셋 안 함, 보전 호출", []).actionType).not.toBe("리셋");
    expect(ruleNormalize("필터 청소 예정", []).actionType).toBeUndefined();
  });
  it("재가동은 관찰일 뿐 해결로 채우지 않음, 원인 모름이면 후보 없음", () => {
    const r = ruleNormalize("리셋하니 일단 재가동됨. 원인은 아직 모름.", causes);
    expect(r.actionType).toBe("리셋");
    expect(r.result).toBeUndefined();
    expect(r.pending.join(" ")).toContain("결과");
    expect(r.causeCandidates).toEqual([]);
  });
});
