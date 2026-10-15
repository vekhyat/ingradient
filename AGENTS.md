# AGENTS.md — shared rules for every agent on Ingradient

> Tracked in git and shared with the team. The **only** instruction file for every agent: Claude Code, Codex CLI, Grok Build, Gemini CLI. No per-model files.
> If you are an agent: read this whole file, then `plan/README.md`, then the task brief you were given. Do nothing else first.

## 1. The project in one paragraph

Ingradient is a mobile app that tells people what is really in their packaged food. The user scans a barcode or photographs the ingredient label. The app reads the ingredients (Open Food Facts lookup, or OCR when there is no barcode match), maps them to known ingredients and additives, and grades the product A–E with **cited, plain-language reasons** and **personal warnings** (allergies, diet, conditions). Target region: **India first, then the EU**. It is a five-student university project supervised by a professor; it may become a research paper. Background research: `RESEARCH.md`.

## 2. Who you are working for

The repo owner is a student who owns the mobile app and leads the backend with teammates. **They must understand every line and every decision**, because they will explain and defend it to the professor. So:

- **Explain, don't dump.** With every design or code change, say *why*, what the alternatives were, and what the new concepts are. Short and concrete; link official docs.
- **Teach on hand-coded tasks.** If a task brief says `Mode: hand-code`, do not write the solution. Explain the concept, give hints or a skeleton, then review their code. If the mode is unclear, ask.
- **Learn alongside building.** No long lectures up front; teach each concept at the moment the work needs it.
- **Never decide silently.** Anything that is hard to reverse (stack, schema, API shape, data licence, privacy) becomes a decision record (`plan/templates/adr.md`) that the owner accepts. You may recommend; you may not choose for them.

## 3. Stack (decided)

- **Mobile:** React Native + Expo **development builds** (not Expo Go) + TypeScript (strict). Android + iOS. iOS builds via EAS.
- **Backend:** not decided yet — that is decision BE-02 in `plan/backend/BACKEND-PLAN.md`. Do not scaffold a backend before it is accepted.

## 4. Where things live

`plan/` and `RESEARCH.md` exist only on the owner's machine. If they're missing, you're on a teammate's machine: skip the planning steps and follow the rest of this file.

| Path | What |
|---|---|
| `RESEARCH.md` | Datasets, scoring systems, research angle |
| `plan/README.md` | How the planning system works — start here |
| `plan/ROADMAP.md` | Phases, parallel tracks, milestones |
| `plan/TASKS.md` | The task board (IDs, owners, dependencies, status) |
| `plan/AGENT-ROSTER.md` | Which model does what, and who reviews whom |
| `plan/DECISIONS.md` | Decision log + open questions |
| `plan/ui/` | UX/UI plan, design language, component specs |
| `plan/backend/` | Backend design loop and design docs |
| `plan/templates/` | Task brief, ADR, review, component spec |

## 5. How to work a task

1. Read the brief. Confirm its dependencies in `plan/TASKS.md` are `done`. If not, stop and say so.
2. Stay inside the brief's scope and its listed files. If you discover work outside it, write it under "Follow-ups" in your hand-off, don't do it.
3. Write outputs where the brief says. Planning output goes in `plan/`; app code goes in `ingradient/`; backend code goes in its own folder once BE-02 is accepted.
4. Finish with a **hand-off note** (format in `plan/templates/task-brief.md`): what you did, what you decided and why, what is unverified, new concepts the owner should learn, follow-ups.
5. Update the task's status in `plan/TASKS.md` to `review` (never `done` — only the owner marks `done`).
6. Run the **sync loop** below before you hand off.

### Sync loop: after every decision or change

Run this every time something is decided, agreed or changed, whether during a task or in plain conversation. Run it before you hand off or end your turn. Nothing may live only in chat.

