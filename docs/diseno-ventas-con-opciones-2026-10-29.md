# Diseño: ventas con opciones — origen de stock de la línea y ventas por opción (2026-10-29)

**Estado: PROPUESTA, sin código.** Diseño por la escalera de 10 niveles, hecho por lectura estática de `origin/main` b17b2e30 (no se corrió nada ni se tocó ninguna base). Pedido del dueño (2026-10-29): arreglar la venta de productos con opciones y tener un reporte de ventas por opción, para no multiplicar productos («1 variante que define qué cambia de la receta base»); «sí, arrancá con 1 y 2». Los pasos 3 (ocultar el alta de ítems agrupados) y 4 (retirar sus tablas, destructivo) quedan fuera, como etapas posteriores con nombre.

Estados: CONFIRMADA (dicha por el dueño) / PROPUESTA / PENDIENTE / NO VERIFICADA.

## A. Hallazgos verificados en el código (con correcciones a lo que se creía)

**Dónde se rechaza hoy**
1. Agregar ítems (`src/server/actions/pos/casos-de-uso/agregar-items.ts`): lectura agrupada en la línea 124 (`cargarOrigenDeStockParaVender`), closure `sinReceta` en 126-129, rechazo del ítem suelto en **149-150**, que va *antes* de mirar las opciones (156-167): una línea configurada de una base con receta vacía nunca llega a `armarLineaConfigurada`. Otro rechazo para componentes de promo de sección en 223-224.
2. Barrera final (`src/server/actions/movimientos/casos-de-uso/registrar-venta-en-tx.ts`): 143 lee la receta vigente; **146-147** rechazan, antes del bloque de la línea configurada (160-172), que es el que suma los consumos de las opciones.
3. La regla: `src/core/movimientos/origen-de-stock.ts:29-32` (`seProduce || esAnclaDeAdicional || ingredientes > 0`).
4. El conteo: `src/server/lecturas/movimientos/receta-para-vender.ts:49-58` (`_count.ingredientes` de la receta efectiva: propia habilitada de la sucursal, si no la central). Solo mira la receta del producto.

**Corrección importante a lo dicho antes al dueño.** «Con un ingrediente mínimo en la base se vende y descuenta solo el insumo de la opción» es **falso en general** (`src/core/movimientos/consumo-de-linea-configurada.ts:198-220`): con una opción **SUMA** la venta descuenta el ingrediente base **más** el de la opción; descuenta solo el de la opción únicamente si esta **REEMPLAZA** ese ingrediente; con la base vacía un REEMPLAZA **no tiene efecto** (va a `reemplazosSinEfecto`) y solo producen consumo las SUMA.

**Qué descuenta la venta y dónde está la foto**
- `OpcionElegidaEnLinea` (prisma/schema.prisma ~3714) guarda `cuentaItemId`, `grupoId`, `opcionId`, `versionDeOpcionId`, `tipoGrupo`, nombres, `cantidad`, `importeUnitario`, `factorEscala`, `orden`. No guarda copia del consumo, pero `VersionDeOpcion` y `ConsumoDeOpcion` solo se agregan (`kardex-solo-agrega.test.ts`): la versión anotada fija el consumo para siempre.
- El cierre consume la versión **congelada**, nunca la vigente (`cargar-cuenta-para-cerrar.ts:69-90`, `124-140`; `cerrar-cuenta.ts:176-218`, «ninguna» va con `[]`).
- Al pedir, `armarLineaConfigurada` (`src/core/pos/linea-configurada.ts:147-165`) ya calcula el consumo con `base: []` pero no lo expone.
- Receta propia o central solo cambia la BASE; los consumos de la opción son de la empresa y no llevan rendimiento local.
- Costo congelado de la línea configurada: `registrar-venta-en-tx.ts:178`. Con la base vacía es el costo de lo que consumen las opciones.
- Venta de mostrador: nunca manda `configurada`; una base se rechaza antes con `PRODUCTO_REQUIERE_OPCIONES` (133-137). No la toca el arreglo.

