// '▶ 시뮬레이션 시작' 안내 단계와 첫 화면 '사용법' 팝업 내용.
// 안내는 화면 속 실제 요소(target 선택자)를 노란 테두리로 짚습니다. 선택자가 가리키는 요소는 tests/guide.test.ts가 소스에서 확인합니다.

/** 시뮬레이션에서 일으키는 알람 — 센서가 잠깐 전극을 놓쳐 울리고, 리셋만으로 풀리며 반복되는 알람 (마지막 개선 제안까지 같은 알람) */
export const SIM_ALARM = { equipmentId: "NT-03", code: "E-1105" } as const;

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

const ALARM_PAGE = { prefix: "/alarm/NT-03/E-1105", href: "/alarm/NT-03/E-1105", label: "NT-03 알람 화면으로 돌아가기 →" };

export const GUIDE_STEPS: GuideStep[] = [
  {
    title: "1. 알람이 떴습니다",
    body: "노칭 3호(NT-03)에 '전극 엣지 센서 미감지' 알람이 떴습니다. 전극 가장자리를 보는 센서가 전극을 놓쳤다는 뜻입니다. 오른쪽 위 알림에서 '알람 열기 → 켠 조건 보기'를 누르세요.",
    target: '[data-guide="toast-open"]',
    advanceOn: /^\/alarm\/NT-03\/E-1105$/,
    action: { href: "/alarm/NT-03/E-1105", label: "알림이 안 보이면 여기 →" },
  },
  {
    title: "2. '지금 할 일'부터 보세요",
    body: "왼쪽 '쉽게 말하면'에서 왜 떴는지 한 줄로 보고, 오른쪽 '지금 할 일'에서 안전 확인, 센서 위치, 전에 해결된 조치를 차례로 봅니다.",
    target: '[data-guide="todo"]',
    next: true,
    page: ALARM_PAGE,
  },
  {
    title: "3. 무엇이 알람을 켰는지 보세요",
    body: "도구가 래더를 거꾸로 따라가서 알람을 켠 신호를 그림으로 보여 줍니다. 여기서는 평소 ON이어야 할 엣지 센서 신호(X120)가 OFF여서 알람이 켜졌습니다. 업체에 묻지 않아도 바로 보입니다.",
    target: "#trace-flow",
    next: true,
    page: ALARM_PAGE,
  },
  {
    title: "4. 매뉴얼과 과거 조치 확인",
    body: "매뉴얼과 다른 노칭기들의 과거 조치를 함께 봅니다. 이 알람은 주로 리셋이나 센서 렌즈 청소로 해결됐습니다.",
    target: "#guide-manual",
    next: true,
    page: ALARM_PAGE,
  },
  {
    title: "5. 조치 후 기록",
    body: "한 일을 메모처럼 적고(예: 엣지 센서 렌즈 청소, 10분, 해결) '정리'를 누르면 조치 내용, 시간, 결과 칸이 채워집니다. 작업자를 적고 '기록 저장'을 누르면 인수인계와 개선 제안에 들어갑니다. 저장 안 하고 '다음'을 눌러도 됩니다.",
    target: "#guide-record",
    next: true,
    page: ALARM_PAGE,
  },
  {
    title: "6. 반복 알람은 개선 제안으로",
    body: "이 알람처럼 리셋으로 풀리고 또 뜨는 알람은, 쌓인 기록을 보고 재발을 막을 방법을 제안합니다. 방금 기록한 건도 들어갑니다. 위쪽 '개선 제안' 메뉴나 아래 버튼을 누르세요.",
    target: '[data-guide="nav-/improve"]',
    advanceOn: /^\/improve/,
    action: { href: "/improve#debounce:NOTCH_V1:E-1105", label: "개선 제안 열기 →" },
  },
  {
    title: "7. 래더 변경 검토서 보기",
    body: "방금 본 '전극 엣지 센서 미감지' 알람의 제안입니다. 신호가 잠깐 끊긴 건 넘기고, 일정 시간 이어질 때만 알람을 켜도록 래더를 바꾸자는 검토서입니다. 먼저 '호기별 분포'로 한 호기만의 문제인지 가려 보세요. 도구는 PLC에 쓰지 않고 검토서만 만듭니다.",
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
    title: "1. 알람이 뜨면 알림을 누르세요",
    body: "오른쪽 위 새 알람 알림이나 라인 그림의 빨간 칸(중알람), 주황 칸(경알람)을 누르면 알람 화면으로 갑니다. 먼저 볼 알람은 맨 위 한 줄 요약에 나옵니다.",
    img: "/guide/1_alarm.jpg",
    alt: "실시간 현황: 오른쪽 위 새 알람 알림과 주황색 NT-03 칸",
  },
  {
    title: "2. 알람 화면에서 '지금 할 일'을 보세요",
    body: "맨 위 '쉽게 말하면'에 무슨 일인지 한 줄로 나옵니다. '지금 할 일'에는 안전 확인, 먼저 볼 곳(센서 위치), 전에 해결된 조치가 순서대로 나옵니다.",
    img: "/guide/2_todo.jpg",
    alt: "알람 화면 위쪽: 알람을 켠 조건과 지금 할 일 3단계",
  },
  {
    title: "3. 흐름도에서 알람을 켠 신호를 찾으세요",
    body: "래더를 거꾸로 따라가, 실제로 알람을 켠 신호와 센서 위치, 멈춘 스텝을 흐름도로 보여 줍니다.",
    img: "/guide/3_flow.jpg",
    alt: "알람이 켜지는 흐름도: 꺼진 엣지 센서 신호 X120이 알람을 켬",
  },
  {
    title: "4. 매뉴얼과 과거 조치를 보고 조치하세요",
    body: "매뉴얼을 보고, 같은 기종 설비들의 과거 조치와 해결률도 확인한 뒤 조치합니다. 우리 설비 밖에서 온 신호면 어디에 확인할지도 나옵니다.",
    img: "/guide/4_manual.jpg",
    alt: "원천별 조치 가이드와 과거 조치 해결률",
  },
  {
    title: "5. 기록이 쌓이면 개선 제안이 됩니다",
    body: "한 일을 메모로 적고 '정리'를 누른 다음 '기록 저장'을 누르세요. 기록은 다음 근무조 인수인계에 들어갑니다. 쌓이면 '개선 제안'에서 래더 변경 검토서 같은 재발 방지안으로 정리됩니다.",
    img: "/guide/5_record.jpg",
    alt: "조치 기록 입력 칸: 현장 메모와 정리 버튼",
  },
];
