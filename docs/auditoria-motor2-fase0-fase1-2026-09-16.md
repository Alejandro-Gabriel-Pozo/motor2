# Auditoría motor2 — Entrega obligatoria: Fase 0 + Fase 1 + comparación preliminar

Fecha: 2026-09-16. Alcance: repositorio `motor2` (Next.js 16 + Prisma 7 + Postgres/Neon), rama `claude/migration-plan-px7c0b`. Esta entrega es exclusivamente de **investigación** — no se modificó ningún archivo de código, esquema ni dependencia. Sigue el método de clasificación de evidencia pedido (VERIFICADO_EN_CODIGO / FALLO_CONFIRMADO / PARCIAL / NO_ENCONTRADO / HIPÓTESIS_A_CONFIRMAR / DECISIÓN_DE_NEGOCIO / MEJORA_FUTURA).

**Al final de esta entrega me detengo y espero autorización explícita antes de pasar a Fase 2 completa, Fase 3 en adelante, o cualquier cambio de código.**

---

## 1. Resumen ejecutivo

- **Estado general**: arquitectura coherente y deliberada, no accidental. El Kardex (`MovimientoStock`) es append-only por diseño explícito, con comentarios en el propio `schema.prisma` que documentan por qué (evitar un bug histórico de la versión Apps Script: "Merma sin signo", v2.1.0, causado por re-aplicar el signo al leer). El signo se aplica **una sola vez, al escribir** (`transiciones.ts` + `cantidadFirmada` en `movimientos.ts:169-171`), y todas las lecturas hacen `SUM(cantidad)` sin reprocesar signo.
- **Riesgos principales**:
  1. Sin protección de idempotencia estructural (ni `@@unique` de referencia externa ni idempotency-key) en CONSUMO/MERMA/PRODUCCION/VENTA/DEVOLUCIONES/RECLASIFICACION — solo COMPRA tiene una guarda ad-hoc (factura duplicada). Doble-submit accidental de usuario no está probado ni prevenido activamente. → **HIPÓTESIS_A_CONFIRMAR**, requiere prueba reproducible, no bug confirmado.
  2. Reportes sin paginación real (ni cursor ni offset): todo el dataset filtrado se carga en memoria y se ordena/exporta client-side en `tabla-reporte.tsx`. → **VERIFICADO_EN_CODIGO**, riesgo de escala a futuro, no bug hoy con el volumen actual.
  3. `Number()` disperso sobre campos `Decimal` en ~39 archivos, sin capa de conversión centralizada. → **VERIFICADO_EN_CODIGO** como patrón, pero **HIPÓTESIS_A_CONFIRMAR** como bug real (no se probaron casos límite en esta entrega — eso es Fase 5, explícitamente pospuesta).
- **Decisiones que parecen correctas** (evidencia fuerte de que ya resuelven el problema que el `pasted context` busca resolver, con una arquitectura distinta a la sugerida):
  - Saldo 100% calculado (`SUM(cantidad)` on-the-fly) en vez de `StockBalance` materializado — decisión documentada explícitamente en el propio schema, no una omisión.
  - `conTransaccionSerializable` (aislamiento `Serializable` + reintento ante `P2034`) como mecanismo de concurrencia, en vez de `updateMany` condicional — cubre el mismo problema que la recomendación de "actualización condicional", con una estrategia distinta (más estricta).
  - Trazabilidad repartida por modelo de dominio (`Operacion.usuarioId/fecha/anuladaEn`, `MovimientoStock.creadoEn`, `TraspasoSucursal.creadoPorId/decididoPorOrigenId/...`) en vez de un `AuditLog` genérico.
  - Reversión = movimiento nuevo, siempre: **confirmado exhaustivamente** (`grep` de `.update()/.delete()/.upsert()` sobre `movimientoStock` en todo `src/` → 0 resultados).
