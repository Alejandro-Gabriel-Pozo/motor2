# Plan: la carta pública de restaurant-menu-design pasa a leer el catálogo de motor2 (módulo `carta`, de solo lectura)

Entregado por un agente de planificación (Opus) el 2026-09-24, sobre la
base `1fb182a` de `claude/merge-menu-inventory-repos-5ot8uc`. Contexto
completo en `docs/grounding-unificacion-carta-stock-2026-09-23.md`
(§0-§5) y `docs/arquitectura-modularidad-server-actions-2026-09-17.md`.

---

## A. Lo que cambia respecto de la descripción del pedido

1. **Hay un guardián que obliga a usar `whereDisponibleEn`.** `test/arquitectura/disponibilidad-en-un-solo-lugar.test.ts` falla si algún archivo de `src/` escribe `disponibilidades:` fuera de `src/core/catalogo/disponibilidad-producto-consulta.ts`. Entonces `core/carta` tiene que filtrar con `whereDisponibleEn(sucursalId)` de ese archivo. Es la forma de consulta del mismo criterio que `resolverDisponibilidad` ("fila ausente = no disponible"). No se puede reimplementar a mano.
2. **El precio de la carta no es solo `Producto.precioVenta`.** Existe `PrecioLocalProducto`, que pisa el precio si está `habilitado` (`src/core/movimientos/precio-venta.ts::resolverPrecioVenta`, y en lote en `src/core/reportes/comun.ts:72-90`). La carta tiene que mostrar el mismo precio que se cobra.
3. **`generarReporteVentasPorCategoria` agrupa por nombre de categoría, no por id** (`periodo.ts:1114`). Usa `"Sin categoría"` como resto y no exporta el tipo de retorno. El rollup tiene que armar el mapa de secciones por `CategoriaProducto.nombre` (es `@unique`, así que es seguro) y tomar el tipo con `Awaited<ReturnType<typeof generarReporteVentasPorCategoria>>`, sin tocar `periodo.ts`.
4. **`limpiarBaseDeTest` (`test/setup/test-db.ts`) borra `producto`, `categoriaProducto` y `sucursal`.** Con tablas nuevas que tienen FK a esos modelos (Prisma pone `ON DELETE RESTRICT` por defecto), la suite entera de Vitest se rompe apenas un test deje filas de carta. Esas tablas se tienen que agregar al principio de la limpieza, en el mismo commit que la migración. El reset de E2E (`base-e2e.ts`) hace `TRUNCATE ... CASCADE` sobre todas las tablas, así que ahí no hay que tocar nada.
5. **Ya hay un modelo `Seccion`** (sección de stock por sucursal). El nombre `SeccionCarta` no choca, pero en el código y en la UI hay que decir siempre "sección de carta".
6. **Patrón de autenticación de servicio en motor2:** `src/app/api/cron/*/route.ts` compara `Authorization: Bearer ${CRON_SECRET}` con `!==`. Si falta la variable, avisa a Sentry una sola vez (`reportarErrorUnaVez`) y responde 401. `src/proxy.ts` ya deja afuera todo `/api`.
7. **Cómo protege hoy restaurant-menu-design su `app/api/revalidate`:** con `?secret=` en la query contra `REVALIDATE_SECRET`. Si falta la variable responde 500, si el secreto es incorrecto 401, y compara con `!==`. Para una llamada entre servidores conviene más el header `Bearer` que usa motor2, porque la query string queda en los logs.
8. **Qué quiere decir hoy `MenuCategory` en restaurant-menu-design:** es la sección visual. `label` es la columna `categoria` de la sheet (por ejemplo "Platos Principales") y `titulo_seccion` es el título ("Del fuego"). En motor2 eso es `SeccionCarta`, no `CategoriaProducto`.
9. **Quién consume `MenuCategory[]`:** `components/carta-view.tsx`, `menu-section.tsx`, `menu-nav.tsx`, `tag-filter.tsx`, `menu-client.tsx` y `carta-controls/index.tsx`. Quién llama a `getMenu()`: `app/carta/[sucursal]/page.tsx`, `app/carta/page.tsx`, `app/carta-demo/page.tsx` y `app/page.tsx` (modo single). `lib/menu-data.ts` tiene otro `MenuCategory` viejo que nadie importa.
10. **Los problemas de tipos ya existentes quedan ocultos.** `next.config.mjs` tiene `typescript.ignoreBuildErrors: true`. `lib/menu-data.fallback.ts` usa `precio` numérico donde el tipo pide string y le falta `imagen_seccion_url`, así que `tsc` probablemente ya falla hoy.
11. **`npm run lint` probablemente no anda hoy en restaurant-menu-design.** El script es `eslint .`, pero `eslint` no está en `package.json` y no hay `eslint.config.*`. El CI (`.github/workflows/ci.yml`) corre `pnpm lint` y `pnpm build`. El gestor es **pnpm** (`pnpm-lock.yaml`). No hay Vitest ni Playwright (confirmado).
12. **`tenants.ts` no se puede sacar.** `SiteConfig`/theming (fuera de alcance) se sigue leyendo de la tab `Config` de la sheet de cada tenant (`getConfig(tenant.sheet_id)`), y el registro de tenants (dominio, `pos_*`, `sheet_id`) sigue en la sheet maestra. Lo único que se reemplaza es la lectura de la tab `Menu`.
13. **De paso, fuera de alcance:** `proxy.ts` lee la tab `Tenants` y `lib/tenants.ts` lee `tenant`. Es una inconsistencia que ya existe y no se toca acá.

