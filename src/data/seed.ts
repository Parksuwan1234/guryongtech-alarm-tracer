// 가상 조치이력 생성기 (최근 90일, 결정적 난수)
// 개선 제안 엔진이 찾아낼 패턴을 일부러 심어 둡니다:
//   - 리셋만으로 풀리는 순간 신호 알람(E-1105, E-4401)  → 디바운스 래더 제안
//   - 리셋으로 풀리지만 신호가 긴 알람(E-3020)          → 디바운스 대신 하드웨어 점검 권고
//   - 타이머 설정 바로 위에 몰린 응답 시간(E-2041, W-2502) → 타이머 설정값 변경 제안
//   - 일정 간격으로 반복되는 부품 교체·청소·보충          → 예방정비 주기 제안
//   - 매뉴얼에 없는 조치로 해결되는 알람(E-1120)         → 매뉴얼 보강 제안
//   - 한 설비에 몰린 알람(E-1023 → NT-02)               → 설비 고유 하드웨어 점검 제안
//   - 외부 신호 원천 + 긴 대기(W-1401, E-4302)          → 담당 부서 협의 제안

import type { ActionLog, ActionType, ProcessKind } from "@/lib/types";
import { EQUIPMENT } from "./equipment";

interface Outcome {
  w: number;
  cause: string;
  source: string;
  type: ActionType;
  action: string;
  resolve: number;
  dur: [number, number];
  measured?: [number, number];
  unit?: string;
  note?: string;
}

interface Spec {
  code: string;
  process: ProcessKind;
  mode: "random" | "periodic";
  count?: number;
  interval?: [number, number];
  windowDays?: number;
  unitWeights?: Record<string, number>;
  outcomes: Outcome[];
}

