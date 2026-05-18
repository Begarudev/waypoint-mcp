# Waypoint MCP Server

An MCP server for the Waypoint Learning challenge. It gives Claude the right context and workflow to differentiate a curriculum lesson for a specific student's IEP, then self-check the result against the same rules the prompt asked for.

Scan line:

- **2 students x 2 lesson modalities**: Jasmine Bailey with an ELA informational-text lesson, Marcus Chen with a math fractions lesson.
- **59 resources exposed**: full IEPs, full lessons, section-level rereads, and a curated CAST UDL 3.0 reference.
- **4 read-only tools**: discovery, targeted IEP reread, and `waypoint_lint_packet`.
- **2 prompts**: `/generate_modifications` and `/quick_accommodations`.
- **11 operative rules** and an **8-section output contract** in `src/prompts.ts`.
- **44 source-level tests** across data parsing, linting, and eval scoring.

The important design choice: the server does not generate lesson plans. It supplies bounded context, typed retrieval points, and a strict prompt contract. Claude does the reasoning.

## Quickstart

From a fresh clone:

```bash
cd server
npm install
npm run build
npm test
node dist/server.js
```

`node dist/server.js` starts an MCP server over stdio. It is expected to keep running under an MCP host, not print an HTTP URL.

Claude Desktop config, macOS path shown:

```json
{
  "mcpServers": {
    "waypoint": {
      "command": "node",
      "args": ["/absolute/path/to/waypoint-challenge/server/dist/server.js"]
    }
  }
}
```

Restart Claude Desktop. You should see:

- Tools: `waypoint_list_students`, `waypoint_list_lessons`, `waypoint_get_iep_section`, `waypoint_lint_packet`
- Resources: `waypoint://lesson/...`, `waypoint://iep/...`, `waypoint://framework/udl`
- Slash commands: `/generate_modifications`, `/quick_accommodations`

Typical run:

```text
/generate_modifications lesson_id=community-lowe student_id=jasmine-bailey
/generate_modifications lesson_id=fractions-5nf1 student_id=marcus-chen
/quick_accommodations student_id=jasmine-bailey activity_description="Independent read of a dense informational text, then four multiple-choice questions."
```

The server reads the bundled root PDFs `iep` and `lesson` for the Jasmine fixture, plus synthetic text fixtures under `server/data/` for Marcus and the fractions lesson.

## Architecture

MCP's server overview names the control split directly: **Prompts are user-controlled, Resources are application-controlled, Tools are model-controlled**. The architecture page describes the data layer as providing "tools for AI actions, resources for context data, and prompts for interaction templates."

That split maps cleanly to special-education lesson differentiation.

| Primitive | Controlled by | What we put there | Why |
|---|---:|---|---|
| Resource | Application | Full IEPs, full lessons, section-level IEP and lesson rereads, CAST UDL 3.0 reference | These are bounded source documents. The model should read them as context, not query them as opaque search results. |
| Tool | Model | `waypoint_list_students`, `waypoint_list_lessons`, `waypoint_get_iep_section`, `waypoint_lint_packet` | The model can discover IDs, reread one canonical IEP section, and audit its packet. All tools are read-only and narrow. |
| Prompt | User | `generate_modifications`, `quick_accommodations` | These are teacher workflows. They should appear as slash commands, with arguments and output contracts visible at invocation time. |

Why the lesson and IEP are Resources, not RAG:

- The documents fit in context.
- A useful adaptation depends on cross-section coherence. `plaafp_academics` changes how to use `accommodations`; `goals_ela` or `goals_mathematics` changes the assessment design.
- Retrieval would invite fragment-level answers. This task needs the whole student and the whole lesson.

Why section resources still exist:

- The server exposes `waypoint://iep/{student_id}/section/{section}` and `waypoint://lesson/{lesson_id}/section/{section}` for targeted rereads.
- `waypoint_get_iep_section` gives the model the same cheap reread path as a tool.
- This is not search. It is a named reread of known sections such as `plaafp_academics`, `accommodations`, `goals_ela`, `goals_mathematics`, `goals_counseling`, and `services`.

Why prompts own the workflow:

- `generate_modifications` is the canonical planning path. It loads lesson context, IEP context, UDL guidance, 11 operative rules, the 8-section contract, and the self-check procedure.
- `quick_accommodations` is the fast teacher path. It takes a one-sentence activity description and returns top accommodations, micro-modifications, and one watch-for.
- The prompt template is versionable source, not hidden inside a tool handler.

## Domain Modeling

The IEP is parsed into named sections in `src/data.ts`. The prompt does not treat every section equally.

