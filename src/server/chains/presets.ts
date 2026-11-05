import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ChainStep } from '../../shared/chain.js';
import type {
  Scenario,
  ScenarioAudience,
  ScenarioCatalog,
  ScenarioInput,
  ScenarioSkillSource,
  ScenarioVariant,
} from '../../shared/presets.js';

function skill(
  id: string,
  name: string,
  label: string,
  instruction: string,
): ChainStep {
  return { id, kind: 'skill', skillName: name, label, instruction };
}

function instruction(id: string, label: string, instructionText: string): ChainStep {
  return { id, kind: 'instruction', label, instruction: instructionText };
}

function input(name: string, label: string, defaultValue?: string): ScenarioInput {
  return {
    name,
    label,
    required: true,
    ...(defaultValue === undefined ? {} : { defaultValue }),
  };
}

function variant(
  id: string,
  name: string,
  description: string,
  steps: ChainStep[],
  inputs: ScenarioInput[],
  outputs: string[],
  notes: string[] = [],
): ScenarioVariant {
  return { id, name, description, steps, inputs, outputs, notes };
}

function scenario(
  id: string,
  audience: ScenarioAudience,
  name: string,
  summary: string,
  variants: ScenarioVariant[],
): Scenario {
  return { id, audience, name, summary, variants };
}

const outputDirectory = input('output_directory', 'Output directory');

