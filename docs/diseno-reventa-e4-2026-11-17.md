# Diseño — E4: la clase «Reventa» (se compra y se vende tal cual) — 2026-11-17

Frente 2 · Pedido del dueño: había dicho «Insumo y Reventa para altas nuevas» (2026-11-15, chat dueño ↔ orquestador, opción C, `relleno-clases-existentes`, CONFIRMADA en `docs/diseno-clases-de-producto-como-pedernal-2026-11-15.md` §11) y preguntó «Y la etapa E4, ¿por qué no está?» (2026-11-17, citado por el orquestador, `motor2-docs`). La orden: ahora se hace. **Este documento solo diseña: no hay migración ni código hasta que el orquestador lo revise.**

Cuelga del diseño de clases (`docs/diseno-clases-de-producto-como-pedernal-2026-11-15.md`: niveles 1 a 10 de las cinco clases, §5.1 reglas por clase, §6 esquema, §10.1 oráculo, §11 pares MP+PV, §13 etapas). Acá se baja **solo E4**. Estados: **CONFIRMADA** (dueño), **CONFIRMADO POR LECTURA**, **PROPUESTA**, **NO VERIFICADO**.

## 1. Propósito y alcance (nivel 1)

Una **Reventa** es UN producto que se compra a un proveedor y se vende tal cual, con **stock propio**, sin receta (ejemplo: una gaseosa de marca, un alfajor). Hoy eso se hace con **dos productos** (una materia prima + un producto de venta con receta de un solo ingrediente), una convención sin ninguna restricción en la base. E4 agrega la clase para **altas nuevas**; **los pares actuales siguen exactamente como están** (su unión es E6, aparte; el relleno de Reventa sobre lo viejo no se hace: respuesta 1 = C). **Resultado esperado: ningún reporte existente cambia de resultado.**

Qué NO es E4: unir pares (E6), reglas de Insumo (E3), nombre de cocina/menú nuevos, precio abierto, rellenar clases viejas.

## 2. Inventario real de los lugares donde manda `tipo` / `seProduce` (verificado contra el código, rama `claude/paridad-f2-clases-e2-alta-apilada`)

**Corrección al número del diseño anterior:** el «~63» era de **archivos** y venía de un documento. En el código real hay **94 archivos de `src/`** (sin tests) que deciden o propagan `tipo`/`seProduce` con el literal `'MP'`/`'PV'`, `tieneStockReal(` o `claseDelProducto(`; 66 mencionan `seProduce`. Por línea (sin comentarios ni tests): `tipo ===/!== 'MP'|'PV'` 98 líneas en 55 archivos; `tipo: 'MP'|'PV'` 49; llamadas a `tieneStockReal(` 17; ramas por `seProduce` ~75. Quitando declaraciones de tipo y paso de datos, quedan **≈110 a 130 puntos de decisión reales** (**estimación**, no conteo exacto; los 94 archivos y las cuentas por patrón sí son exactos).

Fuera de `src/`: 4 `CHECK` de `Producto` que leen `tipo` (`Producto_modoDeVenta_base_check`, `Producto_nombre_de_cocina_chk`, `Producto_claseDeUso_tipo_chk`, `Producto_claseDeUso_seProduce_chk`); **no hay vistas ni funciones SQL que lean `Producto.tipo`** y la RLS es por empresa, no mira `tipo`; scripts de informe y seeds. **514 archivos de test** contienen `'MP'`/`'PV'` (no auditados uno por uno).

Resumen por circuito (cada grupo con archivo:línea está en el informe de inventario del 2026-11-17; acá lo que decide):