**Otros que usan la misma regla (para no dejar dos definiciones)**
- `src/server/consultas/catalogo/espacio-del-producto.ts:64-69` (paso «receta»); `src/server/lecturas/catalogo/filtros-de-productos.ts:95-108` (filtro «le falta: receta»).
- `src/core/pos/componente-de-combo.ts:49`, llamado desde `componentes-de-combo-en-tx.ts:39-60` (alta de entrada de combo, puede llevar configuración fija), `entradas-de-promo-para-vender.ts:105` (una entrada que falla se descarta en silencio) y `menu-del-dia.ts:40` (el plato del día no lleva opciones, D-6).
- «Ventas sin receta» (`ventas-sin-receta.ts:24-33`) define sin receta como «la operación VENTA no tiene ninguna fila CONSUMO»: ya es coherente con el arreglo y sirve de verificación.
- «Insumos sin receta» y «Huecos de catálogo» usan `mpsEnRecetas` (`src/core/reportes/comun.ts:196-197`), que **no ve `ConsumoDeOpcion`**: otra definición ya existente («insumo vinculado»). Una botella que solo consume una opción aparece hoy como «insumo sin receta». Etapa posterior con nombre.
- La carta pública no filtra por receta; la disponibilidad no mira la receta.

**Reportes**
- «Ventas por producto» de Período (`periodo/page.tsx:146-149`, `src/server/consultas/reportes/periodo.ts:116-176`): lee filas VENTA de `MovimientoStock` por `Seccion.sucursalId` y `Operacion.fecha` (`rangoDeDias` en la zona de la empresa), descarta anuladas, ya marca `lineaConfigurada`; el margen real (`margen-real.ts`) reconstruye las configuradas con sus CONSUMO.
- **Nada agrega por opción.** La opción solo aparece en el ticket (`tickets-emitidos.ts`) y en «lo más pedido» del POS.
- La fila VENTA guarda `cantidad` negativa; una `Operacion` por línea neta; los espejos no llevan foto.

**Permisos**
- 131 claves en `acciones.ts`; `reporte_periodo` es de módulo `stock`, sucursal, piso administrador (línea 156).
- `reportes-con-permiso.test.ts` exige una clave por pantalla de `/reportes`; una clave nueva de reporte siempre vino con migración de datos.
- `periodo-sin-lineas.test.ts` **prohíbe la palabra «línea(s)» como texto visible** en `/reportes/periodo`.

**Documentos que condicionan**
- ADR-033 «sin receta no se vende» (regla fija del dueño; el ancla del adicional está exceptuada).
- ADR-030: decisión 7 (el consumo se declara sobre la opción, «como una receta, con materias primas», dueño 2026-10-12); GO-2a D-3 (los consumos exigen Recetas); supuesto 4 «`reporte_opciones_vendidas` entra con el reporte» (este diseño lo deja sin efecto, ver supuesto 1); pendiente «el margen nominal del Período costea por la receta del producto».
- `decisiones-cerradas-ola-precio-y-carta-2026-10-19.md`, Fase 4 punto 6: «margen por opción = mejora aparte». DEC-33: sin claves nuevas.
- `motor2-docs/_planes/preguntas-abiertas-grupos-de-opciones-cafe-2026-10-09.md`, pregunta 8 (reportes por combinación: qué pantalla, qué permiso): seguía abierta.
- `docs/mapa-cobertura-de-combinaciones-2026-10-28.md` NO está en `main` (solo en `alegp/carril-imp`). No existe guardián de «dimensión nueva sin declarar» para precio y stock; el molde es `test/core/features/traspasos/traspaso-guard.test.ts`.

**NO VERIFICADO:** los 207 productos del dueño; si en producción hay adicionales cuya opción no tiene consumo; si una receta propia de sucursal puede quedar habilitada y sin ingredientes; cómo se comporta «Rendimiento real de recetas» con una base sin receta.

## B. Punto 1 — Arreglo de ventas: origen de stock de una línea con opciones

