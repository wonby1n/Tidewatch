---
name: tidewatch
description: Tidewatch — 여러 Claude Code·Codex 세션의 진행 상황을 물이 차오르는 브라우저 현황판에 띄운다. 여러 단계 작업을 시작할 때, 또는 사용자가 Tidewatch·타이드워치·현황판·진행 상황 보드를 말할 때 쓴다.
---

# Tidewatch 🌊

사용자는 AI 코딩 세션(Claude Code, Codex)을 10개 넘게 동시에 띄워 놓고 일한다. 다른 세션을 보다가 돌아왔을 때 터미널 로그를 거슬러 올라가지 않고도 **이 세션이 뭘 하고 있고, 어디까지 했고, 어디서 막혔고, 내가 뭘 해야 하는지**를 브라우저 한 화면에서 바로 알 수 있게 하는 게 목적이다.

구조: 세션마다 `~/.tidewatch/sessions/<id>.json` 파일 하나를 쓴다. `node ~/.tidewatch/tidewatch.mjs build`를 실행하면 모든 세션을 모아 `~/.tidewatch/tidewatch.html`과 `board-data.js`를 만든다. 페이지는 3초마다 바뀐 부분만 갱신하고, 서버는 필요 없다.

화면: 카드마다 진행률만큼 물이 차오르고, 수면 위에 봇이 떠 있다. 작업 중이면 둥실둥실 떠 있고, `waiting`이면 `?` 말풍선을 띄우고 통통 뛴다. `blocked`면 X 눈으로 떨고, 30분 넘게 소식이 없으면 졸고(`z`), `done`이면 웃는다. 단계마다 걸린 시간이 붙고, 오류가 난 단계는 빨간 ✕로 표시된다.

## 1. 준비 (세션마다 처음 한 번)

1. `~/.tidewatch/tidewatch.mjs`가 있는지 확인한다. 없거나 두 번째 줄이 이 스킬 폴더의 `scripts/tidewatch.mjs` 두 번째 줄(`// Tidewatch v3 …`)과 다르면, `scripts/tidewatch.mjs`를 `~/.tidewatch/tidewatch.mjs`로 복사한다. 홈 경로는 `node -e "console.log(require('os').homedir())"`로 확인한다.
2. 세션 id를 정한다: `<프로젝트폴더명>-<agent>-<영문 소문자·숫자 4글자>` (예: `pickcase-claude-k3f9`). 마지막 4글자는 처음 한 번 무작위로 정한다. 영문 소문자, 숫자, `-`만 쓴다.
   - **세션 1개 = 카드 1장.** 이 세션이 끝날 때까지 같은 id, 같은 파일만 쓴다. 같은 세션에서 사용자가 새 일을 맡기면 새 카드를 만들지 않고 이 카드의 `task`·`goal`·`steps`를 새 일로 바꾸고 (주제까지 바뀌면 `title`도), 끝난 일은 `log` 맨 위에 `✓ <끝난 일> — <결과 한 줄>`로 남긴다.
   - 같은 프로젝트에서 세션을 여러 개 돌리면 카드는 세션마다 하나씩이고, 현황판이 `project` 이름으로 알아서 묶어 보여준다. `project`는 프로젝트 폴더 이름을 그대로 쓴다.
3. 아래 형식으로 `~/.tidewatch/sessions/<id>.json`을 쓰고 `node ~/.tidewatch/tidewatch.mjs build`를 실행한다.
4. 이 세션에서 처음으로 보드를 만들었고 사용자가 아직 현황판을 안 열었을 것 같으면 `node ~/.tidewatch/tidewatch.mjs app`으로 현황판 창을 한 번 띄운다 (주소창 없는 앱 창, 브라우저를 못 찾으면 기본 브라우저로 열림). 이미 열려 있으면 다시 열지 않는다. 열린 창이 알아서 갱신된다. 사용자는 바탕화면의 Tidewatch 아이콘으로도 열 수 있다.

