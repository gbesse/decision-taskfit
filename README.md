# Decision TaskFit

Decision TaskFit answers the deployment question that generic leaderboards do
not: is this decision engine accurate, calibrated, fast and economical enough
for *this* task and its error costs?

It evaluates labelled holdouts without calling any model. Reports include
coverage, selective accuracy, macro F1, ECE, Brier score, expected loss,
latency, cost and consistency across perturbation variants. Dataset auditing
flags majority-label and answer-position shortcuts before they become a false
success signal.

```sh
npm install @gbesse/decision-taskfit
decision-taskfit analyze examples/cases.json examples/predictions.json
```

The input can encode an asymmetric loss matrix so a dangerous false allow is
not treated like a harmless routing mistake. CI exits with status `2` when no
candidate satisfies the declared deployment limits.

```ts
import { auditDataset, evaluateCandidate, rankCandidates } from "@gbesse/decision-taskfit";

const audit = auditDataset(cases);
const report = evaluateCandidate("local-q4", cases, predictions, {
  maxErrorRate: 0.01,
  maxEce: 0.05,
  maxP95Ms: 100,
  minCoverage: 0.98,
  lossMatrix: { dangerous: { allow: 100, deny: 0 } },
});
```

Decision TaskFit is an evaluator, not proof of safety. Holdouts must be
representative, independently reviewed and protected from training leakage.

MIT licensed. Independent of TypeSafe, OpenAI and model vendors.
