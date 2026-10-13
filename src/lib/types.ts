// 공통 타입 정의

export type ProcessKind = "COAT" | "PRESS" | "NOTCH" | "STACK";
export type Polarity = "양극" | "음극" | "";

/** 레이아웃의 설비 1대 */
export interface Equipment {
  id: string; // 예: NT-02
  name: string; // 예: 노칭기
  process: ProcessKind;
  polarity: Polarity;
  upstream: string[]; // 자재가 들어오는 상위 설비
  programId: string; // 연결된 PLC 프로그램 ID (설비별로 다르게 지정 가능)
}

/** 래더(명령어 리스트) 한 줄 */
export interface IlRow {
  step: number;
  instr: string; // LD, LDI, AND, ANI, OR, ORI, OUT, SET, RST, LD>= ...
  device: string;
  setValue: string; // 타이머 설정값(K30) 또는 비교값
  comment: string;
}

export type SourceKind = "현장 입력" | "외부 신호" | "래더 로직";

/** 디바이스 코멘트와 원천 구분 */
export interface DeviceInfo {
  device: string;
  comment: string;
  sourceKind: SourceKind;
  normal: number | null; // 평상시 값 (1/0). 지금 값이 다르면 '이상'으로 본다
  role: "" | "reset" | "state"; // reset = 알람 해제 조건(리셋 버튼), state = 운전 상태 조건(원인이 아닌 전제)
  checkWith: string; // 확인처 (외부 신호일 때 특히 중요)
  where: string; // 현장 위치(부품이 설비 어디에 있는지) — 래더를 모르는 사람도 찾아갈 수 있게
}

export type AlarmLevel = "경" | "중";

/** 보호 구분: 경·중 등급과 별개로, 래더 변경 제안 가능 여부를 정한다 */
export type ProtectKind = "안전" | "설비 보호" | "품질" | "";

export interface AlarmDef {
  code: string; // E-1023
  device: string; // M500
  level: AlarmLevel;
  name: string;
  protect: ProtectKind;
}

/** PLC 프로그램 1개 = 래더 + 디바이스 코멘트 + 알람 매핑 */
export interface PlcProgram {
  id: string; // NOTCH_V1
  name: string;
  ladderCsv: string;
  devicesCsv: string;
  alarmsCsv: string;
  uploadedAt?: string;
  builtIn?: boolean;
}

export interface ParsedProgram {
  id: string;
  name: string;
  rows: IlRow[];
  devices: Map<string, DeviceInfo>;
  alarms: AlarmDef[];
}

/** 조치 매뉴얼 항목 (현장 입력·외부 신호 원천용) */
export interface ManualEntry {
  id: string; // MAN-NT-01
  programId: string;
  alarmCode: string;
  sourceDevice: string;
  cause: string;
  steps: string[];
  safety: string;
  owner: string;
}

export type ActionType = "리셋" | "부품 교체" | "점검·조정" | "청소" | "보충" | "파라미터 변경" | "외부 확인" | "기타";
export type ActionResult = "해결" | "미해결";

/** 조치이력 1건 (DB 테이블 action_logs 와 같은 모양) */
export interface ActionLog {
  id: string;
  occurredAt: string; // ISO
  equipmentId: string;
  alarmCode: string;
  sourceDevice: string;
  cause: string;
  actionType: ActionType;
  action: string;
  result: ActionResult;
  durationMin: number;
  measured: number | null; // 측정값 (예: 비전 응답 3.2초, 미감지 0.08초, 압력 0.48MPa)
  measuredUnit: string;
  worker: string;
  note: string;
}

export type EquipStatus = "RUN" | "IDLE" | "STOP" | "ALARM";

export interface ActiveAlarm {
  equipmentId: string;
  code: string;
  level: AlarmLevel;
  name: string;
  since: number; // epoch ms
}

export type ProposalStatus = "검토 대기" | "승인" | "보류";

/** 개선 제안 검토 기록 (DB 테이블 proposal_reviews) */
export interface ProposalReview {
  proposalId: string;
  status: ProposalStatus;
  comment: string;
  reviewer: string;
  updatedAt: string;
}

export interface AppConfig {
  db: "supabase" | "local";
  ai: boolean;
}

/** 조치이력 변경 기록 (삭제·수정해도 원본이 남는 감사 기록, DB 테이블 action_log_audit) */
export interface AuditEntry {
  id: string;
  at: string;
  op: "추가" | "수정" | "삭제" | "복원" | "가져오기";
  logId: string;
  before: ActionLog | null;
  after: ActionLog | null;
  /** 시도 = 변경 전에 남긴 기록, 완료·실패 = 변경 결과 (실행되지 않은 변경과 구분) */
  status?: "시도" | "완료" | "실패";
}

/** 알람 대응 처리 상태 — 대시보드의 업무 기록일 뿐, PLC 알람 리셋·등급과는 별개 */
export type WorkStatus = "미접수" | "조치 중" | "후속 확인" | "종결";
export const WORK_STATUSES: WorkStatus[] = ["미접수", "조치 중", "후속 확인", "종결"];

export interface AlarmWork {
  id: string; // 발생 건 키: 설비|알람|발생시각
  equipmentId: string;
  alarmCode: string;
  startedAt: string; // 알람 발생 시각
  status: WorkStatus;
  owner: string; // 담당(사람·조·부서)
  nextAction: string; // 다음 확인 사항
  dueAt: string; // 확인 예정 시각 ("" = 미정)
  updatedAt: string;
  history: { at: string; status: WorkStatus; note: string }[];
}
