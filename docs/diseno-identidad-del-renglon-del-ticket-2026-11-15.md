# Diseño: identidad del renglón del ticket (renglón congelado), igual a Pedernal (2026-11-15)

Estado: **diseño en papel. Sin código, sin migraciones, sin tocar ninguna base.** **Ninguna migración tiene autorización expresa.** Niveles 1 a 5 con sus estados; el nivel 6 va **solo como esquema propuesto, marcado «PROPUESTA, no se migra hasta confirmar niveles 1 a 5»**.

Es la etapa previa de la factura externa por renglón o cantidad (`docs/diseno-factura-externa-n1-n2-2026-11-15.md`) y desarrolla las decisiones técnicas DT1 a DT11 de la sección «Alcance de la primera conciliación…» del plan (`motor2-docs`, `_planes/plan-de-paridad-con-pedernal-2026-11-14.md`). Se diseña **junto con el camino de clasificación en el renglón** (E4, Pedernal 0047; `docs/diseno-clasificacion-comercial-igual-a-pedernal-2026-11-13.md` §7.3), como pide DT7.

Estados: **CONFIRMADA** (dicha por el dueño, con cita y fecha), **PROPUESTA**, **PENDIENTE**, **NO VERIFICADA**. Marcas: **(V)** verificado en el código; **(DOC)** solo de un documento.

Fotos: Motor2 `origin/main` `a7077f52` (2026-11-15). Pedernal: código `ZuluHub-ERP` `7f3931be` (2026-11-14 23:28 -03:00), documentos `ZuluHub-docs` `82b99179` (2026-11-15 00:38 UTC). Redacción genérica (repositorio público): sin nombres de sucursales, cifras ni identificadores de bases.

## Para el dueño, en diez líneas

1. Para facturar «2 de 4 unidades» de un renglón del ticket, el sistema tiene que **saber cuál es cada renglón** y recordar **cuánto se vendió de él cuando se emitió el ticket**. Hoy el ticket se **vuelve a armar cada vez** a partir de los ítems; no hay un renglón guardado.
2. Propuesta: al cerrar la cuenta (y al emitir un ticket corregido) se **guarda una foto** de los renglones del ticket: cuál es, cuántas unidades y cuánto importe. Esa foto no se edita nunca. Es lo mismo que hace Pedernal.
3. Lo bueno: **no hace falta inventar una identidad**. Motor2 ya tiene el «renglón corregible» (lo que hoy se corrige o anula de una cuenta cerrada). Ese renglón ya conserva su identidad cuando se corrige por unidades. Se reusa.
4. Un combo o promo es **un solo renglón** (no se factura un componente suelto), como decidiste para Pedernal. Un renglón con adicionales también se propone entero (pregunta 2).
5. **Solo salón y cuentas** (decisión tuya del 2026-11-15). El mostrador queda afuera.
6. **Solo hacia adelante**: los tickets ya cerrados no se tocan. Una pregunta tuya: ¿entran igual a la conciliación? (pregunta 1).
7. El camino de clasificación (departamento y categorías) **queda en el ítem vendido**, como en Pedernal; el renglón congelado no lo copia. Una sola decisión para las dos cosas.
8. Costo: **una tabla nueva** (solo se agrega) y **una columna opcional** en el ejemplar del ticket. Ninguna autorizada todavía.
9. Efecto en lo que ya existe: corregir o anular una línea de una cuenta cerrada tendrá que respetar lo ya facturado (cuando exista la factura externa). Hoy no hay nada facturado, así que **hoy no cambia nada de lo que ves**.
10. Dos preguntas de negocio al final.

---

## 0. Decisiones del dueño que usa este diseño