| Circuito | Qué hace hoy con el tipo | Una Reventa como **MP** | Una Reventa como **PV** |
|---|---|---|---|
| **Compras** (`transiciones.ts:138`, `ui-config.ts:46`, `armar-linea-de-movimiento.ts:102`, alta rápida, IVA de compra `productos.guard.ts:184-188`, paso «Cómo se compra», proveedor×producto, presentaciones, insumo-familia) | Solo MP se compra; IVA de compra solo en MP | Encaja | **Rompe**: no se compra, no lleva IVA de compra, no tiene paso de compra |
| **Ventas / POS / registro** (`linea-de-venta.ts:46`, `agregar-items.ts:150`, `registrar-venta-en-tx.ts:121-170`, selectores, combos, paso de venta, descuento, nombre de cocina) | Solo PV se vende; un PV con `seProduce=false` **exige receta** («sin receta no se vende», `origen-de-stock.ts:49`) | **No se puede vender** (≈45 puntos con filtro PV) | Se vende, pero hoy exigiría la receta 1:1 |
| **Carta** (7 acciones `NO_ES_PV`, consultas `where tipo:'PV'`, `menu.ts`, familias) | Solo PV | Nunca aparece | **Encaja sin tocar** |
| **Stock / conteo / traspasos** (`tieneStockReal = MP o (PV y seProduce)`, `transiciones.ts:113-114`; 17 llamadas) | Stock propio: MP o PV que se produce | Tiene stock propio sola | Solo con `seProduce=true`, que activa PRODUCCION y exige receta: **no corresponde** |
| **Recetas / producción** (`receta-validacion.ts:151`, ingrediente solo MP; `PRODUCCION ⇔ seProduce`) | Ingrediente = MP; receta = PV, o MP que se produce | Entra como ingrediente (hoy) | No entra como ingrediente (hoy); **con R7 SÍ entra: un cambio de E4-3/E4-4** |
| **Costos y reportes** (`costos.ts:145,362` solo PV; valuación, diferencias, huecos solo MP; rótulo `PRODUCTO_DE_REVENTA` del par) | Costo/margen solo de PV (con receta); compras/valuación solo de MP | Fuera de costos y margen | Entra al margen, pero sin receta cae en «sin receta / costo incompleto» |
| **Catálogo** (alta, ficha, duplicar, precios, vocabulario hardcodeado «materia prima (MP)» / «producto de venta (PV)», `Producto_nombre_de_cocina_chk` solo PV, `Producto_modoDeVenta_base_check`) | Ficha por tipo | `nombreDeCocina` **prohibido** por el CHECK | Encaja (precio, carta, nombre de cocina, opciones) |
| **Base** | enum `TipoProducto {MP, PV}` excluyente, `tipo` inmutable (`TIPO_DISTINTO`), `claseDeUso` inmutable (disparador) | — | — |

**Respuestas verificadas:** (1) un producto con `tipo` único **no puede** hoy ser comprable y vendible a la vez; (2) el par MP+PV existe solo como convención: el stock vive en la MP y el PV no tiene stock propio; (3) el código **ya tiene** el núcleo puro `core/catalogo/clases-de-producto.ts` con REVENTA definida (comprable, vende, ingrediente, stock propio, sin receta) **pero nadie lo usa en el flujo real**. NO VERIFICADO: facturas de proveedor, notas de crédito y `ProveedorPorProducto` (no tienen literales; presunto que pasan por `productoValidoParaProceso`), reclasificar stock y resolver conteo pendiente (solo vi que cargan `tipo`).

## 3. Decisión de modelo (PROPUESTA técnica; sin ella no se puede hacer la migración)

| Opción | Qué es | Puntos a tocar | Riesgo |
|---|---|---|---|
| **R-A (recomendada)** | Reventa = `tipo PV` + `claseDeUso REVENTA` + `seProduce=false`, con **stock propio** y **comprable** | Compra (≈15: transiciones, selector, IVA, paso de compra, proveedor, presentaciones), stock (`tieneStockReal` + 17 llamadas), venta (origen de stock propio en vez de receta), reportes | Medio. Carta, POS, precio, nombre de cocina, opciones y combos **no se tocan** (ya son PV, ≈45 puntos) |
| R-B | Reventa = `tipo MP` + clase | Todo el circuito de venta (≈45), carta (≈25), CHECKs de nombre de cocina y base | Alto: se abre «lo que se vende» a un tipo que hoy nunca se vende |
| R-C | La Reventa sigue siendo un par; la clase es solo una etiqueta | 0 | No cumple lo pedido (**un** producto, igual a Pedernal) |

