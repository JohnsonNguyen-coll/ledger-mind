import 'dotenv/config';
import { readFile, writeFile, access } from 'node:fs/promises';
import { resolve } from 'node:path';

// Create new file without overwriting existing keys or user configuration.
const file = resolve('.env');
try {
  const cli =
    process.env.BAW_CLI_JS ||
    resolve('wallet-tools/node_modules/@binance/agentic-wallet/dist/index.js');
  await access(cli);
  const template = await readFile('.env.example', 'utf8');
  await writeFile(
    file,
    template.replace(/^# BAW_CLI_JS=.*$/m, `BAW_CLI_JS=${JSON.stringify(cli.replaceAll('\\', '/'))}`),
    { flag: 'wx' },
  );
  console.log('Created: ' + file);
  console.log('Set your API keys in this file. Never send private keys to chat.');
} catch (error) {
  if ((error as NodeJS.ErrnoException).code === 'EEXIST')
    console.log('.env already exists; configuration preserved.');
  else {
    console.error('Failed to create .env. Check BAW_CLI_JS path and .env.example file.');
    process.exitCode = 1;
  }
}