| # | Fecha | Texto literal | Fuente | Qué fija | Estado |
|---|---|---|---|---|---|
| R-1 | 2026-11-15 | «Por renglón o cantidad también en la externa» | `motor2-docs`, `seguimiento-de-pedernal/decisiones-del-dueno-2026-11-14-mesa-resend-contador.md`, sección «Partes por renglón o cantidad en la factura externa» | La factura externa factura por renglón o cantidad desde el principio, con tope «facturado ≤ vendido» | **CONFIRMADA** (opción no recomendada, elegida por el dueño) |
| R-2 | 2026-11-15 | «Solo lo que tiene ticket (salón y cuentas) (Recomendada)» | mismo archivo, sección «Mostrador en la conciliación de la factura externa» | La identidad del renglón y la primera conciliación cubren salón y cuentas; el mostrador queda para después si lo pide | **CONFIRMADA** |
| R-3 | 2026-11-15 | «Revisa pedernal» (a «¿facturar por partes como lo DECIDIDO en Pedernal o ticket entero como lo CONSTRUIDO?») | mismo archivo, sección «Facturar un ticket: partes y antes de cobrar» | Motor2 sigue lo que Pedernal tiene **decidido** por el dueño. La lectura del orquestador («partes como lo decidido») quedó **a confirmar**; R-1 la confirma para la factura externa | **CONFIRMADA** en lo que cubre R-1 |
| R-4 | 2026-11-13 | «Necesitamos ser iguales en todo. Por la salvedad de que nosotros usamos Prisma… el resultado tiene que ser el mismo y sobre todo de las mismas formas» | `AGENTS.md` | Paridad con Pedernal; toda diferencia lleva motivo | **CONFIRMADA** |
| R-5 | 2026-11-15 | «Sí, copiar a Pedernal en esas cinco (Recomendada)» | mismo archivo de decisiones, sección «Factura externa: campos, tipos, nota de crédito parcial y ratificación en bloque» | E4 (árbol de 4 niveles) y E5 (lo nuevo nace con uuid, `timestamptz` y solo inserción) se copian de Pedernal | **CONFIRMADA en dirección**; ninguna migración autorizada |
| R-6 | 2026-11-14 | «es un caso de uso y la app no lo debe determinar» (facturar por partes) — cita de Pedernal, fila 134 de `decisiones-del-dueno-2026-11.md` | `ZuluHub-docs` | En Pedernal la partición la decide quien factura, no una regla de la aplicación | **DOC** (decisión del dueño tomada para Pedernal; para Motor2 vale como referencia de la regla de paridad) |
| — | — | Autorización de la migración de esta etapa | — | — | **PENDIENTE** (no existe) |

---

## 1. Inventario: lo que Motor2 ya tiene con otro nombre (validado contra el código)

| Pieza de Pedernal | Equivalente real en Motor2 hoy | Evidencia |
|---|---|---|
| `linea_cuenta` (la línea congelada de la cuenta, con camino 0047) | `CuentaItem`: cantidad, precio congelado, promo de la que es componente, huella de opciones, línea padre (adicionales), filas espejo de anulación (`anulaAItemId`). Su `id` **no cambia** | (V) `prisma/schema.prisma:2388` |
| `ticket_ejemplar` (original / corrección / anulación, con total) | `EjemplarTicket`: solo número, ejemplar (1 = A, 2 = B…), quién emitió, `corrigeAId` (siempre al A) y motivo. **Sin total y sin líneas** | (V) `schema.prisma:2457` |
| `ejemplar_linea` (renglón del ticket: cantidad e importe congelados, clave `linea_cuenta_id`) | **No existe.** El contenido del ticket es **derivado**: `armarTicket` vuelve a agrupar los ítems cada vez | (V) `src/core/pos/ticket.ts` (encabezado y `armarTicket`) |
| Corrección de ticket (nuevo ejemplar con renglones menores) | `emitirTicketCorregidoEnTx`: emite el ejemplar siguiente con `corrigeAId` al A, reflejando las anulaciones vigentes; `corregirLineaDeTicket` anula la venta de la línea **y** emite el ticket en una sola transacción | (V) `src/server/actions/pos/casos-de-uso/emitir-ticket-corregido.ts`, `corregir-linea-de-ticket.ts` |
| Identidad de un renglón que sobrevive a la corrección | **La Operación VENTA original** de la línea: los ítems siguen apuntando a ella (`CuentaItem.operacionId`) y una corrección por unidades crea una venta B que la reemplaza (`Operacion.reemplazaAOperacionId`, único), luego C… La original conserva su id | (V) `schema.prisma:1227-1259`; `src/core/pos/ticket.ts:105-122` (`VersionDeVenta`) |
| «Línea corregible» | `lineasCorregibles`: **una por Operación VENTA** (agrupa los ítems originales y sus espejos) con sus adicionales dentro; **una promo es una sola línea** | (V) `src/core/pos/ticket.ts` (`lineasCorregibles`) |
| Cantidad parcial válida (múltiplo del paso) | `porUnidades`: se corrige por unidades solo una línea **sin promo, sin adicionales, con cantidad entera ≥ 2**; la promo y la línea con adicionales se corrigen enteras | (V) mismo archivo |
| Importe por renglón con reparto del centavo (`prorratear`) | El total del ticket **ya es la suma de los subtotales netos por línea**, cada uno redondeado (cada `Operacion` VENTA registra ese importe); «coincide centavo a centavo con lo registrado» | (V) `ticket.ts`, comentario de `armarTicket`; `importeDeLinea`, `redondearMoneda` |
| Descuentos, promos, combos y adicionales en el renglón | Existen en Motor2 (descuento de cliente congelado en `Cuenta.descuentoPorcentaje`, `PromoCuenta`, adicionales con `lineaPadreId`, descuento de producto) y **no** existen en el módulo de ventas de Pedernal | (V) `schema.prisma` (`Cuenta`, `PromoCuenta`, `CuentaItem`); informe de Pedernal: «No hay descuentos, promos ni combos en el módulo ventas» |
| Camino de clasificación (0047) en `linea_cuenta` | **No existe**; propuesto en el diseño de clasificación (E3): dos columnas opcionales en `CuentaItem` | (V) grep en `prisma/`: sin columnas; (DOC) `docs/diseno-clasificacion-comercial-igual-a-pedernal-2026-11-13.md` §7.3 |
| `venta` cabecera | `Venta` con `importeTotal`; `Venta.cuentaId` solo existe en mesa | (V) `schema.prisma:2724` |

