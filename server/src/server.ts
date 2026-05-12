#!/usr/bin/env node
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  loadIep,
  loadLesson,
  udlMarkdown,
  type IepSectionKey,
  type LessonSectionKey,
} from "./data.js";
import { buildGenerateModificationsPrompt, buildQuickAccommodationsPrompt } from "./prompts.js";

// In a real product these come from a DB. For the challenge we ship one lesson + one student.
const lesson = loadLesson();
const iep = loadIep();

const server = new McpServer(
  {
    name: "waypoint-mcp",
    version: "0.1.0",
  },
  {
    capabilities: { resources: {}, tools: {}, prompts: {} },
    instructions:
      "Waypoint helps a teacher differentiate a lesson for a student with an IEP. " +
      "Two prompts: `generate_modifications` (full lesson-plan-grade packet from a lesson_id + student_id — use when planning a whole lesson) and `quick_accommodations` (lightweight in-the-moment checklist from a student_id + a one-sentence activity description — use when the teacher needs accommodations for an activity they're about to run). " +
      "Both prompts auto-load the relevant IEP sections + a CAST UDL 3.0 reference; the model does the reasoning.",
  }
);

// ─── Resources ──────────────────────────────────────────────────────────────

server.registerResource(
  "lesson",
  new ResourceTemplate("waypoint://lesson/{lesson_id}", {
    list: async () => ({
      resources: [
        {
          uri: `waypoint://lesson/${lesson.id}`,
          name: `Lesson — ${lesson.title}`,
          description: `${lesson.subject} ${lesson.grade} • ${lesson.standard} • ${lesson.duration_minutes} min`,
          mimeType: "text/markdown",
        },
      ],
    }),
  }),
  {
    title: "Curriculum lesson",
    description: "Full text of a curriculum lesson (teacher copy + student materials).",
  },
  async (uri, vars) => {
    if (vars.lesson_id !== lesson.id) throw new Error(`Unknown lesson_id: ${vars.lesson_id}`);
    return {
      contents: [
        {
          uri: uri.href,
          mimeType: "text/markdown",
          text: lesson.raw,
        },
      ],
    };
  }
);

server.registerResource(
  "lesson_section",
  new ResourceTemplate("waypoint://lesson/{lesson_id}/section/{section}", {
    list: async () => ({
      resources: (Object.keys(lesson.sections) as LessonSectionKey[]).map((s) => ({
        uri: `waypoint://lesson/${lesson.id}/section/${s}`,
        name: `Lesson section — ${s}`,
        mimeType: "text/markdown",
      })),
    }),
  }),
  {
    title: "Lesson section",
    description: "Targeted re-read of one section of the lesson (overview, reading_passage, etc).",
  },
  async (uri, vars) => {
    if (vars.lesson_id !== lesson.id) throw new Error(`Unknown lesson_id: ${vars.lesson_id}`);
    const section = vars.section as LessonSectionKey;
    const text = lesson.sections[section];
    if (text === undefined) throw new Error(`Unknown lesson section: ${section}`);
    return {
      contents: [{ uri: uri.href, mimeType: "text/markdown", text }],
    };
  }
);

server.registerResource(
  "iep",
  new ResourceTemplate("waypoint://iep/{student_id}", {
    list: async () => ({
      resources: [
        {
          uri: `waypoint://iep/${iep.id}`,
          name: `IEP — ${iep.student_name}`,
          description: `Grade ${iep.grade} • Disability: ${iep.disability}`,
          mimeType: "text/markdown",
        },
      ],
    }),
  }),
  {
    title: "Student IEP",
    description: "Full text of a student's Individualized Education Program.",
  },
  async (uri, vars) => {
    if (vars.student_id !== iep.id) throw new Error(`Unknown student_id: ${vars.student_id}`);
    return {
      contents: [
        {
          uri: uri.href,
          mimeType: "text/markdown",
          text: iep.raw,
        },
      ],
    };
  }
);

server.registerResource(
  "iep_section",
  new ResourceTemplate("waypoint://iep/{student_id}/section/{section}", {
    list: async () => ({
      resources: (Object.keys(iep.sections) as IepSectionKey[]).map((s) => ({
        uri: `waypoint://iep/${iep.id}/section/${s}`,
        name: `IEP section — ${s}`,
        mimeType: "text/markdown",
      })),
    }),
  }),
  {
    title: "IEP section",
    description:
      "Targeted re-read of one IEP section (plaafp_academics, accommodations, goals_counseling, goals_mathematics, goals_ela, services, etc).",
  },
  async (uri, vars) => {
    if (vars.student_id !== iep.id) throw new Error(`Unknown student_id: ${vars.student_id}`);
    const section = vars.section as IepSectionKey;
    const text = iep.sections[section];
    if (text === undefined) throw new Error(`Unknown IEP section: ${section}`);
    return {
      contents: [{ uri: uri.href, mimeType: "text/markdown", text }],
    };
  }
);

