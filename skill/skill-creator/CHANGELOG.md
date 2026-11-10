# Changelog

All notable changes to `skill-creator` are documented here.

---

## [1.0.0] - 2026-08-02

### Added
- Initial release of `skill-creator`
- Five-step workflow: interview → template selection → scaffold → pre-flight → validation
- `references/interview-questions.md` - structured question bank (Blocks A–F)
- `references/flat-template.md` - scaffold template for simple skills (≤3 steps, no branching)
- `references/modular-template.md` - scaffold template for complex skills (≥4 steps, branching, or reference material)
- `references/quality-axes.md` - six skill-review quality axes reframed as creation guidance
- `references/preflight-checklist.md` - pre-flight self-check before formal skill-review audit
- Adaptive template selection based on complexity signals from the interview
- Graceful fallback when `skill-review` is not installed
- Full modular structure with specific load triggers throughout `SKILL.md`
