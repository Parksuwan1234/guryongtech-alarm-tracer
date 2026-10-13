"use client";

// 앱 전체 데이터: 조치이력 · 검토 · PLC 프로그램 · 설비 할당 + 파생 결과(파싱된 프로그램, 개선 제안)

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { EQUIPMENT } from "@/data/equipment";
import { MANUALS } from "@/data/manuals";
import { BUILTIN_PROGRAMS } from "@/data/programs";
import { parseProgram } from "./ladder";
import { buildProposals, type Proposal } from "./propose";
import { localRepo, newLogId, remoteRepo, type Repo } from "./repo";
import type { ActionLog, AlarmWork, AppConfig, AuditEntry, ParsedProgram, PlcProgram, ProposalReview } from "./types";

interface DataState {
  ready: boolean;
  config: AppConfig;
  error: string | null;
  logs: ActionLog[];
  reviews: Map<string, ProposalReview>;
  programs: PlcProgram[]; // 기본 + 업로드
  parsed: Map<string, ParsedProgram>;
  assignment: Record<string, string>; // 설비 → 프로그램 (기본값 + 사용자 지정)
  proposals: Proposal[];
  audit: AuditEntry[];
  work: Map<string, AlarmWork>;
  saveWork(w: Omit<AlarmWork, "updatedAt" | "history">, note?: string): Promise<AlarmWork>;
  restoreLog(e: AuditEntry): Promise<void>;
  addLog(l: Omit<ActionLog, "id">): Promise<ActionLog>;
  updateLog(l: ActionLog): Promise<void>;
  deleteLog(id: string): Promise<void>;
  importLogs(ls: ActionLog[]): Promise<void>;
  saveReview(r: Omit<ProposalReview, "updatedAt">): Promise<void>;
  saveProgram(p: PlcProgram): Promise<void>;
  deleteProgram(id: string): Promise<void>;
  setAssignment(equipmentId: string, programId: string): Promise<void>;
  resetDemo(): Promise<void>;
  programOf(equipmentId: string): ParsedProgram | undefined;
}

const Ctx = createContext<DataState | null>(null);

const DEFAULT_ASSIGNMENT: Record<string, string> = Object.fromEntries(EQUIPMENT.map((e) => [e.id, e.programId]));

