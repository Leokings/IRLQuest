import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import ts from "typescript";

const source = await readFile(join(import.meta.dirname, "..", "src", "ranks.ts"), "utf8");
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
}).outputText;
const ranks = await import(`data:text/javascript;base64,${Buffer.from(output).toString("base64")}`);

test("XP rank titles advance at the approved long-term thresholds", () => {
  assert.equal(ranks.rankForXp(0).title, "Explorer");
  assert.equal(ranks.rankForXp(499).title, "Explorer");
  assert.equal(ranks.rankForXp(500).title, "Adventurer");
  assert.equal(ranks.rankForXp(1_500).title, "Trailblazer");
  assert.equal(ranks.rankForXp(3_500).title, "Pathfinder");
  assert.equal(ranks.rankForXp(7_500).title, "Voyager");
  assert.equal(ranks.rankForXp(15_000).title, "Vanguard");
  assert.equal(ranks.rankForXp(25_000).title, "Legend");
  assert.equal(ranks.rankForXp(50_000).nextRank, null);
});

test("XP rank progress reports the next title without going negative", () => {
  assert.equal(ranks.rankForXp(140).xpToNextRank, 360);
  assert.equal(ranks.rankForXp(2_375).nextRank.title, "Pathfinder");
  assert.equal(ranks.rankForXp(2_375).xpToNextRank, 1_125);
  assert.equal(ranks.rankForXp(-100).title, "Explorer");
});
