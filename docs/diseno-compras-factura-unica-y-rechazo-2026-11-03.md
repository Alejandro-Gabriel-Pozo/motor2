# Diseño: Compras de mercadería con factura única, letra y punto de venta del proveedor, buscador y rechazo de la parte (2026-11-03)

Estado: **BORRADOR para el dueño. Niveles 1 a 5 de la escalera de diseño; los niveles 6 a 10 están esbozados y NO se migra ninguna tabla hasta que el dueño confirme los niveles 1 a 5.** Cada decisión lleva su estado: CONFIRMADA (dicha por el dueño), PROPUESTA, PENDIENTE o NO VERIFICADA.

Fuentes: decisiones del dueño del 2026-11-03 (esta conversación); auditoría del circuito de compras del 2026-11-03 (hallazgos H2, H3, H4, H5, H6, H7; H1 resultó falso: las migraciones E2 y E3a-M ya están aplicadas en producción, verificado en Neon el 2026-11-03: 149 migraciones, 0 pendientes); `docs/diseno-circuito-de-abastecimiento-2026-10-27.md`; `docs/diseno-factura-de-proveedor-e3a-2026-10-27.md`; `docs/diseno-modulo-catalogo-2026-10-28.md` (CU10, M1 a M3); `motor2-docs/_planes/_decisiones-del-dueno-2026-10-06.md` (#8 letra, neto e IVA; #10 descuento por pronto pago). La maqueta navegable v3 se entregó al dueño por fuera del repositorio.

## 0. Resumen para el dueño

**Qué cambia.** La carga de una compra pasa a ser **solo de facturas de proveedor** (sin remito), con un número **obligatorio y único en toda la empresa**: letra + punto de venta + número, donde la letra y el punto de venta salen de la **ficha del proveedor** (si tiene uno solo se elige solo) y el número se escribe solo con dígitos y se completa con ceros a la izquierda. La compra se carga por pasos. La **primera vez** que se compra un insumo a un proveedor se guarda **cómo lo llama** en su factura. El buscador de productos pasa a buscar bien (palabra por palabra, sin tildes, primero lo que ese proveedor ya llamó así). **Precio 0** avisa y no bloquea. Si la factura se **reparte**, la otra sucursal puede **rechazar con motivo**; entonces la parte **vuelve a la sucursal que la envió**; y al **aceptar** puede **activar** un producto que tenía desactivado. **Todo con confirmación.**

**Lo más barato primero.** Casi todo se hace **sin migración** (etapa 1). Lo que necesita migración aditiva y autorización expresa son dos cosas: guardar las letras del proveedor (etapa 2) y el estado RECHAZADA con su motivo (etapa 3). Ninguna se aplica a una base real sin respaldo y ensayo.

**Confirmadas el 2026-11-03 (segunda ronda):** si el proveedor no tiene letra o punto de venta cargados, la primera factura ofrece guardarlos, con confirmación; activar un producto al aceptar alcanza con el permiso `producto_disponibilidad` (si quien acepta no lo tiene, solo puede rechazar); la sucursal que compró puede retirar una propuesta sin respuesta, con motivo (el plazo, después). **Confirmadas el 2026-11-03 (tercera ronda):** punto de venta de 5 dígitos y número de 8; **se carga el total pagado con IVA incluido** (pagué 100, se carga 100) y el IVA queda como dato del producto (ya existe `alicuotaIvaCompra`) para más adelante; sin descuento por línea por ahora; no hace falta marcar «se cobra por kilo» (se calculan el precio por unidad y por kilo con lo que se cargue); los reportes quedan pendientes. **Sigue abierta** solo la pregunta 10 (lote y vencimiento), que no se decide hasta que el dueño la pida.

## 1. Propósito y alcance

- **Propósito (CONFIRMADA).** Que cada factura de un proveedor entre una sola vez a la empresa, con su número bien escrito, y que cargarla sea corto y sin ambigüedades. Necesidad escrita: hallazgo H2 (duplicados entre la compra simple y la factura repartida) y pedido del dueño del 2026-11-03.
- **Dentro (CONFIRMADA).** Facturas de proveedor de mercadería con stock, cargadas desde la pantalla de Compra, de una o varias líneas, para una sucursal o repartidas entre varias.
- **Fuera por ahora (CONFIRMADA: «solo carga de facturas sin remito por ahora»).** Remitos y la recepción separada (`compra_recibir`); compras sin comprobante; pedidos, cotizaciones y órdenes de compra; gastos sin stock (E4, ver §13); bienes de uso; nota de crédito; cuenta corriente y pagos (E9); IVA desglosado (se mantiene el total con IVA incluido).
- **Supuesto declarado (PROPUESTA).** Si no hay remito ni compra sin comprobante, tampoco se cargan compras sin proveedor: el proveedor es obligatorio. Hoy el sistema admite compra sin proveedor y sin número.

## 2. Actores y contexto

| Actor | Qué hace | Permiso (existente) |
|---|---|---|
| Operario o administrador de la sucursal que compra | Carga la factura, la reparte, la anula o corrige | `proceso_compra` (sucursal), `compra_repartir` (empresa, semilla `admin`), `anular_compra` y `corregir_compra` (sucursal, administrador) |
| Operario de la sucursal destino | Acepta o rechaza su parte; activa un producto al aceptar | `proceso_compra` en la destino (aceptar); `producto_disponibilidad` (sucursal, operario) para activar |
| Administrador | Configura letras y puntos de venta en la ficha del proveedor; ve el reporte | `proveedores`, `reporte_compras` |

Contexto: Argentina (UTC-3); todo en pesos; cada empresa solo ve lo suyo y cada sucursal solo lo de sus políticas.

## 3. Casos de uso

| CU | Caso | Estado |
|---|---|---|
| CU1 | Cargar una factura para la propia sucursal, por pasos | CONFIRMADA |
| CU2 | Cargar una factura repartida entre sucursales | HOY (E3a) + cambios de §4 |
| CU3 | Aceptar mi parte, activando un producto desactivado si hace falta | CONFIRMADA (el permiso: PENDIENTE) |
| CU4 | Rechazar mi parte con motivo; vuelve a la sucursal que la envió | CONFIRMADA |
| CU5 | Configurar letras y puntos de venta en la ficha del proveedor | CONFIRMADA |
| CU6 | Buscar un producto escribiendo lo que dice la factura | CONFIRMADA (criterios: PROPUESTA) |
| CU7 | Primera carga de un insumo a un proveedor: guardar cómo lo llama | CONFIRMADA |
| CU8 | Anular o corregir una compra | Sin cambios en esta etapa |

## 4. Conceptos y ciclo de vida

- **Número de comprobante (CONFIRMADA).** Tres datos: **letra** (A, B, C, E, M, X), **punto de venta** y **número**. La letra y el punto de venta se eligen de lo configurado en el proveedor; si hay uno solo, se elige solo. El número admite solo dígitos 0 a 9; si faltan dígitos, se completan con ceros a la izquierda.
- **Clave única (CONFIRMADA el rechazo en toda la empresa; la forma: PROPUESTA).** `empresa + proveedor + letra + punto de venta + número entero`. Dos escrituras del mismo número (con o sin ceros) son la misma factura. Hoy la letra tecleada queda dentro del número y la columna `FacturaProveedor.letra` nunca se escribe: pasa a escribirse.
- **Propuesta de parte.** Estados: PENDIENTE → ACEPTADA, o PENDIENTE → **RECHAZADA** (nuevo, con motivo de 1 a 200 caracteres). Al rechazarse, la parte **vuelve a la sucursal que la envió** (CONFIRMADA): entra a su stock y a su gasto en la misma operación, y la suma de las partes sigue igual al total.
- **Activar al aceptar (CONFIRMADA la idea).** Un producto desactivado en la destino puede activarse en el momento de aceptar. Lo desactivado no impide recibir la propuesta.
- **Vínculo proveedor↔producto.** Ya existe (`ProveedorPorProducto`: unidad de compra, último precio, `referenciaProveedor` = cómo lo llama ese proveedor). En la primera compra de un insumo a un proveedor, `referenciaProveedor` pasa de opcional a **obligatoria** y se guarda al confirmar (CONFIRMADA).
- **Unidad (CONFIRMADA).** La unidad de la compra es la del producto; no se toma la de la última compra. La cantidad se convierte a la unidad de stock.

## 4.bis Dónde vive cada dato: insumo, materia prima y lo que dice el proveedor (PROPUESTA; pregunta del dueño del 2026-11-03)

**Inventario real (código en `main`, producción en Neon el 2026-11-03).**

- **Insumo** (`Insumo`): el concepto genérico que agrupa materias primas equivalentes («Bife angosto»); lo usan las recetas y el costo por insumo. Solo tiene nombre y grupo.
- **Materia prima** (`Producto` con `tipo = MP`): lo concreto que se compra, con **nuestro** código y **nuestro** nombre, unidad de stock, unidad de compra, factor de conversión y alícuota de IVA de compra. Puede apuntar a un insumo (`insumoId`, opcional; el asistente de hermanar los une).
- **Lo que dice el proveedor** (`ProveedorPorProducto`, una fila por proveedor × producto × unidad de compra): unidad de compra, último precio, última compra y **un solo texto libre**, `referenciaProveedor`, que hoy mezcla el código y el nombre del proveedor. La línea de la factura (`FacturaProveedorRenglon`) **no** guarda lo que decía la factura: ese texto solo sirve para escribir o actualizar el vínculo.
- **Producción:** 0 materias primas, 0 insumos, 0 proveedores, 0 vínculos y 47 productos de venta. No hay nada que migrar de este lado.

**Principio (PROPUESTA): cada dato vive en un solo lugar, y se pregunta de quién es.**

| Dato | De quién es | Dónde vive | Se copia a otro lado |
|---|---|---|---|
| Nuestro código y nombre | de la materia prima | `Producto` | No |
| El concepto genérico (para recetas y costo) | del insumo | `Insumo`, y la materia prima lo apunta | No: los reportes por insumo se calculan por la materia prima |
| Código y descripción **que pone el proveedor** | del par proveedor × materia prima (el mismo producto lo llama distinto cada proveedor) | `ProveedorPorProducto`, **en dos campos separados**: `codigoDelProveedor` (nuevo) y `referenciaProveedor` (queda para la descripción) | No: las facturas y los reportes lo leen del vínculo |
| Unidad de compra y conversión a unidad de stock | del producto y del vínculo | `Producto.factorConversion` y `ProveedorPorProducto.unidadCompraId` | No |
| Unidades, kilos e importe de cada compra | del documento | la línea: importe en `MovimientoStock.precioTotal` / `FacturaProveedorRenglon.precioTotal` (HOY); UM y unidades **NO EXISTEN hoy** y llegan con la migración 2a (§6, §14); kilos solo si la unidad de stock es de peso (§14) | No (precio por unidad y por kilo se calculan) |
| Último precio | derivado | hoy `ProveedorPorProducto.precioUnitario`; se puede recalcular de la última línea | Es una caché que ya existe |

**Qué evita duplicar.** Código y descripción **no** se guardan en el insumo ni en la materia prima ni en cada línea: viven en el vínculo proveedor × materia prima. Separar código y descripción en dos campos permite buscar por el **código exacto** del proveedor y sacar las dos columnas del reporte sin cortar texto. Una restricción única `(empresa, proveedor, código)` impide que un mismo código del proveedor apunte a dos productos.

**Flujo.** Primera carga de un insumo a un proveedor: el operador escribe el código y la descripción tal como están en la factura y elige la materia prima (o la crea rápido); el sistema guarda el vínculo. Desde la segunda carga: escribir el código lo encuentra directo (coincidencia exacta primero, §5.2). Si se crea una materia prima nueva al vuelo, el nombre propuesto puede salir de la descripción del proveedor **una sola vez, al crearla**, y después se edita por separado (no queda ligado).

**Historia (CONFIRMADA el 2026-11-03: opción a).** La línea no guarda lo que decía la factura: alcanza con lo último que dice el vínculo. Si el proveedor cambia un nombre, el reporte de una factura vieja muestra el nombre nuevo; se pasa a (b), una foto de código y descripción en la línea (dos columnas aditivas), solo si hace falta la historia exacta.

**Ejemplo (códigos y descripciones de Cedisur reales, de la planilla del dueño; el resto inventado para ilustrar un segundo proveedor).**

| Insumo | Nuestro código (MP) | Nuestro nombre (MP) | Proveedor | Código del proveedor | Descripción del proveedor | Unidad de compra |
|---|---|---|---|---|---|---|
| Bife angosto | MP_3fa9c1 | Bife angosto c/cordón | Cedisur S.A. | A1067000007 | Bife Angosto Con Cordon Refrigerado Rioplatense (x KG.) | CAJA |
| Bife angosto | MP_3fa9c1 | Bife angosto c/cordón | Frigorífico del Valle (ejemplo) | BAN-0045 | BIFE ANGOSTO C/CORDON ENFRIADO X KG | CAJA |
| Bife angosto | MP_81be20 | Bife angosto congelado | Frigorífico del Valle (ejemplo) | BAN-0145 | BIFE ANGOSTO C/CORDON CONGELADO X KG | CAJA |
| Frutos rojos | MP_c70d44 | Mix frutos rojos congelados 2 kg | Cedisur S.A. | A0340020055 | Mix De Frutos Rojos Congelados IQF La Piedad (2 KG.) | BOLSA |

Una materia prima puede tener varios proveedores; un código del proveedor apunta a una sola materia prima; el insumo agrupa materias primas y no guarda nada del proveedor; la factura guarda la materia prima, las unidades, los kilos y el importe, sin copiar ningún nombre.

**Migración (etapa 2, junto a las letras del proveedor).** Una columna aditiva `codigoDelProveedor` en `ProveedorPorProducto` y un índice único parcial; `referenciaProveedor` no se toca. Sin datos que migrar. **Requiere autorización expresa**, con respaldo y ensayo.

## 5. Invariantes y políticas

### 5.1 Invariantes

| # | Invariante | Estado |
|---|---|---|
| I1 | El número de factura es obligatorio siempre | CONFIRMADA |
| I2 | El mismo número del mismo proveedor se rechaza en toda la empresa, también desde la compra simple, la corrección y la aceptación | CONFIRMADA (los caminos: PROPUESTA) |
| I3 | Número solo con dígitos; ceros a la izquierda se completan. Punto de venta de 5 dígitos y número de 8 (así viene en la planilla del dueño: `00023-00237728`) | CONFIRMADA (los anchos 5 y 8 los confirmó el dueño el 2026-11-03 con su planilla real; la documentación oficial de ARCA no se consultó: NO VERIFICADA) |
| I4 | Letra y punto de venta salen de lo configurado en el proveedor; con uno solo se eligen solos | CONFIRMADA |
| I5 | Solo facturas con proveedor, sin remito | CONFIRMADA (proveedor obligatorio: PROPUESTA) |
| I6 | Precio 0 se puede guardar y avisa; no actualiza el costo | CONFIRMADA |
| I7 | La unidad es la del producto | CONFIRMADA |
| I8 | Dinero: el importe de cada línea es el total pagado con IVA incluido, en pesos; el total de la factura es la suma de los importes (al centavo); precio por unidad y por kilo se calculan | CONFIRMADA (HOY) |
| I9 | Rechazo: motivo obligatorio; la parte vuelve a la sucursal que la envió; Σ partes = total | CONFIRMADA |
| I10 | Activar un producto al aceptar exige un permiso de quien acepta | PENDIENTE (cuál) |
| I11 | Toda acción lleva confirmación explícita: guardar, aceptar, rechazar, activar, anular | CONFIRMADA |
| I12 | Primera carga de un insumo: «cómo lo llama el proveedor» obligatorio y se guarda | CONFIRMADA |
| I13 | La fecha de la compra no puede ser posterior a hoy (hora argentina). Hoy el servidor admite «mañana» (H5) | PROPUESTA |
| I14 | No se borra nada: anular es un registro nuevo | HOY |
| I15 | La unicidad rige para cargas nuevas; las compras viejas con texto libre no se tocan y se comparan normalizando al leer | PROPUESTA |

### 5.2 Buscador de productos (CONFIRMADA la exigencia; criterios PROPUESTA)

1. Busca en nombre, código y «cómo lo llama» de cualquier proveedor (esto último solo para quien ya ve ese dato).
2. Cada palabra se busca por separado y todas tienen que estar; sin importar el orden, las mayúsculas ni las tildes.
3. Orden: primero lo que **el proveedor elegido** ya llama así; después coincidencia por el principio del nombre; después el resto.
4. Muestra de dónde salió el hallazgo («Distribuidora Andina lo llama …») y la última vez que se compró (solo referencia).
5. Si no encuentra: mensaje claro y la opción «crear producto rápido».
6. Hoy busca una sola frase contenida (`whereBusquedaDeProducto`, `src/core/catalogo/busqueda-de-producto.ts`): «harina 25» no encuentra «Harina 000 x 25 kg». Las palabras por separado se resuelven **sin migración**; ignorar tildes exige `unaccent` o una columna normalizada (migración, etapa aparte, con autorización).

### 5.3 «¿Qué pasa si…?» por comando

| Situación | Cargar factura | Aceptar mi parte | Rechazar mi parte (nuevo) |
|---|---|---|---|
| **Repetición** (clic doble, reintento, red) | Una sola compra: clave de reintento obligatoria (E1) y clave única del número | Una sola aceptación: UPDATE condicionado a PENDIENTE | Un solo rechazo; la devolución se escribe una sola vez |
| **Concurrencia** | Dos personas cargan el mismo número: gana la primera, la segunda recibe «ya está cargada» (índice único) | Dos usuarios aceptan o uno acepta y otro rechaza a la vez: `FOR UPDATE` sobre la propuesta; una sola salida | Idem; la propuesta queda en un único estado final |
| **Tiempo** | Fecha ≤ hoy (Argentina). Número en el momento: manda el índice al guardar | Una propuesta PENDIENTE no vence (PENDIENTE: ¿plazo?) | Idem |
| **Incertidumbre** | «No encontramos otra igual» no es garantía; la confirmación es al guardar | Si no hubo respuesta, reintentar es seguro | Idem |
| **Reintento** | Misma clave = mismo resultado | Misma clave = mismo resultado | Misma clave = mismo resultado |
| **Error parcial** | Cabecera, renglones, stock, costo, propuestas y auditoría en una transacción: todo o nada | Aceptar y activar el producto en la misma transacción: si falla una, no queda ninguna | Rechazar y devolver la parte en la misma transacción |
| **Datos faltantes** | Falta letra, punto de venta, número o proveedor: no guarda | Falta depósito o fecha de stock: no acepta | Sin motivo: no rechaza |
| **Cambio de permisos** | Se revisa en el servidor al guardar | Si perdió `proceso_compra` o el permiso para activar, no acepta | Si perdió `proceso_compra` en la destino, no rechaza |

### 5.4 Preguntas

**Resueltas (CONFIRMADAS el 2026-11-03):**

1. Anchos: punto de venta de **5** dígitos y número de **8**, confirmados por el dueño (I3).
2. Si el proveedor no tiene letra o punto de venta cargados, la primera factura los pide y **ofrece guardarlos en la ficha, con confirmación**.
3. Activar un producto al aceptar: alcanza con `producto_disponibilidad`. Quien acepta sin ese permiso solo puede rechazar.
4. Propuesta sin respuesta: la sucursal que compró puede **retirarla con motivo**; el plazo se decide después.

**Resueltas en la tercera ronda (CONFIRMADAS el 2026-11-03):**

5. **IVA.** «No va a ser un sistema ERP aún»: la carga es el **total con IVA incluido** (como HOY, `precioTotal`); la alícuota de compra vive en el **producto** (`Producto.alicuotaIvaCompra`, HOY) y la perilla `llevaIvaDeCompras` sigue apagada. No se pide neto ni IVA por línea.
6. **Importe de la línea.** Es el dato que se carga (el de la factura); el total de la factura es la suma de los importes, siempre al centavo. El precio por unidad y por kilo se **calculan** (importe ÷ unidades, importe ÷ kilos); no se cargan.
7. **Descuento por línea.** No se carga por ahora (poda). Lo que se cargó es lo que se pagó.
8. **«Se cobra por kilo».** No hace falta marcarlo en el producto: con unidad de medida, kilos e importe se tienen ambas cuentas. Los **kilos son opcionales**: si el operador no los sabe, se sigue y solo se calcula el precio por unidad.
9. **Reportes.** Pendientes por ahora. Se guarda cada línea con sus datos (código, descripción, UM, unidades, kilos, importe) para armarlos después sin recargar nada (§14).
9.bis **Stock inicial (CONFIRMADA el 2026-11-03).** Desde que la compra exige proveedor y número, el stock inicial de un cliente real se carga como Ajuste o Conteo físico, sin costo: queda «sin costo hasta la primera compra» de cada insumo y lo incompleto queda como dato heredado; no cambia la regla V-T1 ni se agrega un camino nuevo (los seeds de demo siguen cargándolo como compra con un proveedor de demo).

**Abierta:**

10. **Lote y vencimiento.** Hoy es un campo opcional por línea («Lote (Fecha VTO.)»). ¿Obligatorio para los que vencen? *No se decide hasta que el dueño lo pida.*

## 6. Persistencia (esbozo; NO se migra hasta confirmar 1 a 5)

Lo más barato primero:

| Etapa | Qué | Migración |
|---|---|---|
| **1** | Número estructurado (dígitos, ceros a la izquierda), clave única en toda la empresa también desde la compra simple, corrección y aceptación; buscador por palabras; «cómo lo llama» obligatorio en la primera carga; aviso de precio 0; pasos y confirmaciones en pantalla; fecha ≤ hoy; clave obligatoria al anular una compra; letras y puntos de venta tomados de la ficha cuando ya estén | **Ninguna** |
| **2a** (primera, sola) | UM y unidades de cada línea comprada (§14.1): `unidadCompraId` y `cantidadCompra`, nulables, en `FacturaProveedorRenglon` y en `MovimientoStock` (solo las escribe una COMPRA). **Precondición del uso real de compras** (CONFIRMADA el 2026-11-03): no se habilita la carga real sin ella | Aditiva, reversible, chica y aparte para poder aplicarla antes. **Requiere autorización expresa** por base, con respaldo y ensayo |
| **2** | Letras de comprobante del proveedor: columna aditiva en `Proveedor` con CHECK (los puntos de venta ya tienen su tabla `PuntoDeVentaDeProveedor`, hoy sin uso); escribir `FacturaProveedor.letra` | Aditiva, reversible. **Requiere autorización expresa** |
| **3** | Estado RECHAZADA de la propuesta con motivo y referencia a la parte devuelta | Aditiva (ampliar el CHECK de estado, columna de motivo). **Requiere autorización expresa** |
| Aparte | Buscar sin tildes (`unaccent` o columna normalizada) | Aditiva. **Requiere autorización expresa** |

Cada migración: respaldo y ensayo en una rama de Neon antes de tocar producción; `down.sql` que aborta si hay filas nuevas; sin cambios destructivos. Hasta que se confirmen los niveles 1 a 5, nada de esto se escribe.

## 7. Atomicidad y concurrencia

Se mantiene el molde de E3a: transacción SERIALIZABLE con reintento, `FOR UPDATE` sobre la cabecera y la propuesta, UPDATE condicionado al estado, índices únicos para los choques y traducción de errores por nombre de índice. Rechazar y devolver la parte, y aceptar y activar un producto, son **una sola transacción cada uno**.

## 8. Acceso e interfaces

- Letra y punto de venta: ficha del proveedor (Catálogo → Proveedores), con `proveedores`.
- Cargar: `proceso_compra`; repartir: `compra_repartir`; aceptar o rechazar: `proceso_compra` en la destino (PROPUESTA, hoy el diseño E3a marca la aceptación como PENDIENTE §10 P2); activar producto: `producto_disponibilidad` (PENDIENTE).
- No se agregan permisos nuevos en la etapa 1. Si el rechazo necesitara uno propio, se decide en la etapa 3.
- El mensaje de número repetido no muestra fecha ni sucursal ajena (regla P2 del aviso C25, `registrar-movimiento.ts`).

## 9. Consultas y experiencia

Por pasos: 1 proveedor y comprobante; 2 qué se compró; 3 a qué sucursal va; 4 cómo se pagó (PROPUESTA, requiere cabecera en toda compra: E3b); 5 revisar y confirmar. Datos tecleados: **6** en la primera factura a un proveedor y **5** desde la segunda; cada línea extra suma 3. Se muestra de dónde salió cada dato (HOY / PROPUESTA / PENDIENTE) solo en la maqueta.

## 10. Pruebas, combinaciones, migración y operación

- **Concurrencia:** dos cargas del mismo número a la vez; aceptar y rechazar a la vez; dos rechazos a la vez.
- **Idempotencia:** repetir cada comando con la misma clave no duplica compra, stock, costo ni devolución.
- **Combinaciones (regla del dueño del 2026-10-28).** Dimensiones que cambian dinero, permisos o visibilidad: cantidad de letras del proveedor (0, 1, varias) × cantidad de puntos de venta (0, 1, varios) × permiso de repartir (sí/no) × ver la sucursal ajena (sí/no) × producto activo en la destino (sí/no) × desenlace de la propuesta (pendiente, aceptada, rechazada). Se escribe una tabla de reglas esperadas aparte del código y un test que recorre todas contra ella; un guardián falla si aparece una dimensión nueva sin declarar.
- **Poda:** ninguna opción nueva sin necesidad escrita. Las necesidades de este diseño están en §1.
- **Operación:** runbook de las tres migraciones ya aplicadas (E2, E3a-M) en `docs/deploy-con-migraciones.md`, que hoy no las menciona; corregir la cabecera de `motor2-docs/_planes/plan-unificado-gastos-compras-y-ventas.md` («No se implementó nada»), que está desactualizada.
- **Escalera de producto:** producción está en N1 con N3 disponible; este diseño recorre el peldaño N2 (número único en toda la empresa).

## 11. Qué NO está resuelto

Pedido, cotización y orden de compra (sin necesidad escrita); remito y recepción separada; gastos sin stock; IVA desglosado; adjunto del comprobante (falta decidir dónde se guardan los archivos); cuenta corriente; nota de crédito; moneda distinta del peso; centros de costos (no aplican a mercadería, ADR-031).

## 12. Corrección con ejemplares (PROPUESTA; pedido del dueño del 2026-11-03)

**Necesidad.** Corregir una factura mal cargada sin borrar lo cargado mal y sin que el sistema quede inconsistente. Hoy solo se corrige la cabecera (proveedor, número, detalle, `src/core/compras/correccion.ts`); un precio o una cantidad mal cargada se arregla anulando y cargando de nuevo (K1c).

**Qué dice ARCA (fuentes secundarias; documentación oficial NO VERIFICADA).** Una factura electrónica con CAE no se anula ni se modifica: el emisor la corrige con una **nota de crédito o de débito asociada** al comprobante original. Eso es un documento del proveedor (etapa de notas de crédito, sin construir) y es distinto de un **error de carga nuestro**.

**Propuesta para el error de carga nuestro.** Mismo patrón que los tickets (`EjemplarTicket`: ejemplar 1 = A original; la corrección es una fila **nueva** con el mismo número, el ejemplar siguiente, `corrigeAId` → A y motivo; nunca se edita ni se borra):

- Corregir = **una sola operación atómica**: se revierte lo que movió el ejemplar vigente (stock y costo, con el Kardex que solo agrega) y se carga el ejemplar siguiente con el **mismo número**, vinculado al anterior, con motivo obligatorio. El anterior queda visible como «reemplazado».
- El número no se cambia: es el mismo comprobante, así que no choca con la regla de repetidos (la unicidad rige entre ejemplares **vigentes**).
- Solo cuenta el ejemplar vigente para stock, costo y reportes.
- Permiso: administrador (`corregir_compra`). Con confirmación.
- Facturas repartidas: se corrige el ejemplar entero; las partes de otras sucursales ya aceptadas se tratan como en la anulación entera (bloqueo si algo se consumió: decisión PENDIENTE de detalle).
- Reutiliza el patrón de `ReclasificacionRenglon` (versiones que solo agregan) para las líneas sin stock.

**Persistencia (esbozo).** Probablemente columnas aditivas en `FacturaProveedor` (`ejemplar`, `corrigeAId`, `motivo`) y el índice único parcial sobre los vigentes. Migración aditiva: **requiere autorización expresa**; no se diseña a fondo hasta confirmar §5 y esta sección.

## 13. Servicios y tipo de proveedor (etapa E4; PROPUESTA)

- **Ya existe en el modelo (HOY):** `Proveedor.ofreceProductos` y `ofreceServicios` (al menos uno, por CHECK), `ConceptoDeGasto`, `ImputacionDeGasto` (una por sucursal, solo agrega), 7 claves `gasto_*` en la base fuera de `ACCIONES`, módulo `gastos` en desarrollo. **Ninguna pantalla los lee todavía.**
- **Propuesta (la forma más barata):** una sola pantalla de carga. El tipo del proveedor decide qué líneas admite: solo productos, solo servicios, o ambos (a elección por línea). Una línea de servicio lleva **concepto** (gas, electricidad, flete…), descripción e importe, no pasa por stock y se imputa a una o varias sucursales.
- **Ficha del proveedor:** casillas «productos» y «servicios», letras y puntos de venta, y la lista de cómo llama a cada insumo.
- **Fuera:** reparto por centros de costos (E8) y cuenta corriente (E9).
- Prender el módulo `gastos` y las claves `gasto_*` es parte de esa etapa y se decide aparte.

## 14. Reporte tipo planilla (PENDIENTE por ahora; pedido del dueño del 2026-11-03)

**Decisión (CONFIRMADA el 2026-11-03): los reportes quedan pendientes en esta etapa.** Lo que sí se hace ahora es guardar cada línea con los datos de la planilla del dueño (fecha de emisión, proveedor, punto de venta y número, línea, código, descripción, UM, unidades, kilos, importe y tipo de línea), para que el reporte se arme después sin recargar nada: una fila por línea, con filtros por proveedor, punto de venta, monto y producto, exportable a Excel, y solo con el ejemplar vigente. Las columnas y filtros definitivos se deciden cuando se construya. Hoy existe «Compras registradas» (`reporte_compras`) con otras columnas.

**Corrección (2026-11-03).** «Se guarda cada línea con sus datos» NO se cumple del todo en la etapa 1, que va sin migración: la UM y las unidades compradas no tienen dónde guardarse (`armarLineaMovimiento` convierte con el factor y descarta lo comprado). Llegan con la migración 2a (§6). **Decisión del dueño (CONFIRMADA el 2026-11-03):** esas columnas tienen que estar aplicadas ANTES de que un cliente real cargue compras; la autorización para aplicarlas sigue pendiente (por base, con respaldo y ensayo).

### 14.1 Dónde vive cada columna de la planilla (verificado contra el código de la rama `alegp/compras-etapa-1`, 2026-11-03)

| Columna | Compra simple (`Operacion` COMPRA + `MovimientoStock`) | Factura repartida (`FacturaProveedor` + `FacturaProveedorRenglon`) |
|---|---|---|
| Fecha de emisión | `Operacion.fecha` (único día cargado: vale de stock y de factura) | `FacturaProveedor.fecha` (día de stock y costo). `fechaComprobante` existe pero nunca se escribe |
| Proveedor | `Operacion.proveedorId` (obligatorio desde la etapa 1) | `FacturaProveedor.proveedorId` |
| PV y número | Derivable: se parsea `Operacion.nroFactura` (canónico «A-00023-00237728» desde la etapa 1; las compras viejas de texto libre pueden no parsear, I15) | Derivable de `FacturaProveedor.nroFactura` (canónico). `letra` no se escribe (etapa 2) |
| Línea (n.º de renglón) | **NO EXISTE** (sin orden; `creadoEn` es igual para todas las líneas) | `FacturaProveedorRenglon.orden` |
| Código | `Producto.codigo` (NUESTRO). El código del proveedor no existe (etapa 2, `codigoDelProveedor`) | Igual |
| Descripción | `Producto.nombre`, o `ProveedorPorProducto.referenciaProveedor` (la ACTUAL, no histórica: opción a de §4.bis) | Igual (`FacturaProveedorRenglon.descripcion` existe pero no se escribe en MERCADERIA) |
| UM | **NO EXISTE** (llega con 2a) | **NO EXISTE** (llega con 2a) |
| Unidades (en la UM) | **NO EXISTE** (llega con 2a) | **NO EXISTE** (llega con 2a) |
| Kilos | Solo si la unidad de stock es de peso (`Unidad.magnitud = PESO`): `MovimientoStock.cantidad`. Si no, **NO EXISTE** | Igual, `FacturaProveedorRenglon.cantidadStock` |
| Importe (con IVA) | `MovimientoStock.precioTotal` | `FacturaProveedorRenglon.precioTotal` (cada parte tiene además su movimiento: no sumar dos veces) |
| Tipo de línea | **NO EXISTE** (siempre COMPRA) | `FacturaProveedorRenglon.naturaleza` (hoy siempre MERCADERIA) |

**Peso real hoy.** El «peso real» REEMPLAZA la cantidad de stock y se interpreta en la unidad de stock del producto, sin mirar si es de peso. Unidad de stock kg, 1 caja con peso real 12,4: entran 12,4 kg; el «1 caja» queda solo en el texto `detalle`. Unidad de stock «lata», 1 caja de 24 con peso real 10: entran **10 latas**, no 24 (el campo se rotula «Peso real (en la unidad de stock, opcional)», D1, pero un operador que escribe kilos ahí carga mal el stock). PENDIENTE: ver §14.2.

**Sin columna no alcanza.** La única fuente de UM y unidades sin migrar sería parsear el texto `MovimientoStock.detalle` («3 × 24 = 72 lata», «Peso real: 12.4 kg (1 compradas)»): no trae el nombre de la UM, con factor 1 dice solo «COMPRA» y en una parte de factura copia el texto del renglón entero. No es exacto: se descarta.

### 14.2 Propuesta de la migración 2a (PROPUESTA; requiere autorización expresa, NO se aplica en la etapa 1)

**Columnas** (aditivas, nulables; NULL = dato heredado, se muestra «pendiente de completar», nunca se inventa):

- `FacturaProveedorRenglon.unidadCompraId TEXT NULL` + `cantidadCompra DECIMAL(14,4) NULL`: la UM y las unidades del renglón de la factura.
- `MovimientoStock.unidadCompraId TEXT NULL` + `cantidadCompra DECIMAL(14,4) NULL`: las mismas dos, para la compra simple, que no tiene renglón. En las partes de una factura repartida quedan NULL y se leen del renglón (`facturaProveedorRenglonId`), para no repartir unidades que no son exactas.
- En las dos tablas: FK compuesta `(empresaId, unidadCompraId) → Unidad(empresaId, id)` como el resto del esquema; `CHECK ((unidadCompraId IS NULL) = (cantidadCompra IS NULL))` y `CHECK (cantidadCompra IS NULL OR cantidadCompra > 0)`. Sin índices nuevos (el reporte filtra por proveedor, fecha y producto, que ya tienen índice). No cambia la RLS (columnas en tablas que ya la tienen).

**Cómo se escriben, sin cambiar stock ni costo.** `armarLineaMovimiento` ya conoce la unidad de compra efectiva (la de la presentación elegida o la del producto) y `numCant` (lo comprado): solo los devuelve en la línea calculada, y `armarFilasDeMovimiento` / `escribirCabeceraDeFactura` los copian a las columnas nuevas. `cantidadStock`, `precioPorUnidadStock`, el costo (V-T1) y el Kardex quedan EXACTAMENTE igual: el test de caracterización de venta y los goldens no deberían cambiar en importes ni stock (solo agregar las dos columnas en las filas de compra). Lo escriben solo COMPRA y factura repartida; los demás procesos dejan NULL.

**down.sql** (aborta si ya hay datos, como las demás):

```sql
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM "MovimientoStock" WHERE "cantidadCompra" IS NOT NULL)
     OR EXISTS (SELECT 1 FROM "FacturaProveedorRenglon" WHERE "cantidadCompra" IS NOT NULL) THEN
    RAISE EXCEPTION 'Hay líneas con unidad de compra cargada: revertir perdería datos';
  END IF;
END $$;
ALTER TABLE "MovimientoStock" DROP COLUMN "cantidadCompra", DROP COLUMN "unidadCompraId";
ALTER TABLE "FacturaProveedorRenglon" DROP COLUMN "cantidadCompra", DROP COLUMN "unidadCompraId";
```

**Orden.** Va PRIMERA y SOLA (recomendado): es chica, aditiva, no depende de las letras del proveedor ni del estado RECHAZADA, y es precondición del uso real; aplicarla aparte permite habilitar la carga real sin esperar el resto de la etapa 2. Las letras / `codigoDelProveedor` vienen después en su propia migración.

**Preguntas abiertas (PENDIENTE):**
1. **Kilos independientes** (D1, PENDIENTE de la etapa 2): para un producto cuya unidad de stock no es de peso, ¿hace falta guardar kilos (p. ej. latas por kilo)? Si sí, una tercera columna `kilos` nulable en la misma migración 2a; si no, «precio por kilo» solo se calcula cuando la unidad de stock es de peso.
2. **Peso real con unidad que no es de peso** (riesgo de stock mal cargado, ver arriba): propuesta más barata, sin migración, para el paso 6 de la etapa 1: mostrar «Peso real» solo cuando la unidad de stock del producto es de peso, y que el servidor lo rechace si no lo es. Requiere OK porque cambia lo aceptado en D1.
