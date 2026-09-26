# Plan: rendimiento de receta por sucursal (override liviano), auditoría y comparación entre sucursales

Rama `feat/recetas-alcance-auditoria` (HEAD 917c25b al momento de diseñar, árbol limpio). Este documento es el plan de implementación completo entregado por el Plan agent, con las 3 decisiones de autorización ya resueltas por el dueño del producto (ver "Decisiones de autorización" al final). Implementar paso por paso, un commit por paso, en el orden dado.

## 0. Qué hay hoy en el código (leído, no supuesto)

### 0.1 Quién lee `RecetaIngrediente.cantidad` / `mermaPorcentaje`

No es solo la venta: son dos consumos de stock y siete lectores de reportes.

**Consumo de stock (escriben movimientos, dentro de transacciones SERIALIZABLE):**

| # | Lugar | Qué hace hoy |
|---|---|---|
| C1 | `src/core/movimientos/registrar-venta.ts:121-133` (`armarVentaCalculada`) | `findFirst` de la versión vigente con `include: { ingredientes: true }`. Calcula `cantidadSalida = cantidad * Number(ing.cantidad) * (1 + Number(ing.mermaPorcentaje) / 100)` y lo pasa a `resolverConsumoPorFamilia` (el reparto FEFO entre hermanos). |
| C2 | `src/server/actions/movimientos/movimientos.ts:91-107` (`calcularConsumosProduccion`, proceso PRODUCCION) | La misma fórmula en la línea 103. Hoy **no recibe `sucursalId`**; quien la llama (`armarLineaMovimiento`) sí lo tiene. |

`registrarVentaEnTx` sirve también al POS: el cierre de cuenta pasa por ahí. Además calcula `costoUnitarioAlVender` con `calcularCostosYMargenes(actor.sucursalId, tx)`, así que el costo guardado en cada venta depende de los lectores de reportes de abajo.

**Reportes (solo lectura):**

| # | Lugar | Qué hace hoy |
|---|---|---|
| R1 | `src/core/reportes/comun.ts:123` `construirIndiceRecetas(db)` | Índice global que no recibe sucursal. Lo usan `periodo.ts:174`, `costo-historico.ts:70`, `costos.ts:142` (`calcularCostosYMargenes`, incluye subrecetas vía `resolverCostoUnitario`), `costos.ts:353` (`calcularImpactoRecetasPorPeriodo`), `diferencias-ajustes.ts:72` (muestra la «merma % actual»), `core/reportes/promociones.ts:73` («valor a la carta») y además `huecos-catalogo.ts`, `insumos-sin-receta.ts` y `server/actions/reportes/promociones.ts:52`. Estos tres últimos solo usan la estructura (`mpsEnRecetas` / «tiene receta»), no las cantidades. |
| R2 | `src/core/reportes/rendimiento-recetas.ts:193-240` `construirPools` | Arma `uso.cantidad` y `uso.mermaPorcentaje` (desvío, estimado neto, rótulo). |
| R3 | `src/core/reportes/historial-producto.ts:215` `obtenerIngredientesRecetaVigente` | Cartel de «producto de reventa»: muestra cantidades. |

**Solo estructura o catálogo central (no cambian):** `desactivar-producto.ts`; `catalogo/recetas/page.tsx`, `[productoId]/page.tsx` y `historial/page.tsx`.

### 0.2 Otros hechos que condicionan el diseño

