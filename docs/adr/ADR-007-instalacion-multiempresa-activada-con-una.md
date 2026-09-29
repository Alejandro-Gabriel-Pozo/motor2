# ADR-007: Instalación multiempresa-capable, activada con una sola empresa

> Redactado el 2026-09-29. Plan diseñado por el agente `Plan` (opus, skill
> `plan-con-verificacion-e2e`) verificando el código real en `5d0f331`, y
> aprobado por el dueño el mismo día ("te doy el visto bueno": se toman las
> opciones recomendadas de D1-D6 y D9). Amplía ADR-002 y sustituye su frase
> "RLS modelo por modelo, Fase B" (ver "Correcciones a otros ADR"). Este
> documento es el punto de retomada de la Fase F de ADR-006.

## Contexto

**Requisito del dueño:** motor2 se instala ya multiempresa-capable (`Empresa`,
`empresaId`, RLS, resolución por slug/host) pero se activa con UNA sola
empresa, sin fricción (sin subdominios ni DNS wildcard). Sumar una segunda
empresa = dato + configuración, nunca otra migración de estructura. Decisión
"X reemplaza Y" ⇒ aplica a TODAS las capas, sin alcance parcial.

**Contexto de negocio:** el cliente actual pidió solo lo que ya existe (hasta
la carta). La Fase F es inversión propia del dueño para poder lanzar motor2
como producto (SaaS). Un solo repositorio y un solo código; lo que cambia
entre instalaciones es configuración. El cliente actual puede seguir en una
**instalación propia** (su base y su deploy, modo una empresa) y el SaaS ser
otra instalación del mismo código con varias empresas; mudar al cliente al
SaaS más adelante sería un traslado de datos, no un cambio de estructura.
(ADR-002 ya prevé "base dedicada" para una empresa con requisito de
aislamiento.) Nada de la Fase F bloquea la entrega al cliente.

## Estado verificado (código en `5d0f331`)

- `prisma/schema.prisma`: 56 modelos, ninguno con `Empresa`/`empresaId`.
  Unicidades globales que pasan a ser por empresa: `Sucursal.nombre`,
  `Rol.nombre`, `Producto.codigo`, nombres de Insumo, Grupo,
  CategoriaProducto, Unidad, Proveedor, Cliente, MotivoMerma,
  DestinoConsumo, SeccionCarta, ItemAgrupadoCarta, GeneroCarta,
  `SucursalPublica.slug`, los índices manuales `lower(nombre)` y el índice
  parcial `CapacidadSucursal_accionClave_default_key`.
- `src/lib/db.ts`: singleton (PrismaNeon si la URL es de neon.tech, PrismaPg
  si no); 102 archivos lo importan (58 dentro de `src/core/`, 27 en
  `core/reportes`). **`core/` no es puro** respecto de Prisma: solo las
  fachadas `public.ts` lo garantizan (regla `publico-puro`). ~62 archivos usan
  el patrón `db: Db = prisma`; 12 `$transaction`, más
  `conTransaccionSerializable`; 2 consultas SQL directas
  (`costo-historico.ts`, `upsert-proveedor-por-producto.ts`).
- Sesión: `obtenerContextoUsuario` (con `cache()`) lee `UsuarioSucursal` y la
  cookie `sucursalActivaId`; `conPermiso` y `requerirSesion*` lo usan;
  `acceso.ts` (vía 3) y `bootstrap.ts` no tienen noción de empresa.
- Carta: `resolverEmpresaCarta` compara contra `CARTA_EMPRESA_SLUG`;
  `resolverPortalCarta()` no filtra por empresa; `resolverCartaPublica` busca
  `findUnique({slug})` global.
