# Fase 3 del plan de pureza: lecturas fuera de `src/core/` (plan y decisiones)

> **Estado 2026-10-06: HECHA.** Tramo A: PR #73, #74 y #75 (carta pública, con la autorización del dueño). Tramo B: #76. Tramo C: #77 (la mudanza de ubicación de los reportes; ver «Desvíos del plan» abajo). Los N+1 de stock, grupos, validación de recetas, vencimientos y descuentos por cliente se arreglaron con test de conteo; quedan pendientes (de rendimiento, no de pureza) los de `rendimiento-recetas` y las lecturas repetidas del período.

Documento de traspaso (2026-10-06). Resume los tres planes de implementación (tramos A, B y C), verificados contra el código por agentes de planificación, y las decisiones del dueño. Complementa `docs/plan-de-pureza-y-estado.md`. De lo general a lo específico.

## 1. La idea y el problema central

Meta: `src/core/` puro (P0). En esta fase el cálculo queda puro en `core` y la **consulta** a la base sale a `src/server/`.

El problema que condiciona todo: mover una lectura solo sirve si **todos** los que la llaman pueden importarla desde su nuevo lugar. Hoy:

| Quién la usa | Destino legal |
|---|---|
| Solo páginas / Server Components | `server/consultas/<dominio>/` |
| Solo casos de uso | `server/persistencia/<dominio>/cargar-*.ts` |
| Pantalla **y** escritura (acción, caso de uso o persistencia) | **ninguno** → por eso nace `server/lecturas/` (D-1) |
| Otro archivo de `core` (reportes, registrar-venta) | se queda hasta que ese consumidor salga |
| Carta pública | se queda salvo que se cambie `carta-publica-alcance` (D-2) |

## 2. Decisiones del dueño (2026-10-06)

| # | Decisión | Elegido |
|---|---|---|
| D-1 | Capa nueva `src/server/lecturas/<dominio>/` (solo lectura; importable por consultas, persistencia y acciones; nunca por core ni la UI). Con ADR-026 y regla `lecturas-capa` | **Sí** |
| D-2 | La cadena de la carta pública (5 archivos) sale en un **PR propio, después del resto**; toca la frontera de seguridad de ADR-006/007 (lista cerrada sigue cerrada; mutaciones y e2e de carta pública) | **Sí, autorizado como PR propio** |
| B | Guard de acceso: `server/acceso/` (5 archivos) con diseño «hechos puros + cáscara que lee» (sin puertos: hay una sola implementación) | **Sí** |
| C | El costeo de la venta (Kardex, `registrar-venta`) queda **fuera** de esta fase (Fase 4) | **Sí** |

**Registro formal del dueño (2026-10-07): D-3, D-4, D-5 y D-6 quedan confirmadas tal como se aplicaron** (D-3: la composición de `salud-por-producto` vive en `server/consultas/reportes`; D-4: `auth/{acceso,rol-de-ejecucion}` a la Fase 6; D-5: `movimientos/{stock,origen-venta-datos,producto-cache}` a la Fase 4; D-6: `resolverStockMinimo` se movió, no se borró). Texto original de las decisiones, hasta ese momento pendientes: D-3 reportes que llaman lecturas de stock (recomendado: mover la composición a `server/consultas/reportes/`), D-4 reclasificar `auth/{acceso,rol-de-ejecucion}` a Fase 6, D-5 `movimientos/{stock,origen-venta-datos,producto-cache}` a Fase 4, D-6 mover (no borrar) `resolverStockMinimo`, tramo B D4–D9, tramo C D2–D9.

**Orden recomendado:** A (stock → pos → carta interna → catálogo parcial → auth) → B (permisos) → C (reportes). B mueve ~80 páginas con un codemod: conviene antes de que C toque reportes. Cada PR se integra a `main` con el Gate (requerido) verde antes de empezar el siguiente.

## 3. Tramo A: stock, pos, carta, catálogo, auth (≈33 commits, 6 PR)

Resultado esperado: 26 de los 34 archivos «Fase 3» del alcance quedan limpios. Quedan bloqueados 8: 3 embudos de catálogo (`disponibilidad-producto-consulta`, `precio-local-consulta`, `recetas-vigentes`; tramo C/Fase 4), 3 del Kardex (`movimientos/{stock,origen-venta-datos,producto-cache}`) y 2 de auth (`acceso`, `rol-de-ejecucion`).

Patrón común: el cálculo puro recibe datos planos (sin tipos de Prisma) y queda en `core/<dom>/`; la lectura va a `server/consultas/<dom>/x.ts` (o `server/lecturas/<dom>/` si es compartida), con **el mismo nombre y la misma firma** que tenía, `import "server-only"`, `db: Db` como último parámetro; los parámetros `ahora = new Date()` se mudan con ella. Lo puro pasa de `public-servidor.ts` a `public.ts`; un dominio sin lecturas pierde su `public-servidor.ts`.

