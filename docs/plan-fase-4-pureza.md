# Fase 4 del plan de pureza: las escrituras salen de `src/core/` (plan consolidado)

> Estado: **plan, sin implementar** (2026-10-06). Resume tres planes de diseño hechos por separado, cada uno verificado contra el código de `main` en el commit `72925cb0`: Kardex y venta (tramo A), autenticación, empresa y permisos (tramo B), y recetas, regla de cierre y cotizaciones (tramo C). Ningún paso toca `prisma/`: todo lo que necesite migración es la Fase 5 y requiere autorización expresa.
> Reglas de trabajo y estado general: `docs/plan-de-pureza-y-estado.md` y `docs/plan-fase-3-pureza.md`.

## 1. Qué es la Fase 4 y qué resultado se espera

Hoy 25 archivos de `src/core/` escriben la base o leen dentro de una transacción de escritura (lista «Fase 4» de `test/arquitectura/pureza-heredada-del-nucleo.ts`). La meta: `core` queda puro. La escritura pasa a un **caso de uso** (`src/server/actions/<dominio>/casos-de-uso/`, con su `@ficha`) y su **persistencia** (`src/server/persistencia/<dominio>/`); las lecturas de decisión dentro de la transacción pasan a `src/server/lecturas/`; el cálculo queda puro en `core`.

Además, 34 Server Actions escriben con `ctx.db.<modelo>.<create|update|…>` directo (107 llamadas): se migran a casos de uso, y una regla nueva (`escrituras-solo-en-persistencia`) impide que vuelva a pasar.

**Resultado:** la lista de heredados baja de 51 a unas 25 entradas (las que quedan son sesión de la Fase 6 y la consola); `core/movimientos`, `core/catalogo`, `core/reportes`, `core/plataforma` y `core/features` entran a la regla `core-sin-consultas`.

## 2. Correcciones a la auditoría que salieron del código

- El Kardex ya tiene guardián (`kardex-solo-agrega`); falta solo el candado de la base (Fase 5). `escrituras-auditadas` ya es por función.
- **La venta (`registrarVentaEnTx`) es la única escritura de `Operacion` y `MovimientoStock` que sigue en `core`**; las otras 5 ya están en persistencia. La auditoría no la nombraba en la Fase 4.
- `core/movimientos/precio-venta.ts` figura P1 pero lee la base de forma indirecta (`preciosLocalesVigentes`): sale en este tramo.
- `core/auth/base.ts` **no escribe datos** (solo `set_config` local a la transacción): está mal clasificado como «Fase 4»; es infraestructura y va a la Fase 6.
- La consola de plataforma usa de `features/empresa` solo `sembrarEmpresa` y `obtenerGerenteDeEmpresa` (no «todo», como decía H14).
- **H7 (recetas que se pisan) sigue abierto**, y tiene un segundo hueco: el arrastre de calibraciones lee la versión anterior fuera de la transacción y una calibración concurrente se pierde.
- El comentario de `ALCANCE_CARTA_PUBLICA` («solo por tipos y constantes») es falso: la carta pública alcanza `core/permisos/capacidades-sucursal.ts` en tiempo de ejecución (cadena `lecturas/carta` → `precioLocalActivoEn` → `sucursalTieneCapacidad`). Se corrige en el PR que toque esa lista.
- El reparo de la Fase 3 sobre `core/auth/invitacion.ts` («revalida al otorgante sin mirar si su cuenta está activa») **parece ya resuelto**: `aceptar-invitacion-de-usuario.ts` revisa sucursal, rol, `activoGlobal` y cuenta de empresa del otorgante. Se caracteriza y no se cambia.
- `gerentesQueQuedaranSinSucursalActiva` no es un N+1 real (acotado a 1 por el índice único parcial).

## 3. Orden de los PR (recomendado)

Reglas: cada PR se fusiona con el «Gate (requerido)» en verde; los PR de **solo tests de caracterización** se hacen primero, contra el código viejo, y nunca se editan después; la auditoría (B5) va **al final** porque toca los mismos imports que todo lo demás.

