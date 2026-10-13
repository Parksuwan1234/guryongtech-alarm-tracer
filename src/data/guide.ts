// '▶ 시뮬레이션 시작' 안내 단계와 첫 화면 '사용법' 팝업 내용.
// 안내는 화면 속 실제 요소(target 선택자)를 노란 테두리로 짚습니다. 선택자가 가리키는 요소는 tests/guide.test.ts가 소스에서 확인합니다.

/** 시뮬레이션에서 일으키는 알람 — 남이 짠 래더의 순차 동작에서 멈춘 사례 */
export const SIM_ALARM = { equipmentId: "ST-01", code: "W-2502" } as const;

export interface GuideStep {
  title: string;
  body: string;
  /** 노란 테두리로 짚을 화면 요소 (CSS 선택자, 쉼표로 여러 후보 — 앞의 것이 있으면 그것을) */
  target: string;
  /** 이 주소로 이동하면 다음 단계로 (주소 경로 기준) */
  advanceOn?: RegExp;
  /** '다음' 버튼으로 넘어가는 단계 */
  next?: boolean;
  /** 안내 상자 안의 바로가기 */
  action?: { href: string; label: string };
  /** 마지막 단계 */
  finish?: boolean;
  /** 이 단계가 설명하는 화면 — 다른 화면으로 가면 돌아가는 링크를 보여 줌 */
  page?: { prefix: string; href: string; label: string };
}

const ALARM_PAGE = { prefix: "/alarm/ST-01/W-2502", href: "/alarm/ST-01/W-2502", label: "ST-01 알람 화면으로 돌아가기 →" };

export const GUIDE_STEPS: GuideStep[] = [
  {
    title: "① 알람이 발생했습니다",
    body: "스태킹 1호(ST-01)에 '사이클 타임 초과' 알람이 발생했습니다. 어느 화면에 있어도 오른쪽 위에 알림이 뜹니다. 알림의 '알람 열기 → 켠 조건 보기'를 누르세요.",
    target: '[data-guide="toast-open"]',
    advanceOn: /^\/alarm\/ST-01\/W-2502$/,
    action: { href: "/alarm/ST-01/W-2502", label: "알림이 안 보이면 여기 →" },
  },
  {
    title: "② '지금 할 일'부터 봅니다",
    body: "알람 화면 맨 위 '지금 할 일'이 안전 확인 → 먼저 볼 곳 → 과거에 해결된 조치 순서로 알려 줍니다. 무엇이 알람을 켰는지(래더 조건)는 바로 옆에 있습니다.",
    target: '[data-guide="todo"]',
    next: true,
    page: ALARM_PAGE,
  },
  {
    title: "③ 어디서 멈췄는지 — 흐름도",
    body: "도구가 설비 프로그램(래더)을 읽어 7단계 적층 동작을 그렸습니다. 주황색 '기다리는 중'이 알람 순간 멈춰 있던 곳입니다. 'S4 적층 하강'에서 적층 위치 센서 X243을 기다리는 사이, 사이클이 12초 감시(T65)를 넘었습니다.",
    target: '[data-guide="seq-wait"], [data-guide="seq-now"], #sequence',
    next: true,
    page: ALARM_PAGE,
  },
  {
    title: "④ 매뉴얼과 과거 조치를 확인합니다",
    body: "원천별 조치 가이드(매뉴얼)와, 같은 프로그램을 쓰는 설비들의 과거 조치·해결률을 보고 무엇을 할지 정합니다. 해결률은 기록 수가 적으면 낮춰 잡아 정렬합니다.",
    target: "#guide-manual",
    next: true,
    page: ALARM_PAGE,
  },
  {
    title: "⑤ 조치 후 기록합니다",
    body: "한 일을 말하듯 메모에 적고 '정리'를 누르면 조치 내용·유형·시간·결과 칸이 채워지고, 원인은 후보에서 고릅니다. 확인 후 '기록 저장'을 누르면 다음 근무조 인수인계와 개선 제안 계산에 쓰입니다. 저장하지 않고 '다음'을 눌러도 됩니다.",
    target: "#guide-record",
    next: true,
    page: ALARM_PAGE,
  },
  {
    title: "⑥ 기록이 쌓이면 개선 제안",
    body: "같은 알람이 리셋만으로 풀리며 반복되면, 쌓인 기록으로 다시 발생하지 않게 고칠 방향을 제안합니다. 방금 기록한 건도 계산에 들어갑니다. 위쪽 '개선 제안' 메뉴나 아래 버튼을 누르세요.",
    target: '[data-guide="nav-/improve"]',
    advanceOn: /^\/improve/,
    action: { href: "/improve#debounce:NOTCH_V1:E-1105", label: "개선 제안 열기 →" },
  },
  {
    title: "⑦ 고칠 방향을 검토서로",
    body: "먼저 호기별 분포로 한 호기 문제인지 설비군 공통인지 가리고, 래더를 어떻게 바꿀지 변경 전후와 승인 전 확인 항목을 검토서로 정리합니다. 도구는 PLC에 직접 쓰지 않습니다. 화면 숫자는 가상 데이터 예시입니다.",
    target: '[data-guide="unit-spread"], [data-guide="proposal"]',
    finish: true,
    page: { prefix: "/improve", href: "/improve#debounce:NOTCH_V1:E-1105", label: "개선 제안 화면으로 돌아가기 →" },
  },
];

