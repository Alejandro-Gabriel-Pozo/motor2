# Diseño: paridad de costos y margen con Pedernal (merma sobre bruto, base sin IVA, ocultar el objetivo) — 2026-11-13

> Diseño en papel, escalera de 10 niveles (AGENTS.md). **No se escribió código, ni migraciones, ni se tocó ninguna base.** Congelamiento de producción vigente. Sale del anexo `docs/anexo-paridad-food-cost-pedernal-motor2-2026-11-13.md` (léase primero: tiene la tabla de 15 filas Pedernal → Motor2).
>
> **Marcas.** **VERIFICADO** (archivo:línea): lo leí en el código de Motor2. **CONFIRMADA**: lo dijo el dueño, con cita. **PROPUESTA**, **PENDIENTE**, **NO VERIFICADO**. Del lado de Pedernal no leí código: solo las fichas de `zuluhub-docs` (`7aa1a89`, 2026-11-13) y la referencia del orquestador; va marcado **(ficha de Pedernal)**.
>
> **Regla del dueño (2026-11-13):** «Necesitamos ser iguales en todo… El resultado tiene que ser el mismo y sobre todo de las mismas formas, salvo porque nosotros usamos Prisma.» Toda diferencia lleva su motivo.

---

## 0. Resumen para el dueño

Tres cambios, **en este orden** (de lo que no necesita migración a lo que sí):

| Etapa | Qué | Migración | Cuándo |
|---|---|---|---|
| **A** | Ocultar con un interruptor reversible el objetivo de food cost por categoría, el estado «Food cost alto» y el precio sugerido | **Ninguna** | La primera; la decisión está CONFIRMADA |
| **B** | Food cost y margen del plato contra el **precio sin IVA** | **Ninguna** (solo lectura), pero **casi todos los platos quedarían «pendiente de completar»** hasta que se cargue la alícuota de cada uno | Después de A, **con una decisión sobre el costo** (etapa C) |
| **C** | El **costo** que entra al food cost y al margen, **neto de IVA recuperable** | **Probablemente sí** (y mucho código en compras); detalle por condición fiscal **sin validar con el contador** | Bloqueada por el contador |
| **D** | **Merma sobre lo que se compra**: se carga el **bruto**; neto = bruto × (1 − merma) | **Ninguna en la base conocida** (sin recetas cargadas); sí una migración de datos en cualquier base con recetas | Diseñar y probar ahora; **NO construir ahora** (decisión del dueño) |

**Riesgo que el dueño tiene que ver:** hoy Motor2 compara costo **con IVA** contra precio **con IVA**: es coherente. Si se pasa solo el precio a «sin IVA» (etapa B) y el costo sigue con IVA (etapa C sin hacer), el margen **sale subestimado** (mezcla las dos bases). Por eso B y C tienen que salir **juntas en lo visible** o B no se muestra hasta que C exista (secuencia obligatoria de §12).

---

## 1. Nivel 1. Propósito, necesidad y alcance

| # | Necesidad | Quién la pidió y dónde está escrita | Estado |
|---|---|---|---|
| N-1 | Motor2 igual a Pedernal en costos y margen | Dueño, 2026-11-13, chat con el orquestador (regla permanente) | CONFIRMADA |
| N-2 | Merma: «Sí, cargar el bruto como Pedernal (Recomendada)». Hoy no hay recetas cargadas en la base conocida: es un cambio de cálculo para diseñar y probar, **no ahora** | Dueño, 2026-11-13, chat con el orquestador, opciones | CONFIRMADA |
| N-3 | Base del margen: «SIN IVA igual que Pedernal»: precio de venta sin IVA y costo neto de IVA recuperable. El dueño preguntó: «cuál de los dos sirve más o tener los dos… en todo caso si sirven para lo mismo sin iva igual que en la maqueta de Pedernal… otra cosa el costo del producto lo tomas sin iva también o con IVA». El orquestador respondió que no sirven para lo mismo (con IVA infla el margen en pesos y el %, ≈ 17 % con alícuota 21 %) | Dueño y orquestador, 2026-11-13, chat | CONFIRMADA en lo general; **el detalle por condición fiscal de la empresa (inscripto, monotributo, exento) está PENDIENTE de validar con el contador** |
| N-4 | Objetivo de food cost por categoría («Food cost alto», precio sugerido): «Ocultarlo con interruptor reversible (Recomendada)». Sin objetivos cargados en la base conocida. Interruptor, sin migración; se borra recién con aviso | Dueño, 2026-11-13, chat con el orquestador, opciones | CONFIRMADA |

**Datos reales (lectura en SOLO LECTURA del orquestador sobre una copia de producción reciente; NO leídos por mí; el detalle está en el repositorio privado de documentos):** una empresa con **dos categorías planas, ambas sin productos vinculados**; sin objetivos de food cost cargados; sin recetas. Recontar en cada base antes de actuar. Otro dato, de otra sesión (`docs/diseno-alicuota-iva-del-producto-2026-11-12.md`): en una base conocida **todos los productos de venta están «sin declarar»** (NULL) en la alícuota de IVA.