1. **Propósito.** Que se venda una base sin receta propia cuando lo elegido descuenta insumos. Pedido del dueño 2026-10-29. CONFIRMADA. Fuera: ocultar/retirar ítems agrupados; avisar en POS/carta qué opción no descuenta.
2. **Actores.** Mozo/cajero con `pos_tomar_pedido` y `pos_cerrar_cuenta`; mostrador como puesto del salón (ADR-039); quien administra catálogo. Sin claves nuevas: no cambia ningún permiso. CONFIRMADA por ausencia.
3. **Casos de uso.** Pedir una base sin receta eligiendo una opción que suma un insumo: se agrega. Cobrar: descuenta el insumo de la opción. Opción sin consumo con base vacía: se rechaza con un mensaje que nombra la opción. Entrada de combo con configuración fija («Gaseosa · Coca») sobre base vacía: se carga y se vende. El espacio del producto y el filtro «le falta receta» dejan de marcar sin receta una base cuyas opciones descuentan.
4. **Conceptos.** *Origen de stock de una LÍNEA* = lo que esa línea descontaría (PROPUESTA, de ADR-033 y ADR-030 dec. 1). Tiene origen si: se produce (y no está configurada); es el ancla verificada de un adicional; la receta base vigente tiene ≥1 ingrediente; **o las opciones elegidas dentro del precio (no «ninguna», no ADICIONAL) suman al menos un insumo.** *Origen de stock de un PRODUCTO* (catálogo, sin línea): igual, con «**alguna** opción ofrecida (grupo y opción activos y admitidos, sin contar el apagado temporal) suma al menos un insumo» (PROPUESTA). La versión que manda es la de la foto: la vigente al pedir, congelada al cobrar.
5. **Invariantes y políticas.**
   - I1: una línea aceptada al cobrar genera ≥1 fila CONSUMO, salvo stock propio (`seProduce`) y la excepción del adicional sin consumo (pregunta abierta). I2: una línea rechazada no escribe nada (ni operación, ni Kardex, ni ticket, ni el comprobante de la clave). I3: una sola regla pura (`rechazoSinOrigenDeStock`); la barrera final la alimenta con los **pedidos reales** que van al libro (`pedidos.length` tras `consumoDeLineaConfigurada`): decisión y Kardex son lo mismo por construcción. I4: el chequeo temprano usa la MISMA función de consumo con `base: []` más el conteo de la base; si nada cambió entre pedir y cobrar, da el mismo veredicto.

   | Situación | Política (PROPUESTA) |
   |---|---|
   | Opción elegida sin consumo y base vacía | Rechazo `PRODUCTO_SIN_RECETA` (mismo código; mensaje nuevo que nombra la opción) |
   | Base con ingredientes | Se acepta siempre; consumo = base ± opciones, como hoy |
   | REEMPLAZA con base vacía | No cuenta (no hay qué reemplazar); si no hay ninguna SUMA, rechaza |
   | «Ninguna» elegida | Aporta cero |
   | Grupo opcional sin elegir y base vacía | Línea sin configurar: el rechazo de siempre |
   | Grupo obligatorio sin elegir y base vacía | Gana `OPCIONES_INVALIDAS` (antes ganaba `PRODUCTO_SIN_RECETA`): cambio de precedencia declarado |
   | Dónde se valida | En los dos lugares: agregar-items (aviso temprano) y registrar-venta-en-tx (barrera final), como ADR-033 §3 |
   | Adicional (ancla) | Sin cambios: sigue exceptuado (ver pregunta) |
   | Mensaje al pedir | «“Gaseosa 500 cc” con “Fanta” no descuenta ningún insumo: cargale el consumo a la opción en Catálogo → Biblioteca de opciones, o armá la receta de “Gaseosa 500 cc” en Catálogo → Recetas.» |
   | Mensaje de catálogo | «“X” no tiene receta ni opciones que descuenten insumos: armá la receta o cargale el consumo a sus opciones.» |
