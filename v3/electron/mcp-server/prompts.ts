import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

const SECRET_OUTPUT_GUARDRAIL =
  'Security: Do not cat, print, or log raw contents from `.env`, `.mcp.json`, firebase-config files, service account JSON, or OAuth/Toss/Paddle/API key files. When checking configuration, report only whether keys exist, file paths, or masked values.';

export function registerPrompts(server: McpServer): void {
  server.prompt(
    'team_leader',
    'Break the project into tasks using the Agent Teams workflow, spawn agents, and drive the work.',
    () => ({
      messages: [{
        role: 'user' as const,
        content: {
          type: 'text' as const,
          text: [
            'Use Marblo MCP to run the project with the Agent Teams workflow.',
            SECRET_OUTPUT_GUARDRAIL,
            '',
            '1. Ask the user for the project name and what they want to build.',
            '2. Analyze the requirements and break them into tasks:',
            '   - Each task should be sized for 1-2 hours of work.',
            '   - role: backend/frontend/test/devops',
            '   - Set dependencies with depends_on, such as TASK-001.',
            '   - scope: file paths to modify, to prevent conflicts.',
            '3. Create the batch with create_tasks_bulk.',
            '4. Load skills with get_agent_skill, then spawn agents.',
            '5. claim → start_work → work → add_activity → submit_for_review.',
            '6. When a task reaches REVIEW, ask the PM to review it.',
            '7. ★Immediately after merging a PR, close it with merge_and_close(task_id) — this moves the ticket to DONE and cleans up the worktree in one step.',
            '   If you only merge and move on, the ticket remains stuck in REVIEW and the worktree stays stale, so it can later be mistaken as still needing a merge.',
            '   If follow-up work remains, such as approval, secrets, or live verification, this tool keeps the ticket in REVIEW instead of DONE and records the reason.',
          ].join('\n'),
        },
      }],
    }),
  );

  server.prompt(
    'agent_worker',
    'Claim tasks, write code, and record progress as you work.',
    () => ({
      messages: [{
        role: 'user' as const,
        content: {
          type: 'text' as const,
          text: [
            'Fetch tasks from Marblo MCP, work on them, and record progress.',
            SECRET_OUTPUT_GUARDRAIL,
            '',
            '1. Check available work with get_available_tasks.',
            '2. Acquire a task with claim_next_task or by directly calling update_task_status.',
            '3. Change the task to IN_PROGRESS with update_task_status.',
            '4. Load the skill file with get_agent_skill and follow its rules.',
            '5. While working, record progress with add_activity:',
            '   - When creating or editing files.',
            '   - For major decisions.',
            '   - For test results.',
            '6. Check PM feedback frequently with check_feedback.',
            '7. Submit for review with submit_for_review.',
          ].join('\n'),
        },
      }],
    }),
  );

  server.prompt(
    'code_reviewer',
    'Check the current project task status and perform code review.',
    () => ({
      messages: [{
        role: 'user' as const,
        content: {
          type: 'text' as const,
          text: [
            'Use Marblo MCP to check task progress and perform code review.',
            SECRET_OUTPUT_GUARDRAIL,
            '',
            '1. Query the full status with get_all_tasks.',
            '2. Group by status: TODO / IN_PROGRESS / REVIEW / DONE / FAILED.',
            '3. If any task is in REVIEW, inspect its activity log and review the code.',
            '4. If any task is FAILED, analyze the cause.',
            '5. Check unread PM feedback with check_feedback.',
            '6. Summarize progress as done/total (percent%).',
          ].join('\n'),
        },
      }],
    }),
  );

  server.prompt(
    'ralph_runner',
    'Use the Ralph pattern to track repetitive work as tickets and process it in batches.',
    () => ({
      messages: [{
        role: 'user' as const,
        content: {
          type: 'text' as const,
          text: [
            'Ralph pattern: track repetitive work with Marblo tickets.',
            SECRET_OUTPUT_GUARDRAIL,
            '',
            '1. Analyze the target files/components and build a list.',
            '2. Use create_tasks_bulk to create one ticket per target.',
            '3. Process them in order:',
            '   - claim → start_work → work → add_activity.',
            '   - Success: submit_for_review → DONE.',
            '   - Failure: FAILED + record the cause.',
            '4. After completion, summarize the result: N DONE, N FAILED.',
          ].join('\n'),
        },
      }],
    }),
  );
}
