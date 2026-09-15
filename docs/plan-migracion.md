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

### Porción Core — COMPLETA (código y tests escritos, sin correr contra DB real)

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

### Porción Catálogo — COMPLETA (código y tests escritos, sin correr contra DB real)

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

### Porción Movimientos — SCHEMA DISEÑADO (`prisma/schema.prisma`), sin server actions/UI/tests

Investigación completa de `Movimientos.js`/`Stock.js`/`Sucursales.js` (repo
`motor`) hecha e incorporada al schema — ver la sección íntegra más abajo,
"Plan de la porción Movimientos", para las decisiones con ancla
`archivo:línea`. Resumen de lo más importante:

- Modelos nuevos: `Seccion`, `Operacion`, `MovimientoStock` (el Kardex),
  `ConteoFisico`, `PrecioLocalProducto` — y los enums `Proceso`,
  `MotivoMerma`, `DestinoConsumo`, `AccionConteo`, `EstadoConteo`.
- `MovimientoStock.cantidad` se graba **siempre ya con el signo aplicado**
  (nunca una segunda tabla de signos que leer aparte) — cierra de raíz la
  MISMA clase de bug que causó el bug de Merma sin signo en Apps Script
  v2.1.0 (dos fuentes de verdad para el signo que se desincronizaron).
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
- A propósito el schema todavía NO incluye `RECLASIFICACIÓN` (primitiva de
  Stock, nunca pasa por TRANSICIONES) ni los 3 procesos de transferencia
  entre sucursales (`TRANSFERENCIA_SALIDA/ENTRADA_SUCURSAL`,
  `REINGRESO_TRANSFERENCIA_SUCURSAL` — porción Traspasos): agregar un valor
  a un enum de Postgres es aditivo y trivial: se agregan cuando esas
  porciones se investiguen de verdad, no antes.

Falta (próxima sesión): portar `TRANSICIONES` (signo/validaciones por
proceso) a TS, escribir los server actions de los 12 procesos, la UI de
carga (paneles guiados, wizard de Compra por proveedor, Conteo Físico), y
los tests de negocio. Ver la sección completa más abajo.

## Pendiente / huecos conocidos (bloquean probar esto de verdad)

1. **No hay Postgres real conectado todavía** — decisión explícita tomada
   durante el diseño (se avanzó con el código sin DB). Falta:
   - Crear un proyecto Neon (o levantar `docker compose up -d` local).
   - Completar `.env` real (`DATABASE_URL`, `DIRECT_URL`, `AUTH_SECRET`,
     `AUTH_GOOGLE_ID`/`AUTH_GOOGLE_SECRET`, `BOOTSTRAP_ADMIN_EMAILS`).
   - `npm run db:migrate` (aplica schema + corre `prisma/seed.ts`).
2. **Índices únicos que Prisma no puede declarar** — agregar a mano en la
   migración SQL generada:
   - Parcial en `CapacidadSucursal` (como máximo una fila "default",
     `sucursalId IS NULL`, por acción).
   - Funcionales `lower(nombre)` en `Producto`, `Proveedor`, `Insumo`,
     `CategoriaProducto`, `Unidad`, `Grupo` (unicidad case-insensible).
   - Funcional `lower(nombre)` en `Seccion`, **scopeado por sucursal**:
     `CREATE UNIQUE INDEX ON "Seccion" (sucursalId, lower(nombre));`
     (porción Movimientos, mismo criterio que el resto).
3. **Tests escritos pero nunca corridos** (`npm test`) — necesitan la DB de
   arriba. Cubren permisos/bootstrap (Core) y productos/recetas/grupos/
   concurrencia de proveedores (Catálogo).
4. Credenciales reales de Google OAuth (Google Cloud Console).
5. UI de selección de "sucursal activa" para un usuario con más de una
   membresía — deferida a propósito (`src/core/auth/contexto.ts` usa la
   primera membresía activa como MVP).

## Próximas porciones (no empezadas)

En este orden de dependencia (Movimientos depende de Catálogo; Stock y
Reportes dependen de Movimientos):

1. **Movimientos** — **schema ya diseñado y aplicado** (`prisma/schema.prisma`
   — `Seccion`/`Operacion`/`MovimientoStock`/`ConteoFisico`/`PrecioLocalProducto`,
   ver "Estado actual" arriba y el plan íntegro más abajo). Falta portar
   `TRANSICIONES` a TS, los server actions de los 12 procesos gateables
   (Compra, Producción, Consumo, Ajuste, Control, Transferencia, Merma,
   Venta, Devolución×3), la UI de carga y los tests. Acá también se
   engancha de verdad `upsertProveedorPorProducto` (ya construido en
   Catálogo, sin usar todavía) al confirmar una Compra.
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

