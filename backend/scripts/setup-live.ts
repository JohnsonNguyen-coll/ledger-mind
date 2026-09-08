import 'dotenv/config';
import { readFile, writeFile, access } from 'node:fs/promises';
import { resolve } from 'node:path';

// Tạo file mới, không ghi đè key hoặc cấu hình user đã nhập.
const file = resolve('.env.live');
try {
  const cli =
    process.env.BAW_CLI_JS ||
    resolve('wallet-tools/node_modules/@binance/agentic-wallet/dist/index.js');
  await access(cli);
  const template = await readFile('.env.live.example', 'utf8');
  await writeFile(
    file,
    template.replace(/^BAW_CLI_JS=.*$/m, `BAW_CLI_JS=${JSON.stringify(cli.replaceAll('\\', '/'))}`),
    { flag: 'wx' },
  );
  console.log('Da tao: ' + file);
  console.log('Nhap OPENROUTER_API_KEY trong file nay. Khong gui key vao chat.');
} catch (error) {
  if ((error as NodeJS.ErrnoException).code === 'EEXIST')
    console.log('.env.live da co; giu nguyen cau hinh.');
  else {
    console.error('Khong tao duoc .env.live. Kiem tra BAW_CLI_JS va file .env.live.example.');
    process.exitCode = 1;
  }
}
