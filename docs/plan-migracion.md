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

### Porción Movimientos — CÓDIGO Y TESTS COMPLETOS Y VERDES (falta UI)

Investigación completa de `Movimientos.js`/`Stock.js`/`Sucursales.js` (repo
`motor`) — ver la sección íntegra más abajo, "Plan de la porción
Movimientos", para las decisiones con ancla `archivo:línea`. A diferencia
de Core/Catálogo, esta porción se implementó Y SE VERIFICÓ de punta a
punta contra Postgres real en la misma sesión (ver "Verificación real"
más abajo) — no quedó solo "escrita sin correr".

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
- A propósito el schema todavía NO incluye `RECLASIFICACIÓN` (primitiva de
  Stock, nunca pasa por TRANSICIONES) ni los 3 procesos de transferencia
  entre sucursales (`TRANSFERENCIA_SALIDA/ENTRADA_SUCURSAL`,
  `REINGRESO_TRANSFERENCIA_SUCURSAL` — porción Traspasos): agregar un valor
  a un enum de Postgres es aditivo y trivial: se agregan cuando esas
  porciones se investiguen de verdad, no antes.

Server actions escritas: `registrarMovimiento` (motor genérico para los 9
procesos que lo comparten), `registrarVenta`, `registrarConteoFisico`/
`resolverConteoPendiente`/`cancelarConteoFisico`, CRUD de `Seccion` y de
`PrecioLocalProducto`. 67 tests de Vitest, todos verdes.

Falta (próxima sesión): la UI de carga (paneles guiados, wizard de Compra
por proveedor, Conteo Físico) — ver la sección completa más abajo, "UI
prevista".

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

Con los dos fixes, **la suite completa (Core + Catálogo + Movimientos, 67
tests) corre verde contra un Postgres real** — la primera vez que esto pasa
en el proyecto. Ver "Verificación real" más abajo para cómo reproducirlo.

### Verificación real (esta sesión, Postgres 16 local)

1. `npx prisma migrate dev` — corrió limpio, generó
   `prisma/migrations/20260915034059_init/` (todo el schema hasta acá:
   Core + Catálogo + Movimientos, nunca antes migrado) y
   `prisma/migrations/20260915034450_indices_manuales/` (los índices
   únicos funcionales/parciales documentados en "Pendiente" — ya escritos
   a mano y committeados, no quedan como TODO).
2. `npm run db:seed` — corrió limpio (33 acciones, roles, sucursal
   "Central", 5 unidades base).
3. `npm test` — **67/67 tests verdes**, incluidos los de Core/Catálogo que
   nunca se habían corrido contra una DB real antes de esta sesión.
4. `npx tsc --noEmit` y `npx eslint` — limpios.
5. `npx next build` — build de producción limpio, las 15 rutas existentes
   compilan.

No se conectó ningún Neon real (sigue pendiente: credenciales de Google
OAuth, y probar contra Neon en vez de Postgres local) — pero el camino
completo "schema → migración → seed → server actions → tests" ya está
probado de punta a punta contra Postgres real, no solo contra el compilador.

## Pendiente / huecos conocidos

1. ~~No hay Postgres real conectado todavía~~ **RESUELTO (sesión
   Movimientos) para desarrollo local** — `npx prisma migrate dev` +
   `npm run db:seed` + `npm test` corridos contra Postgres 16 real, los
   tres limpios (ver "Verificación real" arriba). Sigue pendiente para
   PRODUCCIÓN: crear el proyecto Neon real y completar `.env` con sus
   credenciales (`DATABASE_URL`/`DIRECT_URL` de Neon) — el código ya
   soporta los dos casos (ver el bugfix de `src/lib/db.ts` arriba).
2. ~~Índices únicos que Prisma no puede declarar~~ **RESUELTO** — escritos
   a mano y committeados en
   `prisma/migrations/20260915034450_indices_manuales/migration.sql`
   (parcial en `CapacidadSucursal`, funcionales `lower(nombre)` en
   Producto/Proveedor/Insumo/CategoriaProducto/Unidad/Grupo/Seccion),
   aplicados y verificados contra Postgres real.
