/** Static engine-message inventory. No engine, server, compiler or browser is started. */
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

export const repositoryRoot = fileURLToPath(new URL('../..', import.meta.url));

// Exact exclusions only; keep this small and explain why each is not presentation text.
export const runtimeMessageAllowlist = new Map([
  ['{}: {e}', 'Path plus external I/O/decoder error; no authored prose.'],
  ['{address} : {e}', 'Bind address plus external socket error; no authored prose.'],
  ['[{code}] {message}', 'Error envelope; translate its message, retaining the machine-readable code.'],
  ['{code}: {message}', 'Error envelope; translate its message, retaining the machine-readable code.'],
  ['rank beyond the values', 'unreachable! invariant in the erosion rank selection; never a returned error.'],
  ['{seed}/{relief}/{temperature}°C {precipitation} mm', 'Hydrology invariant test-case label, not a page diagnostic.'],
  ['the pass limit', 'Meander simulation stop reason, printed only by a test probe; never reaches the page.'],
  ['a reach too short', 'Meander simulation stop reason, printed only by a test probe; never reaches the page.'],
  ['the target sinuosity', 'Meander simulation stop reason, printed only by a test probe; never reaches the page.'],
  ['a stall', 'Meander simulation stop reason, printed only by a test probe; never reaches the page.'],
  ['no vertex free to move', 'Meander simulation stop reason, printed only by a test probe; never reaches the page.'],
  ['[threads] {} performance of {} logical cores; affinity {:#X} -> {:#X}; {} rayon threads{}; power throttling {}', 'Thread scheduling console trace.'],
  [' (from environment)', 'Suffix of the thread scheduling console trace.'],
  ['{base} {}', 'Generated district name, not an engine message.'],
  ['n° {}', 'Generated district name numbering.'],
  ['{head}{} {name}', 'Generated district name, including a proper name.'],
  ['{role_label}, {unit} {name}', 'Generated district name, including a proper name.'],
  ['{base}{possessive} {unit}{numeral}', 'Generated district name in the toponym language, including a proper name.'],
  ['{unit} {}', 'Generated district name numbering.'],
  ['{role_label}, {district}', 'Generated district name, including a proper name.'],
  ['204 No Content', 'HTTP wire status, not the response body shown by the page.'],
  ['400 Bad Request', 'HTTP wire status, not the response body shown by the page.'],
  ['405 Method Not Allowed', 'HTTP wire status, not the response body shown by the page.'],
  ['500 Internal Server Error', 'HTTP wire status, not the response body shown by the page.'],
  ['404 Not Found', 'HTTP wire status, not the response body shown by the page.'],
  ['413 Payload Too Large', 'HTTP wire status, not the response body shown by the page.'],
  ['503 Service Unavailable', 'HTTP wire status, not the response body shown by the page.'],
  ['text/plain; charset=utf-8', 'HTTP content type, not presentation text.'],
  ['', 'Empty transport fallback; contains no presentation text.'],
  ['engine_error', 'Machine-readable error code in an envelope.'],
  ['architecture_error', 'Machine-readable error code in an envelope.'],
  ['reason', 'Parcel-pack string-table key.'],
  ['parcels.reason', 'Parcel-pack binary-section key.'],
]);

function files(directory, extension) {
  return readdirSync(directory, { withFileTypes: true })
    .flatMap(entry => {
      const path = resolve(directory, entry.name);
      return entry.isDirectory() ? files(path, extension) : path.endsWith(extension) ? [path] : [];
    })
    .sort();
}

