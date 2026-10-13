import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { GLOSSARY_MAP } from "@/data/glossary";
import { BUILTIN_PROGRAMS } from "@/data/programs";
import { generateSeedLogs } from "@/data/seed";
import { causeStats, evidenceOf, reliability, repeatCount, weeklyCounts, wilsonLower } from "@/lib/analytics";
import { parseProgram, programRev } from "@/lib/ladder";
import type { ActionLog, AlarmWork } from "@/lib/types";
import { josa, withWa } from "@/lib/ko";
import { openWorkFor, statusAfterLog } from "@/lib/work";

const NOW = new Date("2026-10-13T09:00:00+09:00").getTime();
const log = (p: Partial<ActionLog>): ActionLog => ({
  id: Math.random().toString(36).slice(2),
  occurredAt: new Date(NOW - 3600000).toISOString(),
  equipmentId: "NT-02",
  alarmCode: "E-1023",
  sourceDevice: "X1A3",
  cause: "c",
  actionType: "부품 교체",
  action: "a",
  result: "해결",
  durationMin: 30,
  measured: null,
  measuredUnit: "",
  worker: "w",
  note: "",
  ...p,
});

describe("근거 강도", () => {
  it("표본 수로 근거를 나눈다", () => {
    expect(evidenceOf(1)).toBe("표본 적음");
    expect(evidenceOf(3)).toBe("근거 보통");
    expect(evidenceOf(6)).toBe("근거 충분");
  });
  it("1/1(100%)이 5/6보다 앞서지 않는다 — 윌슨 하한 정렬", () => {
    expect(wilsonLower(1, 1)).toBeLessThan(wilsonLower(5, 6));
    const stats = causeStats([
      log({ action: "한 번 성공", cause: "x" }),
      ...Array.from({ length: 6 }, (_, i) => log({ action: "팬 교체", cause: "y", result: i < 5 ? "해결" : "미해결" })),
    ]);
    expect(stats[0].action).toBe("팬 교체");
    expect(stats[0].evidence).toBe("근거 충분");
    expect(stats[1].evidence).toBe("표본 적음");
  });
  it("마지막 조치 시각을 남긴다", () => {
    const s = causeStats([log({ occurredAt: "2026-10-01T00:00:00Z" }), log({ occurredAt: "2026-10-05T00:00:00Z" })]);
    expect(s[0].lastAt).toBe("2026-10-05T00:00:00Z");
  });
});

describe("신뢰성 지표", () => {
  it("MTTR = 평균 복구 시간, MTBF = (가동 시간)/건수", () => {
    const r = reliability([log({ durationMin: 30 }), log({ durationMin: 90 })], 30);
    expect(r.mttrMin).toBe(60);
    expect(r.mtbfH).toBeCloseTo((30 * 24 * 60 - 120) / 2 / 60, 5);
  });
  it("주별 건수는 오래된 주부터", () => {
    const w = weeklyCounts(
      [log({ occurredAt: new Date(NOW - 86400000).toISOString() }), log({ occurredAt: new Date(NOW - 15 * 86400000).toISOString() })],
      4,
      NOW,
    );
    expect(w).toEqual([0, 1, 0, 1]);
  });
  it("반복 알람: 같은 설비·같은 알람 7일 내 건수", () => {
    const ls = [0, 1, 2, 9].map((d) => log({ occurredAt: new Date(NOW - d * 86400000 - 1000).toISOString() }));
    expect(repeatCount(ls, "NT-02", "E-1023", 7, NOW)).toBe(3);
    expect(repeatCount(ls, "NT-03", "E-1023", 7, NOW)).toBe(0);
  });
});

describe("대응 처리 상태", () => {
  it("해결 기록만으로 자동 종결하지 않는다 — 종결은 사람이", () => {
    expect(statusAfterLog({ result: "해결", actionType: "리셋" }).status).toBe("후속 확인");
    expect(statusAfterLog({ result: "해결", actionType: "부품 교체" }).status).toBe("후속 확인");
    expect(statusAfterLog({ result: "미해결", actionType: "점검·조정" }).status).toBe("조치 중");
  });
  it("종결 전 대응 건을 같은 설비·알람으로 이어서 찾는다", () => {
    const w = (id: string, status: AlarmWork["status"], updatedAt: string): AlarmWork => ({
      id,
      equipmentId: "NT-02",
      alarmCode: "E-1023",
      startedAt: updatedAt,
      status,
      owner: "",
      nextAction: "",
      dueAt: "",
      updatedAt,
      history: [],
    });
    const m = new Map([
      ["a", w("a", "종결", "2026-10-01")],
      ["b", w("b", "후속 확인", "2026-10-02")],
    ]);
    expect(openWorkFor(m, "NT-02", "E-1023")?.id).toBe("b");
    expect(openWorkFor(m, "NT-03", "E-1023")).toBeUndefined();
  });
});

