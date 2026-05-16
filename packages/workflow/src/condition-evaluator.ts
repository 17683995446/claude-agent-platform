// condition-evaluator.ts - 条件评估器

export class ConditionParseError extends Error {
  constructor(message: string, public position?: number) {
    super(message);
    this.name = 'ConditionParseError';
  }
}

type CustomFunction = (...args: unknown[]) => boolean;

export class ConditionEvaluator {
  private customFunctions = new Map<string, CustomFunction>();

  /**
   * Register a custom condition function.
   */
  registerFunction(name: string, fn: CustomFunction): void {
    this.customFunctions.set(name.toLowerCase(), fn);
  }

  /**
   * Evaluate a condition expression against a context.
   * Supports: ==, !=, >, <, >=, <=, AND, OR, NOT, contains, startsWith, endsWith, regex, parentheses.
   */
  evaluate(condition: string, context: Record<string, unknown>): boolean {
    const tokens = this.tokenize(condition);
    const result = this.parseOr(tokens, 0, context);
    return result.value as boolean;
  }

  private tokenize(expr: string): { type: string; value: string; pos: number }[] {
    const tokens: { type: string; value: string; pos: number }[] = [];
    let i = 0;

    while (i < expr.length) {
      // Skip whitespace
      if (/\s/.test(expr[i])) { i++; continue; }

      // Parentheses
      if (expr[i] === '(' || expr[i] === ')') {
        tokens.push({ type: 'paren', value: expr[i], pos: i });
        i++;
        continue;
      }

      // String literals
      if (expr[i] === '"' || expr[i] === "'") {
        const quote = expr[i];
        let j = i + 1;
        while (j < expr.length && expr[j] !== quote) {
          if (expr[j] === '\\') j++;
          j++;
        }
        if (j >= expr.length) {
          throw new ConditionParseError(`Unterminated string at position ${i}`, i);
        }
        tokens.push({ type: 'string', value: expr.slice(i + 1, j), pos: i });
        i = j + 1;
        continue;
      }

      // Numbers
      if (/\d/.test(expr[i]) || (expr[i] === '-' && i + 1 < expr.length && /\d/.test(expr[i + 1]))) {
        let j = i;
        if (expr[j] === '-') j++;
        while (j < expr.length && /[\d.]/.test(expr[j])) j++;
        tokens.push({ type: 'number', value: expr.slice(i, j), pos: i });
        i = j;
        continue;
      }

      // Boolean/null literals
      const literalMatch = expr.slice(i).match(/^(true|false|null|undefined)\b/);
      if (literalMatch) {
        tokens.push({ type: 'literal', value: literalMatch[1], pos: i });
        i += literalMatch[1].length;
        continue;
      }

      // Operators: ==, !=, >=, <=, >, <
      if (expr.slice(i, i + 2) === '==' || expr.slice(i, i + 2) === '!=' ||
          expr.slice(i, i + 2) === '>=' || expr.slice(i, i + 2) === '<=') {
        tokens.push({ type: 'operator', value: expr.slice(i, i + 2), pos: i });
        i += 2;
        continue;
      }
      if (expr[i] === '>' || expr[i] === '<') {
        tokens.push({ type: 'operator', value: expr[i], pos: i });
        i++;
        continue;
      }

      // Identifiers and keywords
      if (/[a-zA-Z_$]/.test(expr[i])) {
        let j = i;
        while (j < expr.length && /[a-zA-Z0-9_$.]/.test(expr[j])) j++;
        const word = expr.slice(i, j);

        const upper = word.toUpperCase();
        if (upper === 'AND' || upper === 'OR' || upper === 'NOT') {
          tokens.push({ type: 'logical', value: upper, pos: i });
        } else if (word === 'contains' || word === 'startsWith' || word === 'endsWith' || word === 'regex') {
          tokens.push({ type: 'method', value: word, pos: i });
        } else {
          tokens.push({ type: 'identifier', value: word, pos: i });
        }
        i = j;
        continue;
      }

      throw new ConditionParseError(`Unexpected character "${expr[i]}" at position ${i}`, i);
    }

    return tokens;
  }

  private resolveValue(token: { type: string; value: string }, context: Record<string, unknown>): unknown {
    switch (token.type) {
      case 'string': return token.value;
      case 'number': return parseFloat(token.value);
      case 'literal': {
        if (token.value === 'true') return true;
        if (token.value === 'false') return false;
        if (token.value === 'null') return null;
        if (token.value === 'undefined') return undefined;
        return token.value;
      }
      case 'identifier': {
        // Support dot notation for nested access
        const parts = token.value.split('.');
        let current: unknown = context;
        for (const part of parts) {
          if (current == null || typeof current !== 'object') return undefined;
          current = (current as Record<string, unknown>)[part];
        }
        return current;
      }
      default: return token.value;
    }
  }

  private parseOr(tokens: { type: string; value: string }[], pos: number, context: Record<string, unknown>): { value: unknown; pos: number } {
    let left = this.parseAnd(tokens, pos, context);

    while (left.pos < tokens.length && tokens[left.pos].type === 'logical' && tokens[left.pos].value === 'OR') {
      const right = this.parseAnd(tokens, left.pos + 1, context);
      left = { value: (left.value as boolean) || (right.value as boolean), pos: right.pos };
    }

    return left;
  }