**Propuesta: R-A.** Se corresponde con Pedernal en resultado (un solo producto con su propio stock, que vende y se compra; `ERP: explosion.ts:23`, `clase-comprable.ts:5`, `vendeLaClase`). Diferencia declarada con Pedernal (motivo): Motor2 mantiene `tipo` y no lo reemplaza; la capacidad «se compra» pasa a leerse de una función única, no del `tipo` solo (Prisma + datos ya cargados).

**Núcleo único de capacidades** (PROPUESTA): una función pura `capacidadesDelProducto({ tipo, seProduce, claseDeUso })` → `{ seCompra, seVende, tieneStockPropio, sePuedeProducir, llevaReceta, esIngredienteDeReceta, loConsumeUnaOpcion }` en `core/catalogo/clases-de-producto.ts`. Para todo lo que existe hoy devuelve **exactamente** lo que hoy deciden los literales; solo `REVENTA` es nueva. Los puntos de decisión pasan a usarla **de a un circuito por PR**, no todos juntos.

## 4. Invariantes y políticas (nivel 5)

| # | Regla | Estado |
|---|---|---|
| R1 | Una Reventa se **compra y se vende**: lleva alícuota **de venta y de compra**, precio, sección de carta, nombre de cocina y opciones (las de un vendible), más proveedor y presentaciones de compra | CONFIRMADA en dirección (I4 y fila `REVENTA` del §5.1; Pedernal `0025:177-179`); alícuota de compra: PROPUESTA |
| R2 | **No tiene receta** ni se produce (`seProduce=false`, impuesto por `CHECK`) | CONFIRMADA en dirección |
| R3 | Lleva **stock propio**: la compra lo suma, la venta lo descuenta de **su** stock (FEFO, el mismo plan de las ventas de stock propio), no de otro producto | PROPUESTA (Pedernal: artículo propio) |
| R4 | La clase **no cambia** después de crear (disparador ya existente) | CONFIRMADA (2026-11-13) |
| R5 | **Solo para altas nuevas**: no se rellena `REVENTA` en productos existentes; los pares MP+PV siguen igual y no se unen en E4 | CONFIRMADA (2026-11-15, opción C) |
| R6 | Una Reventa se **vende solo si tiene alícuota** (como un vendible) y precio cargado en «Precios» (ver `docs/diseno-precio-fuera-del-alta-2026-11-17.md`) | PROPUESTA |
| R7 | **Una Reventa SÍ es ingrediente de receta y SÍ la consume una opción**, como Pedernal: la receta lleva materia prima, elaborado y reventa (el insumo no entra); una opción consume materia prima, insumo, reventa y elaborado (`ERP: composiciones.ts:125-130`, `clases.ts:20-29`). Se construye dentro de E4-3/E4-4 (receta, opción y consumo de stock), no en E4-0 a E4-2 | **CONFIRMADA** (2026-11-17, el dueño delegó los casos abiertos en Pedernal: «Preguntale a Pedernal, según sus reglas, cómo definirían esos casos»; Pedernal respondió con su código; decisión citada por el orquestador) |
| R8 | Todo nace cerrado: la alta ofrece Reventa **al final**, cuando ya funcionan compra, stock y venta | PROPUESTA |
| R9 | Los reportes no cambian de resultado: lo que hoy sale de MP o PV sigue igual; la Reventa nueva aparece en compras/valuación y en ventas/margen con su costo de compra | PROPUESTA; costo/margen de REVENTA: NO VERIFICADO |

## 5. Casos de uso y tabla «¿qué pasa si…?» (por comando)

