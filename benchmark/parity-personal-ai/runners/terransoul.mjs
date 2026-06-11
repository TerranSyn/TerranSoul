/**
 * TerranSoul Runner — executes prompts via MCP brain tools.
 *
 * Connects to TerranSoul MCP on :7421 (release) / :7423 (tray) / :7422 (dev)
 * and runs each prompt through the appropriate brain tool.
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const MCP_PORTS = [7421, 7423, 7422];
const DEFAULT_TIMEOUT = 120_000;

/**
 * Find a healthy MCP endpoint.
 * @returns {{ port: number, baseUrl: string }} 
 */
async function findMcpEndpoint() {
  for (const port of MCP_PORTS) {
    const url = `http://127.0.0.1:${port}/health`;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
      if (res.ok) {
        return { port, baseUrl: `http://127.0.0.1:${port}` };
      }
    } catch { /* try next */ }
  }
  throw new Error('No healthy TerranSoul MCP server found on ports ' + MCP_PORTS.join(', '));
}

/**
 * Read the bearer token for MCP auth.
 */
function readToken() {
  const repoRoot = resolve(__dirname, '../../..');
  const tokenPaths = [
    resolve(repoRoot, 'mcp-data/mcp-token.txt'),
    resolve(repoRoot, 'mcp-data/auth-token'),
    resolve(repoRoot, 'mcp-data/tray-token'),
  ];
  for (const tp of tokenPaths) {
    try {
      return readFileSync(tp, 'utf8').trim();
    } catch { /* try next */ }
  }
  return null;
}

/**
 * Call an MCP tool via HTTP.
 */
async function callMcpTool(baseUrl, token, toolName, args) {
  const start = performance.now();
  const res = await fetch(`${baseUrl}/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'tools/call',
      params: { name: toolName, arguments: args },
    }),
    signal: AbortSignal.timeout(DEFAULT_TIMEOUT),
  });
  const elapsed = (performance.now() - start) / 1000;
  const body = await res.json();
  
  if (body.error) {
    return { success: false, error: body.error, latency: elapsed };
  }
  
  const content = body.result?.content?.[0]?.text ?? JSON.stringify(body.result);
  return { success: true, content, latency: elapsed };
}

/**
 * Map archetype + prompt to the correct MCP tool call.
 */
function mapToMcpCall(archetype, prompt) {
  switch (archetype) {
    case 'daily-digest':
      return { tool: 'brain_search', args: { query: prompt.input, top_k: 10 } };
    case 'deep-research':
      return { tool: 'brain_search', args: { query: prompt.input, top_k: 20 } };
    case 'code-assistant':
      return { tool: 'code_query', args: { query: prompt.input } };
    case 'scheduled-monitor':
      return { tool: 'brain_search', args: { query: prompt.input, top_k: 5 } };
    case 'chat-simple':
      return { tool: 'brain_search', args: { query: prompt.input, top_k: 8 } };
    case 'voice-companion':
      return { tool: 'brain_search', args: { query: prompt.input, top_k: 5 } };
    case 'vrm-overlay':
      return { tool: 'brain_search', args: { query: prompt.input, top_k: 3 } };
    default:
      return { tool: 'brain_search', args: { query: prompt.input, top_k: 10 } };
  }
}

/**
 * Warmup: trigger model load before timed runs.
 */
export async function warmup() {
  const { baseUrl } = await findMcpEndpoint();
  const token = readToken();
  await callMcpTool(baseUrl, token, 'brain_search', { query: 'warmup', top_k: 1 });
}

/**
 * Run all prompts from a fixture file through TerranSoul MCP.
 * @param {string} fixturePath - path to the fixture JSON
 * @returns {Promise<Array<{id, archetype, latency, content, success}>>}
 */
export async function runFixture(fixturePath) {
  const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));
  const { baseUrl } = await findMcpEndpoint();
  const token = readToken();
  const results = [];

  for (const prompt of fixture.prompts) {
    const { tool, args } = mapToMcpCall(fixture.archetype, prompt);
    const result = await callMcpTool(baseUrl, token, tool, args);
    results.push({
      id: prompt.id,
      archetype: fixture.archetype,
      latency: result.latency,
      content: result.content ?? result.error,
      success: result.success,
      tool,
    });
  }

  return results;
}

/**
 * Run all 7 fixtures.
 * @returns {Promise<Map<string, Array>>}
 */
export async function runAll() {
  const fixturesDir = resolve(__dirname, '../fixtures');
  const archetypes = [
    'daily-digest', 'deep-research', 'code-assistant',
    'scheduled-monitor', 'chat-simple', 'voice-companion', 'vrm-overlay',
  ];

  // Warmup: trigger model load before timed runs
  const { baseUrl } = await findMcpEndpoint();
  const token = readToken();
  await callMcpTool(baseUrl, token, 'brain_search', { query: 'warmup', top_k: 1 });

  const allResults = new Map();

  for (const arch of archetypes) {
    const fp = resolve(fixturesDir, `${arch}.json`);
    const results = await runFixture(fp);
    allResults.set(arch, results);
  }

  return allResults;
}