- Tests: el `.env` usa el usuario local `motor2`, que NO es superusuario pero
  sí **dueño** de las tablas (verificado 2026-09-29 en `motor2_dev`/`motor2_e2e`/
  `motor2_demo`); como el RLS es `ENABLE` sin `FORCE`, el dueño lo salta igual
  (un RLS quedaría anulado sin aviso); crear `motor2_app` exige el
  superusuario `postgres` del Postgres local (A0); el reset e2e hace `TRUNCATE` de todas las
  tablas; `npm run build` corre `prisma migrate deploy` contra `DIRECT_URL`.

## Decisión

### Modelo de datos
- **Globales (sin `empresaId`), 7 tablas:** User, Account, Session,
  VerificationToken, Accion (catálogo definido por código), IndicePrecio,
  CotizacionDolar (datos de mercado; los crons no necesitan empresa).
- **Nuevas de plataforma, sin RLS de empresa:** `Empresa` (con `cuit`
  opcional) y `UsuarioEmpresa` (`rolEmpresa String?`, `activo`).
- **Las otras 49 tablas llevan `empresaId NOT NULL`**, hijas incluidas
  (RLS necesita la columna en cada tabla; una política con subconsulta sería
  lenta). Rol, PermisoRol, Unidad, MotivoMerma y DestinoConsumo son **por
  empresa** (D3) porque un admin los edita. `Sucursal.empresaId` es fijo
  (ADR-001: no se muda una sucursal entre empresas).
- Cada tabla declara `@@unique([empresaId, id])` y las referencias son FK
  compuestas `[empresaId, xId]` (ADR-002): una FK simple no pasa por RLS y
  permitiría que una Operación de A apunte a un Proveedor de B. El alcance
  exacto se cerró con el paso A1 (D4): **todas las FK entre tablas por empresa
  son compuestas**, generadas por regla (sin juicio por tabla).
- Unicidades por empresa: todas las de nombre/código de arriba,
  `SucursalPublica.slug` → `@@unique([empresaId, slug])`, y el default de
  CapacidadSucursal → `(empresaId, accionClave) WHERE sucursalId IS NULL`.
  Siguen globales: `SucursalPublica.dominio` (un host, una sucursal),
  `Empresa.slug` y las `claveIdempotencia` (UUID; D10 se resuelve al
  implementar).
- Default de columna: `empresaId @default(dbgenerated("app_empresa_actual()"))`:
  los `create` existentes no pasan `empresaId` y RLS igual verifica el valor.

### Modo «una sola empresa» (D1 = V1)
Función SQL: `app_empresa_actual() = COALESCE(NULLIF(current_setting(
'app.empresa_id', true),''), (SELECT CASE WHEN count(*)=1 THEN min(id) END
FROM "Empresa" WHERE estado='ACTIVE'))`. La migración siembra la empresa por
defecto ACTIVE (id fijo `empresa_principal`). Con **una** empresa activa, seed,
crons, scripts, tests y `/api/carta/*` funcionan sin tocar nada. Con **dos o
más** la función devuelve NULL: lo que no fije contexto devuelve 0 filas o
falla con `NOT NULL` (se equivoca hacia el lado seguro). Sumar la segunda
empresa = script `crear-empresa` (empresa, roles, unidades, motivos, sucursal,
primer admin) + pasarla a ACTIVE: sin migración.

Descartadas: V2 (bandera `esPredeterminada`: el fallback seguiría activo con
varias empresas y una ruta sin contexto escribiría en la empresa por defecto),
V3 (env `EMPRESA_UNICA`: puede no coincidir con la base y exige redeploy para
pasar a varias), V4 (sin fallback: obliga a tocar seed, crons y 292 archivos
de test).

Admin: un solo host, sin subdominio; la empresa activa sale de la sesión
(única membresía, o selector con cookie `empresaActivaId` validada contra
`UsuarioEmpresa`). Carta: por path `/carta-publica/<slug>/…` sin DNS;
`CARTA_DOMINIO_BASE` sigue opcional (el wildcard solo cuando haya 2ª empresa).

### Aislamiento (D2 = `ENABLE` + rol aparte)
- RLS `ENABLE` (sin `FORCE`) con política en las 49 tablas:
  `USING/WITH CHECK ("empresaId" = (SELECT app_empresa_actual()))`.
