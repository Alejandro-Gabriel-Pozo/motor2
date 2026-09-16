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
  - `conTransaccionSerializable` (aislamiento `Serializable` + reintento ante `P2034`) como mecanismo de concurrencia, en vez de `updateMany` condicional. Es una estrategia **potencialmente suficiente** para resolver la misma carrera que la recomendación de "actualización condicional" busca evitar, pero su suficiencia real todavía **no está confirmada** — queda condicionada a una prueba con dos transacciones concurrentes reales y un resultado esperado exacto (Fase 4, pendiente).
  - Trazabilidad repartida por modelo de dominio (`Operacion.usuarioId/fecha/anuladaEn`, `MovimientoStock.creadoEn`, `TraspasoSucursal.creadoPorId/decididoPorOrigenId/...`) en vez de un `AuditLog` genérico.
  - Reversión = movimiento nuevo, siempre: **confirmado exhaustivamente** (`grep` de `.update()/.delete()/.upsert()` sobre `movimientoStock` en todo `src/` → 0 resultados).
- **Problemas confirmados**: ninguno con reproducción — esta entrega es de lectura de código, no de pruebas (Fase 4/8 quedan para la siguiente etapa).
- **Hipótesis a confirmar** (listadas en detalle en §5): doble-submit sin idempotencia; comportamiento de traspasos "en tránsito" ante falla de proceso; comportamiento bajo concurrencia real (no simulada).
- **Recomendación**: continuar a Fase 2 completa (matriz final) y Fase 3 (familia de efectos de inventario con pruebas) — la base de evidencia de Fase 0/1 es sólida y no encontró señales de arquitectura incoherente que ameriten detenerse.
- **Estado de fases** (para evitar ambigüedad sobre qué está cerrado):
  ```text
  Fase 0: completa
  Fase 1: completa
  Comparación preliminar con pasted context: completa
  Fase 2 completa (matriz final): pendiente
  Fase 3 en adelante: pendiente
  ```

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

- Sin `middleware.ts` en todo el repo (confirmado, ausencia real — un hecho, no en sí mismo una vulnerabilidad). La protección de rutas es 100% vía Server Component: `src/app/(app)/layout.tsx:7` hace `redirect("/login")` si `obtenerContextoUsuario()` es `null` — único gate de nivel-ruta. La protección real ocurre en layouts, contexto (`obtenerContextoUsuario`) y Server Actions (`conPermiso`), no en middleware global. **Pendiente de verificar** (Fase 6, seguridad/contratos): que no existan rutas o Server Actions alcanzables sin pasar por esos gates — la ausencia de middleware no es por sí sola evidencia de una brecha.
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
- Doble-submit/duplicación accidental fuera de COMPRA: la **ausencia** del mecanismo estructural está **VERIFICADO_EN_CODIGO** (no existe protección de idempotencia general fuera de la guarda específica de compras). Que esa ausencia produzca duplicaciones reales en producción es **HIPÓTESIS_A_CONFIRMAR** — todavía no se ejecutó una prueba de doble-submit o reintento real. Ambas afirmaciones coexisten y no deben mezclarse.

---

## 4. Comparación preliminar con el `pasted context`

