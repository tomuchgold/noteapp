/**
 * v0.11 纯逻辑测试：lineHits（行聚合）/ lineHitPos（行→偏移）
 * esbuild 预编译后 node 直接 import，不需要浏览器。
 */
import { strict as assert } from "node:assert";
import { findAll, lineHits, lineHitPos, DEFAULT_OPTIONS } from "/tmp/search.bundle.mjs";

let passed = 0;
function t(name, fn) {
  fn();
  passed++;
  console.log(`  ok  ${name}`);
}

const opt = DEFAULT_OPTIONS;

t("lineHits: 基本聚合（3 行文本，2 处命中 → 2 条）", () => {
  const text = "hello world\nfoo bar hello\nnothing here";
  const ms = findAll(text, "hello", opt);
  const hits = lineHits(text, ms);
  assert.equal(hits.length, 2);
  assert.deepEqual(hits.map((h) => h.line), [1, 2]);
  assert.deepEqual(hits[0].ranges, [{ start: 0, end: 5 }]);
  assert.deepEqual(hits[1].ranges, [{ start: 8, end: 13 }]);
});

t("lineHits: 同行多命中区间", () => {
  const text = "a cat and a cat";
  const hits = lineHits(text, findAll(text, "cat", opt));
  assert.equal(hits.length, 1);
  assert.deepEqual(hits[0].ranges, [
    { start: 2, end: 5 },
    { start: 12, end: 15 },
  ]);
});

t("lineHits: 跨行匹配拆到两行", () => {
  const text = "alpha\nbeta";
  const hits = lineHits(text, [{ from: 3, to: 8 }]); // "pa\nbe"
  assert.equal(hits.length, 2);
  assert.deepEqual(hits[0].ranges, [{ start: 3, end: 5 }]);
  assert.deepEqual(hits[1].ranges, [{ start: 0, end: 2 }]);
  assert.equal(hits[0].text, "alpha");
  assert.equal(hits[1].text, "beta");
});

t("lineHits: 无匹配 → 空数组", () => {
  assert.deepEqual(lineHits("abc", []), []);
});

t("lineHits: 正则多行内容", () => {
  const text = "x=1\ny=2\nz=1";
  const hits = lineHits(text, findAll(text, "=1", opt));
  assert.deepEqual(hits.map((h) => h.line), [1, 3]);
});

t("lineHitPos: 第 n 行 → 行首偏移", () => {
  const text = "ab\ncd\nef";
  assert.equal(lineHitPos(text, 1), 0);
  assert.equal(lineHitPos(text, 2), 3);
  assert.equal(lineHitPos(text, 3), 6);
});

t("lineHitPos: 超出末行 → 文档末尾", () => {
  assert.equal(lineHitPos("ab\ncd", 99), 5);
});

t("lineHits + lineHitPos 联动：面板点击行能对回第一个命中", () => {
  const text = "one two\nthree two\nfour";
  const ms = findAll(text, "two", opt);
  const hits = lineHits(text, ms);
  for (const h of hits) {
    const pos = lineHitPos(text, h.line);
    const idx = ms.findIndex((m) => m.from >= pos);
    assert.ok(idx >= 0);
    assert.equal(text.slice(ms[idx].from, ms[idx].to), "two");
  }
});

t("lineHits: 区间有序且不重叠", () => {
  const text = "aaa aaa aaa aaa";
  const hits = lineHits(text, findAll(text, "a", opt));
  const rs = hits[0].ranges;
  for (let i = 1; i < rs.length; i++) {
    assert.ok(rs[i - 1].end <= rs[i].start);
  }
});

t("lineHits: 空行文本安全", () => {
  assert.deepEqual(lineHits("", findAll("", "x", opt)), []);
});

console.log(`\n${passed}/10 lineHits tests passed`);