---

## B. Decisiones de diseño (con recomendación)

| # | Decisión | Recomendación |
|---|---|---|
| D1 | Qué va en `[sucursal]` del endpoint | **`Sucursal.id`** (el cuid). No hace falta columna nueva en `Sucursal`. En restaurant-menu-design se agrega una columna opcional **`motor2_sucursal_id`** en la tab `tenant` de la sheet maestra. Si la columna está vacía, ese tenant sigue leyendo la sheet: el pase se hace tenant por tenant y se revierte vaciando la celda. |
| D2 | Contrato de respuesta | **Forma nueva y versionada (`version: 1`)**, con precio numérico y sin el campo obsoleto `title`. restaurant-menu-design la convierte a `MenuCategory[]` con un mapper, igual que hoy `rowToItem`/`buildCategories` convierten la sheet. Así los componentes no se tocan y motor2 no carga con detalles de presentación del otro repo. |
| D3 | Producto sin fila en `ContenidoCartaProducto` | **No se muestra (opt-in).** Es el mismo criterio que `DisponibilidadProducto`: nada interno aparece en la carta pública sin que alguien lo marque. Costo: un PV nuevo no aparece hasta que se cargue su contenido. Por eso importa D6. |
| D4 | `SeccionCarta` y la tabla puente: ¿globales o por sucursal? | **Globales**, como `CategoriaProducto` (Catálogo Central). Si el dueño necesita títulos o imágenes de sección distintos por sucursal, se agrega después un override aditivo. |
| D5 | `PromoCarta` | **Por sucursal**, igual que `PromocionProducto`. Eso obliga a **una línea de relación inversa más, en `Sucursal`**, del mismo tipo declarativo que la de `Producto`. La otra opción, `sucursalId` sin FK, pierde integridad referencial y no la recomiendo. **Nota post-plan (2026-09-24):** la composición real de una promo (qué productos entran, a costo $0 por defecto, tildable para cobrar aparte al precio de carta) queda para el pendiente futuro "tomar pedido" — ver `docs/grounding-unificacion-carta-stock-2026-09-23.md` §7.1. `PromoCarta` en ESTE plan sigue siendo informativa (título/descripción/precio), sin referencia a `Producto`. |
| D6 | ¿Hace falta pantalla admin (paso 5)? | **No para dejar el código listo**: los pasos 1–4 salen apagados, porque ningún tenant tiene `motor2_sucursal_id`. **Sí antes de pasar un tenant real**: sin admin, el dueño pierde la edición que hoy hace en la sheet (descripción, tags, especial, orden, promos) y los PV nuevos no aparecen. Propuesta: pasos M8–M10 dentro de este pendiente, sujetos a que el dueño los confirme. Si elige no hacerlos, la carga es a mano con `npm run db:studio` y el pase queda limitado a tenants cuya carta casi no cambia. |
| D7 | Fallback si motor2 falla | Tal como se pidió: **`menu-data.fallback.ts`**, con el mismo criterio que hoy (si falla o si viene vacío). Riesgo que ya existe hoy: el ISR guarda ese menú de ejemplo hasta 1 h. Hay una mejora opcional aparte en la sección E. |

---

## C. Paso 0: línea de base (antes de tocar nada)