export function DataProvider({ children }: { children: ReactNode }) {
  const [repo, setRepo] = useState<Repo | null>(null);
  const [config, setConfig] = useState<AppConfig>({ db: "local", ai: false });
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [logs, setLogs] = useState<ActionLog[]>([]);
  const [reviewList, setReviewList] = useState<ProposalReview[]>([]);
  const [custom, setCustom] = useState<PlcProgram[]>([]);
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [workList, setWorkList] = useState<AlarmWork[]>([]);

  const load = useCallback(async (r: Repo) => {
    const [l, rv, p, a, au, wk] = await Promise.all([
      r.listLogs(),
      r.listReviews(),
      r.listPrograms(),
      r.getAssignment(),
      r.listAudit().catch(() => []),
      r.listWork().catch(() => [] as AlarmWork[]),
    ]);
    setAudit(au);
    setWorkList(wk);
    setLogs(l);
    setReviewList(rv);
    setCustom(p);
    setOverrides(a);
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      let cfg: AppConfig = { db: "local", ai: false };
      try {
        const res = await fetch("/api/config", { cache: "no-store" });
        if (res.ok) cfg = await res.json();
      } catch {
        /* 정적 실행 등 API가 없으면 브라우저 저장소 */
      }
      let r = cfg.db === "supabase" ? remoteRepo() : localRepo();
      try {
        await load(r);
      } catch (e) {
        // DB 연결 실패 시 시연이 멈추지 않도록 브라우저 저장소로 전환
        setError(`DB 연결 실패로 브라우저 저장소를 사용합니다 (${e instanceof Error ? e.message : e})`);
        cfg = { ...cfg, db: "local" };
        r = localRepo();
        await load(r);
      }
      if (!alive) return;
      setConfig(cfg);
      setRepo(r);
      setReady(true);
    })();
    return () => {
      alive = false;
    };
  }, [load]);

  const programs = useMemo(() => {
    const ids = new Set(custom.map((p) => p.id));
    return [...BUILTIN_PROGRAMS.filter((p) => !ids.has(p.id)), ...custom];
  }, [custom]);

  const parsed = useMemo(() => {
    const m = new Map<string, ParsedProgram>();
    for (const p of programs) {
      try {
        m.set(p.id, parseProgram(p));
      } catch {
        /* 잘못된 업로드는 건너뜀 */
      }
    }
    return m;
  }, [programs]);

  const assignment = useMemo(() => {
    const a = { ...DEFAULT_ASSIGNMENT };
    for (const [e, p] of Object.entries(overrides)) if (parsed.has(p)) a[e] = p;
    return a;
  }, [overrides, parsed]);

  const proposals = useMemo(() => (ready ? buildProposals({ logs, programs: parsed, assignment, manuals: MANUALS }) : []), [ready, logs, parsed, assignment]);

  const reviews = useMemo(() => new Map(reviewList.map((r) => [r.proposalId, r])), [reviewList]);
  const work = useMemo(() => new Map(workList.map((w) => [w.id, w])), [workList]);

  const auditEntry = (op: AuditEntry["op"], logId: string, before: ActionLog | null, after: ActionLog | null): AuditEntry => ({
    id: `A-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
    at: new Date().toISOString(),
    op,
    logId,
    before,
    after,
  });
  const mark = async (es: AuditEntry[], status: NonNullable<AuditEntry["status"]>) => {
    const ids = new Set(es.map((e) => e.id));
    setAudit((xs) => [...es.map((e) => ({ ...e, status })).reverse(), ...xs.filter((x) => !ids.has(x.id))]);
    try {
      for (const e of es) await repo?.updateAuditStatus(e.id, status);
    } catch {
      /* 상태 갱신 실패 시 '시도'로 남음 — 실행 여부가 불확실하다는 뜻 그대로 */
    }
  };
  /** 원본이 사라지는 변경(수정·삭제·덮어쓰기): 변경 기록을 '시도'로 먼저 남기고, 실패하면 변경하지 않으며, 결과를 완료·실패로 표시 */
  const withAudit = async (entries: AuditEntry[], what: string, action: () => Promise<void>) => {
    const pending = entries.map((e) => ({ ...e, status: "시도" as const }));
    try {
      for (const e of pending) await repo?.appendAudit(e);
    } catch (err) {
      fail(what, err);
    }
    try {
      await action();
    } catch (err) {
      await mark(pending, "실패");
      fail(what, err);
    }
    await mark(pending, "완료");
  };
  /** 원본을 잃지 않는 변경(추가·복원): 변경 후 '완료'로 기록 */
  const auditAfter = async (e: AuditEntry) => {
    const done = { ...e, status: "완료" as const };
    setAudit((xs) => [done, ...xs]);
    try {
      await repo?.appendAudit(done);
    } catch {
      /* 추가 기록 실패가 저장을 막지 않음 */
    }
  };
  const fail = (what: string, e: unknown): never => {
    const msg = `${what}에 실패해 화면을 바꾸지 않았습니다 (${e instanceof Error ? e.message : String(e)})`;
    setError(msg);
    throw new Error(msg);
  };
  const checkPersist = () => {
    if (repo && !repo.persistent())
      setError("브라우저 저장 공간에 쓰지 못했습니다. 이 창을 닫으면 최근 기록이 사라질 수 있으니 조치이력 화면에서 CSV로 내보내 두세요.");
  };
  const sortLogs = (xs: ActionLog[]) => xs.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));

  const value: DataState = {
    ready,
    config,
    error,
    logs,
    reviews,
    programs,
    parsed,
    assignment,
    proposals,
    audit,
    work,
    async saveWork(w, note = "") {
      const prev = workList.find((x) => x.id === w.id);
      const at = new Date().toISOString();
      const changed = !prev || prev.status !== w.status || prev.owner !== w.owner || prev.nextAction !== w.nextAction || prev.dueAt !== w.dueAt;
      const entry = {
        at,
        status: w.status,
        note:
          note ||
          (prev && prev.status !== w.status ? `${prev.status} → ${w.status}` : prev ? "내용 수정" : `접수 · ${w.status}${w.owner ? ` · 담당 ${w.owner}` : ""}`),
      };
      const full: AlarmWork = { ...w, updatedAt: at, history: [...(prev?.history ?? []), ...(changed || note ? [entry] : [])].slice(-50) };
      try {
        await repo?.saveWork(full);
      } catch (err) {
        fail("대응 상태 저장", err);
      }
      setWorkList((xs) => [full, ...xs.filter((x) => x.id !== full.id)]);
      checkPersist();
      return full;
    },
    async restoreLog(e) {
      if (!e.before) return;
      const l = e.before;
      try {
        await repo?.importLogs([l]);
      } catch (err) {
        fail("복원", err);
      }
      await auditAfter(auditEntry("복원", l.id, null, l));
      setLogs((xs) => sortLogs([l, ...xs.filter((x) => x.id !== l.id)]));
    },
    async addLog(l) {
      const full = { ...l, id: newLogId() };
      try {
        await repo?.createLog(full);
      } catch (err) {
        fail("기록 저장", err);
      }
      setLogs((xs) => [full, ...xs]);
      checkPersist();
      await auditAfter(auditEntry("추가", full.id, null, full));
      return full;
    },
    async updateLog(l) {
      const before = logs.find((x) => x.id === l.id) ?? null;
      await withAudit([auditEntry("수정", l.id, before, l)], "수정", async () => {
        await repo?.updateLog(l);
      });
      setLogs((xs) => xs.map((x) => (x.id === l.id ? l : x)));
      checkPersist();
    },
    async deleteLog(id) {
      const before = logs.find((x) => x.id === id) ?? null;
      await withAudit([auditEntry("삭제", id, before, null)], "삭제", async () => {
        await repo?.deleteLog(id);
      });
      setLogs((xs) => xs.filter((x) => x.id !== id));
      checkPersist();
    },
    async importLogs(ls) {
      const byId = new Map(logs.map((l) => [l.id, l]));
      // 같은 ID를 덮어쓰는 건은 변경 전·후를 한 건씩 남긴다
      const entries = ls.map((l) => auditEntry(byId.has(l.id) ? "수정" : "가져오기", l.id, byId.get(l.id) ?? null, l));
      await withAudit(entries, "가져오기", async () => {
        await repo?.importLogs(ls);
      });
      const ids = new Set(ls.map((l) => l.id));
      setLogs((xs) => sortLogs([...ls, ...xs.filter((x) => !ids.has(x.id))]));
    },
    async saveReview(r) {
      const full = { ...r, updatedAt: new Date().toISOString() };
      try {
        await repo?.saveReview(full);
      } catch (err) {
        fail("검토 저장", err);
      }
      setReviewList((xs) => [full, ...xs.filter((x) => x.proposalId !== r.proposalId)]);
    },
    async saveProgram(p) {
      const full = { ...p, uploadedAt: p.uploadedAt ?? new Date().toISOString() };
      try {
        await repo?.saveProgram(full);
      } catch (err) {
        fail("프로그램 저장", err);
      }
      setCustom((xs) => [...xs.filter((x) => x.id !== p.id), full]);
    },
    async deleteProgram(id) {
      const affected = Object.entries(overrides)
        .filter(([, p]) => p === id)
        .map(([e]) => e);
      try {
        for (const e of affected) await repo?.setAssignmentOne(e, null);
        await repo?.deleteProgram(id);
      } catch (err) {
        fail("프로그램 삭제", err);
      }
      setCustom((xs) => xs.filter((x) => x.id !== id));
      setOverrides((cur) => Object.fromEntries(Object.entries(cur).filter(([, p]) => p !== id)));
    },
    async setAssignment(equipmentId, programId) {
      // 설비 한 대만 바꾼다 (다른 사람이 바꾼 다른 설비의 지정을 덮어쓰지 않도록)
      const value = DEFAULT_ASSIGNMENT[equipmentId] === programId ? null : programId;
      try {
        await repo?.setAssignmentOne(equipmentId, value);
      } catch (err) {
        fail("프로그램 지정", err);
      }
      setOverrides((cur) => {
        const next = { ...cur };
        if (value === null) delete next[equipmentId];
        else next[equipmentId] = value;
        return next;
      });
    },
    async resetDemo() {
      if (!repo) return;
      await repo.resetDemo();
      await load(repo);
    },
    programOf(equipmentId) {
      return parsed.get(assignment[equipmentId]);
    },
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useData(): DataState {
  const v = useContext(Ctx);
  if (!v) throw new Error("DataProvider 필요");
  return v;
}