## Plan de la porción Movimientos (schema diseñado y aplicado; server actions/UI/tests pendientes)

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

### Algoritmos a portar (server actions — próxima sesión, todavía sin escribir)

- **`TRANSICIONES` → `src/core/movimientos/transiciones.ts`**: const TS 1:1
  con Movimientos.js:61-348 (`requiereDiaHabil`, `permiteCero`, `filtroUso`,
  `filtroTipo`, `aplicaFactorConversion`, `generaConsumoDeReceta`,
  `exigeSeccion`, y el signo — usado UNA vez, al construir `cantidad` antes
  de insertar, nunca al leer). Fuente única, mismo criterio que ya defendió
  Apps Script después del bug de Merma.
- **`armarLineaMovimiento` (equivalente a `armarRegistroMovimiento_`,
  Movimientos.js:724-872)**: conversión de unidad (factor / presentación
  alternativa / peso real), redondeo por decimales de la `Unidad`, cálculo
  de `precioUnitario`/`precioPorUnidadStock`, chequeo de sección obligatoria
  con pista de "tiene stock en: ..." armada contra un `SUM(cantidad)` real
  en vez de rescanear un array de stock precalculado.
- **`calcularConsumosProduccion`/`resolverConsumoPorFamilia`** (Movimientos.js:632-659,
  Stock.js:481-524): al Producir o Vender un PV con receta, expandir cada
  ingrediente a 1+ líneas de Consumo — con reparto entre "hermanos" del
  mismo `Insumo` (ya modelado en Catálogo, `Producto.insumoId`) si el
  puntual no alcanza. FEFO simplificado: sin lote elegido, `ORDER BY
  loteVencimiento ASC` sobre el saldo agregado (equivalente a
  `obtenerLoteMasProximoAVencer_`, Stock.js:426-480).
- **Validación de stock suficiente**: `SUM(cantidad) GROUP BY productoId,
  seccionId` (con el índice `@@index([productoId, seccionId, loteVencimiento])`
  ya en el schema) reemplaza `validarStockSuficiente_`/`obtenerStockMP_`
  (Stock.js:573-598) — sin necesidad de una hoja "Stock" materializada a
  mano: Postgres puede agregar en tiempo real. Acumular por clave dentro
  del mismo payload ANTES de escribir nada (bugfix C-1, ver tabla arriba),
  dentro de una transacción Prisma (reemplaza `conLock_`/`LockService`).
- **Venta** (`confirmarRegistrarVenta_ConLock_`, Movimientos.js:1154-1332):
  por cada ítem vendido → 1 `Operacion` propia con N `MovimientoStock`
  (`VENTA` para el PV + `CONSUMO` por cada MP de receta + `LIQUIDACION_CONSIGNACION`
  si esa MP tiene `Producto.esConsignacion`, con `cantidad: 0` y
  `precioTotal = cantidadConsumida × Producto.precioConsignacion`). Precio
  de venta: `PrecioLocalProducto` (si existe y `habilitado`) o
  `Producto.precioVenta` (fallback) — mismo criterio que `resolverPrecioVenta_`.
- **Conteo Físico** (`_registrarConteoFisicoSinRecalculo_`/`resolverConteoPendiente`/
  `cancelarConteoFisico`, Stock.js:1523-2141): 3 acciones (`AJUSTAR` escribe
  el `MovimientoStock` de corrección; `FALTA_MOVIMIENTO` deja el
  `ConteoFisico` en `PENDIENTE` sin tocar stock; `DESCARTAR` no ajusta ni
  cuenta como válido) — mismo state machine, ahora con `ConteoFisico.movimientos`
  como FK real en vez de correlación por string.
- **Transferencia** (`confirmarRegistrarMovimientos`, rama `esTransferencia`,
  Movimientos.js:991-1022): 1 `Operacion` (`TRANSFERENCIA`) con 2
  `MovimientoStock` por línea (−cantidad en `seccionId` origen, +cantidad
  en `Operacion.seccionDestinoId`), ambas con `proceso: TRANSFERENCIA`.
- **Duplicado de factura** (`validarFacturaNoDuplicada_`, Movimientos.js:402-416):
  `WHERE proceso = COMPRA AND proveedorId = X AND nroFactura = Y` sobre
  `Operacion` — más simple que escanear Kardex por texto, ahora que
  proveedor/factura son columnas reales de `Operacion`, no texto por fila.

### Server actions previstas (patrón `conPermiso`, ya usado en Core/Catálogo)