- **Problemas confirmados**: ninguno con reproducción — esta entrega es de lectura de código, no de pruebas (Fase 4/8 quedan para la siguiente etapa).
- **Hipótesis a confirmar** (listadas en detalle en §5): doble-submit sin idempotencia; comportamiento de traspasos "en tránsito" ante falla de proceso; comportamiento bajo concurrencia real (no simulada).
- **Recomendación**: continuar a Fase 2 completa (matriz final) y Fase 3 (familia de efectos de inventario con pruebas) — la base de evidencia de Fase 0/1 es sólida y no encontró señales de arquitectura incoherente que ameriten detenerse.

---

## 2. Estado inicial del repositorio (Fase 0)

- **Git**: repositorio real con historial. Rama actual `claude/migration-plan-px7c0b`, working tree limpio (`nothing to commit, working tree clean`), sincronizada con `origin`. Commit HEAD: `82556df`. (Nota: uno de los tres agentes de esta auditoría reportó "Is a git repository: false" desde su propio contexto de entorno — es una discrepancia de metadata de ese proceso, no del repo; confirmado directamente en esta sesión que `git status`/`git log` funcionan normalmente.)
- **Origen**: no es un ZIP sin `.git` — es un checkout git válido.
- **Versiones**:
  | Herramienta | Versión |
  |---|---|
  | Node.js | v22.22.2 |
  | npm | 10.9.7 |
  | Next.js | 16.3.5 |
  | Prisma / @prisma/client | 7.10.0 |
  | TypeScript | 5.9.3 |
  | PostgreSQL (local) | 16.13 (Ubuntu), cluster `16/main` online en puerto 5432 |
  | Vitest | 4.1.11 |
- **package.json / lockfile**: `package-lock.json` presente (npm, no pnpm/yarn). Scripts: `dev`, `build` (`prisma generate && prisma migrate deploy && next build`), `start`, `lint`, `test` (`vitest run`), `postinstall` (`prisma generate`), `db:migrate`, `db:seed`, `db:studio`. `tsconfig.json` tiene `"strict": true`.
- **Variables de entorno** (solo nombres, sin valores): `DATABASE_URL`, `NEXT_PUBLIC_SENTRY_DSN`, `ALLOWED_EMAIL_DOMAINS`, `BOOTSTRAP_ADMIN_EMAILS`, `NEXT_RUNTIME`, `NODE_ENV`. Existen `.env` y `.env.example`; `.gitignore` excluye `.env*` salvo `.env.example` (documentación intencional de variables, sin valores reales).
- **Archivos sensibles**: sin hallazgos. `git ls-files | grep -iE '\.(pem|key|p12|pfx)$|credentials|secret'` → vacío. No se imprimió ningún valor de variable de entorno en esta auditoría.
- **Schema**: `prisma/schema.prisma` con 1089 líneas, 31 modelos. 10 migraciones en `prisma/migrations/` (ver detalle §3.6).
- **Tests**: 48 archivos `*.test.ts`. Ejecutados una vez (`npx vitest run`): **296/296 tests pasan, 48/48 archivos, ~71s**, contra Postgres local real (no mocks, no Testcontainers) — 44 de 48 archivos importan el helper de integración `test-db.ts`.
- **Limitaciones del entorno**: sesión en contenedor aislado, Postgres local ya estaba `online` (no hizo falta levantarlo). No se dispone de acceso a Neon (producción) desde esta auditoría — todo lo verificado es contra Postgres local.

---

## 3. Mapa del sistema (Fase 1)

### 3.1 Puntos de entrada de Next.js

- Sin `middleware.ts` en todo el repo (confirmado, ausencia real). La protección de rutas es 100% vía Server Component: `src/app/(app)/layout.tsx:7` hace `redirect("/login")` si `obtenerContextoUsuario()` es `null` — único gate de nivel-ruta.
- `src/app/page.tsx`: redirige a `/reportes` o `/login` según contexto.
- `src/app/login/page.tsx`: `signIn("google")`/`signOut()` como Server Actions inline.
- `src/app/api/auth/[...nextauth]/route.ts`: handlers de NextAuth v5 (beta).
- Grupo `(app)/` con ~40 páginas: `administracion/*`, `catalogo/*`, `movimientos/*`, `reportes/*` (17 subrutas), `stock/*`, `traspasos/*`.

### 3.2 Autenticación

