# Advisor policy reference

## Tool contract

`virtual_models_advisor` has two actions:

- `inspect`: optional `provider`, `offset` (default 0), `availableOnly` (default true). Returns at most 50 physical chat/classifier records, provider counts, next offset, current disk configuration and loaded/disk revisions. It does not refresh or authenticate. Use `availableOnly: false` to see registered but unconfigured models.
- `propose`: `draft` contains `namespace`, optional `replace`, `models`, `criteria`, and a complete `selector`. Returns full proposed config, changed entries, warnings and an ephemeral proposal ID. It cannot apply. Injected SDK policies without a file path are inspection-only.

Example shape only: replace every placeholder with exact IDs discovered by inspection. No wildcard providers/models or model aliases.

```json
{
  "action": "propose",
  "draft": {
    "namespace": "pr",
    "models": {
      "pr/review": {
        "defaultEffort": "low",
        "efforts": {
          "low": { "provider": "observed-provider", "model": "observed-chat-id", "thinking": "off" }
        },
        "instructions": "Review evidence and report findings. Do not merge."
      }
    },
    "criteria": {
      "pr/review:low": "Bounded low-consequence review with sufficient evidence; not merely a short diff."
    },
    "selector": {
      "kind": "classifier",
      "provider": "observed-provider",
      "model": "observed-classifier-id"
    }
  }
}
```

A chat selector instead requires `kind: "llm"`, physical `provider`/`model`, and `thinking`; optional `maxTokens` is 128–8192. Both selectors accept optional `timeoutMs` 1–120000. Never treat a classifier as an execution model.

## Schema boundaries

- Namespace/role components start with a lowercase letter, contain lowercase letters/digits/hyphens, and are at most 48 characters. `auto` is reserved for the automatic role.
- 1–64 total roles. Configure only necessary `low`, `medium`, `high` variants, with `defaultEffort` naming one configured variant. Every variant needs exactly one nonempty criterion, at most 4096 characters, without control characters.
- Targets separate `provider`, `model`, and `thinking`. Physical model IDs may include slashes and colons. Thinking is `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, or `max`; the host may clamp it.
- Role instructions are soft execution guidance, up to 4096 characters; they are not selector instructions, hard criteria, or permission enforcement.
- Namespace proposals can modify only that namespace's roles, variant criteria and complete selector override. `replace: true` removes omitted roles and criteria within that namespace; all unrelated configuration is preserved semantically.
- Root `questions.route.instructions` and `__abstain__`, `selector`, `autoModel`, `nativeRouting` (context, affinity, capacity), `routingContext`, and `direct` remain unchanged. There are no namespace-specific versions of these root settings. A new first policy gets conservative route instructions/abstention, `autoModel: false`, and no opt-in history or affinity.
- Existing global automatic routing sees all roles, including additions. Scoped `namespace/auto` sees only its namespace. Explicit `namespace/role:effort` bypasses the selector. Missing candidates, abstention and invalid answers fail closed; no fallback.
- Command spelling uses `pr/review:low`; native model-picker spelling is `pr/review/low`.

## Research evidence stays outside the policy

The optional [task-fit research workflow](research.md) uses host web tools after explicit consent, not an added advisor action. Keep sources, benchmark details and anecdote labels in the conversation/proposal explanation. Research informs user-approved mappings but cannot add models missing from the local registry, relax constraints, introduce evidence fields to the strict schema, or authorize paid evaluation or apply.

## Verification and consent

Propose/apply check schema, configured auth, physical text target/selector presence, current registration collisions, and thinking clamping. They do not test semantic criteria, endpoint health, image requirements for a particular task, final context capacity, permissions, or real costs. Choose suitable modalities/limits from inventory; runtime admission remains separate.

The user applies with `/vmodel advisor apply <proposalId>`, then reloads and selects manually. A stale file (including formatting-only edits), expired/consumed draft, lost branch anchor or unavailable target prevents apply. Drafts do not survive reload or restart. Local directory trust and cooperative-writer limitations are documented in the package's advisor guide.