**Fuera de alcance:** margen real de lo vendido contra el costo congelado, food cost por opción/combinación (Motor2 va adelante, anexo fila 14), IVA en la facturación de ventas, imputación de IVA computable, cualquier cambio en la clasificación comercial. No se suma ninguna función que nadie pidió.

---

## 2. Nivel 2. Actores y contexto

Administración y gerencia (ven costos: `reporte_costos`, sucursal, piso administrador, `acciones.ts:169`), quien edita recetas (`recetas`, ver el editor), quien carga compras, el contador (valida lo fiscal; no es un actor del sistema), y la plataforma (carga `Empresa.condicionIva` y `llevaIvaDeCompras`: «la carga la plataforma, nunca la propia empresa», `schema.prisma:2504-2510`). Cada sucursal tiene su costo (el reporte lo calcula por sucursal).

---

## 3. Nivel 3. Casos de uso (por etapa)

| Etapa | Caso de uso |
|---|---|
| A | CU-A1: el administrador no ve ni el objetivo, ni «Food cost alto», ni el precio sugerido; CU-A2: nadie puede guardar un objetivo mientras esté oculto; CU-A3: el reporte «Costos y márgenes» sigue mostrando costo, margen y food cost |
| B | CU-B1: ver food cost y margen de un plato contra su precio sin IVA; CU-B2: un plato sin alícuota declarada se muestra «pendiente de completar», nunca con un IVA supuesto |
| C | CU-C1: cargar una compra con el costo neto de IVA recuperable según la condición de la empresa; CU-C2: ver el costo neto en la receta y el reporte |
| D | CU-D1: cargar una línea de receta con el **bruto** y la merma; CU-D2: ver el neto calculado; CU-D3: que la venta, la producción y el costo descuenten el bruto; CU-D4: convertir las recetas existentes (solo en una base que las tenga) |

---

## 4. Nivel 4. Conceptos y ciclo de vida

- **Bruto / neto / merma.** En Pedernal (decisión del 13/11, ficha de Pedernal `merma.md`, `bruto-y-neto.md`): el dueño carga el **bruto** (lo que sale del stock y se costea); la **merma es un porcentaje del bruto**; el **neto** (lo que lleva el plato) lo calcula el sistema: **neto = bruto × (1 − merma)**. Ejemplo: bruto 300 g, merma 10 % → neto 270 g. En Motor2 hoy: `RecetaIngrediente.cantidad` es **neta** y `mermaPorcentaje` se **suma** al neto: bruto = neto × (1 + merma/100) (VERIFICADO: `src/core/reportes/costos.ts:61,158`; `rendimiento-recetas-vistas.ts:49-62`; `armar-linea-de-movimiento.ts:66`). Mismo porcentaje, **resultado distinto**: 20 % sobre 800 g netos da 960 g (hoy) contra 1.000 g (Pedernal, «sobre lo que se compra»).
- **Precio sin IVA.** `Producto.precioVenta` es el precio de carta **con IVA incluido** (`margen-objetivo.ts:3-5`; `schema.prisma:2840`-ss. para las compras: «lo pagado, CON IVA incluido»). Con `Producto.alicuotaIvaVenta` (lista cerrada `ALICUOTAS_IVA`, NULL = «sin declarar», `schema.prisma:395-399`) se calcula el precio sin IVA.
- **Costo neto de IVA recuperable.** Hoy el costo es el de la **entrada valorizada más reciente** (`obtenerCostoActualPorMPDeSucursales`, `src/server/lecturas/reportes/comun.ts:153-189`), que sale de `MovimientoStock.precioPorUnidadStock`, calculado como `precioTotal / cantidadStock` con `precioTotal` **con IVA** (`armar-linea-de-movimiento.ts:188`; VERIFICADO el comentario del esquema «Lo pagado por el renglón, CON IVA incluido»). **La perilla `Empresa.llevaIvaDeCompras` existe en el esquema (`schema.prisma:2510`, default apagada) y NINGÚN archivo de `src/` la lee** (grep de `llevaIvaDeCompras`: solo el esquema). Tampoco `src/` lee ni escribe `importeNeto`, `importeIva` ni `importeIvaComputable` (grep, 0 archivos): las columnas existen (`FacturaProveedorRenglon`, notas de crédito) y la «Etapa C» del servidor (ADR-029) **no está construida**.
- **Interruptor.** Constante booleana en `src/core/` con el molde ya usado: `DESCUENTO_POR_PRODUCTO_VISIBLE` (`src/core/carta/descuento-producto.ts:27`) y `ESTA_BIEN_ASI_VISIBLE` (`src/core/carta/esta-bien-asi.ts:18`), ambos `false` (diseño: `docs/diseno-apagar-esta-bien-asi-2026-11-11.md`). Reversible: poner `true`.

