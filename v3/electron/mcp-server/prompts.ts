import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

const SECRET_OUTPUT_GUARDRAIL =
  '보안: `.env`, `.mcp.json`, firebase-config, service account JSON, OAuth/Toss/Paddle/API key 파일의 원문을 cat/print/log 하지 마세요. 설정 확인은 존재 여부, 경로, 마스킹된 값만 사용하세요.';

export function registerPrompts(server: McpServer): void {
  server.prompt(
    'team_leader',
    'Agent Teams 방식으로 프로젝트를 태스크로 분해하고 에이전트를 스폰해서 업무를 진행합니다.',
    () => ({
      messages: [{
        role: 'user' as const,
        content: {
          type: 'text' as const,
          text: [
            'Marblo MCP를 사용해서 Agent Teams 방식으로 프로젝트를 진행합니다.',
            SECRET_OUTPUT_GUARDRAIL,
            '',
            '1. 사용자에게 프로젝트 이름과 만들고 싶은 것을 물어보세요.',
            '2. 요구사항을 분석해서 태스크를 분해합니다:',
            '   - 각 태스크는 1~2시간 분량',
            '   - role: backend/frontend/test/devops',
            '   - depends_on으로 의존성 설정 (TASK-001 등)',
            '   - scope: 수정할 파일 경로 (충돌 방지)',
            '3. create_tasks_bulk로 일괄 생성',
            '4. get_agent_skill로 스킬 로드 → 에이전트 스폰',
            '5. claim → start_work → 작업 → add_activity → submit_for_review',
            '6. REVIEW 상태가 되면 PM에게 리뷰 요청',
            '7. ★PR을 머지한 직후 merge_and_close(task_id)로 마감 — 티켓 DONE 전이와 워크트리 정리를 한 번에 처리합니다.',
            '   머지만 하고 넘어가면 티켓이 REVIEW로 굳고 워크트리가 stale로 남아 나중에 "머지필요"로 오인됩니다.',
            '   후속(승인·시크릿·라이브검증)이 남은 티켓은 이 도구가 DONE 대신 REVIEW로 유지하고 사유를 남깁니다.',
          ].join('\n'),
        },
      }],
    }),
  );

  server.prompt(
    'agent_worker',
    '태스크를 claim하고 진행 상황을 기록하면서 코딩합니다.',
    () => ({
      messages: [{
        role: 'user' as const,
        content: {
          type: 'text' as const,
          text: [
            'Marblo MCP에서 태스크를 가져와 작업하면서 진행 상황을 기록합니다.',
            SECRET_OUTPUT_GUARDRAIL,
            '',
            '1. get_available_tasks로 처리 가능한 태스크 확인',
            '2. claim_next_task 또는 직접 update_task_status로 태스크 획득',
            '3. update_task_status로 IN_PROGRESS 변경',
            '4. get_agent_skill로 스킬 파일 로드, 규칙 따르기',
            '5. 작업 중 add_activity로 진행 기록:',
            '   - 파일 생성/수정 시',
            '   - 주요 결정 사항',
            '   - 테스트 결과',
            '6. check_feedback으로 PM 피드백 수시 확인',
            '7. submit_for_review로 리뷰 제출',
          ].join('\n'),
        },
      }],
    }),
  );

  server.prompt(
    'code_reviewer',
    '현재 프로젝트의 태스크 진행 상태를 확인하고 코드 리뷰를 진행합니다.',
    () => ({
      messages: [{
        role: 'user' as const,
        content: {
          type: 'text' as const,
          text: [
            'Marblo MCP에서 태스크 진행 상태를 확인하고 코드 리뷰를 진행합니다.',
            SECRET_OUTPUT_GUARDRAIL,
            '',
            '1. get_all_tasks로 전체 현황 조회',
            '2. 상태별 정리: TODO / IN_PROGRESS / REVIEW / DONE / FAILED',
            '3. REVIEW 태스크가 있으면 활동 로그 확인 후 코드 리뷰',
            '4. FAILED 태스크가 있으면 원인 분석',
            '5. check_feedback으로 미확인 PM 피드백 확인',
            '6. 진행률 요약: done/total (percent%)',
          ].join('\n'),
        },
      }],
    }),
  );

  server.prompt(
    'ralph_runner',
    'Ralph 패턴으로 반복 작업을 티켓 단위로 추적하며 일괄 처리합니다.',
    () => ({
      messages: [{
        role: 'user' as const,
        content: {
          type: 'text' as const,
          text: [
            'Ralph 패턴: 반복 작업을 Marblo 티켓으로 추적합니다.',
            SECRET_OUTPUT_GUARDRAIL,
            '',
            '1. 대상 파일/컴포넌트 분석 → 목록 생성',
            '2. create_tasks_bulk로 대상 1개당 티켓 1장 생성',
            '3. 순서대로 처리:',
            '   - claim → start_work → 작업 → add_activity',
            '   - 성공: submit_for_review → DONE',
            '   - 실패: FAILED + 원인 기록',
            '4. 완료 후 결과 요약: DONE N개, FAILED N개',
          ].join('\n'),
        },
      }],
    }),
  );
}