- `src/lib/auth.ts`: NextAuth v5 + `@auth/prisma-adapter`, **un solo provider (Google)**, `allowDangerousEmailAccountLinking: true` (justificado: admins pre-cargan el email en `UsuarioSucursal` antes del primer login). Estrategia de sesión `database` (no JWT).
- Callback `signIn` delega en `emailPuedeIniciarSesion` (`src/core/auth/acceso.ts`) — 3 vías de alta (bootstrap emails, dominio Workspace, alta manual previa) + kill-switch `User.activoGlobal`.
- Callback `session` re-chequea `activoGlobal` en cada request (kill-switch en vivo).
- `getUsuarioActual()` (`src/core/auth/session.ts`): único punto de lectura de sesión del proyecto, envuelto en `cache()`.
- `obtenerContextoUsuario()` (`src/core/auth/contexto.ts`): resuelve sucursal activa desde cookie, validada contra membresías reales (nunca confía en la cookie a ciegas).

### 3.3 Permisos y capacidades por sucursal

Cascada de 3 capas independientes, evaluada en este orden:
1. **Gate de login** (`emailPuedeIniciarSesion`) — antes de crear sesión.
2. **Capacidad de sucursal** (`sucursalTieneCapacidad`, `src/core/permisos/capacidades-sucursal.ts`) — "gate de red" que Central puede apagar por sucursal; auto-protegido (`gestion_usuarios`/`gestion_permisos` siempre habilitados, para que Central nunca pueda auto-bloquearse).
3. **Permiso de rol** (`PermisoRol.puedeVer`/`puedeEditar`) resuelto sobre la membresía activa (`UsuarioSucursal`).

Wrapper único de mutaciones: `conPermiso()` (`src/server/actions/con-permiso.ts`) — resuelve contexto, aplica rate-limit in-memory (300 mutaciones/min/usuario, best-effort, no distribuido), gatea permiso, **antes** de ejecutar la lógica. ~30 `AccionClave` catalogadas en `src/core/permisos/acciones.ts`.

### 3.4 Catálogo (productos, insumos, unidades, recetas)

- `Producto.tipo` (`MP`|`PV`) — materia prima vs producto de venta; "uso" se deriva de `tipo`, no se persiste por separado.
- `seProduce`: permite que una MP también tenga receta (ej. salsa base).
- **Sin tabla de conversión de unidades genérica.** `Unidad.magnitud` es solo metadata/default de decimales (comentario explícito en el schema: NO valida conversión real). La conversión real es `Producto.factorConversion` / `Presentacion.factorConversion` — un factor escalar por producto, no una tabla N:M de factores entre unidades abstractas.
- Regla dura: `validarUnidadInsumo()` — todos los productos activos de un mismo `Insumo` deben compartir exactamente la misma `unidadStock`.
- **Recetas**: versionado append-only real (`RecetaVersion`, `@@unique([productoId, version])`, vigente = `MAX(version)`). `RecetaIngrediente.mermaPorcentaje` (`Decimal(6,2)`) aplicado en producción. `guardarReceta()` es el único punto con el gate `guardar_receta`; las operaciones puntuales (agregar 1 ingrediente, etc.) delegan en ella sin gatear por su cuenta — frágil ante una futura función puntual que no delegue, pero hoy correcto.

### 3.5 Scripts y seeds

- `prisma/seed.ts`: roles base (admin/operador), catálogo completo de `Accion`+`PermisoRol`, sucursal "Central", 5 unidades base.
- `scripts/seed-demo-pizzeria.ts` (+`-data.ts`): siembra una demo completa **llamando a los server actions reales** (no INSERTs directos), vía `vitest run --config vitest.seed.config.ts` con sesión mockeada. No idempotente para movimientos (documentado en el propio archivo).

### 3.6 Migraciones (10, orden cronológico)

`init` → `indices_manuales` → `stock_porcion` → `reportes_porcion` → `traspasos_sucursal` → `proveedor_referencia` → `ficha_tecnica_receta` (agrega cabecera informativa a `RecetaVersion` + `RecetaPaso`/`RecetaPasoIngrediente`) → `anular_venta` (agrega `Operacion.anuladaEn/anuladaPorId`) → `pago_consignante` (tabla `PagoConsignante`) → `traspaso_cancelada` (nuevo valor de enum). Patrón: cada migración reciente acompaña 1:1 a una `AccionClave` nueva — "una acción de negocio = un gate + su propio soporte de schema".