const skillSources: ScenarioSkillSource[] = [
  {
    name: 'minimax-xlsx',
    repository: 'MiniMax-AI/skills',
    repositoryUrl: 'https://github.com/MiniMax-AI/skills',
    skillUrl: 'https://skills.sh/minimax-ai/skills/minimax-xlsx',
    skillFileUrl: 'https://github.com/MiniMax-AI/skills/blob/60aaae52bb2af8162732751a4332f62a5fef518b/skills/minimax-xlsx/SKILL.md',
    revision: '60aaae52bb2af8162732751a4332f62a5fef518b',
    bundled: true,
    license: 'MIT',
    popularity: '3.8K installs',
    installationCommand: 'npx skills add minimax-ai/skills@minimax-xlsx',
    prerequisites: ['Python tooling provided or documented by the skill package.'],
  },
  {
    name: 'minimax-docx',
    repository: 'MiniMax-AI/skills',
    repositoryUrl: 'https://github.com/MiniMax-AI/skills',
    skillUrl: 'https://skills.sh/minimax-ai/skills/minimax-docx',
    skillFileUrl: 'https://github.com/MiniMax-AI/skills/blob/60aaae52bb2af8162732751a4332f62a5fef518b/skills/minimax-docx/SKILL.md',
    revision: '60aaae52bb2af8162732751a4332f62a5fef518b',
    bundled: true,
    license: 'MIT',
    popularity: '4.5K installs',
    installationCommand: 'npx skills add minimax-ai/skills@minimax-docx',
    prerequisites: ['The upstream setup requires .NET/Open XML tooling.'],
  },
  {
    name: 'pptx-generator',
    repository: 'MiniMax-AI/skills',
    repositoryUrl: 'https://github.com/MiniMax-AI/skills',
    skillUrl: 'https://skills.sh/minimax-ai/skills/pptx-generator',
    skillFileUrl:
      'https://github.com/MiniMax-AI/skills/blob/60aaae52bb2af8162732751a4332f62a5fef518b/skills/pptx-generator/SKILL.md',
    revision: '60aaae52bb2af8162732751a4332f62a5fef518b',
    bundled: true,
    license: 'MIT',
    popularity: '6.2K installs',
    installationCommand: 'npx skills add minimax-ai/skills@pptx-generator',
    prerequisites: ['The skill uses PptxGenJS; rendering and visual checks need presentation tooling.'],
  },
  {
    name: 'data-storytelling',
    repository: 'wshobson/agents',
    repositoryUrl: 'https://github.com/wshobson/agents',
    skillUrl: 'https://skills.sh/wshobson/agents/data-storytelling',
    skillFileUrl:
      'https://github.com/wshobson/agents/blob/4bde3168b43c0655c4d00ea2726e631719908a6d/plugins/business-analytics/skills/data-storytelling/SKILL.md',
    revision: '4bde3168b43c0655c4d00ea2726e631719908a6d',
    bundled: true,
    license: 'MIT',
    popularity: '17.4K installs',
    installationCommand: 'npx skills add wshobson/agents@data-storytelling',
    prerequisites: ['Uses the supplied data and figures; validate source figures before sharing.'],
  },
  {
    name: 'market-sizing-analysis',
    repository: 'wshobson/agents',
    repositoryUrl: 'https://github.com/wshobson/agents',
    skillUrl: 'https://skills.sh/wshobson/agents/market-sizing-analysis',
    skillFileUrl:
      'https://github.com/wshobson/agents/blob/4bde3168b43c0655c4d00ea2726e631719908a6d/plugins/startup-business-analyst/skills/market-sizing-analysis/SKILL.md',
    revision: '4bde3168b43c0655c4d00ea2726e631719908a6d',
    bundled: true,
    license: 'MIT',
    popularity: '12.1K installs',
    installationCommand: 'npx skills add wshobson/agents@market-sizing-analysis',
    prerequisites: ['Current market inputs need attributable research; estimates must be labeled.'],
  },
  {
    name: 'pdf',
    repository: 'openai/skills',
    repositoryUrl: 'https://github.com/openai/skills',
    skillUrl: 'https://skills.sh/openai/skills/pdf',
    skillFileUrl: 'https://github.com/openai/skills/blob/49f948faa9258a0c61caceaf225e179651397431/skills/.curated/pdf/SKILL.md',
    revision: '49f948faa9258a0c61caceaf225e179651397431',
    bundled: true,
    license: 'Apache-2.0',
    popularity: '13.6K installs',
    installationCommand: 'npx skills add openai/skills@pdf',
    prerequisites: [
      'PDF workflows use Python PDF libraries.',
      'Poppler is needed for the documented visual rendering check; OCR has extra dependencies.',
    ],
  },
  {
    name: 'literature-review',
    repository: 'K-Dense-AI/scientific-agent-skills',
    repositoryUrl: 'https://github.com/K-Dense-AI/scientific-agent-skills',
    skillUrl:
      'https://skills.sh/k-dense-ai/scientific-agent-skills/literature-review',
    skillFileUrl:
      'https://github.com/K-Dense-AI/scientific-agent-skills/blob/a25cf9ec00e2745d03f8704acf6f6919694ccd9a/skills/literature-review/SKILL.md',
    revision: 'a25cf9ec00e2745d03f8704acf6f6919694ccd9a',
    bundled: true,
    license: 'MIT',
    popularity: '2.5K installs',
    installationCommand:
      'npx skills add k-dense-ai/scientific-agent-skills@literature-review',
    prerequisites: [
      'Targeted literature searches and DOI checks need network access and suitable research databases.',
      'The upstream skill lists optional authenticated features; these examples do not enable them.',
    ],
  },
  {
    name: 'scientific-critical-thinking',
    repository: 'K-Dense-AI/scientific-agent-skills',
    repositoryUrl: 'https://github.com/K-Dense-AI/scientific-agent-skills',
    skillUrl:
      'https://skills.sh/k-dense-ai/scientific-agent-skills/scientific-critical-thinking',
    skillFileUrl:
      'https://github.com/K-Dense-AI/scientific-agent-skills/blob/a25cf9ec00e2745d03f8704acf6f6919694ccd9a/skills/scientific-critical-thinking/SKILL.md',
    revision: 'a25cf9ec00e2745d03f8704acf6f6919694ccd9a',
    bundled: true,
    license: 'MIT',
    popularity: '2.5K installs',
    installationCommand:
      'npx skills add k-dense-ai/scientific-agent-skills@scientific-critical-thinking',
    prerequisites: ['Its evidence-appraisal frameworks concern scientific claims; choose a different review method for humanities.'],
  },
  {
    name: 'vercel-react-best-practices',
    repository: 'vercel-labs/agent-skills',
    repositoryUrl: 'https://github.com/vercel-labs/agent-skills',
    skillUrl:
      'https://skills.sh/vercel-labs/agent-skills/vercel-react-best-practices',
    skillFileUrl:
      'https://github.com/vercel-labs/agent-skills/blob/1a2c79d4e6c4a2283dc2c614b6538cbe1ed5ca62/skills/react-best-practices/SKILL.md',
    revision: '1a2c79d4e6c4a2283dc2c614b6538cbe1ed5ca62',
    bundled: true,
    license: 'MIT',
    popularity: '873.4K installs',
    installationCommand:
      'npx skills add vercel-labs/agent-skills@vercel-react-best-practices',
    prerequisites: ['Targets React and Next.js; follow the existing project architecture.'],
  },
  {
    name: 'vercel-react-native-skills',
    repository: 'vercel-labs/agent-skills',
    repositoryUrl: 'https://github.com/vercel-labs/agent-skills',
    skillUrl:
      'https://skills.sh/vercel-labs/agent-skills/vercel-react-native-skills',
    skillFileUrl:
      'https://github.com/vercel-labs/agent-skills/blob/1a2c79d4e6c4a2283dc2c614b6538cbe1ed5ca62/skills/react-native-skills/SKILL.md',
    revision: '1a2c79d4e6c4a2283dc2c614b6538cbe1ed5ca62',
    bundled: true,
    license: 'MIT',
    popularity: '267.9K installs',
    installationCommand:
      'npx skills add vercel-labs/agent-skills@vercel-react-native-skills',
    prerequisites: ['Targets React Native and Expo; use the existing native test and build setup.'],
  },
  {
    name: 'fastapi-expert',
    repository: 'Jeffallan/claude-skills',
    repositoryUrl: 'https://github.com/Jeffallan/claude-skills',
    skillUrl: 'https://skills.sh/jeffallan/claude-skills/fastapi-expert',
    skillFileUrl:
      'https://github.com/Jeffallan/claude-skills/blob/078a25cc5bfd8011459be7b91d004e900c1d02d3/skills/fastapi-expert/SKILL.md',
    revision: '078a25cc5bfd8011459be7b91d004e900c1d02d3',
    bundled: true,
    license: 'MIT',
    popularity: '6.3K installs',
    installationCommand: 'npx skills add jeffallan/claude-skills@fastapi-expert',
    prerequisites: ['Requires a Python/FastAPI project; use the project’s own validation and test tooling.'],
  },
  {
    name: 'playwright-expert',
    repository: 'Jeffallan/claude-skills',
    repositoryUrl: 'https://github.com/Jeffallan/claude-skills',
    skillUrl: 'https://skills.sh/jeffallan/claude-skills/playwright-expert',
    skillFileUrl:
      'https://github.com/Jeffallan/claude-skills/blob/078a25cc5bfd8011459be7b91d004e900c1d02d3/skills/playwright-expert/SKILL.md',
    revision: '078a25cc5bfd8011459be7b91d004e900c1d02d3',
    bundled: true,
    license: 'MIT',
    popularity: '5.5K installs',
    installationCommand: 'npx skills add jeffallan/claude-skills@playwright-expert',
    prerequisites: ['Browser testing needs Playwright and a project-compatible browser runtime.'],
  },
  {
    name: 'game-developer',
    repository: 'Jeffallan/claude-skills',
    repositoryUrl: 'https://github.com/Jeffallan/claude-skills',
    skillUrl: 'https://skills.sh/jeffallan/claude-skills/game-developer',
    skillFileUrl:
      'https://github.com/Jeffallan/claude-skills/blob/078a25cc5bfd8011459be7b91d004e900c1d02d3/skills/game-developer/SKILL.md',
    revision: '078a25cc5bfd8011459be7b91d004e900c1d02d3',
    bundled: true,
    license: 'MIT',
    popularity: '6.8K installs',
    installationCommand: 'npx skills add jeffallan/claude-skills@game-developer',
    prerequisites: ['Targets Unity/Unreal workflows; use the project’s engine and profiling tools.'],
  },
  {
    name: 'godot-gdscript-patterns',
    repository: 'wshobson/agents',
    repositoryUrl: 'https://github.com/wshobson/agents',
    skillUrl:
      'https://skills.sh/wshobson/agents/godot-gdscript-patterns',
    skillFileUrl:
      'https://github.com/wshobson/agents/blob/4bde3168b43c0655c4d00ea2726e631719908a6d/plugins/game-development/skills/godot-gdscript-patterns/SKILL.md',
    revision: '4bde3168b43c0655c4d00ea2726e631719908a6d',
    bundled: true,
    license: 'MIT',
    popularity: '18K installs',
    installationCommand:
      'npx skills add wshobson/agents@godot-gdscript-patterns',
    prerequisites: ['Targets Godot 4 and GDScript projects.'],
  },
  {
    name: 'unity-ecs-patterns',
    repository: 'wshobson/agents',
    repositoryUrl: 'https://github.com/wshobson/agents',
    skillUrl: 'https://skills.sh/wshobson/agents/unity-ecs-patterns',
    skillFileUrl:
      'https://github.com/wshobson/agents/blob/4bde3168b43c0655c4d00ea2726e631719908a6d/plugins/game-development/skills/unity-ecs-patterns/SKILL.md',
    revision: '4bde3168b43c0655c4d00ea2726e631719908a6d',
    bundled: true,
    license: 'MIT',
    popularity: '12.4K installs',
    installationCommand: 'npx skills add wshobson/agents@unity-ecs-patterns',
    prerequisites: ['Targets Unity DOTS/ECS projects; it is not a default requirement for classic Unity projects.'],
  },
  {
    name: 'phaser',
    repository: 'PlayableIntelligence/game-creator',
    repositoryUrl: 'https://github.com/PlayableIntelligence/game-creator',
    skillUrl:
      'https://skills.sh/playableintelligence/game-creator/phaser',
    skillFileUrl:
      'https://github.com/PlayableIntelligence/game-creator/blob/53676bd2a524989745ce7cbd4128c17e8a20dd3d/skills/phaser/SKILL.md',
    revision: '53676bd2a524989745ce7cbd4128c17e8a20dd3d',
    bundled: true,
    license: 'MIT',
    popularity: '1.4K installs',
    installationCommand:
      'npx skills add playableintelligence/game-creator@phaser',
    prerequisites: [
      'Community-authored Phaser skill with game-creator template/EventBus conventions; check compatibility before use.',
      'Browser game validation needs the project’s Phaser and Playwright setup.',
    ],
  },
];

const performanceInputs = [
  input('source_path', 'Source workbook path'),
  input('reporting_period', 'Reporting period'),
  outputDirectory,
];