3. ~~Tests escritos pero nunca corridos~~ **RESUELTO** — 67/67 verdes
   (Core, Catálogo y Movimientos) contra Postgres real.
4. Credenciales reales de Google OAuth (Google Cloud Console) — sigue
   pendiente, no verificable sin acceso a Google Cloud Console.
5. UI de selección de "sucursal activa" para un usuario con más de una
   membresía — deferida a propósito (`src/core/auth/contexto.ts` usa la
   primera membresía activa como MVP).
6. UI de carga de Movimientos (paneles guiados, wizard de Compra,
   Conteo Físico) — los server actions y tests ya están, ver "Próximas
   porciones".

## Próximas porciones

En este orden de dependencia (Stock y Reportes dependen de Movimientos):

1. **Movimientos — UI** (única parte pendiente de esta porción; el motor
   de dominio, los server actions y los tests ya están escritos y
   verificados, ver "Estado actual" arriba y el plan íntegro más abajo).
   Paneles guiados por proceso bajo `/movimientos/*`, wizard de Compra por
   proveedor con alta rápida de producto inline (reusar el patrón de
   Catálogo), y el panel de Conteo Físico. Acá también se termina de
   enganchar `upsertProveedorPorProducto` (ya construido en Catálogo,
   consumido por `registrarMovimiento` pero nunca ejercitado desde una UI
   real todavía).
2. **Stock** — Kardex + vistas materializadas (`Stock`, `StockConsolidado`,
   `StockFamilia`, `AlertasStock`), conteo físico.
3. **Reportes** — `obtenerDatosConsulta` (18 vistas), reportes por período.
   Importante: el costo de reposición debe seguir leyendo el Kardex LOCAL
   de cada sucursal (nunca `ProveedorPorProducto`, que es Catálogo Central
   compartido) — mismo criterio que ya tiene Apps Script para no mezclar
   precios entre sucursales.
4. Traspasos entre sucursales (bandeja de solicitud/aprobación/aceptación,
   hoy en `Sucursales.js`).

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

### UI prevista (paneles guiados, patrón ya usado en Catálogo) — ÚNICA PARTE PENDIENTE DE ESTA PORCIÓN

Un panel por proceso bajo `/movimientos/*` (equivalente a
`PanelOperacion.html` parametrizado por proceso — Movimientos.js:1777-1825),
más `CompraPorProveedor.html` (wizard de Compra con alta rápida de
producto inline, `IncludeAltaRapidaProducto.html`, ya con 3 modos para el
caso de Devolución Consignación) y `PanelConteoFisico.html`
(auto-expandir por sección+lote, "Agregar lote nuevo", Reclasificar como
acción secundaria — aunque `reclasificarStock` en sí quede para la porción
Stock, su entrada de UI ya vive en este mismo panel en Apps Script).

### Testing — 67/67 verdes contra Postgres real (`test/movimientos/*.test.ts`)

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
  también falla.
- `secciones.test.ts`: alta, dedupe case/espacio-insensible, desactivar
  sin borrar.

### Verificación real (repetible)

1. `npx prisma migrate dev` — aplica todo el schema (Core+Catálogo+Movimientos)
   más los índices manuales, ya committeados como migraciones reales en
   `prisma/migrations/`.
2. `npm run db:seed` — seed limpio.
3. `npm test` — 67/67 verdes.
4. `npx tsc --noEmit`, `npx eslint`, `npx next build` — los tres limpios.

Ver "Bugs de infraestructura encontrados y arreglados" (arriba, en
"Estado actual") para los dos fixes que hicieron falta en `src/lib/db.ts`
y `vitest.config.ts` antes de que esto corriera — ninguno específico de
Movimientos, afectaban a Core/Catálogo también.
6. Dos líneas del mismo payload pidiendo más del mismo producto+sección
   del que hay → rechazado ANTES de escribir nada (ninguna fila parcial
   en Kardex).
7. Suite de Vitest de esta porción verde (`npm test`).

