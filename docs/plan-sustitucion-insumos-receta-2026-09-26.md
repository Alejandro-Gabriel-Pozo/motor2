# Plan: sustitución de insumos declarada por línea de receta

Rama `feat/sustitucion-insumos-receta` (ramificada desde `feat/seccion-habitual-stock`, HEAD `accb3fa` al momento de diseñar). Plan de implementación completo entregado por el Plan agent, con las 2 decisiones de autorización ya resueltas por el dueño del producto (ver "Decisiones de autorización" al final). Implementar paso por paso, un commit por paso, en el orden dado.

## 0. Qué hace hoy el código (corrige en parte la descripción del pedido original)

1. **El reparto por hermanos de la venta ya no es `resolverConsumoPorFamilia`.** Mostrador y cierre del POS asignan con el libro de `src/core/movimientos/origen-venta.ts` (`crearLibroDeStock` + `asignarConsumo`). `resolverConsumoPorFamilia` (`stock.ts`) queda solo para Producción, que todavía tiene su propio H9, documentado y sin arreglar (fuera de alcance de este plan).
2. **El libro reparte de forma parcial, no "todo o nada".** El viejo `resolverConsumoPorFamilia` no repartía si el Insumo entero no alcanzaba. `asignarConsumo` hace otra cosa:
   - recorre las secciones en orden (habitual, después respaldos ordenados por el vencimiento de TODA la familia);
   - dentro de cada sección, FEFO sobre la familia entera (desempate: primero el producto de la receta, después `productoId`);
   - toma todo lo disponible y carga SOLO el resto al producto de la receta, en `seccionParaFaltanteId`.
3. **Las familias se arman en `cargarFamilias`** (`origen-venta-datos.ts`): MP del mismo `insumoId`, disponibles en la sucursal, `orderBy id asc`. No mira `Insumo.activo` ni la unidad.
4. **Hoy el Kardex no distingue un consumo de hermano.** La fila CONSUMO lleva el `productoId` realmente consumido y el mismo `detalle` de siempre: `Consumo por venta de "X".`. No hay ninguna columna ni marca. Solo se nota viendo, en Trazabilidad, que el producto de la fila no es el de la receta.
5. **Costeo: `costoUnitarioAlVender` se calcula ANTES de asignar.** Sale de `calcularCostosYMargenes` → `resolverCostoUnitario`, con el costo de reposición del producto anclado en la receta (`insumoProductoId`). Consumir un hermano no cambia el costo guardado en `MovimientoStock.costoUnitarioVenta`: se guarda el costo teórico de la receta, no el del producto consumido. En cambio, `perdidas.ts` valora cada fila CONSUMO con el costo del producto consumido.
6. **Versionado de recetas append-only con ida y vuelta.** Toda edición puntual (paso, ficha, otro ingrediente) relee la receta vigente con `mapIngredientesAInput` y llama a `guardarReceta`, que crea una versión nueva. Todo lo que no se copie en esa ida y vuelta se pierde en silencio en la próxima edición. Es el riesgo principal de la parte de catálogo.
7. **Otros datos que el diseño tiene en cuenta:**
   - `renombrarOFusionarInsumo` borra el Insumo viejo (`insumo.delete`), así que una FK nueva hacia `Insumo` rompería la fusión si no se maneja.
   - `huecos-catalogo.ts` detecta Insumos con unidades de stock mezcladas: en la base puede haber datos así.
   - `armarLinea` no convierte unidades: `cantidad × ing.cantidad × (1+merma)` se descuenta tal cual en la unidad de stock de la MP.
   - `anularVenta` revierte fila por fila leyendo `productoId`, así que una venta con sustitución se anula bien sin cambios.

## 1. Decisiones de diseño

