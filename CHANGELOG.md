# Changelog

## Unreleased

### Routing-policy advisor

- Bundle a portable `routing-policy-advisor` skill adapted from Matt Pocock's grilling and domain-modeling, with source attribution and retained MIT notice.
- Add paginated, credential-free local model/pricing discovery and schema/registry-validated single-namespace proposals.
- Add opt-in task-fit research through host web tools: bounded benchmark/practitioner comparisons, source/version/setup caveats, sanitized queries, explicit skip/unavailable paths, and separate consent for paid model testing.
- Add explicit user-command apply, stale-file/session/branch checks, exact backups and atomic replacement; never hot-reload, switch models or run inference from advisor support operations.
- Fix overflowing advisor apply dialogs: review the complete proposal in a scrollable editor, then approve a compact confirmation; cancellation or review edits never write the policy.
- Remove advisor proposal timeouts, including during review; retain bounded pending drafts and apply-time validation, and distinguish unavailable, applied, discarded, wrong-session and wrong-branch IDs. Reload/reset still loses in-memory drafts.
- Replace M001 S06's savings/optimization emphasis with user-owned routing-policy construction; caching and live evaluation remain deferred. See [advisor guide](docs/ADVISOR.md).

### Audit follow-up

- Start coordinator decision TTLs after preparation completes, expire at the deadline, and distinguish the 32-handle cap (`INVALID_STATE`) from non-expiring advisor drafts.
- Keep the latest ten advisor recovery backups after successful writes; preserve the new backup and unrelated files, and report best-effort cleanup failures without masking a successful apply.
- Add regression coverage for TTL boundaries/cap recovery, semantic review edits, confirmation-time discard/apply/file changes, backup retention/failure handling, auth-filter defaults and strict direct-image capacity admission.

### Repository and licensing

- Establish the public `radioflyer28/pi-virtual-models` repository under Apache 2.0.
- Keep npm publication disabled; add repository metadata and exclude local credentials/configuration from Git.

### Development and compatibility

- Upgrade pinned Pi development packages from 1.0.1 to 1.2.0; keep host-supplied runtime peers optional and unbundled.
- Add focused host-interoperability regressions and `npm run test:compat`, including a guard against testing the wrong installed host versions.
- Cover extension-triggered custom runs, busy startup and abort settlement, other extensions' prompt/setup messages through tools, non-accumulating role guidance and selector privacy.
- Cover changing catalog availability before/after selection, affinity-pin revocation, current context/output limits and deliberate reselection, using local fake providers rather than live OpenRouter calls.
- Check that compaction omits assistant thinking while preserving visible evidence and the chosen physical assignment.
- Document Pi 1.2.0 compatibility, catalog refresh boundaries, Azure provider migration, schema/tool metadata applicability and unverified integration scope in [the compatibility guide](docs/COMPATIBILITY.md).

No routing-policy or production runtime change was needed for this host upgrade. Live routing quality, virtual child launches and full M001 S07 acceptance remain separate work.
