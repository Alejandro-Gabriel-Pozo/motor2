# Auditoría — lectores de «stock disponible» (insumo de la etapa ii de cuarentena y rechazo) — 2026-11-17

Estado: INVENTARIO FACTUAL (solo lectura sobre `origin/main` 9e5c9fe9), hecho por un agente de exploración; las rutas:línea no fueron releídas una por una por el orquestador de Compras. Lo no verificado está marcado. Documento pedido por el orquestador general (2026-11-17) como paso previo a la etapa (ii) de `docs/diseno-compras-cuarentena-y-rechazo-2026-11-17.md`.

**Necesidad que sirve:** decisión del dueño 2026-11-17 («4.-lo recomendado»: como Pedernal) y regla de Pedernal: lo que está en depósitos de uso RECHAZO o CUARENTENA no cuenta como disponible para vender.

## Hechos estructurales
- No existe saldo materializado, tabla de saldo, vista ni función SQL de saldo. El saldo es siempre `SUM(MovimientoStock.cantidad)` calculado al leer, con Prisma (`aggregate`/`groupBy`) o SQL crudo (`prisma/schema.prisma` ~1469).
- `Seccion` no tiene columna `uso` (solo `activa` y `sirveDeRespaldoEnVentas`).
- No hay un punto común único. Hay un módulo de lectores centrales (`src/server/lecturas/movimientos/saldos.ts`, 7 funciones, ~9 consumidores) y ~14 `groupBy`/`aggregate` sueltos que arman su saldo cada uno por su cuenta.
- El único disparador sobre `MovimientoStock` es `MovimientoStock_producto_oculto_trg` (migración 20261115160000): valida por producto oculto, no por tipo de movimiento ni por sección. Los CHECK por proceso (20261002160000) tampoco miran la sección. No hay nada análogo al `deposito_validar` / 0064 de Pedernal.
- La carta pública NO lee stock (la disponibilidad de un plato es manual). Solo el panel admin de la carta y el selector del POS muestran un aviso de stock teórico (nunca bloquea).
- «Origen de stock para vender» (`cargarOrigenDeStockParaVender`) no es un lector de saldo (cuenta ingredientes de receta). Los «lectores de disponibilidad» de `ocultar-producto-dimensiones.test.ts` son la marca Desactivar del producto: otro concepto.

## Inventario por grupo (P = Prisma, R = SQL crudo, F = función pura)
**(a) Venta (mostrador, salón, cierre de cuenta del POS).** Todas pasan por `registrarVentaEnTx`; el control único es `prepararOrigen` + `cargarHabituales`.
- `src/server/persistencia/movimientos/cargar-origen-de-venta.ts:39-40` `prepararOrigen` (candidatas: secciones activas con `sirveDeRespaldoEnVentas`); `:65-69` `cargarDatosDeOrigen` (saldos por producto-sección-lote); `:88-89` respaldo y sección por defecto; `:103-110` `cargarHabituales` (+ `core/stock/seccion-habitual.ts:6`); `:117-122` `cargarReferencias`.
- `core/movimientos/origen-venta.ts:71-118,410` (`crearLibroDeStock`, `faltantesDe`), `plan-de-la-venta.ts:49,140-160` (F, sobre lo ya cargado).
- `lecturas/movimientos/saldos.ts:63` `seccionesConStock`; `:190` `saldosTeoricosEnSucursal` (suma todas las secciones; consumidores: `consultas/pos/opciones-del-selector.ts:50`, `consultas/catalogo/opciones-por-sucursal.ts:112`, `consultas/carta/avisos-de-stock.ts:28`).
- `actions/movimientos/secciones.ts:52` `listarSeccionesActivas` (alimenta 11 pantallas: mostrador, salón, procesos, traspasos, conteo, mínimos, habitual, reclasificar, reportes).
**(b) Descuento por recetas, producción y consumo.** `saldos.ts:29` `calcularSaldoTotal`, `:47` `validarStockSuficiente`, `:107` `obtenerLoteMasProximoAVencer`, `:137` `resolverConsumoPorFamilia`; consumidor principal `registrar-movimiento.ts:67,107-109,151` (valida sección propia y activa, no el uso).
**(c) Carta pública y portal.** Cero lectores de saldo; tres avisos de panel admin (arriba).
**(d) Reportes.** `consultas/stock/consolidado.ts`, `alertas.ts`, `por-familia.ts`; `consultas/reportes/resumen-operativo.ts`, `resumen-consolidado.ts`, `valuacion.ts`, `vencimientos.ts` (2), `consignacion.ts`, `historial-producto.ts` (P+R), `rendimiento-recetas.ts`; `consultas/movimientos/stock-para-conteo.ts`. Los reportes de flujos (ventas, compras, costos, pérdidas) no son de saldo. No hay reporte de rotación de stock.
**(e) Traspasos, conteos y ajustes.** Ninguna capa (ni app ni base) restringe hoy qué secciones pueden ser origen o destino por tipo de movimiento: `registrar-movimiento.ts`, `reclasificar-stock.ts`, los casos de uso de traspasos y `registrar-conteo-fisico.ts` validan solo «sección propia y activa».
**(f) Existencia general (NO deben excluir RECHAZO/CUARENTENA):** `lecturas/catalogo/dependencias-para-desactivar.ts:37`, `existencia-para-ocultar.ts:11`, `ocultamiento.ts:50`, `persistencia/compras/cargar-compra-para-anular.ts:53`.
**(g) Escrituras que habría que restringir hacia secciones especiales:** hoy 6 casos de uso eligen la sección (`registrar-movimiento.ts`, `reclasificar-stock.ts`, traspasos ×4, `confirmar-recepcion-de-factura.ts`, `set-seccion-habitual.ts`, `crear-seccion.ts`). Las anulaciones son contra-asientos a la sección original y deben seguir permitidas.

