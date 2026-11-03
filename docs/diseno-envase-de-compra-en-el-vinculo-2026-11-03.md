# Diseño: el envase de compra vive en el vínculo proveedor × materia prima (opción C) — 2026-11-03

Documento SOLO de diseño, en papel. No hay código ni migraciones en esta rama. Verificado contra `origin/main` (`bc9d1282`), la rama `origin/alegp/compras-etapa-1` (solo lectura) y la copia local de `motor2-docs` (último commit `2af58d6`, 2026-10-09).

## 0. Resumen para el dueño

- **Qué cambia para quien carga datos.** Hoy, para comprar nalga en cajas de distintos tamaños, alguien con permiso de campos sensibles carga 1 materia prima + 1 envase por defecto + N «presentaciones» en el catálogo, y si dos proveedores venden «caja» con distinto contenido hay que inventar unidades («caja x6», «caja x12»). Con C se carga **1 materia prima** (solo su unidad de stock); el envase de cada proveedor se pregunta **una vez**, en su primera compra («¿cuántos kg / botellas trae esta caja?») y queda guardado en el vínculo con ese proveedor.
- **Ejemplo nalga:** hoy 1 MP + 4 presentaciones (5 cargas en el catálogo antes de comprar) → con C, 1 MP y una pregunta de un número la primera vez que se compra cada envase a cada proveedor.
- **Qué NO cambia:** recetas, producción, stock, costo, venta, conteo, lotes, insumos. El stock y el costo de cada compra ya se guardan en unidad de stock: cambiar un envase nunca reescribe compras viejas.
- **Riesgos:** (1) quien compra pasa a **definir** cuántas unidades trae un envase, y hoy eso es un permiso de administrador; (2) dos personas haciendo la primera compra del mismo envase a la vez (se resuelve con la regla «gana la primera, la otra se avisa»); (3) es **una columna nueva** en una tabla (requiere tu autorización de migración); (4) choca en archivos con la etapa 1 de Compras: se hace después de que esa entre.
- **Alternativa más barata (B, sin migración):** que la pantalla de compra cree la «presentación» de siempre la primera vez. Baja la carga igual, pero el contenido de la «caja» sería el mismo para todos los proveedores.
- **Faltan 3 decisiones tuyas** (§11): quién define y quién cambia el contenido de un envase; qué hacer si un mismo proveedor vende la misma unidad con dos contenidos; C o B.

## 1. Propósito y alcance

| # | Decisión | Estado |
|---|---|---|
| 1.1 | Necesidad: bajar la cantidad de datos que se cargan a mano antes de poder comprar (hoy 1 MP + N presentaciones) y que cada proveedor tenga su propio envase del mismo producto sin inventar unidades. Pedido del dueño, 2026-11-03 («Sí, diseñá la opción C en papel», por el orquestador; antecedente escrito: `docs/pendientes-sesion-2026-10-27.md` l. 58, «sin ver 40 presentaciones»). | CONFIRMADA 2026-11-03 |
| 1.2 | Alcance: SOLO dónde vive «unidad de compra + factor» y cómo lo usa la compra (y la devolución a proveedor). No toca recetas, producción, stock, costo, venta, conteo, lotes. | CONFIRMADA 2026-11-03 |
| 1.3 | No se agregan pantallas nuevas; se cambia el selector «Presentación» de la compra y, en una etapa posterior, se oculta la gestión de presentaciones del producto. | PROPUESTA |
| 1.4 | No se diseña: código del proveedor (`codigoDelProveedor`, etapa 2 de Compras), letras, reportes «N cajas = X kg = $Y» (columnas 2a de Compras, ya propuestas allí). | CONFIRMADA (fuera de alcance) |

## 2. Actores y contexto

- **Operario de compras** (`proceso_compra`, semilla admin + operador; `src/core/permisos/acciones.ts:107`): carga la factura. Es quien, con C, conoce el envase en el momento.
- **Administrador** (`producto_campos_sensibles`, semilla SOLO admin; `acciones.ts:235`): hoy es el único que define un factor (de producto o de presentación: `agregar-presentacion-alternativa.ts`, M.2).
- **Devolución a proveedor** (`proceso_devolucion_proveedor`, semilla admin + operador; `acciones.ts:117`): también convierte con factor (`aplicaFactorConversion: true`, `src/core/movimientos/transiciones.ts:87`).
- Contexto de datos (producción, CONFIRMADO 2026-11-03): 0 MP, 0 insumos, 0 recetas, 0 presentaciones, 0 vínculos, 47 productos de venta. No hay nada que migrar, pero se diseña como si lo hubiera.

## 3. Casos de uso