describe("근거 출처", () => {
  it("프로그램 리비전은 내용이 같으면 같고, 한 글자만 달라도 바뀐다", () => {
    const p = BUILTIN_PROGRAMS[0];
    expect(programRev(p)).toBe(programRev({ ...p }));
    expect(programRev({ ...p, ladderCsv: p.ladderCsv.replace("K", "k") })).not.toBe(programRev(p));
  });
  it("현장 입력 디바이스는 위치(어디에 있는지)를 가진다", () => {
    for (const prog of BUILTIN_PROGRAMS.map(parseProgram)) {
      const field = Array.from(prog.devices.values()).filter((d) => d.sourceKind === "현장 입력" && d.role === "" && !/버튼/.test(d.comment));
      for (const d of field) expect(d.where, `${prog.id} ${d.device}`).not.toBe("");
    }
  });
  it("시드 데이터는 그대로 — 조치이력 753건", () => {
    expect(generateSeedLogs(new Date(NOW)).length).toBe(753);
  });
});

describe("쉬운 용어", () => {
  it("화면에 쓰인 모든 점선 용어(Term)가 용어 풀이에 있다", () => {
    const files: string[] = [];
    const walk = (d: string) => {
      for (const f of readdirSync(d)) {
        const p = join(d, f);
        if (statSync(p).isDirectory()) walk(p);
        else if (p.endsWith(".tsx")) files.push(p);
      }
    };
    walk(join(__dirname, "..", "src"));
    const keys = new Set<string>();
    for (const f of files) for (const m of readFileSync(f, "utf8").matchAll(/<Term k="([^"]+)"/g)) keys.add(m[1]);
    expect(keys.size).toBeGreaterThan(3);
    for (const k of keys) expect(GLOSSARY_MAP.has(k), k).toBe(true);
  });
});

describe("한국어 조사", () => {
  it("받침에 맞춰 와/과", () => {
    expect(withWa("MES 운영팀")).toBe("MES 운영팀과");
    expect(withWa("외관 비전 검사기(품질팀)")).toBe("외관 비전 검사기(품질팀)와");
    expect(withWa("유틸리티팀(냉각수)")).toBe("유틸리티팀(냉각수)과");
    expect(withWa("신호를 보내는 부서")).toBe("신호를 보내는 부서와");
  });
  it("받침에 맞춰 을/를, 이/가, (으)로", () => {
    expect(josa("X243 적층 위치 도착", "을")).toBe("X243 적층 위치 도착을");
    expect(josa("M65 적층 1사이클 완료", "이")).toBe("M65 적층 1사이클 완료가");
    expect(josa("1. S0 대기(원점)", "으로")).toBe("1. S0 대기(원점)로");
    expect(josa("다음 단계", "으로")).toBe("다음 단계로");
    expect(josa("적층 테이블", "으로")).toBe("적층 테이블로");
    expect(josa("검사 공정", "으로")).toBe("검사 공정으로");
  });
});

describe("호기별 분포", () => {
  const mk = (eq: string, measured: number | null, actionType: ActionLog["actionType"] = "리셋") =>
    log({ equipmentId: eq, alarmCode: "E-1105", measured, measuredUnit: measured === null ? "" : "s", actionType });
  it("한 호기에 몰리면 '한 대 집중'으로, 호기별 중앙값을 따로 낸다", async () => {
    const { unitBreakdown } = await import("@/lib/analytics");
    const ls = [...Array.from({ length: 8 }, () => mk("NT-01", 0.1)), mk("NT-02", 0.4), mk("NT-03", 0.12)];
    const b = unitBreakdown(ls, "E-1105", ["NT-01", "NT-02", "NT-03"], "s");
    expect(b.rows[0].unit).toBe("NT-01");
    expect(b.rows[0].count).toBe(8);
    expect(b.rows[0].median).toBeCloseTo(0.1, 5);
    expect(b.verdict).toBe("single");
    expect(b.topShare).toBeCloseTo(0.8, 5);
  });
  it("측정값이 없는 호기는 중앙값을 지어내지 않는다", async () => {
    const { unitBreakdown } = await import("@/lib/analytics");
    const b = unitBreakdown([mk("NT-01", null), mk("NT-02", 0.2)], "E-1105", ["NT-01", "NT-02"], "s");
    expect(b.rows.find((r) => r.unit === "NT-01")!.median).toBeNull();
  });
  it("신호 길이가 크게 다른 호기를 따로 짚는다(3건 이상)", async () => {
    const { unitBreakdown } = await import("@/lib/analytics");
    const ls = [...Array.from({ length: 6 }, () => mk("NT-01", 0.1)), ...Array.from({ length: 3 }, () => mk("NT-02", 0.6))];
    const b = unitBreakdown(ls, "E-1105", ["NT-01", "NT-02"], "s");
    expect(b.outliers.map((r) => r.unit)).toEqual(["NT-02"]);
  });
});
