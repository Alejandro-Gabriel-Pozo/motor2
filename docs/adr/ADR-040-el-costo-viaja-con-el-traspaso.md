# ADR-040: El costo viaja con el traspaso

> Redactado el 2026-10-27 (rama `alegp/carril-x`, etapa E2 del diseño `docs/diseno-circuito-de-abastecimiento-2026-10-27.md`; diseño propio en `docs/diseno-costo-en-el-traspaso-2026-10-27.md`). **Estado: decidido por el dueño el 2026-10-27 (compra mixta; costo = la entrada más reciente, V-T1; columna `TraspasoSucursal.costoUnitarioOrigen` autorizada; el traspaso no mueve el gasto). Implementación en curso en esta rama. La migración es aditiva y REQUIERE AUTORIZACIÓN EXPRESA para aplicarse en una base real: no está aplicada en ninguna (solo en las bases locales de prueba).**

## Contexto

Una sucursal puede comprar y repartir a otras por traspaso (compra mixta, decisión del dueño). Hasta hoy las cuatro líneas de Kardex de un traspaso (salida, entrada, reingreso) se escribían con `precioTotal = 0` y `precioPorUnidadStock = 0` (`src/server/persistencia/traspasos/escribir-movimiento-de-traspaso.ts`), y el costo de reposición (`src/server/lecturas/reportes/comun.ts`) solo miraba COMPRA. La sucursal que recibe quedaba sin costo, sin margen y sin valuación.

## Decisión

1. **El origen fija el costo al enviar**: en la misma transacción SERIALIZABLE que escribe la salida y el traspaso ENVIADO (aprobación de una solicitud o envío directo), lee su costo de reposición del producto (`obtenerCostoActualDeProducto`, la misma consulta de siempre acotada a un producto) y lo copia en `TraspasoSucursal.costoUnitarioOrigen` (DECIMAL(14,4), NULL, CHECK ≥ 0).
2. **Las tres líneas usan la copia**: salida, entrada y reingreso llevan `precioPorUnidadStock` = la copia exacta y `precioTotal` = `importeDeLinea(|cantidad|, copia)` (decimal exacto, un redondeo a centavos; `valorizarLineaDeTraspaso` en `src/core/stock/costo-del-traspaso.ts`). La aceptación y el reingreso leen la copia del traspaso, nunca el costo del origen de ese momento: una compra posterior en el origen no cambia lo que ya viajó.
3. **Sin costo en el origen el traspaso sigue funcionando**: la copia queda NULL («pendiente de completar») y las líneas en 0, que los lectores excluyen con `> 0`. Nunca se inventa un costo.
4. **Regla V-T1**: el costo de reposición es la entrada valorizada local más reciente, sea COMPRA o `TRANSFERENCIA_ENTRADA_SUCURSAL` (`PROCESOS_QUE_FIJAN_EL_COSTO`, `src/core/reportes/comun.ts`), en `obtenerCostoActualPorMPDeSucursales` y en el costo reconstruido por día (`src/server/consultas/reportes/costo-historico.ts`). El reingreso queda afuera.
5. **El traspaso no mueve el gasto**: Período, `totalGastado`, gasto por insumo y el ratio compras/ventas siguen filtrando COMPRA. El gasto por sucursal es la factura repartida (E3a).
6. **Variante B (columna en el traspaso) y no A (leer la salida del origen)**: la salida es una línea de `MovimientoStock` del origen, que la RLS por sucursal no deja ver al destino; leerla exigiría usar `lecturaDeVerificacionEnLaEmpresa` para traer un importe de otra sucursal, fuera de su contrato (solo sí/no o mensajes), con una excepción nueva a ADR-028. `TraspasoSucursal` ya es de las dos puntas (ENTRE_SUCURSALES).
7. **Datos viejos sin relleno**: traspasos y líneas anteriores quedan en NULL/0; no se recalcula nada.
8. **Campo sensible**: `TraspasoSucursal.costoUnitarioOrigen` es dinero, piso `administrador` (GT-1); la bandeja de traspasos no lo pide. No se audita por columna: lo escribe el sistema una sola vez al enviar y su rastro es la salida del Kardex con el mismo precio (excepción declarada en `test/arquitectura/escrituras-auditadas.test.ts`).

## Consecuencias

- Pasan a tener costo en el destino: Valuación, Costos y márgenes (food cost), costo congelado de la venta, Pérdidas, Devoluciones, Rendimiento de recetas, Consolidado y el margen nominal de Período.
- No cambian: compras del período, gasto, ratio compras/ventas, precios de compra, Diferencias.
- El historial de un producto muestra el importe de las líneas de traspaso (con la clave de importes).
- La huella de los escritores del Kardex (`test/persistencia/__golden__/kardex-escritores.golden.json`) se regenera y se declara en `test/arquitectura/caracterizaciones-congeladas.test.ts`.
- Reversa: volver el código y después `down.sql` (aborta si ya hay costos copiados).

## Alternativas descartadas

- Variante A (sin migración): ver punto 6.
- Costo promedio ponderado: cambia el método de costeo de todo el sistema; fuera de alcance (el dueño eligió «la más reciente»).
- Que el destino tome el costo del origen al ACEPTAR: el costo dependería de cuándo acepta y de compras posteriores del origen; la copia al enviar fija lo que efectivamente salió.