| ¿Qué pasa si…? | Resultado esperado |
|---|---|
| **Repetición**: se repite el alta / una compra / una venta por reintento | Alta: el índice único de nombre rechaza la segunda. Compra y venta: las claves de idempotencia que ya tienen (sin cambios) |
| **Concurrencia**: dos ventas a la vez del último saldo de una Reventa | **Se hacen las dos y el saldo queda en −1**, sin filas perdidas ni duplicadas: hoy Motor2 NO valida el stock propio al vender (`faltantesDe` en `registrar-venta-en-tx` solo mira los insumos de receta; un PV que se produce vendido sin stock ya queda negativo, y el POS ya vendía con stock negativo). Verificado en E4-3a (2026-11-17) con pruebas contra Postgres; la Reventa hereda esa política. **Decisión (2026-11-17, el dueño delegó los casos en Pedernal):** sigue como hoy, igual que Pedernal por defecto (`ERP: src/modulos/stock/dominio/control.ts:5-20`: control por empresa `stock.existencia_negativa` con niveles PERMITIR —por defecto—, AVISAR y BLOQUEAR). El control configurable NO se construye (nadie lo pidió): queda como sugerencia, etapa aparte «control de existencia negativa» |
| Compra y venta a la vez | Ambas se serializan sobre el mismo saldo (misma regla) |
| Se vende una Reventa sin stock | Se registra y el saldo queda negativo, como hoy un PV que se produce (política vigente de Motor2 y valor por defecto de Pedernal, `control.ts:5-20`) |
| Se vende una Reventa sin alícuota o sin precio | Se rechaza o no está disponible (R6; igual que un vendible) |
| Se **anula** una venta de Reventa | Devuelve el stock a **su** saldo, con un movimiento nuevo (nunca se edita); `anular-item-enviado.ts:67` ya decide por `tieneStockReal` |
| Se **traspasa**, **cuenta** o **ajusta** su stock | Funciona como en una MP (por `tieneStockReal`); trazabilidad igual |
| Se intenta comprar un PV vendible común | Se sigue rechazando (la Reventa es la única PV comprable) |
| Se intenta **cambiar la clase** | Rechazado por el disparador |
| Se **duplica** una Reventa | Copia la clase, el tipo y los datos de compra y de venta; la copia empieza sin stock |
| **Par MP+PV** ya cargado | Sin cambios: sigue como MP + PV con receta 1:1 y su rótulo «Producto de reventa» |
| **Reportes** existentes | Mismo resultado antes y después (prueba de equivalencia, §8) |
| **Permisos**: quien crea no tiene `producto_campos_sensibles` | Igual que un vendible: crea sin precio ni alícuota; no se vende hasta que alguien con el permiso la complete |
| **Otra empresa** | Todo filtrado por empresa (RLS); sin cambios |
| **Migración** con datos reales | Solo relaja un `CHECK`: ninguna fila existente cambia; `down` aborta si ya hay `REVENTA` (no destruye) |
| **Error parcial** en la compra | Atomicidad existente: se registra todo o nada |
| **Datos faltantes** (sin proveedor, sin presentación) | «Pendiente de completar», no se inventa; igual que una MP |

## 6. Migración (PROPUESTA, aditiva y reversible; **no se aplica** en ninguna base sin autorización por base)

`prisma/migrations/<aaaammddhhmmss>_reventa_clase_de_uso/`:
- `migration.sql`: reemplaza `Producto_claseDeUso_tipo_chk` por la versión ampliada (`MP → MATERIA_PRIMA|INSUMO|ELABORADO`; `PV → VENDIBLE|REVENTA`) y agrega `Producto_claseDeUso_reventa_chk` (`"claseDeUso" <> 'REVENTA' OR NOT "seProduce"`). Mismo patrón que E1 (`NOT VALID` + `VALIDATE`). **No** agrega columnas, tablas ni datos.
- `down.sql`: **aborta (55000)** si hay productos `REVENTA`; si no hay, restaura los `CHECK` de E1. No borra nada.
- `verificacion-previa.sql`: cuenta productos con `claseDeUso='REVENTA'` (debe ser 0 antes de la migración) y verifica que los `CHECK` de E1 existen.
- Se actualizan: el test de migración de E1 (REVENTA deja de rechazarse), `columnas-de-significado.ts`, `duplicar-producto-columnas`, lista de migraciones del test de aislamiento (M1).
- **Autorización de schema:** hace falta turno de schema del orquestador general antes de escribirla (E4-1).

## 7. Plan en pasos chicos (cada uno es un PR con la compuerta completa; ninguno visible hasta E4-5)

