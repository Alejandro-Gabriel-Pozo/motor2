# Plan: el registro de tenants de restaurant-menu-design (la tab "tenant" de la sheet maestra) pasa a vivir en motor2

Entregado por un agente de planificación (Opus) el 2026-09-24. Base:
motor2 en `2d92a90` (carta M1-M10 ya mergeada) y restaurant-menu-design
en `29e533b` (R0-R3 de carta ya mergeados). Sigue el molde de
`docs/plan-carta-catalogo-2026-09-24.md`: un endpoint de solo lectura en
motor2 y restaurant-menu-design que lo consume con fallback, pasando
tenant por tenant.

**Decisiones confirmadas por el dueño (2026-09-24):**
- D9: SÍ se hace la pantalla de administración (M6+M7).
- Desactivar una sucursal en motor2 también la saca del portal público
  (`activo = publicada && Sucursal.activo`) — comportamiento aceptado:
  motor2 es la fuente de verdad, las sheets ya no importan más que como
  modelo/respaldo transicional.
- Sobre `dominio`: se migra como campo manual (por si sirve alguna vez),
  pero **sin implementar el ruteo raíz-sin-prefijo** — el dueño prefiere
  que todo siga mostrándose como `/carta/<slug>`. El "ruteo por dominio"
  (D10) queda confirmado fuera de alcance de este pendiente.

---

## A. Lo que cambia respecto de la descripción del pedido

1. **La trampa de `sheet_id` es más grande de lo que se describió.** No alcanza con los tenants que todavía leen su menú de la sheet. `app/carta/[sucursal]/page.tsx:33` llama a `getConfig(tenant.sheet_id)` para **todos** los tenants, también los que ya leen el menú de motor2. El theming (`SiteConfig`, tab `Config`) sigue en la sheet de cada tenant, y el grounding §2.2/§8 lo deja como decisión abierta.
   - Por lo tanto, `sheet_id` es obligatorio para cualquier tenant publicado mientras `SiteConfig` siga en las sheets.
   - `sheet_name` es otra cosa. Es el nombre de la tab del **menú** y solo se usa en `getMenu(tenant.sheet_id, tenant.sheet_name)` dentro de `getMenuForTenant`, en la rama sin `motor2_sucursal_id` (`lib/get-menu.ts`, final del archivo). `getConfig` usa siempre la tab fija `"Config"`.
   - Otro detalle: `getConfig(undefined)` cae a `MENU_SHEET_ID`, así que un tenant sin `sheet_id` tomaría **en silencio** el theming de la sheet raíz. Hoy eso no pasa porque `getTenants()` descarta las filas sin `sheet_id` (`if (!tenantId || !sheetId) return null`). Esa regla hay que conservarla.
