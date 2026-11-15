# Diseño — Fracciones (½, ¼, ⅛) y venta por peso, igual a Pedernal — 2026-11-15

Estado: **diseño en papel.** Sin código, sin migración, sin tocar ninguna base. Nada se desplegó ni se escribió en producción.
Método: escalera de diseño de 10 niveles (AGENTS.md, «Diseño de módulos y features nuevos»). Los niveles 1 a 5 están completos con su estado; el nivel 6 es **solo un esquema PROPUESTO: no se migra hasta confirmar los niveles 1 a 5** (hoy hay preguntas de negocio abiertas, §13).
Estados: **CONFIRMADA** (dicha por el dueño, con fecha y cita) · **PROPUESTA** (de este diseño; el dueño la corrige) · **PENDIENTE** (falta decidir) · **NO VERIFICADA** (no pude comprobarlo en el código o en un dato real).
Marcas de evidencia: **(V)** verificado leyendo el código de `main` de Motor2 (`b36de06`, 2026-11-15) · **(P)** verificado en el código de Pedernal (repositorio hermano, `243432a`) · **(D)** sale de la documentación de Pedernal (`b179a9f`) o de los planes de paridad, sin verificar el código.

## 0. Resumen

- **Lo que pidió el dueño:** vender un producto por mitad, cuarto u octavo (solo 2, 4 y 8) y por peso, con la perilla apagada por defecto; y que Motor2 sea «igual a Pedernal en todo» (resultado y forma), salvo lo que imponga Prisma.
- **Lo que Motor2 ya tiene con otro nombre:** una forma *parcial*. Existe un **paso de venta libre** por producto (`Producto.pasoVenta`) que ya permite vender ½ pizza (V). Falta: elegir *cuáles* fracciones se ofrecen, derivar el paso de ellas, la perilla, congelar el paso en la línea vendida, la cantidad escrita «1/2» en el papel, y una forma «peso» explícita.
- **Etapas, de la más barata a la más cara:** E0 sin migración (reglas puras + oráculo + tests) → E1 una columna en el producto (las fracciones ofrecidas) con su caso de uso y su pantalla → E2 la perilla → E3 congelar el paso en la línea → E4 podar el paso libre. Las migraciones son aditivas y con `down.sql` previsto; ninguna se aplica a una base real desde acá.
- **Preguntas de negocio abiertas (3):** qué pasa con los pasos libres que ya existen (Q1), si la perilla frena también lo que ya se puede hacer hoy (Q2) y si un producto por peso se vende siempre en la unidad en que se guarda su stock (Q3).
- **Dividir la cuenta (0052) no es parte de esta pieza;** su relación con esta está en §7.

## 1. Propósito y alcance (nivel 1)

**Necesidad y quién la pidió (escrita):**

| Qué | Fuente | Estado |
|---|---|---|
| Un producto se vende por fracciones: se marca en cuántas partes se divide el entero (2, 4, 8), una o varias a la vez. «Productos también. Solo 2, 4 y 8.» Tercios y sextos fuera «hasta nueva orden» | Dueño, 2026-11-12, chat de Pedernal (D: decisiones del dueño de Pedernal, fila del 12/11) | CONFIRMADA (para Pedernal) |
| La venta por fracciones y por peso se construye ya, con perilla apagada por defecto; el paso mínimo se deriva de las fracciones que se ofrecen; el peso se carga a mano, en un solo campo | Dueño, 2026-11-14 (D: fila «Cómo se vende y familias en el servidor») | CONFIRMADA (para Pedernal) |
| Fracciones solo en productos «por unidad»; el peso va por unidad de masa con paso a mano (DEC-0371); la perilla se llama `venta_por_fracciones_y_peso` y el rótulo es «Fracciones y peso» (DEC-0372) | Dueño, 2026-11-14, «APROBADA» (D: fila del 14/11 «Pendientes del dueño resueltos») | CONFIRMADA (para Pedernal) |
| La cantidad en papel se escribe «1/2», «1/4», «1/8», al tamaño que es 1 | Dueño, 2026-11-10 (D: decisión 181 del catálogo de Pedernal) | CONFIRMADA (para Pedernal) |
| Motor2 debe ser igual a Pedernal en todo | Dueño, 2026-11-13: «Necesitamos ser iguales en todo… el resultado tiene que ser el mismo y sobre todo de las mismas formas, salvo porque nosotros usamos Prisma» | CONFIRMADA |
| Avanzar en Motor2 «con lo que decidió Pedernal si cambió algo para vos, de lo que ya tiene construido Motor2» | Dueño, 2026-11-15, chat con el orquestador | CONFIRMADA (en dirección) |
| Que *esta etapa concreta* (fracciones y peso en Motor2, con su migración) está ratificada | No encontré una cita específica para Motor2; el plan de paridad la marca «sin migración autorizada» (R4) | **PENDIENTE** — por eso no se migra |