**D1. Modelo.** Tabla nueva `SustitutoRecetaIngrediente`: `recetaIngredienteId` (cascade, igual que `RecetaPasoIngrediente`), `insumoSustitutoId` (FK a `Insumo`, RESTRICT), `orden` (1..n). Dos UNIQUE: (ingrediente, insumo) y (ingrediente, orden). No modifica ninguna columna de `RecetaIngrediente`. Como vive por `RecetaIngrediente`, cada versión de la receta guarda sus propios sustitutos (auditable). El sustituto es un Insumo: se resuelve con sus propios hermanos, igual que el principal.

**D2. Alcance: solo recetas que se consumen al vender.** Se rechaza declarar sustitutos en la receta de un producto `seProduce` (MP o PV). Producción usa `resolverConsumoPorFamilia`, y extenderlo queda fuera de alcance. Si más adelante alguien activa "Se produce" en un PV que ya tenía sustitutos, Producción los ignora (documentado).

**D3. Orden de resolución, dentro de una línea.**
1. La familia principal en TODAS las secciones candidatas, exactamente como hoy.
2. Recién después, cada sustituto en orden, cada uno con su familia (secciones y FEFO propios, desempate por `productoId`).
3. Por último, el faltante al principal.

Consecuencia: si Cocina (habitual) tiene Ojo de bife y Depósito (respaldo) tiene Bife de chorizo, se usa el Bife del Depósito. Sustituto solo con el principal y sus hermanos agotados.

**D4. Todo o nada para el conjunto de sustitutos.** Los sustitutos se usan solo si la suma de lo disponible de TODOS ellos (secciones candidatas) cubre el resto que dejó la familia. Si no alcanza, no se toma nada de ningún sustituto y la línea queda EXACTAMENTE como hoy: mismo faltante, mismo `requerido`, mismo mensaje. Asimetría deliberada con los hermanos (que sí reparten parcial): así el caso de falla es idéntico al de hoy, documentada.

**D5. Los sustitutos se resuelven en una segunda pasada, entre TODAS las líneas de la venta.** Si se resolvieran dentro de cada línea, la línea 1 (Milanesa: Bife, sustituto Ojo) podría llevarse el Ojo de bife que necesita la línea 2 ("Ojo a la parrilla", sin alternativa). Por eso:
- **Pasada 1** (orden de líneas/ingredientes, igual que hoy): sin sustitutos, mismo `asignarConsumo` de siempre. Con sustitutos, toma solo de su familia principal, sin faltante, queda diferido con su resto.
- **Pasada 2** (mismo orden): cada diferido prueba sus sustitutos (D4) y después su faltante.

Regla resultante: una sustitución nunca le saca stock a un consumo principal de la misma venta.

**D6. Trazabilidad más visible que un hermano, en tres capas:**
- Columna nueva `MovimientoStock.sustituyeAProductoId` (nullable, FK a `Producto`): el producto de la receta al que reemplazó.
- `detalle` distinto solo cuando hay sustitución: `Consumo por venta de "Milanesa" — SUSTITUTO de "Bife de chorizo" (no había stock).`
- Etiqueta "Sustituto de «Bife de chorizo»" en Trazabilidad e Historial por producto, leída de la columna (texto, no solo color).

Opcional pero recomendado: `ResultadoVentaEnTx` suma `sustituciones`, y mostrador/cierre del POS agregan una nota al mensaje.

**D7. Costeo: se mantiene el mismo criterio que con los hermanos.** `costoUnitarioVenta` sigue siendo el costo teórico de la receta, anclado al producto principal; la sustitución NO lo cambia. Diferencia real: entre hermanos del mismo Insumo los costos suelen ser parecidos; un sustituto de OTRO Insumo puede costar muy distinto, así que el margen real de Reportes → Período puede quedar sub/sobreestimado en esas ventas. No se corrige acá (evita un segundo criterio de costo solo para sustituciones). Pérdidas ya valora cada CONSUMO con el costo del producto consumido; la columna de D6 permite construir después un reporte de "costo real vs. teórico" (seguimiento, fuera de alcance). Si el principal no tiene costo, la venta queda con costo `null` igual que hoy (no se usa el costo del sustituto como respaldo).