const SPECS: Spec[] = [
  // ── 노칭 ──
  {
    code: "E-1105",
    process: "NOTCH",
    mode: "random",
    count: 112,
    outcomes: [
      {
        w: 0.86,
        cause: "전극 펄럭임으로 순간 미감지",
        source: "X120",
        type: "리셋",
        action: "리셋 후 재가동",
        resolve: 0.98,
        dur: [2, 6],
        measured: [0.02, 0.18],
        unit: "s",
      },
      {
        w: 0.14,
        cause: "엣지 센서 렌즈 오염",
        source: "X120",
        type: "청소",
        action: "센서 렌즈 청소 후 재가동",
        resolve: 0.95,
        dur: [10, 20],
        measured: [0.4, 1.4],
        unit: "s",
      },
    ],
  },
  {
    code: "E-1023",
    process: "NOTCH",
    mode: "random",
    count: 12,
    unitWeights: { "NT-02": 9 },
    outcomes: [
      {
        w: 0.55,
        cause: "서보앰프 냉각팬 정지",
        source: "X1A3",
        type: "부품 교체",
        action: "앰프 냉각팬 교체",
        resolve: 0.75,
        dur: [40, 80],
        measured: [66, 80],
        unit: "℃",
      },
      { w: 0.45, cause: "냉각팬 필터 막힘", source: "X1A3", type: "청소", action: "팬 필터 청소", resolve: 0.6, dur: [20, 35], measured: [68, 84], unit: "℃" },
    ],
  },
  {
    code: "E-1120",
    process: "NOTCH",
    mode: "random",
    count: 26,
    outcomes: [
      {
        w: 0.35,
        cause: "로드셀 영점 틀어짐",
        source: "D210",
        type: "점검·조정",
        action: "로드셀 영점 보정",
        resolve: 0.45,
        dur: [25, 45],
        measured: [55, 75],
        unit: "N",
      },
      {
        w: 0.25,
        cause: "댄서롤 움직임 불량",
        source: "D210",
        type: "점검·조정",
        action: "댄서롤 베어링 점검",
        resolve: 0.4,
        dur: [30, 50],
        measured: [58, 76],
        unit: "N",
      },
      {
        w: 0.4,
        cause: "댄서롤 공압 압력 부족",
        source: "D210",
        type: "기타",
        action: "댄서롤 공압 레귤레이터 0.25→0.30MPa 재조정",
        resolve: 0.95,
        dur: [15, 25],
        measured: [56, 72],
        unit: "N",
        note: "매뉴얼에 없는 조치",
      },
    ],
  },
  {
    code: "W-1401",
    process: "NOTCH",
    mode: "random",
    count: 16,
    outcomes: [
      { w: 1, cause: "MES 작업지시 미발행", source: "B0010", type: "외부 확인", action: "MES 운영팀에 작업지시 재발행 요청", resolve: 0.95, dur: [15, 45] },
    ],
  },
  {
    code: "E-1210",
    process: "NOTCH",
    mode: "periodic",
    interval: [18, 2],
    outcomes: [
      {
        w: 1,
        cause: "타발 금형 마모(버 발생)",
        source: "B0120",
        type: "부품 교체",
        action: "타발 금형 연마품으로 교체",
        resolve: 0.97,
        dur: [60, 100],
        measured: [14, 22],
        unit: "㎛",
      },
    ],
  },
  {
    code: "E-1302",
    process: "NOTCH",
    mode: "periodic",
    interval: [12, 2],
    outcomes: [{ w: 1, cause: "집진 필터 막힘", source: "X130", type: "청소", action: "집진 필터 탈진·청소", resolve: 0.97, dur: [15, 25] }],
  },
  {
    code: "E-1130",
    process: "NOTCH",
    mode: "random",
    count: 10,
    outcomes: [
      {
        w: 1,
        cause: "피딩 롤 슬립",
        source: "D220",
        type: "점검·조정",
        action: "피딩 롤 압력 조정",
        resolve: 0.85,
        dur: [20, 40],
        measured: [32, 48],
        unit: "㎛",
      },
    ],
  },
  // ── 스태킹 ──
  {
    code: "E-2041",
    process: "STACK",
    mode: "random",
    count: 46,
    windowDays: 45,
    outcomes: [
      {
        w: 0.62,
        cause: "레시피 변경 후 비전 처리 지연",
        source: "B0200",
        type: "리셋",
        action: "리셋 후 재검사",
        resolve: 0.97,
        dur: [3, 8],
        measured: [3.05, 3.65],
        unit: "s",
        note: "고속 레시피 적용 후",
      },
      {
        w: 0.24,
        cause: "비전 PC 응답 지연",
        source: "B0200",
        type: "외부 확인",
        action: "비전 프로그램 재시작",
        resolve: 0.9,
        dur: [10, 25],
        measured: [3.2, 3.9],
        unit: "s",
      },
      {
        w: 0.14,
        cause: "비전 PC 멈춤",
        source: "B0200",
        type: "외부 확인",
        action: "비전 PC 재부팅",
        resolve: 0.85,
        dur: [25, 50],
        measured: [6, 12],
        unit: "s",
      },
    ],
  },
  {
    code: "W-2502",
    process: "STACK",
    mode: "random",
    count: 22,
    windowDays: 30,
    outcomes: [
      {
        w: 0.8,
        cause: "고속 레시피에서 사이클 기준 초과",
        source: "M65",
        type: "리셋",
        action: "리셋 후 재가동",
        resolve: 0.98,
        dur: [2, 4],
        measured: [12.1, 12.9],
        unit: "s",
      },
      {
        w: 0.2,
        cause: "적층 픽업 재시도 발생",
        source: "M65",
        type: "점검·조정",
        action: "픽업 위치 보정",
        resolve: 0.9,
        dur: [15, 30],
        measured: [13.5, 16],
        unit: "s",
      },
    ],
  },
  {
    code: "E-2210",
    process: "STACK",
    mode: "periodic",
    interval: [11, 1.5],
    outcomes: [
      {
        w: 1,
        cause: "흡착 패드 마모",
        source: "X230",
        type: "부품 교체",
        action: "흡착 패드 교체",
        resolve: 0.96,
        dur: [30, 50],
        measured: [-48, -40],
        unit: "kPa",
      },
    ],
  },
  {
    code: "E-2105",
    process: "STACK",
    mode: "random",
    count: 10,
    outcomes: [
      { w: 1, cause: "분리막 롤 정렬 불량", source: "X220", type: "점검·조정", action: "분리막 롤 재장착, EPC 원점 복귀", resolve: 0.9, dur: [15, 30] },
    ],
  },
  {
    code: "W-2301",
    process: "STACK",
    mode: "random",
    count: 6,
    outcomes: [
      { w: 1, cause: "유틸리티 압공 공급 저하", source: "B0300", type: "외부 확인", action: "유틸리티팀 압공 공급 확인", resolve: 0.95, dur: [8, 20] },
    ],
  },
  {
    code: "E-2402",
    process: "STACK",
    mode: "random",
    count: 15,
    outcomes: [{ w: 1, cause: "매거진 자재 소진", source: "X250", type: "보충", action: "매거진 자재 보충", resolve: 1, dur: [3, 8] }],
  },
  {
    code: "E-2110",
    process: "STACK",
    mode: "random",
    count: 12,
    outcomes: [
      { w: 0.6, cause: "전극 정전기 부착", source: "X260", type: "점검·조정", action: "제전기 동작 확인·조정", resolve: 0.85, dur: [10, 25] },
      { w: 0.4, cause: "흡착 패드 오염", source: "X260", type: "청소", action: "흡착 패드 청소", resolve: 0.8, dur: [10, 20] },
    ],
  },
  // ── 코터 ──
  {
    code: "E-3020",
    process: "COAT",
    mode: "random",
    count: 26,
    outcomes: [
      {
        w: 0.72,
        cause: "배기팬 인버터 트립",
        source: "X320",
        type: "리셋",
        action: "인버터 리셋 후 재가동",
        resolve: 0.92,
        dur: [3, 8],
        measured: [0.8, 3.2],
        unit: "s",
      },
      {
        w: 0.28,
        cause: "인버터 입력 단자 풀림",
        source: "X320",
        type: "점검·조정",
        action: "입력 단자 재체결",
        resolve: 0.9,
        dur: [30, 60],
        measured: [1.5, 4],
        unit: "s",
      },
    ],
  },
  {
    code: "E-3105",
    process: "COAT",
    mode: "periodic",
    interval: [9, 1],
    outcomes: [
      {
        w: 1,
        cause: "슬러리 필터 막힘",
        source: "D410",
        type: "부품 교체",
        action: "슬러리 필터 교체",
        resolve: 0.97,
        dur: [25, 40],
        measured: [0.45, 0.52],
        unit: "MPa",
      },
    ],
  },
  {
    code: "E-3011",
    process: "COAT",
    mode: "random",
    count: 9,
    outcomes: [
      {
        w: 0.5,
        cause: "히터 SSR 불량",
        source: "D400",
        type: "부품 교체",
        action: "히터 SSR 교체",
        resolve: 0.9,
        dur: [40, 70],
        measured: [136, 142],
        unit: "℃",
      },
      {
        w: 0.5,
        cause: "열전대 접촉 불량",
        source: "D400",
        type: "점검·조정",
        action: "열전대 재체결",
        resolve: 0.85,
        dur: [20, 40],
        measured: [110, 114],
        unit: "℃",
      },
    ],
  },
  {
    code: "E-3201",
    process: "COAT",
    mode: "random",
    count: 12,
    outcomes: [
      { w: 0.6, cause: "슬롯다이 갭 편차", source: "B0400", type: "점검·조정", action: "슬롯다이 갭 조정", resolve: 0.85, dur: [8, 18] },
      { w: 0.4, cause: "측정기 교정 틀어짐", source: "B0400", type: "외부 확인", action: "품질팀 측정기 교정 확인", resolve: 0.9, dur: [8, 18] },
    ],
  },
  {
    code: "E-3302",
    process: "COAT",
    mode: "random",
    count: 7,
    outcomes: [
      {
        w: 1,
        cause: "권취 브레이크 마모",
        source: "D420",
        type: "점검·조정",
        action: "권취 브레이크 간극 조정",
        resolve: 0.85,
        dur: [25, 45],
        measured: [130, 148],
        unit: "N",
      },
    ],
  },
  {
    code: "E-3401",
    process: "COAT",
    mode: "random",
    count: 6,
    outcomes: [{ w: 1, cause: "웹 파단(장력 급변·이물)", source: "X330", type: "기타", action: "웹 재통판 후 저속 재가동", resolve: 0.95, dur: [60, 120] }],
  },
  // ── 롤프레스 ──
  {
    code: "E-4401",
    process: "PRESS",
    mode: "random",
    count: 72,
    outcomes: [
      {
        w: 0.8,
        cause: "전극 사행으로 순간 미감지",
        source: "X430",
        type: "리셋",
        action: "리셋 후 재가동",
        resolve: 0.98,
        dur: [2, 5],
        measured: [0.03, 0.26],
        unit: "s",
      },
      {
        w: 0.2,
        cause: "EPC 센서 위치 틀어짐",
        source: "X430",
        type: "점검·조정",
        action: "EPC 센서 위치 재조정",
        resolve: 0.92,
        dur: [15, 35],
        measured: [0.6, 2.5],
        unit: "s",
      },
    ],
  },
  {
    code: "E-4012",
    process: "PRESS",
    mode: "periodic",
    interval: [16, 2],
    outcomes: [
      {
        w: 1,
        cause: "롤 베어링 윤활 부족",
        source: "D500",
        type: "보충",
        action: "베어링 그리스 보충",
        resolve: 0.96,
        dur: [20, 35],
        measured: [70, 78],
        unit: "℃",
      },
    ],
  },
  {
    code: "E-4302",
    process: "PRESS",
    mode: "random",
    count: 12,
    outcomes: [
      { w: 1, cause: "유틸리티 냉각수 공급 저하", source: "B0500", type: "외부 확인", action: "유틸리티팀 냉각수 공급 확인", resolve: 0.92, dur: [20, 50] },
    ],
  },
  {
    code: "E-4210",
    process: "PRESS",
    mode: "random",
    count: 8,
    outcomes: [
      { w: 0.5, cause: "작동유 부족", source: "X420", type: "보충", action: "작동유 보충", resolve: 0.9, dur: [20, 40] },
      { w: 0.5, cause: "유압 피팅 누유", source: "X420", type: "부품 교체", action: "유압 호스 피팅 교체", resolve: 0.9, dur: [60, 120] },
    ],
  },
  {
    code: "E-4120",
    process: "PRESS",
    mode: "random",
    count: 9,
    outcomes: [
      {
        w: 1,
        cause: "롤 평행도 틀어짐",
        source: "D520",
        type: "점검·조정",
        action: "롤 평행도 측정·보정",
        resolve: 0.8,
        dur: [40, 80],
        measured: [55, 75],
        unit: "kN",
      },
    ],
  },
  {
    code: "E-4105",
    process: "PRESS",
    mode: "random",
    count: 12,
    outcomes: [
      {
        w: 0.6,
        cause: "갭 센서 보정값 틀어짐",
        source: "D510",
        type: "점검·조정",
        action: "갭 보정값 재설정",
        resolve: 0.85,
        dur: [15, 30],
        measured: [6, 9],
        unit: "㎛",
      },
      {
        w: 0.4,
        cause: "롤 열팽창 편차",
        source: "D510",
        type: "파라미터 변경",
        action: "갭 보정 오프셋 변경",
        resolve: 0.8,
        dur: [10, 20],
        measured: [6, 8],
        unit: "㎛",
      },
    ],
  },
];

