import ts from 'typescript';

/** Both entry points declare namespaces; a store from `/minimal` is still a store. */
const PACKAGES = ['namespaced-storage', 'namespaced-storage/minimal'];

const FACTORY_BACKENDS: Record<string, Declaration['backend']> = {
  createLocalStorage: 'local',
  createSessionStorage: 'session',
  createMemoryStorage: 'memory',
};

export interface DeclaredKey {
  name: string;
  /** Best-effort type, read from the default's syntax or the `t.*` builder. */
  type: string;
  /** Where the key was declared: a default value, a schema entry, or both. */
  source: 'defaults' | 'schema' | 'both';
}

export interface Declaration {
  namespace: string;
  backend: 'local' | 'session' | 'memory';
  owner: string | undefined;
  description: string | undefined;
  keys: DeclaredKey[];
  /** Namespace-wide TTL in ms, when one is declared as a literal. */
  ttl: number | undefined;
  version: number | undefined;
  file: string;
  line: number;
  column: number;
}

export interface Problem {
  kind: 'duplicate' | 'dynamic-namespace';
  namespace: string | undefined;
  backend: Declaration['backend'] | undefined;
  /** `file:line:column` for every site involved. */
  sites: string[];
}

export interface ScanResult {
  declarations: Declaration[];
  problems: Problem[];
  /** Files that were parsed, whether or not they declared anything. */
  filesScanned: number;
}

/**
 * Reads declarations out of one file's source. Syntax only — no type checker, no `tsconfig`, no
 * module resolution: the inventory has to work on a single file, in a repository that does not
 * compile, in under a second across a monorepo (ADR-026).
 */
export function scanSource(
  file: string,
  source: string,
): { declarations: Declaration[]; problems: Problem[] } {
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const declarations: Declaration[] = [];
  const problems: Problem[] = [];

  /** local name → factory name, and the locals bound by `import * as nss`. */
  const named = new Map<string, string>();
  const namespaces = new Set<string>();

  const positionOf = (node: ts.Node): { line: number; column: number } => {
    const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
    return { line: line + 1, column: character + 1 };
  };

  const collectImports = (node: ts.ImportDeclaration): void => {
    if (!ts.isStringLiteral(node.moduleSpecifier)) return;
    if (!PACKAGES.includes(node.moduleSpecifier.text)) return;
    const bindings = node.importClause?.namedBindings;
    if (bindings === undefined) return;

    if (ts.isNamespaceImport(bindings)) {
      namespaces.add(bindings.name.text);
      return;
    }
    for (const element of bindings.elements) {
      const imported = (element.propertyName ?? element.name).text;
      if (imported in FACTORY_BACKENDS) named.set(element.name.text, imported);
    }
  };

  /** The factory a call resolves to, or undefined when it is not one of ours. */
  const factoryOf = (call: ts.CallExpression): string | undefined => {
    if (ts.isIdentifier(call.expression)) return named.get(call.expression.text);
    if (
      ts.isPropertyAccessExpression(call.expression) &&
      ts.isIdentifier(call.expression.expression) &&
      namespaces.has(call.expression.expression.text) &&
      call.expression.name.text in FACTORY_BACKENDS
    ) {
      return call.expression.name.text;
    }
    return undefined;
  };

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) collectImports(node);

    if (ts.isCallExpression(node)) {
      const factory = factoryOf(node);
      if (factory !== undefined) {
        const declaration = read(node, factory, file, positionOf(node));
        if (declaration === undefined) {
          const at = positionOf(node);
          problems.push({
            kind: 'dynamic-namespace',
            namespace: undefined,
            backend: FACTORY_BACKENDS[factory],
            sites: [`${file}:${at.line}:${at.column}`],
          });
        } else {
          declarations.push(declaration);
        }
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return { declarations, problems };
}

function read(
  call: ts.CallExpression,
  factory: string,
  file: string,
  at: { line: number; column: number },
): Declaration | undefined {
  const namespace = staticString(call.arguments[0]);
  // A computed namespace is invisible to every tool that reads source rather than running it.
  if (namespace === undefined) return undefined;

  const options = call.arguments[1];
  const properties =
    options !== undefined && ts.isObjectLiteralExpression(options) ? options.properties : [];

  const find = (name: string): ts.Expression | undefined => {
    for (const property of properties) {
      if (ts.isPropertyAssignment(property) && propertyName(property.name) === name) {
        return property.initializer;
      }
    }
    return undefined;
  };

  return {
    namespace,
    backend: FACTORY_BACKENDS[factory] ?? 'local',
    owner: staticString(find('owner')),
    description: staticString(find('description')),
    keys: readKeys(find('defaults'), find('schema')),
    ttl: staticNumber(find('ttl')),
    version: staticNumber(find('version')),
    file,
    line: at.line,
    column: at.column,
  };
}

/** Keys come from `defaults`, from `schema`, or from both; the type comes from whichever says more. */
function readKeys(
  defaults: ts.Expression | undefined,
  schema: ts.Expression | undefined,
): DeclaredKey[] {
  const byName = new Map<string, DeclaredKey>();

  for (const [expression, source] of [
    [defaults, 'defaults'],
    [schema, 'schema'],
  ] as const) {
    if (expression === undefined || !ts.isObjectLiteralExpression(expression)) continue;

    for (const property of expression.properties) {
      if (!ts.isPropertyAssignment(property)) continue;
      const name = propertyName(property.name);
      if (name === undefined) continue;

      const type =
        source === 'defaults'
          ? typeOfValue(property.initializer)
          : typeOfSchema(property.initializer);
      const existing = byName.get(name);

      byName.set(name, {
        name,
        // A schema knows more than a default does — `t.enum(['light','dark'])` beats `string`.
        type: existing === undefined || source === 'schema' ? type : existing.type,
        source: existing === undefined ? source : 'both',
      });
    }
  }

  return [...byName.values()];
}

function propertyName(name: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name)) return name.text;
  if (ts.isComputedPropertyName(name)) return staticString(name.expression);
  return undefined;
}

