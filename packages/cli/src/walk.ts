import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join, relative, sep } from 'node:path';

const EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'];

/** Directories never worth walking. Cheaper and more predictable than reading .gitignore. */
const SKIP = new Set([
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.git',
  '.next',
  '.turbo',
  'out',
]);

export interface WalkOptions {
  /** Extra directory or file names to skip, matched against each path segment. */
  ignore?: readonly string[];
}

export interface Sources {
  /** The directory the paths are relative to — `root` itself, or its parent when it is a file. */
  base: string;
  files: string[];
}

/**
 * Every source file under `root`, in a stable order. A single file is a legal root: pointing the
 * inventory at one `*.storage.ts` is how you check one feature without scanning a monorepo.
 */
export function findSourceFiles(root: string, options: WalkOptions = {}): Sources {
  const ignore = new Set([...SKIP, ...(options.ignore ?? [])]);
  const found: string[] = [];

  const walk = (directory: string): void => {
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      // A directory that vanished or cannot be read is not worth failing an inventory over.
      return;
    }

    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (ignore.has(entry.name)) continue;
      const full = join(directory, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (EXTENSIONS.some((extension) => entry.name.endsWith(extension))) found.push(full);
    }
  };

  const stats = statSync(root, { throwIfNoEntry: false });
  if (stats === undefined) return { base: root, files: [] };
  if (stats.isFile()) return { base: dirname(root), files: [basename(root)] };

  walk(root);
  return { base: root, files: found.map((file) => relative(root, file).split(sep).join('/')) };
}

export function readSource(root: string, file: string): string {
  return readFileSync(join(root, file), 'utf8');
}