| Priority | Section keys | Why surfaced |
|---|---|---|
| P0 | `plaafp_academics` | Present levels are the design constraint. The packet must name the gap between the lesson and the student's current academic level. |
| P0 | `accommodations` | These must be used verbatim in §3. The teacher needs exact IEP language and a concrete use for today's lesson. |
| P0 | `modifications` | This is the authorization boundary. The model may not lower a standard unless the IEP permits it. |
| P1 | `goals_ela`, `goals_mathematics`, `goals_counseling` | The alternative assessment should double as progress monitoring when possible. |
| P1 | `plaafp_behavioral` | Engagement design must respond to the named pattern, for example Jasmine's shutdown or Marcus's over-checking loop. |
| P1 | `services`, `profile`, `placement`, `assessments` | Needed for service and AT pre-checks, placement context, and assessment constraints. |
| Not surfaced by default | signatures, parent contact details, administrative boilerplate | Not needed for a daily lesson modification packet. Also avoids extra privacy surface. |

The core domain rule is the accommodations/modifications distinction. Understood's framing is the same one the prompt enforces: accommodations change how a student learns the same material; modifications change what the student is taught or expected to learn.

## Output Contract

`generate_modifications` produces exactly eight numbered sections, in order.

| Section | Contents | Why it matters |
|---|---|---|
| 1. Student snapshot | Strengths, current levels, named needs, behavior pattern | The teacher sees the design constraints before the advice. |
| 2. Lesson at a glance | Objective, standard, activities, duration | Keeps the packet anchored to the actual lesson. |
| 3. Accommodation checklist for this lesson | Verbatim IEP accommodations plus one-sentence implementation notes | Turns the IEP table into classroom actions. |
| 4. UDL-aligned modifications | Engagement, Representation, Action & Expression, each item cited | Forces each change to be grounded in UDL and the IEP. |
| 5. Scaffolded question ladder | DOK 1, DOK 2, DOK 3, with stems at DOK 1 | Gives the teacher usable questions at different access points. |
| 6. Leveled passage, side-by-side | Original and PLAAFP-calibrated rewrite, or Rule 9 artifact | Handles the main access gap without changing the standard. |
| 7. Alternative assessment | Same standard, different expression mode, tied to an annual goal | Makes the work assessable and useful for progress monitoring. |
| 8. Teacher cheat-sheet | Five paste-ready bullets | The packet is ready to use in a lesson plan. |

That is the bar for "actionable without further editing." The output is not a strategy memo. It is a lesson-plan addendum.

## Operative Rules

The prompt enforces 11 rules. The highest-signal ones:

1. Every recommendation cites UDL and IEP in this grammar: `(UDL 2.1: Clarify vocabulary, symbols, and language structures, IEP: plaafp_academics)`.
2. Accommodations level access. Modifications change content, process, or output. Only content modifications lower the standard.
3. Use the student's accommodations verbatim.
4. PLAAFP gap drives the design.
5. Behavioral pattern shapes engagement design.
6. No hallucinated services. New AT or services must be labeled as new.
7. Preserve the grade-level standard unless the IEP authorizes a modified standard.
8. Concrete beats generic.
9. Non-reading lessons do not get fake passages. §6 becomes a parallel scaffolded artifact.
10. Pre-check `profile` and `services` before recommending AT, ELL supports, or related services.
11. Self-check with `waypoint_lint_packet`. If score is below 85 or any error appears, revise once.

The lint engine enforces the machine-checkable subset: required sections, section order, UDL citation grammar, canonical IEP keys, citation density, fabricated UDL IDs, compound citations, and verbatim accommodation hits.

## Worked Examples

`examples/jasmine_community_lesson.md`

This is the ELA case: `lesson_id=community-lowe`, `student_id=jasmine-bailey`.

What it demonstrates:

- RI.7.2 is preserved.
- Jasmine's 3rd-grade reading level and 2nd-grade informational comprehension become the design constraint.
- §3 pulls accommodations like `Repeat directions`, `Extra time`, `1:1 check ins`, and `Copy of teacher's notes` verbatim.
- §4 uses real UDL checkpoints such as `UDL 2.1: Clarify vocabulary, symbols, and language structures`.
- The shutdown pattern shapes engagement supports. The packet does not give generic motivation advice.
- §6 rewrites a central excerpt side-by-side, original vs. leveled, while keeping the same central idea.

`examples/marcus_fractions_lesson.md`

This is the math case: `lesson_id=fractions-5nf1`, `student_id=marcus-chen`.

What it demonstrates:

- Marcus is a strong reader with SLD-Dyscalculia. Reading supports are not the point.
- The lesson has no extended reading passage.
- Operative Rule 9 fires. §6 becomes an annotated worked example plus a fill-in strategy template, not a leveled passage.
- The behavior design targets procrastination and over-checking, not Jasmine's silent shutdown.
- `TI-30XS` and Desmos are treated as existing AT from the IEP profile. The packet makes a pedagogical choice not to use the calculator during procedural-fluency practice.

