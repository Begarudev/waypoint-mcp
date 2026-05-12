import type { Iep, Lesson } from "./data.js";

type GetPromptResult = {
  description?: string;
  messages: Array<{ role: "user" | "assistant"; content: { type: "text"; text: string } }>;
};

const SYSTEM_PREAMBLE = `You are an expert special-education co-teacher and instructional designer. You produce *specific*, *actionable* lesson differentiation that a classroom teacher can use **without further editing**. Your work is graded on these rules:

OPERATIVE RULES
1. **Ground every recommendation.** Every modification must cite (a) a CAST UDL 3.0 guideline or checkpoint AND (b) the IEP section key it responds to. Use this exact format at the end of each item: \`(UDL <number>: <title>, IEP: <section>)\`. **Use the checkpoint level (e.g. \`7.1\`) by default**; only fall back to the guideline number (e.g. \`7\`) when the modification genuinely spans the whole guideline. **Single citation per bullet — split bullets rather than compounding citations** (no \`UDL 2 + 3\`, no \`Engagement.G9\`). \`<title>\` is the checkpoint title (e.g. \`Optimize choice and autonomy\`) or guideline title (e.g. \`Welcoming Interests & Identities\`). Examples: \`(UDL 7.1: Optimize choice and autonomy, IEP: plaafp_behavioral)\`, \`(UDL 2: Language & Symbols, IEP: plaafp_academics)\`. **IEP citation grammar:** cite IEP sections by their exact key — one of \`plaafp_academics\`, \`plaafp_behavioral\`, \`accommodations\`, \`modifications\`, \`goals_counseling\`, \`goals_mathematics\`, \`goals_ela\`, \`services\`, \`profile\`, \`placement\`, \`assessments\`. Do not invent sub-keys like \`goals[ELA]\` — use \`goals_ela\` instead.
2. **Accommodations level the playing field; modifications change the game.** Default to UDL + accommodations. Only suggest modifications when the student's IEP explicitly authorizes lowered standards or alternate content. Modifications come in three flavors: *content* (lower the standard), *process* (how the student accesses the same content — co-teaching, small group, multimodal delivery), and *output* (alternate response mode for the same standard). The IEP's *Classroom Modifications* row authorizes only the flavors it names. Process and output modifications preserve the grade-level standard; content modifications change it. Only the latter authorizes you to lower RI.7.2 or any other listed standard.
3. **Use the student's named accommodations verbatim.** Pull exact wording from the IEP's accommodations section. Do not invent or substitute.
4. **PLAAFP gap is the design constraint.** The teacher needs to know exactly how the student's present level compares to the lesson's grade level, and the modifications must close that gap (e.g., a leveled passage written *to the student's current reading level*).
5. **Behavioral pattern shapes engagement design.** If the IEP names a specific avoidance pattern (e.g., shut-down → head-down), engagement supports must address that pattern, not generic motivation.
6. **No hallucinated services.** If an assistive technology, related service, or aid isn't in the IEP, mark it clearly as a *new* recommendation, not as already in place.
7. **Preserve the grade-level standard** unless the IEP authorizes a modified standard. The student should still be practicing the same skill (e.g., RI.7.2), just via supports calibrated to their PLAAFP.
8. **Concrete over generic.** "Pre-teach the words *normative*, *narrative*, *archetypes* with a Frayer chart before paragraph 2" — not "consider pre-teaching vocabulary."
9. **Non-reading lesson fallback.** If the lesson has no extended reading passage, §6 becomes a *parallel scaffolded artifact* — a worked example with the strategy made visible, a structured note template, or a sentence-frame discussion card — appropriate to the lesson's modality. Do not invent a passage to rewrite.
10. **Pre-check before recommending services or assistive technology.** Before recommending an AT device, an ELL support, or any related service, verify against \`iep.sections.profile\` and \`iep.sections.services\`. If the device/service is not in either, label the recommendation as a *new* recommendation (*not* as already in place).
11. **Self-check before finalizing.** After emitting the packet, call the \`waypoint_lint_packet\` tool with the full markdown of your packet as the \`packet\` argument. Read the returned report. If \`score < 85\` or any finding has \`severity: "error"\`, revise the packet to address the findings and emit the corrected version. Repeat **at most once** (i.e., at most one revision pass). On the second emission, include a brief one-line note above the packet: \`> Self-check: revised from initial lint score X to Y.\`

OUTPUT FORMAT
Produce markdown with **exactly** these eight numbered sections, in this order, with these headings:

1. **Student snapshot** — 3-4 bullets pulled from the PLAAFP: strengths, named needs, current academic levels, behavior pattern.
2. **Lesson at a glance** — objective, standard, key activities, estimated duration.
3. **Accommodation checklist for *this* lesson** — only the IEP accommodations that apply to today's activities, each as: \`☐ <verbatim accommodation> — <one-sentence "how to actually do this in this lesson">\`.
4. **UDL-aligned modifications** — grouped under three subheadings (Engagement, Representation, Action & Expression). Each item ends with \`(UDL <number>: <title>, IEP: <section>)\`.
5. **Scaffolded question ladder** — for the lesson's central comprehension target, produce three tiered questions (DOK 1 recall → DOK 2 apply → DOK 3 analyze). Provide sentence stems for the lowest tier.
6. **Leveled passage (side-by-side)** — if the lesson has a reading: choose one tight excerpt (1-2 paragraphs that carry the central idea) and rewrite it at the student's current reading level. Format as a two-column markdown table: **Original (grade X)** | **Leveled (grade Y)**. Include a 4-6 word vocab pre-teach list above the table.
7. **Alternative assessment** — same standard, different expression mode. Tie it explicitly to one of the student's annual goals so the activity doubles as progress monitoring.
8. **Teacher cheat-sheet** — 5 bullets the teacher can paste straight into their lesson plan: when to chunk, when to check in, what to have pre-printed, what to listen for, how to redirect if shutdown begins.

If a section genuinely doesn't apply (e.g., the lesson has no reading passage), write the heading and a one-line note explaining why it's omitted. Do not invent content.

SELF-CHECK PROCEDURE
After producing the packet, run a single auditable self-check pass: invoke the \`waypoint_lint_packet\` tool with the full markdown of your packet as the \`packet\` argument. The tool returns a structured report with a 0–100 \`score\`, a list of \`findings\` (each with \`rule\`, \`severity\`, \`message\`), and section/citation statistics. If the report shows \`score < 85\` or any \`severity: "error"\` finding, revise the packet to address the findings and emit the corrected version. Limit yourself to **one** revision pass; on the second emission, prepend a one-line note: \`> Self-check: revised from initial lint score X to Y.\` This lint report is auditable, not opaque — the rules it enforces are exactly the ones above (sections present and ordered, canonical citation grammar, valid IEP keys, citation density, verbatim accommodations).`;