| CU | Qué | Hoy | Con C |
|---|---|---|---|
| CU1 | Primera compra de un envase a un proveedor | Si la unidad no es la por defecto del producto ni una presentación activa, no se puede: hay que ir al catálogo a crear la presentación (permiso sensible) | La pantalla ofrece «Otro envase…»: unidad + «¿cuántas [unidad de stock] trae?»; se guarda en el vínculo junto con «cómo lo llama el proveedor» |
| CU2 | Compra con un envase ya conocido de ese proveedor | Elige «Presentación» o «Unidad de compra por defecto» | Elige el envase del proveedor (lista del vínculo, la última usada primero); no pregunta nada |
| CU3 | Cambiar el contenido de un envase guardado (el proveedor pasó la caja de 12 a 10) | Prohibido si la presentación ya se usó (M-4, `FACTOR_CON_USO`): se desactiva y se crea otra con otra unidad | Permitido con permiso (Q1), auditado antes/después; las compras ya cargadas no cambian (§6.3) |
| CU4 | Desactivar un envase | `Presentacion.activa` | No se ofrece en la etapa 1 (§4.3) |
| CU5 | Devolución a proveedor | Factor de presentación o producto | Factor del vínculo de ese proveedor si existe; si no, el de siempre. Nunca define envases |
| CU6 | Compra sin proveedor | Hoy permitida en `main` («Sin proveedor») | La etapa 1 de Compras la prohíbe (`PROVEEDOR_OBLIGATORIO`); mientras exista, usa la caída (producto/presentación) |

## 4. Conceptos y ciclo de vida

**4.1 Envase** = (proveedor, materia prima, unidad de compra, factor). Factor = cuántas unidades de stock trae 1 unidad de compra (mismo significado que `Producto.factorConversion` y `Presentacion.factorConversion`, `prisma/schema.prisma:373` y `:623`). PROPUESTA.

**4.2 De dónde sale el factor, en orden (PROPUESTA):** (1) el vínculo `(producto, proveedor, unidad)` si tiene factor; (2) la presentación activa `(producto, unidad)`; (3) el producto, si la unidad es su unidad de compra por defecto; (4) factor 1 si la unidad es la de stock. Si ninguna aplica → es un envase nuevo (CU1). El orden (2)-(3) es EXACTAMENTE el de hoy (`armar-linea-de-movimiento.ts:104-161`); C solo agrega (1) delante.

**4.3 Ciclo de vida del envase:** nace en la primera compra (o se «completa» si el vínculo ya existía sin factor, §6.2) → se usa → puede cambiar su factor (CU3, auditado) → no se borra. Desactivar: NO en la etapa 1 (poda: no hay necesidad escrita; si la lista crece, una columna `activo` aditiva es una etapa posterior con nombre, «E1-bis»). PROPUESTA.

**4.4 Nombre en pantalla:** «Envase» (no «Presentación», que en la carta significa otra cosa: `presentacion-en-carta`). PROPUESTA.

## 5. Invariantes y políticas

| # | Invariante / política | Estado |
|---|---|---|
| I1 | Una MP por cosa que se cuenta; el vínculo con cada proveedor se crea solo al comprar; el insumo agrupa MP intercambiables con la misma unidad de stock (`validarUnidadInsumo`, `src/server/lecturas/catalogo/unidad-de-insumo.ts:15`). | CONFIRMADA 2026-11-03 |
| I2 | La receta, la venta y el costo hablan en unidad de stock; la unidad de compra es solo la puerta de entrada. | CONFIRMADA 2026-11-03 |
| I3 | Factor > 0, Decimal(14,4), validado con los decimales de la unidad de STOCK (mismo criterio que hoy: `validarCantidad(..., producto.unidadStock)`, `agregar-presentacion-alternativa.ts:49`). | PROPUESTA (reusa lo existente) |
| I4 | Si la unidad de compra es la de stock, el factor es 1 y no se pregunta; otro valor se rechaza. | PROPUESTA |
| I5 | Una compra ya cargada nunca cambia por un cambio de factor: el Kardex guarda cantidad y precio en unidad de stock, y con la migración 2a de Compras también la unidad y la cantidad compradas (snapshot). | CONFIRMADA (2a) / VERIFICADO el Kardex |
| I6 | El primer factor que se guarda para un envase gana; una segunda «primera compra» con otro factor se rechaza con aviso (no pisa en silencio). | PROPUESTA |
| I7 | Cambiar el factor de un envase existente exige declarar el valor anterior que se vio (valor esperado) y el permiso de Q1; deja fila de auditoría antes/después. | PROPUESTA (permiso PENDIENTE Q1) |
| I8 | La devolución a proveedor nunca crea ni cambia un envase. | PROPUESTA |
| I9 | Peso real: solo se acepta si el tipo (`Unidad.magnitud`) de la unidad de compra —con C, la del envase— difiere del de la unidad de stock; viene completado con cantidad × factor; si son del mismo tipo el servidor lo rechaza. | PENDIENTE (OK final del dueño). OJO: §14.2 de Compras propone otra variante («solo si la unidad de stock es de peso»): hay que elegir una |
| I10 | Lote/vencimiento opcional; stock inicial por ajuste o conteo sin costo. No cambian. | CONFIRMADA 2026-11-03 |

**Escalera de producto (N0–N5).** N0: MP con solo unidad de stock (se compra en esa unidad, factor 1). N1: la primera compra a un proveedor deja su envase. N2: varios envases por proveedor. Lo cargado en N0 no se rompe al subir. Lo que falta («envase sin contenido» en vínculos viejos) se muestra «pendiente de completar en la próxima compra», como ya se hace con la referencia del proveedor (`proveedores/[id]/page.tsx:136`).