**Entra (cuando se ratifique):** elegir las fracciones ofrecidas de un producto; la forma «peso»; derivar el paso mínimo; la perilla; que la venta, el stock, el ticket y la comanda traten bien esas cantidades.
**No entra:** tercios y sextos; balanza; «peso variable» de una presentación de compra (es de compras); precio por medida; botones de fracción en el punto de venta (el campo de cantidad actual sigue; los botones son una pantalla aparte y no fueron pedidos para Motor2); dividir la cuenta (§7); conversión de precios kilo↔gramo (solo existe si hay unidad de venta distinta de la de stock: ver Q3).

## 2. Inventario: lo que ya existe en Motor2 con otro nombre (verificado en el código)

| Qué | Dónde (V) | Relación con Pedernal |
|---|---|---|
| Paso de venta por producto, decimal exacto `Decimal(14,4)`, nulo = «una unidad entera» | `prisma/schema.prisma:412` (`Producto.pasoVenta`) | Pedernal: `paso_minimo` siempre presente (1 por defecto) |
| Reglas del paso: `0 < paso ≤ 1`, hasta 4 decimales, **`1/paso` entero**, y si el producto «se produce» sus decimales entran en los de su unidad (R3) | `src/core/catalogo/venta-fraccionada.ts` (`validarPasoVenta`) | Pedernal (P): paso > 0, hasta 4 decimales, convierte exacto a la base; **no exige `1/paso` entero** (`forma-de-venta.ts`) |
| Cantidad múltiplo del paso, con tolerancia de coma flotante 1e-6; si no es múltiplo se **rechaza**, nunca se redondea | `cumplePaso`, `validarCantidadPedido` (`src/core/pos/cantidad-pedido.ts`); mostrador: `src/core/movimientos/linea-de-venta.ts:49` | Pedernal: múltiplo con enteros (bigint), sin tolerancia |
| Sin paso: la cantidad se **redondea en silencio** a los decimales de la unidad de stock | `validarCantidadPedido` (rama sin `pasoVenta`) | Pedernal: no hay rama sin paso |
| Tope de cantidad por ítem: 999 | `CANTIDAD_MAXIMA_POR_ITEM` | Pedernal: NO VERIFICADO |
| Unidad: una por producto (`unidadStockId`); la unidad es de la empresa (`Unidad.magnitud` PESO/VOLUMEN/CANTIDAD, `decimales` 0 a 6). **No hay unidad de venta distinta de la de stock** | `schema.prisma:376-380, 592` | Pedernal: `unidad_de_venta_id` aparte + 14 unidades fijas con factor. Las 14 unidades fijas son la etapa E2 del plan de paridad (CONFIRMADA «igual a Pedernal», 2026-11-14, relatada): no construida |
| Vender por peso **hoy**: un producto de venta cuya unidad de stock es de masa, con o sin paso | combinación de lo anterior; **NO VERIFICADO** punta a punta en pantalla | Pedernal: forma «Peso» explícita, con paso a mano obligatorio |
| Importe de la línea: `cantidad × precio unitario` en decimal exacto (`decimal.js`), **un solo redondeo a centavos, mitad hacia afuera del cero** | `src/core/moneda.ts` (`importeDeLinea`, `redondearMoneda`) | Pedernal: centavos enteros; el redondeo del importe de una línea fraccionada, NO VERIFICADO |
| Consumo de stock de una receta con venta fraccionada: **arrastre de redondeo** por (sucursal, producto) para que dos medias pizzas consuman 1 bollo y no 2 | `src/core/movimientos/arrastre-redondeo.ts` (Task #27) | Pedernal: stock en cantidades exactas con su propia explosión; la regla de redondeo es otra. **Diferencia a declarar** (§15) |
| La línea de la cuenta **no congela el paso ni la unidad**; anular parte de un ítem enviado lee el paso **vigente** del producto | `src/server/actions/pos/casos-de-uso/anular-item-enviado.ts:67`, `cargar-item-para-anular.ts:55` | Pedernal: la línea congela `unidad_de_venta` y `paso_de_cantidad` |
| La cantidad en papel: número con coma («0,5») | `formatearCantidad` (`src/core/formato-de-numero.ts:99`), comanda y ticket | Pedernal: «1/2», «1/4», «1/8», «1 1/2» por unidad; con unidad en peso («350 g») |
| Perilla por plan | **No hay planes.** Hay módulos por empresa (`ModuloEmpresa`), un booleano de plataforma en la empresa (`Empresa.llevaIvaDeCompras`, lo cambia solo la plataforma) y una variable de entorno por instalación | Pedernal: perilla `venta_por_fracciones_y_peso`, `base: apagada`, por plan. Motivo ya confirmado por el dueño (2026-11-14, relatado): «Motor2 no tiene planes, es solo 1 empresa» |
| Auditoría del cambio de paso (antes → después) | `registrarCambioAuditado` en `actualizar-producto.ts:289` | Pedernal: auditoría con la forma anterior y la nueva |
| Permisos para cambiar el producto | `producto_editar` (`src/core/permisos/acciones.ts:57`); para vender: `pos_tomar_pedido` | Pedernal: `productos.editar` + `productos.cambiar_precio`, alcance total |

**Hallazgos del inventario (riesgos del código existente, §14):**
1. Con el paso nulo la cantidad se redondea en silencio (V): un producto de masa con 2 decimales vende «0,3504 kg» como «0,35». Pedernal rechaza lo que no es múltiplo del paso.
2. Anular parte de un ítem ya enviado se valida contra el paso **de hoy**, no contra el que tenía cuando se vendió (V). Si se cambia el paso entre la venta y la anulación, una anulación legítima puede quedar rechazada y el ítem trabado.
3. `cumplePaso` usa números de coma flotante con tolerancia (V). Para ½, ¼ y ⅛ es exacto (potencias de 2); para pesos con 3 decimales no es exacto en binario y se apoya en la tolerancia.

## 3. Actores y contexto (nivel 2)

| Actor | Qué hace | Permiso (V) | Estado |
|---|---|---|---|
| Quien administra el catálogo (gerente, administrador) | Elige las fracciones o el peso de un producto | `producto_editar`; Pedernal exige además cambiar precio (porque reescribe precios si cambia la unidad). En Motor2 sin unidad de venta aparte no se reescriben precios: alcanza `producto_editar` | PROPUESTA |
| Quien toma el pedido (mozo, cajero) | Vende ½, ¼, ⅛ o un peso | `pos_tomar_pedido` (salón); mostrador: el permiso de venta vigente | V |
| Cocina | Lee «1/2 pizza» en la comanda | `comandas`: ver | V (existe) |
| Plataforma | Enciende o apaga la perilla de la empresa | solo la plataforma (como `llevaIvaDeCompras`) | PROPUESTA |

Contexto: una empresa por instalación; el servidor valida empresa y permiso en cada comando; la sucursal importa en la venta, no en la forma de venta (la forma es del producto, igual para todas las sucursales y el precio es el mismo para la empresa y las sucursales, decisión 166 de Pedernal (D)).

## 4. Casos de uso (nivel 3)

| CU | Caso | Estado |
|---|---|---|
| CU1 | Elegir las fracciones de un producto («Fracciones»: ½, ¼, ⅛, una o varias); el paso mínimo se deriva | PROPUESTA (CONFIRMADA en Pedernal) |
| CU2 | Pasar un producto a venta por peso (unidad de masa + paso a mano) | PROPUESTA |
| CU3 | Volver a «por unidad» | PROPUESTA |
| CU4 | Vender una fracción o un peso: en una cuenta de mesa y en el mostrador | existe en parte (V) |
| CU5 | Anular parte de lo vendido (media pizza ya enviada a cocina) | existe en parte (V); riesgo 2 |
| CU6 | Ver la cantidad en la comanda y el ticket («1/2», «350 g») | PROPUESTA |
| CU7 | Encender o apagar la perilla de una empresa | PROPUESTA (Q2) |
| CU8 | Descontar el stock de lo que se consumió (receta × cantidad) | existe (V) |

## 5. Conceptos y ciclo de vida (nivel 4)

- **Porción:** en cuántas partes se divide el entero: 2 → ½, 4 → ¼, 8 → ⅛.
- **Fracciones ofrecidas:** el conjunto de porciones que el producto ofrece. Solo siete conjuntos posibles: {2}, {4}, {8}, {2,4}, {2,8}, {4,8}, {2,4,8} (ordenados, sin repetir).
- **Paso mínimo:** la menor cantidad vendible. Con fracciones **se deriva** de la porción más fina: 1 ÷ la mayor (2 y 8 → ⅛ = 0,125). Así ⅛ + ⅛ = ¼ vale aunque ¼ no tenga botón. Con peso se carga a mano.
- **Forma de venta** (concepto derivado, no es una columna): **UNIDAD** (sin paso, o paso 1), **FRACCIONES** (hay fracciones ofrecidas), **PESO** (unidad de masa con paso explícito), **HEREDADA** (lo que hoy ya existe y no encaja en las anteriores: paso libre que no sale de 2, 4 y 8, o unidad de masa sin paso). HEREDADA no se puede elegir de nuevo; se muestra tal cual y se puede cambiar a una de las otras.

Ciclo de vida de la forma de un producto:

```
nace UNIDAD ──CU1──► FRACCIONES ──CU1 (otras fracciones)──► FRACCIONES
      │                   │
      ├──CU2──► PESO      └──CU3──► UNIDAD
      └─ (heredada: HEREDADA ──CU1/CU2/CU3──► cualquiera de las tres)
```

Una línea ya vendida **conserva** lo que se vendió; cambiar la forma después no la toca (invariante I10).

## 6. Invariantes y políticas (nivel 5)

| # | Invariante | Estado y fuente |
|---|---|---|
| I1 | Las fracciones ofrecidas son uno de los siete conjuntos de §5 | CONFIRMADA (dueño 2026-11-12, para Pedernal) |
| I2 | Con fracciones, paso mínimo = 1 ÷ la porción más fina; no es un dato aparte que pueda quedar torcido | CONFIRMADA (dueño 2026-11-14) |
| I3 | Las fracciones son solo de un producto «por unidad» (unidad de stock de magnitud CANTIDAD); el peso es de una unidad de masa | CONFIRMADA en Pedernal (DEC-0371, 2026-11-14); PROPUESTA para Motor2 por la regla de igualdad |
| I4 | Fracciones y peso son solo de un producto que se vende (tipo PV) | V (hoy `pasoVenta` solo en PV); Pedernal: clase vendible o reventa |
| I5 | Una cantidad es válida si es múltiplo exacto del paso; una entera siempre es válida; **nunca** se redondea en silencio una cantidad que no es múltiplo | V para productos con paso; PROPUESTA para PESO (hoy sin paso redondea) |
| I6 | Peso: paso mayor que cero, hasta 4 decimales; en Motor2 se conserva además «1 ÷ paso es entero» | PROPUESTA; diferencia declarada (§15) |
| I7 | **Cargar** una forma distinta de «por unidad» exige la perilla encendida; **vender** lo ya cargado **no** la exige (una baja no corta la venta de lo que existe) | CONFIRMADA en Pedernal (2026-11-14); en Motor2 sujeta a Q2 |
| I8 | Dinero: importe de la línea = cantidad × precio unitario, un solo redondeo a centavos (mitad hacia afuera del cero), moneda explícita (pesos). Nunca coma flotante binaria para el importe | V (`importeDeLinea`) |
| I9 | Stock: el consumo de la receta es cantidad × consumo por unidad; el total consumido en el tiempo coincide con el exacto (arrastre de redondeo) | V (Task #27) |
| I10 | Lo ya vendido no cambia: precio, cantidad y (E3) el paso quedan congelados en la línea | PROPUESTA (hoy el paso se lee vivo: riesgo 2) |
| I11 | Todo comando valida empresa y permiso en el servidor; los datos de una empresa no se mezclan con los de otra | V (patrón vigente) |
| I12 | Todo cambio de forma deja registro: quién, cuándo, forma anterior y nueva | V (`registrarCambioAuditado`) |
| I13 | Una fracción o un peso **no** entra en un renglón de promo/combo (la cantidad de un componente es entera) | PROPUESTA (la opción más barata: se rechaza; no hay pedido que lo habilite) |
| I14 | Peso con una opción que consume insumo («qué consume cada opción»): se rechaza, como Pedernal (`OPCION_CON_CONSUMO_EN_VENTA_POR_PESO`, P) | PROPUESTA; NO VERIFICADO cómo escala hoy el consumo de una opción en Motor2 |
| I15 | Todo nace cerrado: un producto nace «por unidad»; la perilla nace apagada; una validación nueva declara lo permitido | CONFIRMADA (regla del dueño 2026-11-11) |

## 7. Dividir la cuenta: ¿comparte tablas con esta pieza?

- **Tablas de Pedernal:** la migración 0051 (porciones) solo toca `producto`. La 0052 (tope de partes, 4 → 12) toca `division_de_cuenta` y `parte_de_division`. **No comparten tablas.**
- **Lo que sí comparten, de forma indirecta (P/D):** la línea de la cuenta (`linea_cuenta.cantidad`), que al dividir **por unidades** se reparte en copias que deben sumar la cantidad de la origen (`copias_cuadran`, 0038); con fracciones y peso esa suma es decimal, no entera. Y una advertencia de la documentación: con fracciones o peso la suma de los tickets de las cuentas hijas puede diferir en centavos de lo que mostraba la mesa, porque cada hija redondea su grupo (D, ficha «dividir la cuenta», pregunta abierta 2).
- **Motor2:** dividir la cuenta **no existe** (`docs/diseno-ventas-salon-y-mostrador-2026-10-26.md:194` lo deja afuera; el plan de paridad dice «no aplica hoy»). Por eso no hay nada que adaptar acá; si se construye, hereda los topes de Pedernal (10 cuentas por ítems, 12 partes por porcentaje; dueño 2026-11-14) y tendrá que definir el reparto del centavo con cantidades fraccionarias.

## 8. Esquema PROPUESTO (nivel 6) — «no se migra hasta confirmar niveles 1 a 5»

> Este esquema no se aplica ni se escribe como migración hasta que el dueño ratifique la etapa y responda Q1 a Q3. Toda migración será **aditiva** y con `down.sql`, y aplicarla en una base real sigue congelado.

**Etapas, de la más barata a la más cara (primero la opción más barata):**

| Etapa | Qué | Migración | Costo |
|---|---|---|---|
| **E0** | Reglas puras (conjuntos, paso derivado, múltiplo exacto con enteros), texto de papel «1/2», **oráculo de combinaciones** y su test. Nada se guarda | ninguna | chico |
| **E1** | Columna con las fracciones ofrecidas + caso de uso «cambiar la forma de venta» + pantalla «Cómo se vende» (sin botones de venta) | 1, aditiva | mediano |
| **E2** | Perilla | 1, aditiva (o ninguna, ver Q2) | chico |
| **E3** | Congelar el paso en la línea vendida | 1, aditiva | chico |
| **E4** | Podar el campo «Paso de venta» libre (interruptor reversible primero, borrado después, con aviso) | ninguna | chico |

**E1 — `Producto.porcionesOfrecidas`** (equivale a la 0051 de Pedernal):

```sql
-- up (esquema: Prisma `Int[] @default([]) @db.SmallInt`; NO VERIFICADO que `prisma migrate diff` lo genere idéntico: se escribe a mano como las demás)
ALTER TABLE "Producto" ADD COLUMN "porcionesOfrecidas" SMALLINT[] NOT NULL DEFAULT '{}';
ALTER TABLE "Producto" ADD CONSTRAINT "Producto_porciones_chk" CHECK (
  "porcionesOfrecidas" IN ('{}'::smallint[], '{2}', '{4}', '{8}', '{2,4}', '{2,8}', '{4,8}', '{2,4,8}')
  AND (cardinality("porcionesOfrecidas") = 0
       OR ("pasoVenta" = 1::numeric / "porcionesOfrecidas"[cardinality("porcionesOfrecidas")]
           AND "tipo" = 'PV')));

-- down.sql (frena si ya hay productos con fracciones, como el down de Pedernal)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM "Producto" WHERE cardinality("porcionesOfrecidas") > 0) THEN
    RAISE EXCEPTION 'hay productos con fracciones ofrecidas: revertir las perdería' USING ERRCODE = '55000';
  END IF;
END $$;
ALTER TABLE "Producto" DROP CONSTRAINT "Producto_porciones_chk";
ALTER TABLE "Producto" DROP COLUMN "porcionesOfrecidas";
```

Por qué es compatible hacia atrás: columna con valor por defecto (`'{}'` = sin fracciones, como todo producto de hoy); el CHECK lo cumplen todas las filas existentes (lista vacía); sin relleno; el código anterior no la lee ni la escribe. **Diferencia con Pedernal, con motivo:** Pedernal también exige en el CHECK que la unidad de venta sea la de stock y de conteo; en Motor2 la magnitud vive en la tabla `Unidad` y un CHECK no puede mirar otra tabla, por lo que esa parte se valida en el servidor y (PROPUESTA, etapa posterior) con un disparador. Los privilegios y las políticas por empresa de `Producto` cubren la columna nueva: NO VERIFICADO, se comprueba al implementar.

**E2 — la perilla** (según Q2): `Empresa."vendeConFraccionesYPeso" BOOLEAN NOT NULL DEFAULT false`, que solo cambia la plataforma (mismo guardián que `permisosEditables`); `down.sql` la quita. El nombre exacto queda para el momento de construir.

**E3 — paso congelado en la línea:** `CuentaItem."pasoDeCantidad" DECIMAL(14,4) NULL` con `CHECK (… IS NULL OR … > 0)`; nulo = línea anterior (se usa el paso vigente, como hoy). El espejo de anulación lo repite del original, como ya hace con `nombreEnTicket` (`escribir-espejo-de-item.ts`). `down.sql` es destructivo si hay líneas con paso: aborta si encuentra alguna. La unidad no se congela porque no hay unidad de venta aparte (Q3).

**Lo que NO se crea:** ninguna tabla nueva; ninguna tabla de unidades de venta; ninguna columna de «tercios».

## 9. Atomicidad y concurrencia (nivel 7)

- **Cambiar la forma (CU1 a CU3)** es una sola transacción: bloquear el producto (`FOR UPDATE`), comparar `versionEsperada`, validar, escribir paso y fracciones **juntos**, auditar. O se hace todo o nada. Control de versión (optimistic locking): dos personas que cambian la forma a la vez → una gana y la otra recibe «versión desactualizada» sin escribir. Hoy `Producto` no tiene columna de versión: NO VERIFICADO cómo lo resuelve `actualizarProducto`; el diseño del caso de uso lo define (decisión técnica T3).
- **Vender (CU4)** corre en la transacción de agregar ítems, que ya es serializable (V). Lo que se valida contra el producto (paso, fracciones) se lee dentro de la misma transacción; si otra persona cambia la forma en el medio, la serialización reintenta o falla cerrada, nunca vende con una forma a medias.
- **Anular parte (CU5)** valida contra el paso de la línea (E3) o, mientras no exista, contra los decimales de la cantidad ya vendida (T2).
- **Idempotencia:** repetir el mismo cambio de forma devuelve «sin cambios» y no sube la versión ni escribe auditoría (como Pedernal); agregar un ítem ya usa clave de operación del pedido (V, patrón vigente de agregar ítems).

**Tabla «¿qué pasa si…?»**

| Situación | Cambiar la forma (CU1–3) | Vender (CU4) | Anular parte (CU5) | Perilla (CU7) |
|---|---|---|---|---|
| **Repetición** (doble clic, reintento) | Segunda vez = «sin cambios», no escribe | La clave de operación impide duplicar la línea | El espejo ya anulado no se vuelve a crear; la cantidad anulada no puede superar lo vigente | Igual valor = sin cambios |
| **Concurrencia** | `FOR UPDATE` + versión: una gana, la otra recibe conflicto | Transacción serializable: reintenta o falla cerrada | La fila original se toma `FOR UPDATE`; dos anulaciones sumadas no pasan lo vigente | Último cambio gana; queda auditado |
| **Tiempo** (el paso cambia entre la venta y la anulación) | Lo vendido no cambia (I10) | Se valida con la forma al momento de agregar | Valida contra el paso congelado (E3); hasta entonces T2 evita el trabado | Apagar no corta la venta de lo cargado (I7) |
| **Incertidumbre** (no se sabe si llegó) | Se vuelve a pedir: es idempotente | Se vuelve a pedir con la misma clave | Ídem | Ídem |
| **Reintento** | Seguro por idempotencia | Seguro por clave | Seguro | Seguro |
| **Error parcial** | Nada queda a medias: una transacción | Se agregan todos los ítems o ninguno (V) | Una transacción | — |
| **Datos faltantes** | Producto sin unidad de masa para peso, sin paso para peso, que no es PV, o con unidad que no es de conteo para fracciones → rechazo con motivo | Producto sin precio → «precio abierto»/rechazo según lo vigente (V) | Ítem inexistente → rechazo | Empresa inexistente → rechazo |
| **Cambio de permisos** (se quita `producto_editar` a mitad) | El permiso se verifica dentro de la transacción: sin permiso, rechazo | Se verifica al agregar; lo ya agregado queda | Se verifica al anular | Solo la plataforma |

## 10. Acceso e interfaces (nivel 8)

- **Pantalla:** «Cómo se vende» en la ficha del producto, con **Unidad**, **Fracciones** (se tildan ½, ¼, ⅛; nace sin ninguna tildada; tildar no tilda las otras), **Peso** (unidad de masa y paso). Los textos son los ya aprobados por el dueño para Pedernal (2026-11-14: «Cómo se vende», «Fracciones», «Peso», «Unidad de venta», «Paso mínimo», «Confirmar», «Sin precio»; «Porciones» confirmado el 12/11). Un paso que no cabe exacto no lleva texto propio: se marca el campo y Guardar queda apagado. **No se inventan textos.** Hoy el formulario de producto de Motor2 tiene un campo libre «Paso de venta (opcional)» con un párrafo largo; E4 lo poda.
- **Servidor:** un comando «cambiar forma de venta» con permiso `producto_editar`, empresa tomada de la sesión y nunca del navegador (I11).
- **Punto de venta:** sin pantalla nueva en esta pieza; el campo de cantidad sigue, con el mensaje «Se vende de a …» que ya existe (V).
- **Permisos:** ver §3. El operador de salón vende; no cambia la forma.

## 11. Consultas y experiencia (nivel 9)

- Ticket y comanda: una cantidad fraccionaria de un producto por unidad se escribe «1/2», «1/4», «1/8», «1 1/2»; un peso se escribe con coma y unidad («0,35 kg»). Un denominador que no es 2, 4 u 8 no se imprime como fracción: se escribe en decimal (no hay tercios).
- Listas y reportes: el producto muestra su forma («Unidad», «Fracciones ½ ⅛», «Peso por kg», «Heredada»). **Lo que falta se muestra «pendiente de completar», nunca se inventa.**
- Reportes de ventas: las cantidades fraccionarias se suman con exactitud decimal (4 decimales): NO VERIFICADO en los reportes existentes; se prueba en la combinación de §12.

## 12. Pruebas, combinaciones, migración y operación (nivel 10)

**Dimensiones cuyas combinaciones cambian dinero, permisos, visibilidad o stock** (a declarar en el guardián; una dimensión nueva sin declarar hace fallar el test):
forma (UNIDAD / FRACCIONES × 7 conjuntos / PESO / HEREDADA) × cantidad pedida (entera / fracción del paso / fuera del paso / ≤ 0 / > tope) × unidad de stock (CANTIDAD / PESO / VOLUMEN) × tipo (PV / MP) × «se produce» × modo de venta (DIRECTO / BASE_CONFIGURABLE) × precio (de lista / local de sucursal / con descuento de producto / componente de promo / con recargo de opción) × canal (mesa / mostrador) × perilla (encendida / apagada) × permiso (con / sin) × anulación (ninguna / parcial / total).

**Oráculo escrito aparte del código** (cada fila es una regla esperada; el test recorre las combinaciones contra esta tabla; son pocas dimensiones por regla, por eso exhaustivo donde son pocas y con `fast-check` — ya está en el proyecto — para cantidades):

| # | Combinación | Resultado esperado |
|---|---|---|
| O1 | FRACCIONES {2}, cantidad 0,5 / 1 / 1,5 | válida |
| O2 | FRACCIONES {2}, cantidad 0,25 | rechazada (no múltiplo de 0,5) |
| O3 | FRACCIONES {2,8}, cantidad 0,125 / 0,25 / 0,625 | válidas (múltiplos de 0,125) |
| O4 | FRACCIONES {2,8}, cantidad 0,3 | rechazada |
| O5 | PESO paso 0,001, cantidad 0,350 | válida; 0,3504 → rechazada (nunca redondea) |
| O6 | cualquier forma, cantidad ≤ 0 o > tope | rechazada |
| O7 | precio 1000,00, cantidad 0,125 | importe 125,00 |
| O8 | precio 333,33, cantidad 0,125 | 41,66625 → **41,67** (mitad hacia afuera del cero, un solo redondeo) |
| O9 | precio por kg 28000,00, cantidad 0,350 | 9800,00 |
| O10 | precio 9999,99, cantidad 0,001 | 9,99999 → **10,00** |
| O11 | descuento de producto 10 % sobre 1000,00 (unitario 900,00), cantidad 0,5 | 450,00 (el unitario se redondea primero; **NO VERIFICADO** el redondeo de `precioConDescuento`: el oráculo lo fija) |
| O12 | receta con 1 unidad de insumo (unidad de 0 decimales), dos ventas de 0,5 | consumo total 1 (no 2): arrastre de redondeo |
| O13 | FRACCIONES en un componente de promo | rechazada (I13) |
| O14 | PESO con opción que consume insumo | rechazada (I14) |
| O15 | perilla apagada, cargar FRACCIONES o PESO | rechazada, no escribe |
| O16 | perilla apagada, vender un producto ya en FRACCIONES | permitido (I7) |
| O17 | fracciones en un producto cuya unidad de stock no es de conteo, o que no es PV | rechazada |
| O18 | repetir el mismo cambio de forma (aunque las fracciones lleguen en otro orden) | «sin cambios»: no escribe, no sube versión |
| O19 | anular ⅛ de un ítem vendido con paso 0,125 después de pasar el producto a {2} | permitida (valida contra lo congelado, no contra lo vigente) |
| O20 | papel: 0,5 en FRACCIONES / 0,35 en PESO kg / 1,5 en FRACCIONES | «1/2» / «0,35 kg» / «1 1/2» |

**Pruebas obligatorias (preferencias del dueño):** unitarias de las reglas puras; **concurrencia** (dos cambios de forma simultáneos sobre la misma versión: uno gana, el otro recibe conflicto; dos anulaciones simultáneas sobre un mismo ítem: no superan lo vigente); **idempotencia** (mismo cambio dos veces; mismo agregado dos veces); permisos (sin `producto_editar`); aislamiento (otra empresa no ve ni cambia); la base impone los CHECK aunque el código se olvide; migración arriba y abajo con datos reales de prueba (el `down.sql` frena si hay datos). Gate completo antes de cerrar cada etapa: `npx tsc --noEmit`, `npm run lint`, `npm run arquitectura`, `npm run analizar:muerto`, `npm test`, `npm run build`, `npm run plataforma:build`, `npm run test:e2e`.

**Migración y operación:** migraciones aditivas, reversibles, con `down.sql`; aplicar en una base real sigue congelado hasta orden del dueño (checklist de deploy). **Aviso previo a cualquier cambio destructivo:** ninguna de las etapas lo es; la única que lo sería (pasar pasos libres a fracciones, Q1 opción B) reescribe datos y **no** entra en la autorización permanente.

**Qué ve el dueño sin leer código (para después de construir):** (1) en un producto de pizza, tildar ½ y ⅛ y guardar; la venta acepta 0,125 y 0,5 y rechaza 0,3; (2) apretar «Guardar» dos veces seguidas: la segunda dice que no hubo cambios; (3) abrir el mismo producto en dos pestañas y guardar distinto en cada una: una guarda, la otra avisa que cambió; (4) vender media pizza, enviarla a cocina, cambiar las fracciones del producto y anular la media: se puede.

## 13. Preguntas de NEGOCIO abiertas (solo las que cambian modelo de datos, dinero o permisos)

**Q1 — Los pasos libres que ya existen.** Si algún producto de una base real tiene hoy un paso de venta que no sale de 2, 4 u 8 (por ejemplo 0,2 o 0,1), o es de unidad de masa sin paso: ¿qué pasa con él?
- **A (recomendada):** queda como está, marcado «Heredada»; no se puede volver a elegir; se puede cambiar a Unidad, Fracciones o Peso cuando se quiera. No reescribe datos.
- B: se pasa a la fracción más parecida. Reescribe datos: no entra en la autorización permanente; pide ensayo y orden expresa por base.
- C: los pasos libres siguen pudiendo cargarse (no es «igual a Pedernal»).
- *Si no se responde:* A. (Antes, el dueño o la plataforma pueden mirar en solo lectura cuántos productos tienen paso: NO VERIFICADO, hoy lo ignoro.)

**Q2 — La perilla frena lo que ya se puede hacer hoy?** Pedernal tiene la perilla apagada por defecto. Motor2 hoy ya permite cargar un paso libre sin perilla.
- **A (recomendada):** la perilla (`Empresa`, solo la plataforma) rige únicamente la forma nueva (Fracciones y Peso); el paso libre que existe sigue funcionando hasta que E4 lo retire, para no romper a nadie.
- B: la perilla rige también el paso libre (cortaría lo que hoy se puede hacer).
- C: sin perilla: siempre habilitado (no es «apagada por defecto» como pidió el dueño; se declararía con el motivo «Motor2 no tiene planes»).
- *Si no se responde:* A, con la perilla apagada.

**Q3 — Un producto por peso, ¿se vende siempre en la unidad en que se guarda su stock?** En Pedernal el producto puede venderse en una unidad distinta de la base (kilo vs gramo) y el sistema convierte los precios.
- **A (recomendada, la más barata):** sí: unidad de venta = unidad de stock; el precio es «por esa unidad»; no hay conversión de precios (no se crea ninguna columna de unidad de venta).
- B: no: se agrega unidad de venta aparte (columna en el producto y en cada precio, conversión exacta y «precio abierto» cuando no convierte). Es una etapa grande, ligada a las 14 unidades fijas (E2 del plan de paridad).
- *Si no se responde:* A.

## 14. Decisiones técnicas (del ingeniero; el dueño no necesita decidirlas)

| # | Decisión | Motivo |
|---|---|---|
| T1 | La validación de «múltiplo del paso» pasa a enteros (cantidad y paso × 10 000), sin tolerancia de coma flotante | I5 e I8; para ½, ¼ y ⅛ ya era exacto, para pesos no |
| T2 | Mientras no exista E3, anular parte valida la cantidad anulada contra la **escala de la cantidad vendida** (no contra el paso vigente) | evita el ítem trabado (hallazgo 2) con el cambio más chico |
| T3 | El caso de uso de cambiar forma usa `FOR UPDATE` + comparación de versión (o `updatedAt`) igual que los demás casos de uso del catálogo; si `Producto` no tiene versión se define cuál | concurrencia (regla del proyecto); NO VERIFICADO el mecanismo actual |
| T4 | La forma «Peso» exige paso explícito; los productos de masa sin paso quedan HEREDADA | I5, sin redondeo silencioso; sin reescribir datos |
| T5 | Los textos del papel «1/2» van en una función pura con denominadores 2, 4, 8 | resultado igual al de Pedernal (D: decisión 181) |
| T6 | La magnitud de la unidad (conteo) se valida en el servidor y luego con un disparador | un CHECK no puede mirar otra tabla (Prisma/estructura) |
| T7 | Tope por ítem 999: se revisa para peso en gramos; no se cambia sin pedido | «lo que el dueño no pidió no entra» |
| T8 | La columna nueva `porcionesOfrecidas` se declara en el oráculo de columnas de «Duplicar producto» (`COLUMNAS_DEL_DUPLICADO`, `src/core/catalogo/duplicar-producto.ts`) como `SE_COPIA`, **junto con** `pasoVenta` (que ya se copia): el CHECK exige que el paso salga de las fracciones | el guardián existente (`test/catalogo/duplicar-producto-columnas.test.ts`) falla si una columna de `Producto` no está declarada |

## 15. Diferencias con Pedernal, declaradas

| Diferencia | Motivo | Estado |
|---|---|---|
| Motor2 conserva «1 ÷ paso es entero» en el peso | Es la regla vigente desde 2026-09-26 (plan de venta fraccionada); no se endurece ni afloja sin pedido. Pedernal no la tiene (P) | PROPUESTA; el dueño la corrige |
| El stock de una receta fraccionada usa arrastre de redondeo | Ya construido (Task #27) y probado; su resultado total coincide con el exacto | PROPUESTA |
| El CHECK no exige unidad de conteo | La unidad vive en otra tabla (T6) | impuesta por estructura |
| Sin unidad de venta aparte | Q3 (recomendación A) y «Motor2 no tiene planes, es solo 1 empresa» | PENDIENTE (Q3) |
| La perilla es una columna de empresa, no de plan | No hay planes en Motor2 (dueño, 2026-11-14, relatado) | PENDIENTE (Q2) |
| Sin botones de fracción en el punto de venta | No pedido para Motor2 | PROPUESTA |

## 16. Límites honestos

- No leí ninguna base real: **NO VERIFICADO** cuántos productos tienen paso hoy y de qué valor.
- No ejecuté Motor2 ni Pedernal: todo sale de leer código y documentos.
- Pedernal: leí la migración 0051 y el caso de uso `cambiarFormaDeVenta` (`243432a`); no corrí sus pruebas.
- Los números de los ejemplos (precios, cantidades) son inventados para el oráculo; no son datos de ningún cliente.
