# M001 S03 — Offline routing evaluation and replay

**Status:** complete. See the [roadmap](M001-ROADMAP.md) for remaining slices and the [evaluation workflow](EVALUATION.md) for runnable commands and artifact contracts.

## Delivered

- Frozen version-1 synthetic corpus: 40 cases, split into 20 tuning and 20 public holdout cases, with explicit acceptable-choice sets.
- Separately authored answer fixtures, including suitable, unsuitable, forbidden, malformed and failed responses. The evaluator never chooses an answer from the labels.
- Credential-free replay through fresh real-core routers and an in-memory inventory/selector; no provider adapter, native session, execution dispatch or live mode.
- Independent fixture expectations for offered choices, request projection/instructions/criteria, exact pins/defaults, scope, effort, allowlist, input admission, initial unavailability, post-answer revocation, invocation gating and rejection codes.
- Separate suitability scoring with visible denominators and exclusions. Empty populations are unknown (`null` rate); correct rejection is a mechanical pass, not a good proposed answer.
- Strict bounded artifact validation, full case coverage, corpus/policy binding, answer-set and implementation fingerprints, and deterministic task/answer-free JSON reports.
- An offline CLI with explicit split/input/output arguments, no overwrite of existing files, and no implicit live execution or credential/config discovery.
- Package verification now exercises the compiled evaluator and checks all Markdown documentation links. Only named synthetic input fixtures and the CLI are added to package contents; private local experiments are ignored and not swept into the package.

## Evidence

`npm run verify` after the final implementation change passed **108 tests (98 existing + 10 new), 0 failures**, typechecking, JavaScript/declaration builds, package checks and compiled replay of all 40 cases. The subsequently strengthened scope/allowlist/image/revocation assertions also passed the complete 10-test evaluator suite.

A direct offline CLI run (`node --experimental-strip-types scripts/evaluate.mjs --split all`) produced:

| Population | Cases | Mechanical passes | Suitability accepted/scored | Unscored |
| --- | ---: | ---: | ---: | ---: |
| Tuning | 20 | 20 | 9 / 14 | 6 |
| Holdout | 20 | 20 | 10 / 14 | 6 |
| All | 40 | 40 | 19 / 28 | 12 |

There were 31 in-memory replay-selector invocations, **not network requests**. These deliberately imperfect fixture scores verify grading behavior; they do not establish model suitability, comparative quality or savings.

Reference provenance for that run:

- Corpus: `synthetic-routing-v1`, revision `1`.
- Corpus SHA-256: `f5a54d821c130bdc591d5035a0eb33fffc5666bccf26874ed77fb1e6008f5d0f`.
- Policy revision: `9240010641b5000c3b33570349bceac03d259c6d78dd83c803290a978d583fdd`.
- Answers SHA-256: `b4cb72e75bfea46f942583322a1634784038000db17e5baa9e25666422d994fa`.
- Selector provenance: `hand-authored-regression`, version `1`, origin `fixture`.
- Evaluator version: `1`; Node: `v24.13.0`.
- CLI implementation SHA-256: `01064c0078f7b64071be9c84df0bd7a391579eae05bf632855ffa78387160687`.

Tests verify deterministic/non-mutating reports; complete provenance and case matching; schema/byte bounds; wrong-outcome grading; malformed and unavailable recordings; pin/scope/allowlist/input/revocation behavior; correct split denominators; no task/raw-answer output; credential-free CLI operation; live-option rejection; and output no-clobber behavior.

## Boundaries and limitations

Normal receipts and native command/routing behavior are unchanged. Evaluation helpers are maintainer tooling, not a new root/core public package API. The CLI uses only explicit/default evaluation artifacts and its own source files for provenance. No dependencies, orchestration, permission changes, automatic fallback or live recorder were added.

The public holdout is not a blind benchmark, and its provisional labels are not calibrated model rankings. Image cases validate declared input support, not vision quality. Recorded errors are simulated immediately, not used to benchmark timeout/cancellation behavior. The corpus exercises the core answer contract; live streaming/protocol parsing remains covered by adapter tests, not this replay score.

Reports exclude raw task/answer data, but the explicitly supplied input artifacts can contain sensitive material. Keep private experiments outside the repository or in the ignored local directory. Hashes detect mismatch, not dishonest provenance or tampering. Ordinary receipts cannot reconstruct missing original inputs, and no session importer is provided.

Any future live capture requires separate approval of model/provider identities, data sharing, budget, sample count, deadlines and retention. This slice made no live calls, global install, publication, commit, delegation or pi-gsd runtime change.

**Next:** S04, explicit task continuity and bounded task briefs, preserving the current per-user-turn default and using versioned evaluation artifacts to assess changes.