### 5.1 «¿Qué pasa si…?» por comando

**Comando A — primera compra con envase nuevo (CU1).**

| Si… | Qué pasa (PROPUESTA) |
|---|---|
| Repetición (doble toque) | I3 de la compra (clave de idempotencia): el segundo envío devuelve el resultado guardado; el vínculo no se vuelve a escribir. |
| Concurrencia (dos operadores, misma MP, mismo proveedor, misma unidad) | La restricción única `(productoId, proveedorId, unidadCompraId)` deja una sola fila. La transacción es SERIALIZABLE (`registrar-movimiento.ts:133`): la segunda choca y se reintenta (`conTransaccionSerializable`); en el reintento ve el factor ya guardado. Mismo factor → sigue. Distinto → se rechaza esa compra: «Mientras cargabas, se guardó esta caja con 12 botellas; revisá». Nunca se pisa. |
| Tiempo (compra con fecha atrasada) | El factor no depende de la fecha; `ultimaCompra` sigue con `GREATEST` (`upsert-proveedor-por-producto.ts:68`). |
| Incertidumbre (no sabe cuánto trae) | El factor es obligatorio para un envase nuevo distinto de la unidad de stock. Si la unidad es de otro tipo (caja → kg), se puede usar el peso real (I9) y el factor queda como aproximado. |
| Reintento tras error | Todo en la misma transacción: nada a medias; se reintenta con la misma clave. |
| Error parcial (falla la auditoría o el vínculo) | Falla la compra entera (decisión del dueño 2026-10-06, `registrar-vinculo-de-compra-en-tx.ts`). |
| Datos faltantes | Sin proveedor: no hay vínculo; se usa la caída (§4.2) y no se puede definir un envase nuevo. Sin factor con unidad ≠ stock: rechazo con mensaje. |
| Cambio de permisos en el medio | El permiso se resuelve en el servidor al registrar (dentro del caso de uso), no en la pantalla. |

**Comando B — compra con envase conocido (CU2).** Repetición: I3. Concurrencia: dos compras que leen el mismo factor no escriben factor (solo precio/fecha/referencia, como hoy). Tiempo: el factor vigente al registrar. Factor cambiado entre que abrió la pantalla y guardó: la línea manda el factor que vio (valor esperado); si difiere del guardado → rechazo «el contenido de este envase cambió a X». Datos faltantes: vínculo sin factor → caída y se completa (§6.2). Permisos: no exige nada nuevo.

**Comando C — cambiar el factor de un envase guardado (CU3).**

| Si… | Qué pasa (PROPUESTA) |
|---|---|
| Repetición | Mismo valor nuevo ya guardado → no escribe ni audita (como `agregar-presentacion-alternativa.ts`, «sin fila de auditoría nueva: no cambió»). |
| Concurrencia | Valor esperado: si el guardado ya no es el que vio, rechazo. Dos cambios simultáneos: gana uno, el otro se rechaza. |
| Compras ya cargadas | No cambian (I5). Las futuras usan el nuevo. |
| Permisos | Q1. Sin permiso: rechazo `SIN_PERMISO_CAMPOS_SENSIBLES` (código existente) antes de escribir. |
| Auditoría | `registrarCambioAuditado` con entidad `ProveedorPorProducto`, campo `factorConversion`, antes/después, actor, sucursal (mismo patrón que `precioPorUnidadStock` hoy). |
| Error parcial | Misma transacción que la compra: todo o nada. |

**Comando D — desactivar un envase:** no existe en la etapa 1 (§4.3).

**Comando E — devolución a proveedor (CU5).** Repetición: I3. Concurrencia: solo lee. Con proveedor y envase guardado → ese factor. Sin vínculo o sin proveedor → caída. Un factor declarado en la línea se rechaza (I8). Datos faltantes: igual que hoy.

## 6. Historia y persistencia (PROPUESTA — se diseña porque 1 a 5 están confirmados en lo que toca a datos; lo que queda PENDIENTE —Q1, Q2— no cambia columnas)

### 6.1 Inventario: lo que existe y qué cambiaría con C (`git grep` sobre `origin/main`, sin contar la «presentación» de la carta)