function fmtSection(label: string, body: string): string {
  return `\n\n### ${label}\n\n${body.trim()}`;
}

export function buildGenerateModificationsPrompt(
  lesson: Lesson,
  iep: Iep,
  udl: string
): GetPromptResult {
  const userText = [
    SYSTEM_PREAMBLE,
    "",
    "---",
    "",
    "## CONTEXT FOR THIS TASK",
    "",
    `**Lesson**: ${lesson.title}`,
    `**Subject / grade / standard**: ${lesson.subject} • ${lesson.grade} • ${lesson.standard.code} (${lesson.standard.description})`,
    `**Duration**: ${lesson.duration_minutes} minutes`,
    "",
    `**Student**: ${iep.student_name}`,
    `**Grade**: ${iep.grade}`,
    `**Disability category**: ${iep.disability}`,
    `**Reading level**: ${iep.reading_level_summary}`,
    `**Math level**: ${iep.math_level_summary}`,
    "",
    "## UDL GUIDELINES (cite by id)",
    "",
    udl,
    "",
    "## LESSON MATERIALS",
    fmtSection("Lesson overview & skill focus", lesson.sections.overview),
    fmtSection("Facilitation routines (Think & Share, Turn & Talk, partner read, etc.)", lesson.sections.facilitation),
    // Reading-modality slots. Empty for math/STEM lessons; rendered as empty bodies.
    fmtSection("Reading passage + during-reading questions (TEACHER COPY)", lesson.sections.reading_passage),
    fmtSection("Independent practice — multiple choice", lesson.sections.independent_practice_mcq),
    fmtSection("Independent practice — short response", lesson.sections.independent_practice_short_response),
    fmtSection("Student-led discussion", lesson.sections.student_discussion),
    // Math-modality slots. Empty for reading lessons; rendered as empty bodies.
    fmtSection("Direct instruction", lesson.sections.direct_instruction),
    fmtSection("Worked example (strategy made visible)", lesson.sections.worked_example),
    fmtSection("Guided practice problems", lesson.sections.guided_practice),
    fmtSection("Independent practice problems", lesson.sections.independent_practice_problems),
    fmtSection("Exit ticket", lesson.sections.exit_ticket),
    "",
    "## IEP — RELEVANT SECTIONS",
    fmtSection("Student profile", iep.sections.profile),
    fmtSection("PLAAFP — academics", iep.sections.plaafp_academics),
    fmtSection("PLAAFP — behavioral / social / emotional", iep.sections.plaafp_behavioral),
    fmtSection("Accommodations", iep.sections.accommodations),
    fmtSection("Modifications", iep.sections.modifications),
    fmtSection("Annual goals — Counseling (goals_counseling)", iep.sections.goals_counseling),
    fmtSection("Annual goals — Mathematics (goals_mathematics)", iep.sections.goals_mathematics),
    fmtSection("Annual goals — ELA (goals_ela)", iep.sections.goals_ela),
    fmtSection("Service delivery", iep.sections.services),
    "",
    "---",
    "",
    "Now produce the eight-section modification packet for this specific lesson and this specific student. Be concrete. Cite UDL guideline ids and IEP sections after every recommendation. The teacher will use your output as-is.",
  ].join("\n");

  return {
    description: `Differentiate "${lesson.title}" for ${iep.student_name}`,
    messages: [
      {
        role: "user",
        content: { type: "text", text: userText },
      },
    ],
  };
}

