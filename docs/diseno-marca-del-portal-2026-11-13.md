# Marca del portal (por empresa): diseño y tabla de derivación

> **Estado:** P1, P2 y P3 **CONFIRMADAS por el dueño** (2026-11-13, chat del dueño con el orquestador; citas en §5). P4 es un **SUPUESTO declarado del orquestador** (no es una aceptación del dueño, I1): se construye igual que la carta por coherencia y el dueño lo puede corregir. Continúa `docs/diseno-marca-por-sucursal-y-empresa-2026-11-12.md` (paso 9: «un color por empresa para el portal, el resto derivado»). La marca de la **sucursal** (carta) ya está construida (#264, #269, #270); esto es la de la **empresa** (el portal `/carta-publica/<empresa>`). Se construye en dos PR chicos, sin migración: (1) lectura con el marcador `portal_marca_derivada`; (2) guardado y editor.
> Etiquetas: **ACTUAL** (verificado en el código o en la base de ensayo, solo lectura) · **CONFIRMADA** (dicha por el dueño) · **SUPUESTO** (del orquestador, a corregir por el dueño).

## 1. Qué hay hoy

- El portal tiene **12 claves de color** (`CLAVES_PORTAL_V1` en `src/core/carta/portal.ts`) que llegan al CSS como `--portal-*` (`src/app/globals.css`, líneas 389–440). Sin valor cargado, cada una cae a los tokens de la carta: tinta `#1c1b19`, tinta suave `#57534e`, borde `#e7e5e4`, fondo blanco (ACTUAL).
- **Lo cargado en la empresa real (rama de ensayo del 2026-11-13, solo lectura):** `portal_header_bg = #e5dfdf` (gris cálido claro) y **siete claves de tarjeta en `transparent`** (`card_bg`, `card_border`, `card_border_hover`, `card_color`, `card_color_hover`, `card_notas_color`, `card_flecha_color`). El resto está vacío. O sea: el portal real es un **mapa** (imagen de fondo + tarjetas posicionadas en %) cuyas tarjetas son **zonas tocables transparentes** sobre la imagen; el nombre y la foto ya vienen dibujados en la imagen (ACTUAL; lo de que el nombre «viene en la imagen» es lectura del dato, NO VERIFICADO con el dueño).
- Consecuencia de diseño: **una derivación que pinte las tarjetas (fondo blanco, texto, borde) taparía la imagen del mapa** del portal real. Por eso la pregunta 2 de abajo.

## 2. Regla de referencia (Pedernal) y cómo se aplica

Pedernal no tiene portal en v1 (`10-ux-ui/03-experiencia-de-la-carta.md` §13 punto 15: «portal de grupo… decisión aparte»; `migracion-de-la-carta-de-motor2-especificacion.md`: `PortalCartaEmpresa` y sus 22 claves no migran como libres, la identidad es de **lista cerrada**). No hay regla de Pedernal propia del portal; rige la general (`01-arquitectura-de-experiencia.md` §4.2–4.3): marca de pocos colores `#rrggbb` minúsculas, lo derivado se calcula en código y no se guarda, texto sobre la marca ≥ 4,5:1 (si ninguna tinta fija llega, se rechaza), marca contra fondo ≥ 3:1, y los colores de estado nunca toman la marca. Es la misma M1–M4 de la carta (se reutiliza `validarMarcaParaGuardar`, sin lógica nueva de contraste).

## 3. Mecanismo propuesto (igual al de la carta, para no inventar otro)

- Clave nueva `portal_color_marca` (un color por empresa) y marcador `portal_marca_derivada = "si"`, en el catálogo del portal (las claves del portal pasan de 22 a 24). Sin el marcador el portal se lee **exactamente como hoy** (los colores sueltos nunca se borran: dejan de leerse). Sin migración (el portal es JSON).
- Activación con un **botón explícito** («Pasar a color de marca» / «Volver a mis colores anteriores») y rechazo al guardar si no cumple M1/M2/M3, como en la carta (SUPUESTO del orquestador, P4 de §5).

## 4. Tabla de derivación (las 12 claves)

Contrastes calculados con WCAG 2.1 sobre blanco (fondo del portal derivado = el blanco del sistema). Tinta del sistema `#1c1b19` sobre blanco 17,21:1; tinta suave `#57534e` sobre blanco 7,63:1; tinta sobre el gris real `#e5dfdf` 13,07:1 y tinta suave sobre `#e5dfdf` 5,80:1.

| # | Clave | Qué pinta | Valor actual en la empresa real | Hoy, sin valor, cae a | En modo marca | Contraste |
|---|---|---|---|---|---|---|
| 1 | `portal_header_bg` | Fondo del encabezado | `#e5dfdf` | transparente | **CONFIRMADA (P1):** neutro del sistema (transparente/blanco); la marca no pinta el encabezado | tinta 17,21:1 sobre blanco |
| 2 | `portal_header_color` | Texto del encabezado | vacío | hereda | Tinta del sistema (hereda) | 17,21:1 |
| 3 | `portal_etiqueta_color` | Etiqueta sobre el título | vacío | tinta suave | Tinta suave del sistema (igual que hoy) | 7,63:1 |
| 4 | `portal_titulo_color` | Título | vacío | hereda | Tinta del sistema (igual que hoy) | 17,21:1 |
| 5 | `portal_fondo_color` | Fondo de la página | vacío | transparente | Blanco del sistema (no se pinta con la marca) | — (es el fondo contra el que se mide M3) |
| 6 | `portal_card_bg` | Fondo de la tarjeta | `transparent` | `#ffffff` | **Mapa: sigue transparente (CONFIRMADA, P2).** Grilla: blanco | — |
| 7 | `portal_card_border` | Borde de la tarjeta | `transparent` | `#e7e5e4` | **Mapa:** transparente. **Grilla:** borde del sistema `#e7e5e4` (decorativo, no necesita 3:1) | — |
| 8 | `portal_card_border_hover` | Borde al pasar el mouse / foco | `transparent` | borde normal | **Grilla:** la marca (elemento: M3 ≥ 3:1). **Mapa:** transparente | M3: la marca contra blanco; #5c57a2 6,29, #e17360 3,08, #797d62 4,27; #96bbbb 2,07 y #ffcb69 1,50 se rechazan al guardar |
| 9 | `portal_card_color` | Nombre de la tarjeta | `transparent` | tinta `#1c1b19` | **Mapa:** no se deriva (el nombre viene en la imagen). **Grilla:** tinta del sistema (texto: nunca la marca) | 17,21:1 |
| 10 | `portal_card_color_hover` | Nombre al pasar el mouse | `transparent` | igual al normal | Igual al normal (el cambio al pasar el mouse lo da el borde, no el texto) | 17,21:1 |
| 11 | `portal_card_notas_color` | Subtítulo de la tarjeta | `transparent` | tinta suave | **Mapa:** no se deriva. **Grilla:** tinta suave del sistema | 7,63:1 |
| 12 | `portal_card_flecha_color` | Flecha de la tarjeta | `transparent` | el color del texto | **Grilla:** la marca (elemento gráfico, M3 ≥ 3:1). **Mapa:** transparente | M3 (misma tabla que la fila 8) |

Regla que ordena la tabla: **la marca pinta ELEMENTOS** (borde al pasar el mouse, flecha y, si el dueño elige A, el encabezado); **los textos usan siempre la tinta del sistema** (mismo criterio que la carta: «Marca 3:1 y textos con tinta del sistema»). Los colores de estado nunca toman la marca.

## 5. Decisiones del dueño (2026-11-13, chat del dueño con el orquestador)

1. **P1 — Encabezado del portal: CONFIRMADA.** «Queda neutro; la marca solo en bordes y flechas (Recomendada)». El encabezado usa el neutro del sistema; la marca pinta el borde de la tarjeta al pasar el mouse y la flecha.
2. **P2 — Tarjetas del mapa: CONFIRMADA.** «Siguen transparentes (Recomendada)». En modo marca las tarjetas sobre el mapa no se pintan (zonas tocables sobre la imagen); la marca solo pinta borde y flecha de las tarjetas de la grilla.
3. **P3 — Color de la empresa: CONFIRMADA.** «Lo elige quien administra, al pasar el portal (Recomendada)». No se asume ningún color: el sistema solo lo guarda si se lee (M2 y M3) y, si no, avisa qué hacer. (Ninguna de las cinco marcas de sucursal es «la de la empresa».)
4. **P4 — Mismas reglas que la carta (botón explícito, conservar hasta reeditar, rechazo con «qué hacer»): SUPUESTO del orquestador**, por coherencia con lo que el dueño ya confirmó para la carta; el dueño lo corrige si no es así. No es una aceptación del dueño (I1).

## 6. Qué entra (dos PR chicos, sin migración)

- Núcleo: `validarMarcaParaGuardar` ya existe y se reutiliza; solo hace falta decidir la tabla de arriba.
- Lectura: `resolverEstiloPortal` con el modo marca (las 12 variables según la tabla; sin marcador, idéntico a hoy); prueba «sin cambio» con el portal real (ya hay golden del portal real y del portal sin configurar).
- Guardado: el guard del portal rechaza M1/M2/M3 con marcador, antes de escribir; los mismos controles de concurrencia, idempotencia y permisos que `guardarPortalEmpresa` hoy.
- Pantalla: sección «Color de marca» en `/carta/portal` con selector, vista previa y los dos botones.
- Sin migración. Dos PR chicos (lectura; guardado y editor), como en la carta.
