/**
 * 0.3 mykey.py 字面量解析器（迁移专用，绝不执行 Python）。
 *
 * 0.3 的模型/渠道配置是 mykey.py 里的顶层赋值：`name = { ... }`（纯字面量
 * dict/list/str/int/bool/None + `#` 注释）。这里实现一个 Python 字面量子集
 * 解析器（等价于 ast.literal_eval 的覆盖面：str/int/float/bool/None/
 * list/tuple/dict，含转义、跨行、尾逗号），用 TS 确定性解析——不 spawn
 * Python、不执行任何 owner 代码。
 *
 * 容错：单个赋值解析失败不拖垮整份文件——该变量进 unparsable 清单
 * （迁移报告如实说明），其余变量照常解析。只认「顶格赋值」（0.3 约定
 * 顶层配置一律顶格）；缩进块内的同名赋值是 dict 内容，不会误判。
 */

export interface MykeyParseResult {
  /** 顶层变量名 → 字面量值（dict 为 Record，list 为数组）。 */
  values: Map<string, unknown>;
  /** 解析失败的顶层变量名（值不是纯字面量，如函数调用/运算式）。 */
  unparsable: string[];
}

// ── tokenizer ──────────────────────────────────────────────────

interface Token {
  kind: "str" | "num" | "ident" | "punct" | "bool" | "none";
  text: string;
}

const PUNCTS = new Set(["{", "}", "[", "]", "(", ")", ":", ",", "="]);

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const n = source.length;
  while (i < n) {
    const ch = source[i];
    // 空白
    if (ch === " " || ch === "\t" || ch === "\r" || ch === "\n") {
      i += 1;
      continue;
    }
    // 注释到行尾
    if (ch === "#") {
      while (i < n && source[i] !== "\n") i += 1;
      continue;
    }
    // 字符串（单/双引号，含转义；跨行容错到匹配引号或 EOF）
    if (ch === "'" || ch === '"') {
      const quote = ch;
      let value = "";
      i += 1;
      while (i < n && source[i] !== quote) {
        if (source[i] === "\\" && i + 1 < n) {
          const esc = source[i + 1];
          const mapped: Record<string, string> = {
            n: "\n",
            t: "\t",
            r: "\r",
            "\\": "\\",
            "'": "'",
            '"': '"',
            "0": "\0",
          };
          value += mapped[esc] ?? `\\${esc}`;
          i += 2;
          continue;
        }
        value += source[i];
        i += 1;
      }
      i += 1; // 收尾引号（或 EOF）
      tokens.push({ kind: "str", text: value });
      continue;
    }
    // 数字（int/float；紧跟数字的 - 视为负号，表达式里的 - 会在语法层报错）
    if (
      /[0-9]/.test(ch) ||
      (ch === "." && i + 1 < n && /[0-9]/.test(source[i + 1])) ||
      (ch === "-" && i + 1 < n && /[0-9.]/.test(source[i + 1]))
    ) {
      let j = i + (ch === "-" ? 1 : 0);
      while (j < n && /[0-9a-fA-FxXoObB._eE+-]/.test(source[j])) {
        // 指数符号后的 +/- 才吞；孤立的 + - 由语法层处理
        if ((source[j] === "+" || source[j] === "-") && !/[eE]/.test(source[j - 1])) break;
        j += 1;
      }
      tokens.push({ kind: "num", text: source.slice(i, j) });
      i = j;
      continue;
    }
    // 标识符 / True / False / None
    if (/[A-Za-z_]/.test(ch)) {
      let j = i;
      while (j < n && /[A-Za-z0-9_]/.test(source[j])) j += 1;
      const word = source.slice(i, j);
      if (word === "True" || word === "False") tokens.push({ kind: "bool", text: word });
      else if (word === "None") tokens.push({ kind: "none", text: word });
      else tokens.push({ kind: "ident", text: word });
      i = j;
      continue;
    }
    if (PUNCTS.has(ch)) {
      tokens.push({ kind: "punct", text: ch });
      i += 1;
      continue;
    }
    // 未识别字符（运算符 + - * / 等）：跳过——顶层赋值行的 `=` 与值内字面量
    // 用不到它们；值里出现运算符会在语法层报「非字面量」。
    i += 1;
  }
  return tokens;
}

// ── literal parser ─────────────────────────────────────────────

class LiteralParser {
  private pos = 0;
  constructor(private readonly tokens: Token[]) {}

  private peek(): Token | undefined {
    return this.tokens[this.pos];
  }

  private next(): Token | undefined {
    return this.tokens[this.pos++];
  }

  private expectPunct(text: string): void {
    const token = this.next();
    if (!token || token.kind !== "punct" || token.text !== text) {
      throw new Error(`expected '${text}', got ${token ? `${token.kind}:${token.text}` : "EOF"}`);
    }
  }