### 3.7 Reconstrucción de los 10 flujos de inventario

| Proceso | Camino | Signo | Permiso | Transacción | Reversión |
|---|---|---|---|---|---|
| **COMPRA** | `registrarMovimiento` (motor genérico, `movimientos.ts`) | fijo `+1` | `proceso_compra` | `conTransaccionSerializable` | Vía `AJUSTE` manual; guarda anti-duplicado por nro. de factura |
| **CONSUMO** | motor genérico, FEFO automático | fijo `-1` | `proceso_consumo` | ídem | Vía `AJUSTE` manual |
| **MERMA** | motor genérico | fijo `-1` | `proceso_merma` | ídem | Vía `AJUSTE` manual |
| **AJUSTE** | motor genérico | libre (usuario carga el delta ya firmado) | `proceso_ajuste` (solo admin) | ídem | Es en sí el mecanismo de reversión de otros procesos |
| **CONTROL (conteo)** | camino propio: `registrarConteoFisico()` | libre según diferencia | `proceso_control` | propia tx | `cancelarConteoFisico()` / `resolverConteoPendiente()` — movimiento nuevo |
| **Producción/receta** | motor genérico (`PRODUCCION` + líneas hijas `CONSUMO`) | producido `+1`, insumos `-cantidad*(1+merma%)` | `proceso_produccion` | 1 sola tx para todo | Vía `AJUSTE` manual |
| **VENTA** | camino propio: `registrarVenta()` | consumo receta `-cantidad`; línea PV `-1` | `proceso_venta` | propia tx | `anularVenta()` — genera `Operacion(AJUSTE)` nueva, nunca toca `MovimientoStock` existente |
| **DEVOLUCION** (3 variantes: proveedor/consignación/cliente) | motor genérico | proveedor `-1`, consignación `-1`, cliente `+1` | 3 permisos distintos | ídem | Vía `AJUSTE` manual; salvaguarda cruzada consignación↔proveedor |
| **RECLASIFICACION** | camino propio: `reclasificarStock()` | origen `-disponible`, destinos `+cantidad` exacto | `proceso_control` (comparte permiso con Conteo) | propia tx, saldo releído dentro de ella | Sin reversión dedicada (reclasificación inversa manual) |
| **TRASPASO/transferencia** | camino propio: `traspasos.ts`, máquina de estados | salida `-cantidad`, entrada `+cantidad`, reingreso `+cantidad` si rechazo | `proceso_transferencia_sucursal` | **cada paso en su propia tx** (no una única tx distribuida) | Reingreso = movimiento nuevo si destino rechaza |

**Verificaciones puntuales** (con evidencia, ver reporte completo de flujos para citas exactas):
- Signo aplicado una sola vez, al escribir: **confirmado**, sin doble negación encontrada.
- Recetas no duplican consumo entre Producción y Venta: **confirmado** — código explícito que evita reexplotar la receta si el PV ya se produjo (`seProduce`).
- Reversiones siempre son movimientos nuevos, nunca `UPDATE`/`DELETE` de `MovimientoStock`: **confirmado exhaustivamente** (`grep` sin resultados en todo `src/`).
- Conteo físico preserva el saldo histórico del momento: **confirmado** — `ConteoFisico.saldoSistema/conteoReal/diferencia` son campos persistidos, no recalculados.
- Devoluciones con signo correcto: **confirmado** para las 3 variantes.
- Traspasos con movimientos coherentes en ambos lados: **parcialmente confirmado** — el vínculo es el registro `TraspasoSucursal` (estado + `traspasoSucursalId` FK), no una transacción ACID distribuida entre ambos lados; el estado "en tránsito" (salida ya bajó, entrada aún no) es un diseño deliberado (workflow con aprobación humana), no un bug — pero **requiere prueba** de que no queda huérfano ante una falla de proceso entre pasos.
- Doble-submit/duplicación accidental fuera de COMPRA: **sin protección activa encontrada** — **HIPÓTESIS_A_CONFIRMAR**, requiere prueba, no es un bug confirmado.