- Rol de base `motor2_app`: sin superusuario, sin BYPASSRLS, no dueño de las
  tablas; lo usa `DATABASE_URL`. `DIRECT_URL` sigue con el dueño (migraciones,
  limpieza de tests). El rol se crea con un script de operaciones fuera de las
  migraciones; las migraciones solo hacen `GRANT` condicional (bloque `DO`).
- Contexto por request: `dbDeEmpresa(empresaId)` envuelve cada operación en
  una transacción `[set_config('app.empresa_id',$1,true), query]`;
  `transaccionDeEmpresa(empresaId, fn, opts)` para las interactivas. La
  configuración es **local a la transacción** (segura con pgbouncer en modo
  transacción; nunca `SET` de sesión).
- Defensa en la capa de aplicación: (1) "base explícita": se eliminan los
  `= prisma` por defecto, `ctx.db`/`ctx.transaccion` llegan del contexto y
  `tsc` marca lo que falte; (2) regla de dependency-cruiser: solo `core/auth`,
  `lib/auth.ts`, la resolución de carta y `api/cron` pueden importar
  `lib/db.ts` (el tipo `Db` pasa a `lib/db-tipos.ts`);
  (3) `requerirSesionEnSucursal` verifica que la sucursal sea de la empresa
  activa; (4) FK compuestas; (5) autochequeo: si `current_user` es dueño,
  superusuario o BYPASSRLS y hay más de una empresa activa, se niega a operar
  (`crear-empresa` también).

### Migración y backfill
Migración 1 (estructura; un commit) y Migración 2 (RLS; otro commit, D11):
por tabla, columna nullable → backfill a `empresa_principal` → `NOT NULL` +
default + uniques + FK compuestas; completa `UsuarioEmpresa` desde
`UsuarioSucursal`. Cada una con `down.sql` escrito a mano, probada aplicar →
revertir → aplicar, y `prisma migrate diff --from-migrations
--to-schema-datamodel` vacío. Producción: ensayo previo en rama de Neon
copiada de producción, con snapshot; el slug de la empresa por defecto debe
coincidir con el `CARTA_EMPRESA_SLUG` vigente en producción para no romper
links ni QR (D5). Nunca `npm run build` contra producción sin autorización
(migra contra `DIRECT_URL`); antes de cualquier push confirmar que los Preview
de Vercel no apuntan a producción.

### Resolución en runtime
Admin: sesión → `UsuarioEmpresa` → empresa activa → sus sucursales;
`ContextoUsuario` suma `empresaId`, `empresaSlug`, `rolEmpresa`, `empresas[]`,
`db`, y **absorbe** a `contexto-empresa.ts` (D7: no pueden convivir). Carta:
`resolverEmpresaCarta(slug)` consulta `Empresa` ACTIVE; el portal filtra por
esa empresa; la sucursal se busca por `empresaId_slug`;
`CARTA_EMPRESA_SLUG` desaparece de todas las capas (`env.ts`,
`playwright.config.ts`, `.env.example`, `empresaCartaActual`) en el MISMO
commit. `/api/carta/*` heredada no tiene contexto con varias empresas: la
segunda empresa se activa **después de la Fase 8** (D9).

## Pasos (un commit cada uno)

