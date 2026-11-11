# Recorrido de la promo «Menú ejecutivo» (producción = commit 65c6d09a) — 2026-11-11

Rama temporal: solo PNG y este LEEME (sin `.env`, bases ni dumps). Capturas a 1366×768 y 390×844, escala ×2 (`NN-nombre-1366.png` / `-390.png`).

## Cómo se hizo
- Build de producción de `origin/main` @ 65c6d09a (el commit desplegado, dpl_H7gDPUZ3VGdxJY7sMKnaw9eARUvT) contra una base Postgres LOCAL descartable. No hay login a producción y no se escribió nada en producción (Neon, solo lectura).
- Copia de lo REAL leído de producción: las 14 secciones de la carta, los productos BIFE- (codigo BIFE), CHIVO-DEL-NORTE, PV-PECHUGA, las 8 bebidas sin alcohol con sus precios y el Jugo Fresli, los grupos de opciones y las opciones de esos tres platos (Preparación del bife/chivo/Pechuga, Proteína del bife, Guarnición, Sabores Jugo Fresli) con sus precios por preparación (bife $30.000; chivo $34.000/$23.000/$40.000; pechuga $20.000), las 6 sucursales (la promo está prendida solo en Huinganco) y la promo «Menú ejecutivo» tal como está HOY: $55.000, 2 cupos de tipo SECCIÓN («Platos principales» y «Bebidas sin alcohol», mín 0 máx 1) y CERO entradas.
- MAQUETA (no real): el usuario de sesión (`e2e-admin@local.test`, admin); la mesa 12 y su cuenta; los insumos y consumos de las opciones (para que el POS pueda armar); el stock de las bebidas (reventa); y el LUGAR «Platos principales» de tipo LISTA, que se cargó directo en la base porque la pantalla de producción no ofrece crearlo (ver «Lo que no funciona»). Pasos 5 a 22 usan ese lugar. Las opciones que se tildaron como permitidas (Nalga, Bife de chorizo, Bife a criolla, Bife con chimichurri, Pure de papa, Ensalada; SIN Papas fritas) son una elección de ejemplo.

## Guía paso a paso para el dueño (Carta → Parametrización → Promociones)
**Hoy en producción (sin cambios):**
1. POS, mesa → «Promociones» → «Menú ejecutivo»: abre «Armar «Menú ejecutivo»» con «$ 55.000,00 en total, sea cual sea lo que elijas en cada cupo». En «Platos principales · 0/1 (opcional)» el Bife, el Chivo y la Pechuga dicen «Con tamaño: pedilo suelto» y el «+» no funciona. (01)
2. Carta → Parametrización → Promociones → abrir «Menú ejecutivo» (flechita ▸): sección «Cupos». Solo hay casillas de SECCIONES de la carta (Promociones, Entrada, Platos principales… Jugos y licuados) con «mín.» y «máx.»; tildadas hoy: «Platos principales» y «Bebidas sin alcohol». El texto dice: «Las partes de la promo se arman tildando secciones de la carta… Para un grupo propio, como «Bebida», creá la sección en Carta › Secciones y géneros y tildala acá.» (02–04)
3. Un cupo de tipo SECCIÓN no tiene entradas: no se puede marcar «el mozo elige» ni elegir opciones. NO hay botón para cambiarlo a «lista», ni «Sumar un lugar», ni nada que lo convierta (confirmado en pantalla: no existe el campo de lugar nuevo). Hay que tener un LUGAR de tipo lista.