**motor2** (este worktree, `/home/user/worktrees/motor2-carta`):
- `node_modules` ya está enlazado desde el checkout principal.
- Bases ya creadas: `motor2_carta` (dev) y `motor2_carta_e2e` (e2e), usuario `motor2`/`motor2`, en el Postgres local ya corriendo (puerto 5432). Armar `.env` local:
  - `DATABASE_URL="postgresql://motor2:motor2@localhost:5432/motor2_carta"`
  - `DIRECT_URL="postgresql://motor2:motor2@localhost:5432/motor2_carta"`
  - `MOTOR2_E2E_DATABASE_URL="postgresql://motor2:motor2@localhost:5432/motor2_carta_e2e"`
- Migrar las dos bases: `DIRECT_URL=... npx prisma migrate deploy` (para cada una, ver `.env.example` para el resto de las variables mínimas — `AUTH_SECRET` con `npx auth secret`, el resto puede quedar vacío para uso local).
- Correr y anotar:
  1. `npx tsc --noEmit`: anotar la salida. Lo único esperado es el ruido de `LayoutProps` de `layout.tsx`.
  2. `npm run lint`: errores y warnings.
  3. `npm test`: anotar "Test Files X passed / Tests Y passed".
  4. `npm run build`: anotar los warnings.
  5. `npm run test:e2e`: anotar "N passed". Confirmar en la salida `[e2e] Servidor: build`.

**restaurant-menu-design** (`/home/user/restaurant-menu-design` — dependencias ya instaladas con `pnpm install --frozen-lockfile`, sin worktree porque ningún otro agente lo toca):
- Correr y anotar:
  1. `pnpm lint`. Si falla con "eslint: not found" o por falta de config, se registra como problema ya existente y se hace el paso R0.
  2. `pnpm build`. Si `MASTER_SHEET_ID` no está, `getTenants()` devuelve `[]`, así que buildea igual.
  3. Extra, solo informativo: `npx tsc --noEmit`. Anotar cuántos errores hay (el build los esconde, ver A.10).

---

## D. Pasos de implementación (un commit por paso, en orden)

### motor2

**M1 — Schema y migración. REQUIERE AUTORIZACIÓN EXPRESA (ya autorizado por el dueño el 2026-09-24 tras revisar el diseño completo — aplicar solo contra las bases locales de este worktree, nunca Neon/producción).**

- Se edita `prisma/schema.prisma`. Tablas nuevas en una sección `// CARTA`:

```prisma
model SeccionCarta {
  id          String   @id @default(cuid())
  nombre      String   @unique          // "Platos Principales" → MenuCategory.label
  titulo      String?                   // "Del fuego" → titulo_seccion (null = nombre)
  descripcion String?
  imagenUrl   String?
  orden       Int      @default(0)
  activa      Boolean  @default(true)
  categorias  CategoriaSeccionCarta[]
  promos      PromoCarta[]
  @@index([activa, orden])
}

model CategoriaSeccionCarta {            // tabla puente, solo referencia
  id             String            @id @default(cuid())
  categoriaId    String            @unique   // una categoría → a lo sumo una sección
  categoria      CategoriaProducto @relation(fields: [categoriaId], references: [id])
  seccionCartaId String
  seccionCarta   SeccionCarta      @relation(fields: [seccionCartaId], references: [id])
  orden          Int               @default(0) // orden de la categoría dentro de la sección
  @@index([seccionCartaId])
}

model ContenidoCartaProducto {
  id             String   @id @default(cuid())
  productoId     String   @unique
  producto       Producto @relation(fields: [productoId], references: [id])
  visibleEnCarta Boolean  @default(false)
  descripcion    String?
  imagenUrl      String?
  tags           String[] @default([])
  especial       Boolean  @default(false)
  orden          Int      @default(0)
  actualizadoEn  DateTime @updatedAt
}

model PromoCarta {
  id             String       @id @default(cuid())
  sucursalId     String
  sucursal       Sucursal     @relation(fields: [sucursalId], references: [id])
  seccionCartaId String
  seccionCarta   SeccionCarta @relation(fields: [seccionCartaId], references: [id])
  titulo         String
  descripcion    String?
  precio         Decimal      @db.Decimal(14, 2)
  orden          Int          @default(0)
  activa         Boolean      @default(true)
  creadoEn       DateTime     @default(now())
  @@index([sucursalId, activa])
  @@index([seccionCartaId])
}
```

