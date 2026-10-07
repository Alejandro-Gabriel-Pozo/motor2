# Fase 4 del plan de pureza: las escrituras salen de `src/core/` (plan consolidado)

> Estado: **en ejecución** (actualizado el 2026-10-07; ver la sección 10, que dice qué está hecho, qué falló y qué falta). Plan escrito el 2026-10-06. Resume tres planes de diseño hechos por separado, cada uno verificado contra el código de `main` en el commit `72925cb0`: Kardex y venta (tramo A), autenticación, empresa y permisos (tramo B), y recetas, regla de cierre y cotizaciones (tramo C). Ningún paso toca `prisma/`: todo lo que necesite migración es la Fase 5 y requiere autorización expresa.
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
- **D-10.** La regla `escrituras-solo-en-persistencia` permite escribir **solo** en `server/persistencia` (hoy los casos de uso no escriben directo). Recomendado; la consola entra con 8 entradas (6 iniciales + `sembrar-empresa` + `alta-de-admin`) «Consola».
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

## 10. Estado de ejecución y desvíos (2026-10-07)

> Se agrega después de una auditoría independiente (un revisor con un modelo superior, solo lectura, que comparó cada PR fusionado contra este plan). Lo de abajo es lo que pasó de verdad, no lo que se esperaba. Va de lo general a lo específico.

### 10.1 Dónde estamos

La Fase 4 **está en curso**: el tramo A (Kardex y venta), el tramo C (regla de cierre, dólar e IPC, recetas) y el tramo B de plataforma están casi hechos; faltan el login y el gobierno de usuarios (B3, B4), la migración de las acciones (4C-D/E/F), el precio local (4A-5) y el cierre (B5).

| PR | Paso del plan | Estado |
|---|---|---|
| #79 | plan | fusionado |
| #80 | 4C-A regla `escrituras-solo-en-persistencia` | fusionado, conforme (la lista inicial fue de 55 archivos; el plan decía 56) |
| #81 | Car-V caracterización de la venta | fusionado, **parcial** (7 escenarios, el plan decía ~30) |
| #82 | B0 caracterización de auth | fusionado, **parcial** (falta el login por invitación y la alta de admin) |
| #83 | 4A-1 la venta sale del núcleo | fusionado, **parcial** (falta el segundo tiempo y `precio-venta`) |
| #84 | 4A-2 saldos y origen de la venta | fusionado, **parcial** (revirtió `base.ts` a la Fase 4 por un error de fusión; corregido en #88) |
| #85 | B2 operaciones de plataforma por script | fusionado, conforme |
| #86 | B1 siembra, gerente y alta de admin | fusionado, **parcial** (movió la alta de admin sin huella byte a byte previa; tenía tests de comportamiento, `test/persistencia/primer-admin-de-plataforma.test.ts`, que el PR tuvo que tocar) |
| #87 | 4C-C dólar e IPC | fusionado, conforme |
| #88 | 4A-3 costo congelado | fusionado, conforme |
| #89 | vínculo proveedor↔producto 1/2 (**fuera de este plan**: decisión del dueño, 2026-10-06) | fusionado |
| #90 | 4A-4 embudos de catálogo | fusionado, conforme |
| #91 | 4C-B H7 parte 1 | fusionado, **parcial** (versión reducida; ver 10.2) |
| #92 | vínculo proveedor↔producto 2/2 (fuera de este plan) | abierto; revisión independiente aplicada (consta en la descripción del PR, no como review de GitHub) |
| #93 | 4C-B H7 parte 2 | abierto; revisión independiente aplicada (consta en la descripción del PR, no como review de GitHub) |

### 10.2 Qué falló y por qué

