/**
 * mykey.py 字面量解析器测试（迁移工具的安全前提：绝不执行 Python，
 * 只解析字面量；解析失败容错到下一个变量）。
 *
 * fixture `fixtures/03home/mykey_template_full.py` 是 0.3 仓库
 * mykey_template.py 的逐字节副本（模板无任何真实凭证）——解析器
 * 必须完整吃下 0.3 真实格式。
 */

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  parseMykeyAssignments,
  parsePythonLiteral,
} from "../src/migrate/mykey-parser.js";

const FIXTURE_03 = path.join(__dirname, "fixtures", "03home");

describe("parsePythonLiteral: Python 字面量子集", () => {
  it("字符串：单双引号 + 转义", () => {
    expect(parsePythonLiteral("'sk-abc'")).toBe("sk-abc");
    expect(parsePythonLiteral('"hello"')).toBe("hello");
    expect(parsePythonLiteral(String.raw`'it\'s "quoted"\n'`)).toBe(`it's "quoted"\n`);
  });

  it("数字 / 布尔 / None", () => {
    expect(parsePythonLiteral("10")).toBe(10);
    expect(parsePythonLiteral("0.5")).toBe(0.5);
    expect(parsePythonLiteral("-3")).toBe(-3);
    expect(parsePythonLiteral("True")).toBe(true);
    expect(parsePythonLiteral("False")).toBe(false);
    expect(parsePythonLiteral("None")).toBe(null);
  });

  it("列表 / 元组 / 嵌套 dict / 尾逗号 / 跨行", () => {
    expect(parsePythonLiteral("[1, 'a', True,]")).toEqual([1, "a", true]);
    expect(parsePythonLiteral("('a', 'b')")).toEqual(["a", "b"]);
    expect(
      parsePythonLiteral(`{
        'llm_nos': ['a', 'b'],
        'max_retries': 10,
        'nested': {'x': 1, 'y': [True, None]},
      }`),
    ).toEqual({ llm_nos: ["a", "b"], max_retries: 10, nested: { x: 1, y: [true, null] } });
  });

  it("注释被剥掉（行内 # 与整行 #）", () => {
    expect(
      parsePythonLiteral(`{
        'name': 'a',  # 行内注释
        # 整行注释
        'model': 'm',
      }`),
    ).toEqual({ name: "a", model: "m" });
  });

  it("非字面量抛错：函数调用 / 运算式 / 尾随 token", () => {
    expect(() => parsePythonLiteral("load_key()")).toThrow();
    expect(() => parsePythonLiteral("1 + 2")).toThrow();
    expect(() => parsePythonLiteral("'a' 'b'")).toThrow();
  });
});

describe("parseMykeyAssignments: 顶格赋值抽取", () => {
  it("抽取顶格赋值，忽略注释/空行/缩进块内容", () => {
    const result = parseMykeyAssignments(
      [
        "# 注释里的 fake = 1 不算",
        "a = {'k': 'v',",
        "     'k2': 2}", // 跨行 dict 的缩进续行
        "b = [1, 2]",
        "  # 缩进注释也不影响",
        "",
      ].join("\n"),
    );
    expect(result.values.get("a")).toEqual({ k: "v", k2: 2 });
    expect(result.values.get("b")).toEqual([1, 2]);
    expect(result.unparsable).toEqual([]);
  });

  it("单个赋值解析失败不拖垮整份文件", () => {
    const result = parseMykeyAssignments(
      ["good = {'x': 1}", "bad = compute()", "also_good = 'ok'"].join("\n"),
    );
    expect(result.values.get("good")).toEqual({ x: 1 });
    expect(result.values.get("also_good")).toBe("ok");
    expect(result.unparsable).toEqual(["bad"]);
  });

  it("== 比较不被误判为赋值", () => {
    const result = parseMykeyAssignments(["x = 1", "y == 2  # 比较"].join("\n"));
    expect(result.values.has("x")).toBe(true);
    expect(result.values.has("y")).toBe(false);
  });

  it("吃下 0.3 真实模板（mykey_template.py 逐字节副本）", () => {
    const source = fs.readFileSync(path.join(FIXTURE_03, "mykey_template_full.py"), "utf-8");
    const result = parseMykeyAssignments(source);
    // 模板里未注释的有效赋值：mixin_config + 一个 native_oai_config 示例。
    expect(result.unparsable).toEqual([]);
    expect(result.values.get("mixin_config")).toEqual({
      llm_nos: ["gpt-native"],
      max_retries: 10,
      base_delay: 0.5,
    });
    const oai = result.values.get("native_oai_config") as Record<string, unknown>;
    expect(oai).toMatchObject({
      name: "gpt-native",
      apibase: "https://api.openai.com/v1",
      model: "gpt-5.4",
      max_retries: 3,
    });
    // 注释掉的条目绝不能被解析出来。
    expect(result.values.has("native_claude_config0")).toBe(false);
    expect(result.values.has("fs_app_id")).toBe(false);
  });
});