## Cuantificación (según el agente)
- ~33 puntos de código suman `MovimientoStock` para dar un saldo o existencia.
- ~19 habría que tocar para que RECHAZO/CUARENTENA no cuente como disponible:
  - ALTO riesgo (6): `prepararOrigen`, `cargarHabituales`, `cargarDatosDeOrigen` (la venta: un error vende stock no vendible o rechaza ventas legítimas), `validarStockSuficiente`/`calcularSaldoTotal` en `registrar-movimiento`, `resolverConsumoPorFamilia`, la recepción de compras.
  - MEDIO (9): consolidado, alertas, por-familia, resumen-operativo, resumen-consolidado, valuación, vencimientos ×2, stock-para-conteo (este no se filtra: el conteo SÍ debe poder contar cuarentena/rechazo; solo se etiqueta).
  - BAJO (4): `saldosTeoricosEnSucursal` (solo avisa), consignación, historial, rendimiento-recetas.
  - NO tocar: los de existencia real (f).

## Puntos de mayor apalancamiento
1. **Venta:** filtrar `uso = NORMAL` en `prepararOrigen` y `cargarHabituales` cubre mostrador y POS, respaldos, sección por defecto y habitual. Falta validar el uso de la sección elegida en modo `seccion` (`:30-37`).
2. **Escrituras:** no hay punto único en la app; la red común es la base: un disparador `BEFORE INSERT` sobre `MovimientoStock` (mismo patrón que el de producto oculto) que lea `Seccion.uso` y rechace según `MovimientoStock.proceso`. Costo: migración aditiva con `down.sql`.
3. **Reportes:** no hay función común. Alternativa: un helper compartido `whereSeccionDisponible(sucursalId)` (como `whereDisponibleEn` o `whereSeccionHabitualVigente`, que ya existen en el core) que cada `groupBy` sume a su `where`.

## Decisiones
- Valuación y consolidado: se adoptan como Pedernal (arriba), sin preguntar («Sí, todo como Pedernal», dueño, vía orquestador).
- **RESPONDIDA por el dueño (2026-11-17, chat, relatado por el orquestador; registrado): «5a» → CONFIRMADO: la cuarentena y el rechazo NO cuentan contra el stock mínimo (mínimo 10 kg, 4 kg normales y 8 kg en cuarentena: avisa que faltan 6 kg). Entra en la etapa (ii) (alertas y resumenes de stock bajo), con su oráculo y sus pruebas.** Antes era la única pregunta que Pedernal no respondía: el stock mínimo. Pedernal no tiene stock mínimo; Motor2 sí. ¿La mercadería que está en rechazo o en cuarentena debe contar para llegar al mínimo de la sección? Ejemplo: mínimo de 10 kg de harina, hay 4 kg en el depósito normal y 8 kg en cuarentena. Si cuenta, no avisa faltante (12 ≥ 10); si no cuenta, avisa que faltan 6 kg. Recomendada: que NO cuente (coherente con «no suma a lo disponible»). (Texto de la pregunta original, ya respondida.)