| PR | Contenido | Entradas que salen |
|---|---|---|
| PR-0 | test `core-sin-consultas` (AST, activo por carpeta; prohíbe llamadas a la base, importar el cliente y todo parámetro tipado `Db`/`PrismaClient`/`TransactionClient`); capa `server/lecturas` + regla `lecturas-capa` + ADR-026 | 0 |
| PR-1 stock | en-transito, sugerencia-clase-a, stock-minimo, por-familia (arregla N+1), consolidado (arregla N+1), alertas. **Lee el Kardex (solo lectura)** | 6 |
| PR-2 pos | ticket (+`ahora`), mesas, cuenta, selector-carta-consulta y promo-combo-consulta (a `server/lecturas/pos`) | 5 |
| PR-3 carta interna | reporte-secciones (cierra una excepción de UI), admin-consulta, grupo-producto-consulta | 3 |
| PR-3b carta pública | menu, descuentos, empresa-carta, publica-consulta, publica-sin-sesion (`src/server/carta-publica/sin-sesion.ts`); reescribe `carta-publica-alcance` y similares | 5 |
| PR-4 catálogo | receta-validacion (N+1), grupo (N+1), producto, desactivar-producto, receta-propia-estado | 5 |
| PR-5 auth | cuentas-vinculadas, precargados (lectura al script) | 2 |

N+1 que arregla: `stock/consolidado` (una consulta con OR en tandas de ~500), `stock/por-familia` (el id del grupo ya viene en el include + un `grupo.findMany`), `catalogo/grupo` (+ `insumos-grupos/page.tsx`), `catalogo/receta-validacion` (de 2N+S+… a 4 consultas). No arregla los `groupBy` sobre todo el Kardex (los resuelve `SaldoStock`, Fase 5 [MIG]).

Cada paso `.0` escribe tests de caracterización **contra el código viejo** (resultado completo con `toEqual`); no se editan al migrar, solo cambia la ruta del import. Cada arreglo de N+1 lleva un test de conteo de consultas con `prisma.$extends`.

## 4. Tramo B: permisos y módulos (≈13 commits, 1 PR)

- `core/modulos/*` ya es P0. El único impuro de módulos es `core/permisos/modulos-de-empresa.ts` (`cache` de React + lee `ModuloEmpresa`).
- Destino: `src/server/acceso/{gate,capacidades-sucursal,modulos-de-empresa,politica-de-empresa,menu}.ts` (lista cerrada). El cálculo queda en `core/permisos/decision-de-acceso.ts` y `modulo-de-la-accion.ts` (nuevos, P0, con tipos propios sin Prisma). La cáscara no decide nada: por eso **no** hace falta eximirla de `acceso-solo-por-el-guard`.
- Reparto entre fases: `modulos-de-empresa` pasa a 3B (sale de la Fase 6); `core/auth/{acceso,cuentas-vinculadas,precargados,rol-de-ejecucion}` a Fase 6; `invariantes.ts` y `gestion-de-usuarios.ts` a Fase 4.
- Seguridad: **antes de mover nada** se versiona `test/permisos/caracterizacion/matriz-de-acceso.txt` (124 acciones × registros de módulos × usuarios/roles × funciones del guard + conteo de consultas); debe quedar **idéntico byte a byte** en todos los commits (`git diff <3B.1>..HEAD -- test/permisos/caracterizacion/` vacío). Más propiedades con fast-check y un guardián de `vi.mock` huérfanos.
- Orden de pasos (resumen): 3B.0 línea de base · 3B.1 caracterización · 3B.2 herramientas (guardián de mocks + codemod `scripts/arquitectura/mover-exports.ts` con modos simular/aplicar/verificar) · 3B.3–3B.4 decisión pura dentro de core · 3B.5 nace `server/acceso` (política) + regla `acceso-capa` · 3B.6 la invitación recibe el guard por parámetro · 3B.7 menú · 3B.8 lecturas de auditoría a `server/consultas/permisos` · 3B.9 cáscara del gate (codemod grande, ~84 archivos) · 3B.10 lector de módulos · 3B.11 lector de capacidades (necesita que el tramo A haya sacado `precio-local-consulta` de core; si no, segundo PR) · 3B.12 limitador · 3B.13 cierre.
- A verificar (no se toca en 3B): `core/auth/invitacion.ts:223` revalida a quien otorgó el acceso **sin** mirar si su sucursal o su cuenta de empresa están activas; el gate de sucursal tampoco lo hace. Si un otorgante con sucursal/cuenta apagada pasa, se arregla en un PR aparte (fallo cerrado).
- Después de 3B, PR propio **H8** (cambia comportamiento): las 18 lecturas con solo sesión pasan a exigir módulo y permiso (decisión del dueño: exigir todo lo exigible); el mapa lectura → módulo/acción lo aprueba el dueño.

## 5. Tramo C: reportes (≈45 commits, 8 PR)