| # | PR | Contenido | Riesgo |
|---|---|---|---|
| 1 | **4C-A** regla `escrituras-solo-en-persistencia` | Test AST con lista de 56 archivos que solo se achica (dos direcciones, tope fijo); extiende `escrituras-auditadas` a la cadena caso de uso → persistencia; primer achique (`upsert-proveedor-por-producto` pasa a persistencia) | Bajo |
| 2 | **Car-V** caracterización de la venta (solo tests) | Matriz de ~30 escenarios con golden de filas (decimales como texto), traza de consultas, reintento, concurrencias que faltan, e2e de anular venta | Bajo |
| 3 | **B0** caracterización de auth/empresa/permisos (solo tests) | «Huella» byte a byte de aceptar invitaciones, vincular, gerencia, módulos, política, siembra, alta de admin, auditoría; adaptador de imports; valor de ficha `SIN_PERMISO`; `base.ts` reclasificada a Fase 6 | Bajo |
| 4 | **4A-1** la venta sale del núcleo | `registrarVentaEnTx` a `server/actions/movimientos/casos-de-uso/`, escrituras a `persistencia`, idempotencia, caché de producto, precio de venta y origen; después lo puro a `core` («misma traza» en los dos tiempos) | **Alto** (camino del dinero) |
| 5 | **4C-B** H7: versión esperada en recetas | Cambio de comportamiento deliberado (ver decisión D-1) + test concurrente + e2e | Medio |
| 6 | **B1** plataforma | Siembra, gerente y alta de admin: el escritor vive en `plataforma/src/servidor`; lo puro queda en `core` | Bajo |
| 7 | **B2** operaciones por script | Módulos y política a `src/server/operaciones-de-plataforma/` con regla de carpeta | Bajo |
| 8 | **4A-2, 4A-3, 4A-4** saldos del Kardex, costo congelado, embudos de recetas y disponibilidad | Mudanzas mecánicas de imports con golden idéntico | Bajo |
| 9 | **4C-C** dólar e IPC fuera de `core` | Red, lectura, escritura y orquestación a `server/`; `permiso=SISTEMA` en la ficha | Medio |
| 10 | **B3** invitaciones y login | Nace `src/server/sesion/` con `acceso`; 2 casos de uso de aceptar invitación | **Alto** (login y frontera multi-tenant) |
| 11 | **B4a, B4b** gobierno de usuarios | Lecturas de decisión a `server/lecturas/permisos`, gerencia, 5 casos de uso de invitaciones de usuario | Medio |
| 12 | **4A-5** precio local y capacidades | Toca `ALCANCE_CARTA_PUBLICA` (frontera de la carta pública): PR propio (decisión D-2) | Medio |
| 13 | **4C-D, E, F** migración de las acciones | POS (apertura, mesas, pedido) → dinero de carta → configuración de catálogo y stock | Medio |
| 14 | **B5** auditoría y cierre | `registrarCambioAuditado` a `server/auditoria/` con su regla; cierre de `core-sin-consultas`; documentos | Medio (26 archivos de imports; `vi.mock`) |

Tamaño total: ~100 commits en ~22 PR; ~170 llamadas de acciones migradas; 0 migraciones. Cada PR corre el gate completo de 8 comandos en CI; en local solo los breves.

## 4. Cómo se garantiza que no cambia el comportamiento ni se pierde plata

1. **Caracterización antes de mover** (PR 2 y 3): golden/huella que no se edita nunca; `git diff <commit de caracterización>..HEAD -- <carpeta>` tiene que salir vacío en todo el tramo.
2. **Mudar primero, separar después** («dos tiempos»): el código se mueve tal cual (`git diff -M` al 100 %) y recién en el commit siguiente se extrae lo puro. Cada commit se revierte solo.
3. **Traza de consultas:** el multiconjunto de lecturas y la secuencia de escrituras de la venta no cambian. Juntar en lote las lecturas repetidas por línea (una cuenta de 10 líneas pasaría de ~74 a ~25 lecturas) es un PR aparte (decisión D-5).
4. **Los tests existentes no cambian ninguna aserción:** solo cambian rutas de import (o el argumento de versión en recetas).
5. **Concurrencia:** se vuelven a correr las pruebas existentes (venta con la misma clave, arrastre de redondeo, cierre de cuenta, aceptación doble de invitación, traspaso de gerencia, invariantes) y se agregan las que faltan.
6. **Todo test o regla nueva se demuestra por mutación** (romper → rojo con archivo y línea → revertir → verde), escrito en la descripción del PR.
7. `server-only` no va en archivos que importan scripts con `tsx` o specs de Playwright; se verifica corriendo los scripts sin argumentos.

