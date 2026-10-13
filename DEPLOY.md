# Vercel 배포 (5분)

환경 변수 없이 배포해도 동작합니다(조치이력은 방문자 브라우저에 저장). Supabase·AI 키는 나중에 추가해도 됩니다.

## 방법 A — 터미널 3줄 (맥, Node 설치되어 있을 때)

```bash
cd ~/Downloads/alarm-tracer      # 압축 푼 폴더
npx vercel login                 # 브라우저가 열리면 이미 로그인한 Vercel 계정으로 승인
npx vercel --prod                # 질문은 모두 Enter(기본값). 끝에 나오는 https://...vercel.app 이 공개 링크
```

## 방법 B — GitHub 경유 (강의에서 배운 방식)

1. GitHub에서 새 저장소(예: `alarm-tracer`, Public) 만들기
2. 저장소 화면의 **uploading an existing file** → 압축 푼 폴더 안의 파일·폴더를 전부 끌어다 놓기 → Commit
3. vercel.com → **Add New → Project → Import** 에서 그 저장소 선택 → **Deploy**

## 배포 후 확인

- 다른 기기(휴대폰)에서 링크가 로그인 없이 열리는지
- `/`, `/alarm/NT-02/E-1023`, `/improve` 세 화면이 뜨는지

## (선택) DB·AI 연결

Vercel 프로젝트 → Settings → Environment Variables 에 추가 후 Redeploy:

| 이름 | 값 |
|---|---|
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Supabase 프로젝트의 API 설정 (먼저 `supabase/schema.sql` 실행) |
| `ANTHROPIC_API_KEY` | AI 쉬운 설명용 (없으면 규칙 문장) |