| # | Paso | Requiere autorización | Riesgo | Depende de |
|---|---|---|---|---|
| N1 | Este ADR y correcciones a ADR-004/006 | No | Bajo | — |
| N2 | «Base explícita»: sacar los `= prisma` por defecto, `ctx.db`/`ctx.transaccion` (hoy siguen siendo `prisma`), migrar los 12 `$transaction`, regla de dependency-cruiser; un commit por dominio. **HECHO (local, sin push)**: `c526e12` (base en el contexto: `core/auth/base.ts` `baseDelContexto()`, `Db`/`Transaccion` en `lib/db-tipos.ts`), `8147b0b`, `a3b8d53`, `f986098` (dominios sin `= prisma`; actions con `ctx.db`/`ctx.transaccion`), `850257c` (regla `db-solo-desde-auth-y-carta-publica`, 6 importadores de `lib/db` con motivo). Desvíos: `baseDelContexto()` (lo piden también los crons) y `core/carta/publica-sin-sesion.ts` (único punto público de la carta) no estaban en el plan. Línea base tras N2: arquitectura 0 violaciones (538 módulos), tests 292 archivos / 3422, e2e 379. | No | Medio (diff grande, sin cambio de comportamiento) | — |
| N3 | Carta con empresa por parámetro (`EmpresaCarta` llega a portal y sucursal), todavía con la env. **HECHO (local, sin push)**: `1e8733d` (`resolverPortalCarta(empresa, db)`, `resolverCartaPublica(empresa, slug, db)`, `portalCartaPublico(empresa)`, `cartaPublica(empresa, slug)`; las dos páginas pasan la empresa que ya resolvían). Desvío: `EmpresaCarta` sigue `{ slug }` (el `id` se suma en A3 junto con la lectura de `Empresa`), y la empresa no filtra nada todavía (la base no tiene `empresaId`); el test nuevo (`test/carta/empresa-por-parametro.test.ts`) protege que el parámetro no se corte, demostrado por mutación. Línea base tras N3: arquitectura 0 violaciones (538 módulos), tests 293 archivos / 3427, e2e 379. | No | Bajo | N2 |
| A0 | Crear `motor2_app` en local y e2e, grants, `.env`, `prismaAdmin`; suite verde SIN RLS. **HECHO (local, sin push)**: `e37def9` (rol creado por el dueño con `scripts/operaciones/crear-rol-motor2-app.sql` en `motor2_dev` y `motor2_e2e`; `.env` con `DATABASE_URL`=`motor2_app` y `DIRECT_URL`=dueño; `prismaAdmin` en `test/setup/test-db.ts`; e2e con la variable nueva `MOTOR2_E2E_APP_DATABASE_URL` y guardas; `test/invariantes/rol-de-ejecucion.test.ts`, demostrado por mutación). Se dejan a propósito con el dueño las configs de `motor2_demo` (`playwright.demo.config.ts`, `vitest.*seed*`, `vitest.demo-invariantes`): `motor2_app` no tiene grants ahí. Sin grants faltantes: la suite no necesitó nada más. Línea base tras A0: arquitectura 0 violaciones (538 módulos), tests 294 archivos / 3435, e2e 379. | **EXPRESA** (roles y base local) — otorgada | Medio | N2 |
| A1 | Prueba previa en `prisma/fase-a/` con el objetivo completo (`validate` + `generate`; ver qué pasa con `create`/`connect` ante FK compuestas). **HECHO (local, sin push)**: ``2606c36``. `prisma/fase-a/schema.prisma` ahora se GENERA desde `prisma/schema.prisma` con `prisma/fase-a/generar-schema-objetivo.ts` (56 modelos: 7 globales + 49 con `empresaId`; 94 FK compuestas); la copia anterior estaba desfasada y arrastraba modelos D6 ajenos a la Fase F. `prisma validate` y `prisma generate` pasan. Sonda de tipos `prisma/fase-a/sonda-tipos/` (`npx tsc -p prisma/fase-a/sonda-tipos/tsconfig.json`, demostrada por mutación). Hallazgos: (1) un 1:1 con FK compuesta exige `@@unique([empresaId, xId])` (4 casos: `TemaCartaSucursal`, `SucursalPublica`, `ContenidoCartaProducto`, `OpcionItemAgrupadoCarta`) y `findUnique({ where: { sucursalId } })` deja de compilar; (2) el repo escribe con FK escalares (59 `create`/`createMany`, 0 `connect`): esos patrones compilan SIN pasar `empresaId` (default de la columna) y `connect: { id }` también; (3) compilando el código real contra el Client objetivo: 218 errores de tipo (32 en `src/`, 157 en `test/` —69 archivos—, 25 en `scripts/` y 4 en `prisma/seed.ts`), todos `where` únicos que dejan de existir: ~130 por `nombre`/`slug` pasado a `@@unique([empresaId, …])` (Unidad 86, Rol 22, Sucursal 13, SeccionCarta 4…; independiente de D4) y 46 por los 4 1:1; (4) referential actions: con FK compuesta Prisma no genera `SET NULL` (`empresaId` es NOT NULL): el SQL objetivo tiene 6 CASCADE y 139 RESTRICT, contra 8 CASCADE / 72 RESTRICT / 33 SET NULL hoy. Los borrados reales de padres afectados son `insumo.delete` (tras reapuntar `Producto.insumoId`) y `promoCuenta.delete` (tras borrar sus `CuentaItem`): no rompen, pero A2 debe agregar un test de `promoCuenta.delete` con una `Operacion` asociada. Línea base sin cambios (arquitectura 0 violaciones / 538 módulos, tests 294 archivos / 3435, e2e 379). | **EXPRESA** (schema) — otorgada | Bajo | N1 |
| A2 | Migración 1 + `schema.prisma` + `down.sql` + arreglos de compilación, seed y helpers (por A1: los ~218 `where` únicos a reescribir como `empresaId_nombre`/`empresaId_sucursalId`, o `findFirst`; test de `promoCuenta.delete` con `Operacion`). **HECHO (local, sin push)**: `72d53da` (`prisma/migrations/20260929100000_multiempresa_estructura/` con `migration.sql` y `down.sql`, SIN RLS —eso es A6—; 49 tablas con `empresaId NOT NULL DEFAULT app_empresa_actual()`, 7 globales, 94 FK compuestas, empresa por defecto `empresa_principal` con slug provisorio `principal`, `rolEmpresa` NULL en el backfill de `UsuarioEmpresa`). Verificado sobre una copia de datos locales: aplicar/revertir/aplicar, `migrate diff` vacío, 3.120 operaciones y 14.404 movimientos con `empresaId` de la empresa por defecto. Los 33 `SET NULL` pasaron a `RESTRICT` (efecto real en `insumo.delete` y `promoCuenta.delete`); el test de `promoCuenta.delete` ya no era discriminante y ahora exige `P2003` y que la `Operacion` conserve el vínculo; `test/persistencia/multiempresa-estructura.test.ts` (15 tests), todo demostrado por mutación (rojo, revertido, verde). Se retiran de `prisma/fase-a/` el generador y la sonda de tipos de A1 (el objetivo ya vive en `prisma/schema.prisma`). Línea base tras A2: arquitectura 0 violaciones (538 módulos), tests 295 archivos / 3450, e2e 379. | **EXPRESA** — otorgada | Alto | A0, A1 |
| A3 | Carta desde la base; se elimina `CARTA_EMPRESA_SLUG` en todas las capas. **HECHO (local, sin push)**: `dc4e074` (`resolverEmpresaCarta(slug, db)` lee `Empresa` por slug y solo `ACTIVE`; `EmpresaCarta` pasa a `{ id, slug }`; `resolverPortalCarta` filtra por `empresaId` y `resolverCartaPublica` usa `findUnique` por `empresaId_slug`; `empresaCartaPublica(slug)` en `publica-sin-sesion.ts` (único punto con `prisma`) para las dos páginas públicas; el link del admin (`/carta/portal`) toma la empresa de la sucursal en sesión con `empresaDeSucursalCarta`; variable borrada de `env.ts`, `playwright.config.ts`, `.env.example` y tests; el seed e2e (`asegurarBaseSeed`) crea la empresa con slug `e2e`). Desvíos: no había README ni docs vivos con la variable (solo ADR-006/007 y el comentario de la migración A2, históricos, sin tocar); los comentarios de `alcance.ts` y `precios/sincronizacion.ts` sobre el «schema experimental» siguen siendo ciertos (hablan de tablas D6 que no existen) y solo se corrigió `host.ts`. Las rutas legado `/api/carta/*` siguen sin empresa (D9). Tests: `test/core/carta-empresa-carta.test.ts` reescrito contra la base y 3 tests de aislamiento entre empresas en `test/carta/publica-consulta.test.ts`, todo demostrado por mutación (rojo, revertido, verde). Línea base tras A3: arquitectura 0 violaciones (538 módulos), tests 295 archivos / 3457, e2e 379, knip 0. | No (código) | Medio | A2 |
| A4 | **HECHO (`9548e73`)** — Empresa activa en la sesión (cookie `empresaActivaId` validada contra `UsuarioEmpresa`), selector solo con más de una empresa, `UsuarioEmpresa` en bootstrap/altas de usuarios y sucursales; `ContextoUsuario` absorbe `ContextoEmpresa` (eliminados `contexto-empresa.ts` y `empresaDeSucursalCarta`). `rolEmpresa` quedó NULL en este paso; la regla se decidió después (ver «Decisiones posteriores»): quien crea la empresa, su primer admin, es su «gerente». Línea base: 296 archivos/3469 tests, 539 módulos/0 violaciones, e2e 379, knip 0. | No | Medio | A2 |
| A5 | **HECHO (`22c0541`)** — `dbDeEmpresa`/`transaccionDeEmpresa` (`set_config('app.empresa_id', $1, true)` local a la transacción; el contexto de usuario ya sale de `baseDeEmpresa`), autochequeo del rol de ejecución (se niega con superusuario/BYPASSRLS/dueño y más de una empresa activa) y los dos pendientes de A4 (`empresaId` explícito en la disponibilidad de `crearSucursalConAdmin`; admins activos contados por empresa). Medición local (`scripts/benchmark-reportes.ts`, 1 año de historia, 18.250 compras): ≈ +0,46 ms por operación (0,26 → 0,72 ms) y +3,2 % en `obtenerReportePorPeriodo` (2355 → 2430 ms). Línea base: 298 archivos/3480 tests, 540 módulos/0 violaciones, e2e 379, knip 0. | No | Medio (rendimiento) | A4 |
| A6 | Migración 2: RLS, políticas, grants condicionales, `down.sql` + tests de catálogo | **EXPRESA** | Alto | A5 |
| A7 | Tests de aislamiento + e2e multiempresa + script `crear-empresa` | No (correrlo contra una base real sí) | Bajo | A6 |
| A8 | Producción: ensayo en rama de Neon, rol en Neon, `DATABASE_URL` en Vercel, slug real, push y DNS wildcard (Fase 7). Paso de datos (no migración): la `empresa_principal` de producción ya existía, así que asignar `rolEmpresa = 'gerente'` a su primer admin (el dueño confirma quién; candidato: el usuario ADMIN más antiguo) | **EXPRESA** | Alto | A7 |
| V | Verificación final (abajo) | — | — | todos |