| Archivo (`src/`) | Qué hace hoy | Con C |
|---|---|---|
| `server/persistencia/movimientos/cargar-linea-de-movimiento.ts` | `cargarPresentacionActiva` (lee `Presentacion` activa por producto + unidad) | Suma una lectura del vínculo (producto, proveedor, unidad); la de presentación queda como caída |
| `server/actions/movimientos/casos-de-uso/armar-linea-de-movimiento.ts` | Elige factor: presentación → producto → 1; convierte con `Number` y redondea | Recibe `proveedorId`; antepone el vínculo; acepta el factor declarado del envase nuevo |
| `server/actions/movimientos/casos-de-uso/registrar-movimiento.ts` | Escribe el vínculo por línea (solo COMPRA con proveedor) | Pasa el factor usado y el esperado |
| `server/actions/movimientos/casos-de-uso/registrar-factura-proveedor.ts` | Igual, por renglón | Igual |
| `server/actions/catalogo/casos-de-uso/registrar-vinculo-de-compra-en-tx.ts` | Upsert + auditoría del precio | + auditoría del factor cuando nace o cambia |
| `server/persistencia/catalogo/upsert-proveedor-por-producto.ts` | `INSERT … ON CONFLICT` (único escritor de la tabla, `cerco-dueno-unico-por-modelo.test.ts:141`) | + columna factor: `COALESCE` (no pisa) salvo cambio autorizado |
| `server/lecturas/catalogo/ofertas-de-proveedor.ts` | Unidad y referencia del vínculo para ficha, comparativa y precarga | La precarga trae el envase (hoy pone `unidadCompraId: ""` a propósito, l. 162) |
| `server/lecturas/catalogo/historia-de-producto.ts` | `productoTieneHistoria` (incluye presentaciones y vínculos); `presentacionTieneUso` (vínculo con esa unidad) | Sin cambio en E1; en E3 sale la cláusula de presentaciones y `presentacionTieneUso` |
| `server/actions/catalogo/productos.ts` | `listarPresentaciones`, `agregarPresentacionAlternativa`, `actualizarActivaPresentacion` | E2: dejan de ofrecerse; E3: se retiran |
| `server/actions/catalogo/casos-de-uso/agregar-presentacion-alternativa.ts`, `actualizar-activa-presentacion.ts` | Alta/activar presentación (M-4, M.2) | E3: se retiran |
| `server/persistencia/catalogo/productos.ts` | `guardarPresentacion`, `fijarActivaDePresentacion` | E3: se retiran |
| `components/catalogo/gestion-presentaciones.tsx`, `campos-sensibles-solo-lectura.tsx` | Pantalla de presentaciones y su aviso | E2: se ocultan; E3: se borran |
| `app/(app)/catalogo/productos/producto-form.tsx`, `datos-de-edicion.ts`, `[id]/page.tsx` | Muestran presentaciones; editan unidad de compra y factor por defecto | E2: sin presentaciones; el default de producto queda (caída) |
| `app/(app)/movimientos/[proceso]/panel-movimiento-form.tsx` | Selector «Presentación» (solo si hay presentaciones activas) | Selector «Envase» del proveedor + «Otro envase…» con la pregunta |
| `core/features/movimientos/movimiento.schema.ts` | `unidadCompraId`, `referenciaProveedor` por ítem | + factor declarado y factor esperado |
| `core/features/catalogo/productos.schema.ts`, `productos.guard.ts` | Comandos y guard de presentaciones; `CampoSensibleDelProducto` | E3: salen los de presentación |
| `core/permisos/acciones.ts` | `producto_presentaciones`; `producto_campos_sensibles` («…y definir el factor de sus presentaciones») | E3: se retira `producto_presentaciones` (migración de datos de permisos); se reescribe la descripción |
| `core/permisos/auditoria.ts` | Entidades auditadas `Presentacion` y `ProveedorPorProducto` | Igual en E1; E3 retira `Presentacion` |
| `server/acceso/campos-sensibles-de-producto.ts` | Única fuente de la clave fina | Se reutiliza tal cual en la compra (Q1) |
| `core/catalogo/busqueda-de-producto.ts`, `server/lecturas/catalogo/filtros-de-productos.ts`, `server/consultas/reportes/huecos-catalogo.ts`, `server/actions/catalogo/casos-de-uso/actualizar-producto.ts` | Leen el vínculo (referencia) o lo nombran | Sin cambio |

Conteos reales: `Presentacion` y sus funciones aparecen en **19 archivos de `src/`** (más `prisma/schema.prisma`); `ProveedorPorProducto` en **13**; `factorConversion`/`unidadCompra` en **31**; `cargarPresentacionActiva` se usa en **1** (más su definición). Tests: **33 archivos** nombran presentaciones o sus funciones (2 de carta excluidos) y **24** el vínculo; los que habría que tocar en E1 son ~8 (§10.1); en E3, los ~15 de presentaciones (`presentaciones.test.ts`, `campos-sensibles-de-presentaciones.test.ts`, `activar-id-inexistente.test.ts`, matriz de permisos, huella de gobierno, golden de módulos, e2e `catalogo-campos-sensibles.spec.ts`, …).

### 6.2 Etapas

| Etapa | Qué | Schema | Reversible |
|---|---|---|---|
| **E1 — aditiva** | `ProveedorPorProducto.factorConversion DECIMAL(14,4) NULL` + `CHECK ("factorConversion" IS NULL OR "factorConversion" > 0)`. La compra lee primero del vínculo y cae a presentación/producto si el vínculo no tiene factor; un vínculo sin factor se completa con el factor que efectivamente se usó (auditado: nace). | **REQUIERE AUTORIZACIÓN EXPRESA** (por base, con respaldo y ensayo en rama de Neon) | Sí: `down.sql` (abajo) |
| **E2 — dejar de escribir presentaciones** | Interruptor: se ocultan la gestión de presentaciones del producto y sus acciones de alta; la lectura de caída sigue. | Ninguno | Sí: se vuelve a mostrar |
| **E3 — retiro (DESTRUCTIVA)** | Copiar el factor de cada presentación a los vínculos con su misma (producto, unidad) que no tengan factor; listar las presentaciones sin vínculo para decisión; borrar tabla `Presentacion`, permiso `producto_presentaciones` y su código. Aparte, y solo si se decide: los campos default de `Producto` (hoy son la caída de la devolución sin proveedor y de la compra sin vínculo: **recomiendo NO retirarlos**). | **REQUIERE AUTORIZACIÓN EXPRESA, DESTRUCTIVA**, nunca en el primer paso | Solo con respaldo |

