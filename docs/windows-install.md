# Windows 설치와 유의사항

## 다운로드와 설치

1. [공식 GitHub 릴리스](https://github.com/wonby1n/Tidewatch/releases/latest)에서 **Tidewatch-Setup.exe**를 받습니다. `tidewatch-skill.zip`은 스킬 수동 설치용이며 앱 설치 파일이 아닙니다.
2. 설치 파일을 실행하고 안내에 따라 설치합니다. 현재 사용자 계정용 설치이며 바탕화면과 시작 메뉴에 Tidewatch 바로가기를 만듭니다.
3. Tidewatch를 엽니다. 앱에서 Claude Code 또는 Codex의 **연결하기**를 누르면 해당 에이전트의 스킬을 설치할 수 있습니다.
4. 새 코딩 세션에서 구체적인 작업과 함께 Claude Code는 `/tidewatch`, Codex는 `$tidewatch` 사용을 요청합니다. 이미 열어둔 세션에서 스킬이 보이지 않으면 세션을 새로 시작하세요.

## 설치 전에 알아두세요

- **지원 환경:** 이 설치 파일은 Windows x64용입니다. 32비트 Windows 및 Windows ARM에서의 동작은 검증하지 않았습니다. macOS·Linux용 EXE는 아닙니다.
- **Node.js:** 앱 실행 환경은 포함되어 있으므로 앱을 직접 빌드할 필요는 없습니다. 다만 Claude Code·Codex가 상태 파일을 갱신하고 펫의 일부 명령을 실행하려면 [Node.js](https://nodejs.org/)가 필요합니다. 설치 파일은 Node.js나 AI 코딩 도구를 대신 설치하지 않습니다.
- **코드 서명:** 현재 개인 배포 빌드는 코드 서명되어 있지 않아 Windows SmartScreen이나 보안 제품에서 경고할 수 있습니다. 공식 저장소에서 내려받았는지와 아래 SHA-256을 확인하세요. 신뢰 여부를 확인할 수 없으면 실행하지 마세요. 보안 기능을 끌 필요는 없습니다.
- **설치 권한:** 기본적으로 현재 사용자 계정에 설치합니다. 회사·학교 PC에서는 조직의 앱 설치 정책을 따라야 합니다.
- **저장 위치:** 작업 상태·오류 요약·기록은 `%USERPROFILE%\.tidewatch`에, 창 위치 등의 앱 설정은 Electron의 사용자 데이터 폴더에 저장됩니다. 에이전트 연결 시 `~/.claude/skills/tidewatch` 또는 `~/.agents/skills/tidewatch`에 스킬을 씁니다.
- **로컬 동작:** Tidewatch 앱 자체에는 계정 가입이나 작업 상태의 클라우드 업로드 기능이 없습니다. 앱은 `127.0.0.1`에 로컬 서버를 엽니다. Claude Code·Codex 자체의 통신과 데이터 정책은 별개입니다.
- **상태의 정확성:** 진행률은 에이전트가 보고한 단계의 완료 비율입니다. 모든 프로세스를 직접 감지하거나 남은 시간을 예측하지 않습니다. 에이전트가 스킬을 사용하지 않거나 파일 쓰기 권한이 없으면 카드가 나타나지 않거나 갱신이 멈출 수 있습니다. 마지막 갱신 시각을 확인하세요.
- **민감한 정보:** 카드에 쓰인 오류 메시지나 작업 설명에 비밀키·개인정보·비공개 내용이 포함되지 않도록 주의하세요. 화면 캡처를 공유할 때도 확인하세요.
- **업데이트:** 자동 업데이트 기능은 없습니다. 앱을 종료한 뒤 새 공식 설치 파일을 실행하세요.
- **삭제:** Windows 설정의 설치된 앱에서 Tidewatch를 제거할 수 있습니다. 기존 세션과 스킬, 사용자 설정은 남을 수 있습니다. 완전히 삭제하려면 필요한 기록을 먼저 백업하고 해당 Tidewatch 폴더만 직접 정리하세요.

## 파일 확인

릴리스에 함께 제공되는 `SHA256SUMS.txt`와 다음 명령의 결과를 비교합니다. 파일 경로는 내려받은 위치로 바꾸세요.

```powershell
Get-FileHash "$HOME\Downloads\Tidewatch-Setup.exe" -Algorithm SHA256
```

해시는 내려받은 파일이 공개된 파일과 같은지 확인하는 용도이며 코드 서명을 대신하지 않습니다.

## 설치 후 카드가 안 보이면

1. 앱에서 Claude Code·Codex의 연결 상태를 확인하고, 연결되지 않았다면 **연결하기**를 누릅니다.
2. 터미널에서 `node --version`이 실행되는지 확인합니다.
3. 새 에이전트 세션에 Tidewatch 사용을 명시적으로 요청합니다.
4. Codex가 `~/.tidewatch`에 쓸 권한을 요청하면 해당 폴더에 필요한 권한인지 확인합니다. 전체 PC 접근 권한을 부여할 필요는 없습니다.
5. [이슈](https://github.com/wonby1n/Tidewatch/issues)에 Windows·Node.js 버전, 발생 단계와 민감한 내용을 가린 오류를 남깁니다.

## English

Download **Tidewatch-Setup.exe** from the [official release](https://github.com/wonby1n/Tidewatch/releases/latest), install it for your Windows user account, and launch Tidewatch. Use **연결하기** (Connect) for Claude Code or Codex, then start a new agent session and request `/tidewatch` or `$tidewatch` with a concrete task.

This is a Windows x64, unsigned build. Verify the source and the SHA-256 checksum; do not disable security protections. The app includes its own runtime, but agent status updates still require Node.js and a separately installed coding agent. The board UI is currently Korean. Status is agent-reported and can become stale. Data stays in local Tidewatch files; the coding agents' own network behavior is separate. There is no automatic updater. Uninstalling the app can leave sessions, settings, and installed skills behind.
