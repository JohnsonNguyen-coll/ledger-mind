import { randomUUID } from 'node:crypto';
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

/** Native Gemini generateContent API. The key stays in a header on Google's fixed host.
 * Preserve complete model parts (including opaque thought signatures) in memory.
 * Only public text and validated function calls reach the executor and audit log.
 */
export class GeminiProvider implements Provider {
  private history: unknown[];
  private consumed = 0;
  private ids = new Map<string, string | undefined>();
  constructor(
    private task: Task,
    private apiKey: string,
    private model: string,
    private fetcher: typeof fetch = fetch,
    private availableTools = tools,
  ) {
    this.history = [{ role: 'user', parts: [{ text: task.prompt }] }];
  }
  async next(observations: Observation[]): Promise<Decision> {
    const fresh = observations.slice(this.consumed);
    if (fresh.length)
      this.history.push({
        role: 'user',
        parts: fresh.map((o) => ({
          functionResponse: { name: o.call.name, id: this.ids.get(o.call.id), response: o.output },
        })),
      });
    this.consumed = observations.length;
    const response = await this.fetcher(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.model)}:generateContent`,
      {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(60_000),
        headers: { 'x-goog-api-key': this.apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: agentInstructions(this.task) }] },
          contents: this.history,
          // Forward argument schemas; keep no-argument diagnostics compatible.
          tools: [
            {
              functionDeclarations: this.availableTools.map((t) => ({
                name: t.name,
                description: t.description,
                ...(Object.keys(t.parameters.properties).length
                  ? { parametersJsonSchema: t.parameters }
                  : {}),
              })),
            },
          ],
          toolConfig: { functionCallingConfig: { mode: 'AUTO' } },
          generationConfig: { maxOutputTokens: 4096 },
        }),
      },
    );
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`GEMINI_HTTP_${response.status}`);
    }
    const value = z
      .object({
        candidates: z
          .array(
            z.object({
              finishReason: z.string(),
              content: z
                .object({
                  role: z.literal('model'),
                  parts: z
                    .array(
                      z
                        .object({
                          text: z.string().optional(),
                          thought: z.boolean().optional(),
                          functionCall: z
                            .object({
                              id: z.string().max(200).optional(),
                              name: z.string().min(1).max(100),
                              args: z.record(z.string(), z.unknown()).optional(),
                            })
                            .optional(),
                        })
                        .passthrough(),
                    )
                    .max(40),
                })
                .passthrough(),
            }),
          )
          .length(1),
        usageMetadata: z
          .object({
            promptTokenCount: z.number().optional(),
            candidatesTokenCount: z.number().optional(),
            thoughtsTokenCount: z.number().optional(),
          })
          .optional(),
      })
      .safeParse(await boundedJson(response));
    if (!value.success) throw new Error('GEMINI_INVALID_OR_BLOCKED_RESPONSE');
    const candidate = value.data.candidates[0]!;
    if (candidate.finishReason !== 'STOP') throw new Error('GEMINI_INCOMPLETE_RESPONSE');
    const calls = candidate.content.parts
      .filter((p) => p.functionCall)
      .map((p) => {
        const fc = p.functionCall!;
        const id = randomUUID(); // Internal identity also supports providers which omit call IDs.
        this.ids.set(id, fc.id);
        const args = JSON.stringify(fc.args ?? {});
        if (args.length > 4000) throw new Error('GEMINI_INVALID_TOOL_ARGUMENTS');
        return { id, name: fc.name, arguments: args };
      });
    if (calls.length > 16) throw new Error('TOOL_CALL_LIMIT');
    this.history.push(candidate.content);
    return {
      calls,
      text: candidate.content.parts
        .filter((p) => !p.thought && !p.functionCall)
        .map((p) => p.text ?? '')
        .join('\n'),
      usage: value.data.usageMetadata
        ? {
            input: value.data.usageMetadata.promptTokenCount ?? 0,
            output:
              (value.data.usageMetadata.candidatesTokenCount ?? 0) +
              (value.data.usageMetadata.thoughtsTokenCount ?? 0),
          }
        : undefined,
    };
  }
}