**Qué hace Pedernal (verificado en `7f3931be`).** `ejemplar_linea` tiene seis columnas, todas obligatorias: `empresa_id`, `ejemplar_id`, `grupo_orden`, `linea_cuenta_id`, `cantidad numeric(18,4)` (`> 0 y ≤ 9999`) e `importe numeric(18,2)` (`≥ 0`). Clave `(empresa, ejemplar, linea_cuenta)`. Solo inserción por disparador (aun para el dueño de la base); solo `INSERT` por columna para la aplicación; RLS forzada. Un disparador **diferido** exige que la suma de los renglones sea el total del grupo y la de los grupos el total del ejemplar; que el ejemplar **original refleje todas las líneas vigentes** con su cantidad completa; y que cada renglón sea de una línea de la cuenta, con cantidad ≤ la de la línea y múltiplo de su paso. Un ejemplar de corrección **reinserta el mismo `linea_cuenta_id`** con menos cantidad. Los renglones solo entran en la transacción de su ejemplar. El camino de clasificación **no** se copia al renglón: vive en `linea_cuenta` (dos columnas: `departamento_id` y un arreglo `camino_de_clasificacion`, inmutables). El «grupo» por emisor (siempre `orden = 1`) **no se necesita** en la factura externa.
**Importante (verificado): la corrección de un ticket NO está construida en Pedernal.** Solo se inserta el tipo `ANULACION`; `CORRECCION` existe en el CHECK pero ningún caso de uso lo escribe. Las tablas de partes (`renglon_facturado`, `renglon_de_documento`, `acreditacion_de_renglon`) **no existen**: es solo diseño. La referencia para «corregir un ticket facturado en partes» es, entonces, la **decisión** (P6) y no un código que copiar.

---

## 2. Escalera de diseño

### Nivel 1. Propósito y alcance — PROPUESTA (necesidad CONFIRMADA por R-1)

- **Necesidad:** poder aplicar una factura externa a **renglones o cantidades** de un ticket con tope «facturado ≤ vendido» (dueño, 2026-11-15, R-1). Eso exige conocer, por cada ticket emitido, **qué renglones tiene y cuánto vendió de cada uno** (hecho verificado: hoy no hay renglones guardados).
- **Propósito:** guardar, cuando se emite un ejemplar de ticket, la foto inmutable de sus renglones (identidad, cantidad, importe).
- **Entra:** la tabla de renglones del ejemplar; la columna de total del ejemplar para el cuadre; los dos puntos donde nace un ejemplar (cerrar la cuenta y emitir el ticket corregido); la lectura de los renglones del ticket.
- **No entra** (cada punto con su motivo): el acumulado «facturado» y el tope (etapa FE-N2, documento aparte); el camino de clasificación (lo trae E4, se queda en el ítem; ver DT7); el mostrador (R-2); reconstruir tickets cerrados (DT4, pregunta 1); pantalla nueva alguna (el ticket impreso no cambia); cuenta hija o cobro.
- **Primero lo más barato:** reusar la identidad que ya existe (la Operación original / la promo) en lugar de inventar una; una sola tabla nueva.

### Nivel 2. Actores y contexto — PROPUESTA

| Actor | Qué hace | Estado |
|---|---|---|
| El sistema (al cerrar la cuenta y al emitir el ticket corregido) | Escribe los renglones del ejemplar, dentro de la misma transacción que hoy ya escribe el ejemplar | PROPUESTA |
| Quien cierra la cuenta o corrige el ticket (mozo, administración) | **No ve ni hace nada distinto** | PROPUESTA |
| Administración (FE-N2) | Lee los renglones para aplicar facturas externas | CONFIRMADA la necesidad (R-1); el permiso es el de la conciliación |

Alcance: la **sucursal** (el ticket es de la sucursal de su cuenta; RLS por sucursal como `EjemplarTicket`). Zona horaria Argentina; las fechas del renglón no se editan.

### Nivel 3. Casos de uso — PROPUESTA

| CU | Caso | Disparador |
|---|---|---|
| CR1 | Congelar los renglones del ejemplar 1 (A) al cerrar la cuenta | `cerrarCuenta` |
| CR2 | Congelar los renglones del ejemplar siguiente (B, C…) al emitir el ticket corregido | `emitirTicketCorregidoEnTx` (que ya usan `corregirLineaDeTicket`, `quitarUnidadesDeLinea` y la emisión directa) |
| CR3 | Leer los renglones vigentes de un ticket (el del último ejemplar) | Lo usa FE-N2 |
| — | Reconstruir los renglones de tickets ya cerrados | **No entra** (DT4; pregunta 1) |