const WORKERS: Record<string, string[]> = {
  운영: ["운영A", "운영B", "운영C", "운영D", "운영E", "운영F"],
  보전: ["보전A", "보전B", "보전C"],
  공정: ["공정A", "공정B"],
};

function workerGroup(t: ActionType): keyof typeof WORKERS {
  if (t === "부품 교체" || t === "점검·조정") return "보전";
  if (t === "파라미터 변경") return "공정";
  return "운영";
}

/** mulberry32 */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const SEED_DAYS = 90;

export function generateSeedLogs(now: Date = new Date(), seed = 20261014): ActionLog[] {
  const r = rng(seed);
  const between = (a: number, b: number) => a + (b - a) * r();
  const gauss = () => {
    let u = 0;
    for (let i = 0; i < 6; i++) u += r();
    return u - 3; // 근사 정규분포 (표준편차 ≈ 0.71)
  };
  const pickW = <T extends { w: number }>(list: T[]): T => {
    const total = list.reduce((s, x) => s + x.w, 0);
    let x = r() * total;
    for (const it of list) if ((x -= it.w) <= 0) return it;
    return list[list.length - 1];
  };
  const end = now.getTime();
  const DAY = 86400000;
  const out: Omit<ActionLog, "id">[] = [];

  const make = (spec: Spec, equipmentId: string, t: number) => {
    const o = pickW(spec.outcomes);
    const decimals = o.unit === "s" ? 2 : o.unit === "MPa" ? 2 : 0;
    const measured = o.measured ? Number(between(o.measured[0], o.measured[1]).toFixed(decimals)) : null;
    const group = workerGroup(o.type);
    const names = WORKERS[group];
    out.push({
      occurredAt: new Date(Math.round(t / 60000) * 60000).toISOString(),
      equipmentId,
      alarmCode: spec.code,
      sourceDevice: o.source,
      cause: o.cause,
      actionType: o.type,
      action: o.action,
      result: r() < o.resolve ? "해결" : "미해결",
      durationMin: Math.round(between(o.dur[0], o.dur[1])),
      measured,
      measuredUnit: o.measured ? (o.unit ?? "") : "",
      worker: names[Math.floor(r() * names.length)],
      note: o.note ?? "",
    });
  };

  for (const spec of SPECS) {
    const units = EQUIPMENT.filter((e) => e.process === spec.process).map((e) => e.id);
    if (spec.mode === "random") {
      const weights = units.map((u) => spec.unitWeights?.[u] ?? (spec.unitWeights ? 0.25 : 1));
      const window = (spec.windowDays ?? SEED_DAYS) * DAY;
      for (let i = 0; i < (spec.count ?? 0); i++) {
        let x = r() * weights.reduce((s, w) => s + w, 0);
        let unit = units[0];
        for (let k = 0; k < units.length; k++)
          if ((x -= weights[k]) <= 0) {
            unit = units[k];
            break;
          }
        make(spec, unit, end - r() * window);
      }
    } else {
      const [mean, sd] = spec.interval!;
      for (const unit of units) {
        let t = end - SEED_DAYS * DAY + r() * mean * DAY;
        while (t < end) {
          make(spec, unit, t);
          t += Math.max(mean * 0.5, mean + gauss() * 1.4 * sd) * DAY;
        }
      }
    }
  }
  // 공용 원인으로 여러 설비가 함께 멈춘 사례 (설비 간 연쇄가 아니라 같은 외부 원인)
  const cluster = (code: string, units: string[], daysAgo: number, hour: number, o: Outcome) => {
    const spec = SPECS.find((x) => x.code === code)!;
    const t0 = end - daysAgo * DAY + (hour - new Date(end).getHours()) * 3600000;
    units.forEach((u, i) => make({ ...spec, outcomes: [o] }, u, t0 + i * (60000 + r() * 120000)));
  };
  cluster("E-4302", ["RP-01", "RP-02", "RP-03", "RP-04", "RP-05"], 23, 10, {
    w: 1,
    cause: "유틸리티 냉각수 공급 압력 저하(공용 배관)",
    source: "B0500",
    type: "외부 확인",
    action: "유틸리티팀 냉각수 공급 확인",
    resolve: 0.95,
    dur: [30, 45],
  });
  cluster("W-1401", ["NT-03", "NT-04", "NT-09"], 51, 15, {
    w: 1,
    cause: "MES 서버 응답 지연(공용)",
    source: "B0010",
    type: "외부 확인",
    action: "MES 운영팀에 작업지시 재발행 요청",
    resolve: 1,
    dur: [20, 35],
  });

  out.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
  return out.map((l, i) => ({ ...l, id: `L${String(out.length - i).padStart(4, "0")}` }));
}
