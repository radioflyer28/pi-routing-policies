# Changelog

## Unreleased

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
