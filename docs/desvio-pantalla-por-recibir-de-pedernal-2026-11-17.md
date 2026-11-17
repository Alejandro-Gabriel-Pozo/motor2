# Desvío declarado — la pantalla «Por recibir» (N3, #364) se hizo sin copiar las maquetas de Pedernal (2026-11-17)

Estado: DECLARACIÓN (solo documento). Origen: reglas de pantallas de la orquestadora de Pedernal, pasadas por el orquestador general el 2026-11-17: las pantallas de Pedernal son las de Motor2 (se copian: maqueta final + pantalla de ZuluHub-ERP + inventario + decisiones del dueño), cero invención de textos, tabla de correspondencia por pantalla, capturas lado a lado a 390 y 1280 px y revisión previa de la orquestadora de Pedernal. Todo desvío es un SUPUESTO declarado.

## Qué es el desvío
La pantalla «Por recibir» de Compras N3-a y N3-b (PR #364, ya en `main`: `src/app/(app)/movimientos/[proceso]/bandeja-para-aceptar.tsx`, tarjeta de cada compra pendiente de recibir) se diseñó y construyó **sin partir de** `compra.html` ni `control.html` de Pedernal (`ZuluHub-docs`, `10-ux-ui/prototipos-gastronomia/`) ni de su pantalla en ZuluHub-ERP. Se hizo sobre el diseño por niveles `docs/diseno-compras-n3b-n4-etapas-2026-11-16.md`.

## Lo que se sabe que difiere o se desconoce
- **Textos del control por línea:** Pedernal tiene aprobados «Condición», «Conforme», «Con observaciones», «Rechazada», «Observación», «Motivo del rechazo», «Queda en cuarentena», «Se rechaza» (`catalogo-compras.ts`, bloque `compras.control.*`, texto de `control.html` «Textos nuevos» 09/11/2026). Motor2 usa «Control», «Conforme», «Con observaciones», «Rechazada», «Observación», «Cantidad según remito (opcional)», «No se constató», «Guardar control». NO VERIFICADO línea por línea qué rótulos coinciden y cuáles difieren («Control» frente a «Condición», «Observación» frente a «Motivo del rechazo» cuando la condición es rechazada).
- **Consecuencia del control a la vista:** en Pedernal, `control.html` muestra «Queda en cuarentena» / «Se rechaza» según la condición (a verificar en la maqueta); en Motor2 la pantalla de N3 no lo muestra (hoy el destino lo elige quien confirma; la etapa de cuarentena y rechazo, #449, lo propone).
- **Cantidad según remito, «No se constató», «Guardar control» (control como paso previo a confirmar):** NO VERIFICADO si existen en Pedernal con esos textos. En Pedernal el control cuelga de la recepción; en Motor2 es un paso previo guardado aparte (diferencia de modelo ya declarada en el diseño).
- **Textos de la confirmación** («Confirmar recepción», «Recepción confirmada: N movimiento(s) entraron al stock…», «Esta compra ya fue recibida: no se cargó stock de nuevo.»): «Confirmar recepción» existe en Pedernal (`compras.recepcion.validar_recepcion`); los otros dos NO VERIFICADO.
- **Selector de depósito por renglón y aviso informativo al repetir la confirmación:** NO VERIFICADO contra la maqueta de recepción.
- **Distribución, orden de elementos, estados vacíos, accesibilidad:** no comparados.

## Respuesta de la orquestadora de Pedernal (2026-11-17; ERP origin/main 4fa7f3b8, docs 6b0b88d)
- En Pedernal NO existe una pantalla de recepción con selector de depósito por línea: solo el caso de uso (`confirmar-recepcion.ts:232`, `destinoElegido`/`cambiado`). El selector de depósito por renglón de «Por recibir» (N3) y el «Propuesto por el control» / «cambiado» de #449 no tienen equivalente: se declaran SUPUESTO.
- Lo más cercano es `control.html:344-348` («Recibir»): condición Conforme / Con observaciones / Rechazada; casilla «Dejar en cuarentena hasta revisar» (solo con observaciones); y el destino como texto de resultado: «Entra a tu stock» / «Queda en cuarentena» / «Se rechaza». Es el patrón base al rehacer la pantalla (regla P13: el punto de partida es `control.html` y `stock.html`).
- Bloqueo sin depósito de calidad y venta desde cuarentena: en Pedernal no hay texto propio, sale el mensaje genérico (decisión 175); no se agregan textos propios.
- Lista de depósitos: la pastilla del uso va en TODOS (también «Normal») y «De venta» debajo solo del que vende (`stock.html:343-345`, «Uso» con Normal / Cuarentena / Rechazo): se copia tal cual.

## Qué se hace
1. La pantalla se rehace copiando de Pedernal junto con las pantallas de la etapa de cuarentena y rechazo (decisión del orquestador, 2026-11-17: el servidor de #449 va al lote; las pantallas salen de ese PR y se rehacen con la tabla de correspondencia «elemento ↔ archivo:línea», «Lo que difiere», capturas lado a lado a 390 y 1280 px y revisión previa de la orquestadora de Pedernal).
2. Los textos de #364 que no existan en Pedernal se verifican uno por uno al rehacerla; los que no existan se consultan a la orquestadora de Pedernal, no al dueño.
3. Mientras tanto, lo que está en `main` es un SUPUESTO declarado: el comportamiento (control por línea, confirmación con un destino por renglón, repetir es éxito) está respaldado por las decisiones del dueño citadas en #364; la FORMA visual y los rótulos no lo están por una maqueta.

## Riesgos
- Un operador que conozca Pedernal puede ver rótulos distintos para lo mismo (por ejemplo «Control» y «Condición»). No afecta dinero ni stock.
- No se toca lo que ya funciona hasta tener la copia y su revisión: se evita reescribir una pantalla en producción sin su maqueta.
