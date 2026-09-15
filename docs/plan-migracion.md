# Plan de migración — motor → motor2

Este documento es el estado de la migración de `motor` (Google Apps Script +
Sheets, repo separado: https://github.com/Alejandro-Gabriel-Pozo/motor) a
`motor2` (Next.js + Prisma + Postgres/Neon, este repo). Se escribe para que
una sesión nueva (incluida una sesión cloud de Claude Code) pueda retomar el
trabajo sin el historial de chat completo.

## Contexto de negocio

Un solo negocio con varias sucursales — **NO es multi-tenant SaaS**. Esto
descartó copiar el modelo de aislamiento por tenant y en cambio se validó el
diseño de permisos contra dos ERPs de referencia (clonados en
`Desktop/erps/` en la máquina original — `erpnext-develop`, `dolibarr-develop`):

- **Dolibarr**: no tiene ningún gate de permiso por sucursal/almacén dentro
  de una misma empresa — solo permiso de módulo global + aislamiento
  multi-EMPRESA vía `entity` (Multicompany), que es un problema distinto.
- **ERPNext/Frappe**: sí resuelve esto, separando SIEMPRE "permiso por rol y
  acción" (matriz ancha, única) de "alcance por sucursal" (tabla aparte —
  "User Permission"/"Company Restriction"). Este es el patrón que se adoptó.

Arquitectura vieja (Apps Script): 1 Library ("Motor") + N contenedores
(Central + sucursales), cada contenedor un proyecto Apps Script separado
atado a su propio Google Sheet. Ese mecanismo desaparece por completo en
motor2: una sucursal es una fila `Sucursal` en Postgres.

## Estado actual (commiteado en este repo)

### Porción Core — COMPLETA (código y tests verificados verdes contra Postgres real)

- Modelos: `Sucursal`, `Usuario`→`User` (Auth.js), `Rol`, `PermisoRol`,
  `UsuarioSucursal`, `Accion`, `CapacidadSucursal`.
- Roles y permisos: **catálogo único compartido por todo el negocio** (no
  por sucursal) — decisión confirmada tras la investigación de ERPNext.
- Auth.js v5 + Google OAuth (`allowDangerousEmailAccountLinking: true`: es
  un negocio interno, un admin da de alta el email antes de que la persona
  haga login por primera vez).
- Bootstrap del primer admin: `BOOTSTRAP_ADMIN_EMAILS` (env var) + "no existe
  ningún admin todavía en TODO el sistema" (chequeo global, no por
  sucursal) — ver `src/core/auth/bootstrap.ts`.
- Gate único de permisos (`src/core/permisos/gate.ts`): `requierePermiso`/
  `requierePermisoVer`/`obtenerMiNivelPermiso`, con la invariante "Ver ⊇
  Editar" forzada al ESCRIBIR el permiso (no en cada lectura, a diferencia
  de Apps Script).
- UI en `/administracion/*` (usuarios, roles, permisos, capacidades por
  sucursal, sucursales).
- Alta de sucursal (`alta_sucursal`, acción nueva que no existía en Apps
  Script) crea la sucursal Y su primer admin en una transacción.

### Porción Catálogo — COMPLETA (código y tests verificados verdes contra Postgres real)

Investigación exhaustiva de `Catalogo.js` (repo `motor`) antes de diseñar:
ver el detalle completo (schema Prisma, decisiones, server actions, tests)
más abajo, sección "Plan original de la porción Catálogo".

Resumen de las decisiones más importantes:
- `Producto` es **una sola tabla** (colapsa "Hoja listado" + "Productos",
  que en Sheets eran fuente-de-verdad + caché derivada).
- "Familia" se llama **`Insumo`** en el schema nuevo (mismo dato, nombre de
  cara al usuario desde Apps Script v2.3.0).
- `CategoriaProducto` (rubro comercial) y `Unidad.magnitud` (Peso/Volumen/
  Cantidad) son conceptos separados aunque compartían el nombre de columna
  "Categoria" en Sheets.
- `ProveedorPorProducto`: la carrera cross-hostería documentada en el propio
  Apps Script (`Catalogo.js:3278-3294`) se elimina con un `UNIQUE` real +
  `INSERT ... ON CONFLICT DO UPDATE` atómico, en vez de detectar-y-corregir
  después de escribir.
- Recetas: versionado append-only real (`RecetaVersion.version: Int`),
  vigente = `MAX(version)` siempre derivado.
- UI: patrón "listado + alta rápida inline" (estilo ERPNext) — el form de
  Producto tiene "+ Nuevo insumo"/"+ Nueva categoría"/"+ Nuevo proveedor"
  sin salir del flujo (mismo patrón que Apps Script ya resolvía bien).

### Porción Movimientos — COMPLETA, con UI, verificada en navegador real

Investigación completa de `Movimientos.js`/`Stock.js`/`Sucursales.js` (repo
`motor`) — ver la sección íntegra más abajo, "Plan de la porción
Movimientos", para las decisiones con ancla `archivo:línea`. A diferencia
de Core/Catálogo, esta porción se implementó Y SE VERIFICÓ de punta a
punta contra Postgres real — servidor corriendo, sesión real (Auth.js,
estrategia `database`), y un smoke test con Playwright que hizo clic
sobre el DOM real (no solo `tsc`/tests) para Compra, Merma, Venta, Conteo
Físico (con su historial), Secciones y Precio Local. No quedó solo
"escrita sin correr".

Resumen de lo más importante:

- Modelos: `Seccion`, `Operacion`, `MovimientoStock` (el Kardex),
  `ConteoFisico`, `PrecioLocalProducto` — y los enums `Proceso`,
  `MotivoMerma`, `DestinoConsumo`, `AccionConteo`, `EstadoConteo`.
- `MovimientoStock.cantidad` se graba **siempre ya con el signo aplicado**
  (nunca una segunda tabla de signos que leer aparte) — cierra de raíz la
  MISMA clase de bug que causó el bug de Merma sin signo en Apps Script
  v2.1.0 (dos fuentes de verdad para el signo que se desincronizaron).
  Verificado con un test que confirma exactamente esto.
- `Operacion` (encabezado, agrupa 1+ líneas escritas juntas) + `MovimientoStock`
  (línea del libro mayor) reemplaza el "ID Operación" de texto compartido a
  ciegas entre filas de Apps Script por una FK real.
- Todo lo de esta porción tiene `sucursalId` real (a diferencia de
  Core/Catálogo): en Apps Script "la sucursal" era implícita — cada una
  tenía su propio contenedor/spreadsheet con su propio Kardex/Secciones.
- Hueco real encontrado (no estaba en la porción Catálogo): `PrecioLocalProducto`
  — Venta necesita el override de precio por sucursal para calcular lo
  realmente cobrado, y esa hoja vivía LOCAL a cada hostería, no en el
  Catálogo Central. `precio_local` ya estaba seedeado en `acciones.ts`
  anticipando esto.
- Concurrencia: sin `LockService`/`conLock_` (no existe un lock de
  aplicación acá), se usa aislamiento **Serializable** + reintento
  (`src/core/movimientos/con-reintento.ts`) — verificado con un test real
  de 2 requests concurrentes que juntas sobre-venderían: solo una gana.
- A propósito el schema todavía NO incluye los 3 procesos de transferencia
  entre sucursales (`TRANSFERENCIA_SALIDA/ENTRADA_SUCURSAL`,
  `REINGRESO_TRANSFERENCIA_SUCURSAL` — porción Traspasos): agregar un valor
  a un enum de Postgres es aditivo y trivial — se agrega cuando esa
  porción se investigue de verdad, no antes. (`RECLASIFICACION` sí se
  agregó, en la porción Stock — ver más abajo.)

Server actions escritas: `registrarMovimiento` (motor genérico para los 9
procesos que lo comparten), `registrarVenta`, `registrarConteoFisico`/
`resolverConteoPendiente`/`cancelarConteoFisico`, CRUD de `Seccion` y de
`PrecioLocalProducto`. 68 tests de Vitest, todos verdes.

UI escrita bajo `/movimientos/*` (`src/app/movimientos/`): un panel
genérico parametrizado por proceso (`[proceso]/page.tsx` +
`panel-movimiento-form.tsx`, cubre los 9 procesos del motor genérico —
equivalente a `mostrarPanelOperacion_` parametrizado), páginas propias
para Venta y Conteo Físico (con su historial + resolver/cancelar inline),
y CRUD simple de Secciones y Precio Local (mismo patrón que
`/catalogo/categorias`). Ver "UI (implementada)" más abajo para el detalle
de cada página.

Bug encontrado escribiendo la UI (no de Movimientos en sí, de scoping):
`obtenerHistorialConteosFisicos` sin `seccionId` no filtraba por sucursal
— listaría conteos de CUALQUIER sucursal. `sucursalId` pasó a ser un
parámetro obligatorio; test agregado que verifica que dos sucursales
nunca se mezclan.

### Porción Stock — COMPLETA, con UI, verificada en navegador real

Investigación completa de las partes de `Stock.js` no cubiertas todavía en
la investigación de Movimientos (`calcularStockConsolidado_`,
`calcularStockPorFamilia_`, `calcularAlertasStock_`,
`dividirClasificacionStock_`) más `HOJA_STOCK_MINIMO` (Catalogo.js:1922-2019)
— ver "Plan de la porción Stock" más abajo para las decisiones con ancla
`archivo:línea`.

Hallazgo de diseño clave: en Apps Script las 4 vistas (`Stock`,
`StockConsolidado`, `StockFamilia`, `AlertasStock`) son hojas
MATERIALIZADAS porque rescanear Kardex en cada lectura era proporcional a
toda la historia acumulada de la hostería. Acá ese argumento no aplica —
ya se resolvió en la porción Movimientos (`MovimientoStock` + índice real,
`SUM` en tiempo real) — así que esta porción **no agrega ninguna tabla de
libro mayor nueva**, solo:

- Un modelo de configuración real: `StockMinimoProducto` (sucursalId +
  productoId + seccionId opcional = mínimo, mismo patrón que
  `PrecioLocalProducto` de Movimientos: fila "global" de la sucursal si
  `seccionId` es null, fila específica si hay una).
- `RECLASIFICACION` agregado al enum `Proceso` (migración aditiva, ver
  el comentario que ya lo anticipaba en el schema desde Movimientos).
- 3 funciones de consulta en vivo (`src/core/stock/`:
  `calcularStockConsolidado`, `calcularStockPorFamilia`,
  `calcularAlertasStock`) — ninguna escribe nada, agregan sobre
  `MovimientoStock`/`ConteoFisico`/`Producto`/`Insumo`/`Grupo` en cada
  request.
- 1 mutación nueva: `reclasificarStock` (primitiva de split genérico,
  gateada con `proceso_control` — mismo permiso que Conteo Físico, sin
  Accion propia, igual que en Apps Script).

Hueco real encontrado (gap de seguridad, no solo de dato): en Apps Script,
`calcularStockConsolidado_`/`calcularStockPorFamilia_`/`calcularAlertasStock_`
**no tenían ningún gate de permiso propio** — solo se ocultaban a nivel de
menú de Sheets, que no es una barrera real (la función seguía siendo
client-callable directo). Se agregó una Accion nueva, `ver_stock`
(abierta a admin+operador — visibilidad operativa del día a día, distinto
de FIJAR el mínimo, que sigue admin-only en `stock_minimo`), y las 3
páginas de solo lectura la exigen igual que cualquier otra página del
proyecto.

Server actions escritas: `reclasificarStock`, CRUD de `StockMinimoProducto`
(`setStockMinimoProducto`/`eliminarStockMinimo`/`listarStockMinimo`). 94
tests de Vitest en total (26 nuevos de esta porción), todos verdes.

UI escrita bajo `/stock/*`: `consolidado`, `por-familia` y `alertas` (solo
lectura, tablas server-rendered), `minimo` (CRUD, mismo patrón que
`/movimientos/precio-local`) y `reclasificar` (form con lista dinámica de
destinos, mismo patrón que los paneles de Movimientos). Verificado con un
smoke test de Playwright igual que Movimientos: Compra → Conteo Físico con
desvío → las 3 vistas de solo lectura lo reflejan → fijar un mínimo →
Alertas lo detecta → Reclasificar mueve el saldo entero a otra sección.

### Porción Reportes — COMPLETA, con UI, verificada en navegador real

Investigación completa de `Reportes.js` (repo `motor`, 2108 líneas — 8
módulos históricos consolidados: ReportePeriodo, ReporteVencimientos,
ReporteDiferenciasAjustes, ReporteVentasSinReceta, TrazabilidadPorID,
ExportacionCSVPDF, DashboardOperativo, PanelAlertasStock) más los reportes
agregados en auditorías posteriores directo en ese mismo archivo
(Consignación, Devoluciones, Salud por producto, Huecos de catálogo,
Ventas por categoría, Promociones) — ver "Plan de la porción Reportes" más
abajo para las 19 vistas con ancla `archivo:línea`.

