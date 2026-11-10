# Scenario chain examples

The scenario catalog offers starter chain examples for business users, students, app developers, and game developers. They are intended to spark ideas about what can be chained—not prescriptions, endorsements, compatibility guarantees, or a complete list of possible workflows. Adapt, rearrange, replace, or extend them for your own work.

Skill Loom curates the example sequences and their original orchestration instructions. Any named skills are independently authored third-party packages; selected upstream packages are bundled as pinned snapshots for optional, explicit project copying. Their authors have not endorsed these recipes. The catalog data links to each upstream project and skill listing and shows the source revision, reviewed license, approximate skills.sh popularity snapshot, prerequisites, and an alternative upstream install command. Popularity is not a quality or safety assessment. The [bundled-package notice](../src/server/chains/scenario-skills/THIRD_PARTY_NOTICES.md) records the source revisions and license evidence.

## Browse, adapt, and copy

The scenario catalog has no web screen. Read the examples below, or read the catalog JSON from a running service with `curl http://127.0.0.1:7373/api/chain-presets`. Skill Loom is CLI- and skill-driven; see the [user guide](user-guide.md).

1. Pick a variant and review its ordered steps, named inputs, example outputs, prerequisites, and third-party sources.
2. Create your own copy as a draft: send a chain draft object with the example's steps and inputs to `skill-loom chain draft create` (JSON on stdin), and check it with `chain draft validate`. Ask an agent with the `scenario-discovery` skill to do this for you if you prefer.
3. Run `skill-loom edit --draft <id>` to tailor the instructions, inspect the inputs and skill names, reorder steps, and **Save chain**. A copied recipe is an ordinary, independent chain; later edits do not change the catalog or another copy.
4. To use a bundled skill, install the upstream package yourself or include it in a bundle (`skill-loom bundle create`, then `bundle review` and `bundle import`). Review the upstream source and license first. A bundled package carries a `SKILL-LOOM-SOURCE.md` attribution notice; no package scripts run and the publisher is not contacted.
5. Before running, provide required inputs and run preflight. A missing or disabled skill blocks the run. Skill discovery does not guarantee that the model or harness will invoke it.

**Copying an example only creates a chain.** It does not add skill files, run installation commands, contact a registry or skill author, start a run, or grant broad permissions. Adding a skill is a separate, explicit action. If a skill with the same name is already present in the project's catalog—including a disabled or ambiguous entry—resolve or rename it before importing another copy. Example chains default to a shared session, and automatic broad-permission consent remains off. Review all instructions and project changes, preferably in supervised mode.

The `output_directory` input used by many examples names where prompts should put artifacts; it does not cause Skill Loom to create that directory or automatically pass typed outputs between steps. Prompts ask later steps to read named artifacts from earlier steps, but verify those files and results yourself.

## Example scenarios

These are adaptable starting compositions. The catalog contains the full step text and notes; variants intentionally use instruction steps when orchestration, human review, tutoring, or checks are not a suitable third-party skill.

