import { useCallback } from 'react';
import type { FlowNode, NodeType } from '../../types/flow';
import { useAgentStore } from '../../stores/agentStore';
import { useProjectStore } from '../../stores/projectStore';

interface NodeConfigPanelProps {
  node: FlowNode;
  onConfigChange: (nodeId: string, config: Record<string, unknown>) => void;
  onClose: () => void;
}

type ConfigUpdate = (key: string, value: unknown) => void;

interface InputNodeConfig {
  variableName?: string;
  inputType?: string;
  defaultValue?: string;
}

interface LLMNodeConfig {
  model?: string;
  prompt?: string;
  temperature?: number;
  maxTokens?: number;
}

interface AgentNodeConfig {
  connectionMode?: string;
  agentId?: string;
  agentName?: string;
  role?: string;
  model?: string;
  taskDescription?: string;
  timeout?: number;
}

interface APINodeConfig {
  method?: string;
  url?: string;
  headers?: { key: string; value: string }[];
  body?: string;
}

interface HumanNodeConfig {
  message?: string;
}

interface BranchNodeConfig {
  condition?: string;
}

interface OutputNodeConfig {
  format?: string;
  preview?: string;
}

interface CodeNodeConfig {
  language?: string;
  script?: string;
  cwd?: string;
  timeout?: number;
  envVars?: string;
}

interface IntegrationNodeConfig {
  service?: string;
  action?: string;
  channel?: string;
  chatId?: string;
  spreadsheetId?: string;
  repo?: string;
  webhookUrl?: string;
  to?: string;
  body?: string;
  apiToken?: string;
}

const TYPE_COLORS: Record<NodeType, { accent: string; label: string; icon: string }> = {
  input:       { accent: 'bg-green-500',   label: 'text-green-400',   icon: '📥' },
  llm:         { accent: 'bg-purple-500',  label: 'text-purple-400',  icon: '🧠' },
  agent:       { accent: 'bg-blue-500',    label: 'text-blue-400',    icon: '🤖' },
  code:        { accent: 'bg-emerald-500', label: 'text-emerald-400', icon: '💻' },
  api:         { accent: 'bg-orange-500',  label: 'text-orange-400',  icon: '🌐' },
  integration: { accent: 'bg-rose-500',    label: 'text-rose-400',    icon: '🔗' },
  human:       { accent: 'bg-yellow-500',  label: 'text-yellow-400',  icon: '👤' },
  branch:      { accent: 'bg-cyan-500',    label: 'text-cyan-400',    icon: '🔀' },
  output:      { accent: 'bg-pink-500',    label: 'text-pink-400',    icon: '📤' },
};

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <label className="block text-[11px] font-medium text-gray-400 mb-1">{children}</label>;
}

function TextInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full bg-gray-700 border border-gray-600 rounded px-2.5 py-1.5 text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-blue-500"
    />
  );
}

function NumberInput({
  value,
  onChange,
  min,
  max,
  step,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
}) {
  return (
    <input
      type="number"
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      min={min}
      max={max}
      step={step}
      className="w-full bg-gray-700 border border-gray-600 rounded px-2.5 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-blue-500"
    />
  );
}

function SelectInput({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full bg-gray-700 border border-gray-600 rounded px-2.5 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-blue-500"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

function TextArea({
  value,
  onChange,
  placeholder,
  rows = 3,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  rows?: number;
}) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      rows={rows}
      className="w-full bg-gray-700 border border-gray-600 rounded px-2.5 py-1.5 text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-blue-500 resize-none"
    />
  );
}

// --- Per-type config forms ---

function InputConfig({
  config,
  update,
}: {
  config: InputNodeConfig;
  update: ConfigUpdate;
}) {
  return (
    <>
      <div>
        <FieldLabel>Variable Name</FieldLabel>
        <TextInput
          value={config.variableName || ''}
          onChange={(v) => update('variableName', v)}
          placeholder="input"
        />
      </div>
      <div>
        <FieldLabel>Input Type</FieldLabel>
        <SelectInput
          value={config.inputType || 'text'}
          onChange={(v) => update('inputType', v)}
          options={[
            { value: 'text', label: 'Text' },
            { value: 'file', label: 'File' },
          ]}
        />
      </div>
      <div>
        <FieldLabel>Default Value</FieldLabel>
        <TextArea
          value={config.defaultValue || ''}
          onChange={(v) => update('defaultValue', v)}
          placeholder="Default input value..."
        />
      </div>
    </>
  );
}