## 5. Decisiones del dueño

Las marcadas «⚠» cambian comportamiento o frontera de seguridad y no se toman por defecto; las demás se siguen como están recomendadas salvo que digas lo contrario.

- **⚠ D-1 (H7).** Al editar una receta con la pantalla vieja, hoy se aplica igual y puede borrar el cambio de otra persona; el arreglo la **rechaza** con «La receta cambió mientras la editabas, recargá la página y volvé a hacer tu cambio». Es un cambio visible para el usuario. Recomendado: rechazar con mensaje (alternativas: reaplicar solas las operaciones puntuales, o recargar la vista sola). Implica pasar la versión que se ve como argumento en 10 acciones y ~133 llamadas de tests.
- **⚠ D-2 (carta pública).** Mudar el precio local obliga a cambiar `ALCANCE_CARTA_PUBLICA` (ADR-006/007) y el lector de capacidades pasa a `server/acceso/`. Recomendado: PR propio al final, con tu autorización, como en el tramo A.
- **D-3.** `src/server/sesion/` nace ahora con `core/auth/acceso.ts` (su lugar final); la Fase 6 le suma `contexto`, `session`, `base`, etc. (Recomendado; alternativa: dejar login y auditoría en `core` hasta la Fase 6 y que salgan 10 entradas en vez de 13.)
- **D-4.** `core/auth/base.ts` se reclasifica a la Fase 6 y se mueve una sola vez (sin tocar el código, con todas las listas de seguridad en el mismo commit). Es lo más sensible de la fase.
- **D-5.** Juntar en lote las lecturas repetidas de la venta (tiempo 3): recomendado hacerlo aparte, después de la Fase 4 o junto con `SaldoStock` (Fase 5). Lo mismo para calcular el costo congelado solo de los productos vendidos.
- **D-6.** Escrituras compartidas con la consola en `plataforma/src/servidor/`; módulos y política en `src/server/operaciones-de-plataforma/`; escritor de auditoría en `src/server/auditoria/` (con regla `auditoria-capa`). Recomendado los tres.
- **D-7.** Nuevos valores de ficha: `permiso=SISTEMA` (crons) y `permiso=SIN_PERMISO` (aceptar invitación: aún no hay sesión). Recomendado sí.
- **D-8.** Un caso de uso por función de escritura, también los ~20 «activar/desactivar» (migrando de a un archivo por PR). Recomendado.
- **D-9.** Auditar `renombrarOFusionarInsumo` al migrarla (hoy escribe varias filas sin auditoría), en commit aparte. `agregarItems` del POS **no tiene idempotencia I3** (un doble clic duplica ítems): se documenta, no se arregla acá. Recomendado.
- **D-10.** La regla `escrituras-solo-en-persistencia` permite escribir **solo** en `server/persistencia` (hoy los casos de uso no escriben directo). Recomendado; la consola entra con 7 entradas «Consola».
- **D-11 (de la Fase 3, pendiente).** Versionar el codemod `mover-exports.ts` (sirve para la Fase 6, 161 `vi.mock` de la sesión). Recomendado sí.

## 6. Coordinación con la Fase 5 [MIG] (no se ejecuta acá)

Al terminar el PR 4, toda escritura del Kardex está en 6 archivos de persistencia: esa es la condición para que `SaldoStock` tenga **un único escritor**. Antes de la Fase 5 conviene reunir las 2 escrituras de traspasos y las 2 de anulación en una sola función (sin migración). Las lecturas de saldo de la venta quedan aisladas en `cargar-origen-de-venta.ts` y `lecturas/movimientos/saldos.ts` (ahí se cambiaría por `SaldoStock`). El índice `(seccionId, productoId)` se evalúa con `EXPLAIN` sobre `seccionesConStock` y la deuda de redondeo. El candado (REVOKE + trigger) rompe la limpieza de los tests. Todo eso: simulación primero, base por base (zuluhub y stockhneuquen), con `down.sql` y autorización expresa.

## 7. Gate obligatorio de cada PR

