---
name: architecture-change-governance
description: Architecture, continuity and release-quality gatekeeper. Use when a developer or agent proposes commits, schema migrations, deploys, roadmap or handoff docs that must be validated against real state.
---

# Architecture Change Governance

**Consolidado 11/09/2026 (auditoría de context engineering).** Este archivo
y `.claude/agents/architecture-governor.md` contenían el mismo proceso
duplicado casi línea por línea (~360 líneas repetidas) — dos lugares para
mantener sincronizados sin que nada lo verificara, el mismo modo de falla
que este mismo proyecto persigue como bug en sus cercas RBAC/docs.

**El proceso real vive en un solo lugar: el subagente `architecture-governor`**
(`.claude/agents/architecture-governor.md`, mismo directorio raíz del
contenedor). Es el que efectivamente se invoca en este proyecto — el
`CLAUDE.md` de la raíz dice "invocar primero el **subagente**
`architecture-governor`", no esta skill.

**Si estás leyendo esto porque la palabra clave de esta skill disparó**
(commits, migraciones de schema, deploys, roadmap, handoff): no sigas un
proceso acá — invocá al subagente `architecture-governor` con el Agent
tool y dejá que él establezca el estado real, reconcilie fuentes de
verdad y devuelva una decisión. Este archivo se mantiene solo para que el
matching de skills siga encontrando estas palabras clave; no dupliques el
proceso del governor acá de nuevo si en el futuro hace falta ampliar
algo — amplialo en el agente.
