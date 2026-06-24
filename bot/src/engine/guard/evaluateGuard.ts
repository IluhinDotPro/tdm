/**
 * Guard — булево условие на переходе FSM (см. docs/bot-fsm/dsl-spec.md §3).
 *
 * Назначение: вычислить выражение guard над ПАМЯТЬЮ заказа/пользователя (read-only),
 * чтобы движок мог выбрать переход по принципу first_match (первый transition с тем же
 * событием, чей guard истинен).
 *
 * Сознательно НЕ используется eval/new Function: набор операторов фиксирован, побочных
 * эффектов нет, опечатка в схеме не исполняет произвольный JS. (flowSelection.condition
 * пока на new Function — объединение — задача Этапа 6, A2/A3.)
 *
 * Поддерживается (dsl-spec §3):
 *   - литералы: число (1, 3.5), строка ('OFFER', "OFFER"), true, false, null
 *   - путь по памяти: order.input.from, user.id, snapshot.candidates.length
 *   - операторы: == != > < >= <= && || ! и скобки
 *
 * Семантика:
 *   - отсутствующий путь → undefined; в сравнении с null считается равным null
 *     (order.from != null → false, когда поля нет);
 *   - == / != сравнивают по строгому равенству (с нормализацией undefined→null);
 *   - > < >= <= — обычное сравнение значений (если операнд undefined → false);
 *   - && || ! работают по истинности (Boolean());
 *   - результат guard — истинность итогового значения.
 */

// ==================== Токенайзер ====================

type TokType =
  | 'num' | 'str' | 'ident'
  | 'true' | 'false' | 'null'
  | '==' | '!=' | '>=' | '<=' | '>' | '<'
  | '&&' | '||' | '!'
  | '(' | ')' | '.'
  | 'eof';

interface Token {
  type: TokType;
  value?: string | number;
  pos: number;
}

const KEYWORDS: Record<string, TokType> = { true: 'true', false: 'false', null: 'null' };

function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const n = src.length;

  const isIdentStart = (c: string) => /[A-Za-z_]/.test(c);
  const isIdentPart = (c: string) => /[A-Za-z0-9_]/.test(c);
  const isDigit = (c: string) => c >= '0' && c <= '9';

  while (i < n) {
    const c = src[i];

    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') { i++; continue; }

    // Строки
    if (c === '"' || c === "'") {
      const quote = c;
      const start = i;
      i++;
      let buf = '';
      while (i < n && src[i] !== quote) {
        if (src[i] === '\\' && i + 1 < n) { buf += src[i + 1]; i += 2; }
        else { buf += src[i]; i++; }
      }
      if (i >= n) throw new GuardError(`незакрытая строка с позиции ${start}`, src);
      i++; // закрывающая кавычка
      tokens.push({ type: 'str', value: buf, pos: start });
      continue;
    }

    // Числа
    if (isDigit(c) || (c === '.' && isDigit(src[i + 1]))) {
      const start = i;
      while (i < n && (isDigit(src[i]) || src[i] === '.')) i++;
      const raw = src.slice(start, i);
      const num = Number(raw);
      if (!Number.isFinite(num)) throw new GuardError(`некорректное число '${raw}'`, src);
      tokens.push({ type: 'num', value: num, pos: start });
      continue;
    }

    // Идентификаторы / ключевые слова
    if (isIdentStart(c)) {
      const start = i;
      while (i < n && isIdentPart(src[i])) i++;
      const word = src.slice(start, i);
      const kw = KEYWORDS[word];
      if (kw) tokens.push({ type: kw, pos: start });
      else tokens.push({ type: 'ident', value: word, pos: start });
      continue;
    }

    // Двусимвольные операторы
    const two = src.slice(i, i + 2);
    if (two === '==' || two === '!=' || two === '>=' || two === '<=' || two === '&&' || two === '||') {
      tokens.push({ type: two as TokType, pos: i });
      i += 2;
      continue;
    }

    // Односимвольные
    if (c === '>' || c === '<' || c === '!' || c === '(' || c === ')' || c === '.') {
      tokens.push({ type: c as TokType, pos: i });
      i++;
      continue;
    }

    throw new GuardError(`неожиданный символ '${c}' на позиции ${i}`, src);
  }

  tokens.push({ type: 'eof', pos: n });
  return tokens;
}

// ==================== AST ====================

type Node =
  | { t: 'lit'; value: string | number | boolean | null }
  | { t: 'ident'; name: string }
  | { t: 'member'; obj: Node; prop: string }
  | { t: 'unary'; op: '!'; arg: Node }
  | { t: 'cmp'; op: '==' | '!=' | '>' | '<' | '>=' | '<='; left: Node; right: Node }
  | { t: 'logic'; op: '&&' | '||'; left: Node; right: Node };

export class GuardError extends Error {
  constructor(message: string, public expr: string) {
    super(`Guard '${expr}': ${message}`);
    this.name = 'GuardError';
  }
}

// ==================== Парсер (рекурсивный спуск) ====================

class Parser {
  private pos = 0;
  constructor(private tokens: Token[], private src: string) {}