server.registerResource(
  "udl_framework",
  "waypoint://framework/udl",
  {
    title: "CAST UDL Guidelines 3.0 (curated)",
    description:
      "Curated reference to CAST's Universal Design for Learning Guidelines (3.0). Cite guideline/checkpoint numbers (e.g. `UDL 7.1 (Optimize choice and autonomy)` or `UDL 2 (Language & Symbols)`) when justifying a modification.",
    mimeType: "text/markdown",
  },
  async (uri) => ({
    contents: [{ uri: uri.href, mimeType: "text/markdown", text: udlMarkdown() }],
  })
);

// ─── Tools ──────────────────────────────────────────────────────────────────

server.registerTool(
  "waypoint_list_students",
  {
    title: "List students with an IEP on file",
    description:
      "Returns the roster of students Waypoint has IEPs for. Use to discover the `student_id` to pass into other tools or the `generate_modifications` prompt.",
    inputSchema: {},
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  },
  async () => ({
    content: [
      {
        type: "text",
        text: JSON.stringify(
          [
            {
              student_id: iep.id,
              name: iep.student_name,
              grade: iep.grade,
              disability: iep.disability,
            },
          ],
          null,
          2
        ),
      },
    ],
  })
);

server.registerTool(
  "waypoint_list_lessons",
  {
    title: "List lessons in the curriculum",
    description:
      "Returns the lessons available to differentiate. Use to discover the `lesson_id` to pass into `generate_modifications`.",
    inputSchema: {},
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  },
  async () => ({
    content: [
      {
        type: "text",
        text: JSON.stringify(
          [
            {
              lesson_id: lesson.id,
              title: lesson.title,
              subject: lesson.subject,
              grade: lesson.grade,
              standard: lesson.standard,
              duration_minutes: lesson.duration_minutes,
            },
          ],
          null,
          2
        ),
      },
    ],
  })
);

const IEP_SECTION_KEYS = [
  "student_info",
  "concerns",
  "vision",
  "profile",
  "plaafp_academics",
  "plaafp_behavioral",
  "accommodations",
  "modifications",
  "goals",
  "goals_counseling",
  "goals_mathematics",
  "goals_ela",
  "services",
  "assessments",
  "placement",
] as const;

server.registerTool(
  "waypoint_get_iep_section",
  {
    title: "Read a specific section of a student's IEP",
    description:
      "Returns one named section of a student's IEP. Use when you need to re-check accommodations, goals, services, or PLAAFP without rereading the whole document. Sections: " +
      IEP_SECTION_KEYS.join(", ") +
      ".",
    inputSchema: {
      student_id: z.string().describe("Student id, e.g. 'jasmine-bailey'. Get from waypoint_list_students."),
      section: z
        .enum(IEP_SECTION_KEYS)
        .describe("Which IEP section to return."),
    },
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  },
  async ({ student_id, section }) => {
    if (student_id !== iep.id) {
      return {
        isError: true,
        content: [{ type: "text", text: `Unknown student_id: ${student_id}` }],
      };
    }
    const text = iep.sections[section as IepSectionKey];
    return { content: [{ type: "text", text: text || "(section is empty)" }] };
  }
);

// ─── Prompts ────────────────────────────────────────────────────────────────

server.registerPrompt(
  "generate_modifications",
  {
    title: "Differentiate this lesson for this student",
    description:
      "The canonical Waypoint workflow. Given a lesson_id and a student_id, produces a structured packet of UDL-aligned modifications, scaffolded questions, a leveled passage, and an alternative assessment — grounded in both the lesson and the student's IEP.",
    argsSchema: {
      lesson_id: z
        .string()
        .describe("Lesson id from waypoint_list_lessons (e.g. 'community-lowe')."),
      student_id: z
        .string()
        .describe("Student id from waypoint_list_students (e.g. 'jasmine-bailey')."),
    },
  },
  async ({ lesson_id, student_id }) => {
    if (lesson_id !== lesson.id) throw new Error(`Unknown lesson_id: ${lesson_id}`);
    if (student_id !== iep.id) throw new Error(`Unknown student_id: ${student_id}`);
    return buildGenerateModificationsPrompt(lesson, iep, udlMarkdown());
  }
);

server.registerPrompt(
  "quick_accommodations",
  {
    title: "Quick accommodation check for a planned activity",
    description:
      "Lightweight 'I'm about to do X with student Y, what accommodations matter right now?' command. Outputs a short checklist plus 2-3 micro-modifications.",
    argsSchema: {
      student_id: z.string().describe("Student id from waypoint_list_students."),
      activity_description: z
        .string()
        .describe(
          "One or two sentences describing what the teacher is about to do (e.g. 'whole-class reading of a dense informational text, then 4 multiple-choice questions independently')."
        ),
    },
  },
  async ({ student_id, activity_description }) => {
    if (student_id !== iep.id) throw new Error(`Unknown student_id: ${student_id}`);
    return buildQuickAccommodationsPrompt(iep, activity_description);
  }
);

// ─── Wire transport ─────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