6. **Historia y persistencia.** Sin tablas ni migración: la foto con versión, los consumos que solo se agregan y el Kardex ya existen. Compuerta cumplida (niveles 1-5 primero).
7. **Atomicidad y concurrencia.** Sin cambio de mecanismo: ambas vías corren en `conTransaccionSerializable` y validan antes de escribir. Si la receta base se vacía entre pedir y cobrar, la barrera relee dentro de la transacción: vende con lo que leyó o rechaza, y la cuenta queda abierta. Una versión nueva de la opción no afecta lo ya pedido (foto congelada). La opción apagada la frena `validarOpcionesElegidas` al pedir.
8. **Acceso e interfaces.** Sin Server Actions ni claves nuevas. `OrigenDeStockDeUnPV` suma un campo opcional `opciones?: { insumos: number; nombres: readonly string[] }` (ausente = comportamiento idéntico). `LineaConfigurada` suma `insumosSinLaBase: number`. Función pura nueva en `core/pos`: `insumosQuePuedeSumarAlgunaOpcion(grupos)`. Lector nuevo `src/server/lecturas/movimientos/origen-de-stock-del-catalogo.ts` (envuelve `cargarOrigenDeStockParaVender` y, solo para productos con cero ingredientes, `cargarOpcionesParaVender`).
9. **Experiencia (escalera de producto).** N0 (hoy): rechazo «no tiene receta». N1 (este paso): vende; el mensaje nombra la opción que falta completar. N2 (posterior): POS, carta y espacio del producto marcan las opciones sin consumo.
10. **Pruebas, migración y operación.** Ver secciones D y F. Sin migración; volver atrás = revertir commits.

**¿Qué pasa si…? (agregar ítems / cerrar cuenta)**

| Caso | agregarItems | cerrarCuenta |
|---|---|---|
| Repetición o reintento | Con clave: un rechazo no consume la clave; el reintento valida de nuevo y escribe una sola vez | Por estado: `YA_CERRADA`, Kardex una sola vez |
| Concurrencia | SERIALIZABLE + índice único de la clave | Dos cierres: uno escribe, el otro ve la cuenta cerrada |
| Tiempo | No aplica | La receta base se relee; la opción, por la foto |
| Incertidumbre (cae la red) | Reintento con la misma clave | Reintento: `YA_CERRADA` |
| Error parcial | Todo o nada | Todo o nada; la cuenta queda abierta |
| Datos faltantes | Insumo de la opción sin MP, no disponible o en otra unidad: lo atrapa la barrera final (`revisarInsumosDeOpciones`), igual que la base hoy | Ídem |
| Cambio de permisos | Sin claves nuevas; apagar Recetas no borra consumos ya cargados | Ídem |

Lo mismo vale para `validarComponenteEnTx` (alta de entrada de combo) y la venta del combo: el rechazo sigue siendo `COMPONENTE_SIN_RECETA` o la entrada se descarta al vender, como hoy.

## C. Punto 2 — Ventas por opción

1. **Propósito.** Responder «¿qué se vendió de cada opción?» (Coca, Fanta, Wok de pollo): unidades, importe, costo y margen por período y sucursal. CONFIRMADA (pregunta del dueño).
2. **Actores.** Quien ve el reporte Período (`reporte_periodo`).
3. **Casos de uso.** Elegir un rango en Período y ver la tabla «Ventas por opción», exportable a CSV como las demás.
4. **Conceptos.** Fila = (producto, grupo, opción) del período. Unidades e importe de una opción = las ventas vigentes que llevaron esa opción **dentro del precio** (MEDIDA, VARIANTE, INCLUIDA y la «ninguna» elegida). Dentro de un grupo de elección única las filas suman el total del producto; entre grupos distintos no se suman (la misma venta aparece en «Grande» y en «Pollo»; se dice en la ayuda). Los ADICIONALES no van (ya aparecen como su producto ancla). Los componentes de combo con configuración fija entran, al precio prorrateado. PROPUESTA.
5. **Invariantes y políticas.**
   - Fuente de verdad: `OpcionElegidaEnLinea` → `CuentaItem.operacionId` → `Operacion` → filas VENTA de `MovimientoStock`. **Alcanza sin migración.**
   - Mismo filtro que «Ventas por producto»: `Seccion.sucursalId`, `Operacion.fecha` en `rangoDeDias(…, ctx.empresaZonaHoraria)`, `anuladaEn IS NULL`. Anuladas: fuera (la anulación es de la operación entera). Ítems anulados antes de cobrar: ya vienen netos (espejos). Ticket corregido: no crea ventas.
   - Unidades = |cantidad| de la fila VENTA. Dinero en centavos enteros (`round(sum(precioTotal)*100)::bigint`); costo = `round(sum(|cantidad| × costoUnitarioVenta), 2)` en centavos.
   - Margen = importe − costo, **solo si todas** las ventas de la fila guardaron su costo; si no: «costo incompleto (N de M ventas sin costo guardado)». No se reconstruye ni se inventa.
   - Dedupe con `DISTINCT ON (operacionId, opcionId)`; se muestra el nombre de la venta más reciente.
   - Invariante de prueba: en una base, la suma de unidades del grupo MEDIDA es igual a las unidades del producto en «Ventas por producto».