**D8. Compatibilidad del sustituto.** Al guardar se valida: el Insumo existe y está activo; no es el Insumo del propio principal; sin duplicados; todas sus MP tienen el mismo `unidadStockId` que la MP principal. Al vender, como defensa (datos viejos o cambios posteriores): la familia sustituta se filtra por MP, disponible en la sucursal, `Insumo.activo`, mismo `unidadStockId` que el principal, y sin productos que ya estén en la familia principal.

**D9. Fusión de Insumos.** Antes del `insumo.delete`, dentro de la misma `$transaction`: reapuntar los sustitutos al Insumo destino; borrar duplicados o los que queden redundantes con el principal; renumerar `orden`. Misma mutación global que ya hace la fusión con `Producto.insumoId`.

## 2. Independencia de la otra feature en paralelo (`feat/rendimiento-receta-por-sucursal`)

- Migraciones aditivas y propias: una tabla nueva y una columna nullable nueva en `MovimientoStock`. No se altera ninguna columna existente de `RecetaIngrediente`.
- Conflictos textuales esperables al integrar ambas ramas (orden de implementación, no de diseño): `schema.prisma` (relaciones en `RecetaIngrediente`), `registrar-venta.ts`/`armarLinea` (los dos agregan datos al pedido, en campos distintos), `recetas.ts` (`IngredienteInput`, `mapIngredientesAInput`, el `create` de `guardarReceta`), el formulario Editar ingrediente en `catalogo/recetas/[productoId]/page.tsx`.
- Si la otra rama entra primero con una migración de fecha posterior, renombrar la carpeta de la nuestra a una fecha posterior (solo si todavía no se aplicó en ninguna base compartida).
- Efecto a informar, no a coordinar: la sustitución hace que "Rendimiento real de recetas" vea el pool de Bife sub-consumido y el de Ojo sobre-consumido. No se toca `rendimiento-recetas.ts` acá — la columna de D6 permite corregirlo después en un seguimiento.

## 3. Pasos (un commit por paso, en orden)

### Paso 0: Línea de base (sin commit)
En base local/descartable, sobre el HEAD actual: `npx tsc --noEmit`, `npm run lint`, `npm test`, `npm run build`, `npm run test:e2e`. Anotar cantidad de tests de Vitest (archivos y tests) y de specs/tests de Playwright. Si `tsc` ya muestra el ruido conocido de `LayoutProps`, dejarlo anotado y exigir lo mismo al final.

### Paso 1: Tests de caracterización ANTES de tocar código (solo tests, verdes sobre el código actual)
- `test/core/fixtures/origen-venta-referencia.ts`: copia literal de `asignarConsumo` y sus auxiliares tal como están hoy, marcada "referencia congelada, no editar".
- `test/core/origen-venta-diferencial.test.ts`: PRNG con semilla fija, ~500 escenarios al azar (1–3 secciones, lotes con/sin fecha, familias de 1–3, saldos negativos incluidos, habitual/respaldos al azar, cantidades con 4 decimales); 1–4 pedidos por escenario sobre el mismo libro, compartiendo familias (ejercita H9). Compara `asignarConsumo` real contra la referencia: resultado de cada pedido (`toStrictEqual`), estado final del libro (`cargados()` y `cargado` por par) y `faltantesDe`.
- `test/movimientos/venta-caracterizacion-consumo.test.ts` (Postgres): una venta mixta (línea con hermanos repartidos, línea `seProduce`, línea con faltante en modo POS, una MP en consignación); verifica filas `MovimientoStock` escritas (productoId, seccionId, proceso, cantidad, loteVencimiento, detalle, precioTotal, precioPorUnidadStock, costoUnitarioVenta, en orden), `avisosStockNegativo` y mensaje; lo mismo en mostrador con rechazo (mensaje exacto).
Commit: `test(ventas): caracterizar el consumo de receta antes de sustitutos`.