Ciclo de vida: no hay estados nuevos de datos; el cambio es de cálculo (B, D), de compras (C) y de visibilidad (A).

---

## 5. Nivel 5. Invariantes y políticas

| # | Regla | Cómo se cuida | Estado |
|---|---|---|---|
| I1 | Nada viene preelegido: **una alícuota «sin declarar» nunca se reemplaza por un valor supuesto** (todo nace cerrado; coincide con la ficha de Pedernal: «sin alícuota no se puede quitar el IVA y la pantalla lo dice») | La consulta devuelve «pendiente de completar» y la pantalla lo dice | PROPUESTA (CONFIRMADA la regla general de AGENTS.md) |
| I2 | Un costo incompleto no da margen ni food cost (nunca cero): decisión 125 de Pedernal; el reporte de Motor2 ya tiene `COSTO_INCOMPLETO` (`costos.ts:12`) | Igual que hoy | VERIFICADO (Motor2) / ficha de Pedernal |
| I3 | El **mismo costo y el mismo precio, en la misma base**: no se mezcla costo con IVA contra precio sin IVA | Una sola función pura que decide la base; una prueba la recorre | PROPUESTA |
| I4 | Neto = bruto × (1 − merma), con 0 ≤ merma < 100; merma 0 → neto = bruto | La función de merma única + CHECK en la base si hace falta (hoy `mermaPorcentaje` es `Decimal(6,2)` con default 0; si tiene CHECK: **NO VERIFICADO**) | PROPUESTA |
| I5 | Lo que sale del stock y se costea es el **bruto**; lo que lleva el plato es el neto | Los consumidores usan la función única | PROPUESTA |
| I6 | El objetivo oculto no se escribe, no se lee para decidir un estado y no se muestra; **los datos no se tocan** | Interruptor + guardián | PROPUESTA |
| I7 | **Requisito (orquestador, 2026-11-13): dinero exacto.** Las funciones nuevas usan `Decimal` o **enteros en centavos**, nunca números flotantes; moneda explícita (ARS); redondeo definido y **una sola vez al final** (Pedernal: «derivados exactos y no tipeados»; importes ARS con 2 decimales; el costo unitario con 6) | Funciones puras con aritmética exacta + pruebas de propiedades; un guardián que falla si una función nueva de costo/margen/IVA usa `Number` en una operación de dinero | REQUISITO (regla de dinero de las preferencias del proyecto). **Hallazgo:** el cálculo actual de `costos.ts` usa números de JavaScript (`it.cantidad * (1 + it.mermaPorcentaje / 100) * costoUnitario`, `:61,158,177`) y `Math.round(... * 1000) / 10` para los %: **no se reescribe lo existente en estos pasos** (no se pidió); las funciones **nuevas** nacen exactas y la deuda se anota aparte |
| I8 | Aislamiento entre empresas y permisos: sin cambios; todo lo que se lea sigue filtrado por empresa (RLS) y por `reporte_costos` | Sin cambios | VERIFICADO |
| I9 | Fechas: los cálculos usan la fecha de la entrada de costo (`o."fecha"`); el corte por día es el de Argentina (UTC-3) como en el resto del reporte | Sin cambios | VERIFICADO el uso de `o.fecha` |

---

## 6. Nivel 6. Historia y persistencia (por etapa)

### Etapa A (interruptor): **sin migración, sin datos nuevos.**
Los datos de `MargenObjetivo` quedan (en la base conocida, no hay filas). Para volver, se pone `true`.

### Etapa B (precio sin IVA): **sin migración.** Solo lectura de `Producto.alicuotaIvaVenta` (existe) y `Producto.precioVenta`.
**Advertencia:** con los productos de venta «sin declarar» de la base conocida (NO VERIFICADO para otras bases), el food cost y el margen de casi todos se verían «pendiente de completar» hasta que alguien cargue la alícuota de cada uno (la pantalla para cargarla existe desde `#255`, «Producto: cargar la alícuota de IVA desde el formulario»). **CONFIRMADA (dueño, 2026-11-13, chat con el orquestador, opciones): «Cargarla de a uno, sin carga masiva (Recomendada)»**: las alícuotas se cargan producto por producto desde la ficha; **no se construye carga masiva**. Es la consecuencia correcta de I1, pero cambia lo que hoy se ve.