**Para armar «el mozo elige» (una vez que exista el lugar «lista»; hoy hay que prender el interruptor, ver abajo):**
4. En «Cupos»: destildar la casilla de la sección «Platos principales» y dejar tildado «Platos principales (lista)» (mín 0, máx 1); botón «Guardar cupos». Mensaje: «Cupos de "Menú ejecutivo" guardados (2): ahora es una promo armable en el POS.» (05–07)
5. Debajo aparece el bloque del lugar: «Platos principales · se elige de 0 a 1 — Sin entradas todavía: sumá los productos que se pueden elegir acá.» (08)
6. «De dónde salen los productos de «Platos principales»»: elegir «Sección «Platos principales»» (o «No está en la carta»). (09–10)
7. Aparece «Productos de la sección «Platos principales»»: tildar «Bife a criolla · Bife con chimichurri (BIFE-)», «Chivo del norte Neuquino · Estofado de chivo · Chivo al disco (CHIVO-DEL-NORTE)» y «Pechuga grille con salsa de mostaza y miel (PV-PECHUGA)». Aviso: «ninguno entra solo, hay que tildarlo». (11)
8. En cada producto tildado: «Qué pasa con las opciones de «…»» → elegir «El mozo elige» (la otra es «Vienen fijas»). Se ven los grupos con sus límites: «Proteína del bife — El mozo elige 1 (obligatorio)», «Preparación del bife — El mozo elige 1 (obligatorio)», «Guarnición — El mozo elige 1 (obligatorio)» y la nota «El precio de la promo es fijo, elija lo que elija el mozo. Cuántas elige de cada grupo lo fijan los límites del grupo (no se cambian acá).» Las opciones vienen TODAS tildadas: destildar las que NO se permiten (en el ejemplo, «Papas fritas»). (12–14)
9. Botón «Sumar». Confirma por producto: ««BIFE- · Nalga · Bife de chorizo · … quedó como opción de «Platos principales»»». (15)
10. La promo queda: «Bife a criolla · … (BIFE-) · el mozo elige entre: Nalga, Bife de chorizo, Bife a criolla, Bife con chimichurri, Pure de papa, Ensalada» (con «Sacar …» para quitarlo). (16)

**POS después:**
11. Mesa → «Promociones» → «Menú ejecutivo» → «Armar «Menú ejecutivo»»: «Platos principales · 0/1 (opcional)» con el «−/+» del Bife, el Chivo y la Pechuga. (17)
12. «+» en el Bife: debajo aparecen «Proteína del bife · elegí 1» (solo Nalga y Bife de chorizo), «Preparación del bife · elegí 1» (Bife a criolla, Bife con chimichurri), «Guarnición · elegí 1» (solo Pure de papa y Ensalada; NO Papas fritas) y «Falta elegir: …». (18)
13. Tocar una opción de cada grupo; «+» de «Agua 500 cc» en «Bebidas sin alcohol · 1/1». El total sigue «$ 55.000,00 en total». (19–20)
14. «Agregar promo» → queda «por agregar» → «Agregar 1 al pedido»: «Se agregaron 2 ítems a la mesa 12. Incluye «Menú ejecutivo».» y el total de la mesa es $ 55.000,00. (21–22)

## Lo que NO funciona / falta / confunde (con captura)
1. **No se puede armar hoy desde la pantalla.** `SUMAR_LUGAR_DE_LISTA_VISIBLE = false` (`src/core/carta/cupos-de-promo.ts`, decisión del dueño 2026-10-28: «es algo obsoleto, es más fácil agregar la sección del otro lado y tildarla»). Esa decisión es válida para promos SIN opciones, pero deja sin camino a una promo «el mozo elige» con productos de tamaño: un cupo de sección nunca lleva entradas. Camino mínimo: prender ese interruptor (un cambio de una línea, reversible, lo escribe Sonnet) y después seguir los pasos 4 a 10. Alternativa sin código: ninguna desde la pantalla. (03–04)
2. Un cupo de sección no se «convierte» en lista: hay que destildar la sección y crear otro lugar con el mismo nombre (no hay botón «cambiar tipo»).
3. «Jugo Fresli» aparece en «Bebidas sin alcohol» con «Lleva opciones: pedilo suelto» y «+» apagado: como la sección es un cupo de SECCIÓN, no se puede vender dentro de la promo; para incluirlo habría que ponerlo en un lugar lista con sus sabores. (17, 18, 20)
4. Los nombres internos se ven en pantalla: el producto se llama «BIFE-» (código BIFE) y se muestra «Bife a criolla · Bife con chimichurri (BIFE-)»; «Preparación Pechuga» tiene UNA sola opción. Confunde y conviene renombrar en el catálogo.
5. «Bife a  criolla» (con DOS espacios) es el nombre real cargado hoy en la base; se ve como «Bife a criolla».
6. El orden de los lugares: el lugar nuevo queda en el POS DESPUÉS de «Bebidas sin alcohol» (en la maqueta se cargó con orden 2) y la pantalla no tiene cómo reordenarlos. NO VERIFICADO si al crearlo desde la pantalla (con el interruptor prendido) se coloca al final igual.
7. Al tildar «El mozo elige» todas las opciones vienen tildadas; si se «Sumar» sin destildar, se permite todo (incluidas las papas fritas). Los límites de cada grupo («elegí 1») se ven pero no se cambian ahí.
8. La nota del bloque «Cupos» sigue diciendo «Para un grupo propio… creá la sección…», que no ayuda al caso «el mozo elige».