### Paso 2: Refactor puro del núcleo, sin cambio de comportamiento
En `origen-venta.ts`: extraer el cuerpo del bucle de secciones de `asignarConsumo` a `tomarDeFamilia(libro, { familia, preferidoId, cantidad, seccionHabitual, respaldos }) → { partes, restante }`, moviendo el código sin reescribirlo. `asignarConsumo` pasa a ser `tomarDeFamilia` + faltante + `juntarPartes`, misma aritmética, mismo orden de `restante -= tomar`. Todos los tests existentes y los del paso 1 siguen verdes SIN modificarlos.
Commit: `refactor(ventas): extraer tomarDeFamilia del núcleo de origen`.

### Paso 3: Núcleo puro de sustitución (sin base, sin schema)
En `origen-venta.ts`:
- `ParteConsumo = ParteAsignada & { sustituyeAProductoId?: string }` (la clave solo existe en partes de un sustituto, nunca `undefined` explícito).
- `PedidoDeConsumo` suma `sustitutos?: readonly (readonly string[])[]` (familias ya resueltas, en orden).
- `asignarConsumosDeVenta(libro, pedidos): ParteConsumo[][]`: pasada 1 (`asignarConsumo` si no hay sustitutos; si hay, `tomarDeFamilia` y diferir); pasada 2 (por diferido: dedupe contra familia principal, disponible total D4; si alcanza, `tomarDeFamilia` por sustituto en orden marcando `sustituyeAProductoId`; después el faltante con `ultimaAhi` y `juntarPartes`).
`asignarConsumo` y `elegirSeccionDeStockPropio` quedan sin cambios.

Tests en `test/core/origen-venta-sustitutos.test.ts`:
1. Diferencial: sin sustitutos / `sustitutos: []` contra la referencia congelada (mismos escenarios del paso 1), bit a bit igual, ninguna parte con `sustituyeAProductoId`.
2. Hermanos antes que sustitutos, una sección: A=0, hermano B=0,3, sustituto S=1, pedido 0,5 → B 0,3 + S 0,2.
3. Hermanos antes que sustitutos, entre secciones: sustituto en habitual, hermano en respaldo → primero el hermano.
4. Orden declarado: S1 antes que S2.
5. FEFO y orden de secciones dentro de la familia sustituta.
6. Todo o nada (D4): sustitutos no alcanzan → ninguna parte de sustituto, faltante idéntico a sin sustitutos.
7. Equidad entre líneas (D5): pedido 1 = A vacío con sustituto S; pedido 2 = S principal con justo lo necesario → pedido 2 completo, pedido 1 va a faltante.
8. Dedupe: familia sustituta que contiene un producto de la principal no lo usa dos veces.
9. Marca: partes de sustituto llevan `sustituyeAProductoId` = principal.

Demostración de que los tests detectan lo que dicen (mutar → rojo → revertir → verde): sustitutos antes que `tomarDeFamilia` → caen 2 y 3; sustitutos dentro de pasada 1 → cae 7; reparto parcial → cae 6; marca siempre asignada → caen 1 y 9.
Commit: `feat(ventas): núcleo puro de sustitución por línea de receta`.

### Paso 4 (REQUIERE AUTORIZACIÓN EXPRESA — YA AUTORIZADA, ver abajo): migración A, tabla de sustitutos