### Etapa C (costo neto): **PROBABLE migración + código grande; NO VERIFICADO el alcance.**
Lo que hay: `FacturaProveedorRenglon` tiene `alicuotaIva`, `importeNeto`, `importeIva`, `importeIvaComputable` (`schema.prisma:2847-2852`), CHECK `neto + IVA = precioTotal`; `Empresa.condicionIva` (NULL = no declarada, falla cerrado) y `llevaIvaDeCompras` (apagada, sin lector). Lo que falta (VERIFICADO por grep, 0 archivos en `src/`): quien **escriba** el desglose y quien **lea** el neto. El costo del reporte viene de `MovimientoStock.precioPorUnidadStock` (con IVA); un traspaso recibido copia ese costo (`PROCESOS_QUE_FIJAN_EL_COSTO`), y una compra sin factura repartida no tiene desglose. Opciones (PROPUESTA, **a decidir cuando se destrabe**):
- **C1.** Agregar a `MovimientoStock` una columna aditiva `precioNetoPorUnidadStock` (nula en lo histórico), escrita junto con el costo; el reporte usa el neto si existe y marca «pendiente de completar» si no. Migración aditiva y reversible (`down.sql`).
- **C2.** Derivar el neto por lectura desde el renglón de la factura (`Operacion` → `FacturaProveedorSucursal.operacionId` único → `FacturaProveedorRenglon.importeNeto ÷ cantidadStock`): sin migración, pero solo cubre compras con factura y **no** traspasos ni lo anterior a las facturas repartidas. **NO VERIFICADO** que el join sea suficiente.
- **Qué importe entra como costo** lo fija PC-1 de Pedernal (decisión del dueño del 2026-11-11, «Sí, aplicalo», el contador puede corregirlo; ficha de Pedernal): **inscripto → costo neto; monotributista o exento → costo con IVA incluido; factura B o C → el importe de la línea; el crédito fiscal computable solo para inscripto en Factura A.** La propia especificación de compras de Pedernal lo marca **NO VERIFICADO con el contador** (D-32). Motor2 tiene la condición de la empresa (`Empresa.condicionIva`) pero **nadie la usa para el costo**.

### Etapa D (merma sobre bruto): **sin migración de esquema; migración de DATOS solo si la base tiene recetas.**
Los nombres de columna quedan (`RecetaIngrediente.cantidad`, `mermaPorcentaje`), **cambia lo que significan**: `cantidad` pasa a ser **bruta** y `mermaPorcentaje` el porcentaje del **bruto**. Para una fila existente con neto `n` y merma `m` (sobre el neto), la fila equivalente que **no cambia ni el descuento de stock ni el neto** es: bruto `b = n × (1 + m/100)` y merma nueva `m' = 100 × m / (100 + m)` (porque `b × (1 − m'/100) = n`). Ejemplo: n = 800 g, m = 20 % → b = 960 g, m' = 16,67 % → neto 800 g. **Las versiones de receta son append-only** (`RecetaVersion`, «viaja con la versión», `schema.prisma:778-850`): reescribir filas viejas contradice esa regla. Opciones (PROPUESTA): **D-i.** Un marcador aditivo por versión (`RecetaVersion.baseDeCantidad`: `'NETA'` para lo existente, `'BRUTA'` para lo nuevo; las funciones leen el marcador): no reescribe historia, **migración aditiva y reversible**; **D-ii.** Conversión de datos sobre filas existentes (con `down.sql` que guarda los valores anteriores): **destructiva en el sentido de que reescribe historia** → autorización aparte. **Sin recetas en la base conocida, ninguna de las dos es necesaria ahí**; la migración de esquema de D-i (una columna con default) se puede evitar **solo si** se verifica que toda base destino tiene 0 recetas: recontar antes.

---

## 7. Nivel 7. Atomicidad y concurrencia: «¿qué pasa si…?»

### 7.1 Interruptor (etapa A)
| Situación | Resultado |
|---|---|
| Repetición / doble clic en «Guardar objetivo» desde una pestaña vieja | Rechaza las dos veces (sin texto nuevo: la interfaz ya no muestra cómo cargar el objetivo), **después** de verificar el permiso; no escribe ni audita |
| Concurrencia | No hay escritura: no hay carrera |
| Tiempo (se prende más adelante) | Todo vuelve como estaba; los datos no se tocaron |
| Permisos | Sin permiso, rechazo de permisos primero; con permiso, el rechazo del servidor sin texto nuevo (la pantalla no ofrece cargar el objetivo) |
| Datos faltantes / error parcial / reintento | No aplica: no hay escritura |
| Reporte por período (`periodo-alertas.ts`, `ResumenFueraDeObjetivo`) | No avisa «platos fuera de objetivo» mientras esté oculto |

