// 더미데이터 묶음 만들기: npm run samples → samples/ 폴더
// 레이아웃 · PLC 프로그램 4종(CSV 3개씩) · 조치 매뉴얼 · 조치이력 · 로그 샘플
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { EQUIPMENT, PROCESS_LABEL } from "../src/data/equipment";
import { MANUALS } from "../src/data/manuals";
import { BUILTIN_PROGRAMS } from "../src/data/programs";
import { generateSeedLogs } from "../src/data/seed";
import { toCsv } from "../src/lib/csv";

const out = process.argv[2] ?? "samples";
const bom = "﻿";
const w = (p: string, text: string) => {
  mkdirSync(join(out, p, ".."), { recursive: true });
  writeFileSync(join(out, p), bom + text);
};

w(
  "layout.csv",
  toCsv(
    EQUIPMENT.map((e) => ({ 설비: e.id, 이름: e.name, 공정: PROCESS_LABEL[e.process], 극성: e.polarity, 상위설비: e.upstream.join("|"), 프로그램: e.programId })),
    ["설비", "이름", "공정", "극성", "상위설비", "프로그램"],
  ),
);
for (const p of BUILTIN_PROGRAMS) {
  w(`plc/${p.id}/ladder.csv`, p.ladderCsv);
  w(`plc/${p.id}/devices.csv`, p.devicesCsv);
  w(`plc/${p.id}/alarms.csv`, p.alarmsCsv);
}
w(
  "manuals.csv",
  toCsv(
    MANUALS.map((m) => ({ 항목: m.id, 프로그램: m.programId, 알람번호: m.alarmCode, 원천디바이스: m.sourceDevice, 원인: m.cause, 조치단계: m.steps.join(" → "), 안전: m.safety, 담당: m.owner })),
    ["항목", "프로그램", "알람번호", "원천디바이스", "원인", "조치단계", "안전", "담당"],
  ),
);
const logs = generateSeedLogs(new Date());
w(
  "action_logs.csv",
  toCsv(logs as unknown as Record<string, unknown>[], [
    "id",
    "occurredAt",
    "equipmentId",
    "alarmCode",
    "sourceDevice",
    "cause",
    "actionType",
    "action",
    "result",
    "durationMin",
    "measured",
    "measuredUnit",
    "worker",
    "note",
  ]),
);
console.log(`samples → ${out}: 설비 ${EQUIPMENT.length}대, 프로그램 ${BUILTIN_PROGRAMS.length}종, 매뉴얼 ${MANUALS.length}항목, 조치이력 ${logs.length}건`);