- **Líneas de relación inversa mínimas** (sin nombre de relación, porque hay una sola entre cada par; es la misma sintaxis que `disponibilidades DisponibilidadProducto[]`):
  - En `Producto`: `contenidoCarta ContenidoCartaProducto?`. Es singular y opcional porque `productoId` es `@unique` (1:1).
  - En `CategoriaProducto`: `seccionCarta CategoriaSeccionCarta?`. También 1:1, por `categoriaId @unique`.
  - En `Sucursal`: `promosCarta PromoCarta[]` (ver D5).
- Sin `onDelete: Cascade`: se queda en RESTRICT, como el resto del catálogo, que nunca borra filas. `String[]` no tiene precedente en el schema, pero Prisma lo soporta en Postgres. La alternativa es un `String` separado por comas, como en la sheet.
- Generar la migración: `npx prisma migrate dev --create-only --name carta_modelo`. Revisar el SQL: tiene que ser solo 4 `CREATE TABLE`, índices y FKs, **sin backfill** (por D3, que falte la fila significa "no se muestra"). Después aplicar con `npx prisma migrate dev`.
- En el **mismo commit**: en `test/setup/test-db.ts::limpiarBaseDeTest`, agregar al principio `promoCarta.deleteMany()`, `contenidoCartaProducto.deleteMany()`, `categoriaSeccionCarta.deleteMany()` y `seccionCarta.deleteMany()`.
- Chequeo: `npx tsc --noEmit` y `npm test` completos. Ningún test existente cambia de resultado.

**M2 — `src/core/carta/armar-menu.ts`, lógica pura sin Prisma.**
- Mismo criterio que `disponibilidad-producto.ts` / `-consulta.ts`: nunca mezclar Prisma con funciones puras, por el problema del bundle del cliente documentado ahí.
- Tipos `CartaV1`, `SeccionCartaV1`, `ItemCartaV1` y `PromoCartaV1` (forma exacta en M5).
- `armarMenuCarta(entrada)` recibe secciones activas con sus categorías, productos ya filtrados con sus precios base y locales, y promos. Hace esto:
  - Precio: `local.habilitado ? local.precio : precioVenta`, la misma regla que `resolverPrecioVenta`, fijada con un test de paridad.
  - Agrupa por sección a través de la tabla puente.
  - Ordena: secciones por `orden` y `nombre`; ítems por el `orden` de la tabla puente, después `ContenidoCartaProducto.orden`, después `nombre` (`localeCompare("es")`); promos por `orden` y `titulo`.
  - Descarta las secciones vacías.
  - Descarta `imagenUrl` que no sea `https://` o que tenga espacios, comillas o paréntesis. Motivo: restaurant-menu-design la mete en `backgroundImage: url(${url})` en `components/carta-section-image.tsx:83,99`.
  - Devuelve aparte `diagnostico.visiblesSinSeccion`, que el endpoint **no** expone.
- Test nuevo: `test/carta/armar-menu.test.ts` (puro).

**M3 — `src/core/carta/menu-consulta.ts`, lectura con Prisma.**
- `resolverMenuCarta(sucursalId, db = prisma): Promise<CartaV1 | null>`. Devuelve `null` si la sucursal no existe o tiene `activo: false`.
- Consultas:
  - `producto.findMany({ where: { tipo: "PV", ...whereDisponibleEn(sucursalId), contenidoCarta: { is: { visibleEnCarta: true } } }, select: {...} })`
  - `precioLocalProducto.findMany({ where: { sucursalId, habilitado: true, productoId: { in } } })`
  - `seccionCarta.findMany({ where: { activa: true }, include: { categorias: true } })`
  - `promoCarta.findMany({ where: { sucursalId, activa: true } })`
- Todos los `Decimal` se pasan con `Number()` antes de salir.
- **Nunca escribe.**
- Test nuevo: `test/carta/menu-consulta.test.ts`, contra Postgres, con `sembrarProductoDisponible`. Casos:
  - Se muestra: PV disponible y visible.
  - No se muestra: `disponible=false`, sin fila de disponibilidad, `visibleEnCarta=false`, sin fila de contenido, tipo MP.
  - La disponibilidad de otra sucursal no se filtra.
  - Categoría sin sección → no se muestra y aparece en el diagnóstico.
  - Precio local habilitado o deshabilitado.
  - Sucursal inactiva o inexistente → `null`.
  - Promo de otra sucursal o inactiva → no se muestra.
  - Sección inactiva o vacía → no se muestra.
  - El orden.

