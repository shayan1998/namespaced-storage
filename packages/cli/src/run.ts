import {
  type Declaration,
  type Problem,
  type ScanResult,
  findDuplicates,
  scanSource,
} from './scan.js';
import { findSourceFiles, readSource } from './walk.js';

export interface ScanOptions {
  ignore?: readonly string[];
}

/** Walks a directory (or reads one file) and returns everything the inventory needs. */
export function scan(root: string, options: ScanOptions = {}): ScanResult {
  const { base, files } = findSourceFiles(
    root,
    options.ignore === undefined ? {} : { ignore: options.ignore },
  );
  const declarations: Declaration[] = [];
  const problems: Problem[] = [];

  for (const file of files) {
    let source: string;
    try {
      source = readSource(base, file);
    } catch {
      continue;
    }
    // Cheap pre-filter: a file that never names the package cannot declare a namespace, and
    // parsing every file in a large repository is the only part of this that is not instant.
    if (!source.includes('namespaced-storage')) continue;

    const result = scanSource(file, source);
    declarations.push(...result.declarations);
    problems.push(...result.problems);
  }

  declarations.sort(
    (a, b) => a.namespace.localeCompare(b.namespace) || a.backend.localeCompare(b.backend),
  );

  return {
    declarations,
    problems: [...findDuplicates(declarations), ...problems],
    filesScanned: files.length,
  };
}
