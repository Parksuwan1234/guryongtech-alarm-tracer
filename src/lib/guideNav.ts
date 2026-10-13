import type { GuideStep } from "@/data/guide";

/**
 * 시뮬레이션 안내의 단계 이동 규칙 (화면 없이 테스트할 수 있게 따로 둠)
 * - 주소가 실제로 바뀌었을 때만, 그 단계가 기다리던 화면이면 다음 단계로
 *   (알람 화면에서 다시 시작해도 1단계를 건너뛰지 않고, '이전'으로 돌아와도 저절로 넘어가지 않음)
 */
export function stepAfterNavigate(steps: GuideStep[], i: number, prevPath: string | null, path: string): number {
  if (prevPath === path) return i;
  const s = steps[i];
  return s?.advanceOn?.test(path) ? Math.min(i + 1, steps.length - 1) : i;
}

/** 이미 그 단계가 기다리던 화면에 와 있으면(예: '이전'으로 돌아온 경우) '다음' 버튼을 보여 줌 */
export function alreadyThere(step: GuideStep, path: string): boolean {
  return Boolean(step.advanceOn?.test(path));
}

/** 이 단계가 설명하는 화면을 벗어났는가 (벗어났으면 돌아가는 링크를 보여 줌) */
export function offPage(step: GuideStep, path: string): boolean {
  return Boolean(step.page && !path.startsWith(step.page.prefix));
}