```prisma
/// Insumos que pueden reemplazar a la MP de UNA línea de receta cuando ella y sus hermanos se agotan en la venta
/// (docs/plan-sustitucion-insumos-receta-2026-09-26.md). Por línea, no por Insumo global. Viaja con la versión de la
/// receta (append-only).
model SustitutoRecetaIngrediente {
  id                  String            @id @default(cuid())
  recetaIngredienteId String
  recetaIngrediente   RecetaIngrediente @relation(fields: [recetaIngredienteId], references: [id], onDelete: Cascade)
  insumoSustitutoId   String
  insumoSustituto     Insumo            @relation(fields: [insumoSustitutoId], references: [id])
  orden               Int

  @@unique([recetaIngredienteId, insumoSustitutoId], map: "SustitutoRecetaIngrediente_ingrediente_insumo_key")
  @@unique([recetaIngredienteId, orden])
  @@index([insumoSustitutoId])
}
```
Más `sustitutos SustitutoRecetaIngrediente[]` en `RecetaIngrediente` y `sustitutoEn SustitutoRecetaIngrediente[]` en `Insumo`. El `map` explícito hace falta porque el nombre por defecto tiene 68 caracteres y Postgres corta en 63.

Generar con `prisma migrate dev --create-only` y dejar exactamente esto, sacando la deriva ajena de `Operacion_motivoId_fkey`/`Operacion_destinoId_fkey` (precedente ya documentado en el repo):
```sql
CREATE TABLE "SustitutoRecetaIngrediente" (
    "id" TEXT NOT NULL,
    "recetaIngredienteId" TEXT NOT NULL,
    "insumoSustitutoId" TEXT NOT NULL,
    "orden" INTEGER NOT NULL,
    CONSTRAINT "SustitutoRecetaIngrediente_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SustitutoRecetaIngrediente_ingrediente_insumo_key" ON "SustitutoRecetaIngrediente"("recetaIngredienteId", "insumoSustitutoId");
CREATE UNIQUE INDEX "SustitutoRecetaIngrediente_recetaIngredienteId_orden_key" ON "SustitutoRecetaIngrediente"("recetaIngredienteId", "orden");
CREATE INDEX "SustitutoRecetaIngrediente_insumoSustitutoId_idx" ON "SustitutoRecetaIngrediente"("insumoSustitutoId");
ALTER TABLE "SustitutoRecetaIngrediente" ADD CONSTRAINT "SustitutoRecetaIngrediente_recetaIngredienteId_fkey" FOREIGN KEY ("recetaIngredienteId") REFERENCES "RecetaIngrediente"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SustitutoRecetaIngrediente" ADD CONSTRAINT "SustitutoRecetaIngrediente_insumoSustitutoId_fkey" FOREIGN KEY ("insumoSustitutoId") REFERENCES "Insumo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
```
Reversión: `DROP TABLE "SustitutoRecetaIngrediente";`. En el mismo commit, `test/setup/test-db.ts`: `await prisma.sustitutoRecetaIngrediente.deleteMany();` antes de `recetaIngrediente.deleteMany()`.
Commit: `feat(db): SustitutoRecetaIngrediente`.

### Paso 5 (REQUIERE AUTORIZACIÓN EXPRESA — YA AUTORIZADA, ver abajo): migración B, marca en el Kardex

En `MovimientoStock`:
```prisma
  /// Solo filas CONSUMO de una venta cuyo consumo salió de un Insumo SUSTITUTO declarado en la línea de receta: el producto
  /// de la receta al que reemplazó. null en todo lo demás (incluido un consumo de un hermano del mismo Insumo).
  sustituyeAProductoId String?
  sustituyeAProducto   Producto? @relation("MovimientoSustituyeA", fields: [sustituyeAProductoId], references: [id])
```
Más `consumosQueLoSustituyen MovimientoStock[] @relation("MovimientoSustituyeA")` en `Producto`. Si `prisma validate` marca ambigüedad con la relación `Producto`↔`MovimientoStock` existente, nombrar esa con su nombre por defecto explícito (`@relation("MovimientoStockToProducto")` en los dos lados) — no cambia SQL.

```sql
ALTER TABLE "MovimientoStock" ADD COLUMN "sustituyeAProductoId" TEXT;
ALTER TABLE "MovimientoStock" ADD CONSTRAINT "MovimientoStock_sustituyeAProductoId_fkey" FOREIGN KEY ("sustituyeAProductoId") REFERENCES "Producto"("id") ON DELETE SET NULL ON UPDATE CASCADE;
```
Reversión: `ALTER TABLE "MovimientoStock" DROP COLUMN "sustituyeAProductoId";`. Columna nullable sin default, sin backfill. Sin índice (todavía ninguna consulta filtra por ella).
Commit: `feat(db): MovimientoStock.sustituyeAProductoId`.