function performanceSteps(
  focus: string,
  title: string,
  highlights: string,
): ChainStep[] {
  return [
    instruction(
      'inspect-inputs',
      'Inspect the inputs',
      `Review the supplied ${focus} workbook at {{source_path}} for {{reporting_period}}. Confirm its sheets, source date, units, and KPI definitions. Treat the workbook as read-only; note missing information instead of guessing.`,
    ),
    skill(
      'analyze-workbook',
      'minimax-xlsx',
      'Analyze the workbook',
      `Using the data in {{source_path}}, verify relevant totals and calculations for ${focus} during {{reporting_period}}. Summarize evidence, assumptions, and anomalies in {{output_directory}}/findings.md. Do not edit the source workbook or present estimates as actuals.`,
    ),
    skill(
      'shape-findings',
      'data-storytelling',
      'Build the decision story',
      `Use the verified findings in {{output_directory}}/findings.md to write an executive narrative about ${title.toLowerCase()}. Lead with evidence and action; distinguish observation from recommendation and state important caveats. Save {{output_directory}}/executive-summary.md.`,
    ),
    skill(
      'build-deck',
      'pptx-generator',
      'Prepare a review deck',
      `Create a concise ${highlights} review presentation for {{reporting_period}} using only the verified values in {{output_directory}}/findings.md and {{output_directory}}/executive-summary.md. Save {{output_directory}}/review.pptx. Label assumptions and do not invent facts.`,
    ),
    instruction(
      'review-figures',
      'Review the outputs',
      `Check {{output_directory}}/findings.md, {{output_directory}}/executive-summary.md, and {{output_directory}}/review.pptx against {{source_path}}. Flag every unsupported figure, mismatch, missing unit, or unlabeled estimate. Leave source files unchanged.`,
    ),
  ];
}

function reviewOutputsSteps(kind: string): ChainStep[] {
  return [
    instruction(
      'extract-decisions',
      'Extract decisions and actions',
      `Read the supplied ${kind} notes at {{notes_path}}. Separate decisions, action items, named owners, due dates, and open questions. Do not infer consent, assign an unknown owner, send messages, or fill an absent date.`,
    ),
    skill(
      'build-action-tracker',
      'minimax-xlsx',
      'Create the action tracker',
      `Turn the extracted action items from {{notes_path}} into an editable tracker with one row per action, only source-backed owners and dates, and a column for unknowns. Save {{output_directory}}/actions.xlsx.`,
    ),
    skill(
      'write-minutes',
      'minimax-docx',
      'Write the minutes',
      `Draft concise minutes from {{notes_path}}. Clearly separate decisions, actions, and questions and keep uncertainties visible. Save {{output_directory}}/minutes.docx; do not email, message, or alter the source notes.`,
    ),
    instruction(
      'check-agreement',
      'Cross-check the outputs',
      'Compare {{output_directory}}/actions.xlsx and {{output_directory}}/minutes.docx with {{notes_path}}. Report missing, contradicted, or invented owners, due dates, and decisions in {{output_directory}}/review.md.',
    ),
  ];
}

function proposalSteps(kind: string): ChainStep[] {
  return [
    instruction(
      'define-scope',
      'Define the proposal scope',
      `Review the supplied brief at {{brief_path}} for a ${kind}. Extract the decision, audience, budget constraints, and questions that the brief does not answer. Do not invent customer research or organizational commitments; record assumptions in {{output_directory}}/assumptions.md.`,
    ),
    skill(
      'size-opportunity',
      'market-sizing-analysis',
      'Assess the opportunity',
      `Develop a defensible opportunity estimate for the ${kind}. Distinguish sourced external data from bottom-up assumptions, label the geography and dates, and show uncertainty. Record the sources needed to verify current market data in {{output_directory}}/market-sizing.md.`,
    ),
    skill(
      'model-costs',
      'minimax-xlsx',
      'Model the assumptions',
      `Create an editable scenario workbook using only inputs from {{brief_path}} and the documented assumptions in {{output_directory}}/assumptions.md and {{output_directory}}/market-sizing.md. Label estimates and formulas. Save {{output_directory}}/business-case.xlsx.`,
    ),
    skill(
      'draft-proposal',
      'minimax-docx',
      'Draft the proposal',
      `Write a decision-ready ${kind} proposal using the verified contents of {{brief_path}}, {{output_directory}}/assumptions.md, {{output_directory}}/market-sizing.md, and {{output_directory}}/business-case.xlsx. Separate facts, estimates, and unresolved questions. Save {{output_directory}}/proposal.docx.`,
    ),
    skill(
      'create-presentation',
      'pptx-generator',
      'Prepare a pitch deck',
      `Create a short ${kind} presentation based on {{output_directory}}/proposal.docx and {{output_directory}}/business-case.xlsx. Verify each figure and its units against the workbook. Save {{output_directory}}/pitch.pptx without presenting assumptions as results.`,
    ),
  ];
}

