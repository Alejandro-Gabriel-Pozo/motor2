# Plan: reporte de boletas emitidas — 2026-09-26

Task #17 del backlog. Decisión de negocio ya resuelta por el dueño; este documento deja registro breve de lo implementado (no es
un plan previo a confirmar, como los de `docs/plan-numeracion-boleta-2026-09-25.md` o `docs/plan-imprimir-comanda-y-boleta-2026-09-25.md`).

## El hallazgo

La premisa original del pendiente («las boletas hacen scroll infinito en la mesa») era incorrecta: `BOLETAS_RECIENTES_POR_MESA = 3`
(`src/core/pos/boleta.ts`) ya limita «Cuentas cerradas» a las 3 últimas por mesa. El problema real es el opuesto: las boletas más
viejas que esas 3 quedaban **totalmente inaccesibles** — sin ninguna pantalla desde donde verlas, reimprimirlas o corregirlas. Esto
probablemente explica el pendiente #21 («Emitir boleta corregida aparece deshabilitado en producción»): la boleta en cuestión puede
simplemente no estar entre las 3 recientes.

## Qué se construyó

- **`/reportes/boletas`** (`src/app/(app)/reportes/boletas/page.tsx`): una fila por `EjemplarBoleta` (no por Cuenta), más recientes
  primero, con el mismo permiso que el resto de los reportes de dinero (`ver_reportes_dinero`, sin migración de permisos). De solo
  lectura: reimprimir o emitir una corregida sigue haciéndose desde la mesa (`ImpresionProvider` vive en la carpeta de rutas del POS,
  fuera de alcance traerlo a `(app)`); cada línea del detalle enlaza a Trazabilidad.
- **`listarBoletasEmitidas`** (`src/core/reportes/boletas-emitidas.ts`): paginado por cursor (mismo patrón que
  `listarComprasRegistradas`), con filtro de fecha, de mesa (`mesaId`, para el link desde la pantalla de mesa) y el tipo `FiltroBoletas`
  ya preparado para sumar `clienteId` cuando exista el modelo de clientes (Task #14) sin romper la firma.
- **Corte de "día" en HORA DE ARGENTINA** (`src/core/reportes/rango-dia-argentina.ts`), no en UTC como el resto de los reportes: el
  servicio de la noche cruza la medianoche UTC (21 h ART = 00 h UTC), así que un corte en UTC partiría en dos una misma noche de
  servicio. Argentina está en UTC-3 fijo todo el año desde 2009 (sin horario de verano), así que un offset constante alcanza.
- **`armarBoletaImpresaEn(items, impresaEn)`** (`src/core/pos/boleta.ts`): el importe «como se imprimió» un ejemplar viejo, con las
  Operaciones VENTA no anuladas AL MOMENTO de esa impresión. `armarBoletaVigente` pasa a ser el caso «ahora» sobre la misma base.
- **Marcas por fila**: «Corrección de N.º…» (ejemplar con `corrigeA`), «Reemplazada por N.º…» (no es el último ejemplar de su
  cuenta) y «Desactualizada»/«Venta anulada» (solo sobre el ÚLTIMO ejemplar de la cuenta — una corrección vieja ya reemplazada no
  tiene un estado propio, dejó de ser la boleta actual).
- **Link desde la mesa**: «Ver todas las boletas de esta mesa →» al pie de `src/app/(pos)/mesas/[mesaId]/page.tsx`, condicionado del
  lado del servidor a `ver_reportes_dinero` (el shell del POS no filtra `EnlaceInterno` automáticamente, a diferencia de `(app)`).
- **`src/core/pos/formato.ts`**: movido desde la carpeta de rutas del POS (`(pos)/mesas/[mesaId]/formato.ts`) a `core/pos`, en un
  commit mecánico propio, para que el reporte (en `(app)`) pueda formatear en hora de Argentina sin duplicar los `Intl.DateTimeFormat`.

## Fuera de alcance de esta v1

- Reimprimir o emitir una boleta corregida DESDE el reporte nuevo: depende de `ImpresionProvider`, que hoy solo vive en la carpeta
  de rutas del POS. El reporte es de consulta, con link a Trazabilidad.
- Filtro por cliente (`clienteId`): no existe el modelo todavía (Task #14). El tipo `FiltroBoletas` y las funciones de lectura/
  serialización de filtros ya lo dejan previsto (ver comentario en `boletas-emitidas.ts`), sin ningún control visible en la pantalla.
- Cuentas cerradas antes de la numeración de boletas (sin `EjemplarBoleta`): no aparecen — es esperado, y la pantalla lo aclara.