### Nivel 4. Conceptos y ciclo de vida — PROPUESTA (salvo lo citado)

- **Renglón del ticket (renglón de ejemplar):** una línea del ticket tal como quedó en **un** ejemplar: *a qué línea corresponde*, *cuántas unidades* e *importe*. Solo se agrega; nunca cambia ni se borra.
- **Identidad del renglón (DT1, DT2):** es **la línea corregible** que Motor2 ya tiene. Dos formas, exactamente una por renglón:
  - un **renglón simple** se identifica por la **Operación VENTA original** de su línea (la «A» de la cadena de versiones). Reúne sus ítems, sus espejos de anulación y sus adicionales;
  - un **renglón de promo** se identifica por su `PromoCuenta` (un combo es **un** renglón, de **cantidad 1**; dos menús iguales son dos `PromoCuenta` y por lo tanto dos renglones). Un componente suelto **no** es un renglón.
- **Cantidad e importe congelados:** en cada ejemplar, la cantidad vigente de la línea en ese instante (la de la versión de venta que regía) y su subtotal neto (con el descuento de cliente y el de producto ya aplicados, redondeado por línea), que es lo que hoy imprime el ticket.
- **Divisibilidad (DT8):** un renglón se puede facturar **por cantidad** solo si es **simple, sin adicionales y de cantidad entera ≥ 2**: la misma condición que hoy autoriza corregir por unidades (`porUnidades`). Los demás (promo, con adicionales, cantidad fraccionaria o de 1 unidad) **solo enteros**. Es la forma cerrada: más adelante se podría abrir la cantidad fraccionaria (peso), aditivo.
- **Ciclo de vida:** el ejemplar nace con sus renglones y no cambia. Un ticket tiene **uno o más ejemplares**; el que rige es el último emitido. **«Vendido» de un renglón = su cantidad en el último ejemplar.** Si una línea se anuló y todavía no se emitió el ejemplar corregido, el ticket está **desactualizado** (`estadoDeTicket`): ver DT12.
- **Mostrador:** fuera de alcance (R-2). `EjemplarTicket.cuentaId` es obligatorio y el mostrador no tiene ticket numerado: no se diseña.
- **Tickets ya cerrados:** sin renglones guardados = «pendiente de completar» (DT4).

### Nivel 5. Invariantes y políticas — PROPUESTA (las que copian a Pedernal heredan su dirección, R-4)

| # | Regla | Dónde se sostiene | Estado |
|---|---|---|---|
| I-1 | Los renglones **solo se agregan**: sin UPDATE ni DELETE, aun para el dueño de la base | Disparador de solo inserción + sin permiso de UPDATE/DELETE al rol de la aplicación (igual que Pedernal) | PROPUESTA |
| I-2 | Los renglones de un ejemplar **solo entran en la transacción que crea ese ejemplar** | Disparador (igual que Pedernal, `ejemplar_hijo_validar_alta`) | PROPUESTA |
| I-3 | Un renglón es **de una línea de la cuenta de ese ticket** (mismo `cuentaId`) y de **su** empresa y sucursal | FK compuestas | PROPUESTA |
| I-4 | Un renglón por línea y por ejemplar | Únicos `(ejemplar, operación)` y `(ejemplar, promo)` | PROPUESTA |
| I-5 | Exactamente una identidad: operación original **o** promo | CHECK | PROPUESTA |
| I-6 | `cantidad > 0`; `importe ≥ 0`; dinero en decimal exacto (`DECIMAL(14,2)`, cantidad `DECIMAL(14,4)` como `CuentaItem`) | CHECK | PROPUESTA |
| I-7 | **Cuadre:** Σ importes de los renglones de un ejemplar = total de ese ejemplar | Disparador diferido (igual que Pedernal, `ejemplar_cuadra`) apoyado en la columna de total (DT13) | PROPUESTA |
| I-8 | **El ejemplar A refleja todas las líneas vigentes con su cantidad completa**; el B, solo las vigentes a su fecha con la cantidad de la versión que regía | Prueba de propiedad contra `armarTicketVigente` (que ya cuadra al centavo con lo registrado) + disparador diferido solo para la igualdad de totales | PROPUESTA |
| I-9 | **Lo que no está se muestra «pendiente de completar»**; no se inventa (regla del dueño) | Regla de lectura | CONFIRMADA (regla permanente) |
| I-10 | Todo se filtra por empresa y sucursal; el servidor valida quién pide | RLS + guardas | CONFIRMADA (regla permanente) |
| I-11 | Un renglón de promo tiene cantidad **1** y no se parte | CHECK `promo ⇒ cantidad = 1` | PROPUESTA (decisión P7 de Pedernal: combo indivisible) |

---

## 3. Decisiones técnicas DT1 a DT13 (con recomendación; no se le preguntan al dueño)