  private peek(): Token { return this.tokens[this.pos]; }
  private next(): Token { return this.tokens[this.pos++]; }
  private expect(type: TokType): Token {
    const t = this.peek();
    if (t.type !== type) throw new GuardError(`ожидался '${type}', получен '${t.type}' на позиции ${t.pos}`, this.src);
    return this.next();
  }

  parse(): Node {
    const node = this.parseOr();
    if (this.peek().type !== 'eof') {
      throw new GuardError(`лишние токены с позиции ${this.peek().pos}`, this.src);
    }
    return node;
  }

  private parseOr(): Node {
    let left = this.parseAnd();
    while (this.peek().type === '||') {
      this.next();
      left = { t: 'logic', op: '||', left, right: this.parseAnd() };
    }
    return left;
  }

  private parseAnd(): Node {
    let left = this.parseEquality();
    while (this.peek().type === '&&') {
      this.next();
      left = { t: 'logic', op: '&&', left, right: this.parseEquality() };
    }
    return left;
  }

  private parseEquality(): Node {
    let left = this.parseComparison();
    while (this.peek().type === '==' || this.peek().type === '!=') {
      const op = this.next().type as '==' | '!=';
      left = { t: 'cmp', op, left, right: this.parseComparison() };
    }
    return left;
  }

  private parseComparison(): Node {
    let left = this.parseUnary();
    const tt = this.peek().type;
    while (tt === '>' || tt === '<' || tt === '>=' || tt === '<=') {
      const op = this.next().type as '>' | '<' | '>=' | '<=';
      left = { t: 'cmp', op, left, right: this.parseUnary() };
      // повторная проверка типа следующего токена
      if (this.peek().type !== '>' && this.peek().type !== '<' && this.peek().type !== '>=' && this.peek().type !== '<=') break;
    }
    return left;
  }

  private parseUnary(): Node {
    if (this.peek().type === '!') {
      this.next();
      return { t: 'unary', op: '!', arg: this.parseUnary() };
    }
    return this.parsePostfix();
  }

  private parsePostfix(): Node {
    let node = this.parsePrimary();
    while (this.peek().type === '.') {
      this.next();
      const prop = this.expect('ident');
      node = { t: 'member', obj: node, prop: String(prop.value) };
    }
    return node;
  }

  private parsePrimary(): Node {
    const t = this.peek();
    switch (t.type) {
      case 'num': this.next(); return { t: 'lit', value: t.value as number };
      case 'str': this.next(); return { t: 'lit', value: t.value as string };
      case 'true': this.next(); return { t: 'lit', value: true };
      case 'false': this.next(); return { t: 'lit', value: false };
      case 'null': this.next(); return { t: 'lit', value: null };
      case 'ident': this.next(); return { t: 'ident', name: String(t.value) };
      case '(': {
        this.next();
        const inner = this.parseOr();
        this.expect(')');
        return inner;
      }
      default:
        throw new GuardError(`неожиданный токен '${t.type}' на позиции ${t.pos}`, this.src);
    }
  }
}

// ==================== Вычисление ====================

function norm(v: any): any { return v === undefined ? null : v; }

function truthy(v: any): boolean { return Boolean(v); }

function evalNode(node: Node, ctx: Record<string, any>): any {
  switch (node.t) {
    case 'lit': return node.value;
    case 'ident': return ctx == null ? undefined : ctx[node.name];
    case 'member': {
      const o = evalNode(node.obj, ctx);
      return o == null ? undefined : o[node.prop];
    }
    case 'unary': return !truthy(evalNode(node.arg, ctx));
    case 'logic': {
      const l = truthy(evalNode(node.left, ctx));
      if (node.op === '&&') return l && truthy(evalNode(node.right, ctx));
      return l || truthy(evalNode(node.right, ctx));
    }
    case 'cmp': {
      const a = evalNode(node.left, ctx);
      const b = evalNode(node.right, ctx);
      switch (node.op) {
        case '==': return norm(a) === norm(b);
        case '!=': return norm(a) !== norm(b);
        case '>':  return a > b;
        case '<':  return a < b;
        case '>=': return a >= b;
        case '<=': return a <= b;
      }
    }
  }
}

// ==================== Публичный API ====================

const astCache = new Map<string, Node>();

/** Распарсить выражение guard в AST (с кэшем). Бросает GuardError при синтаксической ошибке. */
export function parseGuard(expr: string): Node {
  const cached = astCache.get(expr);
  if (cached) return cached;
  const ast = new Parser(tokenize(expr), expr).parse();
  astCache.set(expr, ast);
  return ast;
}

/**
 * Вычислить guard над контекстом памяти. Возвращает boolean.
 * onError: что вернуть при ошибке парсинга/вычисления (по умолчанию false — fail-closed:
 * битый guard НЕ открывает переход, движок пробует следующий transition).
 */
export function evaluateGuard(
  expr: string | undefined | null,
  ctx: Record<string, any>,
  opts?: { onError?: (e: GuardError) => void },
): boolean {
  if (expr == null || expr.trim() === '') return true; // нет guard → переход разрешён
  try {
    return truthy(evalNode(parseGuard(expr), ctx || {}));
  } catch (e) {
    const err = e instanceof GuardError ? e : new GuardError(String((e as Error)?.message ?? e), expr);
    opts?.onError?.(err);
    return false;
  }
}