const scenarios: Scenario[] = [
  scenario(
    'business-performance-review',
    'business',
    'Business performance review',
    'Turn a supplied sales, operations, or marketing workbook into a traceable decision narrative and a presentation.',
    [
      variant(
        'sales',
        'Sales',
        'Summarize pipeline or revenue indicators for a review period.',
        performanceSteps('sales', 'sales performance', 'sales'),
        performanceInputs,
        [
          'findings.md - reconciled sales measures and caveats',
          'executive-summary.md - decision narrative',
          'review.pptx - review deck',
        ],
      ),
      variant(
        'operations',
        'Operations',
        'Describe operational volume, timing, and reliability.',
        performanceSteps('operational', 'operational performance', 'operations'),
        performanceInputs,
        [
          'findings.md - verified operational measures and caveats',
          'executive-summary.md - decision narrative',
          'review.pptx - review deck',
        ],
      ),
      variant(
        'marketing',
        'Marketing',
        'Compare campaign or channel measures using supplied attribution definitions.',
        performanceSteps('marketing', 'marketing performance', 'marketing'),
        performanceInputs,
        [
          'findings.md - verified campaign measures and attribution limits',
          'executive-summary.md - decision narrative',
          'review.pptx - review deck',
        ],
        ['Use the reporting team’s supplied attribution model; do not assume platform-reported conversions are causal.'],
      ),
    ],
  ),
  scenario(
    'business-meeting-follow-up',
    'business',
    'Meeting follow-up',
    'Turn internal or customer meeting notes into a draft record and an editable action tracker.',
    [
      variant(
        'internal',
        'Internal meeting',
        'Record internal decisions, action items, owners, and unresolved questions.',
        reviewOutputsSteps('internal meeting'),
        [input('notes_path', 'Meeting notes path'), outputDirectory],
        ['minutes.docx - draft minutes', 'actions.xlsx - editable action tracker', 'review.md - source comparison'],
        ['Draft only: no message is sent and no attendee is assigned an action absent source evidence.'],
      ),
      variant(
        'customer',
        'Customer meeting',
        'Draft a customer-facing meeting record and track promised follow-ups.',
        reviewOutputsSteps('customer meeting'),
        [input('notes_path', 'Meeting notes path'), outputDirectory],
        ['minutes.docx - customer-ready draft', 'actions.xlsx - editable follow-up tracker', 'review.md - source comparison'],
        ['Check confidentiality, commitments, and tone before sharing; this chain never contacts the customer.'],
      ),
    ],
  ),
  scenario(
    'business-proposal',
    'business',
    'Business proposal',
    'Develop an evidence-backed proposal, editable financial assumptions, and a concise pitch deck.',
    [
      variant(
        'investment-case',
        'Investment case',
        'Explain an internal investment decision and its assumptions.',
        proposalSteps('internal investment'),
        [input('brief_path', 'Proposal brief path'), outputDirectory],
        ['assumptions.md - unresolved questions and assumptions', 'market-sizing.md - sourced opportunity estimate', 'business-case.xlsx - scenario model', 'proposal.docx - draft', 'pitch.pptx - presentation'],
      ),
      variant(
        'product-launch',
        'Product launch',
        'Make a business case for launching a product or entering a market.',
        proposalSteps('product launch'),
        [input('brief_path', 'Proposal brief path'), outputDirectory],
        ['assumptions.md - unresolved questions and assumptions', 'market-sizing.md - sourced opportunity estimate', 'business-case.xlsx - scenario model', 'proposal.docx - draft', 'pitch.pptx - presentation'],
        ['Validate market sources and any customer research; the model cannot create evidence not supplied.'],
      ),
    ],
  ),
  scenario(
    'student-revision-pack',
    'student',
    'Study and revision pack',
    'Transform supplied course material into active-recall practice and a source-checked review pack.',
    [
      variant(
        'humanities',
        'Humanities',
        'Review themes, arguments, and supporting evidence.',
        [
          skill('extract-course-material', 'pdf', 'Read course materials', 'Extract text and the relevant structure from the course materials at {{source_path}}. Mark unreadable pages, ambiguous wording, and missing context rather than guessing.'),
          instruction('build-concept-map', 'Build a concept map', 'Using only {{source_path}}, group the principal concepts, arguments, and evidence. Show the connections and note where the supplied material disagrees. Save {{output_directory}}/concept-map.md.'),
          instruction('create-active-recall', 'Create active-recall questions', 'Write short-answer practice questions from {{source_path}} and {{output_directory}}/concept-map.md. Include hints and a separate, clearly labeled answer key with source page or section references. Do not invent quotations or grading criteria. Save {{output_directory}}/practice-questions.md.'),
          skill('create-review-slides', 'pptx-generator', 'Prepare review slides', 'Create a compact humanities review deck from {{output_directory}}/concept-map.md and {{output_directory}}/practice-questions.md. Keep quotations attributed and put answers in speaker notes or a separate ending section. Save {{output_directory}}/review.pptx.'),
          instruction('check-study-pack', 'Check the study pack', 'Verify every claim and answer in {{output_directory}}/concept-map.md, {{output_directory}}/practice-questions.md, and {{output_directory}}/review.pptx against {{source_path}}. List unsupported claims in {{output_directory}}/review.md.'),
        ],
        [input('source_path', 'Course material PDF path'), outputDirectory],
        ['concept-map.md', 'practice-questions.md - with separate answer key', 'review.pptx', 'review.md - source-check findings'],
      ),
      variant(
        'stem',
        'Science and mathematics',
        'Review supplied concepts and scientific evidence critically.',
        [
          skill('extract-course-material', 'pdf', 'Read course materials', 'Extract text, diagrams, tables, and page structure from {{source_path}}. Save the verified extract as {{output_directory}}/course-extract.md. Identify unreadable pages and distinguish transcribed data from inferred meaning.'),
          skill('appraise-evidence', 'scientific-critical-thinking', 'Appraise scientific claims', 'Evaluate the scientific claims in {{output_directory}}/course-extract.md against {{source_path}}. Note study design, uncertainty, limitations, and statistics; do not turn correlation into causation. Save {{output_directory}}/evidence-notes.md.'),
          instruction('build-concept-map', 'Build a concept map', 'Summarize the course concepts in {{source_path}} and {{output_directory}}/evidence-notes.md. Preserve units, equations, and stated assumptions. Save {{output_directory}}/concept-map.md.'),
          instruction('create-active-recall', 'Create active-recall questions', 'Write practice questions from {{source_path}} and {{output_directory}}/concept-map.md. Separate problem statements, hints, worked reasoning, and answers. Reference source pages and do not invent results. Save {{output_directory}}/practice-questions.md.'),
          skill('create-review-slides', 'pptx-generator', 'Prepare review slides', 'Create a revision presentation from {{output_directory}}/concept-map.md, {{output_directory}}/evidence-notes.md, and {{output_directory}}/practice-questions.md. Verify units and numeric values against {{source_path}}. Save {{output_directory}}/review.pptx.'),
          instruction('check-study-pack', 'Check the study pack', 'Verify {{output_directory}}/concept-map.md, {{output_directory}}/evidence-notes.md, {{output_directory}}/practice-questions.md, and {{output_directory}}/review.pptx against {{source_path}}. List unsupported claims, arithmetic errors, or missing units in {{output_directory}}/review.md.'),
        ],
        [input('source_path', 'Course material PDF path'), outputDirectory],
        ['course-extract.md', 'evidence-notes.md', 'concept-map.md', 'practice-questions.md', 'review.pptx', 'review.md - source-check findings'],
        ['Scientific evidence appraisal is specific to the STEM variant; it is not a humanities grading rubric.'],
      ),
      variant(
        'computing',
        'Computing',
        'Review supplied technical material with executable, checkable exercises.',
        [
          skill('extract-course-material', 'pdf', 'Read course materials', 'Extract the structure and technical material from {{source_path}} and save the verified extract as {{output_directory}}/course-extract.md. Keep code, equations, and command text faithful to the source; flag anything the extractor might misread.'),
          instruction('explain-concepts', 'Explain concepts', 'Create plain-language explanations for the main computing concepts in {{output_directory}}/course-extract.md. Include small, clearly labeled illustrative examples and explain any assumptions. Save {{output_directory}}/concept-notes.md.'),
          instruction('create-exercises', 'Create practice exercises', 'Write progressive concept checks and small practice exercises from {{source_path}} and {{output_directory}}/concept-notes.md. Provide hints separately from solutions. Keep optional coding exercises small and ask the learner to write and test their own implementation. Save {{output_directory}}/exercises.md.'),
          skill('create-review-slides', 'pptx-generator', 'Prepare review slides', 'Create a short computing revision deck from {{output_directory}}/concept-notes.md and {{output_directory}}/exercises.md. Do not claim code examples were executed unless the project or learner reports the test. Save {{output_directory}}/review.pptx.'),
          instruction('check-study-pack', 'Check the study pack', 'Cross-check {{output_directory}}/concept-notes.md, {{output_directory}}/exercises.md, and {{output_directory}}/review.pptx against {{source_path}}. List unsupported explanations and any exercise with missing information in {{output_directory}}/review.md.'),
        ],
        [input('source_path', 'Course material PDF path'), outputDirectory],
        ['concept-notes.md', 'exercises.md - separate hints and solutions', 'review.pptx', 'review.md - source-check findings'],
      ),
    ],
  ),
  scenario(
    'student-literature-review',
    'student',
    'Literature review',
    'Build an annotated research outline from a question and a clearly scoped set of academic sources.',
    [
      variant(
        'humanities',
        'Humanities',
        'Compare historical, cultural, or philosophical arguments without imposing a scientific-evidence rubric.',
        [
          instruction('scope-question', 'Scope the question', 'Use {{research_question}} and {{source_paths}} to state the research question, scope, sources, and unresolved terms. Do not claim an exhaustive search when only supplied papers were reviewed. Save {{output_directory}}/search-scope.md.'),
          skill('review-literature', 'literature-review', 'Synthesize the sources', 'Review the works supplied at {{source_paths}} for {{research_question}}. Compare their arguments, contexts, and primary sources; distinguish interpretation from source fact. Record any database searches separately. Save {{output_directory}}/evidence-table.md and {{output_directory}}/literature-review.md.'),
          skill('write-academic-outline', 'minimax-docx', 'Format the outline', 'Create an annotated humanities research outline from {{output_directory}}/search-scope.md, {{output_directory}}/evidence-table.md, and {{output_directory}}/literature-review.md. Preserve source attributions and mark citation-format details that need checking. Save {{output_directory}}/research-outline.docx.'),
          instruction('verify-citations', 'Verify sources and citations', 'Check {{output_directory}}/research-outline.docx against the works in {{source_paths}}. Flag missing page details, unsupported claims, unverified references, and gaps in scope. Save {{output_directory}}/verification.md.'),
        ],
        [input('research_question', 'Research question'), input('source_paths', 'Supplied paper or source paths'), outputDirectory],
        ['search-scope.md', 'evidence-table.md', 'literature-review.md', 'research-outline.docx', 'verification.md'],
        ['Optional web searches and DOI checks need network access; review and attribute the actual search coverage.'],
      ),
      variant(
        'science',
        'Science',
        'Synthesize study designs and limitations alongside scientific findings.',
        [
          instruction('scope-question', 'Scope the question', 'Use {{research_question}} and {{source_paths}} to state the review type, dates, source databases supplied, inclusion boundaries, and missing coverage. Do not present a convenience set as a systematic search. Save {{output_directory}}/search-scope.md.'),
          skill('review-literature', 'literature-review', 'Synthesize the sources', 'Review the papers supplied at {{source_paths}} about {{research_question}}. Record how each paper was located, its method, its findings, and what it does not establish. Do not claim a complete search without a reproducible documented search. Save {{output_directory}}/evidence-table.md and {{output_directory}}/literature-review.md.'),
          skill('appraise-evidence', 'scientific-critical-thinking', 'Assess scientific evidence', 'Evaluate the methods, bias, uncertainty, statistics, and limits of each claim in {{output_directory}}/evidence-table.md. Separate evidence quality from effect size and distinguish association from causation. Save {{output_directory}}/critical-appraisal.md.'),
          skill('write-academic-outline', 'minimax-docx', 'Format the outline', 'Create a scientific research outline from {{output_directory}}/search-scope.md, {{output_directory}}/literature-review.md, and {{output_directory}}/critical-appraisal.md. Preserve citation attribution and mark references that have not been independently checked. Save {{output_directory}}/research-outline.docx.'),
          instruction('verify-citations', 'Verify sources and citations', 'Check every reference and numerical claim in {{output_directory}}/research-outline.docx and {{output_directory}}/critical-appraisal.md against the actual papers in {{source_paths}}. Record missing citation data, uncovered studies, and open questions in {{output_directory}}/verification.md.'),
        ],
        [input('research_question', 'Research question'), input('source_paths', 'Supplied paper paths'), outputDirectory],
        ['search-scope.md', 'evidence-table.md', 'literature-review.md', 'critical-appraisal.md', 'research-outline.docx', 'verification.md'],
        ['Networked database searches and DOI checks require internet access; the skill does not certify search completeness.'],
      ),
      variant(
        'computing',
        'Computing',
        'Compare research methods, implementation contexts, and technical assumptions.',
        [
          instruction('scope-question', 'Scope the question', 'Use {{research_question}} and {{source_paths}} to state the computing domain, evaluation criteria, dates, and gaps in supplied coverage. Save {{output_directory}}/search-scope.md without calling the supplied sources exhaustive.'),
          skill('review-literature', 'literature-review', 'Synthesize the sources', 'Review supplied computing research at {{source_paths}} for {{research_question}}. Compare algorithms, datasets, environments, metrics, and reproducibility details. Do not extrapolate benchmark results beyond their tested setup. Save {{output_directory}}/evidence-table.md and {{output_directory}}/literature-review.md.'),
          skill('write-academic-outline', 'minimax-docx', 'Format the outline', 'Create an annotated computing research outline from {{output_directory}}/search-scope.md, {{output_directory}}/evidence-table.md, and {{output_directory}}/literature-review.md. Preserve all citation attributions and separate claims by context. Save {{output_directory}}/research-outline.docx.'),
          instruction('verify-citations', 'Verify sources and citations', 'Check the technical claims, datasets, metrics, and citations in {{output_directory}}/research-outline.docx against the actual papers in {{source_paths}}. Mark missing implementation or evaluation details as unknown and save {{output_directory}}/verification.md.'),
        ],
        [input('research_question', 'Research question'), input('source_paths', 'Supplied paper paths'), outputDirectory],
        ['search-scope.md', 'evidence-table.md', 'literature-review.md', 'research-outline.docx', 'verification.md'],
        ['Optional search coverage and citation registration checks need network access and suitable databases.'],
      ),
    ],
  ),
  scenario(
    'student-assignment-coach',
    'student',
    'Assignment and lab coach',
    'Turn a supplied rubric into a student-owned plan and constructive draft feedback.',
    [
      variant(
        'humanities',
        'Humanities',
        'Plan a source-based essay without writing the assessed essay for the learner.',
        [
          skill('read-rubric', 'pdf', 'Read the rubric', 'Extract the assignment requirements and grading criteria from {{rubric_path}}. Keep each requirement traceable to a page or section and flag anything that is ambiguous.'),
          instruction('plan-essay', 'Plan the essay', 'Using {{rubric_path}} and {{draft_path}}, create a checklist mapping each rubric requirement to a student-controlled action or a question. Give feedback on argument structure, evidence, and missing citations without supplying a finished replacement essay. Save {{output_directory}}/revision-plan.md.'),
          instruction('review-draft', 'Review the draft', 'Review {{draft_path}} against {{rubric_path}}. Explain two or three high-priority improvements and point to relevant paragraphs. Do not fabricate sources, add quotations, or rewrite the submission on behalf of the student. Save {{output_directory}}/draft-feedback.md.'),
          skill('format-checklist', 'minimax-docx', 'Format the checklist', 'Create an editable rubric checklist from {{output_directory}}/revision-plan.md and {{output_directory}}/draft-feedback.md. Preserve unanswered items as questions. Save {{output_directory}}/rubric-checklist.docx.'),
        ],
        [input('rubric_path', 'Assignment rubric path'), input('draft_path', 'Student draft path'), outputDirectory],
        ['revision-plan.md', 'draft-feedback.md', 'rubric-checklist.docx'],
      ),
      variant(
        'lab',
        'STEM lab',
        'Plan a lab report and inspect supplied data without fabricating results.',
        [
          skill('read-rubric', 'pdf', 'Read the lab rubric', 'Extract report requirements, methodology expectations, units, and data-handling rules from {{rubric_path}}. Record ambiguities and preserve source page references.'),
          skill('inspect-data', 'minimax-xlsx', 'Inspect the supplied data', 'Review the measurements in {{data_path}} without changing the source workbook. Check units, ranges, and formulas; clearly distinguish recorded observations from derived values. Save {{output_directory}}/data-review.md.'),
          instruction('plan-report', 'Plan the report', 'Map {{rubric_path}}, {{draft_path}}, and {{output_directory}}/data-review.md into a lab-report checklist. Identify missing methods, evidence, units, and uncertainty. Do not invent measurements, results, or procedures. Save {{output_directory}}/revision-plan.md.'),
          skill('format-checklist', 'minimax-docx', 'Format the checklist', 'Create an editable checklist from {{output_directory}}/revision-plan.md and {{output_directory}}/data-review.md. Clearly mark student work and unresolved items. Save {{output_directory}}/lab-checklist.docx.'),
          instruction('review-draft', 'Review the student draft', 'Compare {{draft_path}} against {{rubric_path}} and {{output_directory}}/revision-plan.md. Explain the next improvements with paragraph references; never substitute invented or unstated experimental data. Save {{output_directory}}/draft-feedback.md.'),
        ],
        [input('rubric_path', 'Lab rubric path'), input('draft_path', 'Student draft path'), input('data_path', 'Supplied lab data workbook path'), outputDirectory],
        ['data-review.md', 'revision-plan.md', 'lab-checklist.docx', 'draft-feedback.md'],
      ),
      variant(
        'computing',
        'Computing',
        'Plan and review a computing assignment or project report.',
        [
          skill('read-rubric', 'pdf', 'Read the rubric', 'Extract project requirements, deliverables, and assessment criteria from {{rubric_path}} with page or section references. Mark undefined acceptance criteria.'),
          instruction('plan-project', 'Plan the student project', 'Map each requirement in {{rubric_path}} to a small milestone in {{draft_path}}. Suggest testable questions and self-checks instead of completing assessed source code or writing the submitted response. Save {{output_directory}}/revision-plan.md.'),
          instruction('review-draft', 'Review the work', 'Review {{draft_path}} against {{rubric_path}}. Describe gaps and explain how the learner can test a proposed fix in the existing project. Do not claim a test passed unless there is actual test output, and do not write a replacement solution. Save {{output_directory}}/draft-feedback.md.'),
          skill('format-checklist', 'minimax-docx', 'Format the rubric checklist', 'Format the student-owned milestones and checks from {{output_directory}}/revision-plan.md and {{output_directory}}/draft-feedback.md. Save {{output_directory}}/rubric-checklist.docx.'),
        ],
        [input('rubric_path', 'Assignment rubric path'), input('draft_path', 'Student draft or project-notes path'), outputDirectory],
        ['revision-plan.md', 'draft-feedback.md', 'rubric-checklist.docx'],
      ),
    ],
  ),
];

