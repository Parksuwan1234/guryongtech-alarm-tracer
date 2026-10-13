# Vercel 배포 (5분)

환경 변수 없이 배포해도 동작합니다(조치이력은 방문자 브라우저에 저장). Supabase·AI 키는 나중에 추가해도 됩니다.

## 방법 A — 터미널 3줄 (맥, Node 설치되어 있을 때)

```bash
cd ~/Downloads/alarm-tracer      # 압축 푼 폴더
npx vercel login                 # 브라우저가 열리면 이미 로그인한 Vercel 계정으로 승인
npx vercel --prod                # 질문은 모두 Enter(기본값). 끝에 나오는 https://...vercel.app 이 공개 링크
```

## 방법 B — GitHub 연결 (자동 배포, 추천)

저장소 이름은 `guryongtech-alarm-tracer`(공개)로 씁니다. 처음 한 번만:

```bash
brew install gh                  # GitHub 도구 (처음 한 번)
cd ~/Downloads/alarm-tracer
gh auth login                    # GitHub.com → HTTPS → Y → Login with a web browser
git init -b main
GH_USER=$(gh api user --jq .login); GH_ID=$(gh api user --jq .id)
git config user.name "$GH_USER"; git config user.email "$GH_ID+$GH_USER@users.noreply.github.com"
git add -A && git ls-files | grep -i env    # .env.example 하나만 보여야 함
git commit -m "알람 원인 추적 대시보드"
gh repo create guryongtech-alarm-tracer --public --source=. --remote=origin --push
```

이어서 브라우저에서 Vercel과 저장소를 연결합니다.

1. vercel.com → 기존 프로젝트(xplanit-alarm-tracer) → **Settings → Git** → **Connect Git Repository** → GitHub → `guryongtech-alarm-tracer` 선택
   (GitHub 앱 설치를 물으면 **Install** → 이 저장소만 선택해도 됨)
2. 연결만으로는 배포가 시작되지 않으므로, 터미널에서 한 번 밀어 줍니다:

```bash
git commit --allow-empty -m "배포" && git push
```

3. Vercel → **Deployments**에 새 배포가 **Building → Ready**(1~2분)가 되면 끝

그다음부터는 `git add -A && git commit -m "고친 내용" && git push` 하면 Vercel이 자동으로 다시 배포합니다.

## 사이트 주소 바꾸기 (guryongtech-alarm-tracer.vercel.app)

1. vercel.com → 프로젝트 → **Settings → Domains** → `guryongtech-alarm-tracer.vercel.app` 입력 → **Add**
2. 기존 `xplanit-alarm-tracer.vercel.app` 옆 **Edit** → **Redirect to** 새 주소 → Save (옛 링크로 들어와도 새 주소로 넘어감)
3. (선택) **Settings → General → Project Name**도 `guryongtech-alarm-tracer`로
4. GitHub 저장소를 예전 이름으로 만들었다면 저장소 **Settings → Repository name**에서 바꾸기 (옛 주소는 GitHub가 자동으로 넘겨 줌)

## 배포 후 확인

- 다른 기기(휴대폰)에서 링크가 로그인 없이 열리는지
- `/`, `/alarm/NT-02/E-1023`, `/improve`, `/tour` 화면이 뜨는지, 위쪽 ▶ 시뮬레이션 시작이 끝까지 되는지
- 화면 맨 아래 버전과 팀 이름(구룡테크)

## (선택) DB·AI 연결

Vercel 프로젝트 → Settings → Environment Variables 에 추가 후 Redeploy:

| 이름 | 값 |
|---|---|
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Supabase 프로젝트의 API 설정 (먼저 `supabase/schema.sql` 실행) |
| `ANTHROPIC_API_KEY` | AI 쉬운 설명용 (없으면 규칙 문장) |