| # | Decisión | Opciones | Recomendación y motivo |
|---|---|---|---|
| DT1 | Identidad del renglón | (a) `CuentaItem.id`; (b) la Operación VENTA original; (c) renglón nuevo con id propio apuntando al ítem | **(b) con (c) como tabla del ejemplar.** Corrige la lectura del plan: la Operación **original** **no** cambia de id al corregir por unidades (la corrección crea una versión B que la reemplaza; los ítems siguen apuntando a la A). Un `CuentaItem` **no** es un renglón (varios ítems del mismo producto, precio, promo y huella forman **una** línea). Es la misma agrupación de `lineasCorregibles`, o sea la que el sistema ya corrige y anula |
| DT2 | Combos y promos | (a) un renglón por componente; (b) uno por promo | **(b)**: la identidad es la `PromoCuenta`; cantidad 1; indivisible (decisión P7 del dueño para Pedernal) |
| DT3 | Corregir un ticket ya facturado en partes | seguir P6 de Pedernal u otra | **Seguir P6** (decidida para Pedernal por el dueño el 2026-11-14): solo se baja lo todavía no facturado; lo ya facturado se acredita primero. Se traduce y no se vuelve a decidir. Hoy **no hay nada facturado**: la guarda se agrega con FE-N2 |
| DT4 | Tickets ya cerrados | reconstruir o no | **No en la migración** (solo hacia adelante). Pero el plan decía que reconstruir tiene «riesgo de ambigüedad»: **verificado que se puede derivar** (el contenido de un ejemplar se calcula con `armarTicketImpresoEn(ítems, emitidoEn)`; los ítems conservan `operacionId`). Se deja como **paso aparte opcional** que solo escribe un ticket cuando la reconstrucción **cuadra al centavo** con lo registrado y deja «pendiente de completar» el resto. Lo decide el dueño: pregunta 1 |
| DT5 | Forma de lo nuevo (E5) | `cuid`/`TIMESTAMP(3)` o forma de Pedernal | **Forma de Pedernal** (R-5): `id` uuid que manda la aplicación, `creadoEn timestamptz`, solo inserción. Las columnas que apuntan a tablas existentes (`EjemplarTicket`, `Operacion`, `PromoCuenta`: ids de texto) **mantienen el tipo de texto**; un `uuid` nuevo convive con ellas sin problema (se guarda como texto en esas referencias) |
| DT6 | Dónde se impone «facturado ≤ vendido» | CHECK con acumulado o SERIALIZABLE | **Acumulado con CHECK** (como el diseño de Pedernal), y SERIALIZABLE con reintento en el caso de uso. Es de FE-N2 (documento aparte); **este documento solo garantiza el «vendido»** |
| DT7 | Un solo diseño del renglón vendido con E4 | por separado o juntos | **Juntos, así:** el **camino de clasificación vive en el ítem vendido** (`CuentaItem`, equivalente de `linea_cuenta` de Pedernal), escrito al agregar el ítem y solo al insertar; el **renglón congelado no lo copia** (igual que Pedernal: `ejemplar_linea` no tiene camino). Dato a declarar: una línea con ítems de caminos distintos (se reclasificó el producto entre dos pedidos de la misma cuenta) → los reportes por clasificación se arman **por ítem**, no por renglón; el oráculo lo cubre. **Ninguna tabla se persiste dos veces** |
| DT8 | Cantidad parcial válida | entera o múltiplo de un paso | **Entera, solo en renglones simples sin adicionales con cantidad entera ≥ 2** (la regla `porUnidades` que ya tiene Motor2). Fracciones (peso) y todo lo demás: solo enteros. Motor2 no tiene paso de cantidad; no se inventa |
| DT9 | Anular el comprobante externo libera lo facturado | misma transacción o aparte | **Misma transacción** (es de FE-N2) |
| DT10 | Idempotencia de aplicar un comprobante | clave y huella | **Clave obligatoria + huella de renglones y cantidades** (es de FE-N2). Para CR1 y CR2 la idempotencia la da el ejemplar (`@@unique([cuentaId, ejemplar])`, `@@unique([sucursalId, numero, ejemplar])`): un reintento no duplica renglones porque la transacción completa se repite o se rechaza |
| DT11 | Anular un ticket con una aplicación vigente | permitido o rechazado | **Rechazado** hasta anular la aplicación (T0 de Pedernal, ya construido allá). Alcanza a los casos de uso que anulan o reemplazan ventas de una cuenta cerrada: `anularVenta`, `quitarUnidadesDeLinea`, `corregirLineaDeTicket` y `reemplazarVentaConMenosUnidades` (**NO VERIFICADO** que sean todos: el diseño de FE-N2 los inventaría con una búsqueda exhaustiva antes de construir) |
| DT12 (nueva) | ¿Cuánto es «vendido» si una venta se anuló y todavía no se emitió el ticket corregido? | (a) manda la venta; (b) manda el último ejemplar emitido | **(b), y se cierra:** mientras el ticket esté desactualizado **no se aplican facturas nuevas** («emití primero el ticket corregido»). Motivo: `corregirLineaDeTicket` y la emisión directa ya terminan siempre emitiendo ejemplar, pero `anularVenta` puede correr suelta y dejar el ticket desactualizado un rato |
| DT13 (nueva) | Total del ejemplar para el cuadre | (a) cuadre solo en la aplicación; (b) columna `importeTotal` nullable en `EjemplarTicket`, escrita al insertar | **(b):** aditiva, los ejemplares viejos quedan NULL («pendiente de completar»), y permite la red de seguridad en la base (I-7) que Pedernal tiene. Costo: tocar una tabla existente con una columna opcional |
| DT14 (nueva) | Diferencias de forma con Pedernal | — | Ver §4 |