2. **`getTenantByDomain` no tiene ningún llamador** (buscado en todo el repo).
3. **`dominio` hoy no tiene ningún efecto.** `proxy.ts` pone `x-tenant-id` en el request, pero ningún archivo lo lee: no hay `headers()` en `app/`, `components/` ni `lib/`. Así que el ruteo por dominio está a medio construir y el campo es un dato muerto. Igual se migra como campo manual, que es lo que pide el dueño y cuesta una columna, pero no hay nada que verificar de ruteo por dominio.
4. **Confirmado: `proxy.ts` lee la tab `Tenants` y `lib/tenants.ts` lee `tenant`.** `app/api/debug-tenants/route.ts` también lee `Tenants`. El commit `7192122` ("fix: sheet tab name Tenants -> tenant") corrigió `lib/tenants.ts` y dejó los otros dos. Como `x-tenant-id` no lo lee nadie, hoy la inconsistencia no se nota. Qué se hace con esto está en D10 (fuera de alcance).
5. **`notas` se muestra en público.** `app/page.tsx:163-171` y `:212-217` lo dibujan como subtítulo de la tarjeta del portal, en el mapa y en la grilla. En cambio `docs/setup-sucursal.md` lo describe como "documentación viva: estado, responsable, fecha de alta", con el ejemplo "✅ Alta completa 2026-08-11". Si alguien sigue esa guía, publica notas internas. En motor2 el campo se llama por lo que hace (D11).
6. **Si la lista queda vacía, el portal cambia de modo.** `app/page.tsx:24`: `tenants.length === 0` activa el "modo single", que muestra en `/` el menú de `MENU_SHEET_ID`. Si motor2 devuelve `[]` y eso se tomara como la lista completa, el portal cambiaría de modo sin avisar. La combinación de D7 lo evita: una lista vacía de motor2 significa "ningún tenant migrado todavía".
7. **El orden de las filas de la sheet es visible.** La grilla de respaldo del portal dibuja los tenants en el orden del array. motor2 necesita un campo `orden`, y al combinar hay que respetar la posición que cada tenant tiene hoy.
8. **motor2 permite renombrar una sucursal** (`renombrarSucursal`, `src/server/actions/auth/sucursales.ts`). Si el slug se calculara en vivo desde `Sucursal.nombre`, renombrar cambiaría la URL pública `/carta/<slug>` y rompería los links y QR ya repartidos. Además, `Sucursal.nombre` es `@unique` distinguiendo mayúsculas, así que nombres distintos pueden dar el mismo slug ("Villa La Angostura" y "Villa la Angostura", "Piñón" y "Pinon"). Ver D2.
9. **No hace falta un permiso nuevo.** La acción `carta` ya existe (M8 de carta, migración `20260924153615_permiso_carta`). Reusarla evita un segundo paso de migración de datos con autorización.
10. **Ya existen los guardianes y los fixtures que hay que extender:**
    - `test/arquitectura/carta-solo-lectura.test.ts` cubre `src/core/carta/**` y `src/app/api/carta/**`. Además restringe las actions de `src/server/actions/carta/` a 4 tablas, así que hay que sumar la quinta.
    - `limpiarBaseDeTest` borra la carta primero.
    - El reset E2E (`test/e2e/fixtures/base-e2e.ts:130`) hace `TRUNCATE … CASCADE`, así que ahí no se toca nada.
    - `TOKEN_CARTA_E2E` ya está en `playwright.config.ts` (`webServer.env`).
11. **Las cachés no cambian.** `fetchGviz` ya cachea la tab `tenant` con `revalidate: 300`, que es lo mismo que usaría el fetch a motor2. El `revalidate` efectivo de `/` y `/carta/[sucursal]` queda igual.
12. **restaurant-menu-design sigue sin Vitest ni Playwright.** Se verifica con lint, build y tsc informativo, más la prueba manual, igual que en el plan de carta.

---

## B. Decisiones de diseño (con recomendación)