| Audience | Example | Variants and skill dependencies |
|---|---|---|
| Business | **Business performance review** | Sales, operations, or marketing workbook → executive review. Uses `minimax-xlsx`, `data-storytelling`, and `pptx-generator`; keep the source workbook unchanged and distinguish estimates from observed values. |
| Business | **Meeting follow-up** | Internal or customer meeting notes → draft minutes and action tracker. Uses `minimax-xlsx` and `minimax-docx`; does not send messages or invent owners, dates, decisions, or consent. |
| Business | **Business proposal** | Internal investment case or product launch → assumptions, business case, proposal, and pitch deck. Uses `market-sizing-analysis`, `minimax-xlsx`, `minimax-docx`, and `pptx-generator`; verify market evidence and label estimates. |
| Student | **Study and revision pack** | Humanities, science and mathematics, or computing material → source-checked study aids and review slides. Uses `pdf` and `pptx-generator`; the STEM variant also uses `scientific-critical-thinking`. |
| Student | **Literature review** | Humanities, science, or computing question → evidence table and annotated outline. Uses `literature-review` and `minimax-docx`; the science variant also uses `scientific-critical-thinking`. Search and DOI checks may need network access. |
| Student | **Assignment and lab coach** | Humanities essay, STEM lab, or computing assignment → student-owned plan and feedback. Uses `pdf` and `minimax-docx`; the lab variant also uses `minimax-xlsx`. It is designed to coach rather than produce a finished assessed submission. |
| App developer | **App MVP** | React/Next.js web, React Native/Expo, or Python/FastAPI → one scoped journey in an existing project. Uses `vercel-react-best-practices`, `vercel-react-native-skills`, or `fastapi-expert`, respectively; the browser variant also uses `playwright-expert`. Browser Playwright checks do not verify native UI. |
| App developer | **Feature or API delivery** | React/Next.js web, React Native/Expo, or Python/FastAPI → a bounded feature and focused regression checks. Uses the corresponding framework skill above; the web variant also uses `playwright-expert`. Uses the project's existing tools rather than replacing them. |
| App developer | **App release-readiness review** | React/Next.js web, React Native/Expo, or Python/FastAPI → evidence-backed review and manual checklist. Uses the corresponding framework skill above; the web variant also uses `playwright-expert`. This is not a security certification or deployment. |
| Game developer | **Playable game prototype** | Phaser browser game, Godot 4, Unity, Unity DOTS/ECS, or Unreal Engine → one playable loop and playtest guide. Uses `phaser` and `playwright-expert`, `godot-gdscript-patterns`, `game-developer`, `unity-ecs-patterns`, or `game-developer`, respectively. The Phaser skill assumes game-creator template/EventBus conventions. |
| Game developer | **Gameplay system implementation** | Godot 4, Unity, Unity DOTS/ECS, or Unreal Engine → a bounded feature and edge-case checks. Uses `godot-gdscript-patterns`, `game-developer`, `unity-ecs-patterns`, or `game-developer`, respectively. DOTS/ECS variants are only for projects already using that architecture. |
| Game developer | **Game performance and release check** | Godot 4, Unity, Unity DOTS/ECS, Unreal Engine, or Phaser browser game → measured profile, bounded optimization, and release checklist. Uses the corresponding engine skill above; Phaser also uses `playwright-expert`. Record actual measurements rather than asserting FPS or performance gains. |

Game examples do not generate paid assets, assume asset rights, promise a frame rate, or publish a build. Engine editors, target devices, browsers, packages, and test tools must be available and appropriate for the actual project.

## Third-party skill sources

The commands below are displayed for reference only; Skill Loom does not run them. Review upstream contents, license terms, and prerequisites, then use the command only if you choose to install that skill for your selected harness and project/global scope. Some skills depend on external tools or runtimes; see their upstream documentation.

