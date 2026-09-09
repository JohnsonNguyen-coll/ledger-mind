import { randomUUID } from 'node:crypto';
import type { Config } from '../config.js';
import type { Task } from '../types.js';
import { GroqProvider } from './groq.js';
import type { Observation } from './provider.js';

/** Two small model requests check the full tool-call/result cycle on Groq, not just key validity.
 * No executor, wallet, merchant, audit contents, or user task data is involved.
 */
export async function checkModel(config: Config, fetcher: typeof fetch = fetch) {
  if (config.agentMode === 'demo') {
    return { message: 'Local demo planner is ready. No API key required.' };
  }
  const key = config.groqKey;
  if (!key) throw new Error('GROQ_API_KEY_REQUIRED');

  const task: Task = {
    id: randomUUID(),
    requestKey: randomUUID(),
    symbol: 'ETH',
    budget: 0,
    prompt:
      'Connectivity test: call diagnostic_echo with no arguments exactly once. After receiving its result, reply with READY. No research is needed.',
    status: 'running',
    createdAt: new Date().toISOString(),
    result: null,
    error: null,
  };
  const tools = [
    {
      type: 'function',
      name: 'diagnostic_echo',
      description: 'Required connectivity diagnostic. Call once, then report its result.',
      strict: true,
      parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
    },
  ];

  const provider = new GroqProvider(task, key, config.model, fetcher, tools);
  const first = await provider.next([]);
  if (
    first.calls.length !== 1 ||
    first.calls[0]!.name !== 'diagnostic_echo' ||
    JSON.stringify(JSON.parse(first.calls[0]!.arguments)) !== '{}'
  ) {
    throw new Error('MODEL_TOOL_CHECK_FAILED');
  }
  const observations: Observation[] = [{ call: first.calls[0]!, output: { status: 'READY' } }];
  const last = await provider.next(observations);
  if (last.calls.length || !last.text?.includes('READY')) {
    throw new Error('MODEL_TOOL_CHECK_FAILED');
  }
  return {
    message: `${config.model} passed diagnostic tool-calling and response synthesis tests.`,
  };
}
