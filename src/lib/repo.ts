// 저장소: Supabase(서버 API 경유) 또는 브라우저 저장소(키가 없을 때 자동 전환)
// 브라우저 저장소 모드는 공개 시연 링크가 DB 설정 없이도 바로 동작하게 하기 위한 것입니다.

import { generateSeedLogs } from "@/data/seed";
import type { ActionLog, AlarmWork, AuditEntry, PlcProgram, ProposalReview } from "./types";

export interface Repo {
  mode: "supabase" | "local";
  listLogs(): Promise<ActionLog[]>;
  createLog(l: ActionLog): Promise<ActionLog>;
  updateLog(l: ActionLog): Promise<ActionLog>;
  deleteLog(id: string): Promise<void>;
  importLogs(ls: ActionLog[]): Promise<void>;
  listReviews(): Promise<ProposalReview[]>;
  saveReview(r: ProposalReview): Promise<void>;
  listPrograms(): Promise<PlcProgram[]>;
  saveProgram(p: PlcProgram): Promise<void>;
  deleteProgram(id: string): Promise<void>;
  getAssignment(): Promise<Record<string, string>>;
  /** 설비 한 대의 프로그램 지정만 바꾼다 (null = 기본 프로그램으로) */
  setAssignmentOne(equipmentId: string, programId: string | null): Promise<void>;
  /** 브라우저 저장소에 실제로 저장됐는가 (용량 초과·사생활 보호 모드면 false) */
  persistent(): boolean;
  listAudit(): Promise<AuditEntry[]>;
  appendAudit(e: AuditEntry): Promise<void>;
  updateAuditStatus(id: string, status: NonNullable<AuditEntry["status"]>): Promise<void>;
  listWork(): Promise<AlarmWork[]>;
  saveWork(w: AlarmWork): Promise<void>;
  resetDemo(): Promise<void>;
}

export function newLogId(): string {
  const r = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `L-${Date.now().toString(36).toUpperCase()}${r}`;
}

// ───────── 브라우저 저장소 ─────────

const KEY = {
  logs: "at:v1:logs",
  reviews: "at:v1:reviews",
  programs: "at:v1:programs",
  assignment: "at:v1:assignment",
  audit: "at:v1:audit",
  work: "at:v1:work",
};

const memory = new Map<string, string>();

let persistOk = true;