/** Rust lexer: comments, raw strings and character literals cannot masquerade as code. */
function rustTokens(source) {
  const tokens = [];
  const lex = /\/\/[^\n]*|\/\*|(?:br|r)(#*)"|b?"(?:\\[\s\S]|[^"\\])*"|'(?:\\(?:u\{[\da-fA-F]+\}|x[\da-fA-F]{2}|.)|[^'\\\r\n])'|[A-Za-z_][A-Za-z_0-9]*|[^\s]/gy;
  let offset = 0;
  while (offset < source.length) {
    if (/\s/u.test(source[offset])) {
      offset++;
      continue;
    }
    lex.lastIndex = offset;
    const match = lex.exec(source);
    if (!match) {
      offset++;
      continue;
    }
    const start = offset;
    offset = lex.lastIndex;
    if (match[0].startsWith('//')) continue;
    if (match[0] === '/*') {
      let depth = 1;
      while (offset < source.length && depth) {
        if (source.startsWith('/*', offset)) {
          depth++;
          offset += 2;
        } else if (source.startsWith('*/', offset)) {
          depth--;
          offset += 2;
        } else offset++;
      }
      continue;
    }
    let value;
    if (match[1] !== undefined) {
      const end = source.indexOf('"' + match[1], offset);
      value = source.slice(offset, end < 0 ? source.length : end);
      offset = end < 0 ? source.length : end + 1 + match[1].length;
    } else if (/^b?"/u.test(match[0])) {
      value = match[0]
        .replace(/^b?"|"$/gu, '')
        .replace(/\\\r?\n\s*/gu, '')
        .replace(/\\u\{([\da-fA-F]+)\}/gu, (_, n) => String.fromCodePoint(parseInt(n, 16)))
        .replace(/\\x([\da-fA-F]{2})/gu, (_, n) => String.fromCharCode(parseInt(n, 16)))
        .replace(/\\([nrt0"'\\])/gu, (_, c) => ({ n: '\n', r: '\r', t: '\t', 0: '\0' })[c] ?? c);
    }
    tokens.push({ text: match[0], value, start, end: offset });
  }
  return tokens;
}

function withoutRustTests(tokens) {
  const output = [];
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].text === '#' && tokens[i + 1]?.text === '[') {
      const end = tokens.findIndex((t, j) => j > i && t.text === ']');
      const attribute = tokens
        .slice(i, end + 1)
        .map(t => t.text)
        .join('');
      if (/^#\[(?:test|cfg\(test\))\]$/u.test(attribute)) {
        i = end;
        while (i < tokens.length && !['{', ';'].includes(tokens[i].text)) i++;
        if (tokens[i]?.text === '{') {
          let depth = 1;
          while (++i < tokens.length && depth) {
            if (tokens[i].value !== undefined) continue;
            if (tokens[i].text === '{') depth++;
            if (tokens[i].text === '}') depth--;
          }
          i--;
        }
        continue;
      }
    }
    output.push(tokens[i]);
  }
  return output;
}

export function rustMessageLiterals(source) {
  const tokens = withoutRustTests(rustTokens(source)),
    result = [];
  const stack = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.value !== undefined) {
      const context = tokens
        .slice(Math.max(0, i - 18), i)
        .map(t => (t.value === undefined ? t.text : 'STRING'))
        .join(' ');
      const calls = stack.map(item => item.call).join(' ');
      if (/\b(?:starts_with|ends_with|contains|strip_prefix|strip_suffix|replace|include_str|include_bytes)\b/u.test(stack.at(-1)?.call ?? '')) continue;
      const error = /\b(?:Err|ok_or|ok_or_else|map_err|bail|ensure)\b/u.test(calls);
      const prose = /\p{L}[^\n]*\s+[^\n]*\p{L}/u.test(token.value.replace(/\{[^{}]*\}/gu, 'VALUE')) && !/^\s*[{[]\s*"|^HTTP\/|\r\n|^\(.*=>|^'fortran_order'/u.test(token.value);
      const trace = /\b(?:println|eprintln|print|eprint|assert|assert_eq|assert_ne|debug_assert|expect|panic|log_warning_detail|warning_detail_text)\b/u.test(calls);
      const field = /\b(?:reason|message|warning|detail|label|status)\s*[:=]\s*(?:Some\s*\()?$/u.test(context);
      // Prose also catches indirect error closures and warning/reason helpers.
      if (!trace && (error || prose || (field && /\s/u.test(token.value))) && token.value.trim()) {
        result.push({ source: token.value, offset: token.start, format: stack.at(-1)?.call === 'format' });
      }
      continue;
    }
    if (['(', '{', '['].includes(token.text)) {
      const previous = tokens[i - 1]?.text;
      stack.push({ delimiter: token.text, call: previous === '!' ? tokens[i - 2]?.text : previous });
    } else if ([')', '}', ']'].includes(token.text)) stack.pop();
  }
  return result;
}

function messageParameters(tree, parameters = new Map()) {
  function visit(node) {
    const fn = ts.isFunctionDeclaration(node) ? node : ts.isVariableDeclaration(node) && node.initializer && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer)) ? node.initializer : undefined;
    if (fn) {
      const name = ts.isFunctionDeclaration(node) ? node.name?.text : node.name.getText(tree);
      const indices = fn.parameters.flatMap((parameter, index) => (/^(?:message|reason|detail)$/u.test(parameter.name.getText(tree)) && parameter.type?.kind === ts.SyntaxKind.StringKeyword ? [index] : []));
      if (name && indices.length) parameters.set(name, indices);
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  return parameters;
}

export function bridgeMessageLiterals(source, file = 'bridge.ts', sharedParameters) {
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS),
    result = [];
  const parameters = messageParameters(tree, new Map(sharedParameters));
  const bindings = new Map(),
    resolving = new Set();
  function bind(node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) bindings.set(node.name.text, node.initializer);
    ts.forEachChild(node, bind);
  }
  bind(tree);
  function collect(node) {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) result.push({ source: node.text, offset: node.getStart(tree), format: false });
    else if (ts.isTemplateExpression(node)) {
      let text = node.head.text;
      for (const [index, span] of node.templateSpans.entries()) {
        const expression = span.expression.getText(tree);
        // Stable names for common envelope slots; other expressions retain distinct numbered slots.
        const key = /(?:^|\.)message(?:\s|\?|$)/u.test(expression) ? 'message' : /(?:^|\.)code(?:\s|\?|$)/u.test(expression) ? 'code' : `value${index + 1}`;
        text += `{${key}}` + span.literal.text;
      }
      result.push({ source: text, offset: node.getStart(tree), format: true });
      // Literal fallback messages inside interpolations are independently user-facing.
      for (const span of node.templateSpans) collectFallback(span.expression);
    } else if (ts.isConditionalExpression(node)) {
      collect(node.whenTrue);
      collect(node.whenFalse);
    } else if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      let slot = 0;
      const concatenate = value =>
        ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value) ? value.text : ts.isBinaryExpression(value) && value.operatorToken.kind === ts.SyntaxKind.PlusToken ? concatenate(value.left) + concatenate(value.right) : `{value${++slot}}`;
      result.push({ source: concatenate(node), offset: node.getStart(tree), format: slot > 0 });
    } else if (ts.isBinaryExpression(node) && [ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.BarBarToken].includes(node.operatorToken.kind)) {
      collect(node.left);
      collect(node.right);
    } else if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isNonNullExpression(node)) collect(node.expression);
    else if (ts.isCallExpression(node) && node.expression.getText(tree) === 'String' && node.arguments[0]) collect(node.arguments[0]);
    else if (ts.isIdentifier(node) && bindings.has(node.text) && !resolving.has(node.text)) {
      resolving.add(node.text);
      collect(bindings.get(node.text));
      resolving.delete(node.text);
    }
  }
  function collectFallback(node) {
    if (ts.isBinaryExpression(node) && [ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.BarBarToken].includes(node.operatorToken.kind)) collect(node.right);
    ts.forEachChild(node, collectFallback);
  }
  function visit(node) {
    if (ts.isNewExpression(node) && /^(?:Error|TypeError|RangeError)$/u.test(node.expression.getText(tree))) {
      if (node.arguments?.[0]) collect(node.arguments[0]);
    } else if (ts.isPropertyAssignment(node) && /^(?:reason|message|detail|error)$/u.test(node.name.getText(tree))) {
      // Object schemas/tables use these keys too; only prose is presentation copy.
      const before = result.length;
      collect(node.initializer);
      for (let i = result.length - 1; i >= before; i--) if (!/\s/u.test(result[i].source)) result.splice(i, 1);
    } else if (ts.isCallExpression(node) && /(?:^|\.)(?:onProgress|progress|reportProgress)$/u.test(node.expression.getText(tree))) {
      if (node.arguments[0]) collect(node.arguments[0]);
      for (const argument of node.arguments.slice(1)) visit(argument);
    } else if (ts.isCallExpression(node) && parameters.has(node.expression.getText(tree))) {
      for (const index of parameters.get(node.expression.getText(tree))) if (node.arguments[index]) collect(node.arguments[index]);
      ts.forEachChild(node, visit);
    } else ts.forEachChild(node, visit);
  }
  visit(tree);
  return result;
}