## Impacto en tests
- `test/setup/test-db.ts`: `prismaAdmin` (dueño, `DIRECT_URL`) para la
  limpieza; `limpiarBaseDeTest` borra también `UsuarioEmpresa` y `Empresa`;
  `sembrarBase` crea la empresa ACTIVE; helpers `sembrarSegundaEmpresa()` y
  `comoEmpresa(id)`.
- e2e: `crearPrismaE2E` usa la URL del dueño (`MOTOR2_E2E_DIRECT_URL`) porque
  bajo RLS el conteo de verificación mentiría; `asegurarBaseSeed` crea la
  empresa con slug `e2e` (el `TRUNCATE` también la borra).
- Vitest `test/aislamiento/*` con dos empresas activas: A no ve
  productos/operaciones/cartas de B (lectura, escritura, `updateMany`/
  `deleteMany`, SQL directo); un insert cruzado por FK falla; sin contexto no
  se ve nada. Tests de catálogo: toda tabla no global tiene `empresaId`, RLS y
  política; el rol de ejecución no es superusuario, ni BYPASSRLS, ni dueño.
- e2e `multiempresa-*.spec.ts` (activan B en `beforeAll`, la suspenden en
  `afterAll`; `workers: 1` lo hace seguro): un usuario de B solo ve B;
  `carta.b.localhost` solo el portal de B; un slug de A en el host de B da
  404; un usuario en las dos empresas ve el selector. La suite actual sigue
  corriendo con una sola empresa.