Hallazgo de diseño clave (mismo espíritu que Stock): en Apps Script, buena
parte de la complejidad de estos reportes existía para compensar
limitaciones de Sheets como base de datos — texto libre donde hacía falta
un enum (`MotivoMerma`/`DestinoConsumo` ya son columnas tipadas de
`Operacion` desde la porción Movimientos, así que `generarReportePerdidas`
agrupa directo, sin la regex `/^[^:]+:\s*([^—]+)/` que el original
necesitaba para separar el motivo del texto libre del detalle), IDs de
texto comparados a mano donde hace falta una FK (`generarReporteVentasSinReceta`
compara `MovimientoStock.operacionId` real en vez de un string "ID
Operación" compartido a ciegas entre filas), y un mapa por NOMBRE de
producto donde hace falta uno por FK (ningún reporte de esta porción
necesitó reconstruir "a qué producto se refiere esta fila" parseando
texto — siempre hay un `productoId` real). El resultado es que esta
porción, pese a ser la de mayor superficie del proyecto (19 vistas), NO
agregó ninguna tabla de libro mayor nueva: todo es lectura en vivo sobre
`Operacion`/`MovimientoStock`/`ConteoFisico`/`RecetaVersion` ya existentes.

La única excepción real es **Promociones y Combos**: un catálogo LOCAL (por
sucursal, no Catálogo Central — la misma "Menú ejecutivo" puede ser
promoción en una sucursal y plato normal en otra) que el sistema no puede
derivar de ningún otro dato. Se agregó `PromocionProducto` (sucursalId +
productoId + activa) y `Sucursal.promocionesHabilitadas` (el apagador
general de la feature, default `false` — no todos los clientes arman
combos). La Accion `promociones_config` ya estaba seedeada desde la
porción Catálogo anticipando esto.

Otro hallazgo importante, esta vez de un bug real que introdujo esta misma
porción y se corrigió antes de commitear (no heredado de Apps Script): los
reportes de período (`obtenerReportePorPeriodo`, y todo lo que se apoya en
él — Ventas del período, Compras del período, Margen, Diferencias de
Ajuste, Pérdidas, Devoluciones) necesitan la CANTIDAD como magnitud
positiva para los procesos de signo fijo (Venta/Compra/Merma/Consumo/
Producción/Devolución×2) y como delta YA firmado para
Ajuste/Control/Transferencia — exactamente el mismo criterio que la
columna "Cantidad" de la Hoja 7 original. Como `MovimientoStock.cantidad`
en este proyecto se graba SIEMPRE con el signo aplicado (decisión de la
porción Movimientos, para no repetir el bug de Merma sin signo de Apps
Script v2.1.0), un primer intento de portar `calcularVentasDelPeriodo_`
tal cual traía el delta firmado directo — multiplicaba una venta de $100
por -1 y daba un total de ventas negativo. Se corrigió con
`esSignoFijo(proceso)` (ya existía en `transiciones.ts` desde Movimientos)
para decidir cuándo tomar `Math.abs(cantidad)` y cuándo dejar el delta tal
cual — 5 tests lo detectaron antes de llegar a la UI.

Server actions/funciones escritas bajo `src/core/reportes/` (todas de
lectura, agnósticas de permiso — el gate vive en la página, igual que el
resto del proyecto): `periodo.ts` (`obtenerReportePorPeriodo`,
`generarReporteVentasPorCategoria`, `resumenPeriodicoPorProceso`),
`costos.ts` (`calcularCostosYMargenes`, `calcularImpactoInsumos`),
`promociones.ts` (`obtenerReportePromociones`), `vencimientos.ts`
(lotes próximos a vencer + conciliación), `diferencias-ajustes.ts`,
`insumos-sin-receta.ts`, `huecos-catalogo.ts`, `salud-por-producto.ts`
(cruza Consolidado/Alertas/Diferencias/Sin-receta sin reimplementar
ninguno), `consignacion.ts`, `ventas-sin-receta.ts`, `trazabilidad.ts`,
`historial-producto.ts`, `perdidas.ts`, `devoluciones.ts`,
`resumen-operativo.ts` (dashboard). Más `src/server/actions/promociones.ts`
(las 3 mutaciones reales de la porción: `actualizarPromocionesHabilitado`/
`marcarProductoComoPromocion`, gateadas `promociones_config`).

Gate de acceso: en Apps Script, `mostrarPanelConsultar` (y Alertas, Conteo
Físico, Trazabilidad) están **deliberadamente** abiertos a cualquier
Editor autenticado (`VISTAS_WEBAPP_.consultar.accion: null`, documentado
así explícitamente en `WebApp.js` — a diferencia del hueco real de
seguridad que sí se encontró y cerró en la porción Stock). Acá se respeta
el mismo criterio: las páginas de Reportes solo exigen
`obtenerContextoUsuario()` (sesión + membresía activa), sin una Accion
nueva — con una única excepción ya heredada de Apps Script: la sección
"insumos con unidad mezclada" dentro de Huecos de catálogo sigue
exigiendo `insumos_mezclados` (admin-only), igual que en el original.

134 tests de Vitest en total (40 nuevos de esta porción), todos verdes.

UI escrita bajo `/reportes/*` (17 páginas + nav propio): Resumen (dashboard),
Período, Por categoría, Costos y márgenes, Promociones (management + reporte),
Pérdidas, Devoluciones, Vencimientos, Diferencias de ajuste, Ventas sin
receta, Insumos sin receta, Consignación, Salud por producto, Huecos de
catálogo, Conteos físicos, Historial de un producto, Trazabilidad por ID.
Los filtros de fecha/días/producto usan `<form method="GET">` + Server
Components leyendo `searchParams` (sin JavaScript de cliente para lo que es
"solo lectura, con filtro") — la única página con interactividad de cliente
real es Promociones (togglear la feature, marcar un producto), mismo
patrón que `/stock/minimo`. Verificado con un smoke test de Playwright:
17 páginas cargan con datos reales (compra, ajuste, merma, consumo,
2 ventas —una con receta con merma%, otra que liquida consignación—,
devolución de cliente, devolución a proveedor, y dos conteos físicos que
arman un escenario "revisar" de conciliación de vencimientos) sin errores
de runtime, más las 2 mutaciones reales de Promociones ejercitadas clic a
clic contra el DOM.

### Porción Traspasos entre sucursales — COMPLETA, con UI, verificada en navegador real

Investigación completa de `Sucursales.js` (708 líneas) — ver "Plan de la
porción Traspasos" más abajo para las decisiones con ancla `archivo:línea`.
Esta era la ÚLTIMA porción funcional pendiente del proyecto (ver "Próximas
porciones" de la sesión anterior); con esto, la migración de `motor` a
`motor2` queda funcionalmente completa.

Hallazgo de diseño clave, mayor que en cualquier porción anterior: en Apps
Script cada sucursal ("hostería") es un proyecto Apps Script + planilla
COMPLETAMENTE SEPARADO, sin ningún canal de ejecución entre proyectos —
por eso `Sucursales.js` necesita: (1) una tabla de "Bandeja"
(`TraspasosSucursales`) en el Catálogo Central que cada lado lee/escribe de
forma asincrónica, porque no hay otra forma de que un proyecto "le hable"
al otro; (2) un registro de hosterías (`Hosterias`) + una hoja Config local
(`NombreHosteria`) solo para que cada proyecto sepa "quién es". Ninguna de
esas dos cosas tiene sentido en `motor2`: es una única app Next.js sobre
una única base Postgres, `Sucursal` ya es una tabla real y compartida
(porción Core), y un usuario ya sabe "quién es" vía
`ContextoUsuario.sucursalId` (la sucursal activa de su sesión — misma
noción que "esta hostería" en Apps Script). Se portó el WORKFLOW de
aprobación (que sí importa: el stock no se teletransporta, alguien tiene
que confirmar que lo recibió, con auditoría de quién decidió qué y
cuándo) y nada de la infraestructura de mensajería entre proyectos
separados que ese workflow necesitaba en Apps Script.

Segundo hallazgo: la segunda mitad de `Sucursales.js` (Capacidades por
sucursal, líneas 547-708) YA estaba completa desde la porción Core —
`CapacidadSucursal`, la Accion `capacidades_sucursal`, la UI en
`/administracion/capacidades-sucursal` — así que esta porción es 100%
Transferencias, nada de Capacidades.

Resumen de lo más importante:

- Modelo nuevo: `TraspasoSucursal` (22 columnas de `TraspasosSucursales`
  reducidas a FKs reales — `origenSucursalId`/`destinoSucursalId`/
  `productoId`/`seccionOrigenId`/`seccionDestinoId`/`creadoPorId`/
  `decididoPorOrigenId`/`decididoPorDestinoId`/`cerradoPorId` en vez de
  texto — sin la redundancia "Codigo"/"Unidad", que ya resuelven vía
  `producto`/`producto.unidadStock`).
- 3 valores nuevos en el enum `Proceso` (`TRANSFERENCIA_SALIDA_SUCURSAL`/
  `TRANSFERENCIA_ENTRADA_SUCURSAL`/`REINGRESO_TRANSFERENCIA_SUCURSAL`,
  migración aditiva, anticipados desde la porción Movimientos) — igual que
  `RECLASIFICACION` en Stock, ninguno pasa por el motor genérico
  (`registrarMovimiento`): cada paso del workflow escribe su propia línea
  de Kardex a mano, con el `seccionId` recién conocido en ESE paso.
- `MovimientoStock.traspasoSucursalId` (FK real, nullable) reemplaza la
  correlación por texto "ID Operación === ID Traspaso" de Apps Script —
  mismo criterio que `conteoFisicoId`.
- Sin ninguna Accion nueva: `proceso_transferencia_sucursal` ya estaba
  seedeada desde Core, anticipando esta porción.

Server actions escritas (`src/server/actions/traspasos.ts`):
`crearSolicitudTransferencia` (PULL), `crearEnvioDirectoTransferencia`
(PUSH), `aprobarYEnviarTransferencia`/`rechazarSolicitudTransferencia`
(decisión de Origen sobre una Solicitada), `aceptarTransferencia`/
`rechazarTransferencia` (decisión de Destino sobre una Enviada),
`confirmarReingresoTransferencia` (Origen cierra tras un rechazo de
Destino), `obtenerBandejaTransferencias` (lectura, sin gate — separa lo
que hay que accionar del historial, para cada lado), y
`listarSucursalesDisponibles` (otras sucursales activas, para los
`<select>`). 7 tests de Vitest nuevos (141 en total), incluido el mismo
caso de "guard rail" que tenía Apps Script (el lado equivocado no puede
accionar: Destino no puede aprobar una Solicitada, Origen no puede
aceptar una Solicitada).

UI escrita bajo `/traspasos/*`: la Bandeja (`/traspasos`, con 3 secciones
accionables — Para aprobar/Para aceptar/Para confirmar reingreso — más el
historial) y los dos formularios de alta (`/traspasos/solicitar` para
PULL, `/traspasos/enviar` para PUSH). Verificado con un smoke test de
Playwright con DOS sesiones de navegador reales en paralelo (una por
sucursal, cookies de sesión distintas) ejercitando los dos ciclos
completos: PULL (B solicita → A aprueba y envía → B acepta) y PUSH (A
envía directo → B rechaza → A confirma el reingreso), confirmando el
saldo exacto en cada sucursal al final (A: 30 − 5 aceptado = 25; B: 5
recibido) contra el Kardex real, no solo contra lo que mostraba la UI.

### Bugs de infraestructura encontrados y arreglados (afectaban a TODO el proyecto, no solo Movimientos)

Al intentar correr `npm test` contra un Postgres real por primera vez
(nunca se había hecho, ver "Pendiente" de sesiones anteriores), aparecieron
dos bugs preexistentes que bloqueaban CUALQUIER test, incluidos los de
Core y Catálogo — ninguno de los dos tiene que ver con Movimientos en sí:

1. **`src/lib/db.ts` no podía conectar a Postgres local/docker-compose.**
   `PrismaNeon` habla el protocolo HTTP/WebSocket propio de la
   infraestructura de Neon — con un Postgres liso (`docker compose up -d`,
   como promete el README) tira `Received network error or non-101 status
   code` apenas se ejecuta la primera query. Fix: `crearPrismaClient()`
   ahora elige el adapter según el host de `DATABASE_URL` — `PrismaNeon`
   solo si es un host `neon.tech`, `PrismaPg` (driver `pg` estándar) para
   cualquier otro caso (local, otro proveedor). Se agregaron
   `@prisma/adapter-pg`/`pg`/`@types/pg` como dependencias.
2. **`import "server-only"` rompía cualquier test que tocara un server
   action.** Ese paquete tira error fuera del bundler de Next (que define
   la condición `react-server`) — bajo Vitest/Node directo, cualquier test
   que importara algo con `conPermiso` (o sea, casi todos) fallaba antes
   de correr un solo `it`. Fix: alias en `vitest.config.ts` que reemplaza
   `server-only` por un módulo vacío en tests (mismo criterio que
   recomienda Next.js para testear código server-only).

Con los dos fixes, **la suite completa corre verde contra un Postgres
real** — la primera vez que esto pasó en el proyecto (sesión Movimientos);
se mantuvo verde al sumar Stock, Reportes y Traspasos en sesiones
posteriores.
Ver "Verificación real" más abajo para cómo reproducirlo.

### Verificación real (Postgres 16 local — repetible en cualquier sesión)

1. `npx prisma migrate dev` — aplica todas las migraciones committeadas en
   `prisma/migrations/` (init de Core+Catálogo+Movimientos, índices
   manuales, la migración de la porción Stock — `RECLASIFICACION` +
   `StockMinimoProducto` —, la de Reportes — `PromocionProducto` +
   `Sucursal.promocionesHabilitadas` — y la de Traspasos —
   `TraspasoSucursal` + los 3 procesos de transferencia entre sucursales).
2. `npm run db:seed` — seed limpio (34 acciones, roles, sucursal
   "Central", 5 unidades base).
3. `npm test` — **141/141 tests verdes** (Core, Catálogo, Movimientos,
   Stock, Reportes y Traspasos).
4. `npx tsc --noEmit` y `npx eslint` — limpios.
5. `npx next build` — build de producción limpio, todas las rutas
   compilan (ver `src/app/` para el listado completo: `/catalogo/*`,
   `/administracion/*`, `/movimientos/*`, `/stock/*`, `/reportes/*`,
   `/traspasos/*`).
6. `npm run dev` + sesión de base de datos real (Auth.js, estrategia
   `database`, sin depender de OAuth) + Chromium headless vía Playwright:
   cada porción con UI (Movimientos, Stock, Reportes, Traspasos) se
   ejercitó clic a clic contra el DOM real, no solo contra `tsc`/tests —
   Traspasos, en particular, con DOS sesiones de navegador simultáneas
   (una por sucursal) para probar el ciclo completo cruzado, PULL y PUSH,
   con el saldo final verificado contra el Kardex real.

No se conectó ningún Neon real (sigue pendiente: credenciales de Google
OAuth, y probar contra Neon en vez de Postgres local) — pero el camino
completo "schema → migración → seed → server actions → tests → UI" ya está
probado de punta a punta contra Postgres real, no solo contra el compilador,
para las 6 porciones funcionales del proyecto.

## Pendiente / huecos conocidos

1. Conectar un proyecto Neon real de PRODUCCIÓN y completar `.env` con sus
   credenciales (`DATABASE_URL`/`DIRECT_URL`) — todo lo de acá se verificó
   contra Postgres local; el código soporta los dos casos (ver el bugfix
   de `src/lib/db.ts` arriba), pero Neon en sí nunca se conectó.
2. Credenciales reales de Google OAuth (Google Cloud Console) — sigue
   pendiente, no verificable sin acceso a Google Cloud Console.
3. ~~UI de selección de "sucursal activa" para un usuario con más de una
   membresía~~ — **resuelto (2026-09-15)**. `src/core/auth/contexto.ts`
   ahora expone `membresias` (todas las sucursales activas del usuario) y
   resuelve la activa por cookie (`cambiarSucursalActiva`,
   `src/server/actions/sucursal-activa.ts`) si coincide con una membresía
   real, o la más antigua si no — la cookie nunca se confía a ciegas
   (verificado con test, ver `test/auth/contexto.test.ts`). El selector
   (`src/components/selector-sucursal.tsx`) aparece en el header solo
   cuando el usuario tiene 2+ sucursales. `administracion/usuarios` ahora
   deja elegir a qué sucursal se agrega cada membresía nueva (antes
   siempre la propia), así una persona puede sumarse como admin a varias
   sucursales — un "súper admin" es simplemente alguien con membresía
   activa en todas. `reportes/consolidado` (nuevo) junta el resumen
   operativo de todas las sucursales de quien lo mira, lado a lado —
   invisible para alguien con una sola sucursal (ese es todo el negocio
   hoy, por diseño: nadie ve una sucursal a la que no pertenece).
4. UI de "wizard de Compra por proveedor" con alta rápida de producto
   inline (`CompraPorProveedor.html`/`IncludeAltaRapidaProducto.html` de
   Apps Script) — el panel genérico de Compra ya funciona (picker simple),
   este es un refinamiento de UX, no un bloqueante funcional.
5. `notificarAlertasStockPorMail` (Stock.js:2342-2387) no se portó — pedía
   un servicio de mail real (`MailApp` de Apps Script) que no tiene
   equivalente configurado en este proyecto todavía (Resend/SendGrid/
   etc.). `notificar_alertas` ya está seedeada como Accion, anticipando
   esto cuando haya un proveedor de mail elegido.
6. `exportarReportePeriodoCSV`/`exportarOperacionAHoja` (Reportes.js:
   1367-1430) no se portaron — el primero es trivial de agregar como
   endpoint de descarga cuando haga falta (arma un CSV a partir de
   `obtenerReportePorPeriodo`, que ya existe); el segundo no tiene sentido
   acá (volcaba a una hoja de la misma planilla porque Apps Script no tenía
   otra forma de "exportar" sin tocar Drive — con una base de datos real
   alcanza con mirar la propia página de Trazabilidad).

## Próximas porciones

Ninguna — Core, Catálogo, Movimientos, Stock, Reportes y Traspasos entre
sucursales (la última) quedaron completas (código, tests y UI, todo
verificado contra Postgres real y en navegador). La migración de `motor`
a `motor2` está funcionalmente completa; lo que queda es exclusivamente
lo de "Pendiente / huecos conocidos" arriba — infraestructura real
(Neon de producción, credenciales de Google OAuth) y refinamientos de UX
no bloqueantes (wizard de Compra por proveedor con alta rápida de
producto inline; alertas de stock por mail; exportación CSV del reporte
por período; selección de sucursal activa para multi-membresía).

## Convenciones a mantener en las próximas porciones

- Dominio en español, infraestructura/framework en inglés (`User`/`Account`/
  `Session` de Auth.js son la única excepción, por contrato del adapter).
- Todo modelo de Catálogo/futuro-Movimientos es Catálogo Central o Kardex
  LOCAL — nunca mezclar sin pensar el criterio real de Apps Script primero.
- Toda mutación pasa por `conPermiso(accionClave, fn)`
  (`src/server/actions/con-permiso.ts`) — nunca repetir el gate a mano (es
  el bug C-3 de Apps Script: una segunda copia de la regla de permisos que
  diverge de la primera).
- Investigar el código real de Apps Script (con ancla `archivo:línea`)
  ANTES de diseñar el schema de una porción nueva — todas las decisiones
  no triviales de Core y Catálogo salieron de leer el comportamiento real,
  no de asumirlo.
- Tests: portar el CASO de negocio de `Tests.js`, nunca el harness (Apps
  Script usa mocks de Sheets; acá es Vitest contra Postgres real).

---

## Plan original de la porción Catálogo (íntegro, como referencia)

## Decisiones (resumen)

| Tema | Decisión | Por qué |
|---|---|---|
| Productos/Hoja listado | **Una sola tabla** `Producto` | Hoy son fuente-de-verdad + caché derivada (`upsertProductoDesdeListado_`, Catalogo.js:213-344) — un artefacto de Sheets sin FKs/transacciones, no un modelo de dominio real. Elimina de raíz `reconstruirProductosDesdeListado` (Catalogo.js:72-177) y la acción `reconstruir_productos`. |
| Uso (COMPRA/VENTA) | **No se persiste** | 100% derivable de `tipo` desde "eliminar COMPRA+VENTA" (Catalogo.js:1035-1062): MP→COMPRA, PV→VENTA, sin excepción. |
| Familia | Se llama **`Insumo`** en el schema | Mismo dato, cambio de nombre de cara al usuario desde v2.3.0 (Catalogo.js:180-197) — se adopta el nombre nuevo también internamente para no arrastrar la confusión. |
| Categoría de producto vs. categoría de unidad | Modelos con nombres explícitamente distintos: `CategoriaProducto` vs. `Unidad.magnitud` (enum) | Mismo nombre de columna en Sheets por coincidencia léxica (Catalogo.js:2969-2989 vs. 2650-2686), sin relación real de datos — no repetir la ambigüedad en Postgres. |
| Código de Producto/Proveedor | Generación optimista en la app; el `UNIQUE` de Postgres + reintento ante colisión (`P2002`) es el árbitro final | Reemplaza `resolverColisionDeCodigoTrasAlta_` (detectar-y-corregir DESPUÉS de escribir, Catalogo.js:1018-1033) por algo estructuralmente imposible de corromper. |
| ProveedorPorProducto (carrera cross-hostería) | `UNIQUE(productoId, proveedorId, unidadCompraId)` real + `INSERT ... ON CONFLICT DO UPDATE` atómico | El bug documentado en el propio código (Catalogo.js:3278-3294: dos sucursales comprando el mismo insumo casi simultáneo duplican la fila, hoy mitigado post-hoc por `fusionarDuplicadosProveedorPorProducto_`) deja de ser posible. |
| `reconstruir_productos` / `sincronizar_proveedores` (acciones de permiso) | La primera se **elimina** del catálogo de Acciones; la segunda queda **reservada sin server action** | Eran parches para la falta de FK/una sola fuente de verdad — con FK real y una sola tabla, lo que reparaban no puede volver a ocurrir. |
| Recetas | Versionado append-only, `version: Int`, vigente = `MAX(version)` **derivado** (sin flag a mantener) | Replica Catalogo.js:1690-1779 sin el riesgo de un flag desincronizado. |
| Renombrar producto/insumo | Pasa a ser un `UPDATE` de una fila | Receta/Presentación/ProveedorPorProducto referencian por `productoId`/`insumoId` (FK real), no por nombre — elimina `renombrarProductoEnHistorial_` (Catalogo.js:1270-1314) y el "buscar y reemplazar" de `renombrarFamilia` (Catalogo.js:2565-2618). |
| Alcance de sucursal | Ningún modelo de esta porción tiene `sucursalId` | Es Catálogo Central puro, igual que `HOJAS_CATALOGO_CENTRAL` hoy — el alcance por sucursal sigue resolviéndose aparte, en `CapacidadSucursal`. |
| `ProveedorPorProducto.unidadStock` propia | **No se agrega** (se deriva de `producto.unidadStockId`) | Esa columna en Sheets nunca alimenta lógica real, solo se muestra como texto. Si se necesitara un snapshot histórico más adelante, es una migración aditiva simple. |

## Schema de Prisma (ya aplicado en `motor2/prisma/schema.prisma`)

```prisma
enum TipoProducto {
  MP
  PV
}

enum MagnitudUnidad {
  PESO
  VOLUMEN
  CANTIDAD
}

/// Reemplaza Hoja listado + Productos — una sola fuente de verdad y de
/// lectura, sin caché derivada que pueda desincronizarse.
model Producto {
  id     String       @id @default(cuid())
  codigo String       @unique
  nombre String
  tipo   TipoProducto

  categoriaId String?
  categoria   CategoriaProducto? @relation(fields: [categoriaId], references: [id])

  unidadCompraId String?
  unidadCompra   Unidad?  @relation("ProductoUnidadCompra", fields: [unidadCompraId], references: [id])
  unidadStockId  String
  unidadStock    Unidad   @relation("ProductoUnidadStock", fields: [unidadStockId], references: [id])
  factorConversion Decimal @default(1) @db.Decimal(14, 4)

  activo        Boolean @default(true)
  observaciones String?

  insumoId String?
  insumo   Insumo? @relation(fields: [insumoId], references: [id])

  precioVenta Decimal @default(0) @db.Decimal(14, 2)
  seProduce   Boolean @default(false)

  esConsignacion          Boolean    @default(false)
  proveedorConsignacionId String?
  proveedorConsignacion   Proveedor? @relation("ProveedorConsignacionDe", fields: [proveedorConsignacionId], references: [id])
  precioConsignacion      Decimal?   @default(0) @db.Decimal(14, 2)

  creadoEn DateTime @default(now())

  presentaciones       Presentacion[]
  proveedorPorProducto ProveedorPorProducto[]
  recetaVersiones      RecetaVersion[]     @relation("RecetaVersionProducto")
  usadoComoIngrediente RecetaIngrediente[] @relation("RecetaIngredienteInsumo")

  @@index([insumoId])
  @@index([categoriaId])
}

/// Nombre interno histórico "Familia" — de cara al usuario es "Insumo"
/// desde v2.3.0; solo tiene sentido para Producto.tipo = MP.
model Insumo {
  id     String  @id @default(cuid())
  nombre String  @unique
  activo Boolean @default(true)

  grupoId String?
  grupo   Grupo?  @relation(fields: [grupoId], references: [id])

  productos Producto[]

  @@index([grupoId])
}

/// Árbol sin límite de niveles (self-referencing), inspirado en ERPNext
/// Item Group. Prevención de ciclos = lógica de aplicación (no es
/// representable como constraint de Postgres), ver src/core/catalogo/grupo.ts.
model Grupo {
  id           String  @id @default(cuid())
  nombre       String  @unique
  activo       Boolean @default(true)
  grupoPadreId String?
  grupoPadre   Grupo?  @relation("GrupoArbol", fields: [grupoPadreId], references: [id])
  hijos        Grupo[] @relation("GrupoArbol")

  insumos Insumo[]

  @@index([grupoPadreId])
}

/// Rubro comercial — aplica a MP o PV, sin jerarquía, sin relación con Grupo.
model CategoriaProducto {
  id        String     @id @default(cuid())
  nombre    String     @unique
  activo    Boolean    @default(true)
  productos Producto[]
}

/// `magnitud` es solo organizativo/default de decimales — NO valida
/// conversión real (esa es validarUnidadInsumo: incompatible cambiar la
/// unidadStock dentro de un mismo Insumo).
model Unidad {
  id        String         @id @default(cuid())
  nombre    String         @unique
  magnitud  MagnitudUnidad
  activa    Boolean        @default(true)
  decimales Int            @default(2)

  productosPorUnidadCompra Producto[]             @relation("ProductoUnidadCompra")
  productosPorUnidadStock  Producto[]             @relation("ProductoUnidadStock")
  presentaciones           Presentacion[]
  proveedorPorProducto     ProveedorPorProducto[]
  recetaIngredientes       RecetaIngrediente[]
}

/// Presentaciones de compra ALTERNATIVAS a la default de Producto.
model Presentacion {
  id               String   @id @default(cuid())
  productoId       String
  producto         Producto @relation(fields: [productoId], references: [id])
  unidadCompraId   String
  unidadCompra     Unidad   @relation(fields: [unidadCompraId], references: [id])
  factorConversion Decimal  @db.Decimal(14, 4)
  activa           Boolean  @default(true)

  @@unique([productoId, unidadCompraId])
}

model Proveedor {
  id              String  @id @default(cuid())
  codigo          String  @unique
  nombre          String  @unique
  contacto        String?
  telefono        String?
  email           String?
  cuit            String?
  condicionesPago String?
  notas           String?
  activo          Boolean @default(true)

  productosConsignados Producto[]             @relation("ProveedorConsignacionDe")
  proveedorPorProducto ProveedorPorProducto[]
}

/// Clave real: (producto, proveedor, unidad de compra). El UNIQUE +
/// upsert atómico (ver server actions) hace estructuralmente imposible la
/// carrera cross-hostería que hoy solo se detecta y corrige después de
/// escribir (fusionarDuplicadosProveedorPorProducto_, Catalogo.js:3303-3320).
model ProveedorPorProducto {
  id             String    @id @default(cuid())
  productoId     String
  producto       Producto  @relation(fields: [productoId], references: [id])
  proveedorId    String
  proveedor      Proveedor @relation(fields: [proveedorId], references: [id])
  unidadCompraId String
  unidadCompra   Unidad    @relation(fields: [unidadCompraId], references: [id])
  precioUnitario       Decimal  @default(0) @db.Decimal(14, 4)
  precioPorUnidadStock Decimal  @default(0) @db.Decimal(14, 4)
  ultimaCompra         DateTime @default(now())

  @@unique([productoId, proveedorId, unidadCompraId])
}

/// Versionado append-only real — nunca se pisa ni borra una versión (una
/// venta pasada referencia esa versión para costeo/auditoría). Vigente =
/// MAX(version) para ese producto, siempre derivado, nunca un flag.
model RecetaVersion {
  id         String   @id @default(cuid())
  productoId String
  producto   Producto @relation("RecetaVersionProducto", fields: [productoId], references: [id])
  version    Int
  creadoEn   DateTime @default(now())

  ingredientes RecetaIngrediente[]

  @@unique([productoId, version])
}

model RecetaIngrediente {
  id              String        @id @default(cuid())
  recetaVersionId String
  recetaVersion   RecetaVersion @relation(fields: [recetaVersionId], references: [id], onDelete: Cascade)
  insumoProductoId String
  insumoProducto   Producto @relation("RecetaIngredienteInsumo", fields: [insumoProductoId], references: [id])
  cantidad         Decimal  @db.Decimal(14, 4)
  unidadId         String
  unidad           Unidad   @relation(fields: [unidadId], references: [id])
  mermaPorcentaje  Decimal  @default(0) @db.Decimal(6, 2)
  observaciones    String?

  @@index([insumoProductoId])
}
```

**Migración manual post-`prisma migrate dev`** (mismo criterio que el índice
parcial de `CapacidadSucursal` en la porción Core): agregar a mano en el
`migration.sql` generado los índices únicos funcionales que Prisma no puede
declarar (unicidad case/espacio-insensible, mismo criterio que `mismoTexto_`):

```sql
CREATE UNIQUE INDEX "producto_nombre_lower_key" ON "Producto" (lower(nombre));
CREATE UNIQUE INDEX "proveedor_nombre_lower_key" ON "Proveedor" (lower(nombre));
CREATE UNIQUE INDEX "insumo_nombre_lower_key" ON "Insumo" (lower(nombre));
CREATE UNIQUE INDEX "categoria_producto_nombre_lower_key" ON "CategoriaProducto" (lower(nombre));
CREATE UNIQUE INDEX "unidad_nombre_lower_key" ON "Unidad" (lower(nombre));
CREATE UNIQUE INDEX "grupo_nombre_lower_key" ON "Grupo" (lower(nombre));
```

## Generación de código y upserts atómicos

`src/core/catalogo/generar-codigo.ts` — genera `${prefijo}_<uuid6>` de forma
optimista y reintenta ante `P2002` (colisión) en vez de detectar-y-corregir
después de escribir (reemplaza `resolverColisionDeCodigoTrasAlta_`). Se
reusa para `Producto.codigo` (`MP_`/`PV_`) y `Proveedor.codigo` (`PRV_`).

`upsertProveedorPorProducto` usa `prisma.$executeRaw` con
`INSERT ... ON CONFLICT (productoId, proveedorId, unidadCompraId) DO UPDATE`
— no `prisma.upsert()`, porque el `SET` necesita una condición (`CASE WHEN`,
igual que Catalogo.js:3241-3247: un precio 0 nunca pisa un precio bueno ya
cargado) que el `upsert` de Prisma no soporta sin una lectura previa (que
reintroduciría la ventana de carrera que esto reemplaza).

`guardarReceta` calcula `version = MAX(version)+1` de forma optimista; el
`@@unique([productoId, version])` es el árbitro final ante dos ediciones
simultáneas de la misma receta.

## Server actions (patrón ya usado en Core: `conPermiso`/`requierePermisoVer`)

- **Producto**: `listarProductos`, `buscarProductoParaEditar` (sin gate) · `darDeAltaProducto`/`actualizarProducto` → `alta_producto`/`editar_producto` · `agregarPresentacionAlternativa`/`actualizarActivaPresentacion` → `alta_producto`.
- **Proveedores**: `altaProveedor` → `alta_producto` (se preserva la decisión histórica, Catalogo.js:3747-3756) · `actualizarActivaProveedor` → `proveedores` · `upsertProveedorPorProducto` sin gate propio (lo gatea el flujo de Compra en Movimientos, porción futura) · `obtenerComparativaPreciosPorInsumo`, página gatea con `comparar_precios`.
- **Recetas**: `obtenerRecetaVigente` sin gate directo (página gatea con `guardar_receta`) · `guardarReceta`/`agregarIngredienteAReceta` → `guardar_receta`.
- **Insumo/Grupo**: `crearInsumo` → `alta_producto` · `renombrarOFusionarInsumo`/`actualizarActivoInsumo`/`actualizarGrupoDeInsumo`/`crearOActualizarGrupo` (con `creariaCiclo`, port de Catalogo.js:2483-2489) → `grupos_familia`.
- **Categorías**: `crearCategoriaProducto` → `alta_producto` · `actualizarActivaCategoriaProducto` → `categorias`.
- **Unidades**: `crearUnidad`/`actualizarActivaUnidad`/`actualizarDecimalesUnidad` → `unidades` · `detectarInsumosConUnidadMezclada` → `insumos_mezclados` (se preserva gateada aunque sea lectura, mismo criterio que hoy).

`src/core/catalogo/producto.ts` (`usoDeTipo`, `validarTipoUso`,
`validarUnidadInsumo`) y `src/core/catalogo/grupo.ts` (`creariaCiclo`,
`cadenaDeGrupos`) — funciones puras portadas de Catalogo.js, testeables sin DB.

Se **eliminó** `reconstruir_productos` de `src/core/permisos/acciones.ts`.
`sincronizar_proveedores` queda en el catálogo, reservada sin server action.

## UI (7 páginas bajo `/catalogo/*`)

Patrón de referencia: **listado + alta rápida inline**, al estilo de la
vista de lista de ERPNext (tabla filtrable/buscable a la izquierda, panel
de detalle/alta a la derecha o en modal) — no la UI plana de
tabla-arriba/formulario-abajo que usó Core. Esto no es copiar a ciegas: es
formalizar un patrón que Apps Script YA resolvió bien y que la propia
auditoría del proyecto señala como ejemplo de calidad ("+ Nueva
Familia"/"+ Nuevo proveedor" inline desde Alta/Editar Producto, sin salir
del flujo — `crearFamiliaDesdePanel`/`crearCategoriaDesdePanel` invocadas
inline). En motor2 esto se tradujo a: el form de alta/edición de Producto
incluye un "+ Nuevo insumo"/"+ Nueva categoría"/"+ Nuevo proveedor" que
abre un modal liviano y vuelve a completar el select, en vez de forzar una
navegación a otra página.

Páginas ya escritas: `productos` (lista + alta/edición con quick-create
inline), `proveedores` (+ comparativa de precios como vista secundaria),
`recetas` (editor con alta de versión), `insumos-grupos` (árbol + fusión),
`categorias`, `unidades`. Presentaciones queda como sub-panel dentro de la
edición de un producto (no una página aparte, igual que hoy
`EditarProducto.html`).

## Testing (Vitest, spec de negocio — no el harness de Apps Script)

Casos portados desde `Tests.js` (criterio ya usado en Core): duplicado de
código/nombre de producto (incluida una carrera real con `Promise.all`
sobre dos altas concurrentes), combinación Tipo/Uso inválida, receta que
solo suma la versión vigente (nunca la unión de versiones), receta rechaza
producto no elegible / ingrediente que no es MP activa, `agregarIngredienteAReceta`
preserva existentes y rechaza duplicado, árbol de grupos rechaza ciclo
(directo y por cadena de ancestros), comparativa de precios ignora ofertas
en 0 al elegir "más barato", proveedor sin precio no pisa un precio bueno.

Caso nuevo que reemplaza `testUpsertProveedorParaMPFusionaDuplicados...`:
disparar dos `upsertProveedorPorProducto` en paralelo sobre la misma clave
y verificar `count() === 1` — la prueba en código de que el bug documentado
en Catalogo.js:3278-3294 ya no puede ocurrir.

Casos nuevos sin equivalente en Sheets (huecos reales del modelo relacional):
fusionar Insumo A→B repunta todos los `Producto.insumoId` sin huérfanos;
borrar/editar un `Producto` referenciado por una `RecetaIngrediente` vieja
falla (integridad referencial real, `onDelete: Restrict` default).

## Verificación de la porción Catálogo

1. `npx prisma migrate dev` aplica el schema nuevo sin romper las tablas de
   Core ya existentes; aplicar a mano los índices funcionales de unicidad.
2. Alta de producto con código duplicado (manual) → error; dos altas
   concurrentes con código autogenerado → ambas terminan con código
   distinto, nunca truena por duplicado silencioso.
3. Crear receta v1, editarla (v2) → `obtenerRecetaVigente` devuelve solo v2;
   `RecetaVersion` sigue teniendo la fila de v1.
4. Dos `upsertProveedorPorProducto` concurrentes sobre la misma clave →
   una sola fila en `ProveedorPorProducto`.
5. Intentar `Grupo.grupoPadre` en ciclo (directo o por cadena) → rechazado.
6. Suite de Vitest de esta porción verde (`npm test`).

---

## Plan de la porción Movimientos (código, tests y migración completos y verdes; falta UI)

Investigación hecha (repo `motor`) antes de tocar el schema, siguiendo la
misma convención que Core/Catálogo: `Movimientos.js` completo (1825
líneas — `TRANSICIONES`, `armarRegistroMovimiento_`,
`confirmarRegistrarMovimientos`, `confirmarRegistrarVenta_ConLock_`,
`calcularPreviaOperacion`/`armarPreviaVentaDesdeItems_`), las secciones
relevantes de `Stock.js` (libro mayor incremental, Secciones, Conteo
Físico, Reclasificación — `calcularStockActual_`,
`aplicarMovimientosAStockIncremental_`, `_registrarConteoFisicoSinRecalculo_`,
`resolverConteoPendiente`, `cancelarConteoFisico`, `dividirClasificacionStock_`),
`Catalogo.js:2043-2077` (Precio Local, hueco encontrado — ver abajo), y
`Sucursales.js` (solo la definición de `TRANSFERENCIA_*_SUCURSAL` en
`TRANSICIONES`, no el flujo de bandeja — eso es la porción Traspasos). Se
aprovechó `AUDITORIA-movimientos.md` e `IDEA-conteo-fisico-por-lote.md`
(auditoría ya cerrada, 2026-09-13, con sus 5 hallazgos ya resueltos en
Apps Script) como investigación adelantada del dominio.

### Decisiones (resumen)

| Tema | Decisión | Por qué |
|---|---|---|
| Signo de stock | `MovimientoStock.cantidad` se graba **siempre ya firmado** (+ entra, − sale); no hay una tabla/lista de signos aparte que leer | Apps Script v2.4.0 (Movimientos.js:433-455) documenta el bug real: se agregó MERMA a `TRANSICIONES` con `signoStock: -1`, pero una segunda lista de signos (hardcodeada, separada) no se actualizó — la merma se registraba pero no restaba nada del stock. Con `cantidad` ya firmado el saldo es siempre `SUM(cantidad)`, sin lookup al leer, sin segunda fuente que desincronizar. |
| Kardex en dos niveles: `Operacion` + `MovimientoStock` | Se promueve "ID Operación" (Movimientos.js:963-974 — hoy un UUID de texto compartido a ciegas entre filas de Sheets) a tabla propia con FK real | `WHERE operacionId = X` en vez de escanear Kardex filtrando por string; separa lo constante-por-lote (sucursal, proceso, proveedor, factura, fecha, motivo, usuario) de lo variable-por-línea (producto, sección, cantidad, precio, detalle). Mismo patrón que ERPNext (Stock Entry → Stock Ledger Entry), sin una tabla de "detalle" redundante porque cada línea YA es un movimiento real, no un input a procesar aparte. |
| Granularidad de `Operacion` varía por proceso | Se porta tal cual: Compra/Ajuste/Consumo/Producción/Merma/Transferencia/Devolución×2/Control → una `Operacion` cubre todo un lote confirmado en una sola llamada; Venta → una `Operacion` por CADA venta individual (Movimientos.js:1211-1217, `idOperacionVenta` propio por línea vendida) | Cada venta es su propio evento económico (con su propia Liquidación de consignación si aplica) — mezclarlas en una sola operación perdería esa trazabilidad, que Apps Script ya resuelve así. |
| `proceso` a dos niveles | `Operacion.proceso` = lo que el usuario INICIÓ (gatea el permiso, `ACCION_POR_PROCESO_`); `MovimientoStock.proceso` = el efecto real de esa línea puntual (puede diferir: una Operacion de Producción o Venta genera líneas hijas `CONSUMO`/`LIQUIDACION_CONSIGNACION`) | Igual que Apps Script distingue `payload.proceso` de `r.procesoOriginal`/`'Consumo'`/`'Liquidacion Consignacion'` por fila dentro del mismo `idOperacion` — el signo se calcula con el proceso de LA LÍNEA, no el de la operación. |
| Sucursal explícita en todo | `Seccion`, `Operacion`, `ConteoFisico`, `PrecioLocalProducto` tienen `sucursalId` real | En Apps Script la sucursal era implícita (1 contenedor/spreadsheet = 1 sucursal, con su propio Kardex/Secciones/Precio Local). Acá todas comparten una sola base — sin esta columna no hay cómo scopear ninguna de estas tablas. |
| Secciones por sucursal | `Seccion.sucursalId` + `@@unique([sucursalId, nombre])`, no un catálogo global | Mismo motivo — cada sucursal define su propio conjunto de secciones/depósitos. |
| Sección siempre obligatoria | Se porta tal cual la decisión de Apps Script (2026-09-13): `CONSUMO`/`AJUSTE`/`CONTROL`/`MERMA`/`DEVOLUCION_CONSIGNACION`/`DEVOLUCION_PROVEEDOR` exigen elegir sección explícitamente (nunca se adivina, ni con una sola sección con stock); `COMPRA`/`PRODUCCION`/`DEVOLUCION_CLIENTE`/`VENTA` no la exigen (dan de alta stock nuevo); `TRANSFERENCIA` no la exige porque el origen ya es un campo obligatorio propio | Investigación de referencia ya hecha en Apps Script contra Dolibarr/ERPNext (ninguno de los dos auto-imputa ubicación) — no hay motivo para reabrir la decisión, se porta la config `exigeSeccion` por proceso tal cual. |
| FEFO simplificado, no FIFO real | `MovimientoStock.loteVencimiento` nullable, sin entidad `Lote` propia ni saldo remanente por lote trackeado | Decisión de negocio ya tomada (Stock.js:403-425): una salida sin lote asume el que vence antes, sin repartir entre varios lotes si no alcanza. FIFO real es un cambio de arquitectura que esta porción no necesita — se puede corregir a mano con Conteo Físico/Reclasificación, igual que hoy. |
| Motivo/Destino tipados | `MotivoMerma`/`DestinoConsumo` (enum) en `Operacion`, no plegados en el texto de detalle | En Sheets se plegaban dentro de "Movimiento detalle" porque agregar una columna real era costoso — el propio código lo dice ("para que los reportes puedan agrupar por causa sin cambiar el esquema"). Acá el schema evoluciona con una migración normal: se tipa de una vez. |
| `PrecioLocalProducto` nuevo (no en Catálogo) | Se agrega en esta porción, con `@@unique([sucursalId, productoId])` | Hueco real encontrado investigando Venta (`armarPreviaVentaDesdeItems_`, Movimientos.js:1751-1759, usa `precioVenta` ya resuelto con override local vía `resolverPrecioVenta_`, Catalogo.js:2072-2077) — la porción Catálogo nunca lo modeló porque en Apps Script vive en la hoja LOCAL de cada hostería (`HOJA_PRECIO_LOCAL`), no en Catálogo Central. `precio_local` ya estaba seedeado en `acciones.ts` anticipando esto. |
| `Operacion.usuarioId` nuevo (no existía) | Se agrega a propósito, fuera del alcance original de Apps Script | Apps Script no guardaba quién ejecutó cada movimiento en el Kardex (`Session.getActiveUser()` solo se guardaba en `ConteosFisicos`, porque corría como script deployado). Acá hay Auth.js real (porción Core) — es gratis agregarlo ahora y valioso para auditoría. |
| Validación de stock agregada por payload, no por línea | Portar tal cual el bugfix C-1 de Apps Script (Movimientos.js:910-961): sumar todo lo requerido por clave `producto+sección` dentro de un mismo payload ANTES de validar, una sola vez por clave | Dos líneas del mismo payload pidiendo el mismo producto+sección (ej. dos Mermas del mismo insumo en la misma tanda) pasaban la validación individual aunque juntas superaran el stock disponible — sin esto, Kardex terminaba con más salida de la que había, sin aviso. |
| Cancelar Conteo Físico = reversión, nunca edición | `ConteoFisico.movimientos` es una relación 1:N (0, 1 con el ajuste original, o 2 con la reversión al cancelar) — Kardex nunca se edita ni se borra | Ya es así en Apps Script (Stock.js:2077-2141: "nunca se edita ni se borra la fila original... se escribe una fila de REVERSIÓN"). Se porta el comportamiento tal cual, con una FK real en vez de correlacionar por string (`idOperacion === idConteo`). |
| `RECLASIFICACIÓN` y transferencias entre sucursales, deferidos | El enum `Proceso` no los incluye todavía | Son primitivas de otras porciones ya identificadas (Stock: Reclasificación nunca pasa por `TRANSICIONES`, Stock.js:1899-1991; Traspasos: `TRANSFERENCIA_*_SUCURSAL`, gateadas por `proceso_transferencia_sucursal`, con su propia bandeja de solicitud/aprobación en `Sucursales.js`). Agregarlas ahora sería diseñar esas porciones sin investigarlas primero — contra la convención del proyecto. Un valor de enum nuevo es una migración aditiva trivial cuando llegue el momento. |
| Stock Mínimo / `AlertasStock`, deferidos | No se modela en esta porción | `stock_minimo` (Accion ya seedeada) solo alimenta `AlertasStock` (Stock.js) — a diferencia de Precio Local, Movimientos no lo necesita funcionalmente para escribir ningún movimiento. Queda para cuando se investigue la porción Stock. |

### Modelos (ya en `prisma/schema.prisma`, no se duplica acá para que no diverjan)

`Proceso`, `MotivoMerma`, `DestinoConsumo`, `AccionConteo`, `EstadoConteo`
(enums) + `Seccion`, `Operacion`, `MovimientoStock`, `ConteoFisico`,
`PrecioLocalProducto` (modelos) — cada uno con su docstring explicando la
decisión y el ancla a Apps Script. `npx prisma validate`/`generate` ya
corridos sin errores contra este schema.

### Algoritmos (implementados — `src/core/movimientos/`)

- **`TRANSICIONES` → `src/core/movimientos/transiciones.ts`**: const TS 1:1
  con Movimientos.js:61-348 (`permiteCero`, `requiereStockReal` — cubre
  también Producción, ver docstring en el archivo —, `aplicaFactorConversion`,
  `generaConsumoDeReceta`, `exigeSeccion`, y el signo — usado UNA vez, al
  construir `cantidad` antes de insertar, nunca al leer). `filtroUso` de
  Apps Script NO se portó: "Uso" ya no existe como dato persistido
  (porción Catálogo), así que donde Apps Script filtraba por Uso (solo
  Compra) acá se filtra por `tipo === 'MP'` directo — mismo resultado,
  sin el dato redundante. Fuente única, mismo criterio que ya defendió
  Apps Script después del bug de Merma.
- **`armarLineaMovimiento`** (`src/server/actions/movimientos.ts`, equivalente
  a `armarRegistroMovimiento_`, Movimientos.js:724-872): conversión de
  unidad (factor / presentación alternativa / peso real), redondeo por
  decimales de la `Unidad`, cálculo de `precioUnitario`/`precioPorUnidadStock`.
  La pista de "tiene stock en: ..." (`seccionesConStock`,
  `src/core/movimientos/stock.ts`) se arma contra un `SUM(cantidad) GROUP
  BY seccionId` real, no un array de stock precalculado.
- **`calcularConsumosProduccion`/`resolverConsumoPorFamilia`**
  (`src/core/movimientos/stock.ts`, equivalente a Movimientos.js:632-659,
  Stock.js:481-524): al Producir o Vender un PV con receta, expande cada
  ingrediente a 1+ líneas de Consumo — con reparto entre "hermanos" del
  mismo `Insumo` (`Producto.insumoId`, porción Catálogo) si el puntual no
  alcanza. FEFO simplificado: `groupBy` + orden ascendente sobre
  `loteVencimiento` (equivalente a `obtenerLoteMasProximoAVencer_`,
  Stock.js:426-480), con-fecha antes que sin-fecha.
- **Validación de stock suficiente** (`validarStockSuficiente`,
  `src/core/movimientos/stock.ts`): `SUM(cantidad) GROUP BY productoId,
  seccionId` sobre el índice `@@index([productoId, seccionId, loteVencimiento])`
  reemplaza `validarStockSuficiente_`/`obtenerStockMP_` (Stock.js:573-598)
  — sin hoja "Stock" materializada a mano: Postgres agrega en tiempo real.
  Acumulado por clave dentro del mismo payload ANTES de escribir nada
  (bugfix C-1, ver tabla arriba, con test que lo prueba), dentro de una
  transacción **Serializable + reintento**
  (`src/core/movimientos/con-reintento.ts`) que reemplaza `conLock_`/
  `LockService` — sin un lock de aplicación (no aplica en Postgres), se
  deja que la propia base rechace (código P2034) y se reintente cualquier
  escritura que resultaría en una condición de carrera real; verificado
  con un test de 2 requests concurrentes reales (`Promise.all`), no solo
  de agregación dentro de un mismo payload.
- **Venta** (`src/server/actions/venta.ts`, equivalente a
  `confirmarRegistrarVenta_ConLock_`, Movimientos.js:1154-1332): por cada
  ítem vendido → 1 `Operacion` propia con N `MovimientoStock` (`VENTA`
  para el PV + `CONSUMO` por cada MP de receta + `LIQUIDACION_CONSIGNACION`
  si esa MP tiene `Producto.esConsignacion`, con `cantidad: 0` y
  `precioTotal = cantidadConsumida × Producto.precioConsignacion`; quién
  es el consignante se lee vía FK, `producto.proveedorConsignacion`, sin
  duplicarlo en la fila como hacía Apps Script). Precio de venta:
  `resolverPrecioVenta` (`src/core/movimientos/precio-venta.ts`) —
  `PrecioLocalProducto` si existe y `habilitado`, si no `Producto.precioVenta`.
- **Conteo Físico** (`src/server/actions/conteo-fisico.ts`, equivalente a
  `_registrarConteoFisicoSinRecalculo_`/`resolverConteoPendiente`/
  `cancelarConteoFisico`, Stock.js:1523-2141): 3 acciones (`AJUSTAR`
  escribe el `MovimientoStock` de corrección; `FALTA_MOVIMIENTO` deja el
  `ConteoFisico` en `PENDIENTE` sin tocar stock; `DESCARTAR` no ajusta ni
  cuenta como válido) — mismo state machine, con `MovimientoStock.conteoFisicoId`
  como FK real en vez de correlación por string (`idOperacion === idConteo`).
- **Transferencia** (dentro de `registrarMovimiento`, rama `esTransferencia`,
  equivalente a `confirmarRegistrarMovimientos`, Movimientos.js:991-1022):
  1 `Operacion` (`TRANSFERENCIA`) con 2 `MovimientoStock` por línea
  (−cantidad en `seccionId` origen, +cantidad en `Operacion.seccionDestinoId`),
  ambas con `proceso: TRANSFERENCIA`.
- **Duplicado de factura** (dentro de `registrarMovimiento`, equivalente a
  `validarFacturaNoDuplicada_`, Movimientos.js:402-416):
  `WHERE proceso = COMPRA AND proveedorId = X AND nroFactura = Y` sobre
  `Operacion` — más simple que escanear Kardex por texto, ahora que
  proveedor/factura son columnas reales de `Operacion`, no texto por fila.

### Server actions (implementadas, patrón `conPermiso` ya usado en Core/Catálogo)

- **`registrarMovimiento`** (`src/server/actions/movimientos.ts`) — motor
  genérico para los 9 procesos que comparten forma de payload: Compra,
  Producción, Consumo, Ajuste, Transferencia, Merma, Devolución×3. Gatea
  contra `ACCION_POR_PROCESO[proceso]` (`proceso_compra`/`proceso_produccion`/
  etc., ya seedeadas en `acciones.ts`).
- **`registrarVenta`** (`src/server/actions/venta.ts`) → `proceso_venta`.
- **`registrarConteoFisico`/`resolverConteoPendiente`/`cancelarConteoFisico`**
  (`src/server/actions/conteo-fisico.ts`) → `proceso_control`/`cancelar_conteo`.
- **`crearSeccion`/`actualizarActivaSeccion`/`listarSeccionesActivas`/
  `listarSeccionesParaPanel`** (`src/server/actions/secciones.ts`) → `secciones`.
- **`setPrecioLocalProducto`/`obtenerPrecioLocalProducto`/`listarPreciosLocales`**
  (`src/server/actions/precio-local.ts`) → `precio_local`.

A diferencia de Apps Script (vista previa `calcularPreviaOperacion` +
confirmación `confirmarRegistrarMovimientos` como dos llamadas RPC
separadas, necesario porque el panel de Sheets mostraba un modal
intermedio), acá quedó en UNA sola llamada por acción — el cálculo
(`armarLineaMovimiento`) y la escritura viven en la misma transacción
porque la validación de stock necesita ser atómica con la escritura de
todas formas (ver Serializable + reintento arriba); la UI puede seguir
mostrando su propio resumen de conversión ANTES de confirmar sin que el
servidor necesite dos pasos — es responsabilidad de la UI, no del server
action.

### UI (implementada, `src/app/movimientos/`)

- **`[proceso]/page.tsx` + `panel-movimiento-form.tsx`**: panel genérico
  parametrizado por proceso — equivalente a `mostrarPanelOperacion_`
  (Movimientos.js:1777-1825) — para los 9 procesos del motor genérico.
  `src/core/movimientos/ui-config.ts` mapea cada slug de URL
  (`/movimientos/compra`, `/movimientos/merma`, ...) a su `Proceso`, título
  y qué campos mostrar (proveedor/factura, motivo, destino, precio/peso
  real solo si `aplicaFactorConversion`) — con una verificación en tiempo
  de import de que todo slug tiene su entrada en `TRANSICIONES`, para que
  agregar un proceso nuevo sin darle config de UI explote temprano.
  Lista de productos dinámica (agregar/quitar líneas), no hay wizard de
  Compra por proveedor aparte ni quick-create inline de producto en esta
  primera versión (`CompraPorProveedor.html`/`IncludeAltaRapidaProducto.html`
  de Apps Script) — el picker es un `<select>` con todos los productos
  activos, más simple que el buscador en vivo de Apps Script.
- **`venta/page.tsx` + `venta-form.tsx`**: propia, sin proveedor/factura
  obligatorios, solo productos `tipo: PV`.
- **`conteo-fisico/page.tsx`**: form de carga + tabla de historial
  (`obtenerHistorialConteosFisicos`) con botones inline
  ("Ya se cargó"/"Ajustar ahora" para `PENDIENTE`, "Cancelar" para
  `RESUELTO`) — mismo patrón de `<form action={server action}>` inline que
  ya usa `/catalogo/categorias`, sin componente cliente para la tabla.
- **`secciones/page.tsx`**: alta + activar/desactivar, mismo patrón que
  `/catalogo/categorias` exactamente.
- **`precio-local/page.tsx` + `precio-local-form.tsx`**: tabla de overrides
  vigentes + form de alta/edición.
- **Reclasificar** (`reclasificarStock`, Stock.js — primitiva de la
  porción Stock) NO tiene entrada de UI todavía, a propósito: en Apps
  Script vive dentro del panel de Conteo Físico, pero acá se prefirió no
  construir la UI de una primitiva que la porción Stock ni siquiera
  diseñó en el schema todavía (ver la nota de `RECLASIFICACIÓN` en
  Decisiones, arriba).

Verificado en un navegador real (Chromium vía Playwright, no solo
`tsc`/tests): con una sesión de base de datos real (Auth.js, estrategia
`database`) se registró una Compra, una Merma, una Venta, un Conteo
Físico (con su fila apareciendo en el historial y el botón "Cancelar"
funcionando), un alta de Sección y un Precio Local — los 7 pasos
terminaron en verde contra `npm run dev` real. Un bug real de la UI en sí
(no del dominio) apareció y se corrigió en el camino: el `<option>` de
Proveedor no lleva el código como prefijo (a diferencia del de Producto),
la primera versión del smoke test asumía que sí.

### Testing — 68/68 verdes contra Postgres real (`test/movimientos/*.test.ts`)

- `registrar-movimiento.test.ts`: signo correcto por proceso (con test
  explícito de que Merma resta — el bug de Apps Script v2.1.0 no puede
  repetirse), Ajuste con delta ya firmado, sección obligatoria, bugfix C-1
  (2 líneas del mismo payload que juntas superan el stock, cada una por
  separado no), **2 requests concurrentes reales** que juntas
  sobre-venderían (solo una gana — prueba el aislamiento Serializable +
  reintento, no solo la agregación dentro de un payload), Transferencia
  entre 2 secciones sin cambiar el total global, factura duplicada
  rechazada, factor de conversión de unidad, reparto de consumo entre
  "hermanos" de un mismo Insumo, Producción de un insumo en consignación
  genera Consumo + Liquidación con `cantidad: 0`.
- `venta.test.ts`: rechaza vender algo que no es PV, Venta con receta
  consume la MP sin descontar el propio PV, un PV "Se produce" no vuelve a
  consumir su receta al venderse, consignación vía receta de Venta,
  Precio Local pisa/no pisa el global, rechaza si no alcanza el stock.
- `conteo-fisico.test.ts`: `AJUSTAR`/`FALTA_MOVIMIENTO`/`DESCARTAR`,
  diferencia 0 siempre `RESUELTO`, `resolverConteoPendiente` en sus dos
  variantes (incluida "ajustar contra el saldo de HOY, no el del día del
  conteo" con una Compra de por medio), `cancelarConteoFisico` revierte
  exacto y una segunda cancelación falla, cancelar algo que nunca ajustó
  también falla, `obtenerHistorialConteosFisicos` nunca mezcla conteos de
  dos sucursales distintas (bug encontrado escribiendo la UI, ver arriba).
- `secciones.test.ts`: alta, dedupe case/espacio-insensible, desactivar
  sin borrar.

### Verificación real (repetible)

1. `npx prisma migrate dev` — aplica todo el schema (Core+Catálogo+Movimientos)
   más los índices manuales, ya committeados como migraciones reales en
   `prisma/migrations/`.
2. `npm run db:seed` — seed limpio.
3. `npm test` — 68/68 verdes.
4. `npx tsc --noEmit`, `npx eslint`, `npx next build` — los tres limpios.
5. `npm run dev` + una sesión real (fila `Session` insertada a mano contra
   la estrategia `database` de Auth.js, sin depender de OAuth) + Chromium
   headless vía Playwright: Compra, Merma, Venta, Conteo Físico (con
   historial), Secciones y Precio Local — los 6 flujos completan y
   muestran el mensaje de éxito esperado en el DOM real.

Ver "Bugs de infraestructura encontrados y arreglados" (arriba, en
"Estado actual") para los dos fixes que hicieron falta en `src/lib/db.ts`
y `vitest.config.ts` antes de que esto corriera — ninguno específico de
Movimientos, afectaban a Core/Catálogo también.
6. Dos líneas del mismo payload pidiendo más del mismo producto+sección
   del que hay → rechazado ANTES de escribir nada (ninguna fila parcial
   en Kardex).
7. Suite de Vitest de esta porción verde (`npm test`).

---

## Plan de la porción Stock (código, tests, migración y UI completos y verdes)

Investigación (repo `motor`): las partes de `Stock.js` no leídas todavía
en la investigación de Movimientos —
`calcularStockConsolidado_`/`recalcularStockConsolidado` (Stock.js:692-829),
`calcularStockPorFamilia_`/`recalcularStockPorFamilia` (Stock.js:856-980),
`calcularAlertasStock_`/`recalcularAlertasStock`/`obtenerResumenAlertasStock`/
`notificarAlertasStockPorMail` (Stock.js:2210-2387) — más
`HOJA_STOCK_MINIMO`/`resolverStockMinimo_`/`setStockMinimoProducto_`
(Catalogo.js:1922-2019).

### Decisiones (resumen)

| Tema | Decisión | Por qué |
|---|---|---|
| Sin tablas de libro mayor nuevas | `StockConsolidado`/`StockFamilia`/`AlertasStock` son funciones de consulta en vivo (`src/core/stock/`), no modelos Prisma | En Apps Script eran hojas MATERIALIZADAS porque rescanear Kardex en cada lectura era proporcional a toda la historia acumulada — el mismo argumento que ya resolvió la porción Movimientos (`MovimientoStock` + índice real) aplica acá: Postgres agrega en tiempo real, no hace falta una segunda copia que se pueda desincronizar del Kardex. |
| `StockMinimoProducto` sí es tabla | Config real (el sistema no puede derivar un mínimo de ningún otro dato) — mismo patrón que `PrecioLocalProducto`: local a la sucursal, `seccionId` nulo = fila "global" de esa sucursal, con índice único parcial `(sucursalId, productoId) WHERE seccionId IS NULL` (mismo criterio que `CapacidadSucursal`). | Sin esto no hay nada contra qué comparar el saldo para las Alertas. |
| `RECLASIFICACION` al enum `Proceso` | Migración aditiva (`ALTER TYPE ... ADD VALUE`), ya anticipada en el comentario del schema desde la porción Movimientos | Es la primera porción que realmente investiga y necesita esta primitiva — agregarla antes hubiera sido diseñar Stock sin haberlo investigado todavía. |
| `reclasificarStock` sin Accion propia | Gateada con `proceso_control`, mismo permiso que Conteo Físico | Port fiel de Apps Script (Stock.js:1899-1905: "mismo permiso que Conteo Físico... no es un proceso propio con su propia entrada en `ACCION_POR_PROCESO_`"). |
| `ver_stock`, Accion NUEVA (no existía en Apps Script) | Gatea las 3 páginas de solo lectura (`/stock/consolidado`, `/stock/por-familia`, `/stock/alertas`), abierta a admin+operador | Hueco real de seguridad encontrado: en Apps Script estas 3 funciones no tenían NINGÚN gate propio, solo se ocultaban a nivel de menú de Sheets (no es una barrera real, la función seguía siendo client-callable). Acá SÍ hay una capa de permisos real — no tener una Accion hubiera sido repetir el hueco a propósito. |
| `AlertaStock` sin `proveedorUltimo` | Simplificación deliberada de esta primera versión | Requeriría un join adicional por fila solo para un dato informativo que ya está disponible en la comparativa de precios de Catálogo. |
| `notificarAlertasStockPorMail` no portado | Deferido — Accion `notificar_alertas` ya seedeada | Necesita un proveedor de mail real (Resend/SendGrid/...) configurado, que no existe en este proyecto todavía. No es una decisión de dominio, es una dependencia externa sin credenciales. |
| Último conteo válido | Se ignoran conteos `DESCARTADO`/`CANCELADO` al elegir "el último conteo físico" de una clave | Port exacto de Stock.js:706-714/BUGFIX A-1 (auditoría integral): un conteo cancelado no puede seguir contando como el conteo vigente para calcular el desvío. |

### Modelos (ya en `prisma/schema.prisma`)

`StockMinimoProducto` + `RECLASIFICACION` agregado al enum `Proceso` — ver
sus docstrings en el schema para el detalle completo. Migración:
`prisma/migrations/20260915084615_stock_porcion/`, con el índice único
parcial agregado a mano (mismo criterio que las migraciones anteriores).

### Algoritmos (implementados — `src/core/stock/`)

- **`calcularStockConsolidado`** (`consolidado.ts`, port de
  `calcularStockConsolidado_`, Stock.js:692-794): LEFT JOIN real contra el
  catálogo completo — todo producto elegible (MP, o PV "Se produce")
  aparece, tenga o no movimientos, tenga o no conteo (el bugfix que el
  propio Apps Script documenta: antes un producto recién dado de alta
  "desaparecía" del stock). Estado por fila: `NEGATIVO` > `CON_DESVIO` >
  `SIN_CONTEO` > `SIN_MOVIMIENTOS` > `CONCILIADO` (mismo orden de
  prioridad que Apps Script). "Diferencia" es la del ÚLTIMO conteo,
  congelada — no se recalcula contra el teórico de hoy (eso siempre daría
  0 después de un ajuste).
- **`calcularStockPorFamilia`** (`por-familia.ts`, port de
  `calcularStockPorFamilia_`, Stock.js:887-957): agrupa por Insumo
  ("Familia") + Sección, solo MP con Insumo asignado (un PV nunca se
  compra — sumarlo mezclaría ventas negativas con compras positivas, mismo
  bugfix que `resolverConsumoPorFamilia` en Movimientos). Reusa
  `textoCadenaDeGrupos` (ya construida en Catálogo) para el breadcrumb de
  Grupo. Marca `unidadesMezcladas` en vez de mostrar un total sumado sin
  sentido cuando dos productos del mismo Insumo tienen distinta unidad de
  stock.
- **`calcularAlertasStock`/`obtenerResumenAlertasStock`** (`alertas.ts`,
  port de `calcularAlertasStock_`/`obtenerResumenAlertasStock`,
  Stock.js:2255-2340): agrega TODO el saldo de un producto+sección
  (sumando todos los lotes — un lote chico por vencer no puede disparar
  una alerta falsa) y lo compara contra `resolverStockMinimo` (gana la
  fila de la sección exacta, si no la global de la sucursal). `CRITICO` si
  el saldo llegó a 0 o menos, `BAJO` si está en o por debajo del mínimo
  pero positivo, nada si está OK o sin mínimo configurado.
- **`resolverStockMinimo`** (`stock-minimo.ts`, port de
  `resolverStockMinimo_`, Catalogo.js:1968-1979): null (no 0) cuando no
  hay ninguna fila cargada — "sin mínimo" y "mínimo en 0" son cosas
  distintas.
- **`reclasificarStock`** (`src/server/actions/reclasificacion.ts`, port
  de `dividirClasificacionStock_`, Stock.js:1899-1991): 1 `Operacion`
  (`RECLASIFICACION`) con 1 línea de salida (todo el disponible del
  origen, negativo) + N líneas de entrada (una por destino) — la suma de
  los destinos tiene que coincidir EXACTO con el disponible (ni de más ni
  de menos), leído dentro de la transacción Serializable (mismo criterio
  de concurrencia que el resto de Movimientos).

### Server actions (implementadas)

- **`reclasificarStock`** (`src/server/actions/reclasificacion.ts`) →
  `proceso_control`.
- **`setStockMinimoProducto`/`eliminarStockMinimo`/`listarStockMinimo`**
  (`src/server/actions/stock-minimo.ts`) → `stock_minimo`.
- Las 3 vistas de solo lectura (`calcularStockConsolidado`/
  `calcularStockPorFamilia`/`calcularAlertasStock`) se importan directo
  desde `src/core/stock/` en cada `page.tsx` (mismo precedente que
  `textoCadenaDeGrupos` en `/catalogo/insumos-grupos`) — no necesitan un
  wrapper en `server/actions/` porque no son mutaciones ni se llaman desde
  un componente cliente.

### UI (implementada, `src/app/stock/`)

- **`consolidado/`, `por-familia/`, `alertas/`**: páginas de solo lectura
  (server component, sin interactividad), gateadas con `ver_stock`.
- **`minimo/`**: CRUD (form + tabla + eliminar), mismo patrón que
  `/movimientos/precio-local`.
- **`reclasificar/`**: form con lista dinámica de destinos (agregar/quitar
  filas), mismo patrón de los paneles de Movimientos.

Verificado en un navegador real (Chromium vía Playwright, sesión de base
de datos real): Compra → Conteo Físico con diferencia → Consolidado
muestra `CON_DESVIO` → Por Familia agrupa el Insumo → fijar Stock Mínimo
por encima del saldo → Alertas lo detecta como `BAJO` → Reclasificar mueve
el saldo entero a otra sección — los 7 pasos completan contra el DOM real.

### Testing — 94/94 verdes contra Postgres real (`test/stock/*.test.ts`, 26 nuevos)

- `consolidado.test.ts`: cada estado (`SIN_MOVIMIENTOS`, `SIN_CONTEO`,
  `CONCILIADO`, `CON_DESVIO`, `NEGATIVO` — este último vendiendo de más un
  PV "Se produce", el único camino real para llegar a negativo ya que
  Ajuste/Merma/Consumo/Transferencia siempre validan stock suficiente),
  un conteo `DESCARTADO` no cuenta como el último válido, un PV normal
  (no "Se produce") nunca aparece.
- `por-familia.test.ts`: agrupa 2 productos del mismo Insumo, uno sin
  Insumo queda afuera, `unidadesMezcladas` se detecta, `grupoCadena` se
  arma bien con 2 niveles.
- `alertas.test.ts`: sin mínimo nunca alerta, `BAJO` vs. sin alerta según
  el mínimo, Merma que deja el saldo en 0 dispara `CRITICO`, el mínimo por
  sección gana sobre el global, `obtenerResumenAlertasStock` cuenta
  críticos/bajos por separado.
- `reclasificacion.test.ts`: reparto exacto entre 2 destinos (el origen
  queda en 0, el total global no cambia), rechaza si la suma no coincide
  exacto (de más o de menos, sin escribir nada), rechaza sin saldo
  disponible, reclasifica por lote puntual sin tocar otros lotes del mismo
  producto+sección.
- `stock-minimo.test.ts`: sin fila da `null` (no 0), fija global y se
  resuelve para cualquier sección, una fila por sección gana sobre la
  global, volver a fijar el global actualiza (no duplica), eliminar saca
  la fila.

### Verificación de la porción Stock

1. `npx prisma migrate dev` aplica `RECLASIFICACION` + `StockMinimoProducto`
   sin romper Core/Catálogo/Movimientos ya existentes.
2. Compra sin conteo físico todavía → `SIN_CONTEO` en Consolidado; conteo
   sin diferencia → `CONCILIADO`; con diferencia → `CON_DESVIO` con el
   valor exacto.
3. Dos productos del mismo Insumo en la misma sección → Por Familia suma
   ambos saldos bajo una sola fila.
4. Saldo por debajo del Stock Mínimo (sección o global) → aparece en
   Alertas con el estado correcto (`CRITICO`/`BAJO`); por encima, no
   aparece.
5. Reclasificar con la suma de destinos distinta al disponible → rechazado
   sin escribir nada; exacta → el saldo se mueve entero, total global sin
   cambios.
6. Suite de Vitest de esta porción verde (`npm test`).

---

## Plan de la porción Reportes (código, tests, migración y UI completos y verdes)

### Decisiones (resumen)

| Pregunta | Decisión | Por qué |
|---|---|---|
| ¿Nueva tabla de libro mayor? | No, ninguna | `MovimientoStock`/`Operacion`/`ConteoFisico` (Movimientos) ya tienen todo lo que estos 19 reportes necesitan — mismo argumento que ya cerró Stock: agregar aquí sería duplicar datos que Postgres puede agregar en tiempo real. |
| Promociones y Combos | `PromocionProducto` (sucursalId+productoId+activa) + `Sucursal.promocionesHabilitadas` | Único dato real que el sistema no puede derivar: qué PV es "promoción" es una decisión LOCAL de cada sucursal (Catalogo.js:2170-2173), no del Catálogo Central. |
| Gate de acceso de las páginas | Ninguna Accion nueva — solo `obtenerContextoUsuario()` | `WebApp.js:26-28` documenta `accion: null` para Consultar/Alertas/Conteo/Trazabilidad como DELIBERADO ("abierta a cualquier Editor"), a diferencia del hueco real sin ningún gate que sí motivó agregar `ver_stock` en la porción Stock. |
| Excepción al gate anterior | `insumos_mezclados` (admin-only) sigue exigido dentro de Huecos de catálogo | Es el único sub-reporte que en Apps Script SÍ tenía `requierePermiso_` propio (hallazgo de auditoría, Reportes.js:857-863) — se respeta tal cual. |
| Costo de reposición | Lee `MovimientoStock` filtrado por `sucursalId` (nunca `ProveedorPorProducto`) | Mismo criterio que ya fijó la porción Stock/Catálogo: `ProveedorPorProducto` es Catálogo Central compartido por todas las sucursales — usarlo para costear mezclaría precios de otra sucursal (bug real que Apps Script ya había tenido que corregir, Reportes.js:1652-1663). |
| `MotivoMerma`/`DestinoConsumo` en Pérdidas | Se agrupa directo por la columna tipada de `Operacion` | Apps Script necesitaba parsear "Proceso: Motivo — libre" con una regex porque el motivo vivía plegado en el texto del detalle; acá ya es una columna enum real desde la porción Movimientos. |
| Consignante de una Liquidación | `Producto.proveedorConsignacionId` (nunca `Operacion.proveedorId`) | `Operacion.proveedorId` de una Venta es "a quién se le vende" (el cliente), compartido por TODAS las líneas de esa venta (consumo + liquidación incluidos) — el consignante real es un dato fijo del producto, no de la operación puntual. Bug real encontrado y corregido antes de commitear (ver tests de `consignacion.test.ts`). |
| Cantidad en reportes de período | `Math.abs(cantidad)` para procesos de signo fijo, delta firmado tal cual para Ajuste/Control/Transferencia (`esSignoFijo`, ya existía en `transiciones.ts`) | `MovimientoStock.cantidad` viene SIEMPRE firmado (decisión de Movimientos) — multiplicar una venta por su cantidad firmada (negativa) da un total de ventas negativo. Bug real encontrado por los tests antes de llegar a la UI. |
| Rango de fechas de un período | `setUTCHours` en vez de `setHours` | Los `Date` "de solo día" que llegan del cliente (`new Date('yyyy-MM-dd')`) son SIEMPRE medianoche UTC, sin importar la TZ del navegador — comparar el límite del rango en UTC evita el mismo bug de día corrido que Apps Script documentó y corrigió con `parsearFechaLocal_` (acá no hace falta ese helper: no hay ningún string que reparsear del lado del servidor). |

### Modelos (ya aplicados en `motor2/prisma/schema.prisma`, migración `20260915095511_reportes_porcion`)

```prisma
model PromocionProducto {
  id         String   @id @default(cuid())
  sucursalId String
  sucursal   Sucursal @relation(fields: [sucursalId], references: [id])
  productoId String
  producto   Producto @relation(fields: [productoId], references: [id])
  activa     Boolean  @default(true)

  @@unique([sucursalId, productoId])
}
```

Más `Sucursal.promocionesHabilitadas Boolean @default(false)` (una columna,
no un modelo aparte — es el apagador general de la feature).

### Algoritmos (con ancla `archivo:línea` de Apps Script)

- `obtenerReportePorPeriodo` (Reportes.js:30-109) → `src/core/reportes/periodo.ts`.
  1 query a `MovimientoStock` (join `Operacion`+`Seccion`) filtrada por
  sucursal+fecha+filtros opcionales, en vez de rescanear la hoja completa.
- `calcularVentasDelPeriodo_`/`calcularComprasDelPeriodo_`/
  `calcularMargenDelPeriodo_` (Reportes.js:128-352) → mismo archivo. El
  precio de venta "vigente" para estimar ventas viejas sale de
  `construirMapaProductos` (`comun.ts`), que YA resuelve Precio Local
  (mismo criterio que `construirMapaProductosConTipo_` original, que
  también llamaba a `resolverPrecioVenta_` internamente — no es el precio
  global crudo).
- `generarReporteVentasPorCategoria` (Reportes.js:243-283) → reusa
  `calcularVentasDelPeriodo` en vez de reimplementar real-vs-estimado.
- `obtenerCostoActualPorMP_`/`calcularCostosYMargenes_`/
  `calcularImpactoInsumos_` (Reportes.js:1645-1818) →
  `src/core/reportes/{comun,costos}.ts`. "Última compra, no la más
  barata" — mismo criterio, ahora sobre `MovimientoStock` en vez de
  `ProveedoresPorProducto`.
- `obtenerReportePromociones_` (Reportes.js:373-458) →
  `src/core/reportes/promociones.ts`. Habilitado/marcado leen
  `PromocionProducto`/`Sucursal.promocionesHabilitadas` en vez de la hoja
  local "Promociones"/Config.
- `generarReporteLotesProximosAVencer_`/`generarConciliacionVencimientos_`
  (Reportes.js:573-680) → `src/core/reportes/vencimientos.ts`. La
  conciliación compara, sección por sección, conteos POR LOTE de días
  consecutivos — mismo algoritmo, ahora sobre filas de `ConteoFisico` con
  FK reales en vez de un `Map` armado a mano desde la hoja de conteos.
- `generarReporteDiferenciasAjustes_` (Reportes.js:724-805) →
  `diferencias-ajustes.ts`. Grupo a (sin receta, tolerancia 0) vs grupo b
  (solo receta, diferencia esperable) — igual, con `AJUSTE`/`CONTROL` ya
  separados por columna tipada desde el día uno (acá nunca existió el bug
  de sumarlos juntos que el propio Apps Script documenta haber corregido).
- `generarReporteInsumosSinRecetaVinculada_`/`generarReporteHuecosCatalogo_`
  (Reportes.js:826-894) → `insumos-sin-receta.ts`/`huecos-catalogo.ts`.
  "Unidad mezclada" se separó en `obtenerProblemasUnidadMezclada` (sin
  gate propio — el gate `insumos_mezclados` se aplica en la página) para
  no mezclar una función agnóstica de permiso con un chequeo de rol.
- `generarReporteSaludPorProducto_` (Reportes.js:918-979) →
  `salud-por-producto.ts`. Cruce puro de los 4 reportes ya existentes
  (Consolidado/Alertas/Diferencias/Sin-receta), sin lógica de negocio
  nueva — igual que el original.
- `generarReporteConsignacion_` (Reportes.js:993-1028) → `consignacion.ts`.
  Ver la fila de la tabla de decisiones arriba (consignante = del
  Producto, no de la Operacion de Venta).
- `generarReporteVentasSinReceta_` (Reportes.js:1063-1112) →
  `ventas-sin-receta.ts`. "¿Esta venta generó consumo?" se resuelve con
  `MovimientoStock.operacionId` real (cada venta es su propia `Operacion`,
  ver `registrarVenta`) en vez de comparar el string "ID Operación".
- `obtenerOperacionPorId`/`buscarOperacionesPorProducto` (Reportes.js:
  1133-1197) → `trazabilidad.ts`. `obtenerOperacionPorId` se acota a
  `sucursalId` a propósito — huella nueva respecto a Apps Script (donde
  cada hostería ya era un spreadsheet separado, así que "adivinar" un ID
  de otra hostería ni siquiera era posible).
- `obtenerHistorialProducto` (Reportes.js:1241-1331) →
  `historial-producto.ts`. El saldo corriente ya no necesita
  `signoDeProceso_`/`esDeltaConSignoLibre_` para reconstruir el signo al
  leer — `cantidad` ya viene firmada, así que es una suma acumulada
  directa en orden cronológico.
- `generarReportePerdidas_`/`generarReporteDevoluciones_` (Reportes.js:
  1832-2012) → `perdidas.ts`/`devoluciones.ts`. Agrupan directo por
  `Operacion.motivo`/`.destino` (columnas enum tipadas) en vez de parsear
  el texto del detalle con una regex.
- `obtenerResumenOperativo`/`obtenerResumenFinancieroMesActual_`
  (Reportes.js:1460-1528) → `resumen-operativo.ts`. Dashboard: reusa
  `obtenerResumenAlertasStock` (Stock) y `obtenerReportePorPeriodo`
  acotado al mes calendario actual.
- `obtenerDatosConsulta`/`VISTAS_WEBAPP_` (Reportes.js:2027-2094,
  WebApp.js:33-100) → no se portó como un único dispatcher: cada vista es
  su propia ruta bajo `/reportes/*` (mismo patrón de ruteo que ya usa Next
  App Router para el resto del proyecto — un dispatcher central tenía
  sentido en Apps Script porque HtmlService solo podía servir UN archivo
  por request).

### Server actions/funciones (`src/core/reportes/*.ts`, agnósticas de permiso; `src/server/actions/promociones.ts`, gateado)

`obtenerReportePorPeriodo`, `generarReporteVentasPorCategoria`,
`resumenPeriodicoPorProceso`, `calcularCostosYMargenes`,
`calcularImpactoInsumos`, `obtenerReportePromociones`,
`generarReporteLotesProximosAVencer`, `generarConciliacionVencimientos`,
`obtenerReporteVencimientosDatos`, `generarReporteDiferenciasAjustes`,
`generarReporteInsumosSinRecetaVinculada`, `generarReporteHuecosCatalogo`,
`obtenerProblemasUnidadMezclada`, `generarReporteSaludPorProducto`,
`generarReporteConsignacion`, `generarReporteVentasSinReceta`,
`obtenerOperacionPorId`, `buscarOperacionesPorProducto`,
`obtenerHistorialProducto`, `buscarProductoParaHistorial`,
`generarReportePerdidas`, `generarReporteDevoluciones`,
`obtenerResumenOperativo`, `obtenerResumenFinancieroMesActual`. Más
`actualizarPromocionesHabilitado`/`marcarProductoComoPromocion`/
`buscarProductoParaPromocion` (gateadas `promociones_config`) y la
reutilización directa de `obtenerHistorialConteosFisicos` (Movimientos)
para la vista "Conteos físicos".

### UI (17 páginas bajo `/reportes/*` + layout con nav propio)

`/reportes` (resumen/dashboard), `/reportes/periodo`,
`/reportes/categorias`, `/reportes/costos`, `/reportes/promociones` (+
`promocion-form.tsx`, cliente), `/reportes/perdidas`,
`/reportes/devoluciones`, `/reportes/vencimientos`,
`/reportes/diferencias`, `/reportes/sin-receta`,
`/reportes/insumos-sin-receta`, `/reportes/consignacion`,
`/reportes/salud`, `/reportes/huecos-catalogo`, `/reportes/conteos`,
`/reportes/historial`, `/reportes/trazabilidad`. Filtros de
fecha/días/producto/sección vía `<form>` GET + `searchParams` en Server
Components (sin cliente) — único componente cliente real:
`promocion-form.tsx` (togglear la feature + marcar productos, mismo
patrón de `useTransition` que `/stock/minimo`).

### Testing (Vitest, spec de negocio — no el harness de Apps Script)

134 tests en total (40 nuevos de esta porción, `test/reportes/`):

- `periodo.test.ts`: no se corre un día por timezone (límite UTC exacto),
  ventas reales vs. estimadas al precio vigente (con Precio Local
  resuelto), compras agrupadas por proveedor con aviso de "sin precio",
  margen marca `costoIncompleto` sin inventar un número, ventas por
  categoría agrupa y detecta PV sin categoría.
- `costos.test.ts`: usa la ÚLTIMA compra (no la más barata), marca
  costoIncompleto por insumo faltante, aplica la Merma % de la receta,
  lee el Kardex LOCAL de la sucursal (nunca el de otra), impacto de
  insumos acumula a través de varios platos.
- `promociones.test.ts`: apagada por defecto, ambas mutaciones requieren
  admin, separa facturación Promoción/Combo vs. a la carta y calcula el
  valor a la carta con el precio de venta individual de cada insumo.
- `vencimientos.test.ts`: filtra por días e incluye ya vencidos,
  conciliación detecta consistente vs. revisar.
- `diferencias-ajustes.test.ts`: clasifica grupo a/b con estado distinto,
  separa Ajuste de Conteo Físico sin mezclarlos, OK sin diferencia real.
- `insumos-sin-receta.test.ts`: detecta la huérfana y excluye la
  vinculada, marca `tieneProveedor` correcto.
- `huecos-catalogo.test.ts`: PV sin venta nunca, MP con receta sin
  proveedor, unidad mezclada respeta el permiso (operador no puede verla).
- `salud-por-producto.test.ts`: sin receta vinculada dispara Atención
  aunque los otros 3 ejes estén bien, OK cuando los 4 ejes están bien.
- `consignacion.test.ts`: debido por consignante y stock sin vender.
- `ventas-sin-receta.test.ts`: detecta el corte (con receta no aparece).
- `trazabilidad.test.ts`: trae los movimientos de la operación, nunca la
  de otra sucursal; búsqueda por nombre o código sin duplicar operación.
- `historial-producto.test.ts`: saldo corriente acumulado + conteos
  mergeados en la línea de tiempo, `desde`/`hasta` solo recorta qué se
  MUESTRA (el saldo sigue arrancando del primer movimiento real).
- `perdidas.test.ts`: agrupa por motivo tipado y valoriza, no inventa el
  costo sin compra registrada, separa consumo manual de consumo
  automático por receta.
- `devoluciones.test.ts`: cliente agrupado por producto, proveedor
  agrupado por proveedor.
- `resumen-operativo.test.ts`: cuenta combinaciones con movimientos,
  detecta negativos, trae el financiero del mes actual.

### Verificación de la porción Reportes

1. `npx prisma migrate dev` aplica `PromocionProducto` +
   `Sucursal.promocionesHabilitadas` sin romper nada de lo existente.
2. Venta con Precio Total real vs. una venta vieja sin precio guardado →
   la segunda se estima al precio vigente y queda marcada `estimado`, sin
   mezclarse con el importe real de la primera.
3. Una Merma con motivo `VENCIDO` aparece agrupada por ese motivo exacto
   en Pérdidas, valorizada al costo de reposición LOCAL.
4. Dos conteos físicos consecutivos del mismo lote (uno con saldo, el
   siguiente en 0) sin que las ventas+consumos del período lo expliquen →
   Vencimientos > Conciliación lo marca "revisar".
5. Activar Promociones y marcar un PV con receta → el reporte separa su
   facturación de la venta a la carta y calcula el valor a la carta con el
   precio de venta individual de cada insumo.
6. Suite de Vitest de esta porción verde (`npm test`, 134/134).
7. `npm run dev` + Chromium headless vía Playwright: 17 páginas de
   `/reportes/*` cargan con datos reales sin errores de runtime, más las
   2 mutaciones de Promociones (activar/marcar) ejercitadas clic a clic
   contra el DOM real.

---

## Plan de la porción Traspasos entre sucursales (código, tests, migración y UI completos y verdes)

### Decisiones (resumen)

| Pregunta | Decisión | Por qué |
|---|---|---|
| ¿Registro de "hosterías" (`Hosterias`) + nombre configurable (`NombreHosteria`)? | No se porta | Existían solo porque cada sucursal es un proyecto Apps Script separado sin forma de saber "quién es" ni de ver a las demás — acá `Sucursal` ya es una tabla real y compartida (Core), y `ContextoUsuario.sucursalId` ya identifica "quién soy" en cada request. |
| ¿"Bandeja" como tabla intermedia de mensajería async? | Se porta como tabla de ESTADO (`TraspasoSucursal`), no de mensajería | En Apps Script `TraspasosSucursales` existe porque no hay canal de ejecución entre proyectos — acá ambos lados ya comparten la misma base, así que la tabla es simplemente el registro del traspaso (con su estado), no un buzón que haya que "revisar" de forma asincrónica. |
| ¿Capacidades por sucursal (segunda mitad de `Sucursales.js`)? | Ya estaba — no se toca | `CapacidadSucursal`/`capacidades_sucursal`/`/administracion/capacidades-sucursal` se implementaron enteros en la porción Core. |
| Claves de sucursal/producto en la fila del traspaso | FKs reales (`origenSucursalId`/`destinoSucursalId`/`productoId`), nunca texto | Apps Script comparaba nombres de hostería como texto (`mismoTexto_`) porque no tenía otra forma — acá hay una FK real disponible. |
| Correlación Kardex ↔ Traspaso | `MovimientoStock.traspasoSucursalId` (FK real, nullable) | Reemplaza "ID Operación === ID Traspaso" (Sucursales.js:204-213, un UUID compartido a ciegas entre dos tablas) — mismo criterio que `conteoFisicoId` en la porción Movimientos. |
| ¿Los 3 procesos nuevos pasan por `registrarMovimiento`? | No — server action propio (`traspasos.ts`), como Reclasificación | Cada paso del workflow recién conoce su `seccionId` EN ESE paso (Origen la elige al aprobar/enviar, Destino al aceptar) — no hay un único "armar línea" genérico que sirva para los 3. La entrada en `TRANSICIONES` existe solo para `esSignoFijo`/`tieneStockReal`. |
| Gate de acceso | `proceso_transferencia_sucursal` (ya seedeada desde Core) | Sin Accion nueva — Apps Script ya gateaba las 7 funciones de escritura con esta misma clave; la lectura de la Bandeja queda abierta (`obtenerBandejaTransferencias` sin gate), mismo criterio que el resto del proyecto. |

### Modelos (ya aplicados en `motor2/prisma/schema.prisma`, migración `20260915104139_traspasos_sucursal`)

```prisma
enum IniciadoPorTraspaso {
  ORIGEN
  DESTINO
}

enum EstadoTraspaso {
  SOLICITADA
  ENVIADA
  ACEPTADA
  RECHAZADA_ORIGEN
  RECHAZADA_DESTINO
  CERRADA
}

model TraspasoSucursal {
  id       String   @id @default(cuid())
  creadoEn DateTime @default(now())

  origenSucursalId  String
  origenSucursal    Sucursal @relation("TraspasoOrigen", fields: [origenSucursalId], references: [id])
  destinoSucursalId String
  destinoSucursal   Sucursal @relation("TraspasoDestino", fields: [destinoSucursalId], references: [id])

  productoId String
  producto   Producto @relation(fields: [productoId], references: [id])
  cantidad   Decimal  @db.Decimal(14, 4)

  seccionOrigenId  String?
  seccionOrigen    Seccion? @relation("TraspasoSeccionOrigen", fields: [seccionOrigenId], references: [id])
  seccionDestinoId String?
  seccionDestino   Seccion? @relation("TraspasoSeccionDestino", fields: [seccionDestinoId], references: [id])

  iniciadoPor IniciadoPorTraspaso
  estado      EstadoTraspaso      @default(SOLICITADA)

  creadoPorId String
  creadoPor   User    @relation("TraspasoCreadoPor", fields: [creadoPorId], references: [id])
  detalle     String?

  fechaDecisionOrigen  DateTime?
  decididoPorOrigenId  String?
  decididoPorOrigen    User?     @relation("TraspasoDecididoOrigen", fields: [decididoPorOrigenId], references: [id])
  motivoRechazoOrigen  String?

  fechaDecisionDestino DateTime?
  decididoPorDestinoId String?
  decididoPorDestino   User?     @relation("TraspasoDecididoDestino", fields: [decididoPorDestinoId], references: [id])
  motivoRechazoDestino String?

  fechaCierre  DateTime?
  cerradoPorId String?
  cerradoPor   User?     @relation("TraspasoCerradoPor", fields: [cerradoPorId], references: [id])

  movimientos MovimientoStock[]
}
```

Más 3 valores nuevos en `Proceso` (`TRANSFERENCIA_SALIDA_SUCURSAL`/
`TRANSFERENCIA_ENTRADA_SUCURSAL`/`REINGRESO_TRANSFERENCIA_SUCURSAL`,
migración aditiva) y `MovimientoStock.traspasoSucursalId String?` (FK
nullable, `ON DELETE SET NULL`).

### Algoritmos (con ancla `archivo:línea` de Apps Script)

- `crearSolicitudTransferencia`/PULL (Sucursales.js:243-277) → no toca
  stock, solo valida (producto transferible, sección propia elegida,
  sucursal origen distinta de la propia) y crea la fila en `SOLICITADA`.
- `crearEnvioDirectoTransferencia`/PUSH (Sucursales.js:280-323) → valida
  stock suficiente y escribe `TRANSFERENCIA_SALIDA_SUCURSAL` (signo −1) en
  la MISMA transacción serializable que crea la fila ya en `ENVIADA` (con
  `fechaDecisionOrigen`/`decididoPorOrigenId` llenos desde el arranque:
  Origen ya decidió mandar).
- `aprobarYEnviarTransferencia` (Sucursales.js:337-378) → re-valida stock
  DENTRO de la transacción (Serializable aborta si cambió mientras tanto,
  mismo criterio que Reclasificación), escribe
  `TRANSFERENCIA_SALIDA_SUCURSAL`, pasa `SOLICITADA` → `ENVIADA`.
- `rechazarSolicitudTransferencia` (Sucursales.js:381-403) → nunca tocó
  stock, pasa `SOLICITADA` → `RECHAZADA_ORIGEN`.
- `aceptarTransferencia` (Sucursales.js:406-438) → escribe
  `TRANSFERENCIA_ENTRADA_SUCURSAL` (signo +1), pasa `ENVIADA` → `ACEPTADA`.
- `rechazarTransferencia` (Sucursales.js:441-463) → todavía NO devuelve el
  stock (sigue "afuera" en los libros de Origen) — pasa `ENVIADA` →
  `RECHAZADA_DESTINO`, pendiente de que Origen confirme el reingreso.
- `confirmarReingresoTransferencia` (Sucursales.js:466-496) → escribe
  `REINGRESO_TRANSFERENCIA_SUCURSAL` (signo +1) en la sección de origen ya
  guardada, pasa `RECHAZADA_DESTINO` → `CERRADA`.
- `obtenerBandejaTransferencias` (Sucursales.js:498-534) → filtra por
  `origenSucursalId`/`destinoSucursalId` en vez de comparar nombres de
  hostería como texto; separa `paraAprobar`/`paraAceptar`/`paraReingreso`
  del resto (`historial`).
- `obtenerHosteriasDisponibles` (Sucursales.js:161-171) → reemplazado por
  `listarSucursalesDisponibles` (simplemente `Sucursal` activas ≠ la
  propia, sin ningún registro que mantener sincronizado).

### Server actions (`src/server/actions/traspasos.ts`)

`crearSolicitudTransferencia`, `crearEnvioDirectoTransferencia`,
`aprobarYEnviarTransferencia`, `rechazarSolicitudTransferencia`,
`aceptarTransferencia`, `rechazarTransferencia`,
`confirmarReingresoTransferencia` (las 7 gateadas
`proceso_transferencia_sucursal`), `obtenerBandejaTransferencias` y
`listarSucursalesDisponibles` (lectura, sin gate).

### UI (3 páginas bajo `/traspasos/*` + layout con nav propio)

`/traspasos` (Bandeja: 3 secciones accionables con formularios inline —
elegir sección propia + botón de aprobar/aceptar, motivo + botón de
rechazar, o un botón simple de confirmar reingreso — más la tabla de
historial), `/traspasos/solicitar` (PULL) y `/traspasos/enviar` (PUSH),
cada uno con su propio form cliente (mismo patrón `useTransition` +
`router.refresh()` que el resto del proyecto).

### Testing (Vitest, spec de negocio — no el harness de Apps Script)

141 tests en total (7 nuevos, `test/traspasos/traspasos.test.ts`, dos
sucursales reales con un admin cada una para simular ambos lados):

- Flujo pull completo: B solicita a A (stock de A intacto), A aprueba
  (sale de la Sección Origen, todavía nada en destino), B acepta (entra a
  la Sección Destino).
- Flujo push completo: A envía directo a B (sale YA al crear el envío), B
  acepta.
- Rechazo de destino + reingreso devuelve el stock EXACTO a como estaba.
- Rechazo de una Solicitud por Origen no toca stock (nunca salió).
- El lado equivocado no puede accionar (Destino no puede aprobar una
  Solicitada; Origen no puede aceptar una Solicitada).
- Mismo criterio abierto que el resto de "proceso_*": un operador puede
  solicitar una transferencia por defecto.
- `obtenerBandejaTransferencias` separa correctamente lo que hay que
  accionar del historial, para cada lado de la transacción.

### Verificación de la porción Traspasos

1. `npx prisma migrate dev` aplica `TraspasoSucursal` + los 3 procesos
   nuevos sin romper nada de lo existente.
2. Flujo PULL completo (solicitar → aprobar → aceptar) mueve el stock
   exacto de la sección de Origen a la sección de Destino, sin tocar nada
   hasta que cada lado decide.
3. Flujo PUSH completo (enviar directo → aceptar) descuenta el stock YA al
   enviar, antes de que Destino haga nada.
4. Rechazo de Destino + reingreso de Origen devuelve el saldo EXACTO a
   como estaba antes del envío.
5. El lado equivocado nunca puede accionar (verificado con ambos guard
   rails).
6. Suite de Vitest de esta porción verde (`npm test`, 141/141).
7. `npm run dev` + Chromium headless vía Playwright con DOS sesiones de
   navegador simultáneas (una por sucursal, cookies distintas): ciclo PULL
   completo y ciclo PUSH completo (con rechazo + reingreso) ejercitados
   clic a clic contra el DOM real de ambos lados, con el saldo final
   verificado contra el Kardex real (no solo lo que mostraba la UI): A
   30 → 25, B → 5.


## Post-migración: valuación de inventario y paginación (fuera del alcance de una porción — hallazgos de una diligencia técnica)

Después de completar las 6 porciones funcionales se corrió una diligencia
técnica comparando motor2 contra ERPNext y Dolibarr (agentes/skills de
auditoría ERP, no parte del plan original). Dos hallazgos se priorizaron
para resolver de inmediato; el resto queda en el expediente de esa
diligencia, no acá.

### Corrección al propio hallazgo de "costeo"

La diligencia inicial decía "no hay costeo" — inexacto: `src/core/
reportes/costos.ts` (porción Reportes) ya calcula margen/food-cost por
receta con costo de reposición (última compra local, `obtenerCostoActualPorMP`
en `comun.ts`) — una decisión de negocio documentada más arriba en este
plan ("Costo de reposición… última compra, no la más barata"), no un
método PMP/FIFO. Lo que realmente faltaba era una **valuación total de
inventario** (cuánto vale el stock hoy), no un método de costeo nuevo.

### Valuación de inventario (`src/core/reportes/valuacion.ts`, nuevo)

`calcularValuacionInventario(sucursalId)` reutiliza el mismo costo de
reposición de Costos y márgenes, agregado por producto en vez de por
receta: `saldo actual (groupBy sobre MovimientoStock) × costoUnitario`.
Mismo criterio que ya fijó `calcularCostosYMargenes`: un producto con
stock pero sin ninguna compra registrada queda `sinCosto` y afuera del
total — no se inventa un valor. UI en `/reportes/valuacion`. 4 tests
nuevos (`test/reportes/valuacion.test.ts`) contra Postgres real, incl. que
lee el costo LOCAL de la sucursal (no el de otra).

### Paginación (hallazgo verificado: catálogo/listados sin límite real)

- **`listarProductos()` (sin límite, usado en 9 `<select>` distintos)** →
  reemplazado por `buscarProductosSelector` (búsqueda server-side, tope
  20) + el componente `<SelectorProducto>` (`src/components/
  selector-producto.tsx`, combobox con debounce de 250ms) en los 9 puntos
  que antes recibían el catálogo entero como prop: Venta, panel genérico
  de Movimientos, Conteo físico, Traspasos (enviar/solicitar),
  Reclasificar, Stock mínimo, Precio local, Historial de un producto.
- **`/catalogo/productos` (tabla de administración)** → paginado por
  cursor real (`listarProductosPagina`, 50 por página) + buscador, en vez
  de traer el catálogo completo en cada carga.
- **`obtenerHistorialConteosFisicos` (tope fijo `take: 200`, sin forma de
  ver conteos más viejos)** → paginado por cursor real (50 por página) en
  `/reportes/conteos`; `/movimientos/conteo-fisico` sigue mostrando solo
  la primera página como "reciente".
- **`obtenerBandejaTransferencias` (sin ningún límite — crecía para
  siempre con cada traspaso)** → separado en dos queries: lo "en curso"
  (para aprobar/aceptar/reingreso) sigue sin límite a propósito, por
  diseño de negocio nunca crece; el historial de traspasos cerrados ahora
  pagina por cursor (30 por página).
- `historial-producto.ts` (eventos de un producto puntual) queda
  deliberadamente sin paginar en esta pasada: el saldo corriente se
  calcula sumando el historial completo desde el primer movimiento real,
  así que paginar solo la lista visible sin tocar ese cálculo pedía más
  diseño del que ameritaba esta pasada — señalado para una próxima, no
  resuelto a las apuradas.

### Testing y verificación

- 147/147 tests de Vitest verdes contra Postgres real (145 + 2 nuevos:
  paginación por cursor de `obtenerBandejaTransferencias` y de
  `obtenerHistorialConteosFisicos`, además de los 4 de valuación).
- `npx tsc --noEmit` limpio.
- `npm run dev` + Chromium headless vía Playwright (paquete instalado
  ad-hoc con `--no-save`, no queda en `package.json`): 17 verificaciones
  contra el DOM real con datos sembrados a propósito (65 productos para
  forzar la paginación del catálogo, un producto con stock sin compra
  para la sección "sin costo" de Valuación, conteos y traspasos de
  prueba) — título y total de Valuación, paginación de catálogo (50 +
  16), búsqueda por texto, el combobox de producto (busca, resalta,
  elige, cierra, deja el `productoId` real en un input oculto), Conteos y
  la Bandeja de Traspasos. Sesión autenticada saltando el login real de
  Google (imposible en este entorno): fila de `Session` creada a mano con
  `sessionToken` conocido e inyectada como cookie `authjs.session-token`
  en el contexto de Playwright — mismo mecanismo que usa Auth.js v5 con
  estrategia de sesión en base de datos, sin tocar el flujo de OAuth real.
