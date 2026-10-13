# M001 S06 — Interactive routing-policy advisor

## Delivered

- Replaced S06's measured-optimization emphasis with user-owned policy construction. Existing usage/latency diagnostics remain; caching, switch suppression and live evaluation are explicitly deferred.
- Bundled `skills/routing-policy-advisor/` through the Pi package manifest. It adapts Matt Pocock's grilling and domain-modeling: decision-tree frontier rounds, recommended answers phrased so yes accepts, factual discovery, active terminology checks, representative scenarios and a shared-understanding checkpoint. Sources and upstream MIT notice are included; installed originals are unchanged.
- Added `virtual_models_advisor` with read-only `inspect` and in-memory `propose`. Discovery uses public local-registry metadata, configured-auth booleans, limits/modalities and reported prices/unknowns; it is paginated and never resolves credentials, refreshes or probes providers, or runs selectors.
- Proposals replace one namespace's roles/criteria/scoped selector with explicit replacement intent. They preserve unrelated namespaces and all root settings, report semantic changes/full config, check schema/current registry/collisions, warn about thinking clamping and existing global-router exposure, and do not mutate the running router.
- Added `/vmodel advisor` help, `advisor discard`, and user-command-only `advisor apply <id>`. Apply confirms in interactive mode, rechecks session/branch/expiry/eligibility/exact file bytes, backs up existing bytes, and atomically replaces under a cooperative sibling lock. First creation is exclusive. No implicit reload, selection or execution.
- Missing-default onboarding is available without a policy. Invalid files and missing explicit paths still fail closed; injected SDK policies without a file path remain inspection-only.

## Verification

Fresh `npm run verify` after implementation passed:

- TypeScript typecheck.
- **182 tests**: 163 existing plus 19 advisor regressions.
- JavaScript and declaration build.
- Built exports and side-effect-free core dependency checks.
- Native Pi skill discovery with zero diagnostics, skill/source/reference/license package inclusion, local Markdown links and JSON examples.
- **40 built offline replay cases**, no mechanical failures.

Advisor coverage includes namespace merge/removal and root preservation; malformed/cross-namespace drafts; unknown prices, paging and credential-field exclusion; no-inference/no-write proposals; exact backups and single-use apply; stale files, current target revocation, interactive rejection, branch/session changes, expiry, bounded pending drafts, lock conflicts, first-run setup, missing explicit paths, read-only injection, LLM selector/clamping and cancellation. The existing missing-config command fixture was updated for newly registered advisor tools/lifecycle hooks.

## Optional research follow-up

The user-requested follow-up adds a skill-level, opt-in research branch after workload discovery. It uses existing host web capabilities for a bounded, sanitized comparison of benchmark evidence and practitioner reports, records source/version/setup limitations, handles skipped/unavailable research, and returns the shortlist to the interview before shared-understanding confirmation. The local advisor API, strict policy schema and command-only apply boundary are unchanged. Package checks cover the workflow's inclusion and required instruction sections; manual scenarios are supplied in [research.md](../skills/routing-policy-advisor/research.md). Those structural checks are not a live behavioral evaluation.

## Boundaries and limitations

No live inference, endpoint checks, savings measurement, live conversational evaluation, merge automation, child launches or new permissions ran. Registry prices are not actual billing and do not rank model quality. Mechanical tests cannot establish that a particular assistant conducts a good interview; a human smoke test remains recommended.

The conversation and its tool results enter the current assistant context and may incur normal billing. Runtime selector privacy is unchanged. Policies must not contain secrets. Root context/affinity/capacity changes are outside the namespace-only writer and require separate review.

This command-only approval path is not a sandbox against an agent with independent filesystem tools. Local parent directories must be trusted. Cooperative locks and byte checks cannot defeat hostile/non-cooperating local path or rename races. Backups/leftover crash locks require operator-managed recovery; see [advisor guide](ADVISOR.md).

S07 integrated lifecycle/collision acceptance remains pending. npm publication remains disabled. No commit or push is part of this slice execution.