| # | Decisión | Recomendación |
|---|---|---|
| D1 | ¿Tabla aparte o columnas en `Sucursal`? | **Tabla nueva `SucursalPublica`, 1:1 con `Sucursal`** (`sucursalId @unique`), con el mismo patrón que `ContenidoCartaProducto`↔`Producto`. |
| D2 | Slug (`tenant_id`) | **Se genera una sola vez y queda guardado.** Al agregar la sucursal al portal se calcula `slugTenant(Sucursal.nombre)`: NFD sin diacríticos (mismo criterio que `normalizarNombreGrupo` en `src/core/catalogo/no-comestibles.ts`), minúsculas, todo lo que no sea `[a-z0-9]` pasa a `-`, se colapsan los guiones, se recortan los extremos y se corta en 60 caracteres. Si queda vacío, vale `"sucursal"`. Si choca con un slug ya guardado, se le agrega `-2`, `-3`, etc. Se guarda en `slug @unique` y **nunca se recalcula**. **Se puede editar a mano** con la validación `^[a-z0-9]+(-[a-z0-9]+)*$` y unicidad. |
| D3 | Opt-in | **Sin fila en `SucursalPublica` = no está en el registro de motor2.** Ese tenant sigue en la sheet si tiene fila ahí. `publicada` arranca en `false`. El `activo` que se publica es `publicada && Sucursal.activo`. |
| D4 | Qué expone el endpoint | **Un solo `GET /api/carta/tenants` con la lista completa**, incluidas las filas no publicadas con `activo: false`. No hay versiones por slug ni por dominio. |
| D5 | Autenticación | **El mismo `CARTA_API_TOKEN` y el mismo `tokenDeServicioValido`.** El bloque de autorización se extrae a un helper compartido por las dos rutas, sin cambiar lo que responde `[sucursal]`. |
| D6 | Contrato | **Forma propia y versionada (`version: 1`), en camelCase**, convertida en restaurant-menu-design a `Tenant` con un mapper. `motor2_sucursal_id` se arma del lado de la carta: vale `sucursalId` solo si `menuDesdeMotor2` es `true`. |
| D7 | Cómo conviven sheet y motor2 | **Tenant por tenant, combinando por `tenant_id`, y motor2 gana.** `getTenants()` lee las dos fuentes en paralelo. Un `tenant_id` que motor2 conoce (publicado o no) toma **toda** la fila de motor2, incluido `activo: false`. Los demás siguen con la fila de la sheet. Orden: migrados reemplazan su fila en el mismo lugar; los que solo existen en motor2 van al final por `orden`, `label`. Si motor2 falla → solo la sheet (comportamiento de hoy). Sheet = respaldo mientras dure la transición. |
| D8 | `sheet_id`/`sheet_name` | **Siguen existiendo como campos manuales y de transición dentro de `SucursalPublica`**: `sheetId String?` y `sheetMenuNombre String @default("Menu")`. `sheetId` obligatorio para publicar mientras `SiteConfig` siga en las sheets. |
| D9 | ¿Pantalla en motor2? | **SÍ — confirmado por el dueño.** M6 (Server Actions) + M7 (pantalla `/catalogo/carta/portal`). |
| D10 | `proxy.ts` (tab `Tenants`) y ruteo por dominio | **Fuera de alcance, confirmado por el dueño** — prefiere que todo siga como `/carta/<slug>`. Pasar `proxy.ts` a motor2 metería un fetch en el camino de cada request para un header que nadie lee. Queda anotado en ARCHITECTURE.md como pendiente aparte, sin decidir si se completa o se elimina. |
| D11 | `notas` | En motor2 se llama **`subtituloPortal String?`**. El endpoint lo emite como `subtitulo` y el mapper lo pone en `notas`, así los componentes no se tocan. |

---

## C. Paso 0: línea de base (antes de tocar nada)

**motor2** (`/home/user/motor2`, checkout principal — sin worktree, no hay otra implementación corriendo en paralelo):
- Bases locales nuevas: `motor2_tenants` (dev) y `motor2_tenants_e2e` (e2e), usuario `motor2`/`motor2`, Postgres local puerto 5432.
- `.env` local con `DATABASE_URL`/`DIRECT_URL` a `motor2_tenants`, `MOTOR2_E2E_DATABASE_URL` a `motor2_tenants_e2e`, `AUTH_SECRET` (`npx auth secret` o `openssl rand -base64 32`), `CARTA_API_TOKEN` para pruebas locales.
- Migrar las dos bases con `DIRECT_URL=... npx prisma migrate deploy`.
- Correr y anotar antes de tocar nada: `npx tsc --noEmit` (ruido esperado: `LayoutProps`), `npm run lint`, `npm test` (Test Files/Tests), `npm run build`, `npm run test:e2e` (N passed, confirmar `[e2e] Servidor: build`).

**restaurant-menu-design** (`/home/user/restaurant-menu-design`):
1. `pnpm lint` — tendría que andar limpio después del R0 de carta.
2. `pnpm build` — sin `MASTER_SHEET_ID`, `getTenants()` devuelve `[]` y buildea en modo single.
3. Extra informativo: `npx tsc --noEmit` (anotar cuántos errores hay).

---

## D. Pasos de implementación (un commit por paso, en orden)

### motor2

**M1 — Schema y migración. REQUIERE AUTORIZACIÓN EXPRESA. Aplicar solo contra las bases locales, nunca contra Neon/producción.**

En `prisma/schema.prisma`, dentro de la sección `// CARTA`, después de `PromoCarta`:

```prisma
/// Registro público de una sucursal en el portal/carta (lo que hoy es una fila de la tab "tenant" de la sheet maestra de
/// restaurant-menu-design). FILA AUSENTE = esta sucursal no está en el registro de motor2 (opt-in; sin backfill).
model SucursalPublica {
  id               String   @id @default(cuid())
  sucursalId       String   @unique
  sucursal         Sucursal @relation(fields: [sucursalId], references: [id])
  /// tenant_id / URL /carta/<slug>. Se genera UNA vez desde Sucursal.nombre (slugTenant) y se puede editar; nunca se recalcula.
  slug             String   @unique
  /// null = se usa Sucursal.nombre.
  etiqueta         String?
  /// Host desnudo, sin esquema ni puerto (hecho externo, manual). NULL no choca con el @unique en Postgres.
  dominio          String?  @unique
  /// Público: subtítulo de la tarjeta del portal (restaurant-menu-design lo dibuja como `notas`).
  subtituloPortal  String?
  /// Posición en el mapa del portal, % 0-100 (centro). x/y/w van juntos; h opcional (la carta usa 5).
  posX             Decimal? @db.Decimal(5, 2)
  posY             Decimal? @db.Decimal(5, 2)
  posW             Decimal? @db.Decimal(5, 2)
  posH             Decimal? @db.Decimal(5, 2)
  orden            Int      @default(0)
  publicada        Boolean  @default(false)
  /// true = el menú sale de GET /api/carta/[sucursal] (se emite motor2_sucursal_id); false = de la tab `sheetMenuNombre`.
  menuDesdeMotor2  Boolean  @default(false)
  /// TRANSICIÓN: spreadsheet del tenant. Hace falta mientras SiteConfig (tab Config) viva en la sheet — para TODOS los tenants.
  sheetId          String?
  /// TRANSICIÓN: tab del menú en esa sheet; solo importa con menuDesdeMotor2 = false.
  sheetMenuNombre  String   @default("Menu")
  actualizadoEn    DateTime @updatedAt
}
```

- Única línea en `model Sucursal`: `publica SucursalPublica?` (1:1, opcional).
- Sin `onDelete: Cascade`: RESTRICT, porque las sucursales nunca se borran.
- `Decimal(5,2)` para los porcentajes (precedente: `mermaPorcentaje Decimal(6,2)`).
- `npx prisma migrate dev --create-only --name carta_registro_tenants`. Revisar: 1 `CREATE TABLE`, 3 índices únicos (`sucursalId`, `slug`, `dominio`), 1 FK, sin backfill. Aplicar con `npx prisma migrate dev`.
- **Mismo commit:** `test/setup/test-db.ts::limpiarBaseDeTest` → sumar `await prisma.sucursalPublica.deleteMany();` al bloque de carta, antes de `promoCarta`, y antes de `sucursal.deleteMany()`.
- Chequeo: `npx tsc --noEmit` y `npm test` completos, sin cambios de resultado.

**M2 — `src/core/carta/registro-tenants.ts`: lógica pura, sin Prisma.**
- `slugTenant(nombre)` y `slugTenantUnico(base, ocupados: ReadonlySet<string>)` con sufijos `-2`, `-3`, etc.
- Tipos `RegistroTenantsV1 = { version: 1; generadoEn: string; tenants: TenantV1[] }` y `TenantV1 = { slug, etiqueta, dominio: string|null, subtitulo: string|null, posicion: {x,y,w,h: number|null} | null, orden, activo, sucursalId, menuDesdeMotor2, sheetId: string|null, sheetMenuNombre }`.
- `armarRegistroTenants(filas, ahora)`: `etiqueta ?? sucursal.nombre`; `activo = publicada && sucursal.activo`; `posicion = null` si falta x, y o w; `Decimal → Number()`; orden por `orden` y después `etiqueta` (`localeCompare("es")`); sanitiza salida (slug/sheetId/dominio inválidos → fila descartada o campo anulado según gravedad, cubre cargas por `db:studio`).
- Validadores nuevos en `src/core/carta/validaciones.ts` (ya existe): `validarSlugTenant`, `validarDominioPublico` (normaliza `https?://`, `/` final, puerto, minúsculas, valida hostname), `validarSheetId` (`^[A-Za-z0-9_-]{20,128}$`), `validarNombreTabSheet` (1-100 caracteres), `validarPosicionPortal` (0-100, 2 decimales, x/y/w todos o ninguno), largo de `etiqueta`/`subtituloPortal` con `validarTextoLibreCarta`.
- Test nuevo, puro: `test/carta/registro-tenants.test.ts`. Casos: tildes/ñ ("Piñón"→`pinon`), `&`, espacios múltiples, vacío→`sucursal`, corte a 60; colisiones ("Villa La Angostura"/"Villa la Angostura" → `villa-la-angostura`, `villa-la-angostura-2`); tabla de verdad de `activo`; posición parcial→`null`; saneamiento de filas inválidas; orden.

