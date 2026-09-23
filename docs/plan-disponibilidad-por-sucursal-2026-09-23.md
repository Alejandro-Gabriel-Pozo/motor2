# Plan de implementación: "Activo de producto" pasa de global a por sucursal (2026-09-23)

**Estado: diseño, NO implementado.** Nada se tocó ni se escribió en el repo todavía.
El código real y el grounding externo están en `docs/grounding-disponibilidad-por-sucursal-2026-09-23.md`.

Las 3 decisiones del dueño (2026-09-23) son el punto de partida y no se vuelven a discutir:
1. El interruptor pasa a ser POR (Producto × Sucursal) — no dos capas. "Inactivo en todas" ≡ el `activo: false` global de hoy.
2. Alta de producto: tilde nuevo **"Activo en todas las sucursales"**. Tildado (default) → activo en todas las que existen hoy. Sin tildar → activo solo en la sucursal del alta; las demás lo activan a mano.
3. Justificación: lo común (compartido entre sucursales) tiene cero fricción; lo excepcional pide un paso explícito por sucursal.

---

## 2. Diseño del schema

### 2.1 Modelo nuevo: `DisponibilidadProducto`

Nombre siguiendo la convención existente `<Concepto>Producto` (`PrecioLocalProducto`, `StockMinimoProducto`, `FrecuenciaConteoProducto`, `PromocionProducto`).

```prisma
/// Disponibilidad de un producto del Catálogo Central EN UNA SUCURSAL
/// (decisión del dueño 2026-09-23): reemplaza el booleano GLOBAL
/// `Producto.activo`, que sacaba un producto de TODO el negocio de una
/// vez. El producto en sí (nombre, código, unidad, receta, precio de
/// lista) sigue siendo central y compartido: lo único que se vuelve
/// local es "¿se usa acá?".
///
/// FILA AUSENTE = NO DISPONIBLE. Es lo contrario al criterio de
/// PrecioLocalProducto/StockMinimoProducto/FrecuenciaConteoProducto
/// (donde "no hay fila" = valor por defecto benigno) y es a propósito:
/// la decisión 2 dice que un producto dado de alta SIN el tilde "Activo
/// en todas las sucursales" no tiene que aparecer en las demás "hasta
/// que un admin de ESA sucursal lo active ahí a mano" — eso solo se
/// cumple si la ausencia significa "no". Por eso el alta materializa
/// filas (todas las sucursales, o solo la del alta) y la migración
/// inicial hace backfill: sin backfill, todo el catálogo existente
/// desaparecería de todas las pantallas al aplicar la migración.
///
/// `disponible = false` y "sin fila" significan lo mismo para el
/// sistema (los colapsa `resolverDisponibilidad`, src/core/catalogo/
/// disponibilidad-producto.ts — un solo criterio, no dos). Se conserva
/// la fila en false en vez de borrarla, igual que el resto del catálogo
/// (activo/habilitado, nunca DELETE): la diferencia solo se usa para el
/// rastro de auditoría ("nunca se configuró acá" vs. "se apagó acá").
///
/// Sin precedente directo en ERPNext ni Dolibarr: los dos tienen la
/// tabla producto × depósito (Item Reorder / llx_product_warehouse_
/// properties) y ninguno le puso un booleano de disponibilidad; lo más
/// cercano es Item.restrict_to_companies + Company Restriction de
/// ERPNext, un nivel más arriba (Company ≙ Sucursal acá). Ver
/// docs/grounding-disponibilidad-por-sucursal-2026-09-23.md.
model DisponibilidadProducto {
  id         String   @id @default(cuid())
  sucursalId String
  sucursal   Sucursal @relation(fields: [sucursalId], references: [id])
  productoId String
  producto   Producto @relation(fields: [productoId], references: [id])
  disponible Boolean

  @@unique([sucursalId, productoId])
}
```

Más las dos relaciones inversas:
- `Sucursal`: `disponibilidadesProducto DisponibilidadProducto[]`
- `Producto`: `disponibilidades DisponibilidadProducto[]`

`disponible` **sin `@default`**, a propósito: toda fila se escribe con un valor explícito; el default vive en la función pura, no en la base (mismo criterio que `FrecuenciaConteoProducto.frecuenciaDias`, que tampoco tiene default).

### 2.2 `Producto.activo`

Decisión 1 dice "no dos capas". Estado final: **`Producto.activo` se elimina**. Pero no en el mismo commit que se crea la tabla — ver P4 (espejo transitorio) y P13 (DROP COLUMN, migración aparte, autorización aparte). Hasta P13, `Producto.activo` se mantiene como espejo derivado `activo = OR(disponible en alguna sucursal)` para que ningún lector aún no migrado vea algo incoherente a mitad de camino.

### 2.3 Migración — **REQUIERE AUTORIZACIÓN EXPRESA, COMMIT SEPARADO (P2)**

