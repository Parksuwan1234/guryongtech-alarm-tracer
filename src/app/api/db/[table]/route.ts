// 조치이력·검토·PLC 프로그램·설비 할당 CRUD (Supabase)
import { NextResponse, type NextRequest } from "next/server";
import { generateSeedLogs } from "@/data/seed";
import { db, supabaseConfigured } from "@/lib/server/supabase";
import { WORK_STATUSES, type ActionLog, type AlarmWork, type AuditEntry, type PlcProgram, type ProposalReview } from "@/lib/types";

export const dynamic = "force-dynamic";

type Row = Record<string, unknown>;

const logToRow = (l: ActionLog): Row => ({
  id: l.id,
  occurred_at: l.occurredAt,
  equipment_id: l.equipmentId,
  alarm_code: l.alarmCode,
  source_device: l.sourceDevice,
  cause: l.cause,
  action_type: l.actionType,
  action: l.action,
  result: l.result,
  duration_min: l.durationMin,
  measured: l.measured,
  measured_unit: l.measuredUnit,
  worker: l.worker,
  note: l.note,
});

const rowToLog = (r: Row): ActionLog => ({
  id: String(r.id),
  occurredAt: new Date(String(r.occurred_at)).toISOString(),
  equipmentId: String(r.equipment_id),
  alarmCode: String(r.alarm_code),
  sourceDevice: String(r.source_device ?? ""),
  cause: String(r.cause ?? ""),
  actionType: r.action_type as ActionLog["actionType"],
  action: String(r.action ?? ""),
  result: r.result as ActionLog["result"],
  durationMin: Number(r.duration_min ?? 0),
  measured: r.measured === null || r.measured === undefined ? null : Number(r.measured),
  measuredUnit: String(r.measured_unit ?? ""),
  worker: String(r.worker ?? ""),
  note: String(r.note ?? ""),
});

const LOG_FIELDS = new Set(["id", "occurredAt", "equipmentId", "alarmCode", "durationMin"]);

function validLog(l: unknown): l is ActionLog {
  if (!l || typeof l !== "object") return false;
  return Array.from(LOG_FIELDS).every((k) => k in (l as Row));
}

function err(e: unknown, status = 500) {
  return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status });
}

async function pageAll(table: string, order: string): Promise<Row[]> {
  const out: Row[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db()
      .from(table)
      .select("*")
      .order(order, { ascending: false })
      .range(from, from + 999);
    if (error) throw error;
    out.push(...(data as Row[]));
    if (!data || data.length < 1000) break;
  }
  return out;
}

export async function GET(_req: NextRequest, { params }: { params: { table: string } }) {
  if (!supabaseConfigured()) return err("DB 미설정", 501);
  try {
    switch (params.table) {
      case "logs":
        return NextResponse.json((await pageAll("action_logs", "occurred_at")).map(rowToLog));
      case "reviews": {
        const rows = await pageAll("proposal_reviews", "updated_at");
        return NextResponse.json(
          rows.map((r) => ({
            proposalId: r.proposal_id,
            status: r.status,
            comment: r.comment ?? "",
            reviewer: r.reviewer ?? "",
            updatedAt: r.updated_at,
          })),
        );
      }
      case "programs": {
        const rows = await pageAll("plc_programs", "uploaded_at");
        return NextResponse.json(
          rows.map((r) => ({
            id: r.id,
            name: r.name,
            ladderCsv: r.ladder_csv,
            devicesCsv: r.devices_csv,
            alarmsCsv: r.alarms_csv,
            uploadedAt: r.uploaded_at,
          })),
        );
      }
      case "audit": {
        const { data, error } = await db().from("action_log_audit").select("*").order("at", { ascending: false }).limit(2000);
        if (error) throw error;
        return NextResponse.json(
          (data as Row[]).map((r) => ({
            id: r.id,
            at: r.at,
            op: r.op,
            logId: r.log_id,
            before: r.before ?? null,
            after: r.after ?? null,
            status: r.status ?? "완료",
          })),
        );
      }
      case "work": {
        const { data, error } = await db().from("alarm_work").select("*").order("updated_at", { ascending: false }).limit(500);
        if (error) throw error;
        return NextResponse.json(
          (data as Row[]).map((r): AlarmWork => ({
            id: String(r.id),
            equipmentId: String(r.equipment_id),
            alarmCode: String(r.alarm_code),
            startedAt: String(r.started_at),
            status: r.status as AlarmWork["status"],
            owner: String(r.owner ?? ""),
            nextAction: String(r.next_action ?? ""),
            dueAt: r.due_at ? String(r.due_at) : "",
            updatedAt: String(r.updated_at),
            history: (r.history as AlarmWork["history"]) ?? [],
          })),
        );
      }
      case "assignment": {
        const { data, error } = await db().from("equipment_programs").select("*");
        if (error) throw error;
        return NextResponse.json(Object.fromEntries((data as Row[]).map((r) => [r.equipment_id, r.program_id])));
      }
    }
    return err("unknown table", 404);
  } catch (e) {
    return err(e);
  }
}

