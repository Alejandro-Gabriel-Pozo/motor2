# Diseño: la marca de la carta, un color por sucursal y uno por empresa (paso 9 de la auditoría 2026-11-12)

Estado: **decisiones del dueño confirmadas el 2026-11-13 (ver «Respuestas del dueño»): las cartas publicadas se conservan hasta que se reediten (opción A); invariantes M1 a M6 en PROPUESTA salvo lo confirmado; el modo oscuro queda como pregunta abierta**. No hay código ni migración en este documento. Sigue la escalera de diseño de 10 niveles de `AGENTS.md`; la compuerta dice que no se migran tablas sin tener confirmados los niveles 1 a 5: acá **no hay tablas**, la marca vive en JSON ya existente.

Fuentes: `docs/auditoria-primitivas-pedernal-motor2-2026-11-12.md` (§6.3, anexo D), código real (`src/core/carta/tema.ts`, `portal.ts`, `color-css.ts`, `estilo.ts`).

## 1. Propósito y alcance

- **Necesidad** (dueño, 2026-11-12): «lista cerrada de colores, libre solo para la marca por sucursal y por empresa» (pedido original de la auditoría) y «6.- SI» a «¿Alcance exacto de la marca (paso 9): un color por sucursal y uno por empresa, con el resto derivado?» (#236, §9.0). **CONFIRMADA**.
- **Hoy**: la carta pública se pinta con 64 claves de tema por sucursal (`TemaCartaSucursal.valores`, **23 de color** en el catálogo de código) y 22 del portal por empresa (`PortalCartaEmpresa.valores`, **12 de color**). *(Corrección del 2026-11-13: este documento decía 31 y 8; el catálogo de código tiene 23 y 12, y en la copia de producción del 12/11 hay 20 de las 23 cargadas en el tema y 8 de las 12 en el portal.)* La validación es solo de sintaxis (`sanitizeCssColor`: hex de 3 a 8 dígitos, funciones y **cualquier palabra de letras como «nombre CSS»**: `inherit`, `initial`…) y **no controla contraste**: un color elegido puede dejar el texto ilegible. Solo el color de fondo y el de la portada derivan su tinta por contraste (`estilo.ts`, `resolveHeroInk`).
- **Alcance de este cambio**: la carta pública y el portal. La administración y el POS no usan marca y **no cambian**.
- **Fuera de alcance**: tipografías, tamaños y opacidades (siguen como están), logo e imágenes, modo oscuro (el sistema no lo tiene, DEC-04).

## 2. Actores y contexto

- Quien gerencia una sucursal elige el color de marca de **su** carta (desde un celular: es el dispositivo principal). Quien administra la empresa elige el del **portal** (la página que reúne las sucursales).
- Quien lee la carta pública (cliente final, celular, sin sesión) ve el resultado.

## 3. Casos de uso

1. Elegir o cambiar el color de marca de la sucursal; ver la vista previa a 375 px antes de publicar.
2. Elegir o cambiar el color de marca del portal de la empresa.
3. Volver al color del sistema (quitar la marca propia).
4. Recibir un aviso claro si el color elegido no se lee (contraste) y qué hacer.

## 4. Conceptos y ciclo de vida

- **Color de marca**: UN color por sucursal (`color_marca`, que **ya existe** en el catálogo de claves) y UNO por empresa (clave nueva del portal, solo en el catálogo de claves: sin migración).
- **Colores del sistema** (lista cerrada, ~25 tokens de `src/app/globals.css`): fondo, tinta, bordes y **los de estado** (ok, aviso, error), que **nunca toman valor de marca** (la marca no puede hacer que «Anular» se vea como «Cobrar»).
- **Colores derivados** (el sistema los calcula, no se guardan): el texto sobre la marca (el más legible entre dos valores fijos), el tono de pasar el mouse y el tinte de fondo suave.
- Ciclo de vida: el que ya tiene el tema: borrador (`aplicarEnCarta = false`) y publicado; «sin fila» = estilo por defecto.

## 5. Invariantes y políticas

| Id | Regla | Estado |
|---|---|---|
| M1 | Al GUARDAR, el color de marca es `#rrggbb` en minúsculas (lista de permitidos); no se admiten funciones, nombres CSS ni `#rgb`. Al LEER un valor ya guardado: «Se usa si se puede leer (Recomendada)» (2026-11-13): hex corto, rgb, hsl u oklch se convierten a `#rrggbb`; si no se puede leer (nombre CSS, texto), color del sistema | **CONFIRMADA** la lectura (dueño, 2026-11-13); PROPUESTA el guardado estricto |
| M2 | El texto derivado sobre la marca tiene contraste ≥ 4,5:1; si ninguno de los dos valores fijos llega, **se rechaza al guardar** con un mensaje que dice qué hacer: «Se rechaza y dice qué hacer (Recomendada)» (2026-11-13). Las dos tintas fijas son las de siempre (`oklch(0.96 0.005 80)` ≈ #f3f1ee y `oklch(0.18 0.02 40)` ≈ #190f0b), **no blanco ni negro puros**: algunos colores que llegarían con blanco puro (por ejemplo #d32f2f: 4,98:1) con la tinta del sistema quedan en 4,42:1 y se rechazan | **CONFIRMADA** (dueño, 2026-11-13); las tintas fijas, PROPUESTA |
| M3 | La marca contra el fondo de la carta tiene contraste ≥ 3:1 (como color de elemento) | PROPUESTA |
| M4 | Los colores de estado y los de peligro son del sistema, nunca de marca | PROPUESTA (Pedernal lo decide así) |
| M5 | Sin color de marca guardado, se usa el del sistema; nada «viene tildado» ni preelegido | CONFIRMADA («todo nace cerrado») |
| M6 | Las claves de color viejas **no se borran** del JSON: dejan de leerse (reversible) | PROPUESTA |

## 6. Historia y persistencia

**Sin tablas ni migración.** `valores` es JSON: el catálogo de claves (código) decide qué se lee y la lectura ya «ignora claves fuera del catálogo o con valor inválido». La marca por empresa suma una clave al catálogo del portal.

## 7. Atomicidad y concurrencia

| ¿Qué pasa si…? | Hoy | Propuesta |
|---|---|---|
| Se guarda dos veces lo mismo | Upsert idempotente: una fila | Igual |
| Dos personas editan el tema a la vez | El último guardado pisa al otro (no hay control de versión del tema) | **Riesgo anotado**: `version` en el tema es un paso aparte (necesita migración) |
| Cambian los permisos mientras se edita | Los vuelve a exigir el servidor | Igual |
| El color elegido no cumple contraste | Se guarda igual | Se rechaza sin escribir (M2/M3) |
| Llega un valor raro por la red | `sanitizeCssColor` lo filtra por sintaxis | Lista de permitidos `#rrggbb` (M1) |

## 8. Acceso e interfaces

Los permisos de tema y portal **no cambian**. El editor pasa de decenas de campos de color a **uno** (más la vista previa), con la tarjeta de color pensada para el celular (objetivos de 44 px).

## 9. Consultas y experiencia

La carta pública lee la marca y los derivados como variables CSS (como hoy `--carta-*`); la salida pública sigue campo por campo con lista cerrada. La vista previa muestra la carta real de la sucursal con el color elegido, a 375 px.

## 10. Pruebas, migración y operación

- **Oráculo de combinaciones** (tabla escrita aparte del código, test que la recorre): para una lista de colores de marca (claros, oscuros, saturados, grises, el del sistema), qué tinta derivada sale y si pasa M2/M3. Un guardián falla si aparece una clave de color nueva sin declarar si es de marca o derivada.
- **Cartas ya publicadas**: conservan su apariencia hasta que su dueño las reedite (opción A, confirmada el 2026-11-13; ver «Respuestas del dueño»): al desplegar no cambia ninguna carta publicada. Las claves viejas no se borran (M6).
- **Operación**: antes de tocar nada, listar con datos reales (solo lectura) cuántas sucursales y empresas tienen cada una de las 39 claves de color cargadas y con qué valor.

## Lo que se pierde (a la vista, antes de decidir)

Con este diseño, **en una carta que pase a la marca derivada**, dejan de poder elegirse por separado 22 de las 23 claves de color del tema (fondo de la carta y de la portada, textos y botón de la portada, nombre, precio, descripción y tags del ítem y del ítem especial, títulos y números del índice, banda de sección, flechas, íconos y botón de volver) y las 12 del portal (queda una nueva de marca). *(Antes decía 30 de 31 y 7 de 8: ver la corrección de §1.)* Pasan a derivarse de la marca y de los tokens del sistema.

## Respuestas del dueño

**Cartas ya publicadas (cambia lo que ya está publicado).** Quedó así (el orden importa):
1. 2026-11-12: «conservan hasta que se reediten» (opción A).
2. 2026-11-13 (a la mañana): «Pasar todas de una vez a la marca derivada» — chat del dueño con el orquestador (preguntas con opciones) (opción B, la no recomendada).
3. 2026-11-13 (después de ver que las 5 cartas de hoy son oscuras): primero preguntó «Che pero se puede tener fondo oscuro o no?» (respuesta: técnicamente sí, pero en el diseño nuevo no existe, y en Pedernal el modo oscuro también está abierto, P4) y después eligió «Conservan hasta que se reediten» — chat del dueño con el orquestador (preguntas con opciones).
**Resultado vigente: la opción A vuelve a estar CONFIRMADA** (la respuesta 3 es posterior); la respuesta 2 («todas de una vez») queda **REVOCADA por la posterior** (regla I9: solo el dueño revoca, con una cita nueva) y **sin efecto**. Las cartas de hoy (las 5 oscuras, con sus colores sueltos, y el portal) conservan su apariencia tal cual hasta que su dueño las reedite. Las claves viejas de color no se borran nunca del JSON (M6).

**Lectura de una marca ya guardada que no cumple o no es `#rrggbb` (2026-11-13, chat del dueño con el orquestador (preguntas con opciones)):** «Se usa si se puede leer (Recomendada)». **CONFIRMADA.**

**Al guardar un color sin contraste suficiente (2026-11-13, chat del dueño con el orquestador (preguntas con opciones)):** «Se rechaza y dice qué hacer (Recomendada)». **CONFIRMADA.**

## Lo que muestran los datos reales (lectura sobre la copia de producción del 12/11, rama de ensayo del 2026-11-13)

- Las **5 sucursales con tema** (las 5 aplicadas, 1 empresa) tienen la carta **OSCURA**: fondo `#181818` (`color_fondo_dia` y `hero_color_fondo`) y todos los textos en `#ffffff`. Lo único que cambia entre sucursales es `color_marca`: `#5c57a2`, `#797d62`, `#96bbbb`, `#e17360` y `#ffcb69`.
- El **portal** (1 empresa) tiene 8 de sus 12 claves de color cargadas: `portal_header_bg` `#e5dfdf` y siete en `transparent`.
- **Consecuencia de pasar una carta oscura a la marca derivada:** el sistema no tiene modo oscuro (§1), así que esa carta pasaría de oscura a **clara**. Por eso la opción A (conservar) es la que no cambia nada al desplegar.
- **Contraste de esas 5 marcas** (WCAG 2.1, con las tintas fijas del sistema): contra fondo claro (blanco, M3 ≥ 3:1) `#5c57a2` 6,29 ✔, `#797d62` 4,27 ✔, `#e17360` 3,08 ✔, `#96bbbb` 2,07 ✘ y `#ffcb69` 1,50 ✘. Texto derivado sobre la marca (M2 ≥ 4,5:1): `#5c57a2` clara 5,58 ✔, `#e17360` oscura 6,12 ✔, `#96bbbb` oscura 9,08 ✔, `#ffcb69` oscura 12,56 ✔, `#797d62` oscura 4,42 ✘ (se rechazaría al guardar). `#797d62` contra el fondo oscuro de hoy da 4,16:1 (el contraste que corrige la sesión del ensayo en tres platos).

## Preguntas abiertas

- **Modo oscuro** (PENDIENTE; no se construye): hoy las 5 cartas son oscuras y el sistema nuevo no tiene modo oscuro; una carta que se pase a la marca derivada pasa a clara. Queda como pregunta abierta, igual que P4 de Pedernal. **No hay dato nuevo de fondo claro u oscuro**: sería una sugerencia solo con el «sí» del dueño.
- **Qué acción exacta es «reeditar»** (PENDIENTE; la plantea el plan de PR): propuesta, un botón explícito «Pasar a color de marca» en el editor, con vista previa a 375 px, y otro «Volver a mis colores anteriores». Ver el plan en el PR de lectura.

## Estado de las decisiones

| Decisión | Estado |
|---|---|
| Un color de marca por sucursal y uno por empresa; el resto derivado | **CONFIRMADA** (dueño, 2026-11-12) |
| Qué hacer con las cartas publicadas | **CONFIRMADA: conservan hasta que se reediten (opción A)** — dueño, 2026-11-12 y de nuevo 2026-11-13 («Conservan hasta que se reediten»); la respuesta de la mañana del 2026-11-13 («Pasar todas de una vez a la marca derivada») quedó **REVOCADA** por esta posterior |
| Lectura de una marca guardada que no cumple (M1, lectura) | **CONFIRMADA: «Se usa si se puede leer (Recomendada)»** (dueño, 2026-11-13) |
| Rechazar al guardar un color sin contraste (M2) | **CONFIRMADA: «Se rechaza y dice qué hacer (Recomendada)»** (dueño, 2026-11-13) |
| M1 al guardar (`#rrggbb` estricto), M3, M4, M5 (M5 ya CONFIRMADA), M6 | PROPUESTA (M5 CONFIRMADA: «todo nace cerrado») |
| Las dos tintas fijas del sistema (no blanco ni negro puros) | PROPUESTA |
| Modo oscuro | PENDIENTE (pregunta abierta; no se construye) |
| Qué acción exacta es «reeditar» y cómo se vuelve atrás | PROPUESTA (botón explícito y botón de volver; ver el plan) |
| Versión del tema contra ediciones simultáneas | PENDIENTE (necesita migración: autorización expresa) |
| Datos reales de cuántas cartas usan cada clave | Medido el 2026-11-13 sobre la copia del 12/11 (ver arriba); la rama principal de producción NO se consultó |
