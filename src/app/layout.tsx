import type { Metadata } from "next";
// 발표 자료·시연 영상과 같은 글꼴: 본문 Noto Sans KR, 제목 IBM Plex Sans KR (자체 호스팅 — 외부 글꼴 서버 없이도 동일하게 보임)
import "@fontsource/noto-sans-kr/400.css";
import "@fontsource/noto-sans-kr/500.css";
import "@fontsource/noto-sans-kr/700.css";
import "@fontsource/ibm-plex-sans-kr/600.css";
import "@fontsource/ibm-plex-sans-kr/700.css";
import "./globals.css";
import { AppShell } from "@/components/AppShell";

export const metadata: Metadata = {
  title: "알람 원인 추적 대시보드 · 구룡테크",
  description: "PLC 래더를 거꾸로 따라가 설비 알람 원인을 찾고, 조치이력으로 재발 방지안을 내는 현장 대시보드. 가상 데이터로 만든 시제품입니다.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