### 7.2 Calcular food cost y margen (etapas B/C, consulta)
| Situación | Resultado |
|---|---|
| Alícuota «sin declarar» | «Pendiente de completar»; no se calcula |
| Alícuota EXENTO o NO_GRAVADO | Precio sin IVA = precio (no se quita nada); **supuesto a confirmar** (la ficha de Pedernal tampoco lo define) |
| Alícuota 0 % (`IVA_0`) | Igual al precio |
| Costo incompleto (falta el costo de un ingrediente) | `COSTO_INCOMPLETO`; sin food cost ni margen (nunca cero) |
| Precio de venta 0 o sin precio (precio abierto, base configurable) | `SIN_PRECIO_VENTA` / `POR_OPCION` como hoy |
| Costo que cambia entre dos lecturas | Cada lectura ve lo confirmado; no hay escritura |
| Concurrencia con una compra nueva | El reporte lee un instante; no bloquea |
| Cambio de permisos | `reporte_costos` se verifica en el servidor, como hoy |
| Dos bases distintas en la misma cuenta (precio sin IVA y costo con IVA) | **Imposible por I3**: la función única decide la base |

### 7.3 Guardar una línea de receta (etapa D)
| Situación | Resultado |
|---|---|
| Repetición (misma versión de receta, mismo contenido) | Una sola versión nueva (la regla vigente de versionado de recetas; **no la modifica este diseño**) |
| Concurrencia (dos personas editan la misma receta) | Como hoy (control de versión de la receta; **NO VERIFICADO** el detalle: no lo leí) |
| Merma < 0 o ≥ 100 | Rechaza (I4) |
| Cantidad bruta ≤ 0 | Rechaza (como hoy con la neta) |
| Error parcial | Una versión con todas sus líneas o ninguna (como hoy) |
| Venta/producción en curso con la receta vieja | Usa la versión vigente al cerrar (como hoy); la **base de cantidad viaja con la versión** si se elige D-i |
| Cambio de permisos | Se verifica en el servidor (clave de recetas), como hoy |
| Datos faltantes (merma vacía) | 0 %: neto = bruto |

---

## 8. Nivel 8. Acceso y permisos

Sin claves nuevas ni cambios de piso: ver costos = `reporte_costos` (sucursal, administrador, solo ver); editar recetas = permiso actual de recetas; fijar el objetivo = `margen_objetivo_editar` (administrador, empresa; **queda sin uso mientras esté oculto**). Pedernal exige `costos.ver` (gerente y administrador; el operador no ve costos nunca): **mismo piso** (ficha de Pedernal). La etapa C agrega quién carga el costo neto: el permiso de cargar compras que ya existe.

---

## 9. Nivel 9. Consultas y experiencia (mobile first, 375 px)

- **A:** se ocultan: la entrada «Margen objetivo» (`src/app/(app)/catalogo/margen-objetivo/page.tsx`; la pestaña de Catálogo › Maestros), la columna «Objetivo %» y el precio sugerido de la tabla de costos, el estado «Food cost alto» (`tabla-costos.tsx`, `costos.ts:12,99-102,210`), y el aviso del reporte por período (`periodo-alertas.ts`). Superficies que leen el interruptor: **a inventariar con `Explore` al implementar** (la lista de archivos que mencionan el objetivo, VERIFICADA con grep: `actions/reportes/margen-objetivo.ts`, `casos-de-uso/guardar-margen-objetivo.ts`, `consultas/reportes/periodo.ts`, `consultas/reportes/margen-objetivo-consulta.ts`, `persistencia/reportes/margen-objetivo.ts`, `reportes/costos/page.tsx`, `tabla-costos.tsx`, `catalogo/margen-objetivo/page.tsx`, `core/reportes/{margen-objetivo,costos,periodo-alertas,accion-faltante,public}.ts`, `core/datos/food-cost-objetivo.ts`, `core/catalogo/ui-config.ts`, `core/permisos/auditoria.ts`).
- **B:** las columnas de «Costos y márgenes» pasan a rotularse «Precio sin IVA», «Food cost %» y «Margen» **(textos nuevos: requieren su aprobación;** Pedernal los tiene como «Precio con IVA» / «Precio sin IVA» en la maqueta sin estar aprobados: ficha de Pedernal, pregunta 5). Un plato sin alícuota: «pendiente de completar» con el enlace a su ficha.
- **D:** en la pantalla de receta (`src/app/(app)/catalogo/recetas/[productoId]/page.tsx`, `src/components/receta/materia-prima-y-cantidad.tsx:131`) el campo «Cantidad» pasa a ser el **Bruto**, la «Merma %» queda, y se **muestra el Neto calculado** (textos «Bruto», «Merma», «Neto»: **«Merma» y «Bruto» ya aprobados por el dueño el 09/11 para Pedernal**, decisión 115; «Neto» a confirmar). Una merma inválida se marca en el campo y apaga «Guardar», sin texto junto al campo (decisión del dueño del 13/11 para Pedernal, ficha de Pedernal).

---

## 10. Nivel 10. Pruebas, oráculo de combinaciones y migración

