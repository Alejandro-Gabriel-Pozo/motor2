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

Gate de verificación obligatorio (desde 2026-09-27, Task #41 Fase A3; 7
comandos desde la Fase K3 y 8 desde que existe la consola de plataforma,
`plataforma:build`): en la MISMA corrida y todos limpios — `npx tsc
--noEmit`, `npm run lint`, `npm run arquitectura` (dependency-cruiser,
`.dependency-cruiser.cjs`; excepciones con motivo en
`.dependency-cruiser-excepciones.cjs`), `npm run analizar:muerto` (knip, CON
código de salida — 0 hallazgos obligatorio; excepciones legítimas con motivo
en `knip.jsonc`), `npm test`, `npm run build`, `npm run plataforma:build` (la
consola, otra app Next: un fallo de dependencias solo aparece al construirla) y
`npm run test:e2e`.

## Diseño de módulos y features nuevos (regla del dueño, 2026-10-26)

Todo módulo o feature nuevo (compras, reservas, ventas, caja, clientes, lo que venga) y todo arreglo sustancial de uno existente se diseña ANTES de tocar tablas o pantallas, con la escalera de diseño de 10 niveles: 1 propósito y alcance, 2 actores y contexto, 3 casos de uso, 4 conceptos y ciclo de vida, 5 invariantes y políticas, 6 historia y persistencia, 7 atomicidad y concurrencia, 8 acceso e interfaces, 9 consultas y experiencia, 10 pruebas, migración y operación.

- Compuerta: no se diseñan ni migran tablas (nivel 6) sin tener confirmados los niveles 1 a 5. Cada decisión lleva su estado: CONFIRMADA (dicha por el dueño), PROPUESTA, PENDIENTE o NO VERIFICADA. Para cada comando, la tabla «¿qué pasa si…?»: repetición, concurrencia, tiempo, incertidumbre, reintento, error parcial, datos faltantes, cambio de permisos.
- Escalera de producto N0 a N5 por módulo (lo que ve el cliente): peldaños acumulativos que no rompen lo cargado; formalidad y detalle son ejes separados; lo que falta se muestra como «pendiente de completar», nunca se inventa. Es una escalera distinta de la de diseño: se cruzan en el nivel 5.
- Se diseña el modelo completo y escalable en papel, pero SOLO se migran las tablas de la etapa que se implementa, con puntos de extensión previstos (relaciones opcionales, estados con CHECK, historial que solo agrega) y migraciones aditivas y reversibles. Nada de tablas «a ciegas» que nadie escribe.
- Antes de crear un modelo, inventariar lo que ya existe con otro nombre (validar contra el código real, no contra documentos). Antes de diseñar o auditar un módulo, revisar también el repositorio `motor2-docs` (`_planes/`, decisiones del dueño, ADR): puede haber un plan aprobado que el código todavía no tiene (la auditoría de abastecimiento del 2026-10-27 dijo «bienes de uso: no existe» por mirar solo `src/`). Reutilizar módulos, planes, permisos y centros de costos existentes antes de inventar tablas de niveles o reglas.
- Los arreglos sobre lo ya construido siguen el mismo método: auditar el módulo contra la escalera (invariantes, concurrencia, niveles) y corregir en pasos chicos, sin refactorizar lo que no se pidió.
- El documento de diseño vive en `docs/diseno-<modulo>-AAAA-MM-DD.md` (ver el piloto de clientes, convenios y facturación externa).

## Exploración con Explore

Antes de tocar código en una tarea que obliga a ubicar algo en más de ~10 archivos
(dónde se usa X, qué acciones no pasan por el caso de uso, qué lecturas exigen qué
permiso), lanzar primero el agente `Explore` (`Agent`, `subagent_type: "Explore"`)
con el nivel de profundidad que corresponda ("medium" o "very thorough").

- Explore solo ubica; no audita ni cierra nada. El cierre de cada hito lo decide
  el auditor independiente, nunca el resultado de Explore.
- Sus conclusiones son punto de partida: verificar en el código real antes de
  actuar, sobre todo en seguridad, dinero y permisos.
- Archivo conocido o búsqueda corta: leer directo, sin Explore.
- Varias búsquedas independientes: lanzarlas en paralelo.

