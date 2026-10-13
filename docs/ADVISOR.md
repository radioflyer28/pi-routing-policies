# Interactive routing-policy advisor

Install the package with `pi install .` (or its Git source), then `/reload`. Start `/skill:routing-policy-advisor`; `/vmodel advisor` shows entry-point help without inference. Loading only `-e ./src/extension.ts` loads the tools/commands, not the bundled skill; also load the skill explicitly or install the whole package.

The advisor works before a default policy exists and later when adding/replacing namespaces. A missing explicit `PI_VIRTUAL_MODELS_CONFIG` or invalid existing policy still fails loading rather than silently replacing it. Original installed grilling/domain-modeling skills are untouched. The bundled [skill](../skills/routing-policy-advisor/SKILL.md) and [source attribution](../skills/routing-policy-advisor/SOURCES.md) are portable.

## Conversation, not a static wizard

The skill adapts grilling's decision tree and dependency-frontier rounds: investigate facts itself, ask only currently answerable decisions, recommend an answer, phrase questions so yes accepts that recommendation, and wait. Domain-modeling adds precise vocabulary and edge-case challenges. Before drafting it summarizes the agreed decisions and asks for shared-understanding confirmation.

For a PR namespace it separates findings, approval recommendations and merge authorization. It explores evidence scope, consequence, privacy/provider limits, input/capacity requirements, cost/latency preference, selector and execution targets, and representative abstention cases. A short diff need not be low risk. Prices do not prove quality. No universal savings evidence is required; the user owns policy trade-offs.

The assistant conversation is normal inference and may be billed. Its local support tools never call inference. Inventory and existing policy returned by the tool enter the assistant conversation; do not put secrets in role guidance. Runtime selector privacy is unchanged.

## Optional benchmark and practitioner research

After understanding the workload and constraints, the advisor offers an opt-in research branch before settling model mappings. It uses the host's available web tools, not a network feature of `virtual_models_advisor`. No additional integration, dependency or credential is installed. The default bounded pass covers 2–4 eligible candidates, at most two search rounds and six opened sources; expansion needs agreement.

The advisor looks for task-relevant benchmarks, methodology, model documentation and practitioner failure reports. Findings include source links, dates, model/version identity, evaluation setup and task applicability. Independent measurements, vendor self-reports, anecdotes and the advisor's own inference remain distinct. Conflicting or stale evidence stays visible; popularity and a general leaderboard position do not establish fitness for your task. Exact-version gaps and proxy metrics are disclosed, and weak evidence yields provisional recommendations or no winner.

Before browsing, it agrees a sanitized query scope using public model identities and generic task characteristics. Private code, diffs, repository identifiers, policy text, auth status and full inventories remain out of external queries/uploads. Retrieved content is evidence, not instructions. Browsing consent does not authorize model trials, paid selector preview, private-site login, delegation or configuration changes. The assistant/search service may consume normal tokens or credits; research is not promised to be free.

You can skip research. If web access is unavailable or evidence is insufficient, the advisor says so and offers local-only provisional choices or deferral, rather than inventing current findings. It brings the shortlist back into the interview, resolves your trade-offs and reconfirms shared understanding before proposing. Evidence remains in the conversation, not new policy fields or injected runtime selector excerpts. See the bundled [research workflow and manual behavior scenarios](../skills/routing-policy-advisor/research.md).

## Local discovery and proposals

`virtual_models_advisor` exposes only `inspect` and `propose`:

- Inspect reads a bounded policy file and Pi's existing chat/classifier registry. It returns allowlisted identities, input types, context/output limits, effective thinking levels, configured-auth booleans, and registry-reported USD-per-million-token prices. Unknowns are null; zero remains reported zero, not a free-usage promise. Auth presence is not an endpoint health check. It never retrieves keys/headers, reads credential files, refreshes the catalog or sends task data to selectors. Model results are paged in groups of 50; filters include provider and configured-auth presence.
- Propose replaces exactly one namespace's roles/criteria/scoped selector, validates the entire merged schema and current proposed target/selector eligibility, and reports a semantic diff plus full proposed config. Replacing an existing namespace requires explicit `replace: true`. Omitted roles/criteria in that namespace are removed. Unrelated settings are retained, though applying normalizes JSON formatting/key order.
- Root routing instructions/abstention, root selector, global auto, context/affinity/capacity, direct target and routingContext are not edited. A first policy disables global auto and creates only the selected scoped route, with conservative root instructions/abstention and no history opt-in. An existing global router also sees added variants; this is called out in proposal warnings.
- Injected SDK configurations without a file path are inspection-only. Existing disk and loaded revisions are reported separately; apply does not hot-swap the running router.

See [draft shape and precise schema boundaries](../skills/routing-policy-advisor/policy-reference.md). Checks establish mechanical validity, not semantic quality, endpoint availability, actual billing, per-task modality/capacity fitness or workflow authorization.

## Explicit application

The model cannot apply through the advisor tool. Review the complete proposal and run:

```text
/vmodel advisor apply <proposalId>
/reload
/vmodel doctor
/vmodel pr/auto
```

Interactive apply opens the complete proposal (destination, semantic changes and full config) in Pi's scrollable review editor, then shows a compact Yes/No confirmation. Use the editor navigation keys to inspect the report and Enter to continue; Escape cancels either step without writing or consuming the draft. This is review only: changing the text cancels apply rather than silently changing the validated proposal. Request a new proposal for edits. Keeping JSON out of the non-scrolling confirmation title leaves the approval controls visible even for large policies. Headless invocation of the exact command is explicit approval; commands are not model tool actions. The skill must not bypass this gate through generic shell/edit tools. This is a workflow boundary, not a sandbox against an agent already authorized to edit files by other means.

Apply rechecks the current session/branch, physical/selector eligibility, and exact original file bytes. It fails on stale edits, including whitespace changes. Drafts have **no time limit**, including while reviewing or confirming. They are in memory, bounded to eight pending drafts, single-use after success, and lost on reload, restart or session reset. Apply a draft or use `/vmodel advisor discard` to free pending slots; waiting does not free them. Forking away from a proposal's anchor invalidates it on that branch.

Diagnostics distinguish another session, another branch, already applied, explicitly discarded, and unavailable IDs. The last 32 applied/discarded IDs retain only their terminal reason, not proposal contents; older IDs and IDs lost on reload/reset are reported as unavailable, never as timed out. An unavailable ID can also be a typo or belong to a different extension instance, so the message does not claim a specific cause. Reinspect/repropose when state was lost or the file/catalog changed; no automatic write retries. Reload persistence is not implemented.

The writer uses an exclusive sibling `.advisor.lock`, a private same-directory temporary file, and an atomic replacement. Existing files receive an exact-byte `.advisor-<uuid>.bak` backup; first creation is exclusive. Parent directories must already exist. A leftover lock after a process crash is not automatically removed: verify no apply is running before deleting it. After successful replacement, retention keeps the just-created backup plus the nine most recently modified prior backups for that policy (filename breaks modification-time ties). Only UUID-named regular `.bak` files participate; unrelated files, directories and symlinks are ignored. Failed applies never prune backups. Cleanup failures produce a warning without undoing a successful apply, so more than ten backups can remain until a later successful cleanup. Copy any backup you want to retain permanently outside this naming pattern. Restoring a backup is a separate user-approved operation. No credentials are written, but policy backups can contain private role guidance.

The final path must be a regular non-symlink file. Parent directories are operator-controlled. Locks coordinate this advisor's writers; byte checks are not an OS compare-and-swap and cannot prevent a hostile/local non-cooperating writer racing the final rename or replacing path components. Mode 0600 is requested where supported; Windows ACLs remain the operator's responsibility. No durability guarantee is made across power loss.

Applying does not reload, select a model, start work, run selectors, or grant permissions. Paid preview remains a separate, explicit `/vmodel preview --allow-inference ...` operation. Registry/SDK tests do not establish the conversational quality of a live model interview; a human smoke test remains recommended.