export function staticString(node: ts.Expression | undefined): string | undefined {
  if (node === undefined) return undefined;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  return undefined;
}

function staticNumber(node: ts.Expression | undefined): number | undefined {
  if (node === undefined) return undefined;
  if (ts.isNumericLiteral(node)) return Number(node.text);
  // `15 * 60_000` reads better than 900000 and is the form the README teaches.
  if (ts.isBinaryExpression(node)) {
    const left = staticNumber(node.left);
    const right = staticNumber(node.right);
    if (left === undefined || right === undefined) return undefined;
    switch (node.operatorToken.kind) {
      case ts.SyntaxKind.AsteriskToken:
        return left * right;
      case ts.SyntaxKind.PlusToken:
        return left + right;
      default:
        return undefined;
    }
  }
  if (ts.isParenthesizedExpression(node)) return staticNumber(node.expression);
  return undefined;
}

/** The type a default value implies, in the words a reader of the inventory would use. */
function typeOfValue(node: ts.Expression): string {
  if (ts.isAsExpression(node)) return node.type.getText();
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return 'string';
  if (ts.isNumericLiteral(node)) return 'number';
  if (ts.isBigIntLiteral(node)) return 'bigint';
  if (node.kind === ts.SyntaxKind.TrueKeyword || node.kind === ts.SyntaxKind.FalseKeyword) {
    return 'boolean';
  }
  if (node.kind === ts.SyntaxKind.NullKeyword) return 'null';
  if (ts.isArrayLiteralExpression(node)) return 'array';
  if (ts.isObjectLiteralExpression(node)) return 'object';
  if (ts.isNewExpression(node) && ts.isIdentifier(node.expression)) return node.expression.text;
  return 'unknown';
}

/** `t.array(t.string())` → `string[]`, `t.enum(['light','dark'])` → `'light' | 'dark'`. */
function typeOfSchema(node: ts.Expression): string {
  if (!ts.isCallExpression(node)) return 'unknown';

  const path: string[] = [];
  let current: ts.Expression = node;
  while (ts.isCallExpression(current) && ts.isPropertyAccessExpression(current.expression)) {
    path.unshift(current.expression.name.text);
    current = current.expression.expression;
  }

  const [builder, ...modifiers] = path;
  if (builder === undefined) return 'unknown';

  const inner = innerOf(node);
  let type: string;
  switch (builder) {
    case 'array':
      type = inner === undefined ? 'unknown[]' : `${inner}[]`;
      break;
    case 'record':
      type = inner === undefined ? 'record' : `Record<string, ${inner}>`;
      break;
    case 'date':
      type = 'Date';
      break;
    case 'enum':
    case 'union':
    case 'literal':
      type = enumOf(node) ?? builder;
      break;
    default:
      type = builder;
  }

  if (modifiers.includes('optional')) type += ' | undefined';
  if (modifiers.includes('nullable')) type += ' | null';
  return type;
}

/** The argument of the innermost builder call, e.g. the `t.string()` inside `t.array(...)`. */
function innerOf(node: ts.CallExpression): string | undefined {
  let call: ts.Expression = node;
  while (ts.isCallExpression(call) && ts.isPropertyAccessExpression(call.expression)) {
    const first = call.arguments[0];
    if (first !== undefined && ts.isCallExpression(first)) return typeOfSchema(first);
    call = call.expression.expression;
  }
  return undefined;
}

/** `t.enum(['light', 'dark'])` read back as `'light' | 'dark'`. */
function enumOf(node: ts.CallExpression): string | undefined {
  const first = node.arguments[0];
  if (first === undefined) return undefined;

  if (ts.isArrayLiteralExpression(first)) {
    const members = first.elements.map((element) => {
      const value = staticString(element);
      return value === undefined ? element.getText() : `'${value}'`;
    });
    return members.length > 0 ? members.join(' | ') : undefined;
  }

  const literal = staticString(first);
  return literal === undefined ? undefined : `'${literal}'`;
}

/**
 * Two places claiming the same namespace on the same backend. `local` and `session` may each hold
 * an `auth`, exactly as the runtime registry allows — identity is backend plus path, not path.
 */
export function findDuplicates(declarations: readonly Declaration[]): Problem[] {
  const seen = new Map<string, Declaration[]>();
  for (const declaration of declarations) {
    const id = `${declaration.backend}::${declaration.namespace}`;
    const group = seen.get(id);
    if (group === undefined) seen.set(id, [declaration]);
    else group.push(declaration);
  }

  const problems: Problem[] = [];
  for (const group of seen.values()) {
    if (group.length < 2) continue;
    const first = group[0];
    if (first === undefined) continue;
    problems.push({
      kind: 'duplicate',
      namespace: first.namespace,
      backend: first.backend,
      sites: group.map((d) => `${d.file}:${d.line}:${d.column}`),
    });
  }
  return problems;
}