| Paso | Qué | Cambia comportamiento hoy |
|---|---|---|
| **E4-0** | `capacidadesDelProducto` en el núcleo + prueba de **equivalencia**: para todo `(tipo, seProduce, claseDeUso ≠ REVENTA)` da lo que hoy deciden los literales; oráculo escrito aparte; el guardián falla si aparece una dimensión sin declarar. Sin cambio de comportamiento | No |
| **E4-1** | Migración de §6 + pruebas de base (REVENTA admitida con PV, rechazada con MP o con `seProduce`; `down`) | No (nadie escribe REVENTA todavía) |
| **E4-2** | **Compra** lee la función: selector, `transiciones`, alícuotas (venta y compra), «Cómo se compra», proveedor, presentaciones | No (no existen Reventas) |
| **E4-3** | **Stock, venta y receta**: `tieneStockReal` y las 17 llamadas; venta descuenta stock propio sin receta; anulación, conteo, traspaso; **la Reventa entra como ingrediente de receta y la consume una opción (R7)**; `capacidadesDelProducto` y su oráculo pasan a `esIngredienteDeReceta` y `loConsumeUnaOpcion` verdaderos para REVENTA. Pruebas de concurrencia e idempotencia con una Reventa sembrada en la base de prueba | No |
| **E4-4** | **Reportes, lista, ficha, duplicar**: costos/margen con costo de compra, chips, textos | No |
| **E4-5** | **El alta (y la alta rápida desde compra) ofrece «Reventa»**; `motivoDeClaseDeAltaInvalida` la admite; e2e completo (alta → compra → venta → anulación → reporte) | **Sí: aparece Reventa** |

Antes de cada paso: inventariar de nuevo los puntos del circuito contra el código (este inventario es del 2026-11-17).

## 8. Pruebas, combinaciones y operación (nivel 10)

- **Dimensiones** (cambian dinero, permisos, visibilidad o stock): clase (5) × tipo × `seProduce` × circuito (compra / venta / stock / receta / carta / costo) × permiso de campos sensibles. **Oráculo** en el diseño de clases §10.1, fila `REVENTA` (con R7 confirmada: ingrediente y consumida por opción); el test recorre todas las combinaciones contra él.
- **Equivalencia:** antes de que un circuito lea la función, una prueba compara el resultado nuevo y el viejo sobre todos los datos de prueba: **idéntico** (los reportes no cambian).
- **Concurrencia e idempotencia:** dos ventas simultáneas del último saldo; compra y venta a la vez; repetir alta, compra y venta (E4-3 y E4-5).
- **Pruebas locales** acotadas; la compuerta es el CI de GitHub (tsc, lint, arquitectura, knip, tests, build, plataforma:build, e2e).
- **Operación:** al terminar E4-5 se pide al dueño probar: crear «Reventa» → comprarla → venderla → anular la venta → ver el stock.
- **Capturas** (pantalla real, datos reales de la empresa, fuera del repositorio público): al construir E4-5.

## 9. Pregunta abierta (RESUELTA, 2026-11-17)

La pregunta era si una Reventa también se puede usar como ingrediente de una receta. El dueño delegó en Pedernal los casos abiertos («Preguntale a Pedernal, según sus reglas, cómo definirían esos casos») y Pedernal respondió con su código: **sí** (receta: materia prima, elaborado y reventa; opción: materia prima, insumo, reventa y elaborado). Pasa a R7 CONFIRMADA y se construye dentro de E4-3 y E4-4. Para la venta de una Reventa se sigue `ERP: explosion.ts:22-30`: una Reventa con artículo propio descuenta su propio artículo; sin artículo no es «falta receta»; un Vendible sin receta ni artículo no descuenta y avisa `FALTA_RECETA` (la venta pasa).

## 10. Qué NO entra

Unir pares MP+PV (E6), rellenar `REVENTA` en lo ya cargado, reglas de Insumo (E3), precio abierto, cambiar `tipo`, tocar reportes existentes, cualquier cambio en las ≈45 zonas de carta/POS que ya funcionan con PV.

## 11. Riesgos

Alto volumen de puntos (≈110 a 130): por eso el plan por circuito, con equivalencia antes de cada cambio. El circuito más delicado es **venta con stock propio sin receta** (concurrencia y anulación): E4-3, con pruebas de dos acciones simultáneas. NO VERIFICADO: facturas de proveedor, notas de crédito, reclasificación y resolución de conteo.
