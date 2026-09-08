import { readFile, writeFile } from 'node:fs/promises';
import { parse } from 'dotenv';

// Only edit provider settings; retain wallet paths, budget limits and existing keys.
let content = await readFile('.env.live', 'utf8');
const existing = parse(content);
for (const [name, value] of Object.entries({
  AGENT_MODE: 'gemini',
  GEMINI_MODEL: existing.GEMINI_MODEL || 'gemini-2.5-flash',
  GEMINI_API_KEY: existing.GEMINI_API_KEY || '',
})) {
  const line = `${name}=${JSON.stringify(value)}`;
  const pattern = new RegExp(`^${name}=.*$`, 'gm');
  content = pattern.test(content)
    ? content.replace(pattern, () => line)
    : content.trimEnd() + '\n' + line + '\n';
}
await writeFile('.env.live', content, 'utf8');
console.log('Gemini configured. Paste your Google AI Studio key into GEMINI_API_KEY in .env.live.');
console.log('No model request or payment made.');