`prisma/migrations/<ts>_disponibilidad_producto/migration.sql` (molde: la de `FrecuenciaConteoProducto`, más el backfill):

```sql
-- CreateTable
CREATE TABLE "DisponibilidadProducto" (
    "id" TEXT NOT NULL,
    "sucursalId" TEXT NOT NULL,
    "productoId" TEXT NOT NULL,
    "disponible" BOOLEAN NOT NULL,

    CONSTRAINT "DisponibilidadProducto_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DisponibilidadProducto_sucursalId_productoId_key"
  ON "DisponibilidadProducto"("sucursalId", "productoId");

-- AddForeignKey
ALTER TABLE "DisponibilidadProducto" ADD CONSTRAINT "DisponibilidadProducto_sucursalId_fkey"
  FOREIGN KEY ("sucursalId") REFERENCES "Sucursal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DisponibilidadProducto" ADD CONSTRAINT "DisponibilidadProducto_productoId_fkey"
  FOREIGN KEY ("productoId") REFERENCES "Producto"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill: TODO producto × TODA sucursal, con el valor que tiene HOY el
-- booleano global. Preserva por construcción la equivalencia de la
-- decisión 1 ("inactivo en todas" ≡ el `activo: false` de hoy) y evita
-- que el catálogo entero desaparezca de todas las pantallas.
-- Se incluyen las sucursales con activo=false: una sucursal apagada se
-- puede volver a prender y su catálogo tiene que seguir ahí.
INSERT INTO "DisponibilidadProducto" ("id", "sucursalId", "productoId", "disponible")
SELECT gen_random_uuid()::text, s."id", p."id", p."activo"
FROM "Producto" p CROSS JOIN "Sucursal" s;
```

Notas de implementación:
- `gen_random_uuid()` es built-in desde PG13 (Neon corre PG16+). Los `id` de esta tabla son opacos.
- Volumen: |Producto| × |Sucursal|. Con el catálogo real (cientos de productos, pocas sucursales) es un INSERT de milisegundos.
- **El DROP de `Producto.activo` NO va acá.** Va en su propia migración (P13), con su propia autorización.
- `npm run build` corre `prisma migrate deploy`: por eso la verificación final se hace con `DATABASE_URL` a una base **local/descartable**, nunca Neon.

---

## 3. "¿Está disponible este producto en esta sucursal?" — un solo lugar

Archivo nuevo: **`src/core/catalogo/disponibilidad-producto.ts`**, mismo reparto que `resolverProximoConteo` (pura) + `resolverStockMinimo` (consulta).

```ts
// ---------- PURA (sin Prisma) — el cómputo central de todo el cambio ----------

/** Fila ausente (undefined/null) = NO disponible. `disponible: false` es lo mismo para el sistema. */
export function resolverDisponibilidad(fila: { disponible: boolean } | null | undefined): boolean {
  return fila?.disponible === true;
}

/** Por sucursal, a partir de las filas de UN producto. Toda sucursal sin fila cae en `false`. */
export function resolverDisponibilidadPorSucursal(
  filas: readonly { sucursalId: string; disponible: boolean }[],
  sucursalIds: readonly string[]
): Map<string, boolean>

/** "Inactivo en todas" ≡ el `activo: false` global de hoy (decisión 1). */
export function estaDisponibleEnAlguna(filas: readonly { disponible: boolean }[]): boolean

/** Resumen para la ficha/lista: "disponible en 2 de 4 sucursales". */
export function contarSucursalesDisponibles(
  filas: readonly { disponible: boolean }[], totalSucursales: number
): { disponibles: number; total: number }

// ---------- CONSULTA ----------

/** El ÚNICO lugar donde se escribe el criterio como `where` de Prisma. */
export function whereDisponibleEn(sucursalId: string): Prisma.ProductoWhereInput {
  return { disponibilidades: { some: { sucursalId, disponible: true } } };
}

/** El equivalente del `activo: true` global de hoy, para las validaciones del catálogo central. */
export function whereDisponibleEnAlguna(): Prisma.ProductoWhereInput {
  return { disponibilidades: { some: { disponible: true } } };
}

export async function productoDisponibleEn(sucursalId: string, productoId: string, db?: Db): Promise<boolean>

/** Batch — para listados/reportes, sin N+1. */
export async function disponibilidadDeProductos(
  sucursalId: string, productoIds: string[], db?: Db
): Promise<Map<string, boolean>>

/** Para la ficha: el estado en TODAS las sucursales de un producto. */
export async function disponibilidadPorSucursalDeProducto(productoId: string, db?: Db)
```