## Verificación final obligatoria (paso V)
Línea de base: arquitectura 535 módulos y 0 violaciones; test 292 archivos /
3421 tests; e2e 379. En la MISMA corrida, todo limpio: `npx tsc --noEmit`
(vacío), `npm run lint` (0/0), `npm run arquitectura` (≥535 módulos, 0
violaciones, sin bajar severidades ni excepciones sin motivo),
`npm run analizar:muerto` (0 hallazgos; quitar de `knip.jsonc` las entradas de
`prisma/fase-a/` si se borra la carpeta), `npm test` (≥292/3421, con el rol
`motor2_app`), `npm run build` (base local autorizada), `npm run test:e2e`
(≥379). Demostraciones por mutación (rojo → revertir → verde), cada una en su
commit: (a) `DISABLE ROW LEVEL SECURITY` en `Producto` rompe el test de
aislamiento; (b) FK compuesta → simple rompe el test de insert cruzado;
(c) quitar la política de una tabla rompe el test de catálogo;
(d) `DATABASE_URL` al superusuario rompe el test de rol; (e) en e2e, sacar el
filtro de empresa de `resolverPortalCarta` **sigue verde** porque RLS sostiene
el aislamiento, y se pone rojo si además se desactiva RLS en la base e2e. Mirar
con atención: e2e `carta-*`, `api-carta*`, `permisos-matriz-guardar`,
`enlaces-con-permiso`, `*-sesion-vencida`, `servidor-en-modo-produccion`, y
`test/auth`, `test/permisos`, `test/reportes`, `test/arquitectura`.