- **H7 (#91) se entregó reducido y no se avisó.** El plan pedía tres cosas: que la pantalla mande la versión que mostraba (D-1), que el chequeo vaya dentro de la transacción, y cerrar el segundo hueco (la calibración local concurrente que se perdía). El #91 comparó contra la versión que la acción leía al ejecutarse; no cubría una pestaña con la receta vieja. La causa fue de proceso: se implementó desde un resumen de la conversación anterior sin releer este plan. El #93 lo completa: `versionVista` en 9 acciones de la central y 5 de la propia, lectura de la última versión dentro de la transacción, ficha `OPTIMISTA`, test concurrente y e2e con dos pestañas. Queda un límite conocido: `habilitada` de la receta propia no está versionada (alguien vuelve a la central mientras otra persona edita la propia con la pantalla vieja, y el plato no tiene receta central).
- **La caracterización quedó corta antes de mover código** (B0 y Car-V): sin huella de `vincularCuentaConInvitacion` (la frontera de login) ni de la alta de admin; el golden de la venta tiene 7 pasos, no ~30. La regla del plan es que lo que se mueve tiene su huella antes; en esos dos casos no se cumplió del todo.
- **La venta no tuvo su «segundo tiempo»** (separar lo puro y mandar `cargarDeudaDeRedondeo` a `server/lecturas`): #83 lo postergó, #84 hizo solo el reparto de stock y #90 dejó de listarlo. Quedó huérfano.
- **D-4 se violó durante cuatro PR** (#84 a #87): `core/auth/base.ts` volvió a «Fase 4» por resolución de conflictos; ningún test lo detecta porque las dos fases son válidas. Ya está corregido (#88).
- **Valores y herramientas del plan sin hacer:** `permiso=SIN_PERMISO` en la ficha (D-7), el codemod de imports versionado (D-11), el adaptador de imports de la huella.
- Otros menores: squash en todos los PR (un commit por PR en `main`, no uno por paso); `core/movimientos` no puede entrar a `core-sin-consultas` mientras `con-reintento` tenga parámetros tipados `Transaccion` (hay que decidir dónde vive antes de B5); el plan decía 7 entradas «Consola» y hay 8.

### 10.3 Reglas de proceso que se agregan a partir de acá

1. **Cada PR lleva en su descripción** una sección «Qué pedía el plan / qué entrega / qué queda», escrita releyendo este documento (no el resumen de la conversación). Un PR que entrega menos que lo pedido lo dice en esa sección.
2. **Revisión independiente** (un agente con un modelo igual o superior, solo lectura; su resultado queda escrito en la descripción del PR y, de ser posible, como comentario) antes de fusionar todo PR de riesgo medio o alto: dinero, login, permisos, concurrencia, migraciones. Se aplica sobre el PR abierto; sus hallazgos se tratan como datos a verificar. No hace falta en las mudanzas mecánicas de imports con golden idéntico.
3. **Las pruebas con base de datos se corren de a una** (todas comparten la misma base y la limpian al empezar); la preparación en paralelo de varias ramas locales es posible, pero cada una se verifica por separado.
4. **`base.ts` se revisa en cada PR hasta la Fase 6** (que su fase no retroceda).
5. Cada regla o test nuevo se demuestra con una mutación (rojo → revertido → verde), como hasta ahora.

### 10.4 Lo que falta, en el orden recomendado

| # | Qué | Por qué en ese lugar |
|---|---|---|
| 1 | **B0b**: huella de `vincularCuentaConInvitacion` (login), huella de la alta de admin con azar inyectado (byte a byte), valor de ficha `SIN_PERMISO` (D-7) | Es la red de seguridad de B3 y de lo que B1 ya movió |
| 2 | **B3** invitaciones y login: nace `server/sesion/` con `acceso`; 2 casos de uso de aceptar invitación | Riesgo alto; con la huella del paso 1. Saca `acceso.ts` de la lista de la Fase 6 (hoy 28 entradas) |
| 3 | **B4a/B4b** gobierno de usuarios (lecturas a `server/lecturas/permisos`, gerencia, 5 casos de uso) con los contratos RBAC, **más la migración de las acciones de auth y permisos** (5 archivos de la lista «Fase 4»: `auth/sucursales`, `auth/usuarios`, `permisos/capacidades-sucursal`, `permisos/permisos`, `permisos/roles`; 12 funciones), y **F1 del RBAC** (piso «administrador de sistema» y reclasificación de las claves de gobierno, sin migración) | **El ADR-027 todavía no está escrito**: lo pide `para motor 2\_planes\evaluacion-informe-rbac-vs-fase-4-2026-10-06.md` «en paralelo a B3» y hay que escribirlo en este paso. D15 y D16 del dueño pendientes (están definidas en `para motor 2\_planes\grounding-roles-y-autoridad-odoo-erpnext-dolibarr-2026-10-06.md`, no en `docs/`). F1 depende de D3 (vocabulario de pisos) y D16 |
| 4 | **4C-D/E/F** migración de **28 archivos de acciones** (~61 funciones; los otros 12 de la lista «Fase 4» son del tramo B y van en el paso 3): POS (apertura, mesas, pedido) → dinero de carta → configuración de catálogo y stock. La configuración de carta (19 funciones) queda para después, como dice el §8 | Mecánico pero grande; cada tramo con sus tests de caracterización existentes. D-9 (auditar `renombrarOFusionarInsumo` en un commit aparte) va con el tramo de catálogo |
| 5 | **Ampliar la matriz de la venta** (~30 escenarios: precio local, POS sin stock negativo, insumo sustituto, consignación, cierre real del POS) y el **segundo tiempo de la venta** | Antes de 4A-5, que toca el precio local |
| 6 | **4A-5** precio local y capacidades (`ALCANCE_CARTA_PUBLICA`): PR propio | **Requiere autorización del dueño (D-2)**; corregir el comentario falso de `.dependency-cruiser.cjs` |
| 7 | **Decidir el destino de `con-reintento`** | Junto con `precio-venta` (que sale en el paso 6), bloquea la entrada de `core/movimientos` a `core-sin-consultas`: queda por decidir solo `con-reintento`. Tampoco están hoy en esa lista `core/catalogo`, `core/auth`, `core/features` ni `core/permisos`: entran al cerrar B5 |
| 8 | **B5** auditoría a `server/auditoria/`, cierre de `core-sin-consultas`, actualización de los documentos de estado | Siempre al final: hoy 35 archivos de `src/` importan `registrarCambioAuditado` (el plan original decía ~26) |

Aparte, sin orden fijo: el límite `habilitada` de H7; fusionar en una consulta la derivación del carrito (hoy 3 lecturas por cambio de proveedor); versionar el codemod (D-11, hace falta para la Fase 6); decidir si se sigue con squash o se pasa a merge commit; D-9 (documentar que `agregarItems` no tiene I3); la preparación de la Fase 5 del §6 (reunir las 2 escrituras de traspasos y las 2 de anulación; `EXPLAIN` del índice).

### 10.5 Qué decide el dueño

- **4A-5** (cuando llegue su turno): autorización para tocar la frontera de la carta pública (D-2).
- **D15** (qué acciones de empresa alcanza el rango 2 de RBAC; recomendado: ninguna por defecto) y **D16** (piso de `ver_auditoria`; recomendado: administrador de sistema), antes de B4.
- **Squash o merge commit** (menor): hoy cada PR queda como un solo commit en `main`.
- Si se hace el arreglo de `habilitada` de H7 antes de cerrar la fase o se deja anotado.

## 11. Auditoría de las Fases 0 a 3 (2026-10-07)

> Cuatro auditores independientes (uno por fase, cada uno con su propio contexto, solo lectura, con un modelo superior) compararon cada PR fusionado de las Fases 0, 1, 2 y 3 contra su plan, y verificaron el estado final contra el código de `main`. Después de recibir los informes se comprobaron a mano contra el código los hallazgos de abajo marcados **(verificado)**; el resto son afirmaciones de los auditores que se tratan como datos hasta que se verifiquen al corregirlos. **Ninguna fase puede darse por «hecha sin reservas».** Lo hecho sí está: la ubicación del código, las fachadas, los guardianes principales. Lo que falta son agujeros de los guardianes, redes de pruebas prometidas y algunas decisiones sin asentar.

### 11.1 Resultado por fase

| Fase | PR | Conformes | Conclusión |
|---|---|---|---|
| **0** Guardianes | #59 a #66 (8) | 6 de 8; **parciales #66 (ficha) y #63 (auditoría de dinero)** | Los guardianes existen y funcionan, pero la auditoría de dinero no ve el SQL crudo y faltan el campo `periodo` de la ficha y la clasificación declarada de tablas |
| **1** Dinero, reloj, entorno, azar, errores | #67, #70 (1.2 a 1.6), #71 | #71 y 1.6 sí; **parciales #67 y 1.2 a 1.5** | Hay azar y red reales dentro de `core` que el analizador no ve, dos casos de uso reconocen un error de la base por clase, y faltan 10 de los 13 tests de hora fija. No existe un plan detallado de la Fase 1: los sub-pasos solo están en los mensajes de los PR |
| **2** Fachadas y fronteras | #72 (único) | Conforme en lo sustantivo | La regla de internals no cubre `proxy.ts`, `env.ts`, `server/acceso`, `server/carta-publica` ni la consola, y no hay guardián de «el cliente no importa `public-servidor`» |
| **3** Lecturas fuera del núcleo | #73 a #78 (6) | 2 de 6 (#73, #75); **parciales #74, #76, #77, #78** | La ubicación se cumplió (0 heredados «Fase 3»); quedaron sin hacer y sin declarar H8, las caracterizaciones de reportes y del tramo A, el conteo de N+1 de grupos y las propiedades del guard |

### 11.2 Hallazgos, de lo más serio a lo menor

**A. Comportamiento o seguridad (decisión o corrección con riesgo)**

1. **H8 sin hacer ni rastrear (Fase 3, decisión del dueño)** **(verificado)**: las lecturas que exigen solo sesión (`requerirSesion`, `requerirSesionEnSucursal`) siguen siendo 18 llamadas en 9 archivos de `src/server/actions` (catálogo, movimientos, stock, auth). El plan de la Fase 3 (§3, línea «H8») pedía un PR propio que las pase a exigir módulo y permiso, con un mapa lectura → módulo/acción aprobado por el dueño. No figuraba en ningún documento de estado.
2. **Dos casos de uso pierden la rama de idempotencia I3 ante un choque de unicidad (Fase 1, 1.6)** **(verificado)**: `registrar-conteo-fisico.ts:186` y `registrar-pago-consignante.ts:96` reconocen el choque con `instanceof Prisma.PrismaClientKnownRequestError`; con el adaptador `pg` el mismo choque puede llegar como `DriverAdapterError`, que esa condición no ve. Es un error real de comportamiento. Lo mismo, de forma más inocua, en `carta/registro-publico.ts:32`. Corrección: usar `esChoqueDeIndiceUnico` de `core/movimientos/con-reintento` (más una regla que prohíba importar `Prisma` como valor en los casos de uso).
3. **Escritura de precios por SQL crudo sin auditoría ni excepción (Fase 0, 0.7)** **(verificado)**: `server/persistencia/catalogo/upsert-proveedor-por-producto.ts` hace un `$executeRaw` sobre columnas `Decimal` y su único llamador declara `auditoria=DOCUMENTO_PROPIO`. La regla `escrituras-auditadas` solo ve `tx.<modelo>.<operación>`. Hay que decidir si esa escritura (un caché derivado de la compra) se audita o se declara como excepción con motivo, y enseñarle a la regla a ver `$executeRaw`.
4. **Dinero en `number` dentro de `core` (Fase 1, 1.1)**: la decisión «dinero con `decimal.js`» se cumplió como «`decimal.js` detrás de `core/moneda`» (el propio `core/moneda.ts` lo dice); las sumas en `core/reportes` siguen en `number`. No hay un documento que fije que eso es por diseño. Decisión del dueño: escribirlo o abrir un paso.

**B. Agujeros de los guardianes (el guardián dice vigilar algo que no ve)**

5. **El analizador solo detecta llamadas, no referencias** **(verificado)**: `Math.random` como valor por defecto en `core/movimientos/reintentar.ts:62` (y, a través de `conTransaccionSerializable`, azar no inyectado en toda transacción serializable) y `fetch` como valor por defecto en `core/correo/resend.ts:37` figuran como P0 sin serlo; el cliente HTTP de Resend vive en `core`.
6. **La regla `sin-internals-de-otro-dominio` no cubre** `src/proxy.ts` (importa `@/core/carta/host` y `carta-empresa-unica`), `src/env.ts` (ruta relativa a `core/carta/host`), `src/server/acceso`, `src/server/carta-publica`, `src/server/adaptadores` ni la consola; la consola importa `core/movimientos/con-reintento` (`plataforma/src/servidor/ciclo-de-vida.ts:6`) **(verificado)**.
7. **«Un componente de cliente nunca importa `public-servidor.ts`» no tiene guardián** (hoy 0 casos; `catalogo/public-servidor.ts` no lleva `server-only` a propósito).
8. **Fichas (Fase 0, 0.6)** **(verificado)**: falta el campo `periodo=VERIFICA_CIERRE` que el plan marcaba como la forma mecánica de que el cierre de períodos alcance todas las escrituras de la Etapa A (0 ocurrencias en `ficha-de-caso-de-uso.test.ts`); el descubrimiento de casos de uso es solo por carpeta, así que los flujos de la consola y de `operaciones-de-plataforma` no tienen ficha ni la exigen.
9. **Otras brechas menores de guardianes:** `consultas-solo-lectura-y-ui-sin-base` no cubre `server/acceso/`; ningún guardián ve el reloj leído desde `server/persistencia` (p. ej. `fechaCompra ?? new Date()` en el upsert del vínculo, hoy un fallback muerto); la regla `paginas-solo-consultas` prometida **(verificado: no existe)**; el comentario falso de `ALCANCE_CARTA_PUBLICA` (ya anotado en 4A-5).

**C. Redes de pruebas prometidas y no escritas**

10. **Tests de hora fija:** el plan de la Fase 1 pedía uno por cada uno de los 13 casos de uso; hay 3 (`anular-compra`, `anular-venta`, `emitir-ticket-corregido`). Faltan los de `cancelar-conteo-fisico`, `resolver-conteo-pendiente`, `cerrar-cuenta` y los 7 de traspasos.
11. **Caracterización de los reportes antes de moverlos (Fase 3, C0)** y del tramo A («.0»): no se escribió; solo hay conteo de consultas para 4 reportes y nada para ~25.
12. **Test de conteo del N+1 de grupos de insumos** que la descripción de #74 afirmaba: no existe.
13. **Propiedades con fast-check del guard de acceso** (Fase 3): no existen (`fast-check` se usa solo en moneda, filas de movimiento y arrastre).
14. **Clasificación declarada de tablas** (Fase 0, mínimo imprescindible ítem 8): siguen los contadores fijos (`rls-empresa.test.ts`, `multiempresa-estructura.test.ts`).

**D. Fronteras y decisiones sin asentar**

15. **La UI importa `server/lecturas`** **(verificado)**: 5 páginas (`insumos-grupos`, `productos/[id]`, `recetas/[productoId]`, `reportes/costos`, `mesas/[mesaId]`) contra D-1 de la Fase 3 y el ADR-026; `lecturas-capa` solo restringe a quién importa la capa, no quién la importa. Decisión: formalizar en el ADR-026 que las páginas (Server Components) pueden importar la capa, con una regla que lo limite, o mover esas lecturas a `server/consultas`.
16. **Reloj dentro de consultas y acciones** **(verificado)**: `perdidas.ts:37` y `devoluciones.ts:23` (y otros 3 reportes) leen `new Date()`; el plan de la Fase 3 (C1) pedía `ahora` obligatorio en todos y solo se hizo en tickets. `server/actions/auth/usuarios.ts` lee `new Date()` tres veces dentro de `conPermiso` (líneas 107, 381, 412) en vez de `ctx.ahora`. Falta además el `ORDER BY` explícito en `rendimiento-recetas.ts` **(verificado: 0 `orderBy`)**.
17. **D-4 y D-5 de la Fase 3 se aplicaron sin decisión registrada** (auth → Fase 6, movimientos → Fase 4); no consta la respuesta del dueño.
18. **Documentos de estado:** `plan-de-pureza-y-estado.md` §4 y §8 describían un estado anterior a la Fase 1 (corregidos en este PR); `docs/arquitectura-casos-de-uso-2026-09-27.md` habla de `DOMINIOS_CON_PUBLIC` (constante invertida el 2026-09-28); la copia externa del plan de la Fase 3 no tiene el encabezado «HECHA».
19. **Detalles de la Fase 1:** `core/auth/{acceso,invitacion}.ts` leen el reloj y `acceso`/`base`/`contexto` leen `process.env` (declarados como heredados de las Fases 4 y 6); `core/correo/enviar.ts` importa `@/lib/reportar-error` desde `core`; el #67 rompió el despliegue de la consola (decimal.js no declarado en `plataforma/package.json`, corregido en #71 con test).

### 11.3 Orden de corrección propuesto

Respeta dos reglas: lo que protege lo que viene va antes, y lo que cambia comportamiento no se mezcla con lo estructural. Convive con el orden de la 10.4 (la tanda 1 va junto con B0b y antes de B3 y de 4C-D/E/F).

| Tanda | Qué | Riesgo | Depende de |
|---|---|---|---|
| **0. Documentos** | Estado al día (hecho en este PR para `plan-de-pureza-y-estado.md`); registrar D-4/D-5 y la decisión sobre el dinero en `number`; actualizar la copia externa del plan de la Fase 3; corregir `arquitectura-casos-de-uso` | Ninguno | Tu confirmación de D-4/D-5 y del dinero |
| **1. Guardianes** | (a) el analizador detecta referencias, no solo llamadas, con mutación; (b) `reintentar.ts` y `conTransaccionSerializable` reciben el azar del borde; (c) `resend.ts` sale de `core` a un adaptador; (d) `esChoqueDeIndiceUnico` en los 3 sitios + regla «los casos de uso no importan `Prisma` como valor»; (e) la regla de internals se amplía a `proxy`, `env`, `server/*` y la consola (exponer en `carta/public.ts` lo que usa el proxy); (f) guardián «cliente no importa `public-servidor`»; (g) la auditoría de dinero ve `$executeRaw` (y se decide el vínculo); (h) ficha: `periodo` y fichas de la consola; (i) `consultas-solo-lectura` cubre `server/acceso/` | Bajo (solo estructura y reglas; (d) corrige un camino de idempotencia) | Nada; (a) antes de (b) y (c) |
| **2. Redes de pruebas** | Los 10 tests de hora fija; caracterización de los reportes (C0) con conteo; conteo del N+1 de grupos; propiedades del guard; clasificación declarada de tablas; matriz de la venta (ya en la 10.4) | Bajo | La tanda 1 para (f)(g) del guardián de la ficha |
| **3. Con decisión del dueño** | H8 (mapa lectura → módulo/acción, coordinado con B4 y con el RBAC); frontera UI → `server/lecturas`; `ahora` obligatorio en los 5 reportes y `ctx.ahora` en `usuarios.ts`; `ORDER BY` de `rendimiento-recetas` | Medio (H8 cambia seguridad) | Tu decisión; H8 antes de B4 |

### 11.4 Qué decide el dueño (se suma a la 10.5)

- **H8:** aprobar el mapa de las 18 lecturas (módulo y acción de cada una) antes de hacerlo.
- **UI → `server/lecturas`:** permitirlo o mover esas lecturas.
- **Dinero en `number` dentro de `core`:** dejarlo escrito como diseño, o abrir un paso.
- **SQL crudo del vínculo proveedor↔producto:** auditarlo o declararlo como excepción con motivo.
- **Campo `periodo` de la ficha:** agregarlo ahora o diferirlo por escrito a la Etapa A.
- **D-4 y D-5 de la Fase 3:** confirmar lo que ya se aplicó.