**Por qué esto garantiza un único criterio:** ninguna pantalla escribe `{ disponibilidades: { some: ... } }` a mano; todas pasan por `whereDisponibleEn` / `disponibilidadDeProductos` / `productoDisponibleEn`. Se fija con un guardián de arquitectura (P12): falla si aparece `disponibilidades:` en cualquier archivo de `src/` que no sea `src/core/catalogo/disponibilidad-producto.ts`.

### 3.1 Demostración de mutación (OBLIGATORIA)

Sobre `resolverDisponibilidad`, el cómputo central:

1. **Rojo**: cambiar el cuerpo a `return fila?.disponible !== false;` (fila ausente = DISPONIBLE, el default contrario). Correr `npx vitest run test/catalogo/disponibilidad-producto.test.ts`. Tienen que caer como mínimo: "sin fila, NO está disponible", "una sucursal sin fila no cuenta en `resolverDisponibilidadPorSucursal`", "un producto sin ninguna fila no está disponible en ninguna".
2. **Revertir** al cuerpo correcto.
3. **Verde**: el archivo entero vuelve a pasar.

Anotar en el commit la salida de las tres corridas. Si el paso 1 queda verde, el test no está fijando el default y hay que arreglarlo antes de seguir.

---

## 4. El tilde nuevo en el alta

### 4.1 UI — `src/app/(app)/catalogo/productos/producto-form.tsx`

Solo cuando `!editando` (editar no toca disponibilidad: para eso está el toggle por sucursal de §6). Junto a los otros checkboxes del form (`seProduce`, `esConsignacion`):

```
[x] Activo en todas las sucursales

AyudaCampo: Tildado (lo habitual, para insumos y platos compartidos como harina
o sal): queda disponible en las {N} sucursales que existen hoy. Sin tildar: solo
en «{nombreSucursalActual}» — en las demás no va a aparecer hasta que un admin de
esa sucursal lo active ahí.
```

- Estado React `const [activoEnTodas, setActivoEnTodas] = useState(true)` — **default tildado** (decisión 2).
- `N` y `nombreSucursalActual` llegan como props desde `nuevo/page.tsx` (ya tiene `ctx` vía `obtenerContextoUsuario`).
- Se agrega al payload: `DatosProducto.activoEnTodasLasSucursales?: boolean`.
- Contraste: el texto usa `AyudaCampo`, que ya cumple `test/arquitectura/contraste-de-color.test.ts`.

### 4.2 Server — `darDeAltaProducto`

```
conPermiso("alta_producto", async (ctx) => {
  validarComun(...)                                  // igual que hoy
  producto = crearConCodigoAutogenerado(...)         // igual que hoy, FUERA de transacción
  sucursalIds = datos.activoEnTodasLasSucursales !== false
      ? (await prisma.sucursal.findMany({ select: { id: true } })).map(s => s.id)
      : [ctx.sucursalId]
  await prisma.disponibilidadProducto.createMany({
    data: sucursalIds.map(sucursalId => ({ sucursalId, productoId: producto.id, disponible: true })),
  })
})
```

**Por qué el `createMany` va FUERA de una transacción interactiva junto con la creación:** `crearConCodigoAutogenerado` reintenta hasta 5 veces atrapando el `P2002` del INSERT. Dentro de una transacción interactiva de Postgres, el primer INSERT fallido aborta la transacción entera. Se deja la creación como está y el `createMany` va después. Modo de falla si el segundo paso cae: queda un producto sin ninguna fila ⇒ no disponible en ninguna sucursal ⇒ invisible pero inofensivo, arreglable desde `/catalogo/productos` (aparece con "0 de N sucursales"). Documentar en el docstring.

### 4.3 `darDeAltaProductoRapido` — el alta inline del wizard de Compra

No tiene formulario donde meter el tilde. **Sigue el default del tilde: disponible en TODAS las sucursales existentes.** No es una decisión nueva, es el default de la decisión 2 aplicado al caso sin tilde visible. Agregar una línea bajo el modal: "Queda disponible en todas las sucursales."

---

## 5. TODOS los selectores/listados que hoy no filtran por sucursal

### 5.1 El truco mecánico que garantiza que no falte ninguno

**Renombrar, no reinterpretar.** Tres renombres fuerzan a `npx tsc --noEmit` a enumerar cada call-site:

1. `FiltroSelectorProducto.soloActivos` → **`soloDisponibles`**
2. `actualizarActivoProducto(productoId, activo)` → **`actualizarDisponibilidadProducto(productoId, disponible)`** (sucursal desde `ctx`, no parámetro)
3. `dependenciasParaDesactivar(productoId, db)` → **`dependenciasParaDesactivar(productoId, sucursalId, db)`**

### 5.2 Selector de producto — `buscarProductosSelector`

- `await requerirSesion()` → `const ctx = await obtenerContextoUsuario()`. **La sucursal se toma del contexto del servidor, NUNCA de un parámetro del cliente.**
- `...(filtro?.soloActivos ? [{ activo: true }] : [])` → `...(filtro?.soloDisponibles ? [whereDisponibleEn(ctx.sucursalId)] : [])`.

