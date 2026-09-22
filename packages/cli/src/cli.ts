import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { formatDocs, formatJson, formatReport } from './report.js';
import { scan } from './run.js';

const HELP = `nss — the namespaced-storage inventory

Usage
  nss scan [path]           what this codebase stores, and anything wrong with it
  nss docs [path]           the same inventory as markdown

Options
  -o, --out <file>          write to a file instead of stdout
      --json                machine-readable manifest (scan only)
      --ignore <name>       skip a directory or file name; repeatable
  -h, --help                show this
  -v, --version             show the version

Exit codes
  0  nothing to report
  1  duplicate namespaces, or a namespace that is not a string literal
  2  the command could not be understood

Run it in CI: a duplicate namespace across two packages is exactly what a
central registry file could never catch.`;

export interface CliIO {
  out: (text: string) => void;
  error: (text: string) => void;
  write?: (file: string, contents: string) => void;
}

const defaultWrite = (file: string, contents: string): void => {
  mkdirSync(dirname(resolve(file)), { recursive: true });
  writeFileSync(resolve(file), contents, 'utf8');
};

interface Parsed {
  command: string | undefined;
  path: string;
  out: string | undefined;
  json: boolean;
  ignore: string[];
  help: boolean;
  version: boolean;
  unknown: string | undefined;
}

function parse(argv: readonly string[]): Parsed {
  const parsed: Parsed = {
    command: undefined,
    path: '.',
    out: undefined,
    json: false,
    ignore: [],
    help: false,
    version: false,
    unknown: undefined,
  };
  let sawPath = false;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index] as string;

    if (argument === '--help' || argument === '-h') parsed.help = true;
    else if (argument === '--version' || argument === '-v') parsed.version = true;
    else if (argument === '--json') parsed.json = true;
    else if (argument === '--out' || argument === '-o') {
      index += 1;
      parsed.out = argv[index];
    } else if (argument.startsWith('--out=')) parsed.out = argument.slice('--out='.length);
    else if (argument === '--ignore') {
      index += 1;
      const value = argv[index];
      if (value !== undefined) parsed.ignore.push(value);
    } else if (argument.startsWith('--ignore=')) {
      parsed.ignore.push(argument.slice('--ignore='.length));
    } else if (argument.startsWith('-')) parsed.unknown = argument;
    else if (parsed.command === undefined) parsed.command = argument;
    else if (!sawPath) {
      parsed.path = argument;
      sawPath = true;
    }
  }

  return parsed;
}

/** The whole CLI as a function, so the tests never spawn a process. Returns the exit code. */
export function run(argv: readonly string[], io: CliIO, version = '0.1.0'): number {
  const parsed = parse(argv);

  if (parsed.unknown !== undefined) {
    io.error(`Unknown option "${parsed.unknown}".`);
    io.error(HELP);
    return 2;
  }
  if (parsed.version) {
    io.out(version);
    return 0;
  }
  if (parsed.help || parsed.command === undefined) {
    io.out(HELP);
    return parsed.command === undefined && !parsed.help ? 2 : 0;
  }
  if (parsed.command !== 'scan' && parsed.command !== 'docs') {
    io.error(`Unknown command "${parsed.command}".`);
    io.error(HELP);
    return 2;
  }

  const result = scan(parsed.path, { ignore: parsed.ignore });
  const output =
    parsed.command === 'docs'
      ? formatDocs(result)
      : parsed.json
        ? formatJson(result)
        : formatReport(result);

  if (parsed.out === undefined) io.out(output);
  else {
    (io.write ?? defaultWrite)(parsed.out, output.endsWith('\n') ? output : `${output}\n`);
    io.out(`Wrote ${result.declarations.length} namespaces to ${parsed.out}`);
  }

  // A duplicate namespace is a build failure, which is the whole point of running this in CI.
  return result.problems.length > 0 ? 1 : 0;
}

export { HELP };