/** 메모리에 최신값이 있으면 그것을 먼저 읽는다 (저장 실패 후 예전 값을 다시 읽지 않도록) */
function read<T>(key: string, fallback: T): T {
  const mem = memory.get(key);
  if (mem !== undefined) return JSON.parse(mem) as T;
  try {
    const raw = typeof window !== "undefined" ? window.localStorage.getItem(key) : null;
    if (raw) memory.set(key, raw);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  const raw = JSON.stringify(value);
  memory.set(key, raw);
  try {
    window.localStorage.setItem(key, raw);
    persistOk = true;
  } catch {
    // 저장 불가(용량 초과·사생활 보호 모드) → 이 창을 닫기 전까지는 메모리 값으로 동작
    persistOk = false;
  }
}

export function localRepo(): Repo {
  const ensureLogs = (): ActionLog[] => {
    const cur = read<ActionLog[] | null>(KEY.logs, null);
    if (cur) return cur;
    const seed = generateSeedLogs(new Date());
    write(KEY.logs, seed);
    return seed;
  };
  return {
    mode: "local",
    async listLogs() {
      return ensureLogs();
    },
    async createLog(l) {
      write(KEY.logs, [l, ...ensureLogs()]);
      return l;
    },
    async updateLog(l) {
      write(
        KEY.logs,
        ensureLogs().map((x) => (x.id === l.id ? l : x)),
      );
      return l;
    },
    async deleteLog(id) {
      write(
        KEY.logs,
        ensureLogs().filter((x) => x.id !== id),
      );
    },
    async importLogs(ls) {
      const ids = new Set(ls.map((l) => l.id));
      write(KEY.logs, [...ls, ...ensureLogs().filter((x) => !ids.has(x.id))]);
    },
    async listReviews() {
      return read<ProposalReview[]>(KEY.reviews, []);
    },
    async saveReview(r) {
      write(KEY.reviews, [r, ...read<ProposalReview[]>(KEY.reviews, []).filter((x) => x.proposalId !== r.proposalId)]);
    },
    async listPrograms() {
      return read<PlcProgram[]>(KEY.programs, []);
    },
    async saveProgram(p) {
      write(KEY.programs, [p, ...read<PlcProgram[]>(KEY.programs, []).filter((x) => x.id !== p.id)]);
    },
    async deleteProgram(id) {
      write(
        KEY.programs,
        read<PlcProgram[]>(KEY.programs, []).filter((x) => x.id !== id),
      );
    },
    async getAssignment() {
      return read<Record<string, string>>(KEY.assignment, {});
    },
    async setAssignmentOne(equipmentId, programId) {
      const a = { ...read<Record<string, string>>(KEY.assignment, {}) };
      if (programId === null) delete a[equipmentId];
      else a[equipmentId] = programId;
      write(KEY.assignment, a);
    },
    persistent: () => persistOk,
    async listAudit() {
      return read<AuditEntry[]>(KEY.audit, []);
    },
    async appendAudit(e) {
      write(KEY.audit, [e, ...read<AuditEntry[]>(KEY.audit, [])].slice(0, 2000));
    },
    async updateAuditStatus(id, status) {
      write(
        KEY.audit,
        read<AuditEntry[]>(KEY.audit, []).map((x) => (x.id === id ? { ...x, status } : x)),
      );
    },
    async listWork() {
      return read<AlarmWork[]>(KEY.work, []);
    },
    async saveWork(w) {
      write(KEY.work, [w, ...read<AlarmWork[]>(KEY.work, []).filter((x) => x.id !== w.id)].slice(0, 500));
    },
    async resetDemo() {
      write(KEY.audit, []);
      write(KEY.work, []);
      write(KEY.logs, generateSeedLogs(new Date()));
      write(KEY.reviews, []);
      write(KEY.programs, []);
      write(KEY.assignment, {});
    },
  };
}

// ───────── Supabase (서버 API 경유, 키는 서버에만) ─────────

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/db/${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

export function remoteRepo(): Repo {
  return {
    mode: "supabase",
    listLogs: () => api<ActionLog[]>("logs"),
    createLog: (l) => api<ActionLog>("logs", { method: "POST", body: JSON.stringify(l) }),
    updateLog: (l) => api<ActionLog>("logs", { method: "PUT", body: JSON.stringify(l) }),
    deleteLog: async (id) => {
      await api(`logs?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    },
    importLogs: async (ls) => {
      await api("logs", { method: "POST", body: JSON.stringify(ls) });
    },
    listReviews: () => api<ProposalReview[]>("reviews"),
    saveReview: async (r) => {
      await api("reviews", { method: "PUT", body: JSON.stringify(r) });
    },
    listPrograms: () => api<PlcProgram[]>("programs"),
    saveProgram: async (p) => {
      await api("programs", { method: "PUT", body: JSON.stringify(p) });
    },
    deleteProgram: async (id) => {
      await api(`programs?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    },
    getAssignment: () => api<Record<string, string>>("assignment"),
    setAssignmentOne: async (equipmentId, programId) => {
      await api("assignment", { method: "PUT", body: JSON.stringify({ equipmentId, programId }) });
    },
    persistent: () => true,
    listAudit: () => api<AuditEntry[]>("audit"),
    appendAudit: async (e) => {
      await api("audit", { method: "POST", body: JSON.stringify(e) });
    },
    updateAuditStatus: async (id, status) => {
      await api("audit", { method: "PUT", body: JSON.stringify({ id, status }) });
    },
    listWork: () => api<AlarmWork[]>("work"),
    saveWork: async (w) => {
      await api("work", { method: "PUT", body: JSON.stringify(w) });
    },
    resetDemo: async () => {
      await api("seed", { method: "POST", body: "{}" });
    },
  };
}