function appMvpSteps(
  skillName: string,
  variantName: string,
  includesBrowserTests: boolean,
): ChainStep[] {
  return [
    instruction(
      'scope-requirements',
      'Define the MVP',
      'Inspect the brief at {{brief_path}}. Ask what is unclear, record the target users and one core journey, and turn confirmed needs into acceptance criteria in {{output_directory}}/acceptance-criteria.md. Separate requirements from assumptions.',
    ),
    instruction(
      'inspect-project',
      'Inspect the project',
      `Inspect the existing ${variantName} project at {{project_path}}. Identify its actual framework, architecture, development commands, existing test commands, and constraints before proposing changes. Do not replace project tooling.`,
    ),
    skill(
      'implement-slice',
      skillName,
      'Implement the first slice',
      `Using the verified project conventions, implement one narrow ${variantName} path from {{brief_path}} that satisfies {{output_directory}}/acceptance-criteria.md. Keep dependencies minimal and summarize code changes in {{output_directory}}/implementation-notes.md.`,
    ),
    instruction(
      'test-implementation',
      'Run existing checks',
      `Run only the existing project checks that apply to {{project_path}}. Add focused regression cases for the accepted slice. Record exact commands and observed results in {{output_directory}}/test-results.md; never claim an unrun test passed.`,
    ),
    ...(includesBrowserTests
      ? [
          skill(
            'verify-browser-flow',
            'playwright-expert',
            'Verify the browser journey',
            'Use the project’s installed browser-test setup to exercise the primary accepted path from {{output_directory}}/acceptance-criteria.md. Verify observable behavior and report failed, untested, or environment-dependent cases in {{output_directory}}/browser-results.md.',
          ),
        ]
      : []),
    instruction(
      'document-limits',
      'Document the slice',
      'Review the code and actual test outputs. Write how to start and verify this slice, any open questions, and known limitations in {{output_directory}}/handoff.md. Do not publish, deploy, or overstate readiness.',
    ),
  ];
}

