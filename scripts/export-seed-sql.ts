// Supabase 시드 SQL: npm run seed-sql > supabase/seed.sql
import { generateSeedLogs } from "../src/data/seed";

const q = (v: unknown) => (v === null || v === undefined ? "null" : typeof v === "number" ? String(v) : `'${String(v).replace(/'/g, "''")}'`);
const logs = generateSeedLogs(new Date());
const rows = logs.map(
  (l) =>
    `(${[l.id, l.occurredAt, l.equipmentId, l.alarmCode, l.sourceDevice, l.cause, l.actionType, l.action, l.result, l.durationMin, l.measured, l.measuredUnit, l.worker, l.note].map(q).join(", ")})`,
);
console.log("-- 가상 조치이력 (생성일 기준 최근 90일)");
console.log(
  "insert into action_logs (id, occurred_at, equipment_id, alarm_code, source_device, cause, action_type, action, result, duration_min, measured, measured_unit, worker, note) values",
);
console.log(rows.join(",\n") + "\non conflict (id) do nothing;");