**Codex 샌드박스**: `~/.tidewatch`는 작업 폴더 밖이라 기본 샌드박스에서 쓰기가 막힐 수 있다. 막히면 사용자에게 승인을 요청하거나, `~/.codex/config.toml`의 `[sandbox_workspace_write]`의 `writable_roots`에 `~/.tidewatch`의 절대 경로를 추가하라고 안내한다. 승인이 안 되면 보드 갱신은 건너뛰고 작업은 계속한다.

## 2. 세션 파일 형식

파일 이름은 `<id>.json` (예: `pickcase-claude-k3f9.json`).

```json
{
  "agent": "claude",
  "project": "pickcase",
  "title": "Pickcase 백업 개선",
  "task": "백업을 zip으로 바꾸기",
  "goal": "사진이 많아도 백업되게",
  "status": "blocked",
  "now": "restoreBackup 테스트가 실패해서 원인 보는 중",
  "needsYou": "",
  "error": {
    "where": "tests/records.cjs:142 · npm test",
    "message": "AssertionError: expected 3 photos, got 0"
  },
  "steps": [
    { "text": "zip 라이브러리 고르기", "state": "done", "detail": "react-native-zip-archive (Expo 플러그인 있음)" },
    { "text": "exportBackup zip으로", "state": "done" },
    { "text": "restoreBackup zip 읽기", "state": "error", "detail": "압축 푼 경로가 캐시 폴더라 사진 참조가 깨짐" },
    { "text": "테스트 고치기", "state": "todo" }
  ],
  "log": ["zip 안 사진 경로를 상대 경로로 바꾸기로 함"]
}
```

- `title`: **대주제**. 이 세션이 붙잡고 있는 큰 주제(예: "Pickcase 백업 개선", "Tidewatch 다듬기")로, 카드에 제일 크게 뜬다. 세션 안에서 일이 바뀌어도 주제가 같으면 그대로 둔다.
- `task`: **이번 일**. 대주제 안에서 지금 맡은 구체적인 일 (예: "백업을 zip으로 바꾸기"). 제목 밑에 작게 뜬다. 같은 세션에서 새 일을 맡으면 이걸 바꾼다.
- `agent`: 지금 이 세션을 돌리는 에이전트. Claude Code면 `"claude"`, Codex면 `"codex"`. 카드에 배지로 뜬다.
- `status`: `working` 작업 중 / `waiting` 사용자의 답이나 확인이 필요함 / `blocked` 오류나 권한 때문에 더 못 나아감 / `done` 끝
- `now`: 지금 하는 일 **한 줄**. 카드에서 색깔 박스로 강조되고, 돌아온 사람이 제일 먼저 읽는 줄이다. `done`이면 "결과"로 표시되니 결과를 한 줄로 쓴다.
- `needsYou`: 사용자가 해야 할 일이나 답해야 할 질문. 없으면 `""`. `waiting`이면 반드시 채우고, 무엇을 골라야 하는지 또는 무엇을 실행해야 하는지까지 구체적으로 쓴다.
- `error`: 오류가 났을 때만 넣는다. `where`에는 파일:줄, 명령어, 단계 이름처럼 **어디서** 났는지 쓰고, `message`에는 실제 에러 메시지의 핵심 1~5줄을 쓴다. 고치고 나면 `error`를 빼고 해당 단계를 `doing`이나 `done`으로 바꾼다. 스스로 고칠 수 없는 오류면 `status: "blocked"`로 두고 `needsYou`에 사용자가 할 일을 쓴다.
- `steps`: 3~8개, 사용자가 알아들을 말로 쓴다. `state`는 `done` / `doing` / `todo` / `error` / `skipped` 중 하나다. `doing`과 `error`는 합쳐서 한 번에 하나만 둔다. `detail`(선택)은 그 단계에서 알아낸 것, 고른 것, 실패한 이유를 한 줄로 쓴다.
- `log`: 나중에 돌아왔을 때 알아야 할 결정, 발견, 바뀐 방향. 최신을 맨 위에 두고 10개까지만 남긴다. 명령어 출력이나 "파일 읽음" 같은 과정 기록은 넣지 않는다.
- 시간은 넣지 않는다. 스크립트가 build할 때마다 단계 상태 변화를 기록해서 "4분 걸림", "2분째" 같은 시간을 계산하고, 파일 수정 시간으로 "몇 분 전"을 표시한다.
- 카드에는 `steps`가 로드맵으로 뜬다: 칸으로 나뉜 진행 막대, "2 / 4 단계 · 다음: ○○", 그리고 끝난 단계 ✓, 지금 단계 "지금 여기", 오류 단계 "여기서 막힘", 남은 단계 빈 동그라미. 그래서 단계 이름은 로드맵에서 읽기 좋게 짧은 동사구로 쓴다.
- 물 높이는 `done`·`skipped` 단계의 비율이다 (`status`가 `done`이면 가득). 단계를 실제로 끝냈을 때만 `done`으로 바꾼다.