export async function POST(req: NextRequest, { params }: { params: { table: string } }) {
  if (!supabaseConfigured()) return err("DB 미설정", 501);
  try {
    const body = await req.json();
    if (params.table === "logs") {
      const list = Array.isArray(body) ? body : [body];
      if (!list.every(validLog)) return err("잘못된 조치이력", 400);
      const { error } = await db().from("action_logs").upsert(list.map(logToRow));
      if (error) throw error;
      return NextResponse.json(Array.isArray(body) ? { ok: true, count: list.length } : body);
    }
    if (params.table === "audit") {
      const e = body as AuditEntry;
      if (!e?.id || !e?.op) return err("잘못된 변경 기록", 400);
      const { error } = await db()
        .from("action_log_audit")
        .insert({ id: e.id, at: e.at, op: e.op, log_id: e.logId, before: e.before, after: e.after, status: e.status ?? "완료" });
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }
    if (params.table === "seed") {
      // 공용 DB 초기화는 서버에 ALLOW_DEMO_RESET=true 를 설정한 경우에만 (공개 방문자의 데이터 훼손 방지)
      if (process.env.ALLOW_DEMO_RESET !== "true") return err("공용 DB 초기화가 꺼져 있습니다 (ALLOW_DEMO_RESET)", 403);
      for (const t of ["action_log_audit", "action_logs", "proposal_reviews", "plc_programs", "equipment_programs", "alarm_work"]) {
        const key = t === "proposal_reviews" ? "proposal_id" : t === "equipment_programs" ? "equipment_id" : "id";
        const { error } = await db().from(t).delete().neq(key, "");
        if (error) throw error;
      }
      const seed = generateSeedLogs(new Date());
      for (let i = 0; i < seed.length; i += 500) {
        const { error } = await db()
          .from("action_logs")
          .insert(seed.slice(i, i + 500).map(logToRow));
        if (error) throw error;
      }
      return NextResponse.json({ ok: true, count: seed.length });
    }
    return err("unknown table", 404);
  } catch (e) {
    return err(e);
  }
}

export async function PUT(req: NextRequest, { params }: { params: { table: string } }) {
  if (!supabaseConfigured()) return err("DB 미설정", 501);
  try {
    const body = await req.json();
    switch (params.table) {
      case "logs": {
        if (!validLog(body)) return err("잘못된 조치이력", 400);
        const { error } = await db().from("action_logs").upsert(logToRow(body));
        if (error) throw error;
        return NextResponse.json(body);
      }
      case "reviews": {
        const r = body as ProposalReview;
        const { error } = await db().from("proposal_reviews").upsert({
          proposal_id: r.proposalId,
          status: r.status,
          comment: r.comment,
          reviewer: r.reviewer,
          updated_at: r.updatedAt,
        });
        if (error) throw error;
        return NextResponse.json({ ok: true });
      }
      case "programs": {
        const p = body as PlcProgram;
        const { error } = await db()
          .from("plc_programs")
          .upsert({
            id: p.id,
            name: p.name,
            ladder_csv: p.ladderCsv,
            devices_csv: p.devicesCsv,
            alarms_csv: p.alarmsCsv,
            uploaded_at: p.uploadedAt ?? new Date().toISOString(),
          });
        if (error) throw error;
        return NextResponse.json({ ok: true });
      }
      case "audit": {
        const { id, status } = body as { id?: string; status?: string };
        if (!id || !["시도", "완료", "실패"].includes(status ?? "")) return err("잘못된 상태", 400);
        const { error } = await db().from("action_log_audit").update({ status }).eq("id", id);
        if (error) throw error;
        return NextResponse.json({ ok: true });
      }
      case "work": {
        const w = body as AlarmWork;
        if (!w?.id || !w.equipmentId || !WORK_STATUSES.includes(w.status)) return err("잘못된 대응 기록", 400);
        const { error } = await db()
          .from("alarm_work")
          .upsert({
            id: w.id,
            equipment_id: w.equipmentId,
            alarm_code: w.alarmCode,
            started_at: w.startedAt,
            status: w.status,
            owner: w.owner.slice(0, 60),
            next_action: w.nextAction.slice(0, 300),
            due_at: w.dueAt || null,
            updated_at: w.updatedAt,
            history: w.history.slice(-50),
          });
        if (error) throw error;
        return NextResponse.json({ ok: true });
      }
      case "assignment": {
        // 설비 한 대만 바꾼다 (전체 삭제 후 재삽입하지 않음)
        const { equipmentId, programId } = body as { equipmentId?: string; programId?: string | null };
        if (!equipmentId) return err("equipmentId 필요", 400);
        const q = programId
          ? db().from("equipment_programs").upsert({ equipment_id: equipmentId, program_id: programId })
          : db().from("equipment_programs").delete().eq("equipment_id", equipmentId);
        const { error } = await q;
        if (error) throw error;
        return NextResponse.json({ ok: true });
      }
    }
    return err("unknown table", 404);
  } catch (e) {
    return err(e);
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { table: string } }) {
  if (!supabaseConfigured()) return err("DB 미설정", 501);
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return err("id 필요", 400);
  try {
    const table = params.table === "logs" ? "action_logs" : params.table === "programs" ? "plc_programs" : null;
    if (!table) return err("unknown table", 404);
    const { error } = await db().from(table).delete().eq("id", id);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (e) {
    return err(e);
  }
}