---

## 4. Comparación preliminar con el `pasted context`

| Recomendación | Evidencia en motor2 | Estado | Riesgo concreto | Decisión recomendada |
|---|---|---|---|---|
| Prisma + Neon | `@prisma/client` 7.10.0, `@prisma/adapter-neon`/`adapter-pg` en dependencias | Ya implementado | Ninguno | Mantener |
| PostgreSQL local | Cluster 16.13 online, usado por 44/48 archivos de test | Ya implementado | Ninguno | Mantener |
| Validación runtime (Zod) | Ausente; validación manual (`texto()`, `validarTextoCatalogo`, checks `Number()` inline) en ~15+ server actions | Recomendación no adoptada, con alternativa propia funcionando (296/296 tests pasan) | Duplicación de reglas entre validación manual y UI no demostrada como problema real hoy | **NO_ENCONTRADO problema concreto que Zod resuelva mejor que lo actual** — no recomendar agregar sin evidencia de bug de contrato (regla del documento: "no recomendar dependencia sin problema demostrado") |
| Decimal y precisión | 14 campos `Decimal(14,x)` en schema; `Number()` disperso en 39 archivos; sin `decimal.js` | Parcial (Decimal en DB, conversión a `Number` en app) | Pérdida de precisión en JS `Number` para cálculos encadenados — **no probado con casos límite en esta entrega** (Fase 5 pospuesta) | HIPÓTESIS_A_CONFIRMAR — necesita Fase 5 con casos límite antes de decidir |
| Transacciones | `conTransaccionSerializable` (Serializable + reintento P2034) como wrapper único para todo el Kardex, + 3 usos directos de `$transaction` | Ya implementado, con estrategia más estricta que la sugerida | Ninguno confirmado | Mantener |
| Historial inmutable | `MovimientoStock` append-only, confirmado sin excepciones (`grep` de update/delete/upsert → 0) | Ya implementado | Ninguno | Mantener |
| Saldo materializado (`StockBalance`) vs calculado | Sin `StockBalance`; saldo 100% `SUM(cantidad)` on-the-fly, decisión documentada explícitamente en el schema | Ya resuelto con otra arquitectura | Ninguno confirmado hoy; posible costo de agregación a volumen alto — **no medido** | No agregar sin antes medir costo real de las agregaciones actuales (regla explícita de Fase 4) — DECISIÓN_DE_NEGOCIO/MEJORA_FUTURA condicionada a volumen |
| Unidades y conversiones | Sin `UnitConversion`; factor escalar por producto/presentación + regla de unidad compartida por Insumo | Parcial / ya resuelto con otra arquitectura para el caso de uso actual | Ninguno confirmado — no hay evidencia de necesidad de conversión N:M entre unidades abstractas | Mantener; revisar solo si aparece un caso de uso real de conversión cross-unidad genérica |
| Concurrencia | `Serializable` + reintento (5 intentos) sobre `P2034` | Ya implementado, estrategia distinta a "actualización condicional" | No probado bajo carga concurrente real en esta entrega | Fase 4 (pendiente, con pruebas reales) antes de tocar nada |
| Idempotencia | Sin `sourceType`/`sourceId`/idempotency-key; solo `findFirst` de factura duplicada en COMPRA | Faltante real fuera de COMPRA | Reintento de red/doble-submit podría duplicar Operaciones en CONSUMO/VENTA/etc. | HIPÓTESIS_A_CONFIRMAR con prueba de doble-submit antes de decidir mecanismo |
| Auditoría (`AuditLog` genérico) | Sin modelo genérico; actor/fecha/motivo distribuidos por modelo de dominio (`Operacion`, `MovimientoStock`, `TraspasoSucursal`) | Parcial, cubre el caso de uso actual | Ninguno confirmado — no hay requisito de auditoría cross-entidad no cubierto | No agregar sin requisito real concreto (regla explícita del documento) |
| Pruebas de invariantes | 296/296 tests pasan, 44/48 de integración contra Postgres real | Parcial — cubre casos funcionales; sin pruebas de propiedades (`fast-check`) ni de concurrencia real | Ninguno confirmado como bug; cobertura de invariantes tipo "suma histórica reconstruye saldo" no verificada explícitamente | MEJORA_FUTURA — evaluar `fast-check` para propiedades, sin urgencia |
| Reportes y paginación | `tabla-reporte.tsx` sin paginación; todo en memoria, orden/export client-side | Faltante real (a escala) | Ninguno hoy con el volumen visto; degradaría con dataset grande | MEJORA_FUTURA — no urgente sin evidencia de volumen problemático |
| TanStack Query | Ausente; Server Actions + `<form action>` nativo | Recomendación no adoptada, arquitectura Server-Actions-first ya coherente | Ninguno confirmado | No agregar sin problema concreto de estado remoto no resuelto hoy |
| TanStack Table | Ausente; tabla propia (`tabla-reporte.tsx`) ya resuelve orden/export/filtros básicos | Parcial (resuelve menos que TanStack Table: sin paginación, sin agrupación) | Ninguno confirmado como bloqueante | MEJORA_FUTURA si se necesita paginación/agrupación real |
| React Hook Form | Ausente; `<form action>` + `FormData` nativo | Recomendación no adoptada, patrón coherente con Server Actions | Ninguno confirmado | No agregar sin duplicación de reglas demostrada |
| BullMQ + Redis | Ausente; sin procesos asíncronos | No necesario para el alcance actual (todo es síncrono/transaccional) | Ninguno | No agregar (regla explícita: "no lo agregaría para movimientos normales de stock") |
| Logging (Pino) | Solo 1 `console.error` en todo `src/`; sin logger estructurado | Faltante parcial | Bajo — Sentry ya captura errores | MEJORA_FUTURA, no urgente |
| Sentry | **Sí integrado**: `@sentry/nextjs` en server+edge+client vía `instrumentation.ts`, DSN configurado | Ya implementado | Ninguno | Mantener |
| OpenTelemetry | Ausente propio (solo lo que trae Sentry internamente) | No necesario para el alcance actual | Ninguno confirmado | No agregar sin necesidad de tracing distribuido real |
| Testcontainers | Ausente; Postgres local real fijo, reset por `deleteMany()` entre tests | Ya resuelto con otra estrategia (pragmática, funciona: 296/296 pasan) | Tests dependen de tener Postgres local levantado (no auto-provisionado) | No es un faltante crítico — MEJORA_FUTURA opcional para CI aislado |

