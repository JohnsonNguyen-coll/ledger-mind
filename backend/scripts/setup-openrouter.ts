import { readFile, writeFile } from 'node:fs/promises';
import { parse } from 'dotenv';

// Chuyển cấu hình tại máy. Không hiển thị key và không gửi nó ra mạng.
const path = '.env.live';
let content = await readFile(path, 'utf8');
const current = parse(content);
function set(name: string, value: string) {
  const line = `${name}=${JSON.stringify(value)}`;
  const pattern = new RegExp(`^${name}=.*$`, 'gm');
  content = pattern.test(content)
    ? content.replace(pattern, () => line)
    : content.trimEnd() + '\n' + line + '\n';
}
set('AGENT_MODE', 'openrouter');
set('OPENROUTER_MODEL', 'openrouter/free');
const mistaken = current.OPENAI_API_KEY?.startsWith('sk-or-') ? current.OPENAI_API_KEY : '';
set('OPENROUTER_API_KEY', current.OPENROUTER_API_KEY || mistaken);
if (mistaken) set('OPENAI_API_KEY', '');
await writeFile(path, content, 'utf8');
console.log(
  'Da chuyen .env.live sang OpenRouter Free. Nhap key vao OPENROUTER_API_KEY neu chua co.',
);
console.log('Khong goi model hay thanh toan.');