**M3 — `src/core/carta/registro-consulta.ts`: lectura con Prisma, nunca escribe.**
- `resolverRegistroTenants(db = prisma, ahora)`: un solo `sucursalPublica.findMany({ select: { …, sucursal: { select: { id, nombre, activo } } } })` + `armarRegistroTenants`.
- Test nuevo, contra Postgres: `test/carta/registro-consulta.test.ts`. Casos: sin filas → `[]`; solo sucursales con fila; inactiva → `activo:false`; no publicada → `activo:false` (aparece igual); `menuDesdeMotor2`/`sucursalId` tal cual; la consulta es exactamente una.

**M4 — Endpoint `src/app/api/carta/tenants/route.ts`.**
- Antes de escribir: confirmar en `node_modules/next/dist/docs` (Next 16.3.5) la precedencia del segmento estático sobre `[sucursal]` y la firma de `GET` sin params.
- Extraer el preámbulo de autenticación de `[sucursal]/route.ts` a un helper compartido (`autorizarServicioCarta`). `[sucursal]` tiene que seguir respondiendo **exactamente** lo mismo: `test/carta/api-carta.test.ts` y `test/e2e/api-carta.spec.ts` sin cambios.
- Flujo: autorización (401 si falta variable con `reportarErrorUnaVez`, o token no coincide) → `resolverRegistroTenants()` → 200 con `Cache-Control: no-store` → excepción → `reportarError` + 500 genérico.
- Solo `GET`. **Lista vacía es 200 `{ tenants: [] }`**, no 404. No expone diagnóstico ni campos internos.
- `.env.example`: ampliar el comentario de `CARTA_API_TOKEN`. `vercel.json` no se toca.
- Test nuevo: `test/carta/api-carta-tenants.test.ts`. Casos: sin header/token incorrecto/variable ausente → 401; base vacía → 200 `[]`; 200 con fila publicada y no publicada, `version===1`, sin claves internas; `typeof posicion.x === "number"`.
- Guardián `carta-solo-lectura.test.ts`: sumar `"app/api/carta/tenants/route.ts"` y `"core/carta/registro-consulta.ts"`.

**M5 — E2E del endpoint en el build de producción.**
- Spec nuevo: `test/e2e/api-carta-tenants.spec.ts`. Casos: 401 sin token; 200 con token y `tenants: []` sobre base recién sembrada (prueba que la ruta estática no cae en `[sucursal]`); 200 con una `SucursalPublica` sembrada para "Central" (borrada en `finally`); 405 para POST.

**M6 — Server Actions del registro.**
- `src/server/actions/carta/registro-publico.ts`, todas con `conPermiso("carta", …)`:
  - `agregarSucursalAlPortal(sucursalId)`: crea la fila con `slugTenantUnico(slugTenant(nombre), slugs existentes)`. Ante P2002 por carrera, reintenta con el siguiente sufijo o error claro.
  - `guardarSucursalPublica(id, datos)`: aplica los validadores de M2. Rechaza `publicada=true` sin `sheetId`. Dominio/slug ya usados → error con nombre.
  - `quitarSucursalDelPortal(id)`: borra la fila (vuelta atrás por tenant de D7).
- Guardián: sumar `"sucursalPublica"` a `TABLAS_DE_CARTA` en `carta-solo-lectura.test.ts`.
- Tests nuevos: `test/carta/acciones-registro-publico.test.ts`. Casos: permiso, slug derivado, colisión, edición manual del slug, validaciones dominio/sheetId/posición, publicar sin sheetId → error, quitar deja la tabla sin la fila.