En la misma corrida y sobre el mismo commit, todos limpios, con la línea de base medida antes de tocar: `npx tsc --noEmit` (vacío), `npm run lint` (0), `npm run arquitectura` (leer «no dependency violations found»), `npm run analizar:muerto` (knip, 0), `npm test` (0 fallan, conteo ≥ base + nuevos), `npm run build`, `npm run plataforma:build`, `npm run test:e2e` (0 fallan, ≥ 509 en local). Además: `git diff --name-only origin/main...HEAD -- prisma/schema.prisma prisma/migrations` vacío; el inventario de arquitectura baja exactamente lo anunciado; las mutaciones del PR documentadas.

## 8. Detalle por tramo (resumen)

**Tramo A, Kardex y venta.** Orden obligatorio porque `core` no importa `server`: primero la venta con sus lectores privados (`idempotencia`, `producto-cache`, `origen-venta-datos`, `precio-venta`), luego `stock`, el costo congelado (`reportes/comun` y `costos`), los embudos `recetas-vigentes` y `disponibilidad`, y al final el precio local con el lector de capacidades. El orquestador queda como paso compartido `registrar-venta-en-tx.ts` (mismo nombre y firma, sin ficha), usado por la venta de mostrador y el cierre de cuenta del POS. Hace ≈12 + 8·L lecturas y L + 1 escrituras (mostrador) dentro de una transacción SERIALIZABLE; todo rechazo sale **antes** de la primera escritura. Escrituras en este orden fijo: `operacion.create` por línea, un `createMany` con CONSUMO, LIQUIDACION_CONSIGNACION y VENTA, y el `resultadoMensaje` de la idempotencia. Nota de escala (no se cambia acá): el costo congelado lee el catálogo entero en cada venta dentro de la transacción.

**Tramo B, auth, empresa, permisos y plataforma.** Salen 12 de las 13 entradas (`base.ts` queda para la Fase 6) más `core/auth/acceso.ts`. La consola no puede importar `src/server`: lo que es de la plataforma vive en `plataforma/`. Invitaciones: la base de la empresa de una invitación se obtiene solo con `invitacionConSuBase(token)` (nadie más importa `core/auth/base`). `vincularCuentaConInvitacion` queda en `server/sesion` como escritor de login (excepción anotada). Gobierno: lecturas de decisión a `server/lecturas/permisos` (nota en ADR-026), toda comparación de rol se queda en `core/permisos` como decisión pura (la regla `acceso-solo-por-el-guard` lo exige), `listarCandidatosAGerente` a `server/consultas/permisos`. Auditoría: lo puro (`filaDeAuditoria`) en `core`, el escritor en `server/auditoria/`; ojo con 2 `vi.mock` que dejarían de interceptar en silencio si no se cambia su ruta en el mismo commit.

**Tramo C, recetas, regla de cierre y cotizaciones.** Regla `escrituras-solo-en-persistencia` (56 archivos de excepción, solo se achica; detector AST reusado de `analizar-fuente.ts`). H7: la versión esperada se chequea **dentro** de la transacción, la ficha pasa a `idempotencia=OPTIMISTA`, test concurrente determinista (siempre exactamente un ok y un rechazo) y e2e con dos pestañas. Cotización y IPC: lo puro queda en `core` (P0, con el reloj inyectado), la red en `server/adaptadores/cotizaciones/`, la lectura en consultas, la escritura en persistencia y la orquestación en casos de uso `sincronizar-dolar` y `sincronizar-ipc` invocados por los crons y el atajo del shell. Migración de acciones: POS apertura y mesas (6 casos de uso) → pedido (4; `agregarItems` al final, con test de conteo) → dinero de carta (11) → configuración de catálogo (19), stock (14) y restos (7). Quedan para después de este tramo: configuración de carta (19 funciones) y `auth`/`permisos` (12), junto con el tramo B.

## 9. Riesgos principales

Frontera multi-tenant (`base.ts`, `invitacionConSuBase`), login de Auth.js (`acceso`, `vincular`), mocks que dejan de interceptar sin aviso (auditoría), `server-only` en archivos que usan seed, scripts o Playwright, conflictos de imports entre PR (se mezcla `origin/main` antes de fusionar), exports muertos de knip, guardianes que fijan rutas (se actualizan en el mismo commit que mueve el archivo, con mutación), y el doble clic en el editor de recetas después de D-1.