### 100%(끝)의 기준

`status: "done"`은 아래 세 가지가 **모두** 맞을 때만 쓴다.

1. 모든 단계가 `done` 또는 `skipped`다.
2. 결과를 직접 확인했다. 단계에 맞는 확인을 한다: 코드면 테스트·빌드·실행, 문서면 파일을 열어 봄, 배포면 주소에 접속해 봄.
3. 사용자가 해야 할 일이 남지 않았다.

- 마지막 단계가 사용자가 직접 해야 하는 일(설치 명령 실행, 실기기 확인, 승인, 결정)이면 그 단계를 `doing`으로 두고 `status: "waiting"` + `needsYou`로 끝낸다. 사용자가 "했어", "됐어"라고 하면 그 단계를 `done`으로, `status`를 `done`으로 바꾼다.
- 사용자가 "그건 안 해도 돼"라고 하면 그 단계는 `skipped`다.
- 확인하다 문제가 나오면 `done`이 아니라 `error` 단계를 추가하거나 되돌린다.

## 3. 언제 갱신하나

갱신하려면 세션 파일을 통째로 다시 쓰고 `build`를 실행한다. 도구 호출 두 번으로 끝나게 짧게 한다.

- 작업을 시작할 때 (단계 계획을 세우자마자)
- 단계 하나가 끝날 때
- **오류가 났을 때** (`error`와 해당 단계 `state: "error"`), 그리고 고쳤을 때
- 방향이 바뀌거나 중요한 결정을 내렸을 때 (`log`에 추가)
- **턴을 끝내기 직전에는 무조건 갱신한다.** 질문하고 끝나면 `waiting` + `needsYou`, 일을 다 마쳤으면 `done` + `now`에 결과 한 줄, 막혔으면 `blocked` + `error` + `needsYou`. 사용자는 세션이 멈췄을 때 돌아오므로 이 갱신이 제일 중요하다.

도구를 부를 때마다 갱신하지는 않는다. 보드는 요약이지 로그가 아니다.

## 4. 정리

- 사용자는 현황판에서 카드의 ✕나 "끝난 카드 정리" 버튼으로 카드를 지울 수 있다. 지운 세션이 다시 갱신되면 카드가 다시 뜬다.
- `build`는 끝난 지 하루 넘은 세션과 3일 동안 안 바뀐 세션의 파일을 알아서 지운다.
- 사용자가 터미널로 지워 달라고 하면 `node ~/.tidewatch/tidewatch.mjs remove <id>`를 쓴다.
- 다른 세션의 파일은 고치거나 지우지 않는다.

## 5. 주의

- 세션 파일은 UTF-8 JSON으로 쓴다. JSON이 깨지면 "어디서 터졌나"에 그 파일 이름이 뜨니까, 그런 카드를 보면 바로 고친다.
- 비밀번호, 토큰, API 키, 개인정보는 세션 파일에 넣지 않는다. `error.message`에 섞여 있으면 가리고 쓴다.
- Windows에서도 `node`와 `~/.tidewatch` 경로는 똑같이 동작한다. `open`은 Windows에선 `start`, macOS에선 `open`, Linux에선 `xdg-open`을 쓴다.