**M4 — `src/core/carta/reporte-secciones.ts`, rollup por sección.**
- Función pura `reagruparPorSeccion(repCategorias, seccionPorNombreCategoria)`.
- Envoltorio `generarReporteVentasPorSeccion(sucursalId, desde, hasta, db)`. Llama a `generarReporteVentasPorCategoria` **sin modificarlo** y hace **una sola** consulta extra: `categoriaSeccionCarta.findMany({ select: { categoria: { select: { nombre } }, seccionCarta: { select: { nombre, orden } } } })`.
- Salida: `{ desde, hasta, totalFacturado, aviso, porSeccion: [{ seccion, cantidad, importe, categorias: FilaCategoriaVenta[] }], pvSinCategoria, categoriasSinSeccion }`. `"Sin categoría"` y las categorías sin sección van a un grupo "Sin sección".
- Test nuevo: `test/carta/reporte-secciones.test.ts`. Tiene que probar que:
  - la suma de `importe` y `cantidad` por sección es igual a la suma de `porCategoria`;
  - cada `FilaCategoriaVenta` sale idéntica (deep-equal) a la del reporte original;
  - la consulta extra es exactamente una (mismo patrón de conteo que `test/reportes/catalogo-una-sola-carga.test.ts`).
- `src/core/reportes/periodo.ts` no se toca: `git diff` sobre ese archivo tiene que salir vacío.

**M5 — Endpoint `src/app/api/carta/[sucursal]/route.ts`.**
- `src/core/carta/token-servicio.ts` (puro): `tokenDeServicioValido(authorizationHeader, esperado)`. Compara `Bearer <token>` con `crypto.timingSafeEqual` sobre hashes SHA-256, para que los largos coincidan. Opcional: aceptar una lista separada por comas, para rotar el token sin cortar el servicio.
- Solo se exporta `GET(request, ctx)`. Los otros métodos dan 405 automáticamente. Antes de escribir, confirmar la firma de Next 16.3.5 en `node_modules/next/dist/docs` (regla de AGENTS.md). Se espera `ctx: RouteContext<"/api/carta/[sucursal]">` y `const { sucursal } = await ctx.params`.
- Flujo:
  1. Si falta `CARTA_API_TOKEN` → `reportarErrorUnaVez("carta-api-sin-token", ...)` y 401, igual que en el cron.
  2. Token inválido → 401 `{ error: "No autorizado" }`.
  3. `resolverMenuCarta` devuelve `null` → 404 `{ error: "Sucursal no encontrada" }`. Mismo 404 para inexistente e inactiva.
  4. OK → 200 con `Cache-Control: no-store`.
  5. Excepción → `reportarError(e, "carta-api")` y 500 con mensaje genérico. A diferencia del cron, no se devuelve `e.message`, porque lo llama un sitio externo.
- Respuesta 200:

```json
{ "version": 1, "generadoEn": "ISO", "sucursal": { "id": "...", "nombre": "..." },
  "secciones": [ { "id": "...", "nombre": "Platos Principales", "titulo": "Del fuego", "descripcion": "...",
    "imagenUrl": null, "orden": 2,
    "items":  [ { "productoId": "...", "nombre": "Bife de chorizo", "categoria": "Bife", "descripcion": "...",
                  "precio": 34000, "tags": ["Regional"], "especial": true, "imagenUrl": null } ],
    "promos": [ { "id": "...", "titulo": "1 pizza + coca 1,5L", "descripcion": null, "precio": 25000, "orden": 1 } ] } ] }
```

  No expone `codigo`, costos, `observaciones` ni el diagnóstico.
- En `.env.example` se agrega `CARTA_API_TOKEN=""` con un comentario del estilo de `CRON_SECRET`: `openssl rand -base64 32`, y que se carga en Vercel.
- `vercel.json` no cambia: la región `pdx1` ya aplica, y `region-de-las-funciones.test.ts` exige los crons exactos.
- Test nuevo: `test/carta/api-carta.test.ts`. Importa `GET` directo, igual que `test/reportes/sincronizar-ipc.test.ts`, y mockea `reportar-error`. Casos:
  - sin header, token incorrecto, falta la variable → 401, y en el último caso se llama a `reportarErrorUnaVez`;
  - id desconocido o sucursal inactiva → 404;
  - 200 con `version === 1`, `typeof precio === "number"` y sin claves internas.
