# Pendientes de la sesión del 2026-09-27 (hand-off a terminal)

Este documento es el traspaso completo de una sesión de Claude Code en la nube
que trabajó sobre `main` gran parte del 2026-09-27. Se genera porque el
sistema de tareas de esa sesión (`TaskCreate`/`TaskList`) **no es visible
desde otra sesión** — todo lo que había que conservar está transcripto acá,
tal cual estaba en el tracker al momento de cerrar la sesión.

**Para entender el "por qué" antes de tocar código, leer en este orden**
(los dos ya están en `main`, no son parte de este traspaso — nacieron de la
propia ejecución de la Task #41):
1. `docs/arquitectura-modularidad-server-actions-2026-09-17.md` — el origen
   de todo el refactor: cómo se descubrió el problema comparando motor2
   contra el repo hermano `app`, el estado real de `server/actions/`/
   `core/`/`components/` a hoy (sección "Estado al 2026-09-27"), y la tabla
   de herramientas descartadas con motivo (por qué NO `eslint-plugin-boundaries`,
   Zod, `next-safe-action`, tRPC, TanStack Query, Redux/Zustand, otra
   librería decimal).
2. `docs/arquitectura-casos-de-uso-2026-09-27.md` — el diseño de la capa
   nueva de casos de uso (Fase M): la tabla de equivalencias con los 2
   documentos externos que el dueño pasó (sobre convenciones de flujo de
   datos), el diagrama de capas del piloto ya mergeado (`anularCompra`/
   `corregirCompra`), y las 2 reglas de `dependency-cruiser` que lo hacen
   obligatorio, no opcional.

Este documento (el que estás leyendo) es el punch-list de lo que falta —
los dos de arriba explican por qué cada pieza está donde está.

**Estado de `main` al cerrar esta sesión:** todo lo de abajo marcado como
"mergeado" ya está en `main`. El resto está sin empezar o a medio camino
(ver cada sección).

**Convención de verificación vigente** (Task #41, Fase A3, ya mergeada):
6 comandos obligatorios en la MISMA corrida antes de mergear cualquier PR —
`npx tsc --noEmit`, `npm run lint`, `npm run arquitectura` (dependency-cruiser),
`npm test` (Vitest contra Postgres real), `npm run build`, `npm run test:e2e`
(Playwright). Cuando K3 (más abajo) se mergee, se suma un 7º comando,
`npm run analizar:muerto` (knip). Tabla completa en
`.claude/skills/plan-con-verificacion-e2e/SKILL.md` y en `AGENTS.md`.

**Convención de worktrees** (usada toda la sesión, para poder trabajar varias
cosas en paralelo sin pisarse): cada tarea en su propio
`git worktree add /tmp-o-donde-sea/motor2-<slug> -b feat/<rama> origin/main`,
con un `.env` propio apuntando a DOS bases Postgres dedicadas y vacías
(`motor2_<slug>` y `motor2_<slug>_e2e`), nunca compartidas entre worktrees.
Antes de correr `test:e2e`, cambiar temporalmente el puerto en
`playwright.config.ts` (línea `const PUERTO = 56471`) a uno propio si hay
otro worktree corriendo e2e al mismo tiempo — y **revertirlo siempre antes de
commitear** (no forma parte del pendiente A0 de abajo, es solo higiene de
sandbox compartido).

**Aviso sobre el archivo `.dependency-cruiser-excepciones.cjs`:** casi todas
las sub-tareas de la Fase D y las reglas nuevas de la Fase M lo tocan (una
lista compartida `PENDIENTES_DE_MIGRAR` y un comentario con el historial de
migraciones). Si dos ramas lo tocan en paralelo, el conflicto de merge es
trivial (combinar las dos líneas de comentario, y confirmar que la página
recién migrada salió de la lista) — se resolvió así varias veces esta sesión,
nunca hizo falta rehacer nada a mano más allá de eso.

---

## PARTE 1 — Task #41: refactor arquitectónico (comandos+casos de uso, fronteras de módulos, dependency-guard)

### Ya mergeado en `main` (para contexto, no hay nada que hacer acá)

- **Fase A** (guard de `dependency-cruiser`, 9→10 reglas en `.dependency-cruiser.cjs`, corrección del único caso `core→server/actions`, doc de arquitectura actualizada) — PR #33.
- **Fase B** (los 3 archivos grandes divididos: `pos/cuenta.ts` → 5 archivos, `core/reportes/periodo.ts` → 8 archivos con fachada, `server/actions/catalogo/recetas.ts` recortado) — PRs #35, #37, #38.
- **K1** (informe de `knip`, PR #36) — reclasificado en frío el mismo día (2026-09-27, noche) tras los refactors de Fase C/M8-M12d, y **K2 ya aprobada y mergeada**: `npm run analizar:muerto` da 0 hallazgos. Ver detalle en `docs/informe-knip-2026-09-27.md` y más abajo.
- **Fase D COMPLETA, 9 de 9 páginas migradas** a `server/consultas/` (D1 productos, D2 proveedores, D3 recetas-listado, D5 roles/usuarios, D7 rendimiento-por-sucursal, D8 mesas, D6 productos-opción, D4 editor de recetas) — PRs #34, #42, #41, #44, #45, #39, #47, y el merge directo a `main` de D4 (2026-09-27, sesión continuada en máquina local: worktree `feat/arq-d4-consultas-recetas-editor`). `PENDIENTES_DE_MIGRAR` en `.dependency-cruiser-excepciones.cjs` queda vacía.
- **C1** (`core/catalogo/public.ts` + `public-servidor.ts`, primer dominio con fronteras públicas) — PR #43.
- **C2** (`core/movimientos/public.ts` + `public-servidor.ts`) — mergeado a `main` (2026-09-27, misma sesión). `"movimientos"` ya está en `DOMINIOS_CON_PUBLIC`.
- **C3** (`core/reportes/public.ts` + `public-servidor.ts`) — mergeado a `main` (2026-09-27, misma sesión). `"reportes"` ya está en `DOMINIOS_CON_PUBLIC`. Ver detalle y hallazgo real (no anticipado por esta descripción) más abajo.
- **M9** (caso de uso `registrarVenta` de mostrador) — resultó YA HECHA como efecto colateral de M8 (verificado 2026-09-27). Nada pendiente.
- **Fase M, piloto + M8** (M0-M7: `core/resultado-caso.ts`, comando+guard+persistencia+caso de uso de `anularCompra` y `corregirCompra`, 2 reglas nuevas de dependency-cruiser que hacen el patrón obligatorio — PR #40; M8: caso de uso `anularVenta` — PR #48, mergeado ya antes de este checkpoint). De paso el piloto corrigió un bug real preexistente: con `operacionId: undefined`, Prisma ignoraba el filtro y podía anular la compra equivocada. **M9 queda desbloqueada.**
- **D9, M10, M11a, M12a** — 4 tareas lanzadas en paralelo (4 agentes, worktrees/DBs propios, este mismo día, máquina local) y mergeadas: D9 (`AccionConteo` vía fachada), M10 (transacción atómica en cambios de precio, con test rojo→verde), M11a (traspasos: aprobar/cancelar/rechazar solicitud, migración parcial a propósito) y M12a (POS: `cerrarCuenta`, migración parcial a propósito). Cada una reverificada de forma independiente (gate completo + lectura del diff) antes de mergear.
- **M11b, M12b** — mismo patrón (2 agentes en paralelo): M11b (traspasos: aceptar/rechazar envío/reingreso) y M12b (POS: `emitirBoletaCorregida` — `cuenta-cierre.ts` completó su migración y entró en `ACCIONES_CON_CASO_DE_USO`).
- **M11c, M12c** — mismo patrón: M11c CIERRA la cadena de traspasos (`traspasos.ts` entero, ya solo con lecturas + casos de uso, entró en `ACCIONES_CON_CASO_DE_USO`; las 2 lecturas se mudaron a `traspasos/lecturas.ts`) y M12c (`anularItemEnviado`, migración parcial — falta M12d). Al reverificar M11c se encontró un flake real preexistente en un test de M10 (`sincronizarPrecioGrupoCarta`, orden de productos en el mensaje no determinista) — documentado más abajo, no bloquea nada.
- **M12d** — CIERRA toda la cadena M11/M12 de esta ronda (`anularPromoEnviada`, `cuenta-anulacion.ts` entró en `ACCIONES_CON_CASO_DE_USO`). Con esto, las 8 sub-tareas de M11a→M12d quedaron todas mergeadas.
- **A0, F1-F4** — mergeadas (2026-09-28, madrugada). Fase F completa: 2 hallazgos reales sin corregir, documentados (subnormales en `repartirImporte`, y un caso de saldo negativo por una unidad en empates de `arrastre-redondeo`). **P1 queda desbloqueada.** De paso se verificó que **P2 ya estaba resuelta** (M12a ya había creado `server/persistencia/pos/cerrar-cuenta.ts`).

**Nota de continuidad (2026-09-27, tarde):** D4, D6, C2 y M8 se lanzaron como 4 agentes en paralelo en una sesión cloud; la sesión se cortó antes de que D6/C2/M8 terminaran de reportarse (D6 y M8 en realidad ya habían mergeado; C2 había pusheado su rama sin mergear; D4 no llegó a pushear nada — se rehízo desde cero). Al continuar en una máquina local se verificó cada uno contra el estado real de `main` (nunca contra la descripción de esta tarea) antes de tocar nada — ver "Lección aprendida" de `plan-con-verificacion-e2e/SKILL.md`.

### Pendiente — orden sugerido de abajo hacia arriba (cada ítem dice sus bloqueos reales)

#### A0 — YA MERGEADA (puerto E2E configurable por env var)
`PUERTO` en `playwright.config.ts` pasa a `Number(process.env.MOTOR2_E2E_PUERTO ?? 56471)`.
`.env.example` documenta la variable (comentada, no `""` — una cadena vacía
daría `Number("") === 0`, puerto inválido). Verificado con
`MOTOR2_E2E_PUERTO=56472 npm run test:e2e`: el servidor arrancó en ese
puerto. Ya no hace falta la disciplina manual de editar el archivo por
worktree.

#### D6, D4, C2 y M8 — YA MERGEADOS (ver "Ya mergeado en `main`" arriba)
Sin nada pendiente. D6/M8 se mergearon en la sesión cloud original; C2 se
rebaseó y verificó en la sesión local antes de mergear; D4 se rehizo desde
cero en la sesión local (la rama original nunca se pusheó) siguiendo la
misma especificación que estaba anotada acá — el spec completo de D4 (las 3
funciones agregadas a `server/consultas/catalogo/recetas.ts` y cómo el
editor pasa a usarlas) quedó documentado en el commit `refactor(arq-d4): ...`
y en el docstring del propio archivo, no hace falta repetirlo acá.

#### C3 — YA MERGEADA (`core/reportes/public.ts` / `public-servidor.ts`)
Verificado contra el código real (no contra esta descripción, que estaba
incompleta): las únicas 3 aristas restringidas eran `carta/reporte-secciones`
y `movimientos/registrar-venta` (comun+periodo+costos → `public-servidor.ts`)
y, algo que esta descripción NO mencionaba, `server/consultas/reportes/
rendimiento-por-sucursal.ts`, que importaba `core/reportes/rendimiento-por-sucursal.ts`
directo → `public.ts` (puro). Los módulos `*-vistas` y `rango-por-defecto`
quedaron SIN exponer: hoy nada fuera del dominio (por la regla real, que
exime `app/`) los consume, y la convención de C1 es "solo lo que hoy se usa
desde afuera" — no agregar superficie pública sin un consumidor real.
**Hallazgo al correr el gate:** `rendimiento-por-sucursal.ts` se creía puro
por importar `Db` de `./comun` con `import type`, pero dependency-cruiser
cuenta el edge a nivel de ARCHIVO (no de símbolo) — `comun.ts` sí toca
`@/lib/db`, así que ese `import type` alcanzaba la base transitivamente y
`publico-puro` lo marcaba en rojo apenas `reportes` tuvo fachada. Se corrigió
declarando `Db` localmente desde `@prisma/client`.
**Nota, no crear tarea aparte:** `public.ts` de `pos` y `stock` quedan
diferidos (C4/C5) porque casi todos sus consumidores están en `app/`, exento
de la regla por ahora — dejarlo solo anotado en E1.

#### D9 — YA MERGEADA
`conteo-fisico-grid.tsx` importa `AccionConteo` desde `core/movimientos/public.ts`
(reexport de tipo puro del paquete `@prisma/client`, no de `@/lib/db.ts` — no
rompe `publico-puro`). `server/actions/movimientos/conteo-fisico.ts` sigue
importando directo de `@prisma/client` a propósito (no es `app/`, la regla no
lo alcanza).

#### K2 — YA MERGEADA (borrar código muerto aprobado)
Aprobada por el dueño y ejecutada (2026-09-27, noche) contra la lista
refrescada de 49 (no la de 34 original). De paso, en la misma tarea, se
corrigió el flake real de `sincronizarPrecioGrupoCarta`/
`sincronizarPrecioLocalGrupoCarta` (orden no determinista del mensaje —
`orderBy: { nombre: "asc" }` agregado a los dos `findMany`). Los 49:
2 dependencias (`@vitejs/plugin-react` desinstalada, `fflate` declarada),
7 símbolos muertos borrados, 10 reexportaciones sobrantes sacadas
(`CANTIDAD_MAXIMA_POR_ITEM` + 9 tipos de `periodo.ts`), 30 `export`
sobrantes reducidos a locales. **`npm run analizar:muerto` da 0
hallazgos.** Ningún test se tocó ni se borró. Gate completo (6 comandos)
verificado limpio antes de mergear.

#### K3 — YA MERGEADA (knip obligatorio en el gate)
`--no-exit-code` sacado de `package.json`. Demostrado rojo→verde: un export
sin uso temporal hace fallar el comando (exit 1), revertido vuelve a exit 0.
Gate documentado en 7 comandos en `AGENTS.md` y en
`.claude/skills/plan-con-verificacion-e2e/SKILL.md`. **F1-F4 quedan
desbloqueadas.**

#### F1-F4 — YA MERGEADAS (`fast-check`, property-based testing)
Las 4 mergeadas (2026-09-28, madrugada), en worktrees paralelos. `fast-check`
quedó en `^4.10.2` como devDependency directa (F1) — más nueva que la
`3.23.2` transitiva vía `effect`, que sigue anidada aparte sin chocar.
**Presupuesto de ~60s cumplido de sobra**: los 4 archivos nuevos juntos
tardan un par de segundos (F1 ~1s, F2 ~0,4s, F3 ~0,9s, F4 ~2,7s).

**Hallazgo real de esta sesión, no de los agentes: `fast-check` 3→4 cambió
el default de `fc.uuid()`** (de "solo v1-v5" a "v1-v8", RFC 9562) — el test
de F3 se validó contra la 3.23.2 (antes de que F1 mergeara) y al
reverificar de forma independiente con la 4.10.2 ya instalada, un caso
generó un UUID v6 y rompió la aserción "todo UUID v1-v5 es válido".
Corregido restringiendo ese generador puntual a `fc.uuid({ version: [1,2,3,4,5] })`
(los otros 7 usos de `fc.uuid()` en el mismo archivo no dependían de la
distribución de versiones, así que no hacía falta tocarlos). Esto es
exactamente el tipo de cosa que la reverificación independiente existe para
atrapar — el reporte del propio agente de F3 no lo vio porque corrió contra
la versión vieja.

- **F1** (`test/core/moneda.propiedades.test.ts`): las 4 funciones de
  `moneda.ts` con las propiedades pedidas, más algunas extra. **Hallazgo
  real, no corregido (fuera de alcance, documentado):** `repartirImporte`
  puede tirar una excepción o repartir mal con pesos SUBNORMALES
  (`< 2.2e-308`, ej. `5e-324`) — la función suma los pesos en float pero
  convierte cada uno a `Decimal` por separado, y ahí divergen. No es un caso
  realista para plata (200.000 corridas con pesos normales, en centavos o
  con 3 decimales, sin fallar ni una vez); el test generа doubles desde
  `1e-6` con un comentario explicando por qué. Si se quiere blindar del
  todo: sumar los pesos en `Decimal` en vez de float.
- **F2** (`test/movimientos/arrastre-redondeo.propiedades.test.ts`).
  **Dos hallazgos reales, no corregidos:**
  1. El rango real de la deuda es **cerrado** `[−u/2, u/2]`, no semiabierto
     `[−u/2, u/2)` como decía el comentario original del archivo (y como
     pedía esta descripción) — confirmado con un contraejemplo concreto
     (d=2, x=1,005 por el redondeo binario de flotantes). El test usa el
     rango real; el comentario de `arrastre-redondeo.ts` quedó desactualizado
     (no se tocó, fuera de alcance de F2).
  2. **El comentario "NO GENERA SALDOS NEGATIVOS" no se sostiene en
     empates**: con d=2, consumir 1,005 y después 0,01 escribe 1,00 y
     **0,02** — la segunda escritura consume una unidad más de lo pedido,
     pudiendo superar el disponible de un lote por una unidad mínima.
     Reproducido y documentado, sin corregir (cambiaría comportamiento).
     Candidato a pendiente aparte si se quiere cerrar (redondear en enteros
     de unidad, o compensar con `Number.EPSILON`).
- **F3** (`test/movimientos/idempotencia.propiedades.test.ts`). Cubrió
  `calcularPayloadHash` (determinista, ordena claves antes de hashear —
  documentadas las colisiones a propósito: `Date` vs. su ISO string, `-0`
  vs. `0`, `undefined` vs. campo ausente), `esClaveIdempotenciaValida` (UUID
  v1-v5, variante RFC 4122, mayúsculas/minúsculas) y `chequearIdempotencia`
  contra Postgres real (mismo key+payload no duplica, mismo key+payload
  distinto da conflicto, clave vacía/ausente da "nueva").
- **F4** (`test/reportes/saldo.propiedades.test.ts`). `calcularSaldoTotal` =
  suma con signo de los movimientos ACEPTADOS (no todos los generados —
  `registrarMovimiento` rechaza una salida mayor al saldo, el modelo del
  test replica esa regla); el `saldoCorriente` final del historial coincide
  siempre con `saldoActual`. Ambos con redondeo a 3 decimales
  (`redondearCantidad`), documentado que las comparaciones son en
  centésimas, no exactas en float.

#### P1 — YA MERGEADA (2026-09-28)
`guardarReceta` migrado al patrón de casos de uso: comando+guard en
`core/features/catalogo/receta-version.{schema,guard}.ts`, persistencia en
`server/persistencia/catalogo/guardar-version-de-receta.ts` (con la
excepción documentada de `cargarProductoParaReceta`/
`cargarUltimaVersionDeReceta`, que corren FUERA de la transacción con el
cliente global `prisma` — `test/catalogo/recetas-concurrencia.test.ts`
depende de contar esas lecturas para probar el reintento), caso de uso en
`server/actions/catalogo/casos-de-uso/guardar-version-de-receta.ts`.
`test/arquitectura/lectores-de-receta.test.ts` actualizado con el archivo
de persistencia nuevo como "central". Migración PARCIAL a propósito:
`recetas.ts` NO entró en `ACCIONES_CON_CASO_DE_USO` (las lecturas y las
demás ediciones puntuales siguen sin tocar). Reverificado
independientemente (worktree aparte, DB dedicada): los 7 comandos en
verde — 274/274 archivos y 3285/3285 tests de Vitest, build, 369/369
specs de Playwright. **P1 desbloquea M13a.**

#### P2 — YA RESUELTA (verificado 2026-09-28, no como tarea aparte)
`server/persistencia/pos/cerrar-cuenta.ts` YA EXISTE — lo creó M12a al
migrar `cerrarCuenta` a caso de uso (misma sesión). Mismo caso que M9: un
pendiente del backlog resuelto de paso por otra tarea. Nada que hacer acá.

#### E1 — YA HECHA, CIERRA LA TASK #41 (2026-09-28)
Sección "E1 — cierre y verificación total del Task #41" agregada al final
de `docs/arquitectura-casos-de-uso-2026-09-27.md`: contrato completo de
`server/consultas`/`server/persistencia`, el catálogo completo de reglas de
`dependency-cruiser` con su motivo, la convención `public.ts`/`public-servidor.ts`
(dominios que la adoptaron: `catalogo`/`movimientos`/`reportes`), el estado
de `knip` en el gate (y corregido un comentario desactualizado en
`knip.jsonc` que todavía decía "informativo" desde antes de K3), referencia
a la tabla de herramientas descartadas (ya vivía en
`docs/arquitectura-modularidad-server-actions-2026-09-17.md`, revisada y
sigue vigente), `PENDIENTES_DE_MIGRAR` **confirmada vacía**, y la lista de
"fuera de alcance, pendiente aparte" completa. Cierre verificado:
los 7 comandos en verde EN LA MISMA CORRIDA sobre `origin/main` (`c32adea`)
con todo mergeado — `tsc` limpio, `lint` 0/0, `arquitectura` sin
violaciones (508 módulos), `knip` 0 hallazgos, 274/274 archivos y
3289/3289 tests de Vitest, `build` limpio, 369/369 specs de Playwright.

## CON ESTO SE CIERRA LA TASK #41 COMPLETA (2026-09-28)

Todos los sub-pendientes de la Parte 1 que no dependían de una decisión de
negocio están mergeados en `main` y pusheados: A0, F1-F4, P1, P2 (ya
resuelta), la cadena M13a→b→c→d→e1→e2, M14 (con autorización expresa del
dueño para su migración de schema) y E1. Cada uno se implementó en un
worktree aislado, se reverificó independientemente contra el código real
(no contra el autoreporte del agente implementador) y se mergeó solo
después de que los 7 comandos del gate pasaran limpios en la misma
corrida.

### Fase M — casos de uso de mutación (generalizar el patrón del piloto)

El piloto (`anularCompra`/`corregirCompra`) ya está mergeado y estableció el
patrón: `core/resultado-caso.ts` (`ResultadoCaso`/`exito`/`fracaso`/
`aResultadoAccion`), comando+guard en `core/features/<f>/`, persistencia en
`server/persistencia/<dominio>/<verbo>.ts` (recibe `tx` OBLIGATORIO, nunca
`db=prisma` opcional), caso de uso en
`server/actions/<dominio>/casos-de-uso/<verbo>.ts` (`import "server-only"`,
SIN `"use server"`), Server Action como adaptador fino. Convenciones
completas en `docs/arquitectura-casos-de-uso-2026-09-27.md` (ya en el repo).

- **M8 — YA MERGEADA** (PR #48): caso de uso `anularVenta` mergeado a `main`.
- **M9 — YA HECHA, sin PR propio** (verificado 2026-09-27 contra el código
  real, no contra esta descripción — cierra el "tramo 1" de la Fase M): M8
  metió `venta.ts` en `ACCIONES_CON_CASO_DE_USO` por `anularVenta`, y esa
  regla vale para TODO el archivo — como efecto colateral, M8 ya movió el
  bloque transaccional de `registrarVenta` (I3 + `registrarVentaEnTx`) a
  `casos-de-uso/registrar-venta.ts`, con `test/casos-de-uso/registrar-venta.test.ts`
  cubriéndolo. `DatosVentaInput` (`core/features/ventas/venta.schema.ts`) ya
  nace sin `precioUnitario` (se mapea a mano en el caso de uso). Nada
  pendiente acá.
- **M10 — YA MERGEADA**: las 4 funciones (`actualizarProducto`,
  `sincronizarPrecioGrupoCarta`, `setPrecioLocalProducto`,
  `sincronizarPrecioLocalGrupoCarta`) tenían el hueco (auditaban con `prisma`
  suelto, sin transacción) — ahora cada una envuelve su `update`/`upsert` +
  auditoría en un `prisma.$transaction`. Demostrado rojo→verde en
  `test/catalogo/precio-auditoria-atomica.test.ts` (7 tests: sin el fix,
  6/7 mostraban el precio cambiado sin su auditoría; con el fix, rollback
  completo). Quedó señalado, fuera de alcance, que
  `actualizarDisponibilidadProducto`, `permisos/capacidades-sucursal.ts`,
  `permisos/roles.ts` y `pos/mesas.ts` tienen el mismo patrón sin transacción
  — no son de precio, pendiente aparte si se quiere.
- **M11a — YA MERGEADA** (`aprobarYEnviarTransferencia`,
  `cancelarSolicitudTransferencia`, `rechazarSolicitudTransferencia` a caso
  de uso). Cambio de comportamiento menor: un `seccionOrigenId` que no es
  string ahora da un mensaje claro en vez de un error crudo de Prisma (mismo
  criterio que M8).
- **M11b — YA MERGEADA** (`aceptarTransferencia`,
  `rechazarTransferencia`, `confirmarReingresoTransferencia` a caso de uso;
  I3 conservada en aceptar y reingreso). Amplió
  `test/arquitectura/confirmacion-en-un-solo-lugar.test.ts` para revisar
  también `casos-de-uso/` — verificado que no debilita la regla.
- **M11c — YA MERGEADA, CIERRA LA CADENA** (`crearSolicitudTransferencia`,
  `crearEnvioDirectoTransferencia` a caso de uso). Sin I3 en ninguna de las
  dos (motivo documentado caso por caso — el envío directo queda con un
  riesgo residual anotado: reintento de red podría duplicar el envío,
  pendiente fuera de esta fase porque cambiaría el contrato). Hallazgo real:
  la regla `accion-migrada-sin-orquestacion` aplica al ARCHIVO entero, así
  que las 2 funciones de lectura (`obtenerBandejaTransferencias`,
  `listarSucursalesDisponibles`) tuvieron que mudarse tal cual a
  `traspasos/lecturas.ts` (una Server Action no puede importar
  `server/consultas/`, así que no podían migrar a esa capa) — con eso,
  `traspasos.ts` (ya solo con las 8 escrituras) entró en
  `ACCIONES_CON_CASO_DE_USO`. Se borraron los 2 helpers viejos
  (`obtenerProductoTransferible`, `escribirMovimientoTraspaso`), ya
  reemplazados por sus equivalentes en `casos-de-uso/`/`persistencia/`.
- **M12a — YA MERGEADA** (`cerrarCuenta` a caso de uso: comando+guard en
  `core/features/cuentas/`, persistencia nueva en `server/persistencia/pos/`
  — no existía, se armó desde cero, cerrando de paso el ítem P2 opcional del
  backlog —, caso de uso en `server/actions/pos/casos-de-uso/cerrar-cuenta.ts`).
  Idempotencia por estado y numeración de boleta verificadas contra el
  comportamiento original.
- **M12b — YA MERGEADA** (`emitirBoletaCorregida` a caso de uso, mismo
  archivo que M12a). Con las dos migradas, `cuenta-cierre.ts` ya no tiene
  ninguna otra función y **entró en `ACCIONES_CON_CASO_DE_USO`** (verificado
  con `npm run arquitectura` limpio). La Server Action no usa
  `aResultadoAccion` porque su contrato le devuelve además `numero`/`ejemplar`
  para imprimir.
- **M12c — YA MERGEADA** (`anularItemEnviado` a caso de uso; comando+guard en
  archivos APARTE de M12a/M12b — `cuenta-anulacion.schema.ts`/`.guard.ts` —
  mismo corte que ya tenían las Server Actions). Sin I3 (nunca la tuvo: el
  doble clic lo frena la guarda optimista de `restanteVisto`).
- **M12d — YA MERGEADA, CIERRA LA CADENA** (`anularPromoEnviada` a caso de
  uso: transacción todo-o-nada, una fila espejo + una de auditoría por cada
  componente vigente de la promo). Reusó `escribir-espejo-de-item.ts` de
  M12c con un parámetro opcional `promo`. `abrirCuenta` se evaluó y se
  descartó: vive en otro archivo (`pos/cuenta-apertura.ts`) y no mueve
  stock/dinero ni cierra un ciclo, así que no es una "mutación relevante" de
  la Fase M. Con las 2 funciones migradas, `cuenta-anulacion.ts` **entró en
  `ACCIONES_CON_CASO_DE_USO`**. **Con esto se cierra toda la cadena M11/M12
  de esta ronda** (M11a→b→c y M12a→b→c→d, las 8 sub-tareas mergeadas).

**Hallazgo real detectado al reverificar M11c (no introducido por esta sesión, pre-existente desde M10), y VUELTO A VER
al reverificar el fix de `venta.ts`:** `sincronizarPrecioGrupoCarta` y `sincronizarPrecioLocalGrupoCarta`
(`src/server/actions/catalogo/productos.ts` y `src/server/actions/movimientos/precio-local.ts`) arman el mensaje de éxito
listando los productos en el orden que devuelve `tx.producto.findMany({ where: { id: { in: ids } } })`, SIN `orderBy` —
Postgres no garantiza que ese orden respete el de `ids`, así que el texto del mensaje (y `test/catalogo/sincronizar-precio-grupo.test.ts`,
que lo fija exacto) puede flaquear según el plan de ejecución. Confirmado flake real dos veces, en dos funciones distintas
del mismo archivo/patrón de M10 (no una regresión de M11c ni del fix de `venta.ts`): corridas aisladas en verde, una falla
puntual en medio de la suite completa, corrida completa siguiente en verde. Ya reapareció dos veces en la misma noche —
conviene resolverlo pronto para que deje de generar ruido en cada reverificación. Arreglo sugerido, chico: agregar
`orderBy` explícito por el orden de `ids` (o armar el mensaje ordenando por nombre) en AMBAS funciones — no bloquea nada
de la Fase M, queda anotado acá para una tarea aparte (encaja bien como parte de K2, ya que toca el mismo archivo que
varios hallazgos de knip).
- **M13a/b/c/d/e** — el motor genérico `registrarMovimiento`
  (`server/actions/movimientos/movimientos.ts`, 512 líneas, 9 procesos): UN
  caso de uso genérico, no una fachada por proceso (la UI ya es genérica).
  Plan diseñado por un agente de planificación (Opus, 2026-09-28) leyendo el
  código real — confirmó que ni `reclasificarStock` ni `registrarConteoFisico`
  llaman hoy a `registrarMovimiento` (cada uno tiene su propio camino, como
  decía el backlog) y que la regla `persistencia-solo-desde-casos-de-uso`
  obliga a que (a) ya cree el caso de uso completo (no solo las cargas). Orden
  confirmado: **M13a → M13b → M13c → M13d → M13e1 → M13e2** (6 worktrees).
  - **M13a — YA MERGEADA** (2026-09-28): `core/features/movimientos/movimiento.schema.ts`
    (tipos mudados tal cual + los nuevos `Codigo/Datos/ResultadoRegistrarMovimiento`);
    `server/persistencia/movimientos/cargar-validaciones-de-movimiento.ts`
    (motivo/destino/factura duplicada, FUERA de la transacción con el cliente
    global — excepción documentada igual que P1) y `cargar-linea-de-movimiento.ts`
    (presentación activa y receta vigente para producir, DENTRO de la
    transacción); paso compartido `casos-de-uso/armar-linea-de-movimiento.ts`
    (armarLineaMovimiento/calcularConsumosProduccion mudadas tal cual); el
    caso de uso `casos-de-uso/registrar-movimiento.ts` con TODA la
    orquestación (sección propia, motivo/destino, factura, I3, transacción,
    escritura — las escrituras siguen en línea, eso es M13b). `movimientos.ts`
    quedó como adaptador fino, TODAVÍA sin entrar en `ACCIONES_CON_CASO_DE_USO`
    (eso es M13c). `test/arquitectura/lectores-de-receta.test.ts` reclasificado.
    Reverificado independientemente: los 7 comandos en verde — 274/274
    archivos y 3285/3285 tests de Vitest, build, 369/369 specs de Playwright.
  - **M13b — YA MERGEADA** (2026-09-28): `server/persistencia/movimientos/escribir-movimiento-de-stock.ts`
    con DOS funciones separadas (`escribirOperacionDeStock`/`escribirLineasDeMovimientoStock`,
    `tx` obligatorio) para preservar el orden EXACTO de hoy (el caso de uso
    necesita el `id` de la Operacion antes de armar las filas, y arma las de
    Producción leyendo `obtenerProducto` de cada insumo DESPUÉS del INSERT).
    El `tx.operacion.update` del mensaje I3 pasa a usar
    `registrarResultadoIdempotente` (ya existía en `core/movimientos/idempotencia.ts`,
    mismo uso que `anular-compra.ts` — no hizo falta crearla). El armado de
    filas (lógica de negocio) se quedó en el caso de uso. Ningún test tocado.
    Reverificado independientemente: los 7 comandos en verde — 274/274
    archivos y 3285/3285 tests de Vitest, build, 369/369 specs de Playwright.
  - **M13c — YA MERGEADA, CIERRA LA MIGRACIÓN DE `movimientos.ts`** (2026-09-28):
    comando+guard puro en `core/features/movimientos/movimiento.guard.ts`
    (las 4 validaciones de siempre, MISMOS textos y MISMO orden;
    `guardNroFacturaCompra` se quedó en el caso de uso, por el orden de
    mensajes) MÁS una 5ª validación, endureciendo un hueco real: `proceso`
    tiene que ser uno de los 9 `ProcesoGenerico` (`Record<ProcesoGenerico, true>`,
    para que `tsc` fuerce actualizarlo si el enum de Prisma cambia) —
    `ACCION_POR_PROCESO` también resuelve VENTA/CONTROL a un permiso real, así
    que un payload armado a mano con esos procesos pasaba `conPermiso` sin que
    nada, DENTRO de la acción, lo frenara después; el guard es la segunda
    barrera. El hookup de proveedor (Compra) se extrajo a un paso nombrado,
    `registrarProveedoresDeLaCompra`. `movimientos.ts` entró en
    `ACCIONES_CON_CASO_DE_USO` — sección M13a-c agregada en
    `docs/arquitectura-casos-de-uso-2026-09-27.md`. Test nuevo (2 casos,
    `test/movimientos/registrar-movimiento.test.ts`) demuestra el rechazo con
    `proceso: "VENTA"`/`"CONTROL"` armados a mano, sin escribir ninguna
    Operacion. Reverificado independientemente: los 7 comandos en verde —
    274/274 archivos y 3287/3287 tests de Vitest (274 + 2 nuevos), build,
    369/369 specs de Playwright.
  - **M13d — YA MERGEADA** (2026-09-28): `reclasificarStock`
    (`server/actions/stock/reclasificacion.ts`) migrado a caso de uso PROPIO
    (comando+guard en `core/features/movimientos/reclasificacion.{schema,guard}.ts`;
    NO reutiliza el motor genérico de M13a-c — entrada/permiso/validación/
    escritura son todos distintos, RECLASIFICACION está excluida de
    `ProcesoGenerico`), que sí reutiliza `escribirOperacionDeStock`/
    `escribirLineasDeMovimientoStock` de M13b y `registrarResultadoIdempotente`.
    Carga compartida `server/persistencia/movimientos/cargar-producto-con-unidad-de-stock.ts`
    (pensada también para M13e). `obtenerSaldoDisponibleParaReclasificar` se
    mudó tal cual a `server/actions/stock/lecturas-reclasificacion.ts` (estilo
    M11c) y `reclasificacion.ts` entró en `ACCIONES_CON_CASO_DE_USO`. Efecto
    colateral menor (knip): `esClaveIdempotenciaValida` dejó de reexportarse
    desde `core/movimientos/idempotencia.ts`/`public-servidor.ts` — era el
    último consumidor de ese reexport, ahora importa directo de
    `core/datos/clave-idempotencia`, igual que los demás guards. Reverificado
    independientemente: los 7 comandos en verde — 274/274 archivos y
    3287/3287 tests de Vitest, build, 369/369 specs de Playwright.
  - **M13e1 — YA MERGEADA** (2026-09-28): `registrarConteoFisico`/
    `registrarConteosFisicos` (y su motor compartido, antes
    `registrarConteoConContexto`) migrados a
    `casos-de-uso/registrar-conteo-fisico.ts`, reutilizando
    `cargarProductoConUnidadDeStock` (M13d) y `escribirOperacionDeStock`/
    `escribirLineasDeMovimientoStock` (M13b). El guard corre UNA VEZ POR FILA
    dentro de `registrarConteosFisicos` (la sesión y el permiso siguen
    comprobándose una sola vez para toda la tanda, igual que antes). Migración
    PARCIAL a propósito, como P1: `resolverConteoPendiente`,
    `cancelarConteoFisico` y `obtenerHistorialConteosFisicos` quedan sin
    tocar — eso es M13e2. Reverificado independientemente: los 7 comandos en
    verde — 274/274 archivos y 3287/3287 tests de Vitest, build, 369/369
    specs de Playwright. Ningún test tocado.
  - **M13e2 — YA MERGEADA, CIERRA TODA LA CADENA M13a→e** (2026-09-28):
    `resolverConteoPendiente`/`cancelarConteoFisico` migrados a casos de uso
    propios, reutilizando `cargarProductoConUnidadDeStock` (M13d) y
    `escribirOperacionDeStock`/`escribirLineasDeMovimientoStock` (M13b) para
    los ajustes de Kardex. Persistencia compartida nueva:
    `cargar-conteo-fisico.ts` y `actualizarEstadoDeConteo` (sumada a
    `escribir-conteo-fisico.ts` de M13e1). `obtenerHistorialConteosFisicos` se
    mudó tal cual a `lecturas-conteo-fisico.ts` (estilo M11c/M13d). Con las 4
    mutaciones migradas y la lectura movida, `conteo-fisico.ts` entró en
    `ACCIONES_CON_CASO_DE_USO`. Reverificado independientemente: los 7
    comandos en verde — 274/274 archivos y 3287/3287 tests de Vitest, build,
    369/369 specs de Playwright.

  **CON ESTO SE CIERRA TODA LA CADENA M13a→b→c→d→e1→e2** (6 worktrees, 6
  merges independientes a `main`, todos reverificados). Desbloquea M14 y E1.
  - Decisión tomada (deferida, no en el alcance de M13): `upsertProveedorPorProducto`
    NO se muda a `server/persistencia/` en esta fase — queda anotado para E1.
  - Ningún sub-paso toca `prisma/schema.prisma` ni migraciones — confirmado en
    el plan y verificado con `git diff --stat` en cada merge.
  - Cierre de cada sub-paso: los 7 comandos en verde en la MISMA corrida,
    conteos de tests/specs iguales o mayores a la línea de base (274/3285
    Vitest, 369/66 Playwright), y `git diff main -- test/` limitado a la
    lista de tests que cada sub-paso puede tocar (documentada en el plan).
- **M14 — YA MERGEADA** (2026-09-28, autorización expresa del dueño para la
  migración de schema): caso de uso `registrarPagoConsignante`
  (`reportes/consignacion.ts`) — antes sin transacción, sin I3, sin
  auditoría, un doble clic real registraba el pago dos veces. Migración de
  schema: `PagoConsignante` gana 3 columnas nullable + `@@unique`
  (`claveIdempotencia`, `payloadHash`, `resultadoMensaje`), mismo criterio
  "rollout gradual" que `Operacion`
  (`prisma/migrations/20260928040000_i3_idempotencia_pago_consignante/`).
  Comando+guard en `core/features/reportes/pago-consignante.{schema,guard}.ts`;
  persistencia en `server/persistencia/reportes/pago-consignante.ts`; caso
  de uso en `reportes/casos-de-uso/registrar-pago-consignante.ts` con
  `prisma.$transaction` SIMPLE (sin `conTransaccionSerializable`: no hay
  invariante de agregado que proteger, solo un insert con clave única — un
  P2002 de carrera real se atrapa aparte). Opción B con un solo `create`
  (el mensaje de éxito se conoce antes del insert, a diferencia de
  `Operacion`). Auditoría nueva (`registrarCambioAuditado`, entidad
  `"PagoConsignante"`, agregada a `CambioAuditable` y al filtro de la
  página de auditoría). UI cableada de verdad
  (`registrar-pago-consignante.tsx`, mismo patrón `crypto.randomUUID()` que
  `venta-form.tsx`) — el alcance incluyó la UI a propósito, para cerrar el
  bug real, no solo dejarlo testeable a nivel Server Action. `consignacion.ts`
  entró en `ACCIONES_CON_CASO_DE_USO`. Test de doble-clic demostrado
  rojo→verde (mutando temporalmente el `create` para no persistir la
  clave, simulando el estado pre-M14: 2 filas en vez de 1; revertido,
  vuelve a pasar). Los 7 comandos en verde: 274/274 archivos y 3289/3289
  tests de Vitest, build (con la migración aplicada), 369/369 specs de
  Playwright.

---

## PARTE 2 — Backlog #15 a #40 (independiente de #41, sin tocar todavía)

Todos estos ya tienen grounding contra un sistema de referencia (Odoo,
POSR/ahmedali5530) hecho por un agente esta sesión, guardado en `docs/` del
repo salvo que se indique lo contrario. Ninguno tiene código escrito
todavía. Usar la skill `plan-con-verificacion-e2e` para diseñar el plan de
cada uno antes de tocar código (un agente `Plan`, modelo Opus, por
pendiente, verificando el código real antes de proponer nada).

### #15 — Apertura y cierre de salón/turno (grounding contra ahmedali5530/restaurant-pos)
El dueño preguntó por esto comparando contra
https://github.com/ahmedali5530/restaurant-pos (ya usado como grounding para
impresión). Investigar antes de proponer: si existe algo parecido hoy en
motor2 (buscar "turno"/"shift"/"apertura"/"cierre de caja" — probablemente
no exista nada), cómo lo resuelve el repo de referencia y los demás citados
en `docs/grounding-pos-mesas-comandas-2026-09-24.md`, si tiene sentido para
La Cuadra dado que ya existen Cuenta/Mesa por separado, y si un "turno" es
más una agrupación de reportes (boletas entre las 12:00 y el cierre) que una
entidad con ciclo de vida propio. Relación con la numeración de boleta
(Task #1, ya mergeada): capaz alcanza con "boletas emitidas en un rango de
fecha/hora", sin tabla nueva. **Ojo con no sobre-diseñar** — evaluar primero
si alcanza con un reporte/filtro por fecha en vez de una entidad "Turno"
completa. *(Nota: si #37 de abajo, "caja/turno con conciliación", avanza
primero, puede que ya resuelva esto — revisar solapamiento antes de
diseñar los dos por separado.)*

### #18 — Acceso directo a "anular esta línea" desde la boleta
Hoy la única forma de corregir una venta cerrada es Reportes → Trazabilidad,
buscar la operación a mano (permiso `ver_reportes_operativos`). El dueño
quiere que Reportes pueda seguir siendo el mecanismo de fondo, pero no el
ÚNICO camino para una tarea cotidiana. **Solución simple ya identificada:**
`src/app/(app)/reportes/trazabilidad/page.tsx` YA soporta un deep-link por
operación vía `?idOperacion=X`. Se podría agregar, desde "Cuentas cerradas"
de la mesa, un enlace directo "¿Algo salió mal en esta línea? Corregirla →"
apuntando a ese deep-link. Investigar antes: si `BoletaDeCuenta`/
`LineaDeBoleta` (`src/core/pos/boleta.ts`) expone el `operacionId` de cada
línea (probablemente NO, `armarBoleta` agrupa por `productoId+precioUnitario`
sin traer `operacionId` — habría que sumarlo al join); qué permiso necesita
el enlace (¿`pos_cerrar_cuenta`, el mismo que ya gatea "Cuentas cerradas", o
también `ver_reportes_operativos` porque el destino es Trazabilidad?); si
conviene el enlace solo en pantalla (no en la boleta impresa, no tiene
sentido en papel).

### #21 — Investigar: "Emitir boleta corregida" deshabilitado en producción
El dueño reportó (screenshot 2026-09-26 23:41, motor2-demo) que en 3 cuentas
cerradas de Mesa 01 el botón aparece deshabilitado. **Hipótesis a verificar
contra el código antes de asumir bug:** el botón solo se habilita cuando
`estadoDeBoleta === "desactualizada"` (hubo una anulación de línea DESPUÉS
de imprimir/cerrar) — si ninguna de esas 3 cuentas tuvo una anulación
posterior al cierre, el disabled es el comportamiento esperado. Además, 2 de
las 3 no muestran "N.º X-Y" (se cerraron antes de que existiera la
numeración — Task #1 —, sin `EjemplarBoleta`, no corregibles por diseño).
**Confirmar con el dueño qué acción esperaba poder hacer exactamente antes
de tocar código.**

### #22 — UX de "anular venta" por producto: no aclara efecto sobre la boleta
Al buscar "anular venta" por producto (en Trazabilidad) no queda claro si
afecta un ítem puntual de una boleta específica, ni qué efecto tiene sobre
esa boleta (¿queda "desactualizada"? ¿hay que emitir boleta corregida
después?). Investigar el flujo real de `/reportes/trazabilidad` y
`anularVenta` antes de proponer cambios de UX. Se relaciona con #18 y #21 —
diseñar los tres juntos tiene sentido, comparten la misma pantalla y el
mismo concepto de "boleta desactualizada".

### #34 — Desborde real (no flake) en `/stock/minimo` a 1024px
**IMPORTANTE — esta sesión encontró evidencia de que SÍ es un flake real de
carga, no una regresión de CSS fija:** el spec
`test/e2e/maquetacion-general.spec.ts` (`/stock/minimo: nada se sale de su
caja a 1024 px`) falló repetidas veces esta sesión SOLO cuando había 4-5
suites de Playwright corriendo en paralelo en el mismo sandbox (carga alta),
y pasó limpio, de forma reproducible, en TODAS las corridas aisladas (sin
concurrencia) — confirmado independientemente por al menos 5 agentes
distintos en worktrees separados. Overflow real medido: ~2-4px, borderline,
consistente con una condición de carrera de layout bajo contención de CPU
(fuente cargando tarde, medición de ancho antes del reflow), no con una
regla CSS rota. **Antes de invertir en arreglar el layout:** confirmar que
de verdad falla en un entorno SIN concurrencia artificial (CI real, o local
sin otros procesos pesados) — si nunca falla aislado, el pendiente real
podría ser "hacer el test más tolerante a latencia de fuente" en vez de
"arreglar el desborde". No descartar la hipótesis original sin volver a
medir: hay reportes previos (de antes de esta sesión) de fallos
deterministas, así que confirmar el patrón real antes de cerrar esto como
"solo flake".

### #35 — Compras: nota de crédito de proveedor (K1d)
Grounding completo contra Odoo (`accounting`/`purchase`) en
`docs/propuesta-nota-credito-proveedor-cuenta-corriente-2026-09-26.md`
§2.2. Reafirma la Opción B ya decidida antes de esta sesión (tabla propia de
NC separada del Kardex; solo si hay devolución física se genera una
`DEVOLUCION_PROVEEDOR` vinculada). Aportes de Odoo: vínculo FK a la
`Operacion` COMPRA y a la `MovimientoStock` de línea (tope "comprado − ya
devuelto" por renglón); patrón "NC suelta, vinculada después"; el tope de
cantidad sigue siendo BLOQUEO (no aviso); valuar la devolución física al
precio de línea comprada (como ya hace `anularCompra`), no al costo de
reposición de hoy; FK real en vez de texto en `detalleLibre`; precedente
interno más cercano: `CuentaItem.anulaAItemId`.
**DECISIÓN DE NEGOCIO ABIERTA (no la resuelve Odoo):** ¿una bonificación de
precio en la NC cambia el costo de reposición del producto? Depende
conceptualmente de #36 (comparten el registro de pago a proveedor) pero
puede implementarse antes si se elige Opción B sin cuenta corriente todavía.
Documento fuente completo: `propuesta-nota-credito-proveedor-cuenta-corriente-2026-09-26.md`
(subido por el usuario, fuera del repo).

### #36 — Compras: cuenta corriente / saldo a pagar de proveedores
Grounding contra Odoo (`account.payment`, `account.partial.reconcile`) en
el mismo documento, §2.3. Hoy no existe ningún registro de pago a proveedor
de compra normal (el único precedente es `PagoConsignante`, solo para
consignación). Dos enfoques evaluados — **L (liviano)**: saldo calculado por
reporte (Σcompras − ΣNC − Σpagos), sin conciliación por documento; **C
(conciliación)**: entidad de "aplicación" tipo `account.partial.reconcile`,
da estado por compra y antigüedad de deuda. C es superconjunto de L (se
puede empezar por L y agregar C después sin migrar pagos).
**10 DECISIONES DE NEGOCIO ABIERTAS** (nivel de detalle L vs C, si un pago
lleva medio de pago, cómo se aplica una NC, compras de contado, desde cuándo
se lleva la cuenta corriente, alcance por sucursal o global, si se unifica
con `PagoConsignante`, si se bloquea anular una compra con pagos aplicados,
crédito a favor, permisos — el detalle completo de cada una está en el
documento fuente). Depende de resolver primero la decisión de #35 (ambas
comparten el pendiente de fondo K1d). Documento fuente: el mismo de #35,
§2.3-2.5.

### #37 — POS: caja/turno con conciliación de efectivo (arqueo)
Grounding contra POSR en
`docs/propuesta-pos-incrementales-sin-cambio-arquitectura-2026-09-26.md`
§2.2. **Es EXPANSIÓN DE ALCANCE, no bugfix:** revierte la decisión B5
explícita ("motor2 no tiene entidad de caja/pago" — pagar y cerrar son una
sola acción atómica). Obliga a tocar `cerrarCuenta` (hay que preguntar el
medio de pago al cerrar). Dos enfoques — **A (turno completo, patrón
`day_closing` de POSR)**: entidad `TurnoCaja` (fondo inicial, efectivo
contado, esperado calculado y congelado al cerrar, diferencia, motivo
obligatorio si supera un umbral) + movimientos manuales de caja + registro
de pago por cierre; **B (solo medio de pago, sin turno)**: un pago por
cierre + reporte por medio de pago, sin fondo inicial ni esperado-vs-contado
(B es subconjunto de A). **6 DECISIONES DE NEGOCIO ABIERTAS** (¿se revierte
B5?, quién opera la caja, qué pasa con cuentas abiertas al cerrar turno, si
la venta de mostrador entra en la caja, anulación posterior al cierre de un
turno, si se bloquea cerrar sin turno abierto). Si también avanza #38
(dividir cuentas), conviene diseñar juntos el mismo diálogo de cierre — el
"dividir por monto" de #38 DEPENDE de esta task. También comparte el diseño
del "registro de pago" con #36. Documento fuente:
`propuesta-pos-incrementales-sin-cambio-arquitectura-2026-09-26.md` §2.2.

### #38 — POS: dividir y unir cuentas
Grounding contra POSR, mismo documento, §2.1. Hoy NO existe ninguna
operación de dividir ni unir cuentas. **Dividir cuenta NO es un hueco
técnico: revierte una decisión de producto tomada A PROPÓSITO** (el schema
dice literalmente que `Cuenta.comensales` NO habilita dividir por persona) —
el dueño tiene que revertirla explícitamente. Unir cuentas no revierte nada,
solo estaba postergado. Dos enfoques — **A (cuenta hija/nueva, patrón
`splitOrder`/`mergeOrders` de POSR)**, con una variante más acotada
("dividir solo al cobrar, con filas enteras", sin abrir el índice único de
"una cuenta por mesa" ni tocar `numeroEnvio`/KOT); **B (subcuentas dentro de
la misma Cuenta)**, más frágil (rompe `@@unique([cuentaId, ejemplar])` de
`EjemplarBoleta`, no sirve para unir). "Dividir por monto" NO es viable solo
con `CuentaItem` (duplicaría el descuento de stock) — depende de #37.
**5 DECISIONES DE NEGOCIO ABIERTAS** (¿se revierte `Cuenta.comensales`?,
¿solo al cobrar o cuentas divididas siguen abiertas?, ¿cantidades parciales
de una fila ya enviada?, qué mesa conserva la cuenta al unir, quién puede
dividir/unir). Documento fuente: el mismo de #37, §2.1.

### #39 — POS: impresión real (agente local / cola en vez de `window.print`)
Grounding contra POSR, mismo documento, §2.3. **Revisa una premisa
operativa ya validada y documentada** ("hay una sola PC que ve las dos
impresoras, por eso no hay agente local") y agrega infraestructura nueva que
hoy no existe (motor2 es 100% Vercel serverless, cero procesos extra). Un
daemon ESC/POS real necesita proceso persistente, acceso al dispositivo y
alcance de red — ninguno lo tiene una función serverless. Dos enfoques — **A
(push, navegador→agente local)**: cambio mínimo en servidor, pero choca con
restricciones del navegador para llamar a `localhost`/IP privada desde
HTTPS público; **B (pull, cola en Postgres, agente consulta por HTTPS
saliente)**: durable, compatible con serverless, pero necesita canal de
autenticación de dispositivos nuevo y operar un agente en cada local. **Es
el cambio de MAYOR COSTO OPERATIVO de todo el lote de backlog**, aunque no
toque el modelo de dominio. **Alternativa ya documentada sin infraestructura
nueva:** `--kiosk-printing` (si lo que molesta es el diálogo del navegador,
no el ruteo automático). **4 DECISIONES DE NEGOCIO ABIERTAS** (¿sigue
siendo cierta la premisa de una sola PC?, qué molesta realmente hoy, si
vale la pena el costo operativo de un agente nuevo, push vs. pull).
Documento fuente: el mismo de #37/#38, §2.3.

### #40 — Facturación fiscal de venta (grounding contra Odoo)
Grounding completo (motor2 real + Odoo 20.0 `sale`/`account`/`sale_stock`/
`point_of_sale`, código fuente, sin WebFetch), documento fuera del repo:
`grounding-facturacion-ventas-odoo-2026-09-26.md` (con un anexo §2.10 de
re-verificación cruzada independiente por un segundo modelo — confirmó todo
lo original y sumó 3 precisiones menores). **Estado actual confirmado:**
motor2 no tiene NINGÚN circuito de facturación fiscal (cero AFIP/CAE en todo
el repo); `nroFactura` en `Operacion` VENTA es texto libre sin semántica
fiscal; `EjemplarBoleta` está documentado explícitamente como "NO
comprobante fiscal"; no existen medios de pago, cuenta corriente de cliente,
IVA desagregado, ni un `Cliente` completo (sin CUIT/DNI/condición de IVA).
**Recomendación del grounding (no decisión tomada):** tomar el modelo POS de
Odoo (`pos.order`) como referencia, NO el flujo B2B completo (`sale.order`)
— motor2 ya une venta+stock en un paso, como POS. Cualquier dato nuevo
cuelga de la `Operacion` VENTA existente. Numeración fiscal siguiendo el
patrón que ya existe para `nroFactura` de COMPRA, extendido a VENTA, con
"talonario/punto de venta" como entidad propia. Medios de pago: modelo
simple "pago" (tipo+monto) 1:N con la Operacion VENTA. Anulación: mismo
principio append-only que `anularVenta` ya usa. **Técnica de rollout ya
validada, sin decisión de negocio:** motor2 ya oculta pantallas enteras por
permiso (gate real en servidor vía `conPermiso`/`requerirVer`) — se puede
construir el módulo entero sin asignarle permiso a ningún rol todavía,
queda invisible y se activa después como cambio de datos, no de deploy.
**6 DECISIONES DE NEGOCIO ABIERTAS** (¿facturación fiscal real con AFIP/CAE
o comprobante interno ampliado?, tipo de comprobante A/B/C/M y condición de
IVA, si se factura antes o después de vender, medios de pago habilitados,
si se permite cuenta corriente/fiado de cliente, alcance del `Cliente`).
Depende del mismo "registro de pago" que #36/#37 — conviene diseñar el
medio de pago una sola vez si varias de estas tres avanzan. Documento
fuente completo: `grounding-facturacion-ventas-odoo-2026-09-26.md`
(hay una versión anterior sin el anexo §2.10, usar la que lo tiene).

---

## Hallazgo post-cierre (2026-09-28): cobertura de test de la carrera real de I3, inventario

**Cómo apareció:** al agregar un test de carrera CONCURRENTE de verdad
(`Promise.allSettled`, no dos `await` secuenciales) para `registrarPagoConsignante`
(M14) — el test secuencial que ya existía nunca ejercitaba el catch del
P2002 real. Se corrigió ESE caso puntual (`test/reportes/consignacion.test.ts`,
commit `3e115db`, demostrado rojo→verde revirtiendo el catch). **Antes de
asumir que el resto del proyecto está igual de cubierto, se auditaron TODAS
las acciones que usan `claveIdempotencia`** — no se corrigió nada más
todavía, es un inventario para decidir, no una corrección silenciosa.

**Acciones con I3 en su schema, por cobertura real de test:**

| Acción | Test secuencial (2 `await`) | Test CONCURRENTE real (`Promise.all`/`allSettled`) |
|---|---|---|
| `registrarMovimiento` | Sí | Sí (`test/auditoria/idempotencia-i3-mecanismo.test.ts`) |
| `registrarVenta` | Sí | Sí (mismo archivo) |
| `aceptarTransferencia` | Sí | Sí (mismo archivo) |
| `confirmarReingresoTransferencia` | Sí | Sí (mismo archivo) |
| `registrarPagoConsignante` (M14) | Sí | Sí (agregado 2026-09-28, `test/reportes/consignacion.test.ts`) |
| `anularCompra` | Sí (`test/casos-de-uso/anular-compra.test.ts:124-126`) | **Sí — corrección a la fila anterior de esta tabla**: la primera auditoría (manual, mirando solo `test/casos-de-uso/anular-compra.test.ts`) decía que no; el test de arquitectura automático (`idempotencia-i3-cobertura-concurrente.test.ts`) encontró un SEGUNDO archivo, `test/movimientos/compras-anular.test.ts` (`describe("concurrencia")`, línea 288), con un `Promise.allSettled` real. No es la misma carrera exacta (prueba el guardia de estado `anuladaEn`, no específicamente la colisión de `claveIdempotencia` — `anularCompraCasoDeUso` usa `conTransaccionSerializable`, no el `$transaction` simple de M14, así que una colisión de clave se resuelve por reintento, no por un catch de P2002 explícito), pero cubre el riesgo real de doble-submit. |
| `reclasificarStock` (M13d) | Sí (agregado 2026-09-28, `test/stock/reclasificacion.test.ts`) | Sí (mismo commit `8762b4c`) — **cerrado, `SIN_TEST_CONCURRENTE_TODAVIA` queda vacía** |

**Acciones sin I3 — confirmado que es diseño, no un olvido:**
- `corregirCompra` — usa un mecanismo distinto a propósito (`esperado: CabeceraVista` comparado contra el estado real, código `CAMBIO_CONCURRENTE`): es una corrección idempotente por naturaleza (fijar la cabecera a un valor exacto), no necesita clave de cliente.
- `crearSolicitudTransferencia`/`crearEnvioDirectoTransferencia` (M11c) — ya documentado en su momento como "riesgo residual anotado, pendiente fuera de esta fase porque cambiaría el contrato". No es un hallazgo nuevo, se repite acá solo para que quede en la misma tabla.
- `registrarConteoFisico`/`registrarConteosFisicos` (M13e1) — nunca tuvieron `claveIdempotencia` en su schema (`core/features/movimientos/conteo-fisico.schema.ts`), no es una omisión de esta sesión.
- `resolverConteoPendiente`/`cancelarConteoFisico` (M13e2) — no usan clave de cliente porque el chequeo de `estado` (`!== "PENDIENTE"`/`"RESUELTO"`) ya es idempotente por sí solo: un reintento sobre el mismo `conteoId` da el mismo resultado sin duplicar nada.

**Prevención agregada (commit `82745c7`, mismo día) — no dejar esto como un inventario que se desactualiza solo:**
1. **`test/arquitectura/idempotencia-i3-cobertura-concurrente.test.ts`** — DESCUBRE (no una lista a mano) todo caso de uso que importa `calcularPayloadHash` y exige un test con `Promise.all`/`allSettled` real, salvo excepción documentada en `SIN_TEST_CONCURRENTE_TODAVIA` con motivo (mismo esquema fail-closed que `PENDIENTES_DE_MIGRAR`). Ya reemplaza esta tabla como fuente de verdad — si algo acá arriba queda desactualizado, ese test es el que manda.
2. **Cobertura** (`@vitest/coverage-v8`, `npm run test:coverage`) — informativa por ahora, acotada a `casos-de-uso/`/`persistencia/`. Hubiera marcado en rojo el catch de P2002 sin cubrir de M14 desde el día uno.
3. **Mutation testing** (Stryker, `npm run mutacion`) — auditoría periódica/manual (la suite completa es demasiado lenta para correr por mutante en CI). Un smoke test encontró una mutación sobreviviente real en `registrar-pago-consignante.ts` (`repetido: true→false`, sin ningún test que la detecte) en 19 segundos.
4. De paso, se invirtió `DOMINIOS_CON_PUBLIC` (allowlist) a `DOMINIOS_DE_NEGOCIO` + `DOMINIOS_SIN_PUBLIC_TODAVIA` (excepción con motivo) en `.dependency-cruiser.cjs` — mismo problema de fondo (un dominio nuevo sin fachada quedaba sin protección porque nadie se acordaba de sumarlo a la lista). Comportamiento idéntico hoy para `pos`/`stock`/`compras`/`carta` (0 arquitectura roto), pero ahora el default es proteger.

**`reclasificarStock` — CERRADO (2026-09-28, commit `8762b4c`):** 3 tests nuevos (doble clic secuencial, conflicto por payload distinto, carrera concurrente real con `Promise.allSettled`), demostrado rojo→verde. Hallazgo de paso: sin el chequeo de I3, `conTransaccionSerializable` (SERIALIZABLE + reintento) igual evita la doble escritura en el Kardex, pero el request que pierde la carrera recibía un error confuso ("no hay saldo") en vez de una respuesta idempotente — ese es el valor real de I3 acá, más allá de la integridad de los datos. Con esto, `test/arquitectura/idempotencia-i3-cobertura-concurrente.test.ts` pasa con `SIN_TEST_CONCURRENTE_TODAVIA` vacía: **cero casos de uso de I3 sin cobertura concurrente real.**

**Pendiente real, sin decisión tomada todavía:**
1. `pos`/`stock`/`compras`/`carta` sin fachada `public.ts` — ver `DOMINIOS_SIN_PUBLIC_TODAVIA` en `.dependency-cruiser.cjs` para el detalle de cuántos sitios cruzan cada uno hoy. `pos` (candidato C4) y `stock` (candidato C5) ya tenían nombre asignado antes de esta sesión; `compras`/`carta` nunca se evaluaron.

### Nota de rendimiento del gate (2026-09-28)

El gate completo (7 comandos) tarda ~10-10.5 min de punta a punta, casi todo en `npm test` (~5 min) y `npm run test:e2e` (~4.5-5 min) — no en crear/migrar bases (eso solo importa cuando se vuelve al patrón de worktree + base dedicada de las fases M13/M14, no en los fixes chicos de este backlog, que corrieron todos directo sobre `main`).

**Aplicado, con mejora real:** `fsync=off` + `synchronous_commit=off` + `full_page_writes=off` en el Postgres LOCAL de desarrollo (confirmado exclusivo del usuario, sin relación con Neon — solo se usó Neon alguna vez para descargar datos a `motor2_demo`). Server-wide, no por base — requiere el rol `postgres` (el rol `motor2` de `.env` no es superusuario; `ALTER SYSTEM` dio "permiso denegado"). Aplicado editando `postgresql.conf` directo (con backup `postgresql.conf.bak-antes-de-tuning-test`) más `Restart-Service postgresql-x64-17` en una PowerShell elevada (`pg_ctl reload` sin elevación dio "Operation not permitted" — el servicio corre con otro usuario de Windows). Resultado medido: `npm test` 300-340s → ~258s; `npm run test:e2e` ~270-290s → ~250s. Mejora real pero moderada (~15-20%), no dramática.

**Probado y DESCARTADO: correr `npm test` y `npm run test:e2e` en paralelo.** Se verificaron primero los tres riesgos (puertos: Vitest no levanta servidor, solo Playwright usa el puerto 56471, exclusivo de e2e; archivos compartidos: sin uploads/tmp en `src/`, `npm test` nunca invoca el build de Next; bases: `motor2_dev`/`motor2_e2e` son bases separadas). Con eso descartado, se corrió una vez: bajó el tiempo total a ~5 min (los dos corren a la vez), pero con inestabilidad real — 4 archivos/36 tests fallaron en `npm test` (incluido un error crudo de Prisma dentro de `limpiarBaseDeTest`, no una aserción de negocio) y 5 specs fallaron en el e2e, ninguno relacionado con cambios de esta sesión. Recorrida la MISMA suite en secuencial con el tuning ya aplicado: 100% verde en ambas (280/280 archivos, 3313/3313 tests; 369/369 specs). Conclusión: la ganancia de tiempo no vale la inestabilidad — se descarta la ejecución concurrente, se mantiene el gate secuencial.

**Adoptado:** agrupar tareas chicas independientes del backlog en un solo ciclo de gates en vez de uno por tarea (ver #8/#12 de esta lista).

---

## Hallazgo post-cierre (2026-09-28): revisión del contrato de `registrarMovimientoCasoDeUso`, backlog priorizado

**Cómo apareció:** revisión manual punto por punto (contra el código real, no solo la descripción) de una crítica externa a la función más compleja de la Fase M (`registrarMovimientoCasoDeUso`, `src/server/actions/movimientos/casos-de-uso/registrar-movimiento.ts`). Dos puntos de la crítica original resultaron sobreestimados/imprecisos al verificarlos contra el código (el reintento completo de `conTransaccionSerializable` ante P2034 descarta el escenario de carrera con closure mutable; `(e as Error).message` sobre un valor no-Error solo revienta si ese valor es `null`/`undefined`, no en general) — quedan como aprendizaje, no como hallazgos. Se convirtió en este backlog (siguiendo la corrección de proceso: no parchear en el momento, primero inventariar y documentar) en vez de una corrección puntual.

**Orden acordado (mismo día):**

1. **Canonizar antes de validar stock — CERRADO (2026-09-28, commit `87dfdb8`).** `consumosReceta[].cantidad` salía de `resolverConsumoPorFamilia`/`calcularConsumosProduccion` sin redondear; el paso 2 (validación) sumaba esa cantidad CRUDA mientras el paso 3 (escritura) la redondeaba a los decimales de la unidad de stock del insumo antes de persistir — con un insumo de `decimales:0` y ≥2 líneas cuyo consumo individual redondea a 0, la suma cruda podía exceder el saldo disponible y rechazar "Stock insuficiente" contra un requerimiento real de 0. Fix: mismo redondeo (misma función, mismos argumentos — puro y determinístico) antes de acumular. Nueva prueba en `test/movimientos/registrar-movimiento.test.ts` (dos líneas de Producción, 0.3g c/u de un insumo `decimales:0`, sin stock previo), demostrada rojo→verde.
2. **Regla `prisma` global dentro de un callback `conTransaccionSerializable` — CERRADO (2026-09-28, commit `b9a56c2`).** `test/arquitectura/prisma-global-sin-escrituras-en-transaccion.test.ts`: descubre (no una lista a mano) todo archivo de `src/` que importa `{ prisma }` de `@/lib/db` y llama `conTransaccionSerializable(`, ubica el cuerpo real del callback por conteo de llaves (no una ventana de caracteres fija) y exige que ninguna escritura (`create`/`update`/`upsert`/`delete`/variantes `Many`/`$executeRaw*`/`$transaction` anidada) use `prisma.` en vez de `tx.` adentro — a propósito NO prohíbe lecturas con `prisma` fuera/antes de la transacción (patrón intencional ya usado en varios casos de uso reales). Auditados los 4 archivos que hoy combinan ambos patrones (`registrar-movimiento.ts`, `guardar-version-de-receta.ts`, `cuenta-apertura.ts`, `permisos.ts`): todos ya usan `prisma` global solo para lecturas fuera de la transacción — `EXCEPCIONES` queda vacía. Demostrado rojo→verde mutando temporalmente un `tx.cuenta.create` a `prisma.cuenta.create` en `cuenta-apertura.ts` y revirtiendo.
3. **Tipo `Resultado` discriminado para el patrón "repetida" — CERRADO (2026-09-28, commit `793dde5`).** `DatosRegistrarMovimiento`/`DatosReclasificarStock`/`DatosRegistrarPagoConsignante` pasaron de interfaz (campos de datos independientemente nullable + `repetida`/`repetido: boolean` suelto) a unión discriminada sobre `repetida`/`repetido`: cada rama fija sus campos a `null` o al tipo real, sin punto medio — `{ operacionId: "x", movimientos: 5, repetida: true }` ya no compila. Ningún caso de uso cambió de comportamiento (los 3 ya devolvían exactamente las combinaciones válidas) — confirmado con `tsc --noEmit` limpio sin tocar `src/server`. Nuevo `test/core/resultado-repetida-discriminado.test.ts` (mismo patrón `@ts-expect-error`/`expectTypeOf` que `test/core/resultado-caso.test.ts`, chequeado por `tsc`), demostrado quitando temporalmente un `@ts-expect-error` y viendo el error real de `tsc` antes de revertir.
4. **`registrarProveedoresDeLaCompra` — CERRADO (2026-09-28, commit `5fcc7e6`).** Guard `!resultado.datos.repetida` explícito antes de llamarla (antes solo `resultado.ok && proceso === "COMPRA" && proveedorId`). **Sin test de regresión dedicado, a propósito**: `lineasParaProveedor` es estructuralmente `[]` en el camino "duplicado" (el `return` de I3 pasa antes del paso 1 que la llena) y `upsertProveedorPorProducto` es un upsert idempotente — ni antes ni después del fix hay ningún estado de base observable que distinga "se llamó" de "no se llamó" con el mismo payload, así que un test que comparara el estado final de `ProveedorPorProducto` no hubiera detectado nada ni con el guard viejo ni con el nuevo. Es un cierre de contrato (la regla real queda escrita en el código, no como efecto colateral de dónde se inicializa una variable), verificado solo contra la suite de regresión completa (sin cambios de conteo).
5. **`(e as Error).message` en `registrarProveedoresDeLaCompra` — CERRADO (2026-09-28, commit `4da4520`).** Cambiado a `e instanceof Error ? e.message : String(e)` (única otra instancia del patrón en el proyecto: `core/reportes/cotizacion-dolar.ts`, ya auditado — no había más para corregir). Nuevo `test/movimientos/registrar-movimiento-hookup-proveedor-no-error.test.ts`, en su propio archivo con un `vi.mock` acotado a `upsertProveedorPorProducto` (un `PrismaClientKnownRequestError` real siempre es `instanceof Error`, así que la carrera solo se puede ejercitar inyectando un rechazo `null`). Demostrado rojo→verde: sin el fix, el mismo test revienta con `TypeError: Cannot read properties of null (reading 'message')` dentro del propio `catch` — un hookup best-effort de Catálogo devolviendo un 500 por una Compra que ya había escrito el Kardex con éxito.
6. **Extraer el armado de filas de `MovimientoStock` a una función pura + property-based tests (fast-check) — CERRADO (2026-09-28, commit `5c72d22`).** Nueva `core/movimientos/armar-filas-de-movimiento.ts` (`armarFilasDeMovimiento`): sin I/O, sin `Prisma.TransactionClient`, sin reloj. Para lograrlo, `armar-linea-de-movimiento.ts` (`calcularConsumosProduccion`) ahora resuelve el snapshot plano de cada insumo consumido (`decimalesUnidadStock`/`esConsignacion`/`precioConsignacion`) en el momento en que YA hace la única I/O real que hacía falta, en vez de que `registrar-movimiento.ts` la repitiera después (efecto colateral bueno: el paso 2, validación de stock, dejó de necesitar su propio `await obtenerProducto()` por consumo — un round-trip redundante menos). Refactor puro primero (mismo comportamiento, confirmado con la suite completa sin cambio de conteo salvo los tests nuevos), recién después `test/core/armar-filas-de-movimiento.propiedades.test.ts` (fast-check, 1000 corridas por propiedad, milisegundos sin Postgres) sobre los 6 invariantes confirmados. Demostrado rojo→verde con 2 mutaciones independientes (revertidas): sin el signo negativo del consumo (rompe #2 y #4 a la vez) y con la magnitud de entrada de Transferencia desincronizada de la de salida (rompe #1) — ambas detectadas por fast-check con contraejemplo mínimo.
7. **Tags de contrato en el docstring — CERRADO (2026-09-28, commit `1a59b16`).** `@contract`/`@idempotency`/`@transaction`/`@sideEffects` agregados al docstring de cada uno de los 23 casos de uso reales (`server/actions/<dominio>/casos-de-uso/`, excluidos a propósito los helpers internos `armar-linea-de-movimiento.ts`/`producto-transferible.ts`, nunca importados directo por su Server Action). Cada tag resume la prosa YA existente en el mismo docstring, verificada contra el código real (implementado en un fork, revisado con spot-checks contra archivos ya conocidos de esta sesión antes de comitear). Nuevo `test/arquitectura/casos-de-uso-con-tags-de-contrato.test.ts` (mismo esquema fail-closed de descubrimiento automático que los dos anteriores), `SIN_TAGS_TODAVIA` vacía, demostrado rojo→verde.
8. **Extender `idempotencia-i3-cobertura-concurrente.test.ts`** con la regla "rama de duplicado obligatoria" (todo caso de uso con I3 tiene que tener un branch que devuelva el resultado repetido, no solo un test que lo ejercite).
9. **Property-based testing de `calcularPayloadHash`/canonicalización** — mismo objeto en distinto orden de claves da el mismo hash.
10. **Test de contrato arquitectónico para la frontera `aResultadoAccion` ↔ caso de uso** — misma técnica de ventana de proximidad que `idempotencia-i3-cobertura-concurrente.test.ts` (400 caracteres alrededor de la llamada), para no repetir el falso positivo por archivo entero ya visto dos veces esta sesión.
11. **Documentar la limitación de `registrarProveedoresDeLaCompra`** — si falla, no hay forma de reintentar solo ese hookup sin repetir toda la Compra (decisión a tomar, no un bug).
12. **Devolver el dato de `lineasParaProveedor` desde la transacción** en vez del closure mutable reasignado — prioridad baja, el reintento completo de `conTransaccionSerializable` ya lo hace seguro hoy.
13. **Migración a `@typescript-eslint/parser` con `parserOptions.project`** para habilitar `no-floating-promises`/`no-misused-promises` — proyecto aparte, más grande y más ruidoso que todo lo anterior junto; hoy el proyecto parsea con `next/babel` (Babel), sin type-aware linting. Deferida a cuando se decida pagar ese costo.