**Dimensiones cuyas combinaciones cambian dinero o visibilidad (declaradas):** D1 base del cálculo (con IVA actual / sin IVA); D2 alícuota (`IVA_0`, `IVA_2_5`, `IVA_5`, `IVA_10_5`, `IVA_21`, `IVA_27`, `EXENTO`, `NO_GRAVADO`, «sin declarar»); D3 condición de la empresa (`RESPONSABLE_INSCRIPTO`, `MONOTRIBUTO`, `EXENTO`, «no declarada»); D4 tipo de comprobante de la compra (A, B, C, sin factura); D5 `llevaIvaDeCompras` (apagada/prendida); D6 interruptor del objetivo (oculto/visible); D7 merma (0, valores intermedios, ≥ 100); D8 base de cantidad de la versión de receta (neta/bruta, si D-i). **Un guardián falla si aparece una dimensión nueva (una alícuota en `ALICUOTAS_IVA`, una condición en `CONDICIONES_IVA`) sin declarar si afecta** (regla del 2026-10-28). Oráculo en `docs/oraculo-combinaciones-costos-y-margen-AAAA-MM-DD.md`, escrito aparte del código.

**Filas del oráculo (muestra, a completar al implementar):**

| Caso | Entrada | Resultado esperado |
|---|---|---|
| Precio sin IVA | 1.210 con `IVA_21` | 1.000 |
| Precio sin IVA | 1.100 con `IVA_10_5` | 995,48 (1.100 ÷ 1,105, redondeo a definir; el cálculo exacto es 995,4751…) |
| Precio sin IVA | `EXENTO`, `NO_GRAVADO`, `IVA_0` | = precio |
| Precio sin IVA | «sin declarar» | «pendiente de completar» |
| Food cost | costo 300, precio sin IVA 1.000 | 30 % |
| Food cost con costo incompleto | — | sin valor (no 0) |
| Merma (bruto) | bruto 300 g, merma 10 % | neto 270 g |
| Merma (bruto) | neto 800 g, merma 20 % | bruto 1.000 g (hoy: 960 g) |
| Merma | merma 0 % | neto = bruto |
| Merma | merma 100 % o negativa | rechaza |
| Conversión (D-ii) | neto 800 g, m 20 % (sobre neto) | bruto 960 g, m' = 16,67 %, neto 800 g |
| Interruptor oculto | cualquier objetivo cargado | no aparece ni decide estado |

**Pruebas obligatorias (al implementar cada etapa):** unidad pura de las funciones nuevas, con **propiedades** (`fast-check`, si ya está en el proyecto: **NO VERIFICADO**; no se agregan librerías sin avisar): `neto(bruto(neto, m), m) = neto` salvo redondeo; conversión de datos que preserva el neto y el descuento de stock; **regresión**: el reporte de costos, la venta (`cerrar-cuenta.ts`), la producción (`armar-linea-de-movimiento.ts`), el «teórico vs real» (`rendimiento-recetas-vistas.ts`) y el costo congelado dan lo mismo que antes cuando la merma es 0 %; **concurrencia** (dos ediciones de la misma receta a la vez; una compra mientras se lee el reporte); **idempotencia** (guardar dos veces la misma versión de receta, repetir la conversión de datos: no se aplica dos veces); **aislamiento** (una empresa no ve costos de otra); **guardián** de que ninguna superficie del objetivo se muestra con el interruptor apagado; **E2E** a 375 px de la pantalla de receta y del reporte.

**Gate** (AGENTS.md), en la misma corrida y limpios: `npx tsc --noEmit`, `npm run lint`, `npm run arquitectura`, `npm run analizar:muerto` (0 hallazgos), `npm test`, `npm run build`, `npm run plataforma:build`, `npm run test:e2e`.

**Migración y operación.**

| No necesita migración | Necesita migración (**requiere autorización expresa del dueño**) |
|---|---|
| Etapa A completa; etapa B (lectura); etapa D en una base sin recetas (solo cambia el cálculo y la pantalla) | Etapa C-1 (columna aditiva de costo neto); etapa D-i (columna `baseDeCantidad`, aditiva con default); etapa D-ii (conversión de datos, reescribe historia: **destructiva**, se avisa antes) |

Procedimiento para lo que migra: recontar filas reales en cada base → respaldo → ensayo en copia de Neon (nunca la rama principal): ida, `down.sql`, ida → aprobación → aplicación base por base, con el congelamiento levantado por quien corresponda. **Hasta entonces no se aplica nada.**

---

## 11. Diferencias de infraestructura Pedernal → Motor2

| | Pedernal | Motor2 | Marca |
|---|---|---|---|
| Cálculo del costo | `costearReceta` puro, fracciones exactas, un solo redondeo (ficha de Pedernal) | `costos.ts`, números de JavaScript | **Distinto por criterio** (riesgo I7, §14) |
| Merma | una función (`merma.ts`) que decide la fórmula | la fórmula `(1 + m/100)` está **repetida** en al menos `costos.ts:61,158`, `rendimiento-recetas-vistas.ts:49-62`, `armar-linea-de-movimiento.ts:66` y los consumidores de §6 | Distinto: la etapa D crea la función única primero |
| Interruptor | perillas por plan (`perillas.ts`, ficha de Pedernal) | constantes booleanas en `src/core/` | **Distinto por lo que Motor2 ya tiene** |
| Migraciones | SQL crudo, `reversiones/` | Prisma + `down.sql` | Distinto por Prisma |