**M7 — Pantalla `src/app/(app)/catalogo/carta/portal/page.tsx`.**
- Protegida con `requierePermisoVer(..., "carta")`.
- Tabla con **todas** las sucursales (el mapa es entre sucursales, no depende de la activa): sin fila → botón "Agregar al portal"; con fila → `<details>` con el formulario (slug, etiqueta, dominio, subtítulo, posición x/y/w/h, orden, publicada, menú desde motor2, sheet id y tab de menú), los campos de transición agrupados bajo "Mientras la carta use Google Sheets".
- Mismo estilo que `/catalogo/carta`: `FormConResultado`, closures que solo capturan ids, `refrescarVistaSiHaceFalta` si sale bien.
- Agregar `{ href: "/catalogo/carta/portal", label: "Portal de sucursales", accion: "carta" }` en `src/core/navegacion/estructura.ts`. Agregar la ruta en `test/e2e/rutas-sin-parametros.ts`. Spec nuevo `test/e2e/carta-portal-admin.spec.ts` (agregar, colisión de slug visible, guardar dominio/posición). **Chequeo de axe** en `test/e2e/accesibilidad.spec.ts` con un formulario abierto.

### restaurant-menu-design (`/home/user/restaurant-menu-design`)

**R0 — Solo si la línea de base mostrara el lint roto otra vez.**

**R1 — Tipos, guardia y mapper puros, sin cambios de comportamiento.**
- `lib/tenants-motor2.ts` (`import "server-only"`): `RegistroTenantsMotor2V1`/`TenantMotor2V1` (espejo de M2), `esRegistroTenantsMotor2V1(x)` a mano, `tenantMotor2ATenant(t): Tenant | null` (mapea `tenant_id=slug`, `label=etiqueta`, `dominio=dominio??""`, `sheet_id=sheetId??""`, `sheet_name=sheetMenuNombre||"Menu"`, `activo`, `notas=subtitulo??undefined`, `pos_*` desde `posicion`, `motor2_sucursal_id=menuDesdeMotor2?sucursalId:undefined`; `null` si falta `sheetId`).
- Opcional en el mismo commit: mover `motor2Configurado`/base/token a `lib/motor2.ts`, reusado por `carta-motor2.ts` (sin cambiar comportamiento).

**R2 — `getTenants()` combina motor2 con la sheet, con fallback.**
- `lib/tenants.ts`: la lectura actual pasa sin cambios a `leerTenantsSheet()` (devuelve `[]` sin `MASTER_SHEET_ID`); `fetchRegistroMotor2()` hace fetch con `Authorization`, `revalidate: 300`, `AbortSignal.timeout(5000)`, lanza ante error; `leerTenantsMotor2()` devuelve `null` si no configurado o falla (con `console.error`).
- `combinarTenants(sheet, motor2)`, pura: si `motor2===null` → sheet tal cual; si no, los `tenant_id` que motor2 conoce toman su fila (en el mismo lugar de la sheet), los que solo están en motor2 van al final por `orden`/`etiqueta`; filtra `null` (sin sheet_id) y `activo===true` al final.
- `getTenantBySlug`/`getTenantByDomain` no cambian. `git diff --stat` vacío en `app/`, `components/`, `lib/get-menu.ts`, `lib/carta-motor2.ts` (salvo refactor opcional de R1) y `proxy.ts`.

**R3 — Documentación.**
- `docs/setup-sucursal.md`: sección "Registro desde motor2" (dónde se carga, que motor2 gana por `tenant_id`, que el slug debe igualar el `tenant_id` de la sheet al migrar, no borrar la fila de la sheet, "Quitar del portal" = vuelta atrás, `sheet_id` sigue obligatorio). Corregir la descripción de `notas` (es pública).
- `ARCHITECTURE.md` §3.6: subsección "Registro de tenants: sheet o motor2", con nota sobre D10 (proxy.ts/debug-tenants leen "Tenants", ruteo por dominio sin conectar, pendiente aparte, no se implementa acá).
- `docs/templates/template-hoja-raiz.csv`: comentario.

**R4 — Operación, no código (fuera de alcance).** Por cada tenant: "Agregar al portal" → editar slug para igualar el `tenant_id` de la sheet → copiar etiqueta/dominio/sheet_id/sheet_name/subtítulo/pos_*/orden → `menuDesdeMotor2=true` si corresponde → publicar → `/api/revalidate?all=1`. La baja definitiva de la tab `tenant` es decisión aparte del dueño.