  /** 解析一个字面量值；失败抛错（调用方容错）。 */
  parseValue(): unknown {
    const token = this.peek();
    if (!token) throw new Error("unexpected EOF");
    if (token.kind === "str") return this.next()!.text;
    if (token.kind === "num") {
      this.next();
      const num = token.text.includes(".") || /[eE]/.test(token.text)
        ? Number.parseFloat(token.text)
        : Number.parseInt(token.text, token.text.startsWith("0x") || token.text.startsWith("0X") ? 16 : 10);
      if (Number.isNaN(num)) throw new Error(`bad number: ${token.text}`);
      return num;
    }
    if (token.kind === "bool") {
      this.next();
      return token.text === "True";
    }
    if (token.kind === "none") {
      this.next();
      return null;
    }
    if (token.kind === "punct" && token.text === "[") return this.parseList("]");
    if (token.kind === "punct" && token.text === "(") return this.parseList(")");
    if (token.kind === "punct" && token.text === "{") return this.parseDict();
    throw new Error(`not a literal: ${token.kind}:${token.text}`);
  }

  private parseList(closer: string): unknown[] {
    this.expectPunct(closer === "]" ? "[" : "(");
    const items: unknown[] = [];
    for (;;) {
      const token = this.peek();
      if (!token) throw new Error("unterminated list");
      if (token.kind === "punct" && token.text === closer) {
        this.next();
        return items;
      }
      items.push(this.parseValue());
      const sep = this.peek();
      if (sep?.kind === "punct" && sep.text === ",") {
        this.next();
        continue; // 允许尾逗号
      }
    }
  }

  private parseDict(): Record<string, unknown> {
    this.expectPunct("{");
    const dict: Record<string, unknown> = {};
    for (;;) {
      const token = this.peek();
      if (!token) throw new Error("unterminated dict");
      if (token.kind === "punct" && token.text === "}") {
        this.next();
        return dict;
      }
      // key 只认字符串/数字（0.3 mykey.py 事实如此）
      const keyToken = this.next();
      if (!keyToken || (keyToken.kind !== "str" && keyToken.kind !== "num")) {
        throw new Error(`bad dict key: ${keyToken ? `${keyToken.kind}:${keyToken.text}` : "EOF"}`);
      }
      this.expectPunct(":");
      dict[String(keyToken.text)] = this.parseValue();
      const sep = this.peek();
      if (sep?.kind === "punct" && sep.text === ",") {
        this.next();
        continue;
      }
    }
  }

  /** 值解析完后必须到 EOF（否则是运算式/调用等非字面量）。 */
  assertDone(): void {
    if (this.pos < this.tokens.length) {
      const rest = this.tokens[this.pos];
      throw new Error(`trailing tokens after literal: ${rest.kind}:${rest.text}`);
    }
  }
}

/** 解析一个字面量表达式（如 `{ 'a': 1 }`）；非字面量抛错。 */
export function parsePythonLiteral(text: string): unknown {
  const parser = new LiteralParser(tokenize(text));
  const value = parser.parseValue();
  parser.assertDone();
  return value;
}

/**
 * 解析整份 mykey.py：抽取全部顶格 `name = <字面量>` 赋值。
 * 注释、空行、非赋值行（如 import/函数定义——0.3 mykey.py 不该有）忽略；
 * 值不是纯字面量的变量进 unparsable。
 */
export function parseMykeyAssignments(source: string): MykeyParseResult {
  const values = new Map<string, unknown>();
  const unparsable: string[] = [];
  const lines = source.split("\n");
  // 顶格赋值起点：`name =`（== 比较排除；行首无空白）。
  const assignStarts: Array<{ name: string; line: number }> = [];
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=(?!=)/);
    if (match) assignStarts.push({ name: match[1], line: index });
  }
  for (let s = 0; s < assignStarts.length; s += 1) {
    const { name, line } = assignStarts[s];
    const endLine = s + 1 < assignStarts.length ? assignStarts[s + 1].line : lines.length;
    // 逐行累进解析：字面量可能跨行（dict/list），也可能一行即完——
    // 累进到「首次完整解析成功」为止；块尾的多余行属于后续内容，不毒化本值。
    // 单行内的尾随 token（'a' 'b' / 1 + 2）仍判非字面量。
    let parsed = false;
    for (let take = line + 1; take <= endLine; take += 1) {
      const block = lines.slice(line, take).join("\n");
      const valueText = block.slice(block.indexOf("=") + 1);
      try {
        values.set(name, parsePythonLiteral(valueText));
        parsed = true;
        break;
      } catch {
        continue; // 字面量尚未闭合（或根本不是字面量），再吞一行
      }
    }
    if (!parsed) unparsable.push(name);
  }
  return { values, unparsable };
}
