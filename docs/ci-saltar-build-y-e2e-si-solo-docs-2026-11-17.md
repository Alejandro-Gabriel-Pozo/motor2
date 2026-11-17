# CI: saltar Build y E2E cuando el pull request toca solo documentación (2026-11-17)

**Pedido del dueño:** «Priorizá los PR de CI que ahorran cola» → «si» (2026-11-17, chat con el orquestador). Detalle pedido por el orquestador en el mismo chat: un PR que solo toca `.md` de `docs/` y de la raíz corre Estático e Integración (los guardianes de arquitectura leen `docs/` y ya nos rompieron con capturas) pero SALTA Build y los 7 shards de E2E; cualquier otro cambio corre todo. No cambia producto.

## Qué hace
- Job nuevo `alcance` (`ci.yml`): mira la lista de rutas que cambia el PR (`git diff --no-renames --name-only -z HEAD^1 HEAD` sobre la fusión de prueba que arma GitHub) y la pasa por `scripts/alcance-del-cambio.ts`. No instala nada. Sale `solo-docs` o `completo`.
- `build` y `e2e` dependen de `alcance` y se omiten SOLO si salió `solo-docs` (o por la perilla `CI_EN_MAIN` de siempre, que no se tocó). `!cancelled()` hace que corran aunque el job del filtro falle.
- `estatico` e `integracion` no dependen del filtro: corren siempre.
- «Gate (requerido)» sigue siendo el único requerido. Su primer paso exige Estático e Integración en success; Build y E2E en success, o en skipped únicamente si el job `alcance` terminó en success y dijo exactamente `solo-docs`. Un omitido sin esa justificación, o cancelado, lo pone rojo. Los conteos de Vitest corren también en un PR de solo docs; los de E2E solo si E2E corrió.

## Oráculo del filtro (todo nace cerrado)
`solo-docs` únicamente si hay al menos una ruta y CADA una es un `.md` bien formado que está en `docs/` (a cualquier profundidad) o en la RAÍZ del repositorio (README.md, CLAUDE.md, AGENTS.md). Todo lo demás da `completo`: un `.md` dentro de `src/`, `prisma/`, `test/` u otra carpeta, y cualquier archivo que no sea `.md` dentro de `docs/` (imágenes, json). Ajuste del orquestador, 2026-11-17 («todo nace cerrado»).

| Rutas del PR | Resultado |
|---|---|
| `docs/a.md`, `docs/sub/b.md`, `AGENTS.md`, `README.md` | solo-docs |
| `docs/capturas/b.png`, `docs/datos.json`, `src/x.md`, `test/x.md`, `prisma/migrations/LEEME.md` | completo |
| `src/x.ts`, `prisma/**`, `.github/**`, `test/**`, `package.json`, `scripts/**` | completo |
| `docs/a.md` + `src/x.ts` (mezcla) | completo |
| listado vacío, ruta vacía, absoluta, con `..`, `.` o `\` | completo |
| `docs-extra/x.ts`, `x/A.MD`, `src/cmd` | completo |
| mover `src/x.ts` a `docs/x.ts` (con `--no-renames` salen las dos rutas) | completo |
| push, `workflow_dispatch`, `ci/**`, PR sin fusión de prueba, error del script | completo |

## Qué lo vigila
`test/arquitectura/ci-alcance-del-cambio.test.ts`: el oráculo del filtro, el paso del job corrido de verdad en un repositorio git temporal, el primer paso del Gate corrido con bash sobre 576 combinaciones de resultados (más 7 mutaciones que tienen que ponerlo rojo) y la estructura del workflow. `ci-perilla-en-main.test.ts` evalúa ahora la condición de Build y E2E con la dimensión «alcance». El guardián de contratos (`cumplimiento.ts`, congelado por hash) permite las condiciones nuevas y su cambio quedó registrado en `aprobaciones.ts`.

## Qué no cambia
La perilla `CI_EN_MAIN`, los workflows de seguridad (`seguridad.yml`, `codeql.yml`, `gitleaks.yml`) y qué se prueba en un PR que toca código.

## Pendiente
La demostración en vivo (un PR solo de docs con los jobs omitidos y el Gate en verde, y uno mixto que corre todo) solo se puede hacer DESPUÉS de integrar este cambio: el CI de un PR usa el workflow de la fusión con `main`, y los PR a `main` son los que disparan el filtro.