  private parseAnd(tokens: { type: string; value: string }[], pos: number, context: Record<string, unknown>): { value: unknown; pos: number } {
    let left = this.parseNot(tokens, pos, context);

    while (left.pos < tokens.length && tokens[left.pos].type === 'logical' && tokens[left.pos].value === 'AND') {
      const right = this.parseNot(tokens, left.pos + 1, context);
      left = { value: (left.value as boolean) && (right.value as boolean), pos: right.pos };
    }

    return left;
  }

  private parseNot(tokens: { type: string; value: string }[], pos: number, context: Record<string, unknown>): { value: unknown; pos: number } {
    if (pos < tokens.length && tokens[pos].type === 'logical' && tokens[pos].value === 'NOT') {
      const result = this.parseNot(tokens, pos + 1, context);
      return { value: !(result.value as boolean), pos: result.pos };
    }
    return this.parseComparison(tokens, pos, context);
  }

  private parseComparison(tokens: { type: string; value: string }[], pos: number, context: Record<string, unknown>): { value: unknown; pos: number } {
    // Handle parentheses
    if (pos < tokens.length && tokens[pos].type === 'paren' && tokens[pos].value === '(') {
      const result = this.parseOr(tokens, pos + 1, context);
      if (result.pos < tokens.length && tokens[result.pos].type === 'paren' && tokens[result.pos].value === ')') {
        return { value: result.value, pos: result.pos + 1 };
      }
      throw new ConditionParseError('Missing closing parenthesis');
    }

    // Get left operand
    if (pos >= tokens.length) {
      throw new ConditionParseError('Unexpected end of expression');
    }

    const leftToken = tokens[pos];
    const leftValue = this.resolveValue(leftToken, context);
    pos++;

    // Check for method calls (contains, startsWith, endsWith, regex)
    if (pos < tokens.length && tokens[pos].type === 'method') {
      const method = tokens[pos].value;
      pos++;
      // Expect opening paren
      if (pos >= tokens.length || tokens[pos].value !== '(') {
        throw new ConditionParseError(`Expected "(" after "${method}"`);
      }
      pos++;
      // Get right operand
      const rightToken = tokens[pos];
      const rightValue = this.resolveValue(rightToken, context);
      pos++;
      // Expect closing paren
      if (pos >= tokens.length || tokens[pos].value !== ')') {
        throw new ConditionParseError(`Expected ")" after argument`);
      }
      pos++;

      const strLeft = String(leftValue ?? '');
      const strRight = String(rightValue ?? '');

      let result: boolean;
      switch (method) {
        case 'contains': result = strLeft.includes(strRight); break;
        case 'startsWith': result = strLeft.startsWith(strRight); break;
        case 'endsWith': result = strLeft.endsWith(strRight); break;
        case 'regex': {
          try {
            result = new RegExp(strRight).test(strLeft);
          } catch {
            throw new ConditionParseError(`Invalid regex: ${strRight}`);
          }
          break;
        }
        default: throw new ConditionParseError(`Unknown method: ${method}`);
      }

      return { value: result, pos };
    }

    // Check for function call (identifier followed by paren)
    if (leftToken.type === 'identifier' && pos < tokens.length && tokens[pos].type === 'paren' && tokens[pos].value === '(') {
      const funcName = leftToken.value.toLowerCase();
      const fn = this.customFunctions.get(funcName);
      if (!fn) throw new ConditionParseError(`Unknown function: ${leftToken.value}`);
      pos++; // skip (
      const args: unknown[] = [];
      while (pos < tokens.length && !(tokens[pos].type === 'paren' && tokens[pos].value === ')')) {
        if (tokens[pos].type === 'paren' && tokens[pos].value === '(') {
          // Nested expression as arg
          const nested = this.parseOr(tokens, pos + 1, context);
          args.push(nested.value);
          pos = nested.pos;
        } else {
          args.push(this.resolveValue(tokens[pos], context));
          pos++;
        }
        // Skip comma
        if (pos < tokens.length && tokens[pos].value === ',') pos++;
      }
      if (pos < tokens.length) pos++; // skip )
      return { value: fn(...args), pos };
    }

    // Check for comparison operator
    if (pos < tokens.length && tokens[pos].type === 'operator') {
      const op = tokens[pos].value;
      pos++;
      if (pos >= tokens.length) {
        throw new ConditionParseError('Expected right operand after operator');
      }
      const rightToken = tokens[pos];
      const rightValue = this.resolveValue(rightToken, context);
      pos++;

      return { value: this.compare(leftValue, rightValue, op), pos };
    }

    // Single value - coerce to boolean
    return { value: !!leftValue, pos };
  }

  private compare(left: unknown, right: unknown, op: string): boolean {
    // Type coercion for comparison
    const l = this.coerce(left);
    const r = this.coerce(right);

    switch (op) {
      case '==': return l == r; // eslint-disable-line eqeqeq
      case '!=': return l != r; // eslint-disable-line eqeqeq
      case '>': return l > r;
      case '<': return l < r;
      case '>=': return l >= r;
      case '<=': return l <= r;
      default: throw new ConditionParseError(`Unknown operator: ${op}`);
    }
  }

  private coerce(value: unknown): string | number | boolean {
    if (typeof value === 'number' || typeof value === 'boolean') return value;
    if (value == null) return value as null;
    // Try to convert string to number
    const str = String(value);
    const num = Number(str);
    if (!isNaN(num) && str.trim() !== '') return num;
    return str;
  }
}