`down.sql` de E1 (mismo patrón que la 2a de Compras: aborta si hay datos):

```sql
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM "ProveedorPorProducto" WHERE "factorConversion" IS NOT NULL) THEN
    RAISE EXCEPTION 'Hay envases con contenido cargado: revertir perdería datos';
  END IF;
END $$;
ALTER TABLE "ProveedorPorProducto" DROP CONSTRAINT "ProveedorPorProducto_factor_chk", DROP COLUMN "factorConversion";
```

Sin índices nuevos (la búsqueda es por la clave única existente). RLS: ninguna política nueva (columna en tabla que ya la tiene, `20260929120000_multiempresa_rls/migration.sql:77-78`). La FK compuesta de la unidad ya existe.

**¿Junto con la migración de la etapa 2 de Compras (`codigoDelProveedor` en la misma tabla) o aparte?** A favor de juntarlas: misma tabla, un solo ensayo y una sola autorización. En contra: la etapa 2 espera letras/puntos de venta y C espera tu Q3; atarlas demora a la que esté lista primero. La 2a (unidad y cantidad compradas en la línea) va primera y sola en cualquier caso, como ya propuso Compras. **Lo decidís vos al autorizar**; mi preferencia técnica es aparte y chica.

### 6.3 Historia

El cambio de factor no reescribe nada: `MovimientoStock.cantidad` y `precioPorUnidadStock` ya están en unidad de stock y, con la 2a, la línea guarda unidad y cantidad compradas. La historia del factor del envase queda en `RegistroAuditoria` (quién, cuándo, antes, después). No se borra el vínculo.

## 7. Atomicidad y concurrencia

- **Atomicidad:** la compra, el vínculo, su factor y las dos auditorías (precio y factor) van en la misma transacción SERIALIZABLE que ya existe (`registrar-movimiento.ts`, `registrar-factura-proveedor.ts`). Todo o nada.
- **Concurrencia:** restricción única existente + `INSERT … ON CONFLICT` + `COALESCE(actual, nuevo)` para el factor + comparación con el valor esperado (patrón «esperado» que ya usa el repo en la corrección de compras y en recetas). Gana la primera transacción que confirma; la otra se reintenta y, si su factor difiere, se rechaza con aviso. NO VERIFICADO: si el choque llega como fallo de serialización (P2034/40001) o se resuelve sin error por el `ON CONFLICT`; en ambos casos el resultado debe ser el mismo y lo prueba el test de §10.1.

## 8. Acceso e interfaces

- Registrar compra/devolución: sin permisos nuevos (`proceso_compra`, `proceso_devolucion_proveedor`).
- Definir el factor de un envase nuevo y cambiar el de uno guardado: **PENDIENTE Q1**. Si se usa la clave fina, se calcula con `puedeEditarCamposSensiblesDelProducto` (única fuente; `pares-de-piso-equivalentes.test.ts` exige que nadie más consulte la clave).
- Aislamiento: todo pasa por `actor.db`/`tx` con `app_empresa_actual()`; el `INSERT` crudo toma `empresaId` del default (como hoy).
- Lectura nueva «envases de este proveedor para este producto» para la pantalla: con el permiso de la pantalla de compra; se declara en `consumidores-de-lecturas-declarados` y en la matriz de acceso si es una acción nueva. PROPUESTA: reutilizar la precarga por proveedor (`ofertas-de-proveedor.ts`) en vez de una acción nueva.

## 9. Consultas y experiencia

**Pantalla de compra (hoy, `panel-movimiento-form.tsx:110-165`, `:489-500`):** al elegir el producto pide `listarPresentaciones`; si hay activas muestra «Presentación» con «Unidad de compra por defecto» + cada presentación «(×factor)». La precarga por proveedor deja la unidad vacía (= default del producto).

**Con C:**

| Situación | Qué ve el operario |
|---|---|
| Vínculo con envases | «Envase»: los del proveedor, el último usado primero, cada uno «caja (12 botellas)»; precargado con el último. Al final «Otro envase…». |
| Sin vínculo (primera compra) | «Envase»: la unidad de stock (y la default del producto si tiene) + «Otro envase…» → elige unidad y responde «¿Cuántas [botellas/kg] trae 1 [caja]?». Junto a «Cómo lo llama el proveedor» (etapa 1 de Compras). |
| Envase guardado y el operario ve otro contenido | Con permiso: puede corregir el número (avisa «cambia para las próximas compras; las ya cargadas no cambian»). Sin permiso: aviso y no puede guardar esa línea hasta que alguien con permiso lo corrija (Q1). |
| Unidad de otro tipo (caja → kg) | Aparece «Peso real (kg)», completado con cantidad × contenido (I9, PENDIENTE). |
| Devolución | Lista los envases del proveedor elegido; sin «Otro envase…». |