6. **Persistencia.** Ninguna; consulta de solo lectura.
7. **Concurrencia.** Lectura sin bloqueo; una venta que entra mientras se mira aparece al recargar.
8. **Acceso.** Se reutiliza `reporte_periodo` como sección de una pantalla existente (la regla «una clave por pantalla» no aplica; Período ya muestra importe y margen por producto con esa clave, no se ensancha nada; una clave nueva exigiría migración de datos). Esto deja sin efecto el supuesto 4 de ADR-030 (se anota en el ADR). Módulo: el de la pantalla (`stock`); sin Salón la tabla queda vacía. Aislamiento: `ctx.db` (RLS por empresa y sucursal; la foto es `HEREDADA` de `CuentaItem`) más filtro explícito por sucursal en el SQL. No se lee `VersionDeOpcion` ni `ConsumoDeOpcion` (lo exige `lectores-de-version-de-opcion.test.ts`).
9. **Experiencia.** Sección «¿Qué opción se vende más? Ventas por opción» debajo de «Ventas por producto». Columnas: Producto, Grupo, Opción, Unidades, Importe, Costo al vender, Margen (%). `TablaReporte` con `nombreExport="ventas-por-opcion"`. Sin datos: «No hubo ventas con opciones en el período.» Prohibido escribir «línea(s)». Escalera: N1 unidades e importe; N2 costo y margen; posterior: N3 Consolidado multi-sucursal y adicionales colgados de su producto; N4 costo reconstruido y margen nominal por opción.
10. **Pruebas y operación.** Ver D y F. La pantalla ya está cubierta por axe en `test/e2e/accesibilidad.spec.ts:796-830`; se suma un e2e con datos.

| ¿Qué pasa si…? | Lectura |
|---|---|
| Repetición | Idempotente |
| Concurrencia | Foto de lectura |
| Tiempo | El corte de día va en la zona de la empresa |
| Incertidumbre | Recargar |
| Error parcial | No aplica |
| Datos faltantes | Costo incompleto, rotulado |
| Cambio de permisos | Gate `reporte_periodo` en la página |

## D. Pasos de implementación (uno por commit; ninguno toca el esquema ni migra)