- **`RecetaIngrediente` se borra en cascada desde `RecetaVersion`** (`onDelete: Cascade`, `schema.prisma:584`). La app nunca borra versiones (historial append-only), pero los E2E sí (`prisma.recetaVersion.deleteMany` en cada `finally`). Por eso la FK del override hacia `RecetaIngrediente` tiene que ser `ON DELETE CASCADE`.
- **Cada `guardarReceta` crea filas `RecetaIngrediente` nuevas** (ids nuevos). Un override colgado del id viejo queda huérfano en la versión vieja, y la sucursal vuelve al valor central **en silencio**. Es la trampa más grande del diseño; se resuelve en D3 (arrastre).
- **Precedente de override local** (`PrecioLocalProducto`, `schema.prisma:1045`): vive fuera de la sección «Catálogo Central»; su resolución está en `core/movimientos/precio-venta.ts`; su CRUD audita con `sucursalId = ctx.sucursalId` y un registro por campo.
- **Permisos:** `conPermiso` evalúa el permiso en la sucursal activa. Acciones nuevas entran con migración de datos idempotente (molde `20260924153615_permiso_carta`). `test/arquitectura/toda-accion-se-usa.test.ts` exige que toda clave de `ACCIONES` se use como guarda (lista `RESERVADAS_SIN_USO_TODAVIA` para lo temporal).
- **Rutas:** `/reportes/consolidado` es el precedente para ver varias sucursales (pide `ver_reportes_dinero` en la sucursal activa, muestra solo sucursales de `ctx.membresias`). `accionDeRuta` resuelve por prefijo.
- **`test/reportes/catalogo-una-sola-carga.test.ts`** cuenta llamadas a `recetaVersion.findMany` por reporte (tiene que ser 1) — un `include` anidado no rompe el conteo.
- **Limpieza de bases:** `limpiarBaseDeTest` borra `sucursal` antes que `recetaIngrediente` — la tabla nueva se borra antes de `sucursal`. El reset E2E hace `TRUNCATE ... CASCADE` dinámico, no hay que tocarlo.
- **E2E afectados**: `rendimiento-recetas-confirmar.spec.ts`, `rendimiento-recetas-agua.spec.ts:97-134`, `accesibilidad.spec.ts:441-485`.
- **Correcciones a la investigación original**: el enlace de `fila-compartida.tsx` lleva `platos/semanas/ajuste`, no `comprado/vendido/confianza`; el commit `74a14ab` no existe en la historia (la confirmación viene de `a8c93df`/`1901c30`).

## 1. Decisiones de diseño

**D1. Tabla nueva `RendimientoLocalIngrediente`.** Una fila = calibración de UNA línea de receta en UNA sucursal. `cantidad` y `mermaPorcentaje` anulables por separado — `null` = usar el central. Sin fila = usa el central, igual que hoy. Va junto a `PrecioLocalProducto`, no en la sección Catálogo Central. Sin relleno inicial.

**D2. Resolución del valor efectivo en un solo lugar.** Función pura `src/core/catalogo/rendimiento-local.ts`:

```ts
rendimientoEfectivo(
  central: { cantidad: number; mermaPorcentaje: number },
  overrides: readonly { sucursalId: string; cantidad: number | null; mermaPorcentaje: number | null }[] | undefined,
  sucursalId: string
): { cantidad: number; mermaPorcentaje: number; calibrado: boolean }
```

Filtra por `sucursalId` ADENTRO de la función (defensa en profundidad). Sin override, devuelve los MISMOS números que recibió (`Object.is`, sin operación aritmética). En C1/C2 la fórmula queda textualmente igual, solo cambia de dónde salen los dos operandos. `resolverConsumoPorFamilia` (el reparto FEFO, donde vivió H9) NO se toca.

**D3. Los overrides se arrastran a cada versión nueva, dentro de `guardarReceta`.** Se mantiene la FK a `RecetaIngrediente` (no a `(plato,insumo,sucursal)`, que no detecta cambio de unidad ni evita "resucitar" calibraciones viejas). En la misma transacción que crea la versión nueva, por cada ingrediente nuevo:
1. Buscar el ingrediente de la versión anterior con el mismo `insumoProductoId`.
2. Si tenía overrides y la unidad NO cambió → copiar (`createMany`) al id nuevo.
3. Si cambió la unidad → descartar, auditado («Se descartó la calibración de «Norte» para Salsa: cambió la unidad»).
4. Si el ingrediente salió de la receta → no se arrastra, se audita como descarte.
5. Un cambio de cantidad/merma CENTRAL no descarta nada (la calibración es de la sucursal). El editor central avisa (paso 7).

**Concurrencia del arrastre**: `guardarReceta` pasa a SERIALIZABLE, reintentando UNIQUE y conflicto de serialización (`esErrorDeUnicidad(e) || esConflictoDeEscritura(e)`, ya existen ambas). La acción de calibrar también usa `conTransaccionSerializable`. Si chocan, la calibración ve que su línea ya no es vigente y se rechaza con «La receta cambió mientras mirabas el reporte; recargá». Test de concurrencia en paso 6.