**Los 12 call-sites del selector:**

| # | Archivo | Filtro hoy | Después |
|---|---|---|---|
| 1 | `src/core/movimientos/ui-config.ts:66` (COMPRA) | `{ soloActivos: true, tipo: "MP" }` | `soloDisponibles` |
| 2 | `src/core/movimientos/ui-config.ts:67` (DEVOLUCION_CONSIGNACION) | `{ soloActivos, soloConStockReal, esConsignacion: true }` | `soloDisponibles` |
| 3 | `src/core/movimientos/ui-config.ts:68` (DEVOLUCION_PROVEEDOR) | idem `esConsignacion: false` | `soloDisponibles` |
| 4 | `src/core/movimientos/ui-config.ts:69` (6 procesos restantes) | `{ soloActivos, soloConStockReal }` | `soloDisponibles` |
| 5 | `movimientos/venta/venta-form.tsx:118` | `{ tipo: "PV", soloActivos: true }` | `soloDisponibles` |
| 6 | `movimientos/conteo-fisico/conteo-fisico-grid.tsx:281` | `{ soloActivos, soloConStockReal }` | `soloDisponibles` |
| 7 | `movimientos/precio-local/precio-local-form.tsx:63` | `{ tipo: "PV", soloActivos: true }` | `soloDisponibles` |
| 8 | `stock/minimo/stock-minimo-form.tsx:63` | `{ soloActivos: true }` | `soloDisponibles` |
| 9 | `stock/conteo-frecuencia/conteo-frecuencia-form.tsx:64` | `{ soloActivos: true }` | `soloDisponibles` |
| 10 | `stock/reclasificar/reclasificar-form.tsx:127` | `{ soloActivos: true }` | `soloDisponibles` |
| 11a | `traspasos/solicitar/solicitar-form.tsx:64` | `{ soloActivos: true }` | `soloDisponibles` **+ §5.5** |
| 11b | `traspasos/enviar/enviar-form.tsx:64` | `{ soloActivos: true }` | `soloDisponibles` **+ §5.5** |
| 12 | `components/catalogo/asistente-hermanar.tsx:77` | `{ tipo: "MP", soloActivos: true }` | **`whereDisponibleEnAlguna`** — hermanar es catálogo CENTRAL, filtro nuevo `soloDisponiblesEnAlguna` |

**Los 2 que NO se filtran y se quedan así, a propósito** (documentarlo en el código):
- `reportes/historial/historial-filtros.tsx:72` — el historial de un producto que ya no se usa acá tiene que poder consultarse.
- `reportes/conteos/filtros-conteos.tsx:45` — mismo motivo.

`obtenerProductoOpcion` sigue sin filtrar: solo resuelve la etiqueta de un id ya elegido.

### 5.3 Listados y consultas de servidor que filtran por `activo`

| Archivo:línea | Hoy | Después |
|---|---|---|
| `productos.ts:144` (`listarProductosPagina`) | `select ... activo: true` | `disponibleAca` (de `ctx.sucursalId`) + `sucursalesDisponibles`/`totalSucursales`, batch sin N+1 |
| `productos.ts:187-194` (`validarComun`) | `{ activo: true, nombre }` | `whereDisponibleEnAlguna()` — nombre único es del catálogo CENTRAL |
| `productos.ts:234` (`darDeAltaProductoRapido`) | `{ activo: true, nombre }` | idem `whereDisponibleEnAlguna()` |
| `catalogo/producto.ts:32-34` (`validarUnidadInsumo`) | `{ insumoId, activo: true, ... }` | `whereDisponibleEnAlguna()` |
| `catalogo/producto.ts:59` (`validarUnidadesParaFusion`) | `{ insumoId, activo: true }` | idem |
| `stock/consolidado.ts:51,59` (`calcularStockConsolidado(sucursalId)`) | `activo: true` | `whereDisponibleEn(sucursalId)` — ya recibe `sucursalId` |
| `reportes/valuacion.ts:38,47` | idem | `whereDisponibleEn(sucursalId)` |
| `movimientos/stock.ts:141` (`listarStockParaConteo(seccionId)`) | `!p.activo` | derivar `sucursalId` de `seccion.sucursalId` |
| `movimientos/stock.ts:200` (`resolverConsumoPorFamilia`) | hermanos `{ ..., activo: true }` | hermanos disponibles en la sucursal de esa sección — mejora real, hoy puede repartir a una MP que no se usa acá |
| `reportes/rendimiento-recetas.ts:195,246` (`construirPools`) | `activo: true` ×2 | `construirPools(sucursalId, db)`; los 2 llamadores ya tienen `sucursalId` |
| `reportes/huecos-catalogo.ts:64,69` | `info.activo` | disponible en esta sucursal |
| `reportes/insumos-sin-receta.ts:26` | `info.activo` | idem |
| `reportes/periodo.ts:1123` | `p.activo` | idem |
| `reportes/consignacion.ts:108` | `p.activo && esConsignacion` | idem |
| `reportes/comun.ts:12,77` (`ProductoInfo.activo`) | campo `activo` | pasa a `disponible` (resuelto para la sucursal del reporte) |
| `reportes/historial-producto.ts:10,26` | `activo: p.activo` | `disponible`; el listado sigue trayendo todos los productos (es historial) |
| `catalogo/proveedor-por-producto.ts:31` | `{ ..., producto: { activo: true } }` | `whereDisponibleEn(ctx.sucursalId)` — comparativa de precios es decisión local |
| `catalogo/unidades.ts:92` | `productos: { where: { activo: true } }` | `whereDisponibleEnAlguna()` |
| `reportes/promociones.ts:53` | `{ tipo: "PV", activo: true }` | `whereDisponibleEn(ctx.sucursalId)` — Promociones ya es por sucursal |
| `catalogo/recetas/page.tsx:23` | `{ activo: true, recetaVersiones: { some: {} } }` | `whereDisponibleEnAlguna()` |
| `catalogo/recetas/[productoId]/page.tsx:64` | `{ tipo: "MP", activo: true }` | idem |

