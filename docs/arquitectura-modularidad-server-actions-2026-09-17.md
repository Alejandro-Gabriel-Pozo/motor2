# Arquitectura — modularidad de `server/actions/`

**Estado: ejecutado (2026-09-17).** `src/server/actions/` pasó de 25
archivos planos a 7 subcarpetas por dominio + 2 archivos que se quedan en
la raíz por ser infraestructura cross-cutting (`con-permiso.ts`,
`tipos.ts`, importados por los 23 archivos de dominio):

- `auth/` — `usuarios.ts`, `sucursales.ts`, `sucursal-activa.ts`
- `permisos/` — `permisos.ts`, `roles.ts`, `capacidades-sucursal.ts`
- `catalogo/` — `categorias-producto.ts`, `insumos.ts`, `productos.ts`,
  `proveedor-por-producto.ts`, `proveedores.ts`, `recetas.ts`, `unidades.ts`
- `movimientos/` — `conteo-fisico.ts`, `movimientos.ts`, `precio-local.ts`,
  `secciones.ts`, `venta.ts`
- `stock/` — `reclasificacion.ts`, `stock-minimo.ts`
- `reportes/` — `consignacion.ts`, `promociones.ts`
- `traspasos/` — `traspasos.ts`

`auth/` vs. `permisos/` (el único punto donde `core/` no da un mapeo 1:1
obvio, porque `Rol`/`Usuario`/`Sucursal` conviven bajo el paraguas
informal "Core" del resto de esta documentación): `permisos/` agrupa lo
que es el MOTOR de permisos en sí (`Accion`/`PermisoRol`/`Rol`/
`CapacidadSucursal` — "qué puede hacer un rol, dónde"), `auth/` agrupa
identidad/sesión/organización (`Usuario`/`Sucursal`/membresía activa) —
mismo criterio que separa `core/auth/` de `core/permisos/`.

Ejecutado con un script de una sola vez (`git mv` por archivo +
reescritura de imports relativos dentro de `server/actions/` y de
`@/server/actions/X` / `../.../server/actions/X` en el resto del repo),
borrado después de usarlo — no queda como deuda ni como herramienta
reutilizable. Verificado después: `tsc --noEmit`, `eslint`, `vitest`
(353/353) y `next build`, todos limpios; ningún test cambió de
comportamiento, solo de import.

Nace de comparar motor2 contra
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

## Plan (ejecutado) — mismo método ya probado en `app`

Por cada módulo de `core/` (`catalogo`, `movimientos`, `permisos`,
`reportes`, `stock`, `traspasos`, `auth`):

1. `git mv` de las Server Actions correspondientes a una subcarpeta
   propia (ej. `server/actions/stock/stock-minimo.ts`,
   `server/actions/stock/reclasificacion.ts`).
2. Corregir imports (los que consumen la Server Action movida —
   páginas de `src/app/(app)/*` y cualquier action de otro módulo que la
   importe directo).
3. Verificar `tsc --noEmit`, `npm run lint`, `npm test` — mismo resultado
   que antes de mover, ningún test debería cambiar de comportamiento por
   esto.

En la práctica (2026-09-17) se ejecutó con un script (los 7 módulos de
una sola pasada, no dominio-por-dominio a mano) precisamente porque el
riesgo real resultó ser bajo y mecánico como se anticipaba acá — mover +
arreglar ~74 sitios de import en todo el repo, sin tocar lógica de
negocio en ningún archivo movido. La verificación sí se mantuvo como
gate único antes de dar por cerrado el cambio.

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

## Estado al 2026-09-27

Las cifras de arriba ("24 archivos", "7 subcarpetas", "353/353") son las
del reordenamiento del 17/09 y quedan como historial. Contado de nuevo
sobre el repo real el 2026-09-27 (`find src/server/actions -name '*.ts'`
y `grep '^"use server"'` por archivo), en la rama de la Task #41, Fase A:

**`src/server/actions/`: 44 archivos `.ts`** — 38 llevan `"use server"`
(son Server Actions, endpoints invocables) y 6 NO lo llevan, porque son
ayudantes internos (en un archivo `"use server"` todo lo exportado queda
expuesto como endpoint, así que las piezas sin guarda propia viven
aparte a propósito):

