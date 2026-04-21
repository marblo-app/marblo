import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { authReady } from './firebase.js';
import { registerTools } from './tools.js';
import { registerPrompts } from './prompts.js';

const server = new McpServer({
  name: 'Marblo',
  version: '3.0.0',
});

registerTools(server);
registerPrompts(server);

async function main() {
  // Firebase 익명 인증이 완료될 때까지 대기 (Firestore 접근 전 필수)
  await authReady;

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Marblo MCP Server v3.0 started (stdio)');
}

main().catch((err) => {
  console.error('Failed to start MCP server:', err);
  process.exit(1);
});