1. **Record it.** Add a row to `plan/DECISIONS.md` (decision or open question). Anything hard to reverse also gets an ADR. Never delete an old row: strike it through and write "Superseded by D<n>".
2. **Find what it touches.** Search `AGENTS.md`, `RESEARCH.md` and `plan/` for the old value, its key terms and the related task IDs.
3. **Update or flag.** Update every file that states the old fact. If a file is mid-review or belongs to another task's loop, don't rewrite it. Instead add a dated banner at the top that points to the decision.
4. **Check the conversation landed.** Every decision, agreed idea and open question from the session must be in a file.
5. **Report.** List every file you touched, and every banner you added, in your hand-off or reply.

Keep each file's existing line endings. The other hard rules still apply: don't edit teammates' areas, and never stage `plan/`. On a teammate's machine (no `plan/`), apply the loop to tracked files only.

## 6. Hard rules

- **Never commit or stage** anything in `plan/` or `RESEARCH.md`. They are the owner's local working files; the repo is shared with teammates and the professor.
- **No AI attribution anywhere in the repo or on GitHub**: no `Co-Authored-By` AI trailers, no "Generated with …" lines, no AI authors in metadata.
- **Don't touch teammates' areas** without the owner's say-so.
- **Cite sources** for anything about nutrition, additives, health or regulation (FSSAI, ICMR-NIN, EFSA, WHO, IARC, Nutri-Score docs, Open Food Facts). No uncited health claims in code, copy, or docs.
- **Health data is sensitive by default** (special-category data under GDPR; India's DPDP Act 2023 is assessed in BE-07). This covers allergies, conditions, pregnancy and diet. Never log it, never send it anywhere without an accepted decision saying so.
- **Open Food Facts data is ODbL** (share-alike). Don't build anything that merges and republishes it without an accepted decision.
- No secrets in code. Use env files that are gitignored.
- Ask instead of guessing when a requirement is ambiguous.

## 7. Code conventions (initial; extend as decisions land)

- TypeScript `strict`, no `any` without a comment saying why.
- Small, focused components and modules; name things for what they mean in the food domain (`IngredientChip`, `GradeBadge`), not generically (`Card2`).
- Every UI component handles: loading, empty, error, long text, large font sizes, screen reader, reduced motion.
- Tests accompany logic (scoring, parsing, matching) from the first commit.
- Commit messages: imperative, short subject, body explains *why*.

## 8. Owner communication and skills — persistent, every agent

This applies to **every agent** (Claude Code, Codex CLI, Grok Build, Gemini CLI), in every session, for all explanations and all interaction with the owner.

**pstack skills.** When a pstack skill (from `backnotprop/pstack`) fits the work, use it. Examples: `teach` for hand-code tutoring, `why` and `how` for explaining code and decisions, `architect` for design, and the `principle-*` skills for design and code judgement. Where they live:
- Claude Code: `~/.claude/skills`. Grok Build: `~/.grok/skills`.
- Codex CLI and Gemini CLI don't have them installed. Apply the matching principle by name, and tell the owner the skill is missing.
- Some pstack skills can only be started by the owner typing them (`disable-model-invocation`). Suggest the command instead of skipping it.

**i-have-adhd.** Keep the `i-have-adhd` skill on for this project, including future sessions, until the owner says "stop adhd mode" or "normal mode". At the start of a session, read that skill if available:
- Codex: `~/.codex/skills/i-have-adhd`. Claude Code: the `i-have-adhd` plugin. Grok: its marketplace copy.

If unavailable, apply these essentials:

- Lead with the answer or one small next action. When work remains, end with one concrete next action the owner can take in under two minutes.
- Ask one question at a time. Number multi-step work and keep each list to five items or fewer.
- State the current task and what is complete or pending briefly, so the owner can resume without reconstructing earlier messages.
- Give concrete estimates for the owner's reading or work when useful. Keep tangents out of the current step.
- Keep the explanations required by §2: why, alternatives and new concepts. Present them in manageable sections and expand when the owner asks for depth.