---

## 4. Diferencias con Pedernal, con su motivo (regla del 2026-11-13)

| # | Pedernal | Motor2 con este diseño | Motivo |
|---|---|---|---|
| D-1 | Clave del renglón `(ejemplar, linea_cuenta)`, con `linea_cuenta` = ítem | Clave por ejemplar + **una de dos identidades** (operación original o promo) | **Datos existentes y producto existente:** en Motor2 varios ítems forman una línea y existen promos con componentes; Pedernal no tiene promos en ventas |
| D-2 | Importe de cada renglón por `prorratear` sobre el total redondeado una vez | Importe = subtotal neto de la línea, **redondeado por línea** | **Datos existentes:** Motor2 ya redondea por línea y su total ya es la suma (coincide al centavo con lo registrado). Cambiarlo sería tocar dinero ya cobrado |
| D-3 | `ejemplar_grupo` (grupo por emisor, `orden = 1`) | No existe | **No se necesita** en la factura externa (el grupo es para emisión por emisor) |
| D-4 | Tipo de ejemplar `ORIGINAL`/`CORRECCION`/`ANULACION` y total en el ejemplar | `EjemplarTicket` sin tipo; total propuesto como columna nueva (DT13) | **Datos existentes:** la tabla ya está en producción sin esas columnas; se agrega solo el total |
| D-5 | Camino de clasificación en `linea_cuenta`, uuid y `jsonb` | Camino en `CuentaItem` (E4); forma exacta de las columnas **NO VERIFICADA** hasta leer 0047 completa | **Prisma / nombre de la tabla** (E4 lo diseña) |
| D-6 | Clave primaria compuesta | `id` uuid de la aplicación + únicos compuestos | **Prisma** y la doble identidad |
| D-7 | Cantidad con `paso_de_cantidad` | Sin paso; regla `porUnidades` | **Producto existente:** Motor2 no tiene paso |
| D-8 | La corrección del ticket y las tablas de partes **no existen** en código | Se diseñan igual (decididas) | La regla manda copiar lo **decidido** donde el código aún no existe (R-3); declarado |

---

## 5. Nivel 6. Historia y persistencia — **PROPUESTA, no se migra hasta confirmar niveles 1 a 5**

Todo aditivo y con `down.sql`; sin `DELETE`; una migración por vez, con autorización expresa. Sello posterior a `20261112170000`.

**`RenglonDeEjemplar`** (nueva; propia de una sucursal)

| Columna | Tipo | Regla |
|---|---|---|
| `id` | uuid | lo manda la aplicación |
| `empresaId` | texto | default `app_empresa_actual()` |
| `ejemplarId` | texto | FK compuesta `(empresaId, ejemplarId)` → `EjemplarTicket` |
| `cuentaId` | texto | FK compuesta; **igual a la cuenta del ejemplar** (FK compuesta `(empresaId, cuentaId, ejemplarId)` o disparador) |
| `operacionOriginalId` | texto NULL | FK compuesta → `Operacion` (la VENTA «A» de la línea) |
| `promoCuentaId` | texto NULL | FK compuesta → `PromoCuenta` |
| `cantidad` | decimal(14,4) | CHECK `> 0`; CHECK `promoCuentaId IS NOT NULL ⇒ cantidad = 1` |
| `importe` | decimal(14,2) | CHECK `≥ 0` |
| `divisible` | boolean | calculado al insertar con la regla de DT8; **inmutable** |
| `creadoEn` | timestamptz | — |

CHECK: **exactamente una** de `operacionOriginalId` y `promoCuentaId` es no nula. Únicos parciales: `(ejemplarId, operacionOriginalId) WHERE operacionOriginalId IS NOT NULL` y `(ejemplarId, promoCuentaId) WHERE promoCuentaId IS NOT NULL`; `(empresaId, id)`. Índices: `(empresaId, cuentaId)`; `(operacionOriginalId)`; `(promoCuentaId)`. RLS: las **cuatro políticas por sucursal** del patrón de `Cuenta` y `EjemplarTicket` (migración `20261014140000_rls_sucursal_b4_punto_de_venta`) + `aislamiento_empresa`. Privilegios: `SELECT` e `INSERT` para el rol de la aplicación. Disparadores: solo inserción (aun para el dueño), sin `TRUNCATE`, alta solo dentro de la transacción del ejemplar (I-2), cuadre diferido (I-7).