**D4. «Usar este valor» escribe el override de la sucursal ACTIVA, nunca la fila central.**
- Acción nueva `fijarRendimientoLocal(recetaIngredienteId, { cantidad, mermaPorcentaje }, origen?)` en `src/server/actions/catalogo/rendimiento-local.ts`.
- NO recibe `sucursalId` por parámetro: siempre `ctx.sucursalId`. Elimina de raíz el bug original.
- Valida dentro de la transacción que `recetaIngredienteId` pertenezca a la versión vigente.
- **DECISIÓN DEL DUEÑO: la merma se congela junto con la cantidad** — al aplicar una sugerencia se escriben `cantidad = estimado neto` Y `mermaPorcentaje = la merma efectiva usada en el cálculo`.
- «Volver al valor central»: `volverAlRendimientoCentral(recetaIngredienteId)` pone los dos campos en `null` (no borra la fila) y lo audita.
- Validación: `cantidad` null o finita >0 y < tope `Decimal(14,4)`; `merma` null o finita, 0 a 9999,99 (`Decimal(6,2)`).

**D5. DECISIÓN DEL DUEÑO: permiso nuevo `calibrar_rendimiento_local`**, sembrado solo para admin. Separado de `guardar_receta` (editar la receta global es una decisión distinta de calibrar la sucursal propia; si el día de mañana se restringe quién edita el catálogo global, calibrar la sucursal propia no queda atado a esa decisión).

**D6. Auditoría.**

*(a) Override local.*

| Campo | Valor |
|---|---|
| `entidad` | `"RendimientoLocalIngrediente"` |
| `entidadId` | clave ESTABLE `${sucursalId}:${productoId}:${insumoProductoId}` (el id de la fila cambia en cada versión por el arrastre; con esta clave el historial se lee de corrido; molde de `DisponibilidadProducto`) |
| registros | dos llamadas, `campo: "cantidad"` y `campo: "mermaPorcentaje"` (molde de `precio-local.ts`); cada una no-op si no cambió |
| `valorAnterior`/`valorNuevo` | `null` = «usaba el central» |
| `sucursalId` | `ctx.sucursalId` (la sucursal cuya calibración cambió) |

Descripciones ejemplo:
- Manual: `Rendimiento de "Salsa" en "Pizza muzza" en «Centro» (central: 1 kg, merma 0 %): cantidad — edición manual`.
- Sugerencia: `... — desde sugerencia de Rendimiento real de recetas (sugerido 2, guardado 1.8; 4 semana(s), confianza media; comprado 20, vendido 10)`, o variante pool: `(insumo compartido por 3 plato(s), 6 semana(s), ajuste R² 0.82)`.
- Descarte por arrastre: `... — descartado al guardar la versión 5 de la receta central: cambió la unidad de g a kg`.

*(b) Versión de la receta central.*
- `entidad: "RecetaVersion"`, `entidadId` = id de la versión nueva, `campo: "version"`, anterior → nueva.
- `sucursalId: null` (alcance = Catálogo Central).
- Descripción: «guardada desde «X»».
- Origen siempre manual (`guardarReceta` no necesita parámetro `origen`).
- Los dos registros se escriben dentro de la misma transacción que el cambio.

*(c) Origen (declarado por el cliente, es una anotación no una prueba).* Se normaliza en el servidor (números finitos, textos recortados). Si `origen.sucursalCalculoId !== ctx.sucursalId` → se RECHAZA la escritura («Cambiaste de sucursal desde que abriste el reporte; recargalo»).

**D7. El aviso de alcance se reduce a una línea informativa** (ya no hay riesgo que advertir): «Esto cambia solo el rendimiento de «Centro». La receta central (1 kg) y las otras sucursales no se tocan.» + enlace «Comparar con otras sucursales».

**D8. Vista de comparación**: pantalla nueva `/reportes/rendimiento-recetas/por-sucursal`.
- Hereda `ver_reportes_dinero` por prefijo (igual que consolidado).
- Columnas: central + una por sucursal de `ctx.membresias`.
- Métrica comparada: el BRUTO (`cantidad × (1 + merma/100)`) — comparar solo el neto engaña si dos sucursales calibraron mermas distintas. Neto y merma van en el detalle de la celda.
- Desvío contra la central marcado en ámbar (umbral fijo existente, `desvioEsNotable`).
- Filtros: por defecto solo líneas con al menos una calibración visible; `?todas=1` muestra todas; `?productoId=` filtra un plato.

**D9. Qué NO cambia**: `RecetaVersion`/`RecetaIngrediente` (ingredientes, pasos, unidades) siguen siendo una sola fila global, editable solo desde el editor central con `guardar_receta`. `MovimientoStock` no se recalcula. `costo-historico` sigue usando la receta vigente (ahora la efectiva de la sucursal) para días pasados.

