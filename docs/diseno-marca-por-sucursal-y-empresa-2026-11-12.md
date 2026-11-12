# Diseño: la marca de la carta, un color por sucursal y uno por empresa (paso 9 de la auditoría 2026-11-12)

Estado: **PROPUESTA para el OK del dueño**. No hay código ni migración en este documento. Sigue la escalera de diseño de 10 niveles de `AGENTS.md`; la compuerta dice que no se migran tablas sin tener confirmados los niveles 1 a 5: acá **no hay tablas**, la marca vive en JSON ya existente.

Fuentes: `docs/auditoria-primitivas-pedernal-motor2-2026-11-12.md` (§6.3, anexo D), código real (`src/core/carta/tema.ts`, `portal.ts`, `color-css.ts`, `estilo.ts`).

## 1. Propósito y alcance

- **Necesidad** (dueño, 2026-11-12): «lista cerrada de colores, libre solo para la marca por sucursal y por empresa» (pedido original de la auditoría) y «6.- SI» a «¿Alcance exacto de la marca (paso 9): un color por sucursal y uno por empresa, con el resto derivado?» (#236, §9.0). **CONFIRMADA**.
- **Hoy**: la carta pública se pinta con 64 claves de tema por sucursal (`TemaCartaSucursal.valores`, 31 de color) y 22 del portal por empresa (`PortalCartaEmpresa.valores`, 8 de color). La validación es solo de sintaxis (`sanitizeCssColor`: hex de 3 a 8 dígitos, funciones y **cualquier palabra de letras como «nombre CSS»**: `inherit`, `initial`…) y **no controla contraste**: un color elegido puede dejar el texto ilegible. Solo el color de fondo y el de la portada derivan su tinta por contraste (`estilo.ts`, `resolveHeroInk`).
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
| M1 | El color de marca es `#rrggbb` en minúsculas (lista de permitidos); no se admiten funciones, nombres CSS ni `#rgb` | PROPUESTA |
| M2 | El texto derivado sobre la marca tiene contraste ≥ 4,5:1; si ninguno de los dos valores fijos llega, **se rechaza al guardar** con un mensaje que dice qué hacer | PROPUESTA |
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
- **Cartas ya publicadas**: ver la pregunta abierta. La lectura compatible (A) no cambia cómo se ve ninguna carta publicada.
- **Operación**: antes de tocar nada, listar con datos reales (solo lectura) cuántas sucursales y empresas tienen cada una de las 39 claves de color cargadas y con qué valor.

## Lo que se pierde (a la vista, antes de decidir)

Con este diseño dejan de poder elegirse por separado 30 de los 31 colores del tema (nombre del ítem, precio, descripción, tags, ítems especiales, títulos y números del índice, banda de sección, flechas, íconos y botón de volver) y 7 de los 8 del portal. Pasan a derivarse de la marca y de los tokens del sistema.

## Respuesta del dueño (la clave: cambia lo que ya está publicado) — 2026-11-12: opción A, «conservan hasta que se reediten»

**Las cartas que hoy tienen colores sueltos cargados, ¿conservan esa apariencia hasta que su dueño las reedite (recomendado), o se pasan de una vez a la marca derivada?**

- **A (recomendada)**: la lectura sigue entendiendo las claves viejas mientras haya valores guardados; quien reedita pasa al modelo nuevo. Nada cambia de golpe. Costo: el código de lectura convive con las dos formas hasta que no quede ninguna carta con claves viejas (se mide con datos reales y entonces se borra).
- **B**: todas pasan a la marca derivada al desplegar. Una carta con colores muy particulares se ve distinta sin que nadie la toque.

## Estado de las decisiones

| Decisión | Estado |
|---|---|
| Un color de marca por sucursal y uno por empresa; el resto derivado | **CONFIRMADA** (dueño, 2026-11-12) |
| Los 6 invariantes M1–M6 | PROPUESTA |
| Qué hacer con las cartas publicadas | **CONFIRMADA: opción A** (dueño, 2026-11-12: «conservan hasta que se reediten») |
| Versión del tema contra ediciones simultáneas | PENDIENTE (necesita migración: autorización expresa) |
| Datos reales de cuántas cartas usan cada clave | NO VERIFICADO (no hay acceso a producción desde esta sesión) |
