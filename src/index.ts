export interface TaskCase {
  id: string;
  expected: string;
  weight?: number;
  group?: string;
  variantOf?: string;
  answerPosition?: number;
}

export interface TaskPrediction {
  id: string;
  label?: string;
  probabilities?: Record<string, number>;
  abstained?: boolean;
  latencyMs?: number;
  costUsd?: number;
}

export interface LossMatrix { [expected: string]: Record<string, number>; }

export interface EvaluationOptions {
  lossMatrix?: LossMatrix;
  abstentionCost?: number;
  maxErrorRate?: number;
  maxEce?: number;
  maxP95Ms?: number;
  maxMeanCostUsd?: number;
  minCoverage?: number;
}

export interface DatasetAudit {
  cases: number;
  labels: Record<string, number>;
  majorityLabel: string;
  majorityBaselineAccuracy: number;
  positionBaselineAccuracy: number | null;
  duplicateIds: string[];
  warnings: string[];
}

export interface TaskFitReport {
  candidate: string;
  cases: number;
  coverage: number;
  accuracy: number;
  selectiveAccuracy: number | null;
  macroF1: number;
  ece: number | null;
  brier: number | null;
  expectedLoss: number;
  latency: { meanMs: number; p95Ms: number } | null;
  meanCostUsd: number | null;
  variantConsistency: number | null;
  passed: boolean;
  failures: string[];
  warnings: string[];
}

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
function round(value: number): number { return Math.round(value * 10000) / 10000; }
function weightedMean(values: { value: number; weight: number }[]): number { const total = values.reduce((sum, item) => sum + item.weight, 0); return total ? values.reduce((sum, item) => sum + item.value * item.weight, 0) / total : 0; }
function percentile(values: number[], fraction: number): number { const sorted = [...values].sort((a, b) => a - b); return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1))]!; }

export function auditDataset(cases: TaskCase[]): DatasetAudit {
  assert(cases.length > 0, "Dataset cannot be empty");
  const counts = new Map<string, number>();
  const ids = new Set<string>();
  const duplicateIds: string[] = [];
  for (const item of cases) {
    assert(item.id?.trim(), "Every case needs an id");
    assert(item.expected?.trim(), `${item.id}: expected label is required`);
    if (ids.has(item.id)) duplicateIds.push(item.id); else ids.add(item.id);
    counts.set(item.expected, (counts.get(item.expected) ?? 0) + 1);
  }
  const labels = Object.fromEntries([...counts.entries()].sort(([a], [b]) => a.localeCompare(b)));
  const [majorityLabel, majorityCount] = [...counts.entries()].sort(([labelA, countA], [labelB, countB]) => countB - countA || labelA.localeCompare(labelB))[0]!;
  const positioned = cases.filter(item => item.answerPosition !== undefined);
  let positionBaselineAccuracy: number | null = null;
  if (positioned.length === cases.length) {
    const positions = new Map<number, number>();
    for (const item of positioned) positions.set(item.answerPosition!, (positions.get(item.answerPosition!) ?? 0) + 1);
    positionBaselineAccuracy = Math.max(...positions.values()) / cases.length;
  }
  const warnings: string[] = [];
  if (duplicateIds.length) warnings.push(`${duplicateIds.length} duplicate case id(s)`);
  if (majorityCount / cases.length >= .5) warnings.push("majority-label baseline reaches at least 50%; stratify or rebalance the holdout");
  if (positionBaselineAccuracy !== null && positionBaselineAccuracy >= .4) warnings.push("answer-position baseline reaches at least 40%; randomize option order");
  return { cases: cases.length, labels, majorityLabel, majorityBaselineAccuracy: round(majorityCount / cases.length), positionBaselineAccuracy: positionBaselineAccuracy === null ? null : round(positionBaselineAccuracy), duplicateIds, warnings };
}