**Fuera de alcance** (anotar en paso 12): quién puede editar la receta global; estimación de rendimiento real de otras sucursales lado a lado; calibrar a mano una línea sin sugerencia (opcional, ver paso 8); versionar el historial de overrides para costeo.

## 2. Pasos (un commit por paso)

### Paso 0: Línea de base (sin commit)
Bases descartables, nunca producción: `npx tsc --noEmit`, `npm run lint`, `DATABASE_URL=<desc> DIRECT_URL=<desc> npm test`, `DATABASE_URL=<desc> DIRECT_URL=<desc> npm run build`, `MOTOR2_E2E_DATABASE_URL=<..._e2e> npm run test:e2e`. Anotar archivos/tests/specs que pasan y cualquier fallo previo (documentado, no regresión).

### Paso 1: Tests de caracterización sobre el código actual (ANTES de tocar nada)
`test/recetas/caracterizacion-consumo-y-costo.test.ts` — se escribe y pasa en verde sobre el código de HOY, se commitea solo, ningún paso posterior lo modifica. Fixture con cantidades `0.1`, `0.3333`, `2.5`, mermas `0`, `12.5`, `33.33`; un Insumo con dos hermanos y lotes con vencimiento distinto (FEFO/H9); una subreceta producida (PRODUCCION); un PV `seProduce`. Asserts con valores literales capturados de la corrida actual: (a) filas `MovimientoStock` de `registrarVenta`; (b) las de `registrarMovimiento` PRODUCCION; (c) `calcularCostosYMargenes`; (d) `calcularRendimientoRecetasSimples`/`Compartidas`; (e) `generarReporteDiferenciasAjustes`; (f) `reconstruirCostosDeVenta`; (g) «valor a la carta» de `obtenerReportePromociones`.
Commit: `test(recetas): caracterización exacta de consumo y costo antes del rendimiento por sucursal`.

### Paso 2: Auditoría de la versión central de receta (sin schema)
- `src/core/permisos/auditoria.ts`: sumar `"RecetaVersion"` a la unión de `entidad`; comentar criterio de `sucursalId`.
- `src/server/actions/catalogo/recetas.ts`: usar el `ctx` de `conPermiso`; dentro del `$transaction`, `registrarCambioAuditado` según D6(b). Descripción vía función pura en `src/core/catalogo/describir-cambio-receta.ts`.
- `src/app/(app)/administracion/auditoria/page.tsx`: sumar `"RecetaVersion"` a `ENTIDADES`.
- Test nuevo `test/catalogo/recetas-auditoria.test.ts`: un guardado da un registro (`entidadId`=id versión, `null`→`"1"`, actor admin, `sucursalId` null, descripción con «guardada desde «<sucursal>»»); segundo guardado `"1"`→`"2"`; validación fallida no deja registro; `quitarPasoDeReceta` también auditado.
- `test/catalogo/recetas-concurrencia.test.ts`: agregar aserción — tantos registros como versiones creadas, sin huérfanos.
Commit: `feat(recetas): auditar cada versión nueva de la receta central`.

### Paso 3: Migración — REQUIERE AUTORIZACIÓN EXPRESA (YA AUTORIZADA por el dueño, ver abajo)

Generar con `npx prisma migrate dev --create-only` contra base descartable y comparar con el SQL de abajo (recordar: Prisma suele agregar 4 sentencias ajenas de `Operacion_motivoId_fkey`/`Operacion_destinoId_fkey` — quitarlas a mano, precedente `20260925152432_pos_tomar_pedido`).

**3a. `prisma/migrations/<timestamp>_rendimiento_local_ingrediente/migration.sql`**

En `schema.prisma`, junto a `PrecioLocalProducto`:

```prisma
/// Rendimiento calibrado POR SUCURSAL de UNA línea de receta (override liviano, mismo patrón que PrecioLocalProducto).
/// La receta (ingredientes/pasos/unidades) sigue siendo una sola, del Catálogo Central; esto solo guarda la cantidad y/o
/// la merma que ESTA sucursal calibró. Sin fila, o con un campo en null → se usa el valor central de ese campo
/// (rendimientoEfectivo, src/core/catalogo/rendimiento-local.ts). guardarReceta arrastra las filas a cada versión nueva
/// (salvo cambio de unidad o ingrediente quitado, que se descartan y se auditan).
model RendimientoLocalIngrediente {
  id                  String            @id @default(cuid())
  recetaIngredienteId String
  recetaIngrediente   RecetaIngrediente @relation(fields: [recetaIngredienteId], references: [id], onDelete: Cascade)
  sucursalId          String
  sucursal            Sucursal          @relation(fields: [sucursalId], references: [id])
  cantidad            Decimal?          @db.Decimal(14, 4)
  mermaPorcentaje     Decimal?          @db.Decimal(6, 2)
  actualizadoEn       DateTime          @updatedAt

  @@unique([recetaIngredienteId, sucursalId])
  @@index([sucursalId])
}
```