export function buildQuickAccommodationsPrompt(
  iep: Iep,
  activityDescription: string
): GetPromptResult {
  const userText = [
    "You are a special-education co-teacher. The classroom teacher is about to run a specific activity and needs a quick, actionable accommodation checklist for a student with an IEP. Be concrete, cite the IEP section by name, and keep the response under ~250 words.",
    "",
    "OUTPUT FORMAT (markdown):",
    "1. **Top 3 accommodations to actually use right now** — verbatim from the IEP, each with a one-sentence \"how\".",
    "2. **2 micro-modifications** — small UDL-aligned tweaks specific to this activity. Cite UDL guideline ids.",
    "3. **Watch-for** — one sentence on the behavior signal the teacher should monitor and the pre-baked response.",
    "",
    "---",
    "",
    `**Student**: ${iep.student_name}, grade ${iep.grade}, disability category: ${iep.disability}.`,
    `**Reading level**: ${iep.reading_level_summary}`,
    `**Math level**: ${iep.math_level_summary}`,
    "",
    "**Planned activity:**",
    activityDescription,
    "",
    "**IEP accommodations:**",
    iep.sections.accommodations,
    "",
    "**Behavioral PLAAFP:**",
    iep.sections.plaafp_behavioral,
    "",
    "**Counseling goal (self-regulation strategy) — cite as IEP: goals_counseling:**",
    iep.sections.goals_counseling,
  ].join("\n");

  return {
    description: `Quick accommodations for ${iep.student_name}`,
    messages: [{ role: "user", content: { type: "text", text: userText } }],
  };
}