- `con-permiso.ts` — envoltorio obligatorio de las mutaciones (`conPermiso`).
- `con-sesion.ts` — guarda de las lecturas (`requerirSesion`/`requerirVer`/…).
- `tipos.ts` — tipos de resultado (`ResultadoAccion`, `ResultadoConId`, …).
- `refrescar.ts` — `refresh()` de la ruta tras una mutación exitosa.
- `carta/generos-compartido.ts` — validación de género compartida entre
  dos acciones de la carta.
- `catalogo/upsert-proveedor-por-producto.ts` — escritura sin gate propio
  (la gatea quien la llama).

Subcarpetas (10, antes 7 — se sumaron `carta/`, `clientes/` y `pos/`) y
cantidad de archivos `.ts` en cada una; los 4 restantes están en la raíz
(`con-permiso.ts`, `con-sesion.ts`, `refrescar.ts`, `tipos.ts`):

| Subcarpeta | Archivos | Contenido |
|---|---|---|
| `auth/` | 3 | `sucursal-activa`, `sucursales`, `usuarios` |
| `carta/` | 8 | `contenido-producto`, `generos`, `generos-compartido`, `items-agrupados`, `promos`, `registro-publico`, `secciones`, `tema` |
| `catalogo/` | 9 | `categorias-producto`, `insumos`, `productos`, `proveedor-por-producto`, `proveedores`, `recetas`, `rendimiento-local`, `unidades`, `upsert-proveedor-por-producto` |
| `clientes/` | 1 | `cliente` |
| `movimientos/` | 7 | `compras`, `conteo-fisico`, `motivos`, `movimientos`, `precio-local`, `secciones`, `venta` |
| `permisos/` | 3 | `capacidades-sucursal`, `permisos`, `roles` |
| `pos/` | 2 | `cuenta`, `mesas` |
| `reportes/` | 2 | `consignacion`, `promociones` |
| `stock/` | 4 | `frecuencia-conteo`, `reclasificacion`, `seccion-habitual`, `stock-minimo` |
| `traspasos/` | 1 | `traspasos` |

**`src/core/`: 13 dominios** (subcarpetas, con su cantidad de archivos):
`auth/` (6), `carta/` (15), `catalogo/` (12), `compras/` (2), `datos/` (7),
`estadistica/` (2), `features/` (5), `movimientos/` (15), `navegacion/` (3),
`permisos/` (6), `pos/` (15), `reportes/` (36), `stock/` (7). Más 4 archivos
sueltos en la raíz de `core/`, transversales a todos los dominios:
`excel.ts`, `moneda.ts`, `numero.ts`, `texto.ts`.

**`src/components/`: 3 subcarpetas** — `carta/` (5), `catalogo/` (5) y
`mesas/` (1) — más 19 componentes sueltos en la raíz (sigue siendo
mayormente plano).

### Herramientas descartadas

Evaluadas para la Task #41 y NO adoptadas; queda registrado el motivo
para no reabrir la discusión sin un hecho nuevo:

| Herramienta | Motivo del descarte |
|---|---|
| `eslint-plugin-boundaries` | Redundante con `dependency-cruiser` (se agrega en A3): dos fuentes de reglas de fronteras es justo el problema que se quiere evitar. |
| `Zod` | Las validaciones propias de `core/datos/` ya funcionan, tienen tests y guard propio. Hoy es dependencia transitiva, no directa (y `dependency-cruiser` impide importarla sin declararla). |
| `next-safe-action` | Ya existe `conPermiso`/`requerirSesion`/`requerirVer`; agregarlo crearía un segundo sistema paralelo de guardas. |
| `tRPC` | No hay consumidor externo real hoy. |
| `TanStack Query` | No hay un problema de cache de cliente demostrado; se usa `router.refresh()`. |
| `Redux` / `Zustand` | El estado de negocio vive en el servidor. |
| Otra librería decimal (`decimal.js`, etc.) | Ya existe `core/moneda.ts` sobre `Prisma.Decimal`. |

La maquinaria de control de fronteras entre módulos pasa a ser `dependency-cruiser` (ver A3).