Más relaciones inversas: `RecetaIngrediente.rendimientosLocales RendimientoLocalIngrediente[]` y `Sucursal.rendimientosLocales RendimientoLocalIngrediente[]`.

```sql
-- CreateTable
CREATE TABLE "RendimientoLocalIngrediente" (
    "id" TEXT NOT NULL,
    "recetaIngredienteId" TEXT NOT NULL,
    "sucursalId" TEXT NOT NULL,
    "cantidad" DECIMAL(14,4),
    "mermaPorcentaje" DECIMAL(6,2),
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RendimientoLocalIngrediente_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RendimientoLocalIngrediente_sucursalId_idx" ON "RendimientoLocalIngrediente"("sucursalId");

-- CreateIndex
CREATE UNIQUE INDEX "RendimientoLocalIngrediente_recetaIngredienteId_sucursalId_key" ON "RendimientoLocalIngrediente"("recetaIngredienteId", "sucursalId");

-- AddForeignKey
ALTER TABLE "RendimientoLocalIngrediente" ADD CONSTRAINT "RendimientoLocalIngrediente_recetaIngredienteId_fkey" FOREIGN KEY ("recetaIngredienteId") REFERENCES "RecetaIngrediente"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RendimientoLocalIngrediente" ADD CONSTRAINT "RendimientoLocalIngrediente_sucursalId_fkey" FOREIGN KEY ("sucursalId") REFERENCES "Sucursal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
```

Sin relleno inicial (a propósito). Aditiva. Reversión: `DROP TABLE "RendimientoLocalIngrediente";` + quitar el modelo.

**3b. `prisma/migrations/<timestamp+1>_permiso_calibrar_rendimiento_local/migration.sql`** (D5 ya decidido: SÍ, permiso nuevo)

```sql
-- Migración de DATOS (no cambia el esquema): agrega la acción `calibrar_rendimiento_local` y la da a admin.
-- Idempotente: ON CONFLICT DO NOTHING no pisa una acción ni un permiso ya configurados. Molde de 20260924153615_permiso_carta.

INSERT INTO "Accion" ("clave", "descripcion") VALUES
  ('calibrar_rendimiento_local', 'Calibrar el rendimiento de las recetas en esta sucursal (cantidad y merma propias de cada ingrediente)')
ON CONFLICT ("clave") DO NOTHING;

INSERT INTO "PermisoRol" ("id", "rolId", "accionClave", "puedeVer", "puedeEditar")
SELECT gen_random_uuid()::text, r."id", 'calibrar_rendimiento_local', true, true
FROM "Rol" r
WHERE r."nombre" = 'admin'
ON CONFLICT ("rolId", "accionClave") DO NOTHING;
```

Reversión: `DELETE FROM "PermisoRol" WHERE "accionClave" = 'calibrar_rendimiento_local'; DELETE FROM "Accion" WHERE "clave" = 'calibrar_rendimiento_local';`

Código mínimo del mismo paso: `src/core/permisos/acciones.ts` con `rolesEditarSemilla: ["admin"]`; `test/arquitectura/toda-accion-se-usa.test.ts` → agregar TEMPORALMENTE a `RESERVADAS_SIN_USO_TODAVIA` (motivo: «se usa desde el paso 6»); `test/setup/test-db.ts` → `await prisma.rendimientoLocalIngrediente.deleteMany();` antes de `sucursal.deleteMany()`; test nuevo `test/permisos/migracion-permiso-calibrar-rendimiento-local.test.ts` calcado de `migracion-permiso-carta.test.ts`.

Commit: `feat(db): tabla RendimientoLocalIngrediente y permiso calibrar_rendimiento_local [requiere autorización]`.

### Paso 4: Función pura del valor efectivo
`src/core/catalogo/rendimiento-local.ts` con `rendimientoEfectivo` (D2). Test `test/catalogo/rendimiento-local.test.ts`: sin override → `Object.is` con central, `calibrado=false`; override parcial (solo merma, solo cantidad); override completo; prueba por propiedades (10.000 pares pseudoaleatorios, LCG con semilla fija) confirmando `Object.is` con la fórmula vieja cuando no hay override.
Commit: `feat(recetas): rendimientoEfectivo (override por sucursal con fallback exacto al central)`.