### 5.4 Validaciones de movimiento (el punto de aplicación real)

| Archivo:línea | Hoy | Después |
|---|---|---|
| `movimientos/movimientos.ts:116` | `!producto.activo` → "inactivo" | `productoDisponibleEn(ctx.sucursalId, ...)`; mensaje: `«X» no está disponible en «{sucursal}».` |
| `movimientos/venta.ts:71` | `!producto.activo` | idem, por sucursal |
| `movimientos/venta.ts:82-84` | `!mp?.activo` | **por sucursal**: receta central, venta local ⇒ bloquea SOLO en la sucursal donde esa MP no está disponible. Mensaje: `La receta de «X» usa «Y», que no está disponible en «{sucursal}»: activala acá o cambiá la receta.` |
| `catalogo/recetas.ts:133-136` (`validarIngredientes`) | `!mp.activo` | **queda GLOBAL** (`whereDisponibleEnAlguna`) — ver §5.6 |

### 5.5 Traspasos entre sucursales — chequeo NUEVO que hoy no puede existir

`traspasos/traspasos.ts:41-48` (`obtenerProductoTransferible`) hoy solo mira `producto.activo`. Un traspaso tiene origen y destino:
- **Origen**: disponible ahí (de ahí sale el stock).
- **Destino**: disponible ahí también — si no, el stock aterriza en una sucursal que lo filtra de su Stock consolidado y su Valuación: **stock invisible**. Es el bug que este cambio introduciría sin este chequeo.

`obtenerProductoTransferible(productoId, sucursalIds[], tx)` con mensaje: `«X» no está disponible en «{sucursal destino}»: activalo allá antes de enviar.` Aplica a `solicitarTransferencia`, `aprobarYEnviarTransferencia`, `enviarDirecto`.

### 5.6 ¿Una receta puede usar una MP no disponible en la sucursal donde se produce/vende?

**Hoy:** no puede pasar — `activo` es global.

**Diseño propuesto — definición central, aplicación local:**
- `validarIngredientes` **no bloquea por sucursal**: la receta es del Catálogo Central, compartida entre sucursales; bloquear el editor porque una sola sucursal apagó esa MP impediría editar una receta de todas. Exige que la MP esté disponible **en alguna** sucursal (`whereDisponibleEnAlguna`) — traducción exacta del `activo: true` de hoy.
- **La aplicación es local y ya existe**: `venta.ts:82` y `movimientos.ts` (PRODUCCION) rechazan la operación en la sucursal donde la MP no está disponible.
- **Aviso no bloqueante en el editor de recetas**: "Este ingrediente no está disponible en N sucursales (A, B) — ahí este plato no se va a poder vender." Misma filosofía que `validarUnidadInsumo` ("avisa, no impide").

---

## 6. `actualizarActivoProducto` y `dependenciasParaDesactivar` por sucursal

### 6.1 `actualizarDisponibilidadProducto(productoId, disponible)`