- **Paso 0 (sin commit).** Línea de base: gate completo (sección F) y anotar «Test Files / Tests» de `npm test` y «Total» de `npx playwright test --list`.
- **Paso 1. Regla pura y barrera final al cobrar.** `origin-de-stock.ts` (campo opcional `opciones` y los dos mensajes nuevos), `public.ts` si hace falta, `registrar-venta-en-tx.ts`: si `configurada?.tipo !== "PRODUCTO"` el chequeo queda donde está (146); si es `PRODUCTO` se saltea ahí y, tras `consolidarPedidosPorInsumo` (171), se llama a `rechazoSinOrigenDeStock({..., ingredientesDeLaRecetaVigente: ingredientes.length, opciones: { insumos: pedidos.length, nombres } })`. Tests: matriz pura en `test/core/origen-de-stock.test.ts`; integración nueva `test/pos/cobrar-base-sin-receta-con-opciones.test.ts` (línea sembrada sin pasar por agregar; con SUMA vende con CONSUMO; sin consumo rechaza sin escribir). **No deben cambiar** `venta-con-opciones.golden.txt` ni `venta-matriz-ampliada.golden.txt`; si cambian, frenar.
- **Paso 2. Aviso temprano en el POS.** `linea-configurada.ts` (`insumosSinLaBase = consumo.pedidos.length`, aditivo) y `agregar-items.ts` (el chequeo de 149-150 se parte: sin opciones, donde está; con opciones, después de `armarLineaConfigurada`; con `armada.linea === null`, el chequeo de la base antes de `esBase`). Tests: propiedad fast-check `insumosSinLaBase > 0 ⇔ consumoDeLineaConfigurada({base: []…}).pedidos.length > 0`; matriz de integración en `test/pos/venta-con-opciones-sin-receta-base.test.ts`; concurrencia e idempotencia (sección E); actualizar **declarando** `test/pos/venta-exige-receta.test.ts`. `agregar-items-consultas.test.ts` no debe cambiar (cero lecturas nuevas). Enmienda en ADR-033 citando solo rutas que existen (`adr-al-dia.test.ts`).
- **Paso 3. Combos con configuración fija.** `componente-de-combo.ts` (campo opcional), `componentes-de-combo-en-tx.ts:58`, `entradas-de-promo-para-vender.ts:105`. Tests: `entradas-de-cupo-go3.test.ts`, `cerrar-combo-configurado-go3.test.ts` (entrada «Gaseosa · Coca» sobre base vacía: se carga, se vende y descuenta Coca).
- **Paso 4. Catálogo con la misma definición.** Lector nuevo, función pura en `core/pos`, `espacio-del-producto.ts:64-69`, `filtros-de-productos.ts:101-108`; declarar la puerta nueva en `test/aislamiento/denegacion/generadores.ts` (molde línea 377). Tests: `espacio-hechos.test.ts` (privacidad: solo con `permitidas.receta`) y `filtros-de-productos.test.ts`. Si cambia `dinero-tramo-c.golden.txt` (NO VERIFICADO), declararlo con motivo en `caracterizaciones-congeladas.test.ts` o frenar.
- **Paso 5. Ventas por opción: núcleo y consulta.** `src/core/reportes/ventas-por-opcion.ts` (`FilaVentaPorOpcion`, `armarVentasPorOpcion`; exportar en `public.ts`) y `src/server/consultas/reportes/ventas-por-opcion.ts` (`import "server-only"`, un `$queryRaw` agregado como `ventas-sin-receta.ts`: CTE con filas VENTA por operación más fotos `DISTINCT ON (operacionId, opcionId)` con `tipoGrupo <> 'ADICIONAL'`). Declarar la consulta en `test/aislamiento/denegacion/`. Tests: `test/core/reportes/ventas-por-opcion.test.ts` y el de Postgres `test/reportes/ventas-por-opcion.test.ts` con el oráculo de E.
- **Paso 6. Sección en Período.** `periodo/page.tsx` (una llamada más en el `Promise.all`, mismo rango y `empresaZonaHoraria`), `tabla-periodo.tsx` (`TablaVentasPorOpcion`); nota en ADR-030 supuesto 4; e2e nuevo `test/e2e/reportes-ventas-por-opcion.spec.ts` con datos y AxeBuilder.
- **Paso 7.** Gate final (sección F).

## E. Concurrencia, idempotencia y oráculo de combinaciones

**Concurrencia** (Postgres real; molde de intercalación forzada de `venta-opciones-obligatorias.test.ts:204-243` y `venta-exige-receta.test.ts:198-283`):
- C1: el cierre ya tomó su foto cuando la sucursal vuelve a la receta central vacía y la opción no tiene consumo → o vende con la receta que leyó (con CONSUMO) o reintenta y rechaza sin escribir; nunca una venta sin consumo.
- C2: versión nueva de «Coca» sin consumos entre pedir y cobrar → el cobro descuenta según la v1 de la foto.
- C3: dos cuentas cobran a la vez Gaseosa-Coca con base vacía → dos operaciones y dos CONSUMO, sin pérdida (el stock puede quedar negativo con aviso).
- C4: dos `cerrarCuenta` de la misma cuenta → una operación VENTA y un solo CONSUMO.

