<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Diseño de planes de implementación (pendientes de backlog)

Al diseñar el plan de un pendiente de backlog que ya no depende de una
decisión de negocio (auditorías, hallazgos de code review, ítems de
`docs/pendientes-*.md`), usar la skill `plan-con-verificacion-e2e`
(`.claude/skills/plan-con-verificacion-e2e/SKILL.md`): un agente de
planificación por pendiente (`Agent`, `subagent_type: "Plan"`, `model:
"opus"`), lanzados en paralelo cuando son independientes, cada uno con la
instrucción de verificar el código real antes de proponer nada (un
pendiente descrito en un documento puede estar resuelto o mal atribuido) y
con un paso final obligatorio de verificación end-to-end contra la suite
TOTAL del proyecto (tipos, lint, arquitectura, tests unitarios/integración,
build y e2e con Playwright — comandos concretos y criterio de éxito, nunca
"correr los tests" en abstracto).

Gate de verificación obligatorio (desde 2026-09-27, Task #41 Fase A3): 6
comandos, en la MISMA corrida y todos limpios — `npx tsc --noEmit`, `npm run
lint`, `npm run arquitectura` (dependency-cruiser, `.dependency-cruiser.cjs`;
excepciones con motivo en `.dependency-cruiser-excepciones.cjs`), `npm test`,
`npm run build` y `npm run test:e2e`.