### Paso 6: Catálogo, acciones de receta (`src/server/actions/catalogo/recetas.ts`)
- `IngredienteInput.insumoSustitutoIds?: string[]` (en orden).
- `INCLUDE_RECETA_COMPLETA.ingredientes.include.sustitutos = { orderBy: { orden: "asc" }, include: { insumoSustituto: true } }`.
- `mapIngredientesAInput` copia `insumoSustitutoIds` (la ida y vuelta crítica del punto 0.6).
- `guardarReceta`: `sustitutos: { create: ids.map((id, i) => ({ insumoSustitutoId: id, orden: i + 1 })) }` anidado por ingrediente.
- `validarIngredientes(items, producto)` suma D2 y D8, mensajes en castellano: «La sustitución automática solo aplica a platos que se descuentan al vender (no a recetas que se producen).»; duplicado; inactivo; unidad distinta.
- `actualizarIngredienteDeReceta` acepta `cambios.insumoSustitutoIds?` (`undefined` = conservar los actuales).
- Sin acción ni permiso nuevo — no cambia `toda-accion-se-usa` ni `acciones-con-guarda`.

Tests en `test/catalogo/recetas-sustitutos.test.ts`: se crean con su orden; regresión de ida y vuelta (agregar paso/editar ficha/editar u quitar otro ingrediente/reordenar pasos conserva los sustitutos en la versión nueva); la versión vieja conserva los suyos; cada validación; quitar el ingrediente se lleva sus sustitutos. Mutación: sacar la copia en `mapIngredientesAInput` → cae la regresión de ida y vuelta.
Commit: `feat(recetas): sustitutos por línea de ingrediente`.

### Paso 7: Fusión de Insumos (`src/server/actions/catalogo/insumos.ts`)
D9 dentro de la `$transaction`. Tests en `test/catalogo/insumos.test.ts`: la fusión reapunta; el duplicado se colapsa; el redundante con el principal se borra; la fusión ya no falla por la FK.
Commit: `fix(catalogo): la fusión de insumos arrastra los sustitutos de receta`.

### Paso 8: Venta (`origen-venta-datos.ts`, `registrar-venta.ts`)
En `cargarDatosDeOrigen`: recibe `insumoSustitutoIds` (vacío = sin consulta extra); carga las MP de esos Insumos (`insumo.activo`, `select id, insumoId, unidadStockId`, `orderBy id`) y su disponibilidad; suma esos ids al `groupBy` de saldos; expone `familiaSustitutaDe(insumoId, unidadStockId): string[]`.
En `armarLinea`: el `include` de ingredientes suma `sustitutos` ordenados; el pedido suma `insumoSustitutoIds` y `unidadStockId`.
En `registrarVentaEnTx`: `seProduce` sin cambios; los pedidos MP pasan por `asignarConsumosDeVenta` (misma secuencia si no hay sustitutos); `seccionId` de la línea se calcula después de la pasada 2 (mismo valor si no hubo diferidos); `familiasIds` suma familias sustitutas; en la fila CONSUMO, solo si `c.sustituyeAProductoId`: la columna y el `detalle` de D6 (si no, el objeto es idéntico a hoy). Consignación sin cambios.