## Decisiones del dueño (2026-09-29)
- **D1** V1 (fallback a la única empresa activa). **D2** RLS `ENABLE` + rol
  `motor2_app` aparte. **D3** Rol, PermisoRol y Unidad por empresa.
  **D4** cerrada con A1: FK compuestas en TODAS las tablas por empresa (ver A1: el costo extra frente a «solo catálogo» son 46 errores de tipo por 4 relaciones 1:1 y el paso de SET NULL a RESTRICT; el grueso, ~130, viene de las unicidades por empresa y no depende de D4). **D5** el slug de la empresa por defecto = el
  `CARTA_EMPRESA_SLUG` de producción. **D6** `AlcanceCarta` (+ tablas puente),
  `GrupoSincroPrecio` y `PrecioLocalProducto.sincronizado` son funciones nuevas
  del producto, no multiempresa: quedan FUERA de la Fase F. **D7** el
  `ContextoUsuario` absorbe a `ContextoEmpresa`. **D9** la segunda empresa se
  activa después de la Fase 8. **D8, D10, D11** se resuelven al implementar
  (D11: A2 y A6 como dos commits).

## Correcciones a otros ADR (incoherencias halladas)
1. El schema experimental (`prisma/fase-a/schema.prisma`) pone `empresaId` solo
   en Sucursal y 5 tablas de carta/precio; deja el catálogo y las operaciones
   globales, lo que contradice ADR-001/002. Es un experimento, no el objetivo:
   el objetivo es el de este ADR.
2. `SucursalPublica.slug` es global en el schema experimental (pendiente ya
   anotado): pasa a único por empresa.
3. ADR-002 dice "RLS modelo por modelo, Fase B"; choca con la regla de "todas
   las capas". **Reemplazado:** RLS en las 49 tablas a la vez (Migración 2).
