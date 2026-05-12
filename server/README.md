# Waypoint MCP Server

An MCP server that gives Claude the context it needs to differentiate a curriculum lesson for a specific student's IEP — turning a 7th-grade ELA lesson into something a student reading at a 3rd-grade level can actually do, without losing the grade-level standard.

Built for the [Waypoint Learning founding-engineer challenge](https://github.com/igoldstein19/waypoint-challenge/).

---

## Quickstart

```bash
cd server
npm install
npm run build
node dist/server.js   # speaks MCP over stdio
```

To wire it into Claude Desktop, add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or the equivalent on your OS:

```json
{
  "mcpServers": {
    "waypoint": {
      "command": "node",
      "args": ["/absolute/path/to/server/dist/server.js"]
    }
  }
}
```

Restart Claude Desktop and you should see:
- **Tools** — `waypoint_list_students`, `waypoint_list_lessons`, `waypoint_get_iep_section`, `waypoint_lint_packet`
- **Resources** — the lesson, the IEP, the UDL framework reference
- **Slash commands** — `/generate_modifications`, `/quick_accommodations`

The intended teacher flow is one slash command: `/generate_modifications` with a lesson id and a student id.

---

## Why this shape

The single most consequential decision in this project was **how to split work between MCP resources, tools, and prompts**. The MCP protocol gives you three primitives with different control models:

| Primitive | Controlled by | Best for |
|---|---|---|
| **Resource** | application | static or semi-static context the model browses (a lesson, an IEP) |
| **Tool** | model | actions and targeted lookups the model decides to invoke |
| **Prompt** | user | canonical workflows surfaced as slash commands |

The Anthropic / `modelcontextprotocol.io` guidance — *"prompts orchestrate, resources supply context, tools perform actions"* — maps cleanly onto this domain:

- **The lesson and the IEP are Resources, not search results.** They are bounded, human-authored documents. A meaningful modification depends on cross-section coherence — a goal in §3 changes how to interpret an accommodation in §5. Putting them behind a search/RAG tool would let the model retrieve fragments and miss the whole picture. Both documents fit comfortably in Claude's context, so I expose them in full.
- **The IEP is also exposed as named sub-resources** (`plaafp_academics`, `accommodations`, `goals_ela`, `goals_mathematics`, `goals_counseling`, `services`, …). This is for *targeted re-read*, not retrieval. After Claude has read the whole IEP once, it can grab a specific section cheaply if it needs to double-check before recommending an accommodation.
- **A curated CAST UDL 3.0 reference is exposed as a Resource** (`waypoint://framework/udl`). This is the small grounding move that turns "consider scaffolding" into "pre-teach *narrative, archetype, normative* with a Frayer card (UDL 2.1: Clarify vocabulary, symbols, and language structures)." Every modification in the output cites a real CAST 3.0 guideline or checkpoint number, which is how Goalbook-style products achieve "grounded, not generic."
- **The differentiation workflow is a Prompt, not a Tool.** Putting the reasoning scaffold inside a prompt template (a) makes it user-discoverable as a slash command, (b) keeps the eight-section output contract versionable in source, (c) avoids hiding orchestration logic inside a tool handler. The prompt template pre-wires which resources to load, sets the operative rules, and enforces the output schema.
- **Tools are small and read-only** — list students, list lessons, fetch one IEP section. They exist to bootstrap the workflow (so Claude can answer "what students do you have IEPs for?") and to support targeted re-reads. Following Anthropic's *Writing tools for agents* guidance: service-prefixed (`waypoint_*`), snake_case, action-first verbs, narrow descriptions, `readOnlyHint: true` annotations. Plus `waypoint_lint_packet(packet)` — a self-eval tool that takes a generated packet and reports a 0–100 score, missing sections, bad citations, and verbatim-accommodation coverage. Useful for closed-loop quality gates or for the model to self-check before returning.

What I deliberately **didn't** build:
- **No RAG.** With one bounded IEP and one bounded lesson, retrieval is strictly worse than full context.
- **No write tools.** The server is pure context plumbing. The model does all the reasoning.
- **No LLM calls inside the server.** That would couple this MCP server to a specific provider and obscure the cost surface.

---

## Domain modeling — what gets surfaced from the IEP

Not every section of an IEP is useful for lesson-level differentiation. The `generate_modifications` prompt feeds Claude this priority order:

| Priority | IEP section | Why |
|---|---|---|
| P0 | **PLAAFP — academics** | Ground-truth reading/math/processing levels. Drives every adaptation. |
| P0 | **Accommodations** | Directly lesson-applicable, must be used verbatim. |
| P0 | **Modifications** | Tells the model when it's authorized to reduce scope or alter the standard. |
| P1 | **Annual goals** | So today's lesson activities target IEP goals (daily work = progress monitoring). |
| P1 | **PLAAFP — behavioral** | Shapes engagement design around the student's named patterns (e.g., shutdown / head-down avoidance). |
| P1 | **Service delivery** | Avoid scheduling rigorous independent work during pull-outs; know what supports the student already has. |
| — | Signatures, parent contact, evals | Stripped — privacy + not actionable for a daily lesson. |

The operative rule the prompt enforces — drawn from the practitioner literature — is *"accommodations level the playing field; modifications change the game."* The model defaults to UDL + verbatim accommodations and only proposes modifications when the IEP explicitly authorizes lowered standards.

---

## The output contract

The `generate_modifications` prompt enforces an **eight-section** structure (see `src/prompts.ts`):

1. **Student snapshot** — strengths, current academic levels, named behavior pattern, all anchored to PLAAFP citations.
2. **Lesson at a glance** — objective, standard, activities, duration.
3. **Accommodation checklist for *this* lesson** — only the IEP accommodations that apply to today's activities, each with a one-sentence "how to actually do this." Pulled verbatim from the IEP.
4. **UDL-aligned modifications** — grouped Engagement / Representation / Action & Expression. Every item ends with `(UDL: <guideline-id>, IEP: <section>)`.
5. **Scaffolded question ladder** — three DOK tiers with sentence stems at the lowest tier.
6. **Leveled passage (side-by-side)** — original vs. rewritten-to-PLAAFP-level, with a vocab pre-teach list.
7. **Alternative assessment** — same standard, different expression mode, tied to one annual goal so the activity doubles as progress monitoring.
8. **Teacher cheat-sheet** — five bullets paste-ready for the lesson plan.

These eight sections are the bar for "actionable without further editing" — they're what teachers actually need *in their lesson plan*, not in a meta-document.

---

## Example output

Running `/generate_modifications lesson_id=community-lowe student_id=jasmine-bailey` against the sample lesson (*"What is 'community' and why is it important?"* by Toby Lowe, RI.7.2) and the sample IEP (Jasmine Bailey, 7th-grade, Health Impairment, reading at 3rd-grade level, documented academic-frustration → shutdown pattern) produces the packet at:

📄 **[`examples/jasmine_community_lesson.md`](examples/jasmine_community_lesson.md)** — full eight-section packet from `generate_modifications`.

A second, lighter-weight example shows the in-the-moment `quick_accommodations` flow — a teacher who's about to run a specific activity tomorrow and just needs the 3-2-1 checklist:

📄 **[`examples/jasmine_quick_accommodations.md`](examples/jasmine_quick_accommodations.md)** — short checklist from `quick_accommodations` for an independent informational-text read.

What to notice in the `quick_accommodations` walkthrough:

- **It's *quick* by construction** — ≤200-word body, 3 sections (top-3 accommodations / 2 micro-mods / 1 watch-for) vs. the full eight-section packet.
- **The blockquote at the top simulates the slash-command argument** the teacher would type in Claude Desktop (`activity_description`).
- **Use this** when the teacher is mid-day and needs in-the-moment supports for an activity that's about to run; use `generate_modifications` when planning a whole lesson the night before.

A few things worth noting in the longer `generate_modifications` output:

- **Every modification cites both a CAST 3.0 UDL number and an IEP section.** E.g., "Pre-teach 5 words with a Frayer card *(UDL 2: Language & Symbols, IEP: plaafp_academics)*."
- **The PLAAFP gap is named explicitly:** "*~9th–10th-grade essay vs. 3rd-grade reader*" — the leveled passage in §6 rewrites paragraph 9 to ~3rd-grade reading level *while preserving RI.7.2*.
- **The shutdown pattern shapes engagement design.** Rather than generic motivation tips, Engagement.G9 produces a specific shutdown-protocol card with three pre-practiced calming strategies from Jasmine's IEP counseling goal, a silent desk-corner tap signal, and a two-minute re-entry script.
- **Today's writing task doubles as IEP goal progress monitoring** for her ELA annual goal (claim → evidence → analysis at 50% → 75%).
- **AT (text-to-speech) is correctly flagged as a *new* recommendation** rather than treated as already in place — the IEP marks AT: No.

---

## Eval harness

`npm run eval` is a deterministic, offline grader for generated packets. It runs entirely without an LLM call — the rubric in `eval/rubric.ts` reuses `lintModificationPacket` (the same engine that backs the `waypoint_lint_packet` MCP tool) as its underlying check engine, then layers on domain checks (verbatim accommodations in §3, leveled passage in §6, cheat-sheet density in §8).

Default invocation grades everything under `examples/*.md`; pass paths explicitly to grade arbitrary markdown:

```
npm run eval                              # grade examples/*.md
npm run eval -- path/to/packet.md         # grade specific file(s)
```

It grades 8 weighted items across **structure** (sections + ordering, 15%), **citations** (UDL/IEP grammar, density, canonical keys — 30%), and **domain content** (verbatim accommodations, leveled passage, cheat-sheet, overall lint score — 30%; weights normalize to 100). A packet `passes` if its weighted score ≥ 80 *and* the lint pass reports no errors. Exit code is `0` when every packet passes and `1` otherwise, so CI can gate on a regression. Weights are intentionally conservative — pure prompt-quality regressions surface here before they hit a teacher. A JSON dump of the last run lands at `eval/last-report.json`.

---

## Repo layout

```
server/
├── package.json
├── tsconfig.json
├── README.md             # this file
├── examples/
│   ├── jasmine_community_lesson.md       # sample output from generate_modifications
│   └── jasmine_quick_accommodations.md   # sample output from quick_accommodations
├── data/
│   ├── lesson-community.txt              # pdftotext extraction of root /lesson
│   └── iep-jasmine.txt                   # pdftotext extraction of root /iep
├── eval/
│   ├── rubric.ts        # weighted rubric on top of lintModificationPacket
│   ├── run.ts           # CLI entrypoint: `npm run eval`
│   ├── tsconfig.json    # secondary TS project for the eval bundle
│   └── _rubric.test.ts  # node:test suite for the rubric
└── src/
    ├── server.ts         # MCP server entry: resources + tools + prompts + stdio
    ├── data.ts           # lesson/IEP registry + section splitters + UDL reference
    ├── prompts.ts        # generate_modifications + quick_accommodations templates
    └── _smoke.test.ts    # node:test suite (run via `npm test`)
```

---

## Architectural trade-offs I'd revisit at scale

This MVP handles one lesson and one IEP. To go from here to a real product:

- **Multi-student / multi-lesson catalog.** The list-tools already return arrays; the loaders move behind a `LessonStore` / `IepStore` interface backed by Postgres or object storage.
- **IEP parsing.** The current section splitter is a heading-aware regex over a `pdftotext -layout` dump. Production needs a real PDF/DOCX parser with named-section extraction (likely Claude itself, run once at ingest, with the parse cached and human-reviewable). The accommodations table in particular should be promoted from prose to structured JSON so it can be cited and audited.
- **UDL reference.** The 9-guideline curated set in `data.ts` is a placeholder. Real version pulls the full CAST 3.0 guideline + checkpoint tree, possibly behind a `waypoint_search_udl` tool when the corpus stops fitting in context.
- **Search becomes worthwhile when the catalog grows.** Today the lesson and IEP fit in context; once a teacher has 30 students and a year's curriculum, the design shifts toward `waypoint_search_curriculum(query, filters)` and `waypoint_find_iep_section(student_id, query)`, with the prompt template orchestrating retrieval rather than pre-loading everything.
- **Outputs as artifacts, not chat.** The eight-section packet is markdown today; in product it should render as a printable lesson-plan addendum, a worksheet PDF, and a progress-monitoring log entry written back to the IEP system.
- **Eval loop.** Today's quality bar is human spot-checks. Production needs a held-out set of (lesson, IEP, expert-written modification packet) tuples and an LLM-judged rubric on (a) presence of all 8 sections, (b) UDL/IEP citation density, (c) verbatim accommodation use, (d) PLAAFP-calibrated reading level on the leveled passage.

---

## References

- [Model Context Protocol — architecture](https://modelcontextprotocol.io/docs/learn/architecture)
- [Anthropic — Writing tools for agents](https://www.anthropic.com/engineering/writing-tools-for-agents)
- [CAST — UDL Guidelines 3.0](https://udlguidelines.cast.org/)
- [US Department of Education — A Guide to the IEP](https://www.ed.gov/sites/ed/files/parents/needs/speced/iepguide/iepguide.pdf)
- [Understood.org — Accommodations vs Modifications](https://www.understood.org/en/articles/the-difference-between-accommodations-and-modifications)
