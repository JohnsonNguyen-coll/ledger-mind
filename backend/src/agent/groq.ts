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

/** Groq Chat Completions API with native tool calling on Groq LPU.
 * Key is only sent to https://api.groq.com.
 * Only validated tool calls and final text reach the executor and audit trail.
 */
export class GroqProvider implements Provider {
  private history: unknown[];
  private consumed = 0;

  constructor(
    private task: Task,
    private apiKey: string,
    private model: string = 'llama-3.3-70b-versatile',
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
    for (const o of observations.slice(this.consumed)) {
      this.history.push({
        role: 'tool',
        tool_call_id: o.call.id,
        content: JSON.stringify(o.output),
      });
    }
    this.consumed = observations.length;

    const response = await this.fetcher('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(60_000),
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        messages: this.history,
        stream: false,
        max_tokens: 1800,
        tool_choice: 'auto',
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
      if (/rate limit|quota/i.test(message)) throw new Error('GROQ_RATE_LIMITED');
      throw new Error(`GROQ_HTTP_${response.status}`);
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
    if (!['stop', 'tool_calls'].includes(choice.finish_reason ?? '')) {
      throw new Error('GROQ_INCOMPLETE_RESPONSE');
    }

    const calls = (choice.message.tool_calls ?? []).map((c) => ({
      id: c.id,
      name: c.function.name,
      arguments: c.function.arguments,
    }));

    if (choice.finish_reason === 'tool_calls' && !calls.length) {
      throw new Error('GROQ_EMPTY_TOOL_CALLS');
    }
    if (new Set(calls.map((c) => c.id)).size !== calls.length) {
      throw new Error('GROQ_DUPLICATE_TOOL_IDS');
    }

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