---

## E. Riesgos y temas abiertos (ninguno bloquea)

- Fila de la sheet desactualizada sirve de respaldo si motor2 falla (aceptable, mismo criterio que el menú de respaldo).
- Sin aviso automático desde motor2 al revalidar — hasta 5 min de atraso o revalidar a mano.
- `generateStaticParams` del build de restaurant-menu-design pasa a consultar motor2; si no responde, usa la sheet.
- Mismo dominio en las dos fuentes → `getTenantByDomain` devuelve el primero (hoy sin efecto real, D10).
- **Confirmado y aceptado por el dueño:** desactivar una sucursal en motor2 la saca del portal.

---

## F. Verificación end-to-end final (obligatoria)

**Criterio de cierre:** todos los comandos siguientes pasan limpios **en la misma corrida**, con las bases locales del Paso 0, después del último commit.

**motor2** (bases `motor2_tenants`/`motor2_tenants_e2e` locales, nunca Neon/producción):

| Comando | Criterio |
|---|---|
| `npx tsc --noEmit` | Vacío salvo el ruido de `LayoutProps` que ya estaba |
| `npm run lint` | 0 errores, 0 warnings nuevos |
| `npm test` (suite ENTERA) | Todo verde. Tests ≥ línea de base + `registro-tenants.test.ts`, `registro-consulta.test.ts`, `api-carta-tenants.test.ts`, `acciones-registro-publico.test.ts` |
| `npm run build` | Aplica `carta_registro_tenants` sin errores. `/api/carta/tenants` y `/api/carta/[sucursal]` como rutas dinámicas (ƒ) |
| `npm run test:e2e` (suite ENTERA) | Todo verde. Specs ≥ línea de base + `api-carta-tenants.spec.ts`, `carta-portal-admin.spec.ts`, el chequeo de axe nuevo |

**restaurant-menu-design:**

| Comando | Criterio |
|---|---|
| `pnpm lint` | 0 errores |
| `pnpm build` | `next build` limpio, sin variables de motor2 y también con ellas |
| Extra: `npx tsc --noEmit` | Errores ≤ línea de base y ninguno en `lib/tenants.ts`, `lib/tenants-motor2.ts` (ni `lib/motor2.ts`/`carta-motor2.ts` si se hizo el refactor de R1) |

**Verificación manual:** curl al endpoint (401/200/404/405), portal con motor2 apagado/token malo (fallback a la sheet), colisión de slugs con "Villa La Angostura"/"Villa la Angostura", vuelta atrás con "Quitar del portal", motor2 configurado pero sin filas (sin cambio de modo).

**Áreas a mirar con atención especial:** `carta-solo-lectura.test.ts` (archivos nuevos y la 5ta tabla), `acciones-con-guarda.test.ts`, `menu-con-permiso`/`enlaces-con-permiso`/`reportes-con-permiso.test.ts`, `region-de-las-funciones.test.ts` (no tocar `vercel.json`), `test/carta/api-carta.test.ts` y `test/e2e/api-carta.spec.ts` (tienen que salir IDÉNTICOS — prueban que extraer el helper de auth no cambió `[sucursal]`), tests de `src/server/actions/auth/sucursales.ts` (altas/renombres/desactivaciones no deben romperse por la relación nueva).

### Archivos críticos
- prisma/schema.prisma (`model Sucursal`, sección `// CARTA`)
- test/setup/test-db.ts
- src/app/api/carta/[sucursal]/route.ts y src/core/carta/token-servicio.ts (autenticación a extraer y reusar)
- test/arquitectura/carta-solo-lectura.test.ts
- src/server/actions/auth/sucursales.ts (`renombrarSucursal`)
- /home/user/restaurant-menu-design/lib/tenants.ts
- /home/user/restaurant-menu-design/lib/get-menu.ts (`getMenuForTenant`, no se toca)
- /home/user/restaurant-menu-design/app/carta/[sucursal]/page.tsx (`getConfig(tenant.sheet_id)`)
- /home/user/restaurant-menu-design/app/page.tsx (modo single, orden de grilla, `notas` público)
- /home/user/restaurant-menu-design/proxy.ts (fuera de alcance, D10)