## Qué hace Pedernal en las tres lecturas (agregado 2026-11-17; origen/main de ZuluHub-ERP y ZuluHub-docs)
- **Valorización: Pedernal INCLUYE todos los usos y no los muestra aparte.** `valorizacion` une saldo con depósito sin condición sobre `uso` (ERP `src/modulos/stock/persistencia/costos.ts:212-245`; `consultas/costos.ts:60-90`). Ningún documento lo define (NO DEFINIDO en docs). Adopción propuesta: igual que Pedernal (Motor2 valoriza todo, sin desglose), declarando que es el comportamiento del código de Pedernal sin documento que lo respalde.
- **Stock mínimo: Pedernal NO lo tiene** (ni código ni diseño: solo «futuro» en `catalogo-y-stock.md:125` y `00-vidrieras-por-modulo.md:186`). NO DEFINIDO. Motor2 sí lo tiene (`consultas/stock/stock-minimo.ts`, alertas): es una pregunta para el dueño.
- **Consolidado / existencias: Pedernal lista una fila por (artículo, depósito)** con `existencia`, `uso` y `disponible`; cuarentena y rechazo salen en su fila con su cantidad real y `disponible = 0` (ERP `consultas/existencias.ts:21-117`; `stock.html:360`: «los depósitos de cuarentena y rechazo se marcan y no suman a lo disponible»). No hay consolidado por producto ni por sucursal. Adopción propuesta: Motor2 marca la sección por uso y no suma RECHAZO/CUARENTENA a lo disponible.
- **«Disponible»** (ERP `dominio/disponibilidad.ts:3-23`, `lectura-de-lotes.ts:91-94`): solo cuenta depósitos de uso NORMAL (más reglas de lote y vencimiento que Motor2 resuelve aparte); la venta rechaza un depósito que no sea NORMAL (`salida-por-venta.ts:324-338`). Fuentes del dueño: CYN 118 (08/11/2026) «no suma al disponible» y fila 208 de decisiones, 16/11.

## Movimientos permitidos en depósitos CUARENTENA y RECHAZO (VERIFICADO contra el SQL de Pedernal, 0030:665-668, 0064:52-56, 0084:237-242)
Solo: TRANSFERENCIA, AJUSTE, AJUSTE_POR_CONTEO, ANULACION, ENTRADA con motivo COMPRA y origen RECEPCION, y SALIDA con motivo DEVOLUCION_A_PROVEEDOR y origen DEVOLUCION_A_PROVEEDOR. Todo otro ingreso o egreso se rechaza (`renglon_deposito_de_uso_restringido`). Las ANULACIONES siempre están permitidas y son el espejo exacto del original (`0030:801-820`); no se anula una anulación ni un conteo. Un depósito inactivo no admite ningún movimiento.
Pendiente de mapear (NO VERIFICADO): cómo distingue Motor2 una anulación (contra-asiento de signo inverso, sin proceso propio) de una entrada normal.

## NO VERIFICADO
- El mapeo de los 16 procesos de Motor2 a esos nombres es inferido. Las anulaciones son contra-asientos con el signo inverso (sin proceso propio): una regla por `proceso` en la base no las distingue de una entrada normal sin leer cómo se marca la anulación en `MovimientoStock` (no verificado).
- No se evaluó cuántos tests cubren cada lector; no se leyeron a fondo `consultas/stock/en-transito.ts`, `sugerencia-clase-a.ts`, `rendimiento-recetas.ts` (730+ líneas, solo los saldos por corte) ni los scripts de siembra.

## Etapas propuestas para (ii)
- (ii-a) Venta: `uso = NORMAL` en origen de venta y habitual; validar el uso de la sección elegida; pruebas de concurrencia y combinaciones.
- (ii-b) Base: disparador sobre `MovimientoStock` con la lista de procesos permitidos hacia/desde usos especiales (migración aditiva; turno de schema).
- (ii-c) Reportes de saldo con el helper compartido, según lo que decida el dueño en las tres preguntas.