**`EjemplarTicket.importeTotal`** (columna nueva opcional, DT13): `decimal(14,2)` NULL; se escribe **solo al insertar** (los ejemplares existentes quedan NULL). CHECK `≥ 0` cuando no es NULL.

Clasificación de tablas: `RenglonDeEjemplar` entra como POR_SUCURSAL en `test/setup/clasificacion-de-tablas.ts`, junto a `EjemplarTicket`.

**Qué es calculado y nunca guardado:** «vendido» del renglón (se lee del último ejemplar); el importe de una parte (lo calcula FE-N2); el estado «desactualizado».

**Lo que NO se crea ahora:** acumulado «facturado», aplicaciones, acreditaciones (FE-N2).

---

## 6. Nivel 7. «¿Qué pasa si…?» de los comandos

| | **CR1 · Cerrar la cuenta (escribe ejemplar A y sus renglones)** | **CR2 · Emitir ticket corregido (escribe ejemplar B, C… y sus renglones)** |
|---|---|---|
| Repetición (doble clic, reintento) | Ya la resuelve el cierre: la cuenta cerrada no se cierra dos veces; los renglones entran en la misma transacción que el ejemplar, así que **no puede haber dos A** ni renglones sueltos | Una segunda emisión ve el ejemplar ya vigente y se rechaza (`TICKET_VIGENTE`); no escribe renglones |
| Concurrencia | Dos cierres a la vez: SERIALIZABLE, gana uno (ya es así) | Dos emisiones o una emisión y una anulación: SERIALIZABLE; la que pierde reintenta, ve el estado nuevo; el único `(cuentaId, ejemplar)` arbitra |
| Tiempo | `creadoEn` con zona; el cierre usa el reloj inyectado | Idem |
| Incertidumbre | Si no se sabe si cerró (corte de red), la lectura de la cuenta lo dice; los renglones salen con el ejemplar | Idem |
| Reintento | Seguro por la regla anterior (se repite todo o nada) | Idem |
| Error parcial | **Todo o nada:** ejemplar, renglones, total y auditoría juntos; si falla el cuadre (I-7) se deshace el cierre entero | Idem; `corregirLineaDeTicket` ya deshace anulación y emisión juntas |
| Datos faltantes | Línea sin operación (aún sin vender): no es renglón; sin ítems vendidos no hay ticket | Línea sin versión de venta vigente: no aparece |
| Cambio de permisos | Sin permisos nuevos: lo que hoy puede cerrar o corregir sigue igual | Idem; el servidor valida cada vez |
| Cuenta de mostrador | **No escribe renglones** (R-2) | **No aplica** |
| Cuenta cerrada antes de la migración | No se toca | Si se corrige un ticket viejo, el ejemplar nuevo **no lleva renglones** («pendiente de completar»; DT4) |

---

## 7. Niveles 8 y 9. Acceso y experiencia

- **Permisos:** ninguno nuevo. Escribir renglones es un efecto interno de cerrar y de corregir; la **lectura** la usa FE-N2 con el permiso de la conciliación.
- **Pantallas:** **ninguna nueva y ninguna cambia.** El ticket impreso sigue armándose como hoy; el invariante I-8 asegura que los renglones guardados dicen lo mismo que lo impreso.
- **Escalera de producto N0 a N5 de este módulo:** N0 (hoy): nada guardado; **N1**: los tickets emitidos desde la activación tienen renglones (invisible para el usuario); N2: FE-N2 los usa; N3 en adelante: no aplica. Lo que falta se muestra «pendiente de completar».

---

## 8. Nivel 10. Pruebas, combinaciones, migración y operación

**Dimensiones cuyas combinaciones cambian dinero, visibilidad o permisos** (oráculo escrito aparte, `docs/oraculo-combinaciones-renglon-del-ticket-AAAA-MM-DD.md`, un test que recorre todas contra esa tabla, y un guardián que falla si aparece una dimensión nueva sin declarar):

| Dimensión | Valores |
|---|---|
| Tipo de línea | simple; simple con cantidad fraccionaria; con adicionales; promo |
| Cantidad | 1; ≥ 2 entera |
| Descuento | ninguno; de cliente; de producto; ambos (rige el mayor, hoy ya definido) |
| Ejemplar | A (original); B (corrección) |
| Estado de la venta de la línea | vigente; corregida por unidades; anulada; reemplazada dos veces |
| Origen de la cuenta | salón; mostrador (R-2: sin renglones) |
| Antigüedad | cerrada antes de la migración; después |

**Tabla de reglas esperadas (fragmento del oráculo, PROPUESTA):**

