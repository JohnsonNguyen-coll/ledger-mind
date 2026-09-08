import { z } from 'zod';
import type { Task } from '../types.js';
import { boundedJson } from '../payments/gateway.js';
import {
  tools,
  agentInstructions,
  type Provider,
  type Observation,
  type Decision,
} from './provider.js';

/** OpenRouter dùng Chat Completions: assistant.tool_calls và role:tool.
 * Key chỉ gửi tới hostname cố định này. Không fallback sang OpenAI trực tiếp.
 * Giữ reasoning_details trong memory để tiếp tục tool loop, không đưa vào UI.
 */
export class OpenRouterProvider implements Provider {
  private history: unknown[];
  private consumed = 0;
  constructor(
    task: Task,
    private apiKey: string,
    private model: string,
    private fetcher: typeof fetch = fetch,
    private availableTools = tools,
  ) {
    this.history = [
      {
        role: 'system',
        content: agentInstructions(task),
      },
      { role: 'user', content: task.prompt },
    ];
  }
  async next(observations: Observation[]): Promise<Decision> {
    for (const o of observations.slice(this.consumed))
      this.history.push({
        role: 'tool',
        tool_call_id: o.call.id,
        content: JSON.stringify(o.output),
      });
    this.consumed = observations.length;
    const response = await this.fetcher('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(60_000),
      headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        messages: this.history,
        stream: false,
        max_tokens: 1800,
        tool_choice: 'auto',
        // Executor validates arguments and serializes payments; optional strict/parallel
        // routing flags can unnecessarily exclude free tool-capable endpoints.
        tools: this.availableTools.map(({ type, strict, ...fn }) => ({ type, function: fn })),
      }),
    });
    if (!response.ok) {
      let message = '';
      try {
        const body = (await boundedJson(response)) as { error?: { message?: unknown } };
        message = String(body.error?.message ?? '');
      } catch {
        /* Raw error bodies are never exposed. */
      }
      if (/data policy|privacy|publication/i.test(message))
        throw new Error('OPENROUTER_DATA_POLICY');
      if (response.status === 404 && /endpoints/i.test(message))
        throw new Error('OPENROUTER_NO_ENDPOINTS');
      throw new Error(`OPENROUTER_HTTP_${response.status}`);
    }
    const value = z
      .object({
        choices: z
          .array(
            z.object({
              finish_reason: z.string().nullable(),
              message: z.object({
                role: z.literal('assistant'),
                content: z.string().nullable().optional(),
                reasoning_details: z.array(z.unknown()).optional(),
                tool_calls: z
                  .array(
                    z.object({
                      id: z.string().min(1).max(200),
                      type: z.literal('function'),
                      function: z.object({
                        name: z.string().min(1).max(100),
                        arguments: z.string().max(4000),
                      }),
                    }),
                  )
                  .max(16)
                  .optional(),
              }),
            }),
          )
          .min(1)
          .max(1),
        usage: z.object({ prompt_tokens: z.number(), completion_tokens: z.number() }).optional(),
      })
      .parse(await boundedJson(response));
    const choice = value.choices[0]!;
    if (!['stop', 'tool_calls'].includes(choice.finish_reason ?? ''))
      throw new Error('OPENROUTER_INCOMPLETE_RESPONSE');
    const calls = (choice.message.tool_calls ?? []).map((c) => ({
      id: c.id,
      name: c.function.name,
      arguments: c.function.arguments,
    }));
    if (choice.finish_reason === 'tool_calls' && !calls.length)
      throw new Error('OPENROUTER_EMPTY_TOOL_CALLS');
    if (new Set(calls.map((c) => c.id)).size !== calls.length)
      throw new Error('OPENROUTER_DUPLICATE_TOOL_IDS');
    this.history.push(choice.message);
    return {
      calls,
      text: choice.message.content ?? '',
      usage: value.usage
        ? {
            input: value.usage.prompt_tokens,
            output: value.usage.completion_tokens,
          }
        : undefined,
    };
  }
}