### Paso 5: Conectar todos los lectores al valor efectivo (el paso delicado)
El test del paso 1 tiene que seguir en verde SIN modificarse.

**Consumo de stock:**
- C1 (`registrar-venta.ts:121-130`): `include: { ingredientes: { include: { rendimientosLocales: { where: { sucursalId } } } } }`. Luego `rendimientoEfectivo(...)` y la fórmula igual con `ef.*`.
- C2 (`movimientos.ts:91-107`): `calcularConsumosProduccion` recibe `sucursalId` (ya lo tiene `armarLineaMovimiento`); resto igual.

**Reportes:**
- R1 `construirIndiceRecetas(db, sucursalId?)`: con sucursalId, valores efectivos; sin ella, valores centrales (para quien solo usa estructura). `IndiceRecetas` suma `sucursalId: string | null`. `IngredienteRecetaReporte` suma `recetaIngredienteId`, `cantidadCentral`, `mermaPorcentajeCentral`, `calibradoLocal`.
- Guarda: toda función que recibe `indiceRecetas` desde afuera lanza si `indiceRecetas.sucursalId !== sucursalId`.
- Pasan sucursalId: `periodo.ts:174`, `costo-historico.ts:70`, `costos.ts:142` y `:353`, `diferencias-ajustes.ts:72`, `core/reportes/promociones.ts:73`. No la pasan: `huecos-catalogo.ts`, `insumos-sin-receta.ts`, `server/actions/reportes/promociones.ts:52` (solo estructura).
- R2 `construirPools`: mismo include anidado; `uso.cantidad`/`uso.mermaPorcentaje` efectivos; sumar `cantidadCentral`/`calibradoLocal`. El RÓTULO sigue con valores centrales (clasifica estructura declarada, no calibración).
- R3: `obtenerIngredientesRecetaVigente(productoId, db, sucursalId?)`.

Guardián nuevo `test/arquitectura/lectores-de-receta.test.ts` (molde `disponibilidad-en-un-solo-lugar.test.ts`): todo archivo que contenga `recetaVersion.find`/`recetaIngrediente.find`/`recetaVersiones:` debe estar en lista explícita, clasificado `efectivo`/`central` con motivo.

Tests `test/movimientos/rendimiento-local-consumo.test.ts` con sucursales A y B: (1) override en B no cambia nada en A; (2) override completo en A da exactamente `q×c_override×(1+m_override/100)`, FEFO igual; B no cambia; (3) override parcial (solo merma); (4) PRODUCCION con override; (5) `calcularCostosYMargenes` por sucursal; (6) índice de otra sucursal lanza; (7) `catalogo-una-sola-carga.test.ts` sigue en 1.
Commit: `feat(recetas): consumo, costos y reportes usan el rendimiento efectivo de la sucursal`.

### Paso 6: Acciones de calibración, arrastre en `guardarReceta` y su auditoría
- `src/server/actions/catalogo/rendimiento-local.ts`: `fijarRendimientoLocal`/`volverAlRendimientoCentral`, con `conPermiso("calibrar_rendimiento_local", ...)` + `conTransaccionSerializable`; validan línea vigente, valores (D4), origen (D6c, rechazo si cambió sucursal); upsert por `recetaIngredienteId_sucursalId` con `ctx.sucursalId`; auditan (D6a); `refrescarVistaSiHaceFalta()`.
- Funciones puras: `src/core/catalogo/origen-cambio-receta.ts` (tipo `OrigenCalibracion`, `normalizarOrigen`, `describirCalibracion`).
- `auditoria.ts`: sumar `"RendimientoLocalIngrediente"`; `auditoria/page.tsx`: sumar a `ENTIDADES`.
- `guardarReceta`: SERIALIZABLE con reintento doble (D3); leer ingredientes de `ultima` con `rendimientosLocales`; arrastrar/descartar/auditar (D3, D6a); mensaje de resultado incluye descartes.
- `toda-accion-se-usa.test.ts`: sacar `calibrar_rendimiento_local` de `RESERVADAS_SIN_USO_TODAVIA`.
- Tests `test/catalogo/rendimiento-local-acciones.test.ts`: fija override de sucursal activa, nunca toca `RecetaIngrediente`; no hay forma de apuntar a otra sucursal; operador sin permiso rechazado; línea no vigente rechazada; origen con otra sucursal rechazado; valores inválidos rechazados; auditoría con dos registros y descripciones correctas; repetir mismos valores no crea registros; `volverAlRendimientoCentral` pone null y audita.
- Tests de arrastre: versión nueva copia overrides; cambio de unidad descarta y audita; quitar ingrediente descarta; cambio de cantidad central no descarta.
- Concurrencia: N iteraciones paralelas de `fijarRendimientoLocal`/`guardarReceta` sobre el mismo plato — al final, o el override está sobre la versión vigente, o la calibración devolvió «la receta cambió»; nunca queda un override huérfano.
Commit: `feat(recetas): calibrar el rendimiento por sucursal, con arrastre entre versiones y auditoría`.