**Idempotencia:** I1: con clave, rechazo por falta de consumo → no queda `AgregadoDeCuenta` ni filas; se arregla la base (o se habilita la receta propia) y se reintenta con el mismo payload y clave → agrega una vez; un tercer reintento devuelve el mensaje original sin filas nuevas (si se arregla la opción, la versión vista cambia y el reintento da `OPCION_CAMBIO`: hay que volver a elegir). I2: atomicidad: cuenta con «Coca» (válida) y «Fanta» (sin consumo tras vaciarse la base) → el cierre no escribe nada y la cuenta queda abierta.

**Oráculo puro** (aparte del código, `test/core/movimientos/oraculos/origen-de-stock-con-opciones.ts`, más un test que recorre todo). Dimensiones: B base (con X / vacía) · P `seProduce` (no / sí) · L tipo de línea (sin configurar / PRODUCTO / ADICIONAL) · G grupo (MEDIDA / VARIANTE / INCLUIDA) · C consumo de la opción (ninguno / «ninguna» / SUMA Y / REEMPLAZA X→Y / REEMPLAZA Z→Y con Z fuera de la base / SUMA Y + REEMPLAZA X→W).
- Sin configurar: acepta ⇔ P o B con X. PRODUCTO con P: rechaza («se produce por lote»). PRODUCTO con B = X: acepta siempre; descuenta: ninguno/«ninguna» {X}, SUMA Y {X,Y}, REEMPLAZA X→Y {Y}, REEMPLAZA Z→Y {X}, SUMA Y + REEMPLAZA X→W {W,Y}. PRODUCTO con B vacía: acepta solo con SUMA (SUMA Y → {Y}; SUMA Y + REEMPLAZA X→W → {Y}); los demás rechazan. ADICIONAL: acepta (excepción vigente); con SUMA → {Y}; sin consumo → ∅ (pendiente de la pregunta). G no cambia el veredicto; un caso de MEDIDA con factor y `escalaConLaMedida` verifica la cantidad.
- 4 + 72 + 2 = **78 casos**, contra `rechazoSinOrigenDeStock` y `consumoDeLineaConfigurada`.

**Matriz de integración** (Postgres): modo de venta {DIRECTO con VARIANTE opcional, BASE_CONFIGURABLE con MEDIDA ABSOLUTO} × base {vacía, con X} × fuente de la receta efectiva {central, propia habilitada, con la otra fuente en el estado contrario} × consumo {ninguno, SUMA Y, REEMPLAZA X→Y} = **24 casos**. En cada uno: veredicto de agregar = veredicto de cobrar; conjunto de CONSUMO = oráculo; al final «Ventas sin receta» vacío. No hay guardián de dimensiones al que declarar (matriz 8 pendiente en el mapa de combinaciones, que vive fuera de `main`).

**Oráculo del reporte** (`test/reportes/ventas-por-opcion.test.ts`). Dimensiones: operación vigente o anulada × ítem anulado antes del cierre × MEDIDA/VARIANTE/INCLUIDA/«ninguna»/ADICIONAL × dentro de un combo × costo congelado sí/no × sucursal activa u otra × empresa propia o ajena × fecha dentro, fuera y en el borde (23:30 hora argentina). Se espera: solo cuentan las vigentes de la sucursal y el rango; los espejos restan; el ADICIONAL no aparece; sin costo la fila dice «costo incompleto»; la suma de unidades del grupo MEDIDA es igual a las unidades del producto en `obtenerReportePorPeriodo`.

## F. Pregunta abierta, supuestos, prueba del dueño y gate

**Única pregunta al dueño (cambia stock) — PENDIENTE:** un ADICIONAL cuya opción no tiene consumo cargado (p. ej. «Extra salsa» sin insumo), ¿se sigue vendiendo sin descontar nada, como hoy, o se rechaza como un producto sin receta? Mientras no conteste, queda como hoy (excepción declarada a I1, fijada por un test). Si dice «rechazar», es un paso más con la misma regla, pero rompe ventas en curso si hay adicionales así en producción (NO VERIFICADO).

