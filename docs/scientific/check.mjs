import { check, browserCheck } from './check-bilingual.mjs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
export { check, browserCheck };
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await check();
  if (process.argv.includes('--browser')) await browserCheck();
}
