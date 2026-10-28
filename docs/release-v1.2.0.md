## 상단에서 AI 모델과 사용 한도를 확인하세요

- Claude Code·Codex의 **최근 모델**, 구독 한도 사용률, 초기화 시각을 표시합니다.
- Codex는 설치된 CLI의 공식 계정 한도 조회를 사용합니다. Claude Code는 **사용량 연결**로 공식 상태줄 데이터를 받습니다.
- 대화 입력·출력 토큰과 구독 한도를 구분합니다. 모델·토큰은 최근 로컬 세션 기준이며 다른 작업의 기록일 수 있습니다.
- 정보가 없거나 오래됐으면 **확인 불가·최신 확인 필요**로 표시합니다. 만료된 한도 수치를 0%라고 추측하지 않습니다.
- 실제로 한도를 소진했지만 정보가 안 오면 **한도 도달 직접 표시**를 사용할 수 있습니다. 직접 표시한 상태임을 구분하며, 다시 사용 가능해지면 해제하세요.
- 기존 Claude 커스텀 상태줄을 덮어쓰지 않습니다. Claude 데스크톱 앱에는 Claude Code 상태줄 연결이 적용되지 않습니다.

### 설치

**Tidewatch-Setup.exe**를 받아 앱을 종료한 뒤 설치하세요. Windows x64용이며 Node.js는 에이전트 상태 갱신에 별도로 필요합니다. 현재 빌드는 미서명 파일이므로 공식 배포처와 함께 제공한 SHA-256을 확인하세요. 자동 업데이트는 없습니다. 기존 세션을 유지합니다.

사용량 수집은 선택된 메타데이터만 사용하며 대화 본문이나 인증 토큰을 화면에 복사하지 않습니다. Codex 계정 조회에는 기존 Codex 로그인을 통한 통신이 발생하며 모델 추론을 요청하지 않습니다.

[사용량 연결·정보 출처·한계](https://github.com/wonby1n/Tidewatch/blob/main/docs/usage.md) · [설치 유의사항](https://github.com/wonby1n/Tidewatch/blob/main/docs/windows-install.md)

### English

The header now shows recent models, available quota percentages and reset times, and separate recent-session token counters. Codex quotas use its installed CLI's official account API; Claude Code can forward official status-line data without replacing an existing custom status line. Claude Desktop is not supported by that hook. Unknown, stale, expired, and manually reported limits are labeled explicitly. No prompts or credentials are copied to the usage panel. This remains an unsigned Windows x64 installer; Node.js is still needed for agent updates.