export interface UsageSlide {
  title: string;
  body: string;
  img: string;
  alt: string;
}

/** 첫 화면 '사용법' 팝업 — 알람 발생부터 조치·기록까지 */
export const USAGE_SLIDES: UsageSlide[] = [
  {
    title: "1. 알람이 발생하면 알림을 누릅니다",
    body: "어느 화면에 있어도 오른쪽 위에 새 알람 알림이 뜹니다. 라인 그림의 빨간 칸(중알람·멈춤)이나 주황 칸(경알람·주의)을 눌러도 됩니다. 맨 위 한 줄 요약이 먼저 볼 알람을 알려 줍니다.",
    img: "/guide/1_alarm.jpg",
    alt: "실시간 현황: 오른쪽 위 새 알람 알림과 주황색 ST-01 칸",
  },
  {
    title: "2. 알람 화면에서 '지금 할 일'을 봅니다",
    body: "맨 위에 무엇이 알람을 켰는지(래더 조건)와 '지금 할 일'이 나옵니다. 안전 확인 → 먼저 볼 곳(센서 위치) → 과거에 해결된 조치 순서로 따라가면 됩니다.",
    img: "/guide/2_todo.jpg",
    alt: "알람 화면 위쪽: 알람을 켠 조건과 지금 할 일 3단계",
  },
  {
    title: "3. 흐름도로 어디서 왜 멈췄는지 봅니다",
    body: "남이 짠 래더도 도구가 읽어 그림으로 바꿉니다. 순차 동작이면 몇 번째 단계에서 무엇을 기다리다 멈췄는지, 단순한 알람이면 실제로 알람을 켠 신호 길을 보여 줍니다.",
    img: "/guide/3_flow.jpg",
    alt: "순차 동작 흐름도: S4 적층 하강 단계에서 X243을 기다리는 중",
  },
  {
    title: "4. 매뉴얼과 과거 조치를 확인하고 조치합니다",
    body: "원천별 조치 가이드(매뉴얼)와 같은 설비들의 과거 조치·해결률을 보고 조치합니다. 우리 설비 밖에서 온 신호면 어디에 확인할지도 알려 줍니다.",
    img: "/guide/4_manual.jpg",
    alt: "원천별 조치 가이드와 과거 조치 해결률",
  },
  {
    title: "5. 조치 후 기록하면 개선 제안이 됩니다",
    body: "한 일을 메모로 적고 '정리' → '기록 저장'. 기록은 다음 근무조 인수인계로 이어지고, 쌓이면 '개선 제안'에서 다시 발생하지 않게 고칠 방향(래더 변경 검토서)으로 정리됩니다.",
    img: "/guide/5_record.jpg",
    alt: "조치 기록 입력 칸: 현장 메모와 정리 버튼",
  },
];
