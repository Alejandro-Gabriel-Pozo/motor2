# Arquitectura — modularidad de `server/actions/` (pendiente, no ejecutado)

**Estado: documentado, sin ejecutar.** Nace de comparar motor2 contra
`app` (repo separado, `reservations-api` — backend de reservas
multi-tenant del mismo dueño) durante una sesión de investigación
(17/09/2026), no de un bug ni de un bloqueante funcional.

## Qué es esto hoy, dicho explícitamente

Motor2 es un solo monolito (un proceso Next.js, un deploy, una base) —
eso no cambia con esto. Por capa, la organización interna es un
híbrido:

- **`src/core/`** (lógica de dominio) — **ya está por módulo**: una
  carpeta por dominio (`auth/`, `catalogo/`, `movimientos/`, `permisos/`,
  `reportes/`, `stock/`, `navegacion/`, `estadistica/`).
- **`src/server/actions/`** (Server Actions, la capa de escritura) —
  **plana**: 24 archivos, uno por feature (`venta.ts`, `traspasos.ts`,
  `usuarios.ts`, `stock-minimo.ts`, `reclasificacion.ts`, etc.), todos en
  el mismo directorio sin importar a qué módulo de `core/` pertenecen.
- **`src/app/(app)/`** (rutas) — agrupado por módulo casi gratis, porque
  el App Router de Next.js obliga a carpeta-por-ruta
  (`administracion/`, `catalogo/`, `movimientos/`, `reportes/`,
  `stock/`, `traspasos/`).
- **`src/components/`** — mayormente plano (una sola excepción,
  `catalogo/`).

## Por qué importa — grounding contra `app`

`app` tenía exactamente este mismo patrón (`services/`/`repositories/`/
`routes/` todos mezclados por capa técnica, no por dominio) hasta una
auditoría con `dependency-cruiser` (15/08/2026) que lo hizo explícito y
lo corrigió: 5 de 6 dominios se movieron a su propia carpeta
(`git mv` + arreglo de imports + `tsc`/tests/`dependency-cruiser` verde
después de cada paso). El sexto dominio (Inventario) quedó a medio
camino — se le dio su propio agregado de datos (tablas, atomicidad,
idempotencia) pero nunca se le dio su propia carpeta de código; sus
servicios quedaron mezclados dentro de `pos-menu/` y sus repositorios en
la carpeta plana compartida. Ese caso a medio resolver es la evidencia
concreta de que dejarlo para más adelante sale más caro: en `app`
significó ~150 archivos con imports para corregir cuando finalmente se
encaró, contra los 24 archivos que tiene hoy `server/actions/` acá.

**Motivo por el que el dueño lo marca como importante ("el orden es
fundamental"):** si algún módulo de motor2 (el candidato obvio es
`stock/`, dado que es la porción más nueva y mejor delimitada) necesitara
en algún momento desprenderse como producto/servicio aparte, `core/`
ya está limpio para eso — pero las Server Actions que lo exponen hoy
están entreveradas con las de todos los demás módulos en un solo
directorio. Esto no es una necesidad hoy (motor2 es de un solo negocio,
sin planes de separar servicios) — es dejar la puerta abierta barata,
mientras es barata.

## Plan (cuando se ejecute) — mismo método ya probado en `app`

Por cada módulo de `core/` (`catalogo`, `movimientos`, `permisos`,
`reportes`, `stock`, `traspasos`, `auth`):

1. `git mv` de las Server Actions correspondientes a una subcarpeta
   propia (ej. `server/actions/stock/stock-minimo.ts`,
   `server/actions/stock/reclasificacion.ts`).
2. Corregir imports (los que consumen la Server Action movida —
   páginas de `src/app/(app)/*` y cualquier action de otro módulo que la
   importe directo).
3. Verificar después de CADA módulo (no al final, no todo en un commit
   gigante): `tsc --noEmit`, `npm run lint`, `npm test` (141/141 esperado,
   mismo resultado que antes de mover — ningún test debería cambiar de
   comportamiento por esto).
4. Repetir para el siguiente módulo recién cuando el anterior quede
   verde.

**No estimado en horas** — son 24 archivos, bajo riesgo (mover +
arreglar imports, sin tocar lógica), pero se hace dominio por dominio
para poder aislar cualquier import roto al módulo que se acaba de mover.

## Explícitamente fuera de este documento

- No decide si algún módulo de motor2 se separa como servicio/producto
  aparte — esto es orden de código, no una decisión de arquitectura de
  despliegue.
- No toca `src/core/` (ya está organizado por módulo) ni `src/app/(app)/`
  (ya lo fuerza el framework).
- No es governance/tooling tipo `dependency-cruiser`/`knip` — motor2 no
  tiene esa maquinaria today; si este reordenamiento se retoma, evaluar
  aparte si vale la pena sumarla (`app` la usa para verificar cada paso
  del movimiento sin depender de revisión manual).
