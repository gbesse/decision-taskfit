import test from "node:test";
import assert from "node:assert/strict";
import { auditDataset, evaluateCandidate, rankCandidates, type TaskCase } from "../src/index.js";

const cases: TaskCase[] = [
  { id: "a", expected: "allow", answerPosition: 0 },
  { id: "b", expected: "deny", answerPosition: 1 },
  { id: "a-variant", variantOf: "a", expected: "allow", answerPosition: 1 },
];

test("audits majority and answer-position shortcuts", () => {
  const audit = auditDataset(cases);
  assert.equal(audit.majorityBaselineAccuracy, .6667);
  assert.equal(audit.positionBaselineAccuracy, .6667);
  assert.equal(audit.warnings.length, 2);
});

test("evaluates accuracy, calibration, loss and variant consistency", () => {
  const report = evaluateCandidate("small-local", cases, [
    { id: "a", label: "allow", probabilities: { allow: .9, deny: .1 }, latencyMs: 5, costUsd: 0 },
    { id: "b", label: "deny", probabilities: { allow: .2, deny: .8 }, latencyMs: 7, costUsd: 0 },
    { id: "a-variant", label: "allow", probabilities: { allow: .7, deny: .3 }, latencyMs: 6, costUsd: 0 },
  ], { maxErrorRate: 0, maxEce: .25, maxP95Ms: 10 });
  assert.equal(report.passed, true);
  assert.equal(report.accuracy, 1);
  assert.equal(report.variantConsistency, 1);
  assert.equal(report.latency?.p95Ms, 7);
});

test("ranks passing low-loss candidates first", () => {
  const good = evaluateCandidate("good", cases, cases.map(item => ({ id: item.id, label: item.expected })), { maxErrorRate: 0 });
  const bad = evaluateCandidate("bad", cases, cases.map(item => ({ id: item.id, label: item.expected === "allow" ? "deny" : "allow" })), { maxErrorRate: 0 });
  assert.equal(rankCandidates([bad, good])[0]?.candidate, "good");
  assert.equal(bad.passed, false);
});