- Recomendado: `test/arquitectura/carta-solo-lectura.test.ts`. Guardián estático, en la línea de los que ya existen, que falla si algún archivo de `src/core/carta/**` o `src/app/api/carta/**` llama `.create(`, `.update(`, `.upsert(`, `.delete` o `$executeRaw`. Si se hace M9, las Server Actions de `src/server/actions/carta/` quedan afuera del chequeo y solo pueden escribir en las 4 tablas de carta.

**M6 — E2E del endpoint en el build de producción.**
- En `playwright.config.ts`, agregar `CARTA_API_TOKEN: "e2e-carta-token"` a `webServer.env`.
- Spec nuevo: `test/e2e/api-carta.spec.ts`, con el fixture `request`. Casos: 401 sin token, 404 con un id inexistente, 200 con token para la sucursal "Central" del seed (sembrar sección, contenido y disponibilidad y borrarlos en `finally` **antes** de borrar el producto, por el RESTRICT), y 405 para POST.

**M7 — Opcional: pantalla del reporte por sección. No necesita migración.**
- `src/app/(app)/reportes/ventas-por-seccion/page.tsx`, protegida con `requierePermisoVer(..., "ver_reportes_dinero")`, igual que `/reportes/categorias`.
- Agregar `{ href: "/reportes/ventas-por-seccion", label: "Por sección de carta", accion: "ver_reportes_dinero" }` en `src/core/navegacion/estructura.ts`, cerca de la línea 79. Lo exigen `reportes-con-permiso.test.ts` y `menu-con-permiso.test.ts`.
- Agregar la ruta en `test/e2e/rutas-sin-parametros.ts`.
- Sumar un chequeo de axe en `test/e2e/accesibilidad.spec.ts`.

**M8–M10 — Admin mínimo (sujeto a D6).**
- **M8. REQUIERE AUTORIZACIÓN EXPRESA (migración de datos, contra la base local de este worktree).**
  - Agregar la acción `carta` en `src/core/permisos/acciones.ts`, que es la única fuente de verdad. Solo `admin` recibe el permiso.
  - Migración idempotente con `INSERT ... ON CONFLICT DO NOTHING` en `Accion` y `PermisoRol`, calcada de `prisma/migrations/20260921232000_permiso_corregir_compra/migration.sql`.
  - Test nuevo: `test/permisos/migracion-permiso-carta.test.ts`, calcado de `migracion-permiso-corregir-compra.test.ts`.
- **M9.** `src/server/actions/carta/{secciones,contenido-producto,promos}.ts`, todas envueltas en `conPermiso("carta", ...)` (lo verifica `acciones-con-guarda.test.ts`).
  - Solo escriben en las 4 tablas de carta.
  - Validan `imagenUrl` (https, sin caracteres peligrosos) y tags.
  - Opcionalmente registran en `RegistroAuditoria` con `entidad: "ContenidoCartaProducto"`.
  - Tests nuevos en `test/carta/*`.
- **M10.** Pantalla `src/app/(app)/catalogo/carta/page.tsx` con `requierePermisoVer(..., "carta")`. Cuatro bloques:
  - secciones;
  - asignación de categoría a sección;
  - contenido por PV, con un listado de "PV disponibles acá sin contenido de carta" para que no pase desapercibido lo de D3;
  - promos de la sucursal activa.
  - Además: agregar el ítem en `GRUPOS_NAV` y en `RUTAS_SIN_PARAMETROS`, un spec `test/e2e/carta-admin.spec.ts` y **un chequeo de axe en `test/e2e/accesibilidad.spec.ts`**.

### restaurant-menu-design (directorio `/home/user/restaurant-menu-design`, sin worktree)

**R0 — Solo si la línea de base mostró el lint roto.** Commit aparte: agregar `eslint` y `eslint-config-next` como devDependencies (versión alineada con next 16.2.6) y un `eslint.config.mjs` flat. No cambia ningún comportamiento.