4. ADR-004 nombra `smoke-test.mjs`; el archivo es `smoke-test.ts` (corregido).
5. La migración experimental siembra el slug `empresa-por-defecto`, que no
   coincide con `CARTA_EMPRESA_SLUG` (ver D5).
6. Comentarios en `schema.prisma` y `bootstrap.ts` dicen «NO multi-tenant»:
   se corrigen en A2/A4.
7. El supuesto de "consultas de `core/` puras" no se cumple (58 archivos de
   `core/` usan Prisma): por eso N2 y la regla de dependency-cruiser.
8. `contexto-empresa.ts` dice que 88 archivos consumen `ContextoUsuario`; hoy
   lo mencionan ~112.

## Decisiones posteriores (2026-09-29)
1. **`rolEmpresa`**: quien crea la empresa (en el bootstrap, su primer admin) es
   su «gerente» (`UsuarioEmpresa.rolEmpresa = 'gerente'`, ADR-001: gestiona
   usuarios y asignaciones de la empresa). El bootstrap no pisa un rol que el
   usuario ya tuviera. Los demás usuarios siguen con `rolEmpresa` NULL (sin rol
   a nivel empresa) hasta que un gerente les asigne uno.
2. **Borrados bajo FK compuestas (RESTRICT)**: `insumo.delete` (fusión de
   insumos) y `promoCuenta.delete` (quitar promo sin enviar) pasan a archivar
   (`activo = false`) en vez de borrar. Pendiente de implementar como paso
   propio, con su gate.
3. **`obtenerCostoActualPorMP`**: pasó de `findMany` con `include` sobre toda la
   historia a una consulta `DISTINCT ON (productoId)` (una fila por producto,
   desempate por `m.id`). Con ~55.000 compras la versión anterior superaba el
   límite de parámetros de Prisma 7 (o, en el test de volumen, no terminaba en
   60 s); el test `costo-actual-mp-volumen.test.ts` lo reproduce y falla con la
   implementación vieja.
4. **Índice en el kardex por proceso y producto — medición** (Postgres 17 local,
   base descartable, 1 sucursal, 150 MP + 20 PV, ≈ 2,2 M movimientos/año a
   550.000 operaciones/año; A = sin índice nuevo, B = parcial
   `("productoId") WHERE "proceso" = 'COMPRA'`, C = completo
   `("productoId", "proceso")`):

   | | 1 año A / B / C | 3 años A / B / C |
   |---|---|---|
   | Costo actual (`obtenerCostoActualPorMP`) | 229 / 132 / 198 ms | 610 / 435 / 575–750 ms |
   | Compras de UN producto (`periodo-precios`) | 94 / 0,8 / 2,4 ms | 250 / 2,4 / 4,1 ms |
   | Tamaño del índice | — / 0,2 / 16 MB | — / 0,5 / 46 MB |
   | Insertar 100.000 movimientos | 7,77 / 7,84 / 8,12 s | 8,03 / 8,07 / 8,38 s |

   Conclusión: el índice completo casi no ayuda (el planificador ni lo usa para
   el costo actual) y cuesta 46 MB a 3 años (Neon: 512 MB por rama); el
   **parcial** pesa < 1 MB, no encarece la escritura (≈ +1 %) y reduce 100×
   las búsquedas de compras por producto. Recomendación: agregar el parcial, en
   una migración manual (Prisma no expresa índices parciales; precedente:
   `CapacidadSucursal_accionClave_default_key`), con autorización EXPRESA. El
   costo actual sigue dominado por ~54.000 búsquedas en `Operacion` (una por
   compra): el próximo escalón sería otra forma de la consulta, no otro índice.

## Riesgos abiertos
Rendimiento (cada consulta suma BEGIN + `set_config` + COMMIT; se mide en A5
con `scripts/benchmark-reportes.ts`); el adaptador PrismaNeon hay que
verificarlo en A8; los tipos de Prisma cambian con las FK compuestas; un
Preview de Vercel podría migrar producción si apunta a esa base.