function appFeatureSteps(skillName: string, platform: string, browser: boolean): ChainStep[] {
  return [
    instruction(
      'define-acceptance',
      'Define acceptance cases',
      'Read {{feature_path}} and inspect {{project_path}}. Write testable success, error, and boundary cases for the requested feature in {{output_directory}}/acceptance-cases.md. Identify open decisions before coding.',
    ),
    skill(
      'implement-feature',
      skillName,
      'Implement the feature',
      `Implement the smallest maintainable ${platform} change that satisfies {{output_directory}}/acceptance-cases.md. Follow existing project patterns; preserve unrelated behavior. Summarize changed surfaces and assumptions in {{output_directory}}/implementation.md.`,
    ),
    instruction(
      'run-tests',
      'Run focused tests',
      'Run the project’s existing targeted unit and integration checks for {{output_directory}}/acceptance-cases.md. Add focused regression cases where the repository has a suitable test pattern. Record actual commands and outcomes in {{output_directory}}/test-results.md.',
    ),
    ...(browser
      ? [
          skill(
            'test-ui',
            'playwright-expert',
            'Test the browser path',
            'Exercise the changed browser journey using the existing project Playwright setup. Include the confirmed success and relevant failure or empty state. Record real results in {{output_directory}}/browser-results.md; do not call a missing runtime a passing test.',
          ),
        ]
      : []),
    instruction(
      'check-docs',
      'Review the handoff',
      'Compare the implementation with {{feature_path}}, {{output_directory}}/acceptance-cases.md, and {{output_directory}}/test-results.md. List remaining gaps and notes for reviewers in {{output_directory}}/handoff.md. Do not commit, push, publish, or deploy.',
    ),
  ];
}

function appReleaseSteps(skillName: string, label: string, browser: boolean): ChainStep[] {
  return [
    instruction(
      'scope-release',
      'Scope the readiness review',
      'Inspect {{project_path}} and the supplied release scope at {{release_scope_path}}. Confirm the actual release boundary, build/test commands, supported targets, and existing release checklist. Save the verified scope and unknowns in {{output_directory}}/readiness.md.',
    ),
    skill(
      'review-platform',
      skillName,
      `Review ${label} concerns`,
      `Review the changed ${label} surfaces identified in {{output_directory}}/readiness.md for relevant architecture, accessibility, platform, and performance risks. Use repository evidence and actual measurements; list unverified assumptions in {{output_directory}}/review-findings.md.`,
    ),
    instruction(
      'run-release-checks',
      'Run release checks',
      'Run the existing, relevant build, type-check, and test commands for {{project_path}}. Record commands, results, and environment limitations in {{output_directory}}/release-test-results.md. Do not claim a security audit or complete compatibility from a smoke test.',
    ),
    ...(browser
      ? [
          skill(
            'verify-critical-journeys',
            'playwright-expert',
            'Check critical browser journeys',
            'Use the project’s existing Playwright setup to test its actual critical browser journeys and a representative error state. Record observed results in {{output_directory}}/journey-results.md.',
          ),
        ]
      : []),
    instruction(
      'write-checklist',
      'Prepare the release checklist',
      'Using the supplied scope and actual results in {{output_directory}}, write a human-reviewed release checklist, unresolved blocker list, and draft release note. Do not change release configuration or perform a release. Save {{output_directory}}/release-checklist.md and {{output_directory}}/release-notes.md.',
    ),
  ];
}

const appInputs = [
  input('project_path', 'Registered project path'),
  input('brief_path', 'Brief or feature description path'),
  outputDirectory,
];

const releaseInputs = [
  input('project_path', 'Registered project path'),
  input('release_scope_path', 'Release scope path'),
  outputDirectory,
];

