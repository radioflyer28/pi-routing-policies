# Sources and adaptation

This self-contained skill adapts **grilling** and **domain-modeling** by Matt Pocock, from [mattpocock/skills](https://github.com/mattpocock/skills), under the [MIT license](LICENSE). Source snapshot: `95249b0b49782349740fd9b8c6ce32b4e59e497a`.

- [Grilling source](https://github.com/mattpocock/skills/blob/95249b0b49782349740fd9b8c6ce32b4e59e497a/skills/productivity/grilling/SKILL.md): decision tree, dependency-frontier rounds, recommended answers, wording so yes accepts the recommendation, factual investigation, and shared-understanding confirmation.
- [Domain-modeling source](https://github.com/mattpocock/skills/blob/95249b0b49782349740fd9b8c6ce32b4e59e497a/skills/engineering/domain-modeling/SKILL.md): active terminology challenges, concrete edge cases, checking definitions against code, immediate recording of settled terms, and sparing use of ADRs.

The local domain-modeling variant consulted used `CONTEXT.md`; upstream now uses `GLOSSARY.md`. The advisor recognizes existing conventions without requiring either. Original installed skills remain untouched.

Adaptations: constrain the interview to routing policy; respect host question limits; investigate directly unless delegation is separately authorized; keep new terminology in the conversation unless durable files are requested; replace autonomous edits with bounded proposals and explicit user-command approval. No dependency on an external skills checkout, GSD, or a particular question tool is required. The source license below is retained for derived skill material; repository code remains Apache-2.0.