**R1 — Tipos y mapper puros, sin cambios de comportamiento.**
- `lib/carta-motor2.ts`:
  - Tipo `CartaMotor2V1`.
  - Guardia de forma escrita a mano, `esCartaMotor2V1(x)`, porque el repo no tiene zod.
  - `cartaMotor2AMenuCategories(c): MenuCategory[]`, que convierte cada sección así:
    - `id` = slug del nombre, con la misma función que `buildCategories`, extraída y exportada como `slugCategoria` desde `get-menu.ts`. Si dos slugs chocan se les agrega un sufijo.
    - `label` = `nombre`; `title` y `titulo_seccion` = `titulo ?? nombre`; `description` = `descripcion ?? ""`; `imagen_url` = `imagenUrl ?? ""`; `orden` = `orden`.
    - `items` = productos y promos: `name`, `description`, `price: String(precio)` (igual que hoy con los números de la sheet; `formatPrecio` ya lo parsea), `tags` (`undefined` si está vacío), y `especial` (false en las promos).

**R2 — Lectura desde motor2, con fallback.**
- `lib/tenants.ts`: agregar `motor2_sucursal_id?: string` a `Tenant` y leerlo con `get(row, "motor2_sucursal_id")`.
- `lib/carta-motor2.ts`: `fetchCartaMotor2(id)` hace `fetch(\`${MOTOR2_CARTA_URL}/api/carta/${encodeURIComponent(id)}\`, { headers: { Authorization: \`Bearer ${MOTOR2_CARTA_TOKEN}\` }, next: { revalidate: 300 }, signal: AbortSignal.timeout(5000) })`.
  - Hoy gviz no tiene timeout; si motor2 se cuelga, bloquearía el render del ISR.
  - Hay que confirmar en `node_modules/next/dist/docs` de 16.2.6 cómo cachea `fetch` cuando lleva `Authorization`.
- `lib/get-menu.ts`: nueva función `getMenuForTenant(tenant)`.
  - Si hay `tenant.motor2_sucursal_id`, `MOTOR2_CARTA_URL` y `MOTOR2_CARTA_TOKEN`: intenta motor2. Si falla (error, forma inválida o cero secciones) → `console.error` y `buildCategories(fallbackMenu)`.
  - Si no: llama a `getMenu(tenant.sheet_id, tenant.sheet_name)` sin ningún cambio.
- `app/carta/[sucursal]/page.tsx`: cambia una línea, `getMenu(...)` pasa a ser `getMenuForTenant(tenant)`.
- `/`, `/carta` y `/carta-demo` **no se tocan**.
- Los componentes no se tocan: `git diff --stat components/` tiene que salir vacío.

**R3 — Documentación.**
- `docs/setup-sucursal.md` y `docs/templates/template-hoja-raiz.csv`: la columna `motor2_sucursal_id`.
- `ARCHITECTURE.md`: la fuente del menú.
- Documentar las variables `MOTOR2_CARTA_URL` y `MOTOR2_CARTA_TOKEN`. El token tiene que valer lo mismo que `CARTA_API_TOKEN` de motor2.
- No hay que agregarlas al CI: sin ellas el build sigue usando la sheet o el fallback.

**R4 y R5 — Operación, no código.** Pase tenant-por-tenant y baja eventual de la lectura de la sheet: fuera del alcance de este pendiente (no se implementan, quedan documentados en R3 para cuando el dueño decida usarlos).

---

## E. Riesgos y temas abiertos (ninguno bloquea)

- **Fallback guardado 1 h.** Pasa hoy con gviz y va a seguir pasando: si motor2 falla durante una revalidación, se guarda el menú de ejemplo hasta 1 h.
- **Hasta 1 h de atraso.** Un cambio de disponibilidad en motor2 tarda hasta el `revalidate = 3600` de la página en verse.
- **Build de restaurant-menu-design.** `generateStaticParams` renderiza todos los tenants en el build: si motor2 no responde en ese momento, el fallback queda horneado. Es lo mismo que hoy con gviz.
- **D4.** Si el dueño necesita títulos o imágenes de sección por sucursal, se resuelve con un override aditivo más adelante.

---

## F. Verificación end-to-end final (obligatoria)

**Criterio de cierre:** el pendiente está terminado solo cuando **todos** los comandos siguientes pasan limpios **en la misma corrida**, con las mismas bases locales del Paso 0, después del último commit.

**motor2** (este worktree, bases `motor2_carta`/`motor2_carta_e2e` locales, nunca Neon/producción):

