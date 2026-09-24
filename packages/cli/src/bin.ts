import { run } from './cli.js';

process.exitCode = run(process.argv.slice(2), {
  out: (text) => process.stdout.write(`${text}\n`),
  error: (text) => process.stderr.write(`${text}\n`),
});