**Supuestos (PROPUESTA, una línea cada uno):** 1) el reporte reutiliza `reporte_periodo` como sección de Período (deja sin efecto el supuesto 4 de ADR-030; sin clave nueva ni migración); 2) en el catálogo el origen de stock se mide como «alguna opción ofrecida suma un insumo»; 3) con base vacía y grupo obligatorio sin elegir gana `OPCIONES_INVALIDAS`; 4) los mensajes nuevos mantienen el código `PRODUCTO_SIN_RECETA`; 5) los adicionales no entran en «Ventas por opción»; 6) los combos con configuración fija sí entran, al precio prorrateado; 7) el costo del reporte es solo el congelado al vender; 8) margen nominal por opción, Consolidado e «Insumos sin receta / Huecos que ven ConsumoDeOpcion» quedan como etapas posteriores con nombre.

**Prueba que puede hacer el dueño sin leer código**
1. Preparar: «Gaseosa 500 cc» se vende por opción y no tiene receta propia. En la Biblioteca de opciones, a «Coca» cargale el consumo «1 unidad de Coca botella 500»; dejá «Fanta» sin consumo. Cargá una compra de 10 Coca botella.
2. Pedir: en el POS, abrí una mesa y agregá Gaseosa 500 cc eligiendo Coca ×2: se agrega (antes del arreglo daba «no tiene receta»). Después elegí Fanta: aparece «“Gaseosa 500 cc” con “Fanta” no descuenta ningún insumo…».
3. Cobrar: en Stock, «Coca botella 500» queda en 8.
4. Reporte: Reportes → Período (hoy), «Ventas por opción» muestra Gaseosa 500 cc · Coca: 2 unidades, importe = 2 × precio, costo = 2 × el de la botella y su margen; «Ventas por producto» muestra las mismas 2 unidades.
5. Anular la venta desde Trazabilidad: la fila de Coca desaparece del período y el stock vuelve a 10.
6. Reportes → «Ventas sin receta» queda vacío.

**Gate final (paso 7)**, en la MISMA corrida y todos limpios, con línea de base antes y conteo igual o mayor después:
```
flock /tmp/pesado.lock env NODE_OPTIONS=--max-old-space-size=6144 sh -c '
  npx tsc --noEmit && npm run lint && npm run arquitectura && npm run analizar:muerto &&
  npm test && npm run build && npm run plataforma:build && npm run test:e2e'
```
Criterio: `tsc` sin salida; `lint` 0/0; `arquitectura` código 0; `knip` 0 hallazgos; `npm test` todo verde con «Test Files» y «Tests» ≥ línea de base; `build` y `plataforma:build` OK; Playwright todo verde con «Total» ≥ línea de base.

Specs e2e que ejercitan lo tocado: `pos-opciones`, `pos-mesa-opciones`, `pos-promo-combo`, `pos-menu-del-dia`, `movimientos-menu-del-dia`, `carta-promo-cupos-lista`, `espacio-del-producto`, `catalogo-ficha-producto`, `catalogo-productos-filtros`, `catalogo-producto-base`, `periodo-y-tickets-mismo-dia`, `reportes-margen-principal`, `reportes-permisos`, `reportes-consolidado-promociones-categorias`, `venta-anular-trazabilidad`, `accesibilidad`. Specs nuevos: `pos-base-sin-receta-con-opciones.spec.ts` (Coca se agrega; Fanta muestra el mensaje) y `reportes-ventas-por-opcion.spec.ts` (fila con datos más AxeBuilder). NO VERIFICADO si `sembrarProductoConOpciones` (`test/e2e/fixtures/opciones.ts`) admite el modo base con MEDIDA ABSOLUTO; si no, se amplía la fixture. Si algún guardián exige declarar algo (`test/aislamiento/denegacion/`, `consumidores-de-lecturas-declarados`, `server-only-en-consultas-y-lecturas`, `caracterizaciones-congeladas`), se declara con su motivo; nunca se regenera un golden a ciegas.