---

**Actualización 2026-11-14 (VERIFICADO por el orquestador, `ZuluHub-ERP` `2e71fd35`, PR #294, DEC-0357; no leí el código):** Pedernal **ya implementó** la merma sobre bruto: la receta carga el **BRUTO** y neto = bruto × (1 − merma). **Coincide con lo decidido por el dueño para Motor2** (2026-11-13, «Sí, cargar el bruto como Pedernal»); el código de Motor2 todavía usa la fórmula anterior. No cambia el plan de la etapa D (no se construye ahora).

## 12. Etapas (la más barata primero) y secuencia obligatoria

**Secuencia obligatoria (supuesto declarado del orquestador, 2026-11-13; el dueño lo corrige si no es así):** la base del margen y del food cost **no pasa a «sin IVA» en ninguna pantalla hasta que exista el costo neto de IVA** (etapa C); o, mientras tanto, se muestran **ambas bases lado a lado**, rotuladas, y nunca precio sin IVA contra costo con IVA. Orden fijo: A → D0 → (C) → B visible. B puede construirse antes, pero **queda oculta** hasta que C exista o hasta que se decida mostrar las dos bases. Un guardián/prueba de §10 verifica que ninguna fila calcula con precio y costo en bases distintas (I3).

1. **A — interruptor.** Una constante, el guardián, los textos, las superficies del §9. Sin migración. *Menor tamaño, decisión CONFIRMADA.*
2. **D0 — la función única de merma** (puro, sin cambiar comportamiento: hoy la fórmula está repetida; se junta en una función con la fórmula **actual** y las pruebas de §10). Sin migración. *Prepara D sin riesgo; knip exige que tenga consumidor al entrar.*
3. **B — precio sin IVA**, construible, **oculta** hasta que C exista (o hasta mostrar las dos bases lado a lado). Sin migración.
4. **D1 — el cambio de fórmula y de pantalla** (bruto cargado), con el marcador D-i **solo si** la base destino tiene recetas. **No ahora** (N-2).
5. **C — costo neto.** Bloqueada por el contador y por la «Etapa C» de ADR-029 sin construir. **Hasta que exista, B no se muestra sola.**

---

## 13. Decisiones pendientes: ver el Anexo A (bloque listo, sin pedirle nada al dueño por ahora)

Hoy **no hay nada para decidir**: las etapas con decisiones del dueño pendientes (B, C, D1) no se implementan todavía. El orquestador consolida el bloque cuando se acerque la implementación de esas etapas. Lo que está CONFIRMADO (N-1 a N-4) y la secuencia obligatoria de §12 no se vuelven a preguntar.

**Supuestos declarados:** S1 el interruptor es una constante en el código (como los dos que ya existen), no una opción por empresa. S2 «Food cost alto» y el precio sugerido cuelgan del objetivo y se ocultan con él. S3 el costo sigue siendo el último costo de compra de la sucursal (anexo fila 4: igual a Pedernal en la idea). S4 la etapa D usa la fórmula de Pedernal, neto = bruto × (1 − merma). S5 **(del orquestador)** B no se muestra sola antes que C (secuencia de §12).

---

## 14. Riesgos y pendientes

- **Dinero con números de JavaScript** en el cálculo actual (`costos.ts`): el requisito I7 obliga a que las funciones **nuevas** usen `Decimal` o enteros en centavos; **no verifiqué** qué ofrece `@/core/moneda` más allá de `redondearMoneda` y `cocienteRedondeadoArriba`. Lo existente no se reescribe en estos pasos; queda como deuda anotada.
- **La fórmula de merma está repetida** en muchos archivos (§11): el riesgo de la etapa D es olvidarse de uno; el guardián debe fallar si queda una fórmula `* (1 + …/100)` fuera de la función única.
- **Mezcla de bases** si B sale antes que C (§0 y secuencia obligatoria de §12).
- **Datos de producción sin recontar** (solo se contó la copia del 12/11).
- **Sobre Pedernal:** la merma del código de Pedernal (`merma.ts`) todavía no estaba actualizada a la regla del 13/11 según su ficha; si Pedernal cambia la fórmula o la base del margen otra vez, hay que repetir el fetch y actualizar.
- **Congelamiento de producción:** nada se aplica ni se despliega.
- **Sugerencias (no implementadas):** carga masiva de alícuotas (no se pidió); margen real de lo vendido; food cost por opción (Motor2 ya lo tiene).

---

## Anexo A. Bloque de preguntas para el dueño (listo; se hace cuando se acerque la implementación de B, C y D1)

Cada una cambia dinero, el modelo de datos o lo que ve el cliente. Con mi recomendación y por qué.

- **Q2 — CONFIRMADA (dueño, 2026-11-14, chat con el orquestador, opciones): ««Pendiente de completar», sin número (Recomendada)».** Un plato sin alícuota declarada se muestra «pendiente de completar», sin número, y se dice qué falta; no se inventa un IVA. Las alícuotas se cargan de a uno, sin carga masiva (confirmado el 2026-11-13). Esta forma de calcular **no se muestra sola** antes de que exista el costo sin IVA de las compras (secuencia obligatoria de §12).
- **Q3 — ESPERA AL CONTADOR** (pregunta 4 de la consulta). ¿Para EXENTO, NO_GRAVADO o `IVA_0` el precio sin IVA es igual al precio? Recomiendo **sí**; no se aplica hasta que el contador lo confirme.
- **Q5 — CONFIRMADA (dueño, 2026-11-14, chat con el orquestador, opciones): «Marcar cada receta con «cómo se cargó» y no reescribir las viejas (Recomendada)».** Es la opción D-i (marcador por versión de receta, aditivo, sin reescribir historia); D-ii queda descartada. Sigue valiendo: recontar las recetas de cada base antes de construir y **ninguna migración queda autorizada por esta respuesta**.
- **Q6 — RESUELTA (dueño, 2026-11-14, chat con el orquestador, opciones):** T1 «Precio sin IVA» y T2 «Neto» **aprobados**; T3 «Sin aviso: que el botón no aparezca» (**no se escribe ese texto**); T4, T5 y T6 «Aprobar los 3 como están»; T7 y T8 «Aprobar los 2 como están». Detalle en el **Anexo B**.
- **Q4 (ya conocida; no se pregunta hasta destrabar C).** El costo neto por condición fiscal (PC-1 de Pedernal) lo valida el contador; sin su respuesta, C no se construye.


---

## Anexo B. Lista cerrada de textos nuevos (APROBADOS por el dueño el 2026-11-14)

> Pedida y resuelta por el dueño el 2026-11-14 (chat con el orquestador, opciones elegidas por él). Ninguno se construye ahora (la etapa B está oculta hasta que exista el costo sin IVA y la etapa D no se construye todavía).

| # | Texto exacto | Dónde aparece | Etapa | Estado y cita |
|---|---|---|---|---|
| T1 | «Precio sin IVA» | Encabezado de la columna del precio en el reporte «Costos y márgenes» (`src/app/(app)/reportes/costos/tabla-costos.tsx`) y, si la ficha de receta muestra el precio, en esa fila | B | **APROBADO** (dueño, 2026-11-14) |
| T2 | «Neto» | Línea de ingrediente de la receta, solo lectura, junto a «Bruto» y «Merma» (ya aprobados) | D | **APROBADO** (dueño, 2026-11-14) |
| T3 | **(sin texto)** | **No se escribe ningún aviso.** Elegido por el dueño: «Sin aviso: que el botón no aparezca». Mientras el interruptor esté apagado la interfaz **no muestra cómo cargar el objetivo de food cost**; si alguien arma el pedido a mano, el servidor lo sigue rechazando **sin texto nuevo** (con un rechazo genérico ya existente: cuál, **NO VERIFICADO**) | A | **CONFIRMADO sin texto** (dueño, 2026-11-14) |
| T4 | «Falta cargar el IVA de este plato.» | Debajo de «Pendiente de completar» en el food cost y el margen de un plato sin alícuota declarada | B | **APROBADO** («Aprobar los 3 como están», dueño, 2026-11-14) |
| T5 | «Margen $ = Precio sin IVA − Costo. Margen % = Margen $ / Precio sin IVA × 100.» | Ayuda de la columna «Margen» (reemplaza la actual, que dice «Precio venta») | B | **APROBADO** (idem) |
| T6 | «Food cost % = (Costo de comida y bebida) / Precio sin IVA × 100 — qué porción del precio de venta sin IVA se va en insumos. No incluye el packaging ni la limpieza.» | Ayuda de la columna «Food cost %» (reemplaza la actual, que dice «Precio venta») | B | **APROBADO** (idem) |
| T7 | «Esta categoría tiene productos. Los reportes de períodos anteriores van a mostrar la categoría nueva.» | Aviso de confirmación al mover una categoría con productos (clasificación) | Clasificación | **APROBADO** («Aprobar los 2 como están», dueño, 2026-11-14) |
| T8 | «Ya existe una presentación con ese nombre y otra cantidad. Usá otro nombre.» | Rechazo al cargar una presentación de compra con el mismo nombre y otra cantidad | Presentaciones | **APROBADO** (idem) |

Reutilizados **sin cambio** (ya aprobados): «Bruto», «Merma», «Food cost», «Margen», «Pendiente de completar».
