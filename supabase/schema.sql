-- 알람 원인 추적 대시보드 · Supabase 스키마
-- Supabase 대시보드 > SQL Editor 에 붙여넣고 실행하세요.
-- 브라우저에는 키를 내보내지 않고, Next.js 서버(API 라우트)가 service role 키로만 접근합니다.

create table if not exists action_logs (
  id            text primary key,
  occurred_at   timestamptz not null,
  equipment_id  text not null,
  alarm_code    text not null,
  source_device text default '',
  cause         text default '',
  action_type   text not null check (action_type in ('리셋','부품 교체','점검·조정','청소','보충','파라미터 변경','외부 확인','기타')),
  action        text default '',
  result        text not null check (result in ('해결','미해결')),
  duration_min  integer not null default 0,
  measured      numeric,
  measured_unit text default '',
  worker        text default '',
  note          text default '',
  created_at    timestamptz not null default now()
);
create index if not exists action_logs_alarm_idx on action_logs (alarm_code, occurred_at desc);
create index if not exists action_logs_equipment_idx on action_logs (equipment_id, occurred_at desc);

create table if not exists proposal_reviews (
  proposal_id text primary key,
  status      text not null check (status in ('검토 대기','승인','보류')),
  comment     text default '',
  reviewer    text default '',
  updated_at  timestamptz not null default now()
);

create table if not exists plc_programs (
  id          text primary key,
  name        text not null,
  ladder_csv  text not null,
  devices_csv text not null,
  alarms_csv  text not null,
  uploaded_at timestamptz not null default now()
);

create table if not exists equipment_programs (
  equipment_id text primary key,
  program_id   text not null
);

-- 조치이력 변경 기록: 수정·삭제해도 원본이 남습니다(감사 추적).
create table if not exists action_log_audit (
  id     text primary key,
  at     timestamptz not null default now(),
  op     text not null check (op in ('추가','수정','삭제','복원','가져오기')),
  log_id text not null,
  before jsonb,
  after  jsonb,
  status text not null default '완료' check (status in ('시도','완료','실패'))
);
create index if not exists action_log_audit_log_idx on action_log_audit (log_id, at desc);

-- 알람 대응 처리 상태(미접수·조치 중·후속 확인·종결) — 대시보드 업무 기록, PLC 알람과 별개
create table if not exists alarm_work (
  id           text primary key,
  equipment_id text not null,
  alarm_code   text not null,
  started_at   timestamptz not null,
  status       text not null check (status in ('미접수','조치 중','후속 확인','종결')),
  owner        text default '',
  next_action  text default '',
  due_at       timestamptz,
  updated_at   timestamptz not null default now(),
  history      jsonb not null default '[]'::jsonb
);
create index if not exists alarm_work_open_idx on alarm_work (status, updated_at desc);

-- 행 수준 보안: 익명 키로는 아무것도 못 읽고 쓰게 막습니다(서버의 service role 키만 접근).
alter table action_logs enable row level security;
alter table proposal_reviews enable row level security;
alter table plc_programs enable row level security;
alter table alarm_work enable row level security;
alter table equipment_programs enable row level security;
alter table action_log_audit enable row level security;
