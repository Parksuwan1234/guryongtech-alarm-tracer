// 한국어 조사 고르기 — '운영팀과', '검사기(품질팀)와'처럼 받침에 맞춰
export function hasBatchim(word: string): boolean {
  const base = word.replace(/\s*\([^)]*\)\s*$/, "").trim();
  const ch = base.charCodeAt(base.length - 1);
  if (ch >= 0xac00 && ch <= 0xd7a3) return (ch - 0xac00) % 28 !== 0;
  return false;
}

/** 와/과: withWa("MES 운영팀") → "MES 운영팀과" */
export function withWa(word: string): string {
  return word + (hasBatchim(word) ? "과" : "와");
}

/** 마지막 글자 받침이 ㄹ인가 ('으로/로' 고를 때) */
function rieulFinal(word: string): boolean {
  const base = word.replace(/\s*\([^)]*\)\s*$/, "").trim();
  const ch = base.charCodeAt(base.length - 1);
  return ch >= 0xac00 && ch <= 0xd7a3 && (ch - 0xac00) % 28 === 8;
}

/** 조사 붙이기: josa("적층 위치 도착", "을") → "적층 위치 도착을", josa("1사이클 완료", "이") → "1사이클 완료가" */
export function josa(word: string, kind: "을" | "이" | "은" | "으로"): string {
  const b = hasBatchim(word);
  if (kind === "을") return word + (b ? "을" : "를");
  if (kind === "이") return word + (b ? "이" : "가");
  if (kind === "은") return word + (b ? "은" : "는");
  return word + (b && !rieulFinal(word) ? "으로" : "로");
}