Tests en `test/movimientos/venta-sustitucion-insumos.test.ts` (Postgres): mostrador con Bife=0 y Ojo=1 → venta sale, fila CONSUMO de Ojo con `sustituyeAProductoId`=Bife y detalle; "Bife a la parrilla" sin sustitutos → mismo rechazo de hoy; POS: hermano en respaldo antes que sustituto en habitual; sustitutos insuficientes → mismo aviso de negativo; defensas (unidad distinta, no disponible, Insumo inactivo) → no se usa; `costoUnitarioVenta` idéntico con/sin sustitución; `anularVenta` devuelve el saldo de Ojo; sustituto en consignación → fila de liquidación sobre el sustituto; equidad entre líneas de punta a punta. Los tests de caracterización del paso 1 siguen verdes sin tocarlos, sumando verificación `sustituyeAProductoId === null` en todas las filas.
Commit: `feat(ventas): la venta consume el insumo sustituto declarado cuando el principal se agota`.

### Paso 9: Visibilidad
`trazabilidad.ts`/`historial-producto.ts`: sumar `sustituyeANombre: string | null`. Etiqueta en `tabla-trazabilidad.tsx`/`tabla-historial.tsx`. Opcional (D6): `sustituciones` en el resultado y nota en el mensaje de `venta.ts`/`pos/cuenta.ts`. Tests de integración de las dos consultas.
Commit: `feat(reportes): mostrar las sustituciones en Trazabilidad e Historial`.

### Paso 10: Pantalla del editor
En `catalogo/recetas/[productoId]/page.tsx`: en lectura, debajo del ingrediente, «Si no hay stock, se usa: Ojo de bife → Vacío» (aviso ámbar si algún sustituto quedó inactivo/incompatible). En el formulario Editar, `<fieldset>`/`<legend>` «Sustitutos si no hay stock (en orden)»: un `<select>` por sustituto actual + uno vacío (agregar más sin JS de cliente); opciones = Insumos activos compatibles por unidad, sin el del propio principal; elegir vacío quita ese sustituto; se oculta si `producto.seProduce`. La acción pasa `insumoSustitutoIds` (selects no vacíos, en orden). `historial/page.tsx`: mostrar los sustitutos de cada versión.

E2E en `test/e2e/recetas-sustitutos.spec.ts`: sembrar PV y dos MP de dos Insumos en kg; Editar, elegir sustituto, Guardar; ver el texto; editar un paso y confirmar que el sustituto sigue; el historial lo muestra; sembrar venta con fila marcada y ver la etiqueta en Trazabilidad; axe sobre el editor en modo Editar con el fieldset abierto, y sobre Trazabilidad con la etiqueta.
Commit: `feat(recetas): declarar sustitutos desde el editor de receta`.

### Paso 11: Documentación
Comentario de `costoUnitarioVenta` en el schema (costo teórico también con sustitución); encabezado de `origen-venta.ts`; este plan en `docs/`; nota de seguimiento (reporte costo real vs. teórico, corrección de Rendimiento real con la columna, sustitutos en Producción).
Commit: `docs: sustitución de insumos por línea de receta`.

## 4. Demostración explícita de (a) y (b)

**(a) Una línea sin sustitutos se comporta exactamente igual que hoy**, en tres niveles (corren en la suite total): por construcción (pasada 2 vacía, ninguna clave nueva); diferencial puro (~500 escenarios, `toStrictEqual` contra la referencia congelada); caracterización contra Postgres (filas de Kardex/avisos/mensajes de ANTES del cambio, siguen verdes sin editar). Más todos los tests preexistentes de venta, H9 y POS, sin modificar.

**(b) Primero los hermanos, después los sustitutos, nunca al revés**: tests 2 y 3 del paso 3 y su versión de punta a punta en el paso 8. La mutación que invierte el orden los pone en rojo.

## 5. Paso final OBLIGATORIO: verificación de punta a punta (suite TOTAL, una sola corrida)

Base local/descartable (nunca producción), en este orden, MISMA corrida:

| Comando | Criterio |
|---|---|
| `npx tsc --noEmit` | Salida vacía (o idéntica a la línea de base si ya tenía el ruido de `LayoutProps`) |
| `npm run lint` | 0 errores, 0 warnings |
| `npm test` | Vitest entero en verde. Tests ≥ línea de base + los nuevos |
| `npm run build` | Aplica las 2 migraciones nuevas, `next build` sin warnings nuevos |
| `npm run test:e2e` | Playwright entero en verde. Specs ≥ línea de base + `recetas-sustitutos.spec.ts`. Axe sin violaciones en el editor (modo Editar) y en Trazabilidad con la etiqueta |

Mirar con atención especial: `test/core/origen-venta*.test.ts`, `test/movimientos/venta*.test.ts` (incluido `venta-reparto-entre-lineas`), tests de POS/`cerrarCuenta`, `test/catalogo/recetas*.test.ts`, `test/catalogo/insumos.test.ts`, `test/auditoria/precision-roundtrip-y-reparto.test.ts`, `test/arquitectura/*`, y los e2e `recetas-pasos-reordenar`, `rendimiento-recetas-*`, `pos-tomar-pedido`, `stock-seccion-habitual` y `accesibilidad`.

Se cierra solo cuando los 5 comandos pasan limpios en la misma corrida, conteos ≥ línea de base, y las mutaciones de los pasos 3 y 6 demostradas (rojo con la mutación, verde al revertirla).

## 6. Precondición de datos (catálogo, no código)
Bife de chorizo y Ojo de bife tienen que ser `Insumo`s distintos, cada uno con su MP, las dos con la misma unidad de stock (kg), disponibles en la sucursal. Después, en la receta de Milanesa, Editar la línea de Bife de chorizo → Sustituto 1: Ojo de bife. La receta de "Bife a la parrilla" no se toca.

## 7. Pendientes de seguimiento (fuera de este alcance, anotados a propósito)

- **Reporte de costo real vs. teórico por sustitución.** `costoUnitarioVenta` sigue siendo el teórico de la receta (D7) — con
  `MovimientoStock.sustituyeAProductoId` ya disponible, se puede construir después un reporte que compare ese teórico contra el
  costo real del producto efectivamente consumido (que `src/core/reportes/perdidas.ts` ya calcula por separado).
- **"Rendimiento real de recetas" con sustitución.** Cuando una venta sustituye, el pool de Insumo del producto principal queda
  sub-consumido y el del sustituto sobre-consumido — `rendimiento-recetas.ts` no se tocó en este plan. Corregirlo (por ejemplo,
  reasignando el consumo real al insumo de la receta antes de comparar contra lo comprado) queda para un pendiente aparte.
- **Sustitutos en Producción.** La sustitución solo aplica a lo que se consume al vender (D2) — un producto `seProduce` sigue
  usando `resolverConsumoPorFamilia` (que además tiene su propio H9 sin resolver, documentado antes de este plan). Extender la
  sustitución a Producción es un pendiente propio, no cubierto acá.

## Decisiones de autorización (YA RESUELTAS por el dueño del producto, 2026-09-26)
1. **Migración A (paso 4, tabla `SustitutoRecetaIngrediente`): AUTORIZADA.**
2. **Migración B (paso 5, columna `MovimientoStock.sustituyeAProductoId`): AUTORIZADA.**

## Archivos clave
- `/home/user/motor2-sustitucion-insumos/src/core/movimientos/origen-venta.ts`
- `/home/user/motor2-sustitucion-insumos/src/core/movimientos/registrar-venta.ts`
- `/home/user/motor2-sustitucion-insumos/src/core/movimientos/origen-venta-datos.ts`
- `/home/user/motor2-sustitucion-insumos/src/server/actions/catalogo/recetas.ts`
- `/home/user/motor2-sustitucion-insumos/prisma/schema.prisma`
- También: `catalogo/recetas/[productoId]/page.tsx` y `historial/page.tsx`, `src/server/actions/catalogo/insumos.ts`, `src/core/reportes/trazabilidad.ts`, `src/core/reportes/historial-producto.ts`, `tabla-trazabilidad.tsx`, `tabla-historial.tsx`, `test/setup/test-db.ts`.
