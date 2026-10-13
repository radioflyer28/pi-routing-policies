# Offline routing evaluation and replay

This workflow is for maintainers checking routing mechanics or scoring **already supplied answers**. It does not run a classifier, chat provider or execution model. It does not read Pi credentials, configuration or sessions. No live execution flag exists.

## Run the frozen baseline

Requires Node.js 24+ from this checkout:

```sh
npm run evaluate
npm run evaluate -- --split tuning
npm run evaluate -- --split all
```

The default is **holdout**. The bundled corpus has 40 synthetic cases: 20 tuning and 20 holdout. Its answers are hand-authored regression fixtures, including deliberate unsuitable, malformed and forbidden proposals. A high fixture score would not demonstrate model quality.

For machine-readable stdout without npm's script banner:

```sh
node --experimental-strip-types scripts/evaluate.mjs --split holdout
```

To write an artifact, supply `--out NEW_FILE`. The parent directory must exist; an existing file is never overwritten. Keep private experiments outside the repository or under the ignored `evaluation/local/` directory. Only the two named synthetic fixtures are included in package contents, not arbitrary local recordings.

```sh
npm run evaluate -- --corpus path/to/corpus.json --answers path/to/answers.json --split holdout --out path/to/new-report.json
```

Exit codes:

- **0:** all selected mechanical checks passed. Suitability may still have misses.
- **1:** a mechanical expectation differs from actual router behavior.
- **2:** invalid arguments/artifacts, mismatched provenance, missing data or output failure.

## Interpret the report correctly

**Mechanical compliance** compares the real core router with a separately computed fixture oracle. It checks offered choices, request state/instructions/criteria, exact explicit/default pins, namespace/effort/allowlist/input restrictions, initial availability, post-answer revocation, expected rejection codes, target identity, and whether the replay selector should have been invoked. A forbidden proposal rejected as `INVALID_ANSWER` is a mechanical **pass**, not evidence that the proposed answer was good.

**Suitability** asks whether a recorded returned proposal is in the case's acceptable-choice set. Multiple choices and `__abstain__` can be acceptable. A malformed or unoffered returned answer is a miss. A valid proposal later revoked remains scored against its initial labels: suitability of a proposal is not proof of successful assignment or execution.

Explicit routes, cases with no initially eligible candidates, and recorded selector failures are **unscored** for suitability. Reports expose accepted/rejected/scored/unscored counts and per-case exclusions; an empty scoring population has rate `null`, not zero or a perfect score. Tuning and holdout summaries remain separate even with `--split all`. Always examine coverage and failures alongside rates.

`replayedSelectorInvocations` counts calls to the in-memory answer replay, not HTTP requests. Recorded timeouts/cancellations/errors are simulated immediately; they do not measure deadlines or endpoint behavior. No latency, tokens, costs, savings, execution success or comparative live-model quality is inferred.

## Artifact contracts

The version-1 corpus is [corpus-v1.json](../evaluation/corpus-v1.json). It contains:

- `id`, `revision`, and the exact policy configuration.
- A synthetic inventory keyed by `provider/model`, with supported `inputs`. Omitted targets are unavailable. Nothing contacts these identities.
- Cases with stable `id`, `split`, `tags`, text `task`, `selection`, optional core `constraints`, and `acceptableChoices`.
- Optional `unavailable` physical target IDs and `revoked` IDs. Revocation occurs after the in-memory selector returns and before core acceptance. Explicit cases do not model that phase.

Case state is projected as `{ task, taskTruncated: false, hasImages }`; `hasImages` comes only from declared required inputs. Image cases test **input admission metadata**, not visual understanding. No image bytes are supplied. Tasks are at most 3000 characters and their JSON state must fit the core's 16 KiB limit. The format supports 1–100 cases; the shipped baseline is fixed at 40.

The separate [answers-fixture-v1.json](../evaluation/answers-fixture-v1.json) contains:

- `version: 1`, the canonical `corpusHash`, and core `policyRevision`.
- `selector: { id, version, origin }`, with origin `fixture` or `recorded`. These are declarative provenance, not an authenticated provider identity.
- Exactly one record per corpus case, identified by `caseId`, even when running only one split. Missing, duplicate and unknown IDs are rejected rather than silently shrinking the denominator.

An answer response uses the **core's normalized answer envelope**, not an LLM prompt or raw completion wrapper:

```json
{
  "caseId": "t01",
  "response": {
    "kind": "answer",
    "answer": { "answers": { "route": { "type": "choice", "choice": "wiki/edit:low" } } }
  }
}
```

A recorded failure uses an explicit code:

```json
{
  "caseId": "t20",
  "response": { "kind": "error", "code": "SELECTOR_TIMEOUT" }
}
```

Supported failure codes are `SELECTOR_ERROR`, `SELECTOR_TIMEOUT`, `SELECTOR_UNAVAILABLE` and `ABORTED`. These describe a recorded selector invocation failure; they do not model missing selector configuration before invocation. Responses for explicit/no-candidate cases are retained for complete coverage but never consumed by the replay selector.

Input files are capped at 1 MiB, answer values at 64 KiB, with additional bounded JSON depth/node counts. Structural fields are validated strictly. Answer bodies deliberately permit malformed bounded JSON so rejection behavior can be tested. This is not a native LLM streaming/parser benchmark; those adapters retain their separate tests.

## Provenance, freezing and reproducibility

The canonical SHA-256 corpus hash includes policy, task inputs, inventory, labels, splits and case order. Answer sets bind that hash and the parsed policy revision. Changing any of those requires a newly bound answer set. Reports include corpus identity/revision/hash, policy revision, answer-set hash, selector identity/version/origin, evaluator version and the requested split.

The CLI also fingerprints its own implementation, the evaluator and core TypeScript sources, and records the Node version. Preserve that checkout/runtime alongside artifacts for exact reproduction. These hashes detect accidental mismatch; they are not signatures and do not prove where answers came from.

Reports are deterministic for the same implementation/runtime and inputs. They exclude timestamps, authority IDs, transient receipt timings, task text, raw answers and policy prose. Tasks/raw answers remain in the explicitly supplied input artifacts. Ordinary S01 receipts are unchanged and are **insufficient to replay**: they intentionally omit those inputs. No recorder or session importer is added.

Do not edit the frozen v1 fixtures to improve scores. Create a new corpus revision/file, preserve its predecessor, recalculate its content hash using the evaluator's `artifactHash(parseCorpus(input))` helper and obtain separately versioned answers. The helper is maintainer tooling, not a new root/core public package API. Tests pin the shipped content hash and expected scoring arithmetic.

The holdout split is public, human-authored regression data. Its labels are provisional role/effort judgments, not calibrated capability rankings. Do not tune on holdout outcomes and then claim independent validation. A credible comparative live study needs a fresh, separately controlled holdout, enough cases and task-outcome verification.

## Live evaluation remains separate

This runner rejects `--live` and never obtains answers itself. A future live capture workflow requires explicit operator approval of providers/models, permitted task data, sample count, cost limits, timeouts and output retention **before** any calls. It must record the exact request/policy and model/adapter versions, preserve failures and unknown usage, keep tuning/holdout separate, and label proposals versus actual execution. Such a capture workflow is not implemented or authorized by S03.

Once explicitly approved answers exist, replay can score a complete `origin: "recorded"` artifact without making further provider calls. Provenance still depends on the capture process; changing the origin string does not turn fixture results into measured model quality.