export function scanRuntimeMessageSources(root = repositoryRoot) {
  const result = [];
  const sharedParameters = new Map();
  for (const path of files(resolve(root, 'rust/bridge'), '.ts')) {
    const source = readFileSync(path, 'utf8');
    messageParameters(ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS), sharedParameters);
  }
  for (const group of ['terrain', 'core', 'local', 'wasm', 'neural', 'bridge']) {
    const directory = resolve(root, group === 'bridge' ? 'rust/bridge' : `rust/crates/${group}/src`);
    for (const path of files(directory, group === 'bridge' ? '.ts' : '.rs')) {
      if (/(?:^|[/\\])(?:tests?|fixtures|regression)(?:[/\\]|\.)|_tests?\.rs$/u.test(path)) continue;
      const source = readFileSync(path, 'utf8');
      const messages = group === 'bridge' ? bridgeMessageLiterals(source, path, sharedParameters) : rustMessageLiterals(source);
      for (const message of messages) result.push({ ...message, group, file: relative(root, path).replaceAll('\\', '/'), line: source.slice(0, message.offset).split('\n').length });
    }
  }
  return result;
}

/** Sample actual formatted text, never execute source expressions or assume a language. */
export function runtimeMessageSample(message) {
  if (!message.format) return message.source;
  let slot = 0;
  return message.source.replace(/\{\{|\}\}|\{([^{}]*)\}/gu, (token, spec) => {
    if (token === '{{') return '{';
    if (token === '}}') return '}';
    slot++;
    if (/^(?:count|index|done|total|quarters|parcels|buildings|placed|built|population|extent|seconds|size|min|max|factor|status)(?::|$)/u.test(spec)) return '17';
    return '17';
  });
}