Una acción por proceso gateable, cada una contra su `Accion` ya seedeada en
`acciones.ts`: `registrarCompra` → `proceso_compra` · `registrarProduccion`
→ `proceso_produccion` · `registrarConsumo` → `proceso_consumo` ·
`registrarAjuste` → `proceso_ajuste` · `registrarTransferencia` →
`proceso_transferencia` · `registrarMerma` → `proceso_merma` ·
`registrarVenta` → `proceso_venta` · `registrarDevolucionConsignacion`/
`registrarDevolucionCliente`/`registrarDevolucionProveedor` →
`proceso_devolucion_*` · `registrarConteoFisico`/`resolverConteoPendiente`/
`cancelarConteoFisico` → `proceso_control`/`cancelar_conteo` ·
`crearSeccion`/`actualizarActivaSeccion` → `secciones` ·
`setPrecioLocalProducto` → `precio_local`. Cada una con su "vista previa"
(equivalente a `calcularPreviaOperacion`/`armarPreviaVentaDesdeItems_`) y
su "confirmar" (equivalente a `confirmarRegistrarMovimientos`/
`confirmarRegistrarVenta`), mismo patrón de 2 pasos que ya usan los paneles
de Apps Script.

### UI prevista (paneles guiados, patrón ya usado en Catálogo)

Un panel por proceso bajo `/movimientos/*` (equivalente a
`PanelOperacion.html` parametrizado por proceso — Movimientos.js:1777-1825),
más `CompraPorProveedor.html` (wizard de Compra con alta rápida de
producto inline, `IncludeAltaRapidaProducto.html`, ya con 3 modos para el
caso de Devolución Consignación) y `PanelConteoFisico.html`
(auto-expandir por sección+lote, "Agregar lote nuevo", Reclasificar como
acción secundaria — aunque `reclasificarStock` en sí quede para la porción
Stock, su entrada de UI ya vive en este mismo panel en Apps Script).

### Testing previsto (Vitest, casos a portar de `Tests.js`)

Signo correcto por proceso (con foco explícito en que agregar un proceso
nuevo no pueda repetir el bug de Merma sin signo); sección obligatoria
rechaza sin elegir para los 6 procesos que la exigen, no la exige para los
que dan de alta stock nuevo; validación de stock agregada por clave
producto+sección dentro de un mismo payload (2 líneas que juntas superan
el stock, cada una por separado no); FEFO elige el lote que vence antes
cuando no se especifica; reparto de consumo entre hermanos de un mismo
Insumo cuando el puntual no alcanza; Venta de un PV con receta genera
Consumo + Liquidación Consignación si la MP es consignación, con
`cantidad: 0` en la Liquidación; Precio Local habilitado pisa el precio
global, deshabilitado no; duplicado de factura (mismo proveedor+número)
rechazado, distinto proveedor con mismo número no choca; Conteo Físico:
`AJUSTAR` escribe movimiento y `SUM(cantidad)` post-ajuste coincide con lo
contado, `FALTA_MOVIMIENTO` no toca stock y queda `PENDIENTE`,
`cancelarConteoFisico` sobre un conteo `RESUELTO` escribe la reversión
exacta y dos llamadas seguidas fallan la segunda (`estadoActual === 'Cancelado'`);
Transferencia entre 2 secciones deja el `SUM` global sin cambios.

### Verificación de la porción Movimientos

1. `npx prisma migrate dev` aplica el schema nuevo sin romper Core/Catálogo
   ya existentes; agregar a mano el índice funcional de `Seccion` (ver
   "Pendiente" arriba).
2. Compra con 2 líneas del mismo producto en la misma sección → 1
   `Operacion`, 2 `MovimientoStock`, `SUM(cantidad)` = la suma de ambas.
3. Merma de una `Unidad` sin `exigeSeccion` cumplido → rechazada; con
   sección elegida → `MovimientoStock.cantidad` negativo, saldo baja.
4. Vender un PV con receta de 2 MP, una marcada `esConsignacion` → 1
   `Operacion`, filas `VENTA`+`CONSUMO`×2+`LIQUIDACION_CONSIGNACION`×1, la
   liquidación con `cantidad: 0` y `precioTotal` > 0.
5. Cancelar un Conteo Físico `RESUELTO` → nueva fila de reversión, saldo
   vuelve al de antes del ajuste, segunda cancelación sobre el mismo
   conteo rechazada.
6. Dos líneas del mismo payload pidiendo más del mismo producto+sección
   del que hay → rechazado ANTES de escribir nada (ninguna fila parcial
   en Kardex).
7. Suite de Vitest de esta porción verde (`npm test`).