---

## 5. Hipótesis a confirmar (requieren Fase 3/4/5, no cerradas acá)

1. Doble-submit / duplicación accidental fuera de COMPRA (CONSUMO, MERMA, PRODUCCION, VENTA, DEVOLUCIONES, RECLASIFICACION) — sin protección estructural encontrada.
2. Comportamiento de un traspaso "en tránsito" ante una falla de proceso entre pasos (el modelo de datos lo soporta como estado válido; no verificado en runtime).
3. Comportamiento bajo conflicto de escritura concurrente real (no solo lectura del mecanismo `Serializable`).
4. Riesgo de precisión numérica con `Number()` sobre campos `Decimal` — no se probaron casos límite todavía (Fase 5).

## 6. Preguntas de negocio pendientes (relevadas, no resueltas acá)

- ¿Se permiten saldos negativos hoy? (no verificado en esta entrega — requiere Fase 3).
- Política de reintentos ante duplicación accidental de request (¿se acepta el riesgo actual o se exige idempotencia estructural?).
- Volumen esperado de movimientos (determina si `StockBalance` materializado alguna vez se justifica).
- Nivel de auditoría requerido más allá de lo distribuido por modelo (¿algún requisito regulatorio/negocio pide un log centralizado?).

---

**Fin de la entrega obligatoria (Fase 0 + Fase 1 + comparación preliminar). Detenido aquí, según la regla del documento, a la espera de autorización explícita para continuar con Fase 2 completa / Fase 3 en adelante.**
