import { readConfig } from '../src/config.js';
import { checkModel } from '../src/agent/check-model.js';
import { errorCode } from '../src/agent/runner.js';
try {
  console.log((await checkModel(readConfig(false))).message);
} catch (e) {
  console.error(errorCode(e));
  console.error('See documentation for Groq API setup.');
  process.exitCode = 1;
}