| Recomendación | Evidencia en motor2 | Estado | Riesgo concreto | Evidencia faltante | Decisión recomendada |
|---|---|---|---|---|---|
| Prisma + Neon | `@prisma/client` 7.10.0, `@prisma/adapter-neon`/`adapter-pg` en dependencias | Ya implementado | Ninguno | — | Mantener |
| PostgreSQL local | Cluster 16.13 online, usado por 44/48 archivos de test | Ya implementado | Ninguno | — | Mantener |
| Validación runtime (Zod) | Ausente; validación manual (`texto()`, `validarTextoCatalogo`, checks `Number()` inline) en ~15+ server actions | Recomendación no adoptada, con alternativa propia funcionando (296/296 tests pasan) | Duplicación de reglas entre validación manual y UI no demostrada como problema real hoy | Ningún caso reproducible de bug de contrato causado por la validación manual actual | **NO_ENCONTRADO problema concreto que Zod resuelva mejor que lo actual** — no recomendar agregar sin evidencia de bug de contrato (regla del documento: "no recomendar dependencia sin problema demostrado") |
| Decimal y precisión | 14 campos `Decimal(14,x)` en schema; `Number()` disperso en 39 archivos; sin `decimal.js` | Parcial (Decimal en DB, conversión a `Number` en app) | Pérdida de precisión en JS `Number` para cálculos encadenados — **no probado con casos límite en esta entrega** (Fase 5 pospuesta) | Casos límite ejecutados: `0.1+0.2`, cantidades a 4 decimales, conversiones caja/unidad, redondeo por unidad — ninguno corrido todavía | HIPÓTESIS_A_CONFIRMAR — necesita Fase 5 con casos límite antes de decidir |
| Transacciones | `conTransaccionSerializable` (Serializable + reintento P2034) como wrapper único para todo el Kardex, + 3 usos directos de `$transaction` | Ya implementado, con estrategia más estricta que la sugerida | Ninguno confirmado | — | Mantener |
| Historial inmutable | `MovimientoStock` append-only, confirmado sin excepciones (`grep` de update/delete/upsert → 0) | Ya implementado | Ninguno | — | Mantener |
| Saldo materializado (`StockBalance`) vs calculado | Sin `StockBalance`; saldo 100% `SUM(cantidad)` on-the-fly, decisión documentada explícitamente en el schema | Ya resuelto con otra arquitectura | Ninguno confirmado hoy; posible costo de agregación a volumen alto — **no medido** | Benchmark real de `SUM(cantidad)` con volumen representativo de movimientos + plan de ejecución de Postgres (`EXPLAIN ANALYZE`) | No agregar sin antes medir costo real de las agregaciones actuales (regla explícita de Fase 4) — DECISIÓN_DE_NEGOCIO/MEJORA_FUTURA condicionada a volumen |
| Unidades y conversiones | Sin `UnitConversion`; factor escalar por producto/presentación + regla de unidad compartida por Insumo | Parcial / ya resuelto con otra arquitectura para el caso de uso actual | Ninguno confirmado — no hay evidencia de necesidad de conversión N:M entre unidades abstractas | Un caso de uso real donde el factor escalar por producto no alcance | Mantener; revisar solo si aparece un caso de uso real de conversión cross-unidad genérica |
| Concurrencia | `Serializable` + reintento (5 intentos) sobre `P2034` | Ya implementado, estrategia distinta a "actualización condicional" | No probado bajo carga concurrente real en esta entrega | Prueba con 2+ transacciones concurrentes reales sobre el mismo producto/sección, con resultado esperado exacto (ganador/perdedor, reintento seguro) | Fase 4 (pendiente, con pruebas reales) antes de tocar nada |
| Idempotencia | Sin `sourceType`/`sourceId`/idempotency-key; solo `findFirst` de factura duplicada en COMPRA | Faltante real (ausencia del mecanismo) fuera de COMPRA | Reintento de red/doble-submit podría duplicar Operaciones en CONSUMO/VENTA/etc. | Prueba reproducible de doble-submit/reintento en CONSUMO, VENTA, PRODUCCION que confirme (o descarte) duplicación real | HIPÓTESIS_A_CONFIRMAR con prueba de doble-submit antes de decidir mecanismo |
| Auditoría (`AuditLog` genérico) | Sin modelo genérico; actor/fecha/motivo distribuidos por modelo de dominio (`Operacion`, `MovimientoStock`, `TraspasoSucursal`) | Parcial, cubre el caso de uso actual | Ninguno confirmado — no hay requisito de auditoría cross-entidad no cubierto | Un requisito de negocio/regulatorio concreto no cubierto por la trazabilidad distribuida actual | No agregar sin requisito real concreto (regla explícita del documento) |
| Pruebas de invariantes | 296/296 tests pasan, 44/48 de integración contra Postgres real | Parcial — cubre casos funcionales; sin pruebas de propiedades (`fast-check`) ni de concurrencia real | Ninguno confirmado como bug; cobertura de invariantes tipo "suma histórica reconstruye saldo" no verificada explícitamente | Prueba explícita de reconstrucción de saldo desde `MovimientoStock` para un producto con historial largo/mixto | MEJORA_FUTURA — evaluar `fast-check` para propiedades, sin urgencia |
| Reportes y paginación | `tabla-reporte.tsx` sin paginación; todo en memoria, orden/export client-side | Faltante real (a escala) | Ninguno hoy con el volumen visto; degradaría con dataset grande | Benchmark de un reporte con dataset grande (ej. historial de un año, todas las sucursales) midiendo tiempo de carga y memoria | MEJORA_FUTURA — no urgente sin evidencia de volumen problemático |
| TanStack Query | Ausente; Server Actions + `<form action>` nativo | Recomendación no adoptada, arquitectura Server-Actions-first ya coherente | Ninguno confirmado | — | No agregar sin problema concreto de estado remoto no resuelto hoy |
| TanStack Table | Ausente; tabla propia (`tabla-reporte.tsx`) ya resuelve orden/export/filtros básicos | Parcial (resuelve menos que TanStack Table: sin paginación, sin agrupación) | Ninguno confirmado como bloqueante | — | MEJORA_FUTURA si se necesita paginación/agrupación real |
| React Hook Form | Ausente; `<form action>` + `FormData` nativo | Recomendación no adoptada, patrón coherente con Server Actions | Ninguno confirmado | — | No agregar sin duplicación de reglas demostrada |
| BullMQ + Redis | Ausente; sin procesos asíncronos | No necesario para el alcance actual (todo es síncrono/transaccional) | Ninguno | — | No agregar (regla explícita: "no lo agregaría para movimientos normales de stock") |
| Logging (Pino) | Solo 1 `console.error` en todo `src/`; sin logger estructurado | Faltante parcial | Bajo — Sentry ya captura errores | — | MEJORA_FUTURA, no urgente |
| Sentry | **Sí integrado**: `@sentry/nextjs` en server+edge+client vía `instrumentation.ts`, DSN configurado | Ya implementado | Ninguno | — | Mantener |
| OpenTelemetry | Ausente propio (solo lo que trae Sentry internamente) | No necesario para el alcance actual | Ninguno confirmado | — | No agregar sin necesidad de tracing distribuido real |
| Testcontainers | Ausente; Postgres local real fijo, reset por `deleteMany()` entre tests | Ya resuelto con otra estrategia (pragmática, funciona: 296/296 pasan) | Tests dependen de tener Postgres local levantado (no auto-provisionado) | — | No es un faltante crítico — MEJORA_FUTURA opcional para CI aislado |

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