- 33 de 48 archivos de `core/reportes` reciben la base y leen; el analizador marca 31 como heredados. Bajan de 27 P3 a 3 (`comun`, `cotizacion-dolar`, `indices-economicos`, los tres a Fase 4).
- Método: cada reporte se mueve en dos tiempos (primero se separa en el mismo archivo el cargador `async` del cálculo puro; el cargador se muda a `server/consultas/reportes/` solo cuando ningún archivo de core lo llama), con el mismo nombre y firma.
- PR: C0 caracterización (semilla única determinista, `toMatchInlineSnapshot` sobre salida normalizada, conteo de consultas por reporte) · C1 reglas (`core-sin-consultas` y `paginas-solo-consultas`) y arreglos rápidos (`tabla-por-sucursal.tsx` pasa a `reportes/public`; `ahora` obligatorio en perdidas, devoluciones, vencimientos, diferencias, tickets) · C2 insumos comunes y lecturas simples (el paso 2.0 toca el camino del costo congelado de la venta sin cambiar comportamiento) · C3 «hoy», salud, por sucursal, vencimientos (N+1) · C4 rendimiento de recetas (6 commits; N+1 con lotes, una sola carga por página; sumas en decimal exacto y `ORDER BY` explícito) · C5 período (carga única de insumos; costo actual de 3 a 1 consultas, IPC 2→1, precios locales 2→1) · C6 derivados (borra `core/carta/reporte-secciones.ts`, cierra la excepción de `ventas-por-seccion/page.tsx`, N+1 de descuentos-clientes) · C7 cierre.
- N+1 reales: `rendimiento-recetas.ts` (hermanos, `aggregate` y `conteoFisico` por pool, ventas por intervalo; la página lo calcula **dos veces**), `vencimientos.ts` (un `aggregate` dentro de tres bucles), `descuentos-clientes.ts` (hasta 4 consultas por cliente). Consolidado es N por sucursal visible (acotado, se acepta).
- Un índice `MovimientoStock(seccionId, productoId)` solo si un `EXPLAIN` lo justifica y es Fase 5: **requiere autorización expresa**.

## 6. Paso final obligatorio de cada PR

En la MISMA corrida y sobre el mismo commit, todos limpios, comparados con la línea de base tomada antes del primer cambio: `npx tsc --noEmit` (vacío), `npm run lint` (0), `npm run arquitectura` (leer «no dependency violations found (N modules…)»), `npm run analizar:muerto` (0), `npm test` (contra Postgres real; archivos y tests ≥ base), `npm run build`, `npm run plataforma:build`, `npm run test:e2e` (≥ 509 en local). Cada regla o test nuevo se demuestra por mutación (rojo con archivo y línea → revertir → verde) y queda escrito en la descripción del PR. `git diff --name-only origin/main...HEAD -- prisma/` debe salir vacío: ningún paso de la Fase 3 toca schema ni migraciones.

Local vs. CI (acordado con el dueño el 2026-10-06): en local solo los comandos breves (tsc, lint, arquitectura, knip y los tests de arquitectura y del dominio tocado); build, e2e y la suite completa los corre el CI en cada PR.

## 7. Desvíos del plan (lo que se hizo distinto y por qué)

- **Tramo C, reportes:** en vez de reescribir cada reporte como «armar(filas) puro + leer», un splitter por AST dejó en `core` los tipos y funciones puras y mandó a `server/consultas/reportes` las 39 funciones que reciben la base, con el mismo nombre y firma (mecánico, sin riesgo de cambiar resultados: los 90 archivos de tests de reportes pasan sin tocar aserciones). Se quedaron en `core` `comun`, `costos`, `cotizacion-dolar` e `indices-economicos` (Fase 4, decisión D1).
- **N+1 de reportes:** arreglados `vencimientos` (conciliación: 1 lectura para todas las ventanas, suma en decimal exacto) y `descuentos-clientes` (el costo reconstruido se calcula 1 vez para todos los clientes: 7 lecturas → 2). **Pendientes**: `rendimiento-recetas` (varias consultas por pool, calculado dos veces por página) y las lecturas repetidas de `periodo` (costo actual ×3, IPC ×2, precios locales ×2). Es una optimización de rendimiento más riesgosa (lotes con aritmética exacta); conviene una tanda propia con caracterización antes.
- **Lectores bloqueados (reclasificados a Fase 4):** `catalogo/{disponibilidad-producto-consulta, precio-local-consulta, recetas-vigentes}`, `movimientos/{origen-venta-datos, producto-cache, stock}` y `permisos/capacidades-sucursal`: los usa `registrar-venta` dentro de la transacción de la venta; salen cuando la venta pase a caso de uso.
- **El codemod reutilizable** (`mover-exports.ts` del plan 3B.2) no se versionó: se usaron scripts de una sola vez; para la Fase 6 (161 `vi.mock` de la sesión) conviene versionar uno (decisión D5 pendiente).
- **Sin `import "server-only"`** en las lecturas que usan scripts con `tsx` o specs de Playwright (las de reportes, las de la carta que usa un e2e).