const LLM_MODEL_OPTIONS = [
  { group: 'Anthropic', options: [
    { value: 'claude-opus-4-6', label: 'Claude Opus 4.6' },
    { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
    { value: 'claude-haiku-4-5', label: 'Claude Haiku 4.5' },
  ]},
  { group: 'OpenAI', options: [
    { value: 'gpt-4o', label: 'GPT-4o' },
    { value: 'gpt-4o-mini', label: 'GPT-4o Mini' },
    { value: 'o3', label: 'o3' },
    { value: 'o4-mini', label: 'o4-mini' },
  ]},
  { group: 'Google', options: [
    { value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
    { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
  ]},
];

function GroupedSelect({
  value,
  onChange,
  groups,
}: {
  value: string;
  onChange: (v: string) => void;
  groups: { group: string; options: { value: string; label: string }[] }[];
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full bg-gray-700 border border-gray-600 rounded px-2.5 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-blue-500"
    >
      {groups.map((g) => (
        <optgroup key={g.group} label={g.group}>
          {g.options.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

function LLMConfig({
  config,
  update,
}: {
  config: LLMNodeConfig;
  update: ConfigUpdate;
}) {
  const temperature = config.temperature ?? 0.7;
  return (
    <>
      <div>
        <FieldLabel>Model</FieldLabel>
        <GroupedSelect
          value={config.model || 'claude-opus-4-6'}
          onChange={(v) => update('model', v)}
          groups={LLM_MODEL_OPTIONS}
        />
      </div>
      <div>
        <FieldLabel>Prompt</FieldLabel>
        <TextArea
          value={config.prompt || ''}
          onChange={(v) => update('prompt', v)}
          placeholder="Enter your prompt..."
          rows={4}
        />
      </div>
      <div>
        <FieldLabel>Temperature: {temperature}</FieldLabel>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={temperature}
          onChange={(e) => update('temperature', Number(e.target.value))}
          className="w-full accent-purple-500"
        />
        <div className="flex justify-between text-[10px] text-gray-500 mt-0.5">
          <span>0 (Precise)</span>
          <span>1 (Creative)</span>
        </div>
      </div>
      <div>
        <FieldLabel>Max Tokens</FieldLabel>
        <NumberInput
          value={config.maxTokens || 4096}
          onChange={(v) => update('maxTokens', v)}
          min={1}
          max={200000}
          step={256}
        />
      </div>
    </>
  );
}

function AgentConfig({
  config,
  update,
}: {
  config: AgentNodeConfig;
  update: ConfigUpdate;
}) {
  const agents = useAgentStore((s) => s.agents);
  const currentProject = useProjectStore((s) => s.currentProject);
  const projectAgents = agents.filter((a) => !currentProject || a.projectId === currentProject.id);

  const connectionMode = config.connectionMode || 'auto';

  const agentOptions = [
    { value: '', label: '-- 선택 --' },
    ...projectAgents.map((a) => ({
      value: a.id,
      label: `${a.name} (${a.model} · ${a.role})`,
    })),
  ];

  return (
    <>
      <div>
        <FieldLabel>연결 모드</FieldLabel>
        <SelectInput
          value={connectionMode}
          onChange={(v) => update('connectionMode', v)}
          options={[
            { value: 'existing', label: '기존 세션 연결' },
            { value: 'auto', label: '자동 스폰 (새 에이전트)' },
          ]}
        />
        <p className="text-[10px] text-gray-500 mt-1">
          {connectionMode === 'existing'
            ? 'Agents 탭에서 실행 중인 세션에 연결합니다'
            : '플로우 실행 시 새 에이전트를 자동으로 스폰합니다'}
        </p>
      </div>

      {connectionMode === 'existing' ? (
        <div>
          <FieldLabel>에이전트 세션 선택</FieldLabel>
          <SelectInput
            value={config.agentId || ''}
            onChange={(v) => {
              update('agentId', v);
              if (v) {
                const agent = projectAgents.find((a) => a.id === v);
                if (agent) {
                  update('agentName', agent.name);
                  update('model', agent.model);
                  update('role', agent.role);
                }
              }
            }}
            options={agentOptions}
          />
          {projectAgents.length === 0 && (
            <p className="text-[10px] text-yellow-500 mt-1">
              실행 중인 에이전트가 없습니다. Agents 탭에서 먼저 스폰하세요.
            </p>
          )}
        </div>
      ) : (
        <>
          <div>
            <FieldLabel>에이전트 이름</FieldLabel>
            <TextInput
              value={config.agentName || ''}
              onChange={(v) => update('agentName', v)}
              placeholder="e.g. backend-api"
            />
          </div>
          <div>
            <FieldLabel>Role</FieldLabel>
            <SelectInput
              value={config.role || 'backend'}
              onChange={(v) => update('role', v)}
              options={[
                { value: 'backend', label: 'Backend' },
                { value: 'frontend', label: 'Frontend' },
                { value: 'test', label: 'Test' },
                { value: 'devops', label: 'DevOps' },
              ]}
            />
          </div>
          <div>
            <FieldLabel>Model</FieldLabel>
            <SelectInput
              value={config.model || 'claude'}
              onChange={(v) => update('model', v)}
              options={[
                { value: 'claude', label: 'Claude Code' },
                { value: 'gemini', label: 'Gemini CLI' },
                { value: 'gpt', label: 'GPT / Codex CLI' },
                { value: 'custom', label: 'Custom' },
              ]}
            />
          </div>
        </>
      )}
      <div>
        <FieldLabel>Task Description</FieldLabel>
        <TextArea
          value={config.taskDescription || ''}
          onChange={(v) => update('taskDescription', v)}
          placeholder="이 에이전트가 수행할 작업..."
          rows={4}
        />
      </div>
      <div>
        <FieldLabel>Timeout (minutes)</FieldLabel>
        <NumberInput
          value={config.timeout || 30}
          onChange={(v) => update('timeout', v)}
          min={1}
          max={1440}
        />
      </div>
    </>
  );
}

function APIConfig({
  config,
  update,
}: {
  config: APINodeConfig;
  update: ConfigUpdate;
}) {
  const method = config.method || 'GET';
  const headers: { key: string; value: string }[] = config.headers || [];
  const showBody = method === 'POST' || method === 'PUT';

  const addHeader = () => {
    update('headers', [...headers, { key: '', value: '' }]);
  };

  const removeHeader = (index: number) => {
    update(
      'headers',
      headers.filter((_, i) => i !== index),
    );
  };

  const updateHeader = (index: number, field: 'key' | 'value', val: string) => {
    const updated = headers.map((h, i) => (i === index ? { ...h, [field]: val } : h));
    update('headers', updated);
  };

  return (
    <>
      <div>
        <FieldLabel>HTTP Method</FieldLabel>
        <SelectInput
          value={method}
          onChange={(v) => update('method', v)}
          options={[
            { value: 'GET', label: 'GET' },
            { value: 'POST', label: 'POST' },
            { value: 'PUT', label: 'PUT' },
            { value: 'DELETE', label: 'DELETE' },
          ]}
        />
      </div>
      <div>
        <FieldLabel>URL</FieldLabel>
        <TextInput
          value={config.url || ''}
          onChange={(v) => update('url', v)}
          placeholder="https://api.example.com/..."
        />
      </div>
      <div>
        <div className="flex items-center justify-between mb-1">
          <FieldLabel>Headers</FieldLabel>
          <button
            onClick={addHeader}
            className="text-[10px] text-blue-400 hover:text-blue-300"
          >
            + Add
          </button>
        </div>
        <div className="space-y-1.5">
          {headers.map((h, i) => (
            <div key={i} className="flex items-center gap-1">
              <input
                type="text"
                value={h.key}
                onChange={(e) => updateHeader(i, 'key', e.target.value)}
                placeholder="Key"
                className="flex-1 bg-gray-700 border border-gray-600 rounded px-2 py-1 text-xs text-gray-200 placeholder-gray-500 focus:outline-none focus:border-blue-500"
              />
              <input
                type="text"
                value={h.value}
                onChange={(e) => updateHeader(i, 'value', e.target.value)}
                placeholder="Value"
                className="flex-1 bg-gray-700 border border-gray-600 rounded px-2 py-1 text-xs text-gray-200 placeholder-gray-500 focus:outline-none focus:border-blue-500"
              />
              <button
                onClick={() => removeHeader(i)}
                className="text-gray-500 hover:text-red-400 text-xs px-1"
              >
                &times;
              </button>
            </div>
          ))}
          {headers.length === 0 && (
            <p className="text-[11px] text-gray-500 italic">No headers</p>
          )}
        </div>
      </div>
      {showBody && (
        <div>
          <FieldLabel>Body</FieldLabel>
          <TextArea
            value={config.body || ''}
            onChange={(v) => update('body', v)}
            placeholder='{"key": "value"}'
            rows={4}
          />
        </div>
      )}
    </>
  );
}

function HumanConfig({
  config,
  update,
}: {
  config: HumanNodeConfig;
  update: ConfigUpdate;
}) {
  return (
    <div>
      <FieldLabel>Approval Message / Question</FieldLabel>
      <TextArea
        value={config.message || ''}
        onChange={(v) => update('message', v)}
        placeholder="Do you approve this result?"
        rows={3}
      />
    </div>
  );
}

function BranchConfig({
  config,
  update,
}: {
  config: BranchNodeConfig;
  update: ConfigUpdate;
}) {
  return (
    <div>
      <FieldLabel>Condition Expression</FieldLabel>
      <TextArea
        value={config.condition || ''}
        onChange={(v) => update('condition', v)}
        placeholder="result.status === 'success'"
        rows={3}
      />
      <p className="text-[10px] text-gray-500 mt-1">
        JavaScript expression. Outputs: true (left) / false (right)
      </p>
    </div>
  );
}

function OutputConfig({
  config,
  update,
}: {
  config: OutputNodeConfig;
  update: ConfigUpdate;
}) {
  return (
    <>
      <div>
        <FieldLabel>Output Format</FieldLabel>
        <SelectInput
          value={config.format || 'text'}
          onChange={(v) => update('format', v)}
          options={[
            { value: 'text', label: 'Text' },
            { value: 'json', label: 'JSON' },
            { value: 'file', label: 'File' },
          ]}
        />
      </div>
      <div>
        <FieldLabel>Result Preview</FieldLabel>
        <div className="w-full bg-gray-900 border border-gray-600 rounded px-2.5 py-1.5 text-sm text-gray-400 font-mono min-h-[60px] max-h-[120px] overflow-auto">
          {config.preview || 'No output yet'}
        </div>
      </div>
    </>
  );
}

function CodeConfig({
  config,
  update,
}: {
  config: CodeNodeConfig;
  update: ConfigUpdate;
}) {
  return (
    <>
      <div>
        <FieldLabel>Language</FieldLabel>
        <SelectInput
          value={config.language || 'python'}
          onChange={(v) => update('language', v)}
          options={[
            { value: 'python', label: 'Python' },
            { value: 'shell', label: 'Shell (Bash)' },
            { value: 'node', label: 'Node.js' },
            { value: 'typescript', label: 'TypeScript (tsx)' },
          ]}
        />
      </div>
      <div>
        <FieldLabel>Script</FieldLabel>
        <TextArea
          value={config.script || ''}
          onChange={(v) => update('script', v)}
          placeholder={config.language === 'shell' ? '#!/bin/bash\necho "hello"' : config.language === 'node' ? 'const result = await fetch(...)' : 'import pandas as pd\ndf = pd.read_csv("data.csv")'}
          rows={8}
        />
        <p className="text-[10px] text-gray-500 mt-1">
          직접 실행할 코드를 작성하세요. 이전 노드 결과는 <code className="text-emerald-400">input</code> 변수로 접근합니다.
        </p>
      </div>
      <div>
        <FieldLabel>Working Directory</FieldLabel>
        <TextInput
          value={config.cwd || ''}
          onChange={(v) => update('cwd', v)}
          placeholder="프로젝트 루트 (기본값)"
        />
      </div>
      <div>
        <FieldLabel>Timeout (seconds)</FieldLabel>
        <NumberInput
          value={config.timeout || 60}
          onChange={(v) => update('timeout', v)}
          min={1}
          max={3600}
        />
      </div>
      <div>
        <FieldLabel>Environment Variables</FieldLabel>
        <TextArea
          value={config.envVars || ''}
          onChange={(v) => update('envVars', v)}
          placeholder="KEY=value&#10;API_KEY=xxx"
          rows={3}
        />
      </div>
    </>
  );
}

const INTEGRATION_ACTIONS: Record<string, { value: string; label: string }[]> = {
  slack:    [{ value: 'send_message', label: '메시지 전송' }, { value: 'upload_file', label: '파일 업로드' }, { value: 'create_channel', label: '채널 생성' }],
  notion:   [{ value: 'create_page', label: '페이지 생성' }, { value: 'update_page', label: '페이지 수정' }, { value: 'query_database', label: 'DB 쿼리' }],
  telegram: [{ value: 'send_message', label: '메시지 전송' }, { value: 'send_photo', label: '이미지 전송' }],
  sheets:   [{ value: 'read_range', label: '범위 읽기' }, { value: 'write_range', label: '범위 쓰기' }, { value: 'append_row', label: '행 추가' }],
  github:   [{ value: 'create_issue', label: '이슈 생성' }, { value: 'create_pr', label: 'PR 생성' }, { value: 'add_comment', label: '코멘트 추가' }],
  discord:  [{ value: 'send_message', label: '메시지 전송' }, { value: 'create_thread', label: '스레드 생성' }],
  email:    [{ value: 'send_email', label: '이메일 전송' }],
  webhook:  [{ value: 'trigger', label: '웹훅 트리거' }],
};

function IntegrationConfig({
  config,
  update,
}: {
  config: IntegrationNodeConfig;
  update: ConfigUpdate;
}) {
  const service = config.service || 'slack';
  const actions = INTEGRATION_ACTIONS[service] || INTEGRATION_ACTIONS.webhook;

  return (
    <>
      <div>
        <FieldLabel>Service</FieldLabel>
        <SelectInput
          value={service}
          onChange={(v) => {
            update('service', v);
            update('action', '');
          }}
          options={[
            { value: 'slack', label: 'Slack' },
            { value: 'notion', label: 'Notion' },
            { value: 'telegram', label: 'Telegram' },
            { value: 'sheets', label: 'Google Sheets' },
            { value: 'github', label: 'GitHub' },
            { value: 'discord', label: 'Discord' },
            { value: 'email', label: 'Email' },
            { value: 'webhook', label: 'Webhook (Custom)' },
          ]}
        />
      </div>
      <div>
        <FieldLabel>Action</FieldLabel>
        <SelectInput
          value={config.action || actions[0]?.value || ''}
          onChange={(v) => update('action', v)}
          options={actions}
        />
      </div>
      {(service === 'slack' || service === 'discord') && (
        <div>
          <FieldLabel>Channel</FieldLabel>
          <TextInput
            value={config.channel || ''}
            onChange={(v) => update('channel', v)}
            placeholder="#general"
          />
        </div>
      )}
      {service === 'telegram' && (
        <div>
          <FieldLabel>Chat ID</FieldLabel>
          <TextInput
            value={config.chatId || ''}
            onChange={(v) => update('chatId', v)}
            placeholder="123456789"
          />
        </div>
      )}
      {service === 'sheets' && (
        <div>
          <FieldLabel>Spreadsheet ID</FieldLabel>
          <TextInput
            value={config.spreadsheetId || ''}
            onChange={(v) => update('spreadsheetId', v)}
            placeholder="1BxiMVs0XRA5..."
          />
        </div>
      )}
      {service === 'github' && (
        <div>
          <FieldLabel>Repository</FieldLabel>
          <TextInput
            value={config.repo || ''}
            onChange={(v) => update('repo', v)}
            placeholder="owner/repo"
          />
        </div>
      )}
      {service === 'webhook' && (
        <div>
          <FieldLabel>Webhook URL</FieldLabel>
          <TextInput
            value={config.webhookUrl || ''}
            onChange={(v) => update('webhookUrl', v)}
            placeholder="https://hooks.example.com/..."
          />
        </div>
      )}
      {service === 'email' && (
        <div>
          <FieldLabel>To</FieldLabel>
          <TextInput
            value={config.to || ''}
            onChange={(v) => update('to', v)}
            placeholder="user@example.com"
          />
        </div>
      )}
      <div>
        <FieldLabel>Message / Body</FieldLabel>
        <TextArea
          value={config.body || ''}
          onChange={(v) => update('body', v)}
          placeholder="전송할 내용..."
          rows={4}
        />
        <p className="text-[10px] text-gray-500 mt-1">
          이전 노드 결과를 <code className="text-rose-400">{'{{input}}'}</code>로 참조할 수 있습니다.
        </p>
      </div>
      <div>
        <FieldLabel>API Token / Key</FieldLabel>
        <TextInput
          value={config.apiToken || ''}
          onChange={(v) => update('apiToken', v)}
          placeholder="설정에서 환경변수로 관리 권장"
        />
        <p className="text-[10px] text-gray-500 mt-1">
          보안을 위해 Settings 탭의 환경변수를 사용하세요.
        </p>
      </div>
    </>
  );
}

function renderTypeConfig(
  type: NodeType,
  config: Record<string, unknown>,
  update: ConfigUpdate,
): JSX.Element | null {
  switch (type) {
    case 'input':
      return <InputConfig config={config as InputNodeConfig} update={update} />;
    case 'llm':
      return <LLMConfig config={config as LLMNodeConfig} update={update} />;
    case 'agent':
      return <AgentConfig config={config as AgentNodeConfig} update={update} />;
    case 'code':
      return <CodeConfig config={config as CodeNodeConfig} update={update} />;
    case 'api':
      return <APIConfig config={config as APINodeConfig} update={update} />;
    case 'integration':
      return (
        <IntegrationConfig config={config as IntegrationNodeConfig} update={update} />
      );
    case 'human':
      return <HumanConfig config={config as HumanNodeConfig} update={update} />;
    case 'branch':
      return <BranchConfig config={config as BranchNodeConfig} update={update} />;
    case 'output':
      return <OutputConfig config={config as OutputNodeConfig} update={update} />;
    default:
      return null;
  }
}

export function NodeConfigPanel({ node, onConfigChange, onClose }: NodeConfigPanelProps) {
  const config = node.data.config || {};
  const colors = TYPE_COLORS[node.type];

  const update = useCallback<ConfigUpdate>(
    (key, value) => {
      onConfigChange(node.id, { ...config, [key]: value });
    },
    [node.id, config, onConfigChange],
  );

  const updateLabel = useCallback(
    (label: string) => {
      // Label is stored in data.label, so pass it through config with a special key
      // Actually, we need to handle label separately. Let's pass it as part of config for now
      // and FlowCanvas will extract it.
      onConfigChange(node.id, { ...config, _label: label });
    },
    [node.id, config, onConfigChange],
  );

  return (
    <div className="w-72 flex-shrink-0 border-l border-gray-700 bg-gray-800/80 overflow-y-auto">
      {/* Header */}
      <div className="sticky top-0 bg-gray-800 z-10">
        <div className={`h-1 ${colors.accent}`} />
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700">
          <div className="flex items-center gap-2">
            <span className="text-base">{colors.icon}</span>
            <span className={`text-sm font-medium ${colors.label}`}>
              {node.data.label} Settings
            </span>
          </div>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-300 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* Form */}
      <div className="p-4 space-y-4">
        {/* Common label field */}
        <div>
          <FieldLabel>Node Label</FieldLabel>
          <TextInput
            value={node.data.label || ''}
            onChange={updateLabel}
            placeholder="Node name"
          />
        </div>

        {/* Separator */}
        <div className="border-t border-gray-700" />

        {/* Type-specific config */}
        {renderTypeConfig(node.type, config, update)}
      </div>
    </div>
  );
}