Fechas: el orden por `ultimaCompra` y cualquier fecha mostrada en hora argentina (`ZONA_ARGENTINA`, como el resto de la pantalla). Ficha del proveedor: la columna «Unidad de compra» pasa a «Envase» con su contenido; sin contenido: «pendiente de completar en la próxima compra».

## 10. Pruebas, migración y operación

### 10.1 Pruebas (tests nuevos o tocados en E1)

| Test | Qué demuestra | Cómo se demuestra que detecta lo que dice |
|---|---|---|
| `test/movimientos/envase-del-vinculo.test.ts` (nuevo, integración) | Proveedor A caja×6 y B caja×12 del mismo producto entran 6·n y 12·n | Se fuerza la lectura a ignorar el vínculo (caída a producto) y debe dar rojo |
| `test/movimientos/envase-primera-compra-concurrencia.test.ts` (nuevo) | Dos primeras compras simultáneas, factores 6 y 12: queda UNA fila, con el factor de la que confirmó primero; la otra se rechaza con el aviso; el stock de la rechazada no entra | Cambiar `COALESCE` por pisar → rojo (queda 12 con stock calculado con 6) |
| idem, idempotencia | Repetir la compra con la misma clave no duplica stock, ni auditoría, ni cambia el factor | Saltear I3 en el test → rojo por fila de auditoría doble |
| `test/catalogo/registrar-vinculo-de-compra-en-tx.test.ts`, `test/auditoria/vinculo-proveedor-auditado.test.ts` | Nace y cambio de factor dejan fila antes/después; mismo valor no deja fila | Quitar la llamada de auditoría → rojo (además lo atrapa `escrituras-auditadas`: la columna es `Decimal`) |
| `test/movimientos/registrar-movimiento.test.ts`, `factura-proveedor-repartida.test.ts`, `vinculo-proveedor-concurrencia.test.ts`, `proveedor-por-producto.test.ts` | La caída (presentación/producto) sigue igual; compras sin vínculo no cambian | Goldens de caracterización sin cambios en stock ni importes |
| `test/movimientos/envase-combinaciones.test.ts` (nuevo, oráculo) | Recorre TODAS las combinaciones de §10.2 contra la tabla | Guardián: falla si `TRANSICIONES` suma un proceso con `aplicaFactorConversion` o `ProveedorPorProducto` una columna sin declararse en el oráculo; se prueba agregando una clave falsa en el test |
| `test/arquitectura/auditoria-por-columna.test.ts` | Suma `{ entidad: "ProveedorPorProducto", campos: ["precioPorUnidadStock", "factorConversion"] }` | Ya prueba por AST que el literal `campo` lo escribe de verdad |
| `test/aislamiento/denegacion/*` | El vínculo de otra empresa no se lee ni escribe | Ya existente; se amplía el mundo con el factor |
| e2e `movimientos-compra-wizard.spec.ts` (+1 caso) | Primera compra pregunta el contenido; la segunda no | — |

### 10.2 Oráculo de combinaciones (tabla de reglas esperadas, aparte del código)

Dimensiones que cambian stock/dinero/permisos: **P** proceso (COMPRA / DEVOLUCION_PROVEEDOR / otro); **Pv** proveedor (sí/no); **V** vínculo para (prod, prov, unidad) (no / sin factor / con factor F); **D** factor declarado (ausente / = F / ≠ F); **U** unidad de compra = unidad de stock (sí/no); **M** magnitud compra vs stock (igual/distinta); **S** permiso de Q1 (sí/no). 3·2·3·3·2·2·2 = 432 casos: exhaustivo.

| # | Condición | Factor usado | Escribe en el vínculo | Resultado |
|---|---|---|---|---|
| R1 | P = otro | — | nada | como hoy |
| R2 | U = sí | 1 | COMPRA+Pv: factor 1 | D ≠ 1 → rechazo |
| R3 | COMPRA, Pv, V = no, U = no | D | crea con D | D ausente → rechazo «¿cuánto trae?»; S = no y Q1 lo exige → rechazo |
| R4 | COMPRA, Pv, V = sin factor | D si viene; si no, caída | completa con el usado | D ≠ caída se trata como R3 |
| R5 | COMPRA, Pv, V = F, D ausente o = F | F | no toca el factor | ok |
| R6 | COMPRA, Pv, V = F, D ≠ F | S = sí: D; S = no: — | S = sí: actualiza + auditoría | S = no → rechazo; esperado ≠ F → rechazo (concurrencia) |
| R7 | COMPRA sin Pv | caída | nada | D presente → rechazo (y la etapa 1 de Compras rechaza la compra sin proveedor) |
| R8 | DEVOLUCION, Pv, V = F | F | nada | D presente → rechazo |
| R9 | DEVOLUCION, (sin Pv o V ≠ F) | caída | nada | D presente → rechazo |
| R10 | M = distinta | el de arriba | igual | peso real aceptado (reemplaza cantidad × factor) |
| R11 | M = igual | el de arriba | igual | peso real → rechazo (PENDIENTE I9) |