function validateProbabilities(prediction: TaskPrediction, labels: string[]): void {
  if (!prediction.probabilities) return;
  const values = labels.map(label => prediction.probabilities![label] ?? 0);
  assert(Object.values(prediction.probabilities).every(value => Number.isFinite(value) && value >= 0 && value <= 1), `${prediction.id}: invalid probability`);
  assert(Math.abs(values.reduce((sum, value) => sum + value, 0) - 1) <= .001, `${prediction.id}: probabilities must sum to one across dataset labels`);
}

export function evaluateCandidate(candidate: string, cases: TaskCase[], predictions: TaskPrediction[], options: EvaluationOptions = {}): TaskFitReport {
  const audit = auditDataset(cases);
  assert(!audit.duplicateIds.length, "Dataset case IDs must be unique");
  const byId = new Map(predictions.map(prediction => [prediction.id, prediction]));
  assert(byId.size === predictions.length, "Prediction IDs must be unique");
  const labels = Object.keys(audit.labels);
  const confusion = new Map<string, Map<string, number>>();
  const correctness: { value: number; weight: number }[] = [];
  const losses: { value: number; weight: number }[] = [];
  const confidences: { confidence: number; correct: number; weight: number }[] = [];
  const briers: { value: number; weight: number }[] = [];
  const answered: { item: TaskCase; prediction: TaskPrediction }[] = [];
  const warnings = [...audit.warnings];
  for (const item of cases) {
    const prediction = byId.get(item.id);
    assert(prediction, `Missing prediction: ${item.id}`);
    const weight = item.weight ?? 1;
    assert(Number.isFinite(weight) && weight > 0, `${item.id}: weight must be positive`);
    validateProbabilities(prediction, labels);
    const abstained = prediction.abstained === true || !prediction.label;
    const correct = !abstained && prediction.label === item.expected;
    correctness.push({ value: correct ? 1 : 0, weight });
    if (abstained) losses.push({ value: options.abstentionCost ?? 1, weight });
    else losses.push({ value: options.lossMatrix?.[item.expected]?.[prediction.label!] ?? (correct ? 0 : 1), weight });
    if (!abstained) {
      answered.push({ item, prediction });
      const row = confusion.get(item.expected) ?? new Map<string, number>();
      row.set(prediction.label!, (row.get(prediction.label!) ?? 0) + weight);
      confusion.set(item.expected, row);
    } else {
      const row = confusion.get(item.expected) ?? new Map<string, number>();
      row.set("__abstain__", (row.get("__abstain__") ?? 0) + weight);
      confusion.set(item.expected, row);
    }
    if (prediction.probabilities) {
      const chosen = prediction.label ?? Object.entries(prediction.probabilities).sort((a, b) => b[1] - a[1])[0]![0];
      confidences.push({ confidence: prediction.probabilities[chosen] ?? 0, correct: correct ? 1 : 0, weight });
      briers.push({ value: labels.reduce((sum, label) => sum + ((prediction.probabilities![label] ?? 0) - (label === item.expected ? 1 : 0)) ** 2, 0) / labels.length, weight });
    }
  }
  for (const prediction of predictions) if (!cases.some(item => item.id === prediction.id)) warnings.push(`unused prediction: ${prediction.id}`);
  const totalWeight = cases.reduce((sum, item) => sum + (item.weight ?? 1), 0);
  const answeredWeight = answered.reduce((sum, pair) => sum + (pair.item.weight ?? 1), 0);
  const coverage = answeredWeight / totalWeight;
  const accuracy = weightedMean(correctness);
  const selectiveAccuracy = answeredWeight ? answered.reduce((sum, pair) => sum + (pair.prediction.label === pair.item.expected ? pair.item.weight ?? 1 : 0), 0) / answeredWeight : null;
  const f1s = labels.map(label => {
    const tp = confusion.get(label)?.get(label) ?? 0;
    const fp = [...confusion.entries()].filter(([expected]) => expected !== label).reduce((sum, [, row]) => sum + (row.get(label) ?? 0), 0);
    const fn = [...(confusion.get(label)?.entries() ?? [])].filter(([predicted]) => predicted !== label).reduce((sum, [, count]) => sum + count, 0);
    return 2 * tp + fp + fn ? 2 * tp / (2 * tp + fp + fn) : 0;
  });
  let ece: number | null = null;
  if (confidences.length) {
    const bins = Array.from({ length: 10 }, () => ({ confidence: 0, correct: 0, weight: 0 }));
    for (const point of confidences) { const bin = bins[Math.min(9, Math.floor(point.confidence * 10))]!; bin.confidence += point.confidence * point.weight; bin.correct += point.correct * point.weight; bin.weight += point.weight; }
    ece = bins.reduce((sum, bin) => bin.weight ? sum + (bin.weight / totalWeight) * Math.abs(bin.correct / bin.weight - bin.confidence / bin.weight) : sum, 0);
  }
  const latencyValues = predictions.flatMap(prediction => prediction.latencyMs === undefined ? [] : [prediction.latencyMs]);
  const costValues = predictions.flatMap(prediction => prediction.costUsd === undefined ? [] : [prediction.costUsd]);
  const variantPairs = cases.flatMap(item => item.variantOf ? [{ original: byId.get(item.variantOf), variant: byId.get(item.id) }] : []).filter(pair => pair.original && pair.variant && !pair.original.abstained && !pair.variant.abstained);
  const variantConsistency = variantPairs.length ? variantPairs.filter(pair => pair.original!.label === pair.variant!.label).length / variantPairs.length : null;
  const failures: string[] = [];
  if (1 - accuracy > (options.maxErrorRate ?? 1)) failures.push(`error rate ${round(1 - accuracy)} exceeds ${options.maxErrorRate}`);
  if (ece !== null && options.maxEce !== undefined && ece > options.maxEce) failures.push(`ECE ${round(ece)} exceeds ${options.maxEce}`);
  if (latencyValues.length && options.maxP95Ms !== undefined && percentile(latencyValues, .95) > options.maxP95Ms) failures.push(`p95 latency exceeds ${options.maxP95Ms}ms`);
  if (costValues.length && options.maxMeanCostUsd !== undefined && costValues.reduce((a, b) => a + b, 0) / costValues.length > options.maxMeanCostUsd) failures.push(`mean cost exceeds ${options.maxMeanCostUsd} USD`);
  if (coverage < (options.minCoverage ?? 0)) failures.push(`coverage ${round(coverage)} is below ${options.minCoverage}`);
  return {
    candidate, cases: cases.length, coverage: round(coverage), accuracy: round(accuracy), selectiveAccuracy: selectiveAccuracy === null ? null : round(selectiveAccuracy),
    macroF1: round(f1s.reduce((a, b) => a + b, 0) / f1s.length), ece: ece === null ? null : round(ece), brier: briers.length ? round(weightedMean(briers)) : null,
    expectedLoss: round(weightedMean(losses)), latency: latencyValues.length ? { meanMs: round(latencyValues.reduce((a, b) => a + b, 0) / latencyValues.length), p95Ms: round(percentile(latencyValues, .95)) } : null,
    meanCostUsd: costValues.length ? round(costValues.reduce((a, b) => a + b, 0) / costValues.length) : null, variantConsistency: variantConsistency === null ? null : round(variantConsistency),
    passed: failures.length === 0, failures, warnings,
  };
}

export function rankCandidates(reports: TaskFitReport[]): TaskFitReport[] {
  return [...reports].sort((a, b) => Number(b.passed) - Number(a.passed) || a.expectedLoss - b.expectedLoss || b.accuracy - a.accuracy || (a.latency?.p95Ms ?? Infinity) - (b.latency?.p95Ms ?? Infinity) || a.candidate.localeCompare(b.candidate));
}