### Paso 7: Pantallas (reporte, editor central, limpieza del flujo viejo)
- `reportes/rendimiento-recetas/page.tsx`: `puedeCalibrar` vía `obtenerMiNivelPermiso(..., "calibrar_rendimiento_local")`; pasar `recetaIngredienteId`, `cantidadCentral`, `calibradoLocal`, merma efectiva, `sucursalNombre`, `puedeCalibrar` a cada fila.
- `fila-simple.tsx`/`fila-compartida.tsx`: celda «Receta actual» muestra efectivo + «(calibrado acá; central: X)» si aplica. Botón «Usar este valor» (solo con `puedeCalibrar`) abre confirmación en la fila con: pregunta «¿Calibrar el rendimiento de {plato—insumo} en «Centro»? Pasás de X a Y {unidad}»; contexto habitual; línea D7 + enlace «Comparar con otras sucursales»; `FormConResultado` con cantidad y merma editables (default: sugerido / efectiva congelada); botón «Guardar como rendimiento de «Centro»» → `fijarRendimientoLocal`. Si calibrado y `puedeCalibrar`: botón «Volver al valor central» con su propia confirmación. DESAPARECE la navegación al editor central con `?sugerido=`.
- Editor central: quitar manejo muerto de `sugerido/comprado/vendido/semanas/confianza/platos/ajuste`. Agregar nota por ingrediente calibrado: «Calibrado en N sucursal(es) (Norte, Sur): ...». Una sola consulta por lotes a `rendimientoLocalIngrediente`.
- Opcional/recortable: botón «Calibrar» manual sin sugerencia.
Commit: `feat(reportes): «Usar este valor» calibra el rendimiento de la sucursal, nunca la receta central`.

### Paso 8: Vista de comparación entre sucursales
- `src/core/reportes/rendimiento-por-sucursal.ts`: `compararRendimientosPorSucursal(sucursales, filtro, db)` — una consulta, armado puro sin `@/lib/db`.
- `src/app/(app)/reportes/rendimiento-recetas/por-sucursal/page.tsx`: gate `ver_reportes_dinero`; columnas = `ctx.membresias`; filtros `?productoId=`/`?todas=1`; reusar `TablaReporte`.
- Enlaces desde encabezado del reporte, la confirmación (D7) y la nota del editor central (solo si el usuario puede ver, `enlaces-con-permiso.test.ts`).
- Sumar ruta a `test/e2e/rutas-sin-parametros.ts`. Opcional: entrada de menú.
- Tests: armado puro (bruto vs neto, desvío, «sin calibrar»); Postgres: sucursal fuera de membresías no aparece.
Commit: `feat(reportes): comparación del rendimiento calibrado entre sucursales`.

### Paso 9: E2E y accesibilidad
- `rendimiento-recetas-confirmar.spec.ts` reescrito (mismo conteo): sucursal B temporal; en A «Usar este valor» → confirmación «solo «A»» → Guardar → fila «calibrado acá; central: 1 kg»; en BD: override A, sin override B, `RecetaIngrediente.cantidad` sigue en 1, registro auditoría con «sugerencia»; comparación muestra central + A calibrada + B «sin calibrar»; «Volver al valor central» → null + registro nuevo; limpieza en `finally`.
- `rendimiento-recetas-agua.spec.ts:97-134`: afirma override guardado con `cantidad` 2,4 (neto) y merma congelada.
- `accesibilidad.spec.ts:441-485`: actualizar filtro de texto y `colSpan`; axe cubre campos nuevos; sumar axe de fila calibrada.
- Nuevos: axe de `por-sucursal` (A calibrada, B sin calibrar); axe del editor central con nota de «calibrado en N sucursales».
Commit: `test(e2e): calibración por sucursal, comparación y accesibilidad`.

