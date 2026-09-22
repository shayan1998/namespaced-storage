export { scanSource, findDuplicates } from './scan.js';
export type { Declaration, DeclaredKey, Problem, ScanResult } from './scan.js';
export { findSourceFiles, readSource } from './walk.js';
export type { Sources, WalkOptions } from './walk.js';
export { scan } from './run.js';
export { formatReport, formatJson, formatDocs } from './report.js';
export { run } from './cli.js';
export type { CliIO } from './cli.js';
export type { Manifest } from './report.js';