```
conPermiso("editar_producto", async (ctx) => {          // el gate YA se evalúa contra ctx.sucursalId
  producto = findUnique(productoId); if (!producto) return error("No se encontró el producto.")
  if (!disponible) {
    { recetasVigentes, saldos } = await dependenciasParaDesactivar(productoId, ctx.sucursalId)
    ... mismo armado de mensaje (enumerar()) ...
  }
  await prisma.disponibilidadProducto.upsert({
    where:  { sucursalId_productoId: { sucursalId: ctx.sucursalId, productoId } },
    update: { disponible },
    create: { sucursalId: ctx.sucursalId, productoId, disponible },
  })
  await sincronizarActivoGlobal(productoId)   // TRANSITORIO hasta P13: activo = OR(disponible)
  await registrarCambioAuditado(prisma, {
    entidad: "DisponibilidadProducto", entidadId: `${ctx.sucursalId}:${productoId}`, campo: "disponible",
    descripcion: `Producto "${producto.nombre}" en "${ctx.sucursalNombre}": disponible`,
    valorAnterior, valorNuevo: disponible, actorId: ctx.usuarioId,
  })
  return ok(`Producto "${producto.nombre}" ${disponible ? "activado" : "desactivado"} en "${ctx.sucursalNombre}".`)
})
```

Detalles fijados por tests existentes:
- `entidadId` compuesto `${sucursalId}:${productoId}` — mismo patrón liviano ya documentado en `RegistroAuditoria`.
- `registrarCambioAuditado` es no-op si el valor no cambió — leer el valor anterior resuelto ANTES del upsert.
- `"editar_producto"` sigue siendo el gate: no hace falta Acción nueva.

### 6.2 `dependenciasParaDesactivar(productoId, sucursalId, db)`

**(a) Saldos — "saldo en OTRAS sucursales no bloquea acá, saldo en ESTA sí".** `where: { productoId, seccion: { sucursalId } }` en vez de `where: { productoId }`. El test existente espera el formato `"Central / Depósito"` — mantenerlo (no aporta simplificarlo).

**(b) Recetas vigentes — de "plato activo" a "plato disponible en ESTA sucursal".** `recetaVersion: { producto: whereDisponibleEn(sucursalId) }` en vez de `{ producto: { activo: true } }`. Un plato que solo existe en otra sucursal no se puede vender acá, así que no bloquea acá.

**Se mantiene intacto**: reactivar nunca se bloquea.

**Tests nuevos obligatorios:**
- "saldo en OTRA sucursal NO bloquea desactivar acá" (2 sucursales + 2 secciones)
- "saldo en ESTA sucursal SÍ bloquea, y dice dónde"
- "un plato disponible solo en otra sucursal NO bloquea desactivar la MP acá"
- "desactivar acá no toca la disponibilidad de la otra sucursal" (el corazón del pendiente)
- "desactivar en la ÚLTIMA sucursal donde estaba disponible equivale al `activo:false` de hoy" (decisión 1)

### 6.3 UI del toggle — sin pantalla nueva

- **`/catalogo/productos`**: columna `Activo` → **`Disponible acá`** (Sí/No) + columna **`Sucursales`** ("2 de 4"). Aviso reescrito: *"Desactivar lo saca de los selectores, del stock consolidado y de la valuación de esta sucursal; en las demás no cambia nada. El historial se conserva. Si algo todavía depende de él acá (recetas vigentes, saldo), no se deja desactivar."*
- **`/catalogo/productos/[id]`**: subtítulo → `… · Disponible en «Central»` / `No disponible en «Central»`, + sección nueva **"Disponibilidad por sucursal"**: tabla `Sucursal | Disponible | Acciones`, solo la fila de `ctx.sucursalId` con botón (el gate se evalúa contra la sucursal activa). Guardianes de arquitectura a respetar: `encabezados-de-tabla.test.ts` (`<th><span className="sr-only">Acciones</span></th>`), `contraste-de-color.test.ts` (`text-neutral-500 dark:text-neutral-400`).

---

## 7. Qué NO cambia

1. `Producto` sigue siendo Catálogo Central — `codigo`, `nombre`, `tipo`, `categoriaId`, `unidadCompraId`, `unidadStockId`, `factorConversion`, `insumoId`, `precioVenta`, `seProduce`, `esConsignacion`, `proveedorConsignacionId`, `precioConsignacion`, `observaciones`: ninguno se vuelve por sucursal.
2. Las recetas siguen centrales y versionadas — sin cambios en `RecetaVersion`/`RecetaIngrediente`/`RecetaPaso`.
3. El Kardex no cambia — `Operacion`/`MovimientoStock`/`ConteoFisico` ya son por sección → sucursal.
4. El historial no se filtra por disponibilidad de hoy — Compras, Período, Conteos y Trazabilidad muestran lo que pasó, no lo que está disponible.
5. Sin Acción de permiso nueva — sigue `editar_producto`/`alta_producto`; `conPermiso` ya evalúa contra `ctx.sucursalId`. Sin migración de permisos ni cambio en `ACCIONES`/`prisma/seed.ts`/menú.
6. Sin pantalla nueva — `RUTAS_SIN_PARAMETROS` y `GRUPOS_NAV` no cambian.
7. Los otros `activo`/`activa` del sistema no se tocan: `Sucursal.activo`, `Seccion.activa`, `Unidad.activa`, `Insumo.activo`, `Grupo.activo`, `CategoriaProducto.activo`, `Proveedor.activo`, `Rol.activo`, `UsuarioSucursal.activo`, `Presentacion.activa`, `PrecioLocalProducto.habilitado`, `PromocionProducto.activa`.
8. `PrecioLocalProducto`, `StockMinimoProducto`, `FrecuenciaConteoProducto`, `PromocionProducto`: sin cambios — una fila para un producto no disponible ahí simplemente no se usa, no se borra.