`examples/jasmine_quick_accommodations.md` is intentionally not a full packet. It demonstrates the shorter `/quick_accommodations` shape.

## Eval Harness

`npm run eval` is deterministic and offline.

It measures the shipped markdown packets against `eval/rubric.ts`, which wraps `lintModificationPacket` from `src/lint.ts`. The same lint engine backs the MCP tool `waypoint_lint_packet`.

What it measures:

- Structure: all 8 sections, in order.
- Citation grammar: canonical `(UDL X: title, IEP: key)` format.
- IEP key validity: `goals_ela`, not `goals[ELA]` or `goals.ela`.
- Domain content: verbatim accommodations, §6 passage or Rule 9 artifact, §8 cheat-sheet density.
- Independent DOK check: §5 must include DOK 1, DOK 2, DOK 3, with a sentence stem in tier 1.

What it does not measure:

- It is not a live model-quality benchmark.
- The shipped examples are hand-authored reference exemplars.
- The default eval is a regression gate for prompt, lint, and citation-contract changes.

CLI behavior:

```bash
npm run eval
npm run eval -- examples/jasmine_community_lesson.md
npm run eval -- path/to/captured-model-run.md
```

Default mode grades `examples/*.md` that look like full 8-section packets. It auto-skips non-packet artifacts such as `jasmine_quick_accommodations.md`. Explicit paths are always graded.

Exit codes are CI-friendly:

- `0` when every graded packet passes.
- `1` when any graded packet fails.
- Skipped files do not fail the run.

The last JSON report is written to `eval/last-report.json`.

## Repo Layout

```text
server/
├── README.md
├── package.json
├── package-lock.json
├── tsconfig.json
├── data/
│   ├── iep-jasmine.txt
│   ├── iep-marcus.txt
│   ├── lesson-community.txt
│   └── lesson-fractions.txt
├── eval/
│   ├── _rubric.test.ts
│   ├── last-report.json
│   ├── rubric.ts
│   ├── run.ts
│   └── tsconfig.json
├── examples/
│   ├── jasmine_community_lesson.md
│   ├── jasmine_quick_accommodations.md
│   └── marcus_fractions_lesson.md
└── src/
    ├── _lint.test.ts
    ├── _smoke.test.ts
    ├── data.ts
    ├── lint.ts
    ├── prompts.ts
    └── server.ts
```

Runtime note: `src/data.ts` reads the root bundled PDFs `../iep` and `../lesson` for the Jasmine/community fixtures. The matching `server/data/iep-jasmine.txt` and `server/data/lesson-community.txt` files are inspection artifacts, not the runtime source for those two records.

## Scale Trade-Offs

What I would change for production:

- Multi-student catalog: replace the in-memory registry with `IepStore` and `LessonStore` backed by Postgres and object storage.
- Ingest pipeline: parse PDFs and DOCX files once, cache structured section maps, and expose a human review step before the data reaches prompts.
- Structured accommodations: promote the accommodations table to JSON with source spans, service type, setting, frequency, and applicability.
- UDL reference: replace the curated 9-guideline markdown with the full CAST 3.0 guideline and checkpoint tree.
- Search only when it pays: add curriculum and IEP search once the catalog is too large for full-context loading.
- Real model eval: capture live Claude outputs across held-out lesson and IEP pairs, then grade with expert-written references and judged criteria.
- Output artifacts: generate a printable lesson-plan addendum, student worksheet PDF, and progress-monitoring log entry.

## References

- Model Context Protocol, architecture overview: https://modelcontextprotocol.io/docs/learn/architecture
- Model Context Protocol, server primitives and control hierarchy: https://modelcontextprotocol.io/specification/2025-06-18/server/index
- Model Context Protocol, resources: https://modelcontextprotocol.io/docs/concepts/resources
- Model Context Protocol, tools: https://modelcontextprotocol.io/specification/2025-06-18/server/tools
- Model Context Protocol, prompts: https://modelcontextprotocol.io/docs/concepts/prompts
- Anthropic, Writing effective tools for AI agents: https://www.anthropic.com/engineering/writing-tools-for-agents
- CAST UDL Guidelines 3.0: https://udlguidelines.cast.org/
- US Department of Education, A Guide to the Individualized Education Program: https://www.ed.gov/sites/ed/files/parents/needs/speced/iepguide/iepguide.pdf
- Understood.org, Accommodations vs. modifications: https://www.understood.org/en/articles/the-difference-between-accommodations-and-modifications
