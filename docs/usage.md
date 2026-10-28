# 상단 모델·사용 한도

Tidewatch 상단의 **AI 사용 상태**는 Claude Code와 Codex의 최근 모델, 구독 사용 한도, 초기화 시각과 대화 토큰을 구분해 보여줍니다.

## 수치의 의미

- **최근 모델:** 이 PC의 최근 로컬 세션 기록 또는 Claude Code 상태줄이 보고한 모델입니다. 모든 세션의 모델이 같다는 뜻이 아닙니다. 모델 기록 시각을 함께 확인하세요.
- **5시간·주간 사용률:** 도구가 제공한 구독 한도 사용 비율입니다. `100% 사용`은 해당 구간의 한도를 소진했다는 뜻이며, 남은 토큰의 절대 개수는 아닙니다.
- **초기화:** 도구가 제공한 초기화 시각입니다. 그 시각이 지났지만 새 수치가 없으면 만료된 정보로 표시합니다. 임의로 0%로 바꾸지 않습니다.
- **최근 대화 누적 토큰:** 가장 최근에 확인한 로컬 세션의 입력·출력 토큰입니다. 청구 금액이나 구독의 남은 토큰이 아닙니다. 현재 보고 있는 작업과 다른 세션일 수 있습니다.
- **컨텍스트:** Claude Code가 보고한 해당 대화의 컨텍스트 사용률입니다. 구독 한도와 별개입니다.
- **확인 불가 / 최신 확인 필요:** 데이터가 없거나 5분 이상 오래됐다는 뜻입니다. 자동으로 한도 소진이나 0% 사용으로 간주하지 않습니다.

## Codex

설치된 Codex CLI의 공식 `app-server`를 사용해 기존 로그인 계정의 `account/rateLimits/read`를 읽기 전용으로 호출합니다. 앱이 열린 상태에서 약 1분 간격으로 조회하고, **한도 새로고침**으로 다시 확인할 수 있습니다. 대화를 생성하거나 모델 추론 요청을 보내지 않습니다. 기존 Codex 로그인이 필요하며 Tidewatch는 인증 토큰 파일을 직접 읽거나 저장하지 않습니다.

Codex 데스크톱에 포함된 CLI 또는 PATH의 `codex` 실행 파일을 찾습니다. 찾지 못하면 수치를 만들지 않고 미확인 상태로 둡니다. 필요하면 실행 환경의 `TIDEWATCH_CODEX_BIN`에 Codex 실행 파일 경로를 지정할 수 있습니다.

모델·대화 토큰은 `~/.codex/sessions`의 최근 기록에서 선택한 메타데이터만 추출합니다. 내부 자동 검토 세션은 모델 표시 대상에서 제외합니다. CLI 계정과 다른 세션 계정을 함께 사용한다면 한도와 모델의 계정이 같다고 단정할 수 없습니다.

## Claude Code

상단 Claude Code 요약을 펼친 뒤 **사용량 연결**을 누르면 `~/.claude/settings.json`의 공식 `statusLine` 연결을 추가합니다. 다른 설정은 보존하며, 최초 연결 전 상태줄 설정만 `~/.tidewatch/claude-statusline-before-usage.json`에 저장합니다. 환경 변수나 다른 설정은 백업에 복사하지 않습니다. 이미 다른 커스텀 상태줄이 있으면 덮어쓰지 않고 안내합니다.

상태줄은 추론 토큰을 사용하지 않습니다. Claude Code가 전달한 `model`, `context_window`, `rate_limits` 중 필요한 필드만 `~/.tidewatch/usage/`에 저장합니다. 한도는 지원되는 구독과 세션에서 API 응답 이후 제공되므로, 아직 응답하지 못했거나 한도 소진 상태라면 수치가 없을 수 있습니다. Claude **데스크톱 앱**에는 이 CLI 상태줄 연결이 적용되지 않습니다.

연결 전에는 `~/.claude/projects`의 최근 로컬 기록에서 모델 메타데이터를 확인할 수 있습니다. 오래된 모델 기록은 현재 선택된 모델과 다를 수 있습니다.

다른 상태줄이 있는 경우 기존 스크립트에서 Claude Code의 입력 JSON을 아래 명령에도 전달하도록 직접 통합할 수 있습니다. 원래 상태줄의 출력을 유지하고, 이 명령의 출력은 버리세요.

```sh
node ~/.tidewatch/usage.mjs claude-statusline
```

연결을 해제하려면 Claude 설정에서 Tidewatch의 `statusLine` 필드만 제거하거나 백업에서 이전 상태줄을 복원합니다. 백업에는 상태줄 항목만 있으므로 다른 설정을 덮어쓰지 말고 해당 항목만 복원하세요.

## 한도 소진을 직접 표시

수치가 제공되지 않더라도 실제 도구에서 한도 소진을 확인했다면 **한도 도달 직접 표시**를 누를 수 있습니다. 이 상태는 **직접 표시**라는 문구와 함께 별도로 저장됩니다. 확인된 계정 수치를 바꾸지 않습니다. 다시 사용 가능해졌다면 **직접 표시 해제**를 누르세요. 초기화가 확인됐다고 자동 추측하지 않습니다.

## 데이터와 네트워크

작업 설명·대화 본문·인증 토큰은 사용량 화면에 복사하지 않습니다. 최근 로컬 세션 파일의 끝부분을 읽어 모델·시각·토큰 수 등의 선택된 메타데이터만 추출하며, 추출값은 로컬에서 사용합니다. 구독 한도 조회에는 Codex 도구 자체의 계정 통신이 발생합니다. Claude 상태줄은 외부 API를 추가로 호출하지 않습니다.

## 근거

- [Codex App Server: account/rateLimits/read](https://learn.chatgpt.com/docs/app-server)
- [Claude Code status line: available data and rate limits](https://code.claude.com/docs/en/statusline)

## English

The header separates recent-session models and token counters from subscription quota percentages. Codex quotas are read through the installed CLI's official `account/rateLimits/read` API using its existing login, without starting model inference. Claude Code data is captured through an optional official status-line hook; existing custom status lines are not overwritten. Claude Desktop is not supported by that hook. Missing or stale data is labeled explicitly, and a manually reported limit is kept separate from measured values. Recent model/token metadata can belong to another local session. No prompts or credentials are copied into the usage panel. Codex account queries use the Codex tool's network connection.