### Paso 10: Documentación
`docs/diseno-rendimiento-recetas-por-sucursal.md`: nota de que el principio 6 se mantiene (tabla nueva = override local, como precio local, por decisión del dueño); §3.5 reescrita; regla de arrastre y merma congelada. Pendientes de D9 anotados aparte.
Commit: `docs(recetas): rendimiento por sucursal (override liviano), arrastre, auditoría y comparación`.

### Paso 11: Verificación final OBLIGATORIA de la suite total

Todo en la MISMA corrida, sobre el último commit, bases descartables (migración aplicada SOLO ahí, nunca producción/Neon principal):

| # | Comando | Criterio |
|---|---|---|
| 1 | `npx tsc --noEmit` | salida vacía |
| 2 | `npm run lint` | 0 errores, 0 warnings |
| 3 | `DATABASE_URL=<desc> DIRECT_URL=<desc> npm test` | Vitest entero verde; conteo ≥ línea de base (≈+60 tests esperados) |
| 4 | `DATABASE_URL=<desc> DIRECT_URL=<desc> npm run build` | aplica las dos migraciones nuevas sin error |
| 5 | `MOTOR2_E2E_DATABASE_URL=<..._e2e> npm run test:e2e` | Playwright entero verde; conteo ≥ línea de base (≈+3) |

En Vitest, en particular sin modificarse: `test/recetas/caracterizacion-consumo-y-costo.test.ts` y todos los tests de venta/producción/costos/POS/concurrencia preexistentes. Guardianes: `acciones-con-guarda`, `toda-accion-se-usa`, `disponibilidad-en-un-solo-lugar`, `lectores-de-receta` (nuevo), `enlaces-con-permiso`, `reportes-con-permiso`, `catalogo-una-sola-carga`.

En el build: `prisma migrate status` sin divergencias; `git diff main -- prisma/migrations` muestra solo las dos carpetas nuevas.

Si algo falla, corregir y repetir LOS CINCO comandos.

**Criterio de "el valor central da lo mismo que hoy"** (las tres a la vez): (1) el test del paso 1 sigue verde sin tocarlo; (2) la prueba por propiedades del paso 4 (`Object.is`); (3) el caso 1 del paso 5 (override en otra sucursal no mueve un solo número de esta).

### Paso 12: Pendientes fuera de este alcance (anotar, no implementar)
Quién puede editar la receta global; estimación de rendimiento real de otras sucursales lado a lado; calibrar a mano líneas sin sugerencia (si se recortó en paso 7); mostrar «quién» por versión en el historial; comentario `///` desactualizado de `RegistroAuditoria.entidad` (`schema.prisma:219`).

## 3. Riesgos
- Pasar `guardarReceta` a SERIALIZABLE puede subir reintentos — cubierto por tests de concurrencia.
- Un lector futuro que se olvide del override — cubierto por el guardián `lectores-de-receta` y la guarda de `IndiceRecetas.sucursalId`.

## Decisiones de autorización (YA RESUELTAS por el dueño del producto, 2026-09-26)

1. **Migración (paso 3, tabla `RendimientoLocalIngrediente`): AUTORIZADA.**
2. **Permiso de calibración (D5): permiso nuevo `calibrar_rendimiento_local`** (no reusar `guardar_receta`), con su migración de datos (paso 3b) — AUTORIZADO.
3. **Merma congelada (D4): SÍ**, se congela junto con la cantidad al calibrar.

## Archivos clave
- `/home/user/motor2-recetas-central/prisma/schema.prisma` (+ las dos migraciones nuevas)
- `/home/user/motor2-recetas-central/src/core/movimientos/registrar-venta.ts` y `src/server/actions/movimientos/movimientos.ts` (`calcularConsumosProduccion`)
- `/home/user/motor2-recetas-central/src/core/reportes/comun.ts` (`construirIndiceRecetas`) y `src/core/reportes/rendimiento-recetas.ts`
- `/home/user/motor2-recetas-central/src/server/actions/catalogo/recetas.ts` (auditoría central, arrastre, SERIALIZABLE) y el nuevo `src/server/actions/catalogo/rendimiento-local.ts`
- `/home/user/motor2-recetas-central/src/app/(app)/reportes/rendimiento-recetas/fila-simple.tsx` (y `fila-compartida.tsx`, `page.tsx`, la nueva `por-sucursal/page.tsx`)
