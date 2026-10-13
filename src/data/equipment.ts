// 라인 레이아웃: 코터 4(양극 2·음극 2) → 롤프레스 12(코터 1대당 3대) → 노칭 12(롤프레스와 1:1) → 스태킹 3
// upstream은 화면에 자재 흐름 선을 그리는 용도일 뿐, 알람은 설비마다 단독으로 발생합니다.

import type { Equipment, ProcessKind } from "@/lib/types";

const pad = (n: number) => String(n).padStart(2, "0");

export const PROCESS_LABEL: Record<ProcessKind, string> = {
  COAT: "코터",
  PRESS: "롤프레스",
  NOTCH: "노칭",
  STACK: "스태킹",
};

/** 전극 이송 속도(m/min, 가상) — 지속 판정 지연 동안 통과하는 전극 길이 계산용 */
export const LINE_SPEED: Record<ProcessKind, number | null> = {
  COAT: 60,
  PRESS: 80,
  NOTCH: 60,
  STACK: null,
};

export const DEFAULT_PROGRAM: Record<ProcessKind, string> = {
  COAT: "COAT_V1",
  PRESS: "PRESS_V1",
  NOTCH: "NOTCH_V1",
  STACK: "STACK_V1",
};

function build(): Equipment[] {
  const list: Equipment[] = [];
  for (let c = 1; c <= 4; c++) {
    const polarity = c <= 2 ? "양극" : "음극";
    list.push({ id: `CT-${pad(c)}`, name: `${polarity} 코터 ${c}호`, process: "COAT", polarity, upstream: [], programId: "COAT_V1" });
  }
  for (let r = 1; r <= 12; r++) {
    const coater = Math.ceil(r / 3);
    const polarity = r <= 6 ? "양극" : "음극";
    list.push({ id: `RP-${pad(r)}`, name: `롤프레스 ${r}호`, process: "PRESS", polarity, upstream: [`CT-${pad(coater)}`], programId: "PRESS_V1" });
  }
  for (let n = 1; n <= 12; n++) {
    const polarity = n <= 6 ? "양극" : "음극";
    list.push({ id: `NT-${pad(n)}`, name: `노칭 ${n}호`, process: "NOTCH", polarity, upstream: [`RP-${pad(n)}`], programId: "NOTCH_V1" });
  }
  // 스태킹 1대 = 양극 노칭 2대 + 음극 노칭 2대
  for (let s = 1; s <= 3; s++) {
    const a = (s - 1) * 2 + 1;
    list.push({
      id: `ST-${pad(s)}`,
      name: `스태킹 ${s}호`,
      process: "STACK",
      polarity: "",
      upstream: [`NT-${pad(a)}`, `NT-${pad(a + 1)}`, `NT-${pad(a + 6)}`, `NT-${pad(a + 7)}`],
      programId: "STACK_V1",
    });
  }
  return list;
}

export const EQUIPMENT: Equipment[] = build();
export const EQUIPMENT_BY_ID = new Map(EQUIPMENT.map((e) => [e.id, e]));
