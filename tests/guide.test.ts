import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EQUIPMENT_BY_ID } from "@/data/equipment";
import { GUIDE_STEPS, SIM_ALARM, USAGE_SLIDES } from "@/data/guide";
import { EQUIPMENT } from "@/data/equipment";
import { MANUALS } from "@/data/manuals";
import { BUILTIN_PROGRAMS } from "@/data/programs";
import { generateSeedLogs } from "@/data/seed";
import { alreadyThere, offPage, stepAfterNavigate } from "@/lib/guideNav";
import { parseProgram } from "@/lib/ladder";
import { buildProposals } from "@/lib/propose";
import { TOUR } from "@/data/tour";

function allSource(dir: string): string {
  return readdirSync(dir)
    .map((f) => join(dir, f))
    .map((p) => (statSync(p).isDirectory() ? allSource(p) : /\.tsx?$/.test(p) ? readFileSync(p, "utf8") : ""))
    .join("\n");
}
const SRC = allSource(join(process.cwd(), "src"));

/** 선택자가 가리키는 요소가 소스 어딘가에 실제로 있는지 */
function anchored(sel: string): boolean {
  return sel.split(",").some((one) => {
    const s = one.trim();
    const dg = s.match(/^\[data-guide="(.+)"\]$/);
    if (dg) {
      if (dg[1].startsWith("nav-")) return SRC.includes("data-guide={`nav-${n.href}`}") && SRC.includes(`href: "${dg[1].slice(4)}"`);
      return SRC.includes(`data-guide="${dg[1]}"`) || new RegExp(`data-guide=\\{[^}]*"${dg[1]}"`).test(SRC);
    }
    const id = s.match(/^#(.+)$/);
    if (id) return SRC.includes(`id="${id[1]}"`);
    return false;
  });
}

describe("시뮬레이션 안내", () => {
  it("모든 단계가 화면 속 실제 요소를 짚는다 (후보마다)", () => {
    for (const s of GUIDE_STEPS) for (const one of s.target.split(",")) expect(anchored(one), `${s.title} → ${one}`).toBe(true);
  });

  it("단계마다 넘어가는 방법이 하나 이상 있다", () => {
    for (const s of GUIDE_STEPS) expect(Boolean(s.advanceOn || s.next || s.finish), s.title).toBe(true);
    expect(GUIDE_STEPS[GUIDE_STEPS.length - 1].finish).toBe(true);
  });

  it("시뮬레이션 알람이 그 설비 프로그램에 있고 첫 단계 이동 주소와 맞다", () => {
    const eq = EQUIPMENT_BY_ID.get(SIM_ALARM.equipmentId)!;
    const prog = BUILTIN_PROGRAMS.find((p) => p.id === eq.programId)!;
    expect(prog.alarmsCsv).toContain(SIM_ALARM.code);
    expect(GUIDE_STEPS[0].advanceOn!.test(`/alarm/${SIM_ALARM.equipmentId}/${SIM_ALARM.code}`)).toBe(true);
  });

  it("사용법 팝업 그림 파일이 모두 있다", () => {
    for (const s of USAGE_SLIDES) expect(existsSync(join(process.cwd(), "public", s.img)), s.img).toBe(true);
  });
});

describe("안내 단계 이동 규칙", () => {
  const ALARM = "/alarm/ST-01/W-2502";
  it("알림을 눌러 알람 화면으로 가면 다음 단계로", () => {
    expect(stepAfterNavigate(GUIDE_STEPS, 0, "/", ALARM)).toBe(1);
  });
  it("알람 화면에서 다시 시작해 주소가 그대로면 1단계를 건너뛰지 않는다", () => {
    expect(stepAfterNavigate(GUIDE_STEPS, 0, ALARM, ALARM)).toBe(0);
  });
  it("'이전'으로 돌아와 이미 그 화면이면 '다음' 버튼으로 넘어갈 수 있다", () => {
    expect(alreadyThere(GUIDE_STEPS[0], ALARM)).toBe(true);
    expect(alreadyThere(GUIDE_STEPS[5], "/improve")).toBe(true);
    expect(alreadyThere(GUIDE_STEPS[0], "/")).toBe(false);
  });
  it("설명하는 화면을 벗어나면 돌아가는 링크를 보여 준다", () => {
    expect(offPage(GUIDE_STEPS[2], "/history")).toBe(true);
    expect(offPage(GUIDE_STEPS[2], ALARM)).toBe(false);
    expect(offPage(GUIDE_STEPS[0], "/history")).toBe(false);
  });
});

describe("안내·체험 순서가 여는 개선 제안이 실제로 있다", () => {
  it("debounce:NOTCH_V1:E-1105", () => {
    const now = new Date("2026-10-13T05:00:00Z");
    const programs = new Map(BUILTIN_PROGRAMS.map((p) => [p.id, parseProgram(p)]));
    const assignment = Object.fromEntries(EQUIPMENT.map((e) => [e.id, e.programId]));
    const ids = new Set(buildProposals({ logs: generateSeedLogs(now), programs, assignment, manuals: MANUALS, now: now.getTime() }).map((p) => p.id));
    const hrefs = [...GUIDE_STEPS.flatMap((g) => [g.action?.href, g.page?.href]), ...TOUR.map((t) => t.href)].filter((h): h is string => !!h && h.startsWith("/improve#"));
    expect(hrefs.length).toBeGreaterThan(0);
    for (const h of hrefs) expect(ids.has(decodeURIComponent(h.split("#")[1])), h).toBe(true);
  });
});