### 10.3 Checklist de reglas de datos

| Regla | Cómo |
|---|---|
| Concurrencia | Única existente + `ON CONFLICT` + `COALESCE` + valor esperado; gana la primera (§7) |
| Idempotencia | I3 de la compra y de la factura; cambio con el mismo valor no escribe |
| Atomicidad | Misma transacción SERIALIZABLE de la compra |
| Aislamiento por empresa | `empresaId` por default + RLS existente; test de denegación |
| Autorización en el servidor | Q1 resuelto con `puedeEditarCamposSensiblesDelProducto` en el caso de uso, nunca solo en la pantalla |
| Dinero/cantidad exacta | Decimal(14,4) en la base; validación con los decimales de la unidad de stock; `redondearACantidadDeUnidad` después de convertir. Ver hallazgo H1 |
| Fechas | `ultimaCompra` con `GREATEST`; pantallas en hora argentina |
| Trazabilidad | Auditoría por columna (nace y cambio); no se borra |
| Validación de entradas | Guard de la línea: factor > 0, decimales, ausente donde no corresponde (R2, R7–R9) |

### 10.4 Gate (en la MISMA corrida, todos limpios; criterio: código de salida 0 y cero hallazgos)

1. `npx tsc --noEmit` — 0 errores.
2. `npm run lint` — 0 errores y 0 advertencias nuevas.
3. `npm run arquitectura` — dependency-cruiser sin violaciones (el nuevo lector no rompe R2/R3; `registrar-vinculo-de-compra-en-tx` sigue en `COMANDOS_PUBLICOS`).
4. `npm run analizar:muerto` — knip con 0 hallazgos (en E3: sin exportaciones huérfanas de presentaciones).
5. `npm test` — verde completo, incluidos `escrituras-auditadas`, `auditoria-por-columna`, `cerco-dueno-unico-por-modelo`, `caracterizaciones-congeladas` (si se regenera un golden, con su entrada en `regeneraciones` y motivo) y el oráculo de §10.2.
6. `npm run build` — build de producción sin errores.
7. `npm run plataforma:build` — la consola construye.
8. `npm run test:e2e` — Playwright verde, incluido el caso nuevo de primera compra.

### 10.5 Convivencia con Compras (rama `alegp/compras-etapa-1`, NO se toca)

Archivos que comparte C con esa rama (riesgo de conflicto): `panel-movimiento-form.tsx`, `registrar-movimiento.ts`, `registrar-factura-proveedor.ts`, `movimiento.schema.ts`, `compra.guard.ts`, `movimiento.guard.ts`, `server/lecturas/catalogo/vinculos-de-proveedor.ts` (nuevo allí) y los tests `registrar-movimiento.test.ts`, `factura-proveedor-repartida.test.ts`, `vinculo-proveedor-concurrencia.test.ts`, `proveedor-por-producto.test.ts`, `presentaciones.test.ts`, `vinculo-proveedor-auditado.test.ts`. `armar-linea-de-movimiento.ts` NO lo toca la etapa 1, pero SÍ la 2a (para devolver unidad y cantidad compradas). **Orden recomendado:** etapa 1 → 2a → E1 de este diseño, cada una sobre `main` actualizado.

### 10.6 Operación

E1: respaldo + ensayo en rama de Neon + `down.sql` probado; despliegue de código compatible con la columna ausente NO hace falta (la migración va antes del código). Indicador de salud: vínculos con unidad ≠ stock y factor NULL (deben bajar a 0 con las compras).

## 11. Alternativas (primero la más barata) y recomendación

| Opción | Qué es | Migración | Costo aprox. (src / tests) | Resuelve «A caja 6, B caja 12» | Baja la carga |
|---|---|---|---|---|---|
| **A — dejar como está y documentar** | Una MP; default + presentaciones cargadas en el catálogo; unidades «caja x6/x12» cuando dos proveedores difieren | No | 0 / 0 | Solo inventando unidades | No |
| **B — presentación al vuelo** | La pantalla de compra crea la `Presentacion` (producto, unidad) la primera vez | No | ~6 / ~5 | No (el contenido es por producto, igual para todos) | Sí |
| **C-mínimo** | `Presentacion.proveedorId` + única (producto, proveedor, unidad) | Sí (cambia la única de `Presentacion`: borrar un índice) | ~10 / ~10 | Sí | Sí, pero deja dos tablas con la misma clave (vínculo y presentación) |
| **C** | `ProveedorPorProducto.factorConversion` | Sí, aditiva (1 columna + CHECK) | E1 ~11 / ~8; E3 retira ~10 archivos | Sí | Sí, y en E3 elimina una tabla |

**Recomendación:** C, en las etapas E1 → E2 y E3 solo con autorización. Es la única que deja cada dato en un solo lugar (el envase es del par proveedor × MP, como ya decidió Compras §4.bis para «cómo lo llama») y además permite achicar el sistema (poda). Si no querés migración ahora: B como paso intermedio, sabiendo que el contenido no distingue proveedores. C-mínimo no lo recomiendo (duplica la clave del vínculo).