const scenariosApps: Scenario[] = [
  scenario(
    'app-mvp',
    'app-developer',
    'App MVP',
    'Build one scoped application journey against an existing brief and repository conventions.',
    [
      variant(
        'react-web',
        'React or Next.js web',
        'Implement and browser-test one usable web path.',
        appMvpSteps('vercel-react-best-practices', 'React or Next.js web', true),
        appInputs,
        ['acceptance-criteria.md', 'implementation-notes.md', 'test-results.md', 'browser-results.md', 'handoff.md'],
        ['Requires an existing project and Playwright/browser environment for browser tests.'],
      ),
      variant(
        'react-native',
        'React Native or Expo',
        'Implement one mobile flow with the project’s actual device test setup.',
        appMvpSteps('vercel-react-native-skills', 'React Native or Expo', false),
        appInputs,
        ['acceptance-criteria.md', 'implementation-notes.md', 'test-results.md', 'handoff.md'],
        ['Browser Playwright does not verify native UI or device behavior.'],
      ),
      variant(
        'fastapi',
        'Python API',
        'Implement one endpoint or service journey in an existing FastAPI project.',
        appMvpSteps('fastapi-expert', 'Python/FastAPI API', false),
        appInputs,
        ['acceptance-criteria.md', 'implementation-notes.md', 'test-results.md', 'handoff.md'],
        ['Requires an existing FastAPI/Python project and its Python test environment.'],
      ),
    ],
  ),
  scenario(
    'app-feature-delivery',
    'app-developer',
    'Feature or API delivery',
    'Inspect an existing codebase, implement one bounded change, and capture real regression results.',
    [
      variant(
        'react-web',
        'React or Next.js web',
        'Deliver a web feature with a browser-level regression check.',
        appFeatureSteps('vercel-react-best-practices', 'React/Next.js web feature', true),
        [input('project_path', 'Registered project path'), input('feature_path', 'Feature request path'), outputDirectory],
        ['acceptance-cases.md', 'implementation.md', 'test-results.md', 'browser-results.md', 'handoff.md'],
      ),
      variant(
        'react-native',
        'React Native or Expo',
        'Deliver a native feature using existing native-tooling checks.',
        appFeatureSteps('vercel-react-native-skills', 'React Native/Expo', false),
        [input('project_path', 'Registered project path'), input('feature_path', 'Feature request path'), outputDirectory],
        ['acceptance-cases.md', 'implementation.md', 'test-results.md', 'handoff.md'],
        ['Run device/emulator tests using the repository’s setup; Playwright web tests do not verify native behavior.'],
      ),
      variant(
        'fastapi',
        'Python API',
        'Deliver a FastAPI feature with focused endpoint or service regression tests.',
        appFeatureSteps('fastapi-expert', 'Python/FastAPI service', false),
        [input('project_path', 'Registered project path'), input('feature_path', 'Feature request path'), outputDirectory],
        ['acceptance-cases.md', 'implementation.md', 'test-results.md', 'handoff.md'],
      ),
    ],
  ),
  scenario(
    'app-release-readiness',
    'app-developer',
    'App release-readiness review',
    'Prepare an evidence-backed review and checklist without changing deployment or release state.',
    [
      variant(
        'react-web',
        'React or Next.js web',
        'Review web quality and representative browser journeys.',
        appReleaseSteps('vercel-react-best-practices', 'React/Next.js web', true),
        releaseInputs,
        ['readiness.md', 'review-findings.md', 'release-test-results.md', 'journey-results.md', 'release-checklist.md', 'release-notes.md'],
      ),
      variant(
        'react-native',
        'React Native or Expo',
        'Review native UI quality and app-specific checks.',
        appReleaseSteps('vercel-react-native-skills', 'React Native/Expo', false),
        releaseInputs,
        ['readiness.md', 'review-findings.md', 'release-test-results.md', 'release-checklist.md', 'release-notes.md'],
        ['Verify device, store, and native packaging checks using the app’s actual tooling.'],
      ),
      variant(
        'fastapi',
        'Python API',
        'Review API behavior and the repository’s own release gates.',
        appReleaseSteps('fastapi-expert', 'Python/FastAPI', false),
        releaseInputs,
        ['readiness.md', 'review-findings.md', 'release-test-results.md', 'release-checklist.md', 'release-notes.md'],
        ['This is not a security certification or live production integration check.'],
      ),
    ],
  ),
];

function gamePrototypeSteps(
  engineName: string,
  gameSkill: string,
  browser: boolean,
): ChainStep[] {
  return [
    instruction(
      'scope-gameplay',
      'Scope a playable loop',
      'Read {{game_brief_path}}. Reduce it to one player action, one response, and one win or loss condition. Record target platform, controls, art placeholders, and open design questions in {{output_directory}}/prototype-scope.md. Do not assume asset or distribution rights.',
    ),
    instruction(
      'inspect-game-project',
      'Inspect the engine project',
      `Inspect {{project_path}} and confirm it is a ${engineName} project. Read the existing scene, input, and build/test conventions. Propose the smallest change that fits; do not create an alternate engine project.`,
    ),
    skill(
      'implement-play-loop',
      gameSkill,
      'Implement the core loop',
      `Implement the smallest playable ${engineName} loop described in {{output_directory}}/prototype-scope.md in {{project_path}}. Focus first on the action, response, and win/lose state. Follow the actual project conventions and document the modified scenes/files in {{output_directory}}/prototype-notes.md.`,
    ),
    instruction(
      'test-gameplay',
      'Test the game loop',
      `Use the project's existing ${engineName} controls and test tooling to try the normal path, a boundary case, and a restart. Record the real platform, observed state, missing setup, and reproducible steps in {{output_directory}}/playtest.md.`,
    ),
    ...(browser
      ? [
          skill(
            'verify-browser-game',
            'playwright-expert',
            'Verify the browser prototype',
            'Use the existing project Playwright browser setup to verify the playable entry, one meaningful player action, and a restart. Record which browsers and local setup were actually tested in {{output_directory}}/browser-playtest.md.',
          ),
        ]
      : []),
    instruction(
      'prepare-playtest',
      'Prepare a playtest handoff',
      'Write concise setup, controls, the intended player path, observed limitations, and playtest questions in {{output_directory}}/playtest-guide.md. Distinguish a developer smoke test from player research.',
    ),
  ];
}

function gameSystemSteps(gameSkill: string, engineName: string): ChainStep[] {
  return [
    instruction(
      'specify-system',
      'Specify the game system',
      'Read {{system_brief_path}} and the relevant project code in {{project_path}}. State the gameplay behavior, state transitions, save/load expectations, edge cases, and engine version before implementation. Save {{output_directory}}/system-spec.md.',
    ),
    skill(
      'implement-system',
      gameSkill,
      'Implement the bounded system',
      `Implement the requested ${engineName} system in {{project_path}} to match {{output_directory}}/system-spec.md. Follow local code and scene conventions. Avoid broad architecture changes that are not required. Summarize modified files and remaining questions in {{output_directory}}/implementation.md.`,
    ),
    instruction(
      'verify-system',
      'Verify behavior and persistence',
      `Use the available ${engineName} project checks to verify the states, transitions, reload/restart behavior, and relevant failure cases from {{output_directory}}/system-spec.md. Report the exact tools and observed results in {{output_directory}}/test-results.md.`,
    ),
    instruction(
      'document-system',
      'Document the system handoff',
      'Compare the implementation with {{system_brief_path}} and {{output_directory}}/system-spec.md. Document integration steps, confirmed results, and unresolved edge cases in {{output_directory}}/system-handoff.md.',
    ),
  ];
}

function gamePerformanceSteps(gameSkill: string, engineName: string): ChainStep[] {
  return [
    instruction(
      'define-budget',
      'Set a measurable performance target',
      'Review {{project_path}} and {{performance_brief_path}}. Record target hardware, scene, frame-time/memory budget, workload, and engine version in {{output_directory}}/performance-plan.md. Avoid universal FPS promises.',
    ),
    skill(
      'inspect-performance',
      gameSkill,
      'Review engine performance',
      `Inspect the ${engineName} code and profiling evidence supplied at {{performance_brief_path}}. Relate possible bottlenecks to measured workloads and platform targets; do not claim a profile was run without real results. Save {{output_directory}}/performance-findings.md.`,
    ),
    instruction(
      'optimize',
      'Make a bounded optimization',
      'If profiling data identifies an issue, propose or make the smallest reversible change in {{project_path}} that addresses it. Preserve a clear before/after workload and exact metric in {{output_directory}}/optimization-results.md. If no measurements were supplied, produce a profiling plan instead of guessing at a fix.',
    ),
    instruction(
      'validate-build',
      'Validate game checks',
      `Run the relevant existing ${engineName} build/test checks and repeat the same measured workload if profiling support is available. Record failures, resource constraints, and the actual before/after result in {{output_directory}}/build-results.md.`,
    ),
    instruction(
      'prepare-release',
      'Prepare a release checklist',
      'Draft a manual build checklist and release notes from the measured findings in {{output_directory}}. Include supported targets, open bugs, and checks still requiring a human. Do not build an upload, publish to a store, or claim shipping readiness.',
    ),
  ];
}

const gameBriefInputs = [
  input('project_path', 'Engine project path'),
  input('game_brief_path', 'Game idea or prototype brief path'),
  outputDirectory,
];