---

## 8. Pasos de implementación (chicos, reversibles, un commit cada uno)

- **P0 — Línea de base (no es commit).** Correr y anotar los 6 comandos de §9. Línea de base conocida al diseñar este plan: **1265 tests / 124 archivos** (Vitest), **224 specs / 36 archivos** (Playwright) — confirmar corriendo, no asumir.

- **P1 — Lógica pura + demostración de mutación.** `src/core/catalogo/disponibilidad-producto.ts` (solo funciones puras, §3, sin `import` de Prisma) + `test/catalogo/disponibilidad-producto.test.ts`, con la demostración rojo→revertir→verde de §3.1 en el commit. No toca nada más.

- **P2 — 🔒 MIGRACIÓN (REQUIERE AUTORIZACIÓN EXPRESA) — commit separado.** `schema.prisma` (modelo + 2 relaciones inversas) + migración (CREATE TABLE + índice único + 2 FKs + backfill, §2.3) + agregar `prisma.disponibilidadProducto.deleteMany()` a `limpiarBaseDeTest` (`test/setup/test-db.ts`, antes de `producto.deleteMany()`/`sucursal.deleteMany()`). Nada la lee todavía; `Producto.activo` intacto. Aplicar SOLO en base local/descartable. Test de migración (estilo `test/permisos/migracion-permiso-anular-compra.test.ts`): tras el backfill hay `|Producto| × |Sucursal|` filas y `disponible` coincide con el `activo` de origen.

- **P3 — Capa de consulta.** `whereDisponibleEn`, `whereDisponibleEnAlguna`, `productoDisponibleEn`, `disponibilidadDeProductos`, `disponibilidadPorSucursalDeProducto` + tests contra Postgres real (2 sucursales sembradas). Nadie la usa todavía.

- **P4 — Escritura + dependencias por sucursal.** `actualizarDisponibilidadProducto`, `dependenciasParaDesactivar(productoId, sucursalId)`, `sincronizarActivoGlobal` (espejo transitorio), auditoría. Adaptar tests existentes + los 5 nuevos de §6.2. Actualizar los 2 llamadores no-test (`catalogo/productos/page.tsx`, `.../[id]/page.tsx`) y `scripts/seed-demo-pizzeria.ts:275`.

- **P5 — Alta con el tilde.** `DatosProducto.activoEnTodasLasSucursales`, `darDeAltaProducto`, `darDeAltaProductoRapido`, `producto-form.tsx` + `nuevo/page.tsx`, nota en `quick-crear-producto.tsx`. Tests: tildado ⇒ N filas; sin tildar ⇒ 1 fila; el producto no aparece en el selector de otra sucursal.

- **P5b — (a confirmar antes de este paso, ver §10) Tilde equivalente en alta de sucursal.**

- **P6 — El selector.** Renombre `soloActivos` → `soloDisponibles` + `soloDisponiblesEnAlguna`; `buscarProductosSelector` con `obtenerContextoUsuario`. `npx tsc --noEmit` enumera los 12 call-sites de §5.2 — corregirlos todos en este commit. Tests: producto disponible solo en A no aparece en el selector de B.

- **P7 — Stock y valuación.** `consolidado.ts`, `valuacion.ts`, `listarStockParaConteo`, `resolverConsumoPorFamilia` (hermanos por sucursal), `construirPools(sucursalId, db)`.

- **P8 — Reportes de catálogo por sucursal.** `huecos-catalogo.ts`, `insumos-sin-receta.ts`, `periodo.ts:1123`, `consignacion.ts:108`, `comun.ts` (`ProductoInfo.activo` → `disponible`), `historial-producto.ts`. Ojo con `reportes-compras-anuladas.test.ts`: cualquier línea nueva con `"COMPRA"`/`"VENTA"` literal necesita la referencia a `anulad…` en la ventana −3/+8.

- **P9 — Movimientos, venta, traspasos, recetas.** `movimientos.ts:116`, `venta.ts:71,82`, traspasos origen+destino (§5.5), `validarIngredientes` global + aviso no bloqueante en el editor.

- **P10 — UI de catálogo.** `/catalogo/productos` (columnas + toggle + aviso) y la ficha (sección "Disponibilidad por sucursal"). `listarProductosPagina` devuelve `disponibleAca` + `sucursalesDisponibles`/`totalSucursales` en batch.