| Skill | Upstream source | License | Alternative upstream install command |
|---|---|---|---|
| `minimax-xlsx` | [MiniMax-AI/skills](https://github.com/MiniMax-AI/skills) · [listing](https://skills.sh/minimax-ai/skills/minimax-xlsx) | MIT | `npx skills add minimax-ai/skills@minimax-xlsx` |
| `minimax-docx` | [MiniMax-AI/skills](https://github.com/MiniMax-AI/skills) · [listing](https://skills.sh/minimax-ai/skills/minimax-docx) | MIT | `npx skills add minimax-ai/skills@minimax-docx` |
| `pptx-generator` | [MiniMax-AI/skills](https://github.com/MiniMax-AI/skills) · [listing](https://skills.sh/minimax-ai/skills/pptx-generator) | MIT | `npx skills add minimax-ai/skills@pptx-generator` |
| `data-storytelling` | [wshobson/agents](https://github.com/wshobson/agents) · [listing](https://skills.sh/wshobson/agents/data-storytelling) | MIT | `npx skills add wshobson/agents@data-storytelling` |
| `market-sizing-analysis` | [wshobson/agents](https://github.com/wshobson/agents) · [listing](https://skills.sh/wshobson/agents/market-sizing-analysis) | MIT | `npx skills add wshobson/agents@market-sizing-analysis` |
| `pdf` | [openai/skills](https://github.com/openai/skills) · [listing](https://skills.sh/openai/skills/pdf) | Apache-2.0 | `npx skills add openai/skills@pdf` |
| `literature-review` | [K-Dense-AI/scientific-agent-skills](https://github.com/K-Dense-AI/scientific-agent-skills) · [listing](https://skills.sh/k-dense-ai/scientific-agent-skills/literature-review) | MIT | `npx skills add k-dense-ai/scientific-agent-skills@literature-review` |
| `scientific-critical-thinking` | [K-Dense-AI/scientific-agent-skills](https://github.com/K-Dense-AI/scientific-agent-skills) · [listing](https://skills.sh/k-dense-ai/scientific-agent-skills/scientific-critical-thinking) | MIT | `npx skills add k-dense-ai/scientific-agent-skills@scientific-critical-thinking` |
| `vercel-react-best-practices` | [vercel-labs/agent-skills](https://github.com/vercel-labs/agent-skills) · [listing](https://skills.sh/vercel-labs/agent-skills/vercel-react-best-practices) | MIT | `npx skills add vercel-labs/agent-skills@vercel-react-best-practices` |
| `vercel-react-native-skills` | [vercel-labs/agent-skills](https://github.com/vercel-labs/agent-skills) · [listing](https://skills.sh/vercel-labs/agent-skills/vercel-react-native-skills) | MIT | `npx skills add vercel-labs/agent-skills@vercel-react-native-skills` |
| `fastapi-expert` | [Jeffallan/claude-skills](https://github.com/Jeffallan/claude-skills) · [listing](https://skills.sh/jeffallan/claude-skills/fastapi-expert) | MIT | `npx skills add jeffallan/claude-skills@fastapi-expert` |
| `playwright-expert` | [Jeffallan/claude-skills](https://github.com/Jeffallan/claude-skills) · [listing](https://skills.sh/jeffallan/claude-skills/playwright-expert) | MIT | `npx skills add jeffallan/claude-skills@playwright-expert` |
| `godot-gdscript-patterns` | [wshobson/agents](https://github.com/wshobson/agents) · [listing](https://skills.sh/wshobson/agents/godot-gdscript-patterns) | MIT | `npx skills add wshobson/agents@godot-gdscript-patterns` |
| `unity-ecs-patterns` | [wshobson/agents](https://github.com/wshobson/agents) · [listing](https://skills.sh/wshobson/agents/unity-ecs-patterns) | MIT | `npx skills add wshobson/agents@unity-ecs-patterns` |
| `game-developer` | [Jeffallan/claude-skills](https://github.com/Jeffallan/claude-skills) · [listing](https://skills.sh/jeffallan/claude-skills/game-developer) | MIT | `npx skills add jeffallan/claude-skills@game-developer` |
| `phaser` | [PlayableIntelligence/game-creator](https://github.com/PlayableIntelligence/game-creator) · [listing](https://skills.sh/playableintelligence/game-creator/phaser) | MIT | `npx skills add playableintelligence/game-creator@phaser` |

The bundled source revisions are pinned and included in the application package; Skill Loom does not fetch updates at runtime. Review the linked upstream `SKILL.md`, repository, license files, and prerequisites before copying or using a package. Bundling does not certify third-party scripts, compatibility with every project, security, or generated output. Some packages declare a license in their `SKILL.md` without a separate license text in the selected package directory; this is called out in the [bundled-package notice](../src/server/chains/scenario-skills/THIRD_PARTY_NOTICES.md).