const systemInputs = [
  input('project_path', 'Engine project path'),
  input('system_brief_path', 'Gameplay system request path'),
  outputDirectory,
];

const performanceInputsGame = [
  input('project_path', 'Engine project path'),
  input('performance_brief_path', 'Profile data or performance goal path'),
  outputDirectory,
];

const scenariosGames: Scenario[] = [
  scenario(
    'game-playable-prototype',
    'game-developer',
    'Playable game prototype',
    'Turn one mechanic into a small, testable game loop in the engine the project already uses.',
    [
      variant(
        'phaser-browser',
        'Phaser browser game',
        'Prototype one browser game path and browser-check it.',
        gamePrototypeSteps('Phaser 3', 'phaser', true),
        gameBriefInputs,
        ['prototype-scope.md', 'prototype-notes.md', 'playtest.md', 'browser-playtest.md', 'playtest-guide.md'],
        ['Community Phaser skill uses the game-creator template/EventBus conventions. Check upstream assumptions before adapting.'],
      ),
      variant(
        'godot-4',
        'Godot 4',
        'Prototype in a GDScript project with Godot-native checks.',
        gamePrototypeSteps('Godot 4/GDScript', 'godot-gdscript-patterns', false),
        gameBriefInputs,
        ['prototype-scope.md', 'prototype-notes.md', 'playtest.md', 'playtest-guide.md'],
      ),
      variant(
        'unity-classic',
        'Unity',
        'Prototype in the project’s existing Unity architecture.',
        gamePrototypeSteps('Unity', 'game-developer', false),
        gameBriefInputs,
        ['prototype-scope.md', 'prototype-notes.md', 'playtest.md', 'playtest-guide.md'],
        ['The general Unity skill does not require the project to use ECS/DOTS.'],
      ),
      variant(
        'unity-dots',
        'Unity DOTS/ECS',
        'Prototype in a Unity project that already uses DOTS/ECS.',
        gamePrototypeSteps('Unity DOTS/ECS', 'unity-ecs-patterns', false),
        gameBriefInputs,
        ['prototype-scope.md', 'prototype-notes.md', 'playtest.md', 'playtest-guide.md'],
        ['Use only when the project already targets Unity Entities/DOTS.'],
      ),
      variant(
        'unreal',
        'Unreal Engine',
        'Prototype within the existing Unreal Engine project.',
        gamePrototypeSteps('Unreal Engine', 'game-developer', false),
        gameBriefInputs,
        ['prototype-scope.md', 'prototype-notes.md', 'playtest.md', 'playtest-guide.md'],
      ),
    ],
  ),
  scenario(
    'gameplay-system',
    'game-developer',
    'Gameplay system implementation',
    'Build one bounded gameplay feature and verify its state, edge cases, and persistence.',
    [
      variant(
        'godot-4',
        'Godot 4',
        'Implement a scene-aware GDScript mechanic or stateful game system.',
        gameSystemSteps('godot-gdscript-patterns', 'Godot 4/GDScript'),
        systemInputs,
        ['system-spec.md', 'implementation.md', 'test-results.md', 'system-handoff.md'],
      ),
      variant(
        'unity-classic',
        'Unity',
        'Implement within the project’s existing Unity architecture.',
        gameSystemSteps('game-developer', 'Unity'),
        systemInputs,
        ['system-spec.md', 'implementation.md', 'test-results.md', 'system-handoff.md'],
        ['Does not assume DOTS/ECS or authorize an architecture rewrite.'],
      ),
      variant(
        'unity-dots',
        'Unity DOTS/ECS',
        'Implement a system for an existing data-oriented Entities project.',
        gameSystemSteps('unity-ecs-patterns', 'Unity DOTS/ECS'),
        systemInputs,
        ['system-spec.md', 'implementation.md', 'test-results.md', 'system-handoff.md'],
        ['Requires the project to already use Unity DOTS/ECS.'],
      ),
      variant(
        'unreal',
        'Unreal Engine',
        'Implement one system within the project’s Unreal Engine conventions.',
        gameSystemSteps('game-developer', 'Unreal Engine'),
        systemInputs,
        ['system-spec.md', 'implementation.md', 'test-results.md', 'system-handoff.md'],
      ),
    ],
  ),
  scenario(
    'game-performance-release',
    'game-developer',
    'Game performance and release check',
    'Use a measured workload to plan a bounded optimization and a human-reviewed release checklist.',
    [
      variant(
        'godot-4',
        'Godot 4',
        'Review a GDScript profile or produce a reproducible measurement plan.',
        gamePerformanceSteps('godot-gdscript-patterns', 'Godot 4/GDScript'),
        performanceInputsGame,
        ['performance-plan.md', 'performance-findings.md', 'optimization-results.md', 'build-results.md', 'release checklist and draft notes'],
      ),
      variant(
        'unity-classic',
        'Unity',
        'Use Unity’s own profiler and existing architecture.',
        gamePerformanceSteps('game-developer', 'Unity'),
        performanceInputsGame,
        ['performance-plan.md', 'performance-findings.md', 'optimization-results.md', 'build-results.md', 'release checklist and draft notes'],
        ['Use the Unity profiler to measure; general engine advice cannot replace a profile.'],
      ),
      variant(
        'unity-dots',
        'Unity DOTS/ECS',
        'Review measured DOTS workloads in an existing Unity Entities project.',
        gamePerformanceSteps('unity-ecs-patterns', 'Unity DOTS/ECS'),
        performanceInputsGame,
        ['performance-plan.md', 'performance-findings.md', 'optimization-results.md', 'build-results.md', 'release checklist and draft notes'],
        ['Requires an existing Entities/DOTS architecture and a representative workload.'],
      ),
      variant(
        'unreal',
        'Unreal Engine',
        'Review an Unreal trace/profile and prepare an engine-specific checklist.',
        gamePerformanceSteps('game-developer', 'Unreal Engine'),
        performanceInputsGame,
        ['performance-plan.md', 'performance-findings.md', 'optimization-results.md', 'build-results.md', 'release checklist and draft notes'],
        ['Use Unreal Insights and actual target hardware for measured performance conclusions.'],
      ),
      variant(
        'phaser-browser',
        'Phaser browser game',
        'Review a measured browser-game workload and browser-check it.',
        [
          ...gamePerformanceSteps('phaser', 'Phaser 3 browser game').slice(0, 3),
          skill('verify-browser-game', 'playwright-expert', 'Check the browser game', 'Use the existing browser-test setup to exercise a representative game path and compare observed performance only under the workload in {{output_directory}}/performance-plan.md. Record the actual runtime and results in {{output_directory}}/browser-results.md.'),
          ...gamePerformanceSteps('phaser', 'Phaser 3 browser game').slice(3),
        ],
        performanceInputsGame,
        ['performance-plan.md', 'performance-findings.md', 'optimization-results.md', 'browser-results.md', 'build-results.md', 'release checklist and draft notes'],
        ['The Phaser skill has upstream template assumptions. Profile browser behavior in the target browsers.'],
      ),
    ],
  ),
];

export const scenarioCatalog: ScenarioCatalog = {
  message:
    'These are sample chain recipes for inspiration, not prescriptions, endorsements, or a complete list. Skill Loom curates the workflows; the linked skills are independently authored by their upstream maintainers.',
  skills: skillSources,
  scenarios: [...scenarios, ...scenariosApps, ...scenariosGames],
};

export function scenarioSkillPackagePath(skillName: string): string | undefined {
  if (!scenarioCatalog.skills.some((source) => source.name === skillName)) {
    return undefined;
  }
  return join(
    dirname(fileURLToPath(import.meta.url)),
    'scenario-skills',
    skillName,
  );
}