- **P11 — Validaciones centrales.** `validarComun`, `darDeAltaProductoRapido`, `validarUnidadInsumo`, `validarUnidadesParaFusion`, `unidades.ts:92`, `recetas/page.tsx:23`, `recetas/[productoId]/page.tsx:64`, `proveedor-por-producto.ts:31`, `promociones.ts:53`. Al cerrar: ya no queda ningún lector de `Producto.activo` (verificar con `rg "\bactivo\b" src/ | rg -i producto`).

- **P12 — Guardián de arquitectura.** `test/arquitectura/disponibilidad-en-un-solo-lugar.test.ts`: ningún archivo fuera de `disponibilidad-producto.ts` escribe `disponibilidades:` a mano. Con demostración de mutación (rojo/verde).

- **P13 — 🔒 MIGRACIÓN 2 (REQUIERE AUTORIZACIÓN EXPRESA) — commit separado.** `ALTER TABLE "Producto" DROP COLUMN "activo";` + sacar el campo del schema + borrar `sincronizarActivoGlobal`. Destructiva e irreversible; se puede diferir indefinidamente sin incoherencia. Recomendado hacerla: decisión 1 dice "no dos capas".

- **P14 — E2E.** Adaptar `test/e2e/catalogo-productos-desactivar.spec.ts` (textos "Sí/No"/"· Activo/· Inactivo" cambian). Spec nuevo `catalogo-disponibilidad-por-sucursal.spec.ts`: alta sin tilde en sucursal A ⇒ no aparece en selector de B; con tilde ⇒ aparece en las dos; desactivar en A no cambia B. Sumar a `accesibilidad.spec.ts` un escaneo de la ficha de producto con ≥2 sucursales (tabla nueva, misma forma que ya produjo violaciones de `empty-table-header`/contraste en este proyecto).

- **P15 — VERIFICACIÓN FINAL END-TO-END** (§9).

---

## 9. Paso final obligatorio: verificación end-to-end sobre la suite TOTAL

**Todos los comandos, en la MISMA corrida final, después del último commit de código:**

```
npx tsc --noEmit
npm run lint
npm test                                        # Vitest contra Postgres real
npx playwright test test/e2e/accesibilidad.spec.ts
DATABASE_URL=<postgres local/descartable> npm run build
npm run test:e2e                                # Playwright completo
```

**Criterio de cierre conjunto** (los seis, en la misma corrida):
1. `npx tsc --noEmit`: 0 errores.
2. `npm run lint`: 0 errores, 0 warnings nuevos respecto de P0.
3. `npm test`: 0 fallas, total ≥ línea de base de P0 (deberían sumarse ~25-40 tests nuevos).
4. `npx playwright test test/e2e/accesibilidad.spec.ts`: 0 violaciones, incluido el escaneo nuevo de la ficha (P14).
5. `npm run build`: exitoso. `DATABASE_URL` a base local/descartable, JAMÁS Neon — aplica las migraciones de P2/P13. La aplicación sobre Neon es un acto aparte, posterior, con autorización expresa propia.
6. `npm run test:e2e`: 0 fallas, total ≥ línea de base de P0 (sube con P14).

Si cualquiera de los seis falla, el pendiente **no está cerrado**, aunque los otros cinco estén verdes.

---

## 10. La única consecuencia abierta (no reabre ninguna de las 3 decisiones)

Las 3 decisiones cubren "qué pasa al dar de alta un producto". **No cubren qué pasa al dar de alta una SUCURSAL.** Con "fila ausente = no disponible", una sucursal nueva arranca con cero productos disponibles — alguien tendría que activar el catálogo entero a mano.

No es un defecto del diseño: es el precio explícito de materializar filas en vez de usar el modelo opt-in de ERPNext (`restrict_to_companies == 0` ⇒ visible también en Companies futuras). El dueño ya eligió materializar ("todas las sucursales existentes **en ese momento**").

**Mitigación propuesta, derivada de la decisión 2 y con su misma lógica**: el alta de sucursal lleva el mismo tilde, con el mismo default:

```
[x] Empezar con todos los productos del catálogo disponibles en esta sucursal
```

Tildado ⇒ `createMany` de una fila `disponible: true` por cada producto disponible en alguna sucursal. Sin tildar ⇒ arranca vacía.

**Es un default de un formulario, no un rediseño**: si se prefiere lo contrario, se cambia un `useState(true)` por `useState(false)`. Queda señalado para confirmar antes de P5, no decidido en este plan. Si se confirma, entra como **P5b**.

---

## Archivos críticos para la implementación
- `prisma/schema.prisma`
- `src/server/actions/catalogo/productos.ts`
- `src/core/catalogo/desactivar-producto.ts`
- `src/core/movimientos/ui-config.ts`
- `src/app/(app)/catalogo/productos/producto-form.tsx`