**Fin de la entrega obligatoria (Fase 0 + Fase 1 + comparación preliminar).**

## 7. Aprobación y ajustes (2026-09-16)

Revisión aprobada con ajustes menores: distinción explícita entre ausencia verificada de mecanismo (idempotencia) e impacto no confirmado; suficiencia de `Serializable` condicionada a prueba de concurrencia; ausencia de `middleware.ts` desacoplada de una afirmación de vulnerabilidad; columna "Evidencia faltante" agregada a la matriz de §4. Aplicados en este documento.

**Autorizado a continuar** con investigación mediante pruebas (sin agregar dependencias ni cambiar el stack todavía), en este orden:
1. Concurrencia real sobre el mismo producto y sección.
2. Doble-submit e idempotencia (ventas, consumos, movimientos).
3. Reintento y rollback de operaciones transaccionales.
4. Traspasos entre sucursales en estado "en tránsito" ante fallos.
5. Casos límite de precisión numérica (`Decimal` → `number`).
6. Reconstrucción del saldo desde `MovimientoStock`.
7. Benchmark de reportes y agregaciones antes de considerar `StockBalance`.

No autorizado todavía: `StockBalance`, Zod, `decimal.js`, TanStack, Redis, ni ningún otro cambio de stack o de código de producción.

---

## 8. Fase 4 (parcial) — Hallazgos confirmados por prueba reproducible (2026-09-16)

Pruebas nuevas en `test/auditoria/concurrencia-idempotencia.test.ts` (no modifica código de producción; solo agrega pruebas de investigación). Ejecutadas 5+ veces cada escenario contra Postgres local real, con `Promise.allSettled` para capturar tanto resultados `{ok:false,...}` de negocio como rechazos de promesa (errores no manejados).

### Hallazgo 1 — El reintento de `conTransaccionSerializable` no cubre todos los conflictos de serialización reales