| Comando | Criterio |
|---|---|
| `npx tsc --noEmit` | Salida vacía, salvo el ruido de `LayoutProps` de `layout.tsx` que ya estaba |
| `npm run lint` | 0 errores y 0 warnings nuevos respecto de la línea de base |
| `npm test` (suite ENTERA) | Todo en verde. Tests ≥ línea de base más los nuevos de `test/carta/*` (y `test/permisos/migracion-permiso-carta.test.ts` si se hace M8) |
| `npm run build` | Aplica la migración `carta_modelo` sobre la base local sin errores. Build limpio y sin warnings nuevos. `/api/carta/[sucursal]` aparece como ruta dinámica (ƒ) |
| `npm run test:e2e` (suite ENTERA, `[e2e] Servidor: build`) | Todo en verde. Specs ≥ línea de base más `api-carta.spec.ts` (y `carta-admin.spec.ts` y los chequeos de axe nuevos si se hacen M7 o M10) |

**restaurant-menu-design** (`/home/user/restaurant-menu-design`):

| Comando | Criterio |
|---|---|
| `pnpm lint` | 0 errores (después de R0 si hizo falta) |
| `pnpm build` | `next build` limpio, sin variables de motor2 y también con ellas |
| Extra: `npx tsc --noEmit` | Cantidad de errores ≤ línea de base y **ninguno** en `lib/carta-motor2.ts`, `lib/get-menu.ts`, `lib/tenants.ts` ni `app/carta/[sucursal]/page.tsx` |

**Verificación manual (no hay suite automatizada):**

1. **Preparar motor2.** Levantarlo local: `npm run dev` en :3000, con `CARTA_API_TOKEN=dev-token`. Cargar datos en la sucursal "Central": secciones "Entradas"/"Platos Principales" (título "Del fuego")/"Promos"; categorías asignadas; 3 PV con contenido visible (uno especial+tags, uno con precio local habilitado, uno `visibleEnCarta=false`); 1 PV `disponible=false`; 1 `PromoCarta`.
2. **Probar el endpoint con curl.** Sin token → 401. Con token → 200, precios numéricos, sin el PV oculto ni el no disponible, precio local aplicado. Id inexistente con token → 404. POST → 405.
3. **Preparar restaurant-menu-design.** `.env.local` con una copia de la sheet maestra con `motor2_sucursal_id` en un tenant y vacío en otro; `MOTOR2_CARTA_URL`/`MOTOR2_CARTA_TOKEN`/`REVALIDATE_SECRET`. `pnpm build && pnpm start -p 3001`.
4. **Abrir `/carta/<tenant>` migrado.** Verificar índice, secciones, disponibilidad, ★ especial, tags, precios, promo, theming sin cambios.
5. **Probar frescura.** Apagar un PV en motor2, revalidar, recargar: ya no está.
6. **Probar que nada más cambió.** Otro tenant sigue con su sheet. `/`, `/carta`, `/carta-demo` no cambian.
7. **Probar el fallback.** Apagar motor2 o token mal puesto: aparece el menú estático de `menu-data.fallback.ts`, sin página de error, con el `console.error` esperado, y el render termina en ~5s (timeout).

**Áreas de motor2 a mirar con atención especial:**
- Guardianes de arquitectura: `disponibilidad-en-un-solo-lugar.test.ts`, `acciones-con-guarda.test.ts` (M9), `menu-con-permiso.test.ts`/`reportes-con-permiso.test.ts` (M7/M10), `region-de-las-funciones.test.ts` (no tocar `vercel.json`).
- Catálogo y disponibilidad: `test/catalogo/disponibilidad-producto*.test.ts`, `productos*.test.ts`, specs e2e de catálogo. Ninguno debería cambiar de resultado.
- Reportes por categoría: `test/reportes/periodo.test.ts`, `catalogo-una-sola-carga.test.ts`. Tienen que salir igual, porque `periodo.ts` no se toca.
- Todo lo nuevo: `test/carta/*`, `test/e2e/api-carta.spec.ts`.

### Archivos críticos para la implementación
- prisma/schema.prisma
- test/setup/test-db.ts
- src/core/catalogo/disponibilidad-producto-consulta.ts (solo lectura, se reusa `whereDisponibleEn`)
- src/core/reportes/periodo.ts (solo lectura, se compone `generarReporteVentasPorCategoria`)
- src/app/api/cron/sincronizar-dolar/route.ts (patrón de autenticación de servicio y de reporte de errores)
- /home/user/restaurant-menu-design/lib/get-menu.ts
- /home/user/restaurant-menu-design/lib/tenants.ts
- /home/user/restaurant-menu-design/app/carta/[sucursal]/page.tsx
