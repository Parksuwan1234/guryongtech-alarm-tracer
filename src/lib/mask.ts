// 외부 AI로 보내기 전 민감 값 가리기 (LOT · 사번 · IP · 이메일 · 전화번호)

const RULES: { name: string; re: RegExp }[] = [
  { name: "IP", re: /\b(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?\b/g },
  { name: "이메일", re: /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g },
  { name: "LOT", re: /\bLOT[-_ :]?[A-Z0-9-]{4,}\b/gi },
  { name: "사번", re: /(사번|사원번호|EMP|ID)\s*[:=#]?\s*[A-Z]?\d{5,8}\b/gi },
  { name: "전화", re: /\b0\d{1,2}-\d{3,4}-\d{4}\b/g },
  { name: "내선", re: /내선\s*\d{3,5}/g },
];

export interface MaskResult {
  text: string;
  count: number;
  byRule: Record<string, number>;
}

export function maskSensitive(text: string): MaskResult {
  let out = text;
  let count = 0;
  const byRule: Record<string, number> = {};
  for (const { name, re } of RULES) {
    out = out.replace(re, (m) => {
      count++;
      byRule[name] = (byRule[name] ?? 0) + 1;
      if (name === "사번") return m.replace(/[A-Z]?\d{5,8}$/i, "***");
      if (name === "LOT") return "LOT-***";
      return "***";
    });
  }
  return { text: out, count, byRule };
}