```text
Hallazgo: conTransaccionSerializable solo reintenta cuando el error es
  Prisma.PrismaClientKnownRequestError con code "P2034". En pruebas de
  concurrencia real con el motor genérico (registrarMovimiento), el
  conflicto de Postgres a veces se manifiesta en un punto distinto (muy
  probablemente al COMMIT, no en una sentencia individual) y llega como
  DriverAdapterError({ kind: "TransactionWriteConflict" }) — una clase
  distinta, que la condición `e instanceof Prisma.PrismaClientKnownRequestError`
  no reconoce. El catch no lo reintenta: lo relanza en el primer intento.

Evidencia: test/auditoria/concurrencia-idempotencia.test.ts, "Escenario
  1b" — de 5 corridas con dos CONSUMO concurrentes sobre stock de sobra
  (20, dos consumos de 6 c/u — ambos deberían poder convivir sin
  conflicto de negocio), 2 de 5 terminaron con una promesa RECHAZADA
  (name: "DriverAdapterError", message: "TransactionWriteConflict") en
  vez de dos ResultadoAccion {ok:true,...}. Reproducido también de forma
  aislada (fuera del motor de negocio) con dos transacciones Serializable
  concurrentes sobre el mismo Producto vía la API de modelos de Prisma.

Ubicaciones: src/core/movimientos/con-reintento.ts:17-28
  (conTransaccionSerializable); consumido por
  src/server/actions/movimientos.ts, venta.ts, conteo-fisico.ts,
  reclasificacion.ts, traspasos.ts — es decir, TODA escritura de Kardex.

Comportamiento actual: cuando el conflicto llega como DriverAdapterError
  en vez de P2034, la función se relanza sin reintentar. Como
  conPermiso() (src/server/actions/con-permiso.ts) NO tiene try/catch
  alrededor de fn(ctx), el error se propaga sin convertirse en un
  ResultadoAccion {ok:false, mensaje:...} — llega crudo al Server Action,
  y de ahí al error boundary de Next.js (no un mensaje de negocio
  prolijo tipo "Stock insuficiente").

Impacto: dos usuarios (o el mismo usuario con doble-submit rápido)
  operando sobre el mismo producto+sección al mismo tiempo, incluso con
  stock más que suficiente para ambos, pueden ver una de las dos
  operaciones fallar con un error crudo/no descriptivo en vez de tener
  éxito silenciosamente (que es el comportamiento que el propio diseño
  documentado busca garantizar). No es pérdida de datos ni corrupción de
  stock — es una falla de UX/confiabilidad: una operación legítima
  falla cuando no debería.

Tipo de problema: FALLO_CONFIRMADO (reproducido, no es solo hipótesis).
Nivel de certeza: alto — reproducido en 2 de 5 corridas del escenario
  designado para esto, y en una reproducción aislada mínima.
Severidad: media — no corrompe datos ni permite sobreventa; degrada
  confiabilidad bajo concurrencia real (más probable a mayor tráfico
  simultáneo por sucursal).
Causa probable: la condición de reconocimiento del conflicto
  (`e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2034"`)
  es más estrecha que el conjunto real de errores que Postgres/el driver
  pg pueden lanzar para SQLSTATE 40001 (serialization_failure) y 40P01
  (deadlock_detected) — ambos mapeados por @prisma/adapter-pg a
  DriverAdapterError({kind:"TransactionWriteConflict"}), pero solo
  ALGUNOS caminos internos de Prisma 7 envuelven ese error como P2034
  antes de que llegue al código de aplicación.
Opciones de solución (no implementadas, solo relevadas):
  (a) ampliar la condición de conTransaccionSerializable para reconocer
      también DriverAdapterError con kind "TransactionWriteConflict" (o
      chequear message/SQLSTATE en vez de solo instanceof+code);
  (b) agregar un try/catch en conPermiso (o en cada action) que traduzca
      cualquier excepción no reconocida en un ResultadoAccion genérico,
      como red de seguridad además del fix puntual en (a).
Solución recomendada: no corresponde proponer todavía — pendiente de
  autorización de implementación.
Archivos afectados (si se autoriza): src/core/movimientos/con-reintento.ts,
  posiblemente src/server/actions/con-permiso.ts.
Pruebas previas: test/auditoria/concurrencia-idempotencia.test.ts
  (Escenario 1b) ya reproduce el problema tal como está.
Pruebas posteriores (si se corrige): correr el mismo escenario N veces
  y confirmar 0 rechazos de promesa en todas las corridas.
Riesgos: ninguno evidente en ampliar el reconocimiento del conflicto —
  es estrictamente más permisivo con los reintentos, no cambia semántica
  de negocio.
Plan de rollback: revertir el cambio en con-reintento.ts (archivo chico,
  sin migraciones de por medio).
¿Requiere decisión de negocio?: no — es una corrección de robustez
  interna, no un cambio de comportamiento visible salvo "menos errores
  espurios bajo concurrencia".
```

### Hallazgo 2 — El guard de factura duplicada (COMPRA) es una condición de carrera real, no solo teórica

```text
Hallazgo: el chequeo "¿ya existe una Compra con este proveedor+factura?"
  (src/server/actions/movimientos.ts:220-227) usa prisma.operacion.findFirst
  ANTES de entrar a conTransaccionSerializable — un patrón
  check-then-act clásico, fuera de cualquier aislamiento transaccional
  compartido entre las dos requests.

