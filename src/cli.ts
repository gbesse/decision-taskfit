#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { auditDataset, evaluateCandidate, rankCandidates, type EvaluationOptions, type TaskCase, type TaskPrediction } from "./index.js";

const [command, casesPath, ...predictionPaths] = process.argv.slice(2);
if (command !== "analyze" || !casesPath || !predictionPaths.length) {
  console.error("Usage: decision-taskfit analyze <cases.json> <predictions.json>...");
  process.exit(1);
}
try {
  const input = JSON.parse(await readFile(casesPath, "utf8")) as { cases: TaskCase[]; options?: EvaluationOptions } | TaskCase[];
  const cases = Array.isArray(input) ? input : input.cases;
  const options = Array.isArray(input) ? {} : input.options ?? {};
  const reports = [];
  for (const path of predictionPaths) {
    const payload = JSON.parse(await readFile(path, "utf8")) as { candidate: string; predictions: TaskPrediction[] };
    reports.push(evaluateCandidate(payload.candidate, cases, payload.predictions, options));
  }
  console.log(JSON.stringify({ dataset: auditDataset(cases), ranking: rankCandidates(reports) }, null, 2));
  if (!reports.some(report => report.passed)) process.exitCode = 2;
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 2;
}
