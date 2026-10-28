# Tidewatch v1.5.0

WSL Ubuntu의 Claude Code를 Windows Tidewatch 보드에 연결할 수 있습니다.

- 설정의 `WSL Claude 연결`에서 실행 중인 배포판에 상태 훅 설치
- 기존 Claude 설정 보존·백업, 실행 중인 세션 메타데이터 감지
- 도구 실행·승인 대기·오류·응답 종료 상태와 Windows 알림 연결
- 응답 종료를 전체 작업 성공과 구분, 대화·명령 내용은 기록하지 않음
- 알림 본문에 Tidewatch 로고 명시, 설치된 시작 메뉴·바탕화면 바로가기의 아이콘 경로 갱신

기존 Claude는 `/hooks`에서 새 설정을 확인하거나 다음 대화 재개 시 적용해야 합니다. 자동 상태 확인에는 Windows 앱이 켜져 있어야 합니다. 세부 진행률과 원본 터미널 탭 이동은 아직 지원하지 않습니다.

Windows x64용 코드 서명 없는 빌드입니다. 상세 연결 방법은 docs/wsl.md, 설치 파일 검증값은 SHA256SUMS.txt를 확인하세요.