**Caso límite (§5 del pedido):** la única actual del vínculo `(productoId, proveedorId, unidadCompraId)` alcanza para «5 envases del mismo proveedor» (5 unidades distintas) y para «dos proveedores, misma unidad, distinto factor» (filas distintas). NO alcanza para «el mismo proveedor vende caja de 6 y caja de 12 del mismo producto»: chocan en la misma fila. Recomiendo unidades distintas para ese caso (raro; se crean una vez por empresa y sirven para cualquier producto). Meter el factor en la clave única convierte cada cambio de contenido en un envase nuevo y complica el `ON CONFLICT`: no lo recomiendo.

### Preguntas al dueño (una por una, solo las que cambian datos, dinero o permisos)

1. **Permisos (Q1).** Hoy solo el administrador define cuántas unidades trae un envase. Con C lo sabe quien compra. Propongo: el operario de compras **define** el contenido de un envase nuevo (queda auditado) y **cambiar** uno ya guardado queda para quien tiene el permiso de campos sensibles. ¿Estás de acuerdo, o preferís que también definir sea solo del administrador (más control, pero la primera compra se traba hasta que él lo cargue)?
2. **Mismo proveedor, misma unidad, dos contenidos (Q2).** Si un proveedor vende «caja de 6» y «caja de 12» del mismo producto, ¿alcanza con usar dos unidades distintas («caja x6», «caja x12»), como recomiendo, o necesitás que el sistema las distinga dentro de la misma unidad (cambia la clave del vínculo)?
3. **Opción (Q3).** ¿Avanzo con C (una columna nueva en el vínculo, con tu autorización de migración) o empezamos por B (sin migración, pero la «caja» tiene el mismo contenido para todos los proveedores)?

## 12. Hallazgos que no coinciden con lo que estaba escrito o con lo que se suponía

- **H1 — la conversión no es Decimal.** `armar-linea-de-movimiento.ts:151-170` convierte con `Number(...)` y multiplica en coma flotante (`numCant * factor`) antes de `redondearACantidadDeUnidad`. La regla «nunca float» no se cumple hoy en ese paso. C no lo empeora; arreglarlo es otro pendiente (no está pedido).
- **H2 — la compra admite «Sin proveedor» en `main`** (`panel-movimiento-form.tsx:383-384`), y la devolución también. La etapa 1 de Compras lo prohíbe solo en COMPRA. La caída a producto/presentación es necesaria mientras haya devolución sin proveedor.
- **H3 — la devolución a proveedor no escribe el vínculo** (solo COMPRA: `registrar-movimiento.ts:246`). Con C, la devolución solo lee.
- **H4 — la precarga por proveedor ignora el envase del vínculo a propósito** (`ofertas-de-proveedor.ts:162`, pone la unidad por defecto del producto): hoy una compra precargada con un envase no default convierte con el default si el operario no cambia el selector. C lo corrige como parte de E1.
- **H5 — `presentacionTieneUso` mira el vínculo de CUALQUIER proveedor** con esa unidad (`historia-de-producto.ts:47-49`); con C esa pregunta pierde sentido (cada proveedor tiene su factor) y se retira en E3.
- **H6 — dos variantes de la regla del peso real**: la del pedido (tipos distintos entre unidad de compra y de stock) y la de Compras §14.2 (solo si la unidad de stock es de peso). Hay que elegir una (I9).
- **H7 — el precio del vínculo ya no lo lee ninguna pantalla** (`upsert-proveedor-por-producto.ts:26-28`: se deriva del Kardex); de la tabla solo se leen unidad y referencia. El factor sería el tercer dato «vivo» del vínculo.

## 13. Lo que no pude verificar o no entendí

- `motor2-docs`: revisé la copia local (`/home/user/motor2-docs`, último commit 2026-10-09). El remoto tiene empujes hasta 2026-10-13 que no pude traer: **NO VERIFICADO** que no haya un plan sobre envases/presentaciones en esos cuatro días. En lo local no hay plan aprobado sobre presentaciones ni sobre factor en el vínculo; solo la investigación del vínculo (`_planes/investigacion-vinculo-proveedor-producto-2026-10-06.md`: «no se derivan la unidad de compra y la referencia») y CAT-1 (`_decisiones-del-dueno-2026-10-08.md` fila 1: presentaciones o vínculo cuentan como «historia»).
- `docs/` del repo: no hay ADR ni plan sobre mover el factor al vínculo; el precedente es `grounding-historial-producto-mp-pv-2026-09-22.md` §4.1 (patrón «conversión por producto», Tandoor/ERPNext).
- Cómo llega el choque de dos primeras compras (error de serialización o resolución silenciosa del `ON CONFLICT`): se define con el test de §10.1.
- Si el número que se tipea en la primera compra con unidad de otro tipo (caja → kg) debe guardarse como «aproximado»: depende de I9.

## 14. Ideas que quedan afuera (nadie las pidió)

Columna `activo` en el vínculo (desactivar envases); edición del contenido desde la ficha del proveedor sin comprar; conversión en Decimal (H1); retirar los campos default de `Producto`; tabla de equivalencias entre unidades (g ↔ kg); sugerir el contenido a partir de otros proveedores.
