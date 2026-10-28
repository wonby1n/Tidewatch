Windows에서 소스 빌드 없이 설치할 수 있는 **Tidewatch-Setup.exe**를 제공합니다.

### 다운로드

- **Tidewatch-Setup.exe**: Windows x64용 설치 파일. 실행 후 바탕화면 또는 시작 메뉴의 Tidewatch를 엽니다.
- **SHA256SUMS.txt**: 설치 파일의 SHA-256 검증값.
- GitHub의 Source code ZIP은 개발용 소스이며 설치 파일이 아닙니다. `tidewatch-skill.zip`도 앱 설치 파일이 아닙니다.

### 첫 사용

1. 설치 파일을 실행합니다. 현재 Windows 사용자 계정에 설치합니다.
2. 앱에서 Claude Code 또는 Codex의 **연결하기**를 누릅니다.
3. 새 코딩 세션에 구체적인 작업과 함께 Claude Code `/tidewatch` 또는 Codex `$tidewatch` 사용을 요청합니다.

### 유의사항

- 현재 빌드는 **코드 서명되지 않았습니다**. Windows SmartScreen 등이 경고할 수 있습니다. 공식 배포처와 SHA-256을 확인하고, 확인되지 않으면 실행하지 마세요. 보안 기능을 끌 필요는 없습니다.
- 앱 자체의 실행 환경은 포함되어 있습니다. **에이전트의 상태 갱신에는 Node.js가 별도로 필요합니다.** Claude Code·Codex도 별도 설치해야 합니다.
- Edge·Chrome을 실행하지 않는 Electron 전용 앱입니다. 현황판·메모장 모드, 창 크기·위치 저장을 지원합니다. 보드 UI는 현재 한국어입니다.
- Windows x64용이며 ARM·32비트 Windows와 macOS·Linux 앱 패키징은 검증하지 않았습니다.
- 상태는 에이전트가 기록합니다. 자동 감지된 실행 상태나 예상 남은 시간이 아니며, 기록이 중단되면 이전 상태가 남을 수 있습니다.
- 작업 데이터는 로컬 `.tidewatch` 폴더에 저장됩니다. AI 코딩 도구 자체의 통신 정책은 별개입니다.
- 자동 업데이트 기능은 없습니다. 새 버전을 설치하기 전에 앱을 종료하세요. 앱을 삭제해도 기존 세션·설정·스킬은 남을 수 있습니다.

자세한 설치·저장 위치·삭제·문제 해결: [Windows 설치 안내](https://github.com/wonby1n/Tidewatch/blob/main/docs/windows-install.md)

### English

Download **Tidewatch-Setup.exe** for Windows x64; no source build is required. Install it, launch the app, use **연결하기** (Connect) for your coding agent, and request Tidewatch in a new agent session. Node.js is still required for agent status updates. Coding agents are installed separately.

This build is unsigned. Verify the official source and `SHA256SUMS.txt`; do not disable security protections. The UI is currently Korean. Status is agent-reported and may become stale. Data stays in local Tidewatch files; agent network behavior is separate. There is no automatic updater, and uninstalling may leave sessions, settings, and skills behind.