| Tipo | Cantidad | Estado venta | Ejemplar | ¿Renglón? | Cantidad guardada | Importe | Divisible |
|---|---|---|---|---|---|---|---|
| simple | ≥ 2 | vigente | A | sí | la completa | subtotal neto | **sí** |
| simple | ≥ 2 | corregida por unidades (quedan k) | B | sí | k | subtotal de k | sí si k ≥ 2 |
| simple | cualquiera | anulada | B | **no** | — | — | — |
| fraccionaria | — | vigente | A | sí | la completa | subtotal neto | **no** |
| con adicionales | cualquiera | vigente | A | sí (una, con los adicionales dentro) | la del producto | producto + adicionales | **no** |
| promo | — | vigente | A | sí | 1 | Σ componentes | **no** |
| cualquiera | — | — | cualquiera, cuenta de mostrador | **no** | — | — | — |

**Pruebas obligatorias:** (1) **propiedad con `fast-check`:** para cualquier cuenta y cualquier secuencia de correcciones, los renglones guardados de cada ejemplar son **idénticos** a las líneas que arma `armarTicketVigente` a esa fecha, y Σ importes = total (I-7, I-8); (2) **concurrencia con el caso de uso real:** dos correcciones de la misma cuenta a la vez → un solo ejemplar nuevo y sus renglones; cierre contra anulación; (3) **idempotencia:** repetir el cierre o la emisión no duplica renglones; (4) **atomicidad:** forzar un fallo después de escribir el ejemplar → ni ejemplar ni renglones; (5) **solo inserción:** UPDATE y DELETE rechazados aun con el rol dueño; (6) **aislamiento** entre empresas y sucursales (RLS); (7) **migración subir–bajar–subir** sobre una copia con datos reales; el `down.sql` se niega si hay renglones; (8) los reportes y el ticket impreso dan **idénticos** antes y después; (9) mutación: quitar cada CHECK y disparador → algún test se pone rojo.

**Gate** (AGENTS.md; los ocho en la misma corrida y limpios): `npx tsc --noEmit`, `npm run lint`, `npm run arquitectura`, `npm run analizar:muerto`, `npm test`, `npm run build`, `npm run plataforma:build`, `npm run test:e2e`. Guardianes que se tocan: clasificación de tablas, columnas de significado (declarar `cantidad`, `importe`, `importeTotal`), solo-agrega, denegación por defecto.

**Operación:** una migración aditiva, aplicada con respaldo y ensayo en una rama de Neon, base por base; `down.sql` que aborta si hay renglones. **Riesgos:** (a) cerrar la cuenta es el camino más caliente del POS: el costo extra de insertar unos renglones debe medirse; (b) `anularVenta` suelta deja el ticket desactualizado (DT12); (c) el camino de clasificación (E4) y esta etapa se migran en orden distinto: son columnas de tablas distintas, **independientes**.

---

## 9. Preguntas de NEGOCIO abiertas

**Q-1 (qué ve el dueño). Los tickets que ya están cerrados antes de activar esto, ¿entran a la conciliación con facturas externas?**
- **Opción 1 (recomendada):** no; solo los tickets emitidos desde la activación. Lo más barato y sin riesgo de datos: los viejos figuran «pendiente de completar».
- **Opción 2:** sí; un paso aparte reconstruye los renglones de los viejos solo cuando la cuenta **cuadra al centavo** con lo registrado (el resto sigue «pendiente de completar»). Más trabajo, con ensayo en copia.
- **Si no se responde:** se asume la opción 1 (declarado como supuesto); la opción 2 se puede agregar después sin deshacer nada.

**Q-2 (dinero). Un renglón con adicionales (por ejemplo, un plato con un extra), ¿se factura entero o se puede facturar por cantidad?**
- **Opción 1 (recomendada):** entero, como el combo (decisión tuya para Pedernal). Es lo que hoy ya hace Motor2 al corregir (esos renglones no se corrigen por unidades).
- **Opción 2:** por cantidad, repartiendo también los adicionales. Más complejo y con reparto de centavos entre producto y adicional.
- **Si no se responde:** opción 1 (todo nace cerrado); se puede abrir después sin perder datos.

---

## 10. Decisiones técnicas (resumen)

DT1 a DT14 de §3 y diferencias de §4. Ninguna se le pregunta al dueño.

## 11. NO VERIFICADO

1. La forma exacta de las dos columnas del camino 0047 de Pedernal (leí su descripción y su migración por informe; no el diff completo).
2. Que los cuatro casos de uso de DT11 sean **todos** los que anulan o reemplazan una venta de cuenta cerrada.
3. Cuánto cuesta (tiempo) agregar los renglones al cierre de cuenta.
4. Que `armarTicketImpresoEn` reconstruya al centavo los ejemplares anteriores de **toda** cuenta cerrada (la opción 2 de Q-1 lo comprobaría con una consulta de solo lectura).
5. Si existe en `src/core` una función de reparto por restos mayores equivalente a `prorratear` (la necesitará FE-N2; `prorratearPrecioPromo` es de otro uso).
6. Cómo anula hoy Motor2 una cuenta cerrada entera (no es el caso `corregirLineaDeTicket`).

Autoría: este documento lo escribió **Sonnet** (sesión de diseño en papel). No hay código.