Evidencia: test/auditoria/concurrencia-idempotencia.test.ts, "Escenario
  2" — en 1 de 5 corridas con dos COMPRA concurrentes, mismo
  proveedor+nroFactura exacto, AMBAS tuvieron éxito
  (operacionesConEsaFactura: 2 en la base). En las otras 4 corridas el
  guard sí funcionó (una de las dos fue rechazada, por el guard o por el
  Hallazgo 1) — confirma que es una condición de carrera real con
  ventana angosta pero explotable, no un evento imposible.

Ubicaciones: src/server/actions/movimientos.ts:220-227.
Comportamiento actual: bajo concurrencia real, es posible cargar la
  misma factura de compra dos veces para el mismo proveedor — el guard
  que existe para evitarlo (Movimientos.js:402-416 en Apps Script,
  portado tal cual) no es atómico con la escritura.
Impacto: doble carga de una compra (stock duplicado + gasto duplicado)
  si dos personas/pestañas cargan la misma factura casi al mismo tiempo
  — escenario plausible en un ERP con más de un cajero/encargado de
  depósito.
Tipo de problema: FALLO_CONFIRMADO (reproducido).
Nivel de certeza: alto — reproducido 1 de 5 veces con solo 2 requests
  concurrentes; la probabilidad crece con más tráfico real.
Severidad: media-alta — a diferencia del Hallazgo 1, este SÍ corrompe
  datos de negocio (factura contada dos veces), no solo UX.
Causa probable: falta un `@@unique` de base de datos que respalde la
  regla de negocio "una factura por proveedor por sucursal no se carga
  dos veces" — hoy es 100% una regla de aplicación no atómica.
Opciones de solución (no implementadas, solo relevadas):
  (a) `@@unique([sucursalId, proceso, proveedorId, nroFactura])` en
      Operacion (con proceso fijo en 'COMPRA' o un índice parcial),
      dejando que Postgres sea el árbitro final — mismo criterio que ya
      usa este proyecto para RecetaVersion/Presentacion/etc.;
  (b) mover el chequeo findFirst DENTRO de conTransaccionSerializable,
      aunque sin (a) seguiría siendo vulnerable a la misma condición de
      carrera dentro de la ventana Serializable si Postgres no lo
      detecta como conflicto de lectura-escritura real sobre índices
      distintos.
Solución recomendada: (a) es la que sigue el patrón ya establecido en
  este código (dejar que la constraint de DB sea el árbitro), pero
  requiere migración — no corresponde implementar sin autorización.
Archivos afectados (si se autoriza): prisma/schema.prisma (migración
  nueva), src/server/actions/movimientos.ts (manejar el error de
  constraint violada con un mensaje de negocio, mismo patrón que
  crearConCodigoAutogenerado ante P2002).
Pruebas previas: test/auditoria/concurrencia-idempotencia.test.ts
  (Escenario 2) ya reproduce el problema.
Pruebas posteriores (si se corrige): mismo escenario, N corridas, 0
  casos con operacionesConEsaFactura > 1.
Riesgos: un `@@unique` nuevo podría chocar con datos ya cargados en
  producción si alguna vez se duplicó una factura antes de esta
  corrección — habría que auditar datos existentes antes de aplicar la
  migración (no evaluado en esta entrega).
Plan de rollback: revertir la migración (down) y el manejo de error
  agregado.
¿Requiere decisión de negocio?: parcialmente — confirmar que "una
  factura por proveedor por sucursal es siempre única" es una regla de
  negocio real y sin excepciones (ej. notas de crédito con el mismo
  número, facturas de distintas sucursales del mismo proveedor) antes
  de convertirla en constraint de base de datos.
```

**Actualiza la matriz de §4**: la fila "Concurrencia" pasa de "no probado" a **FALLO_CONFIRMADO parcial** (Hallazgo 1); la fila "Idempotencia" gana evidencia concreta adicional más allá de COMPRA — el propio guard de COMPRA, que era la única protección existente, también es racy (Hallazgo 2).

Quedan pendientes de esta misma etapa: reintento/rollback ya cubierto parcialmente (ver Escenario 4, atomicidad confirmada — ningún dato parcial persiste ante un payload inválido), traspasos "en tránsito", precisión numérica, reconstrucción de saldo, benchmark de reportes.
