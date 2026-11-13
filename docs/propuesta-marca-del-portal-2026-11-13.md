# Marca del portal (por empresa): tabla de derivación — PROPUESTA

> **Estado: PROPUESTA, nada construido.** Es un documento para que el dueño elija; ninguna fila es decisión hasta que el dueño la confirme con su cita (I1/I2). Continúa `docs/diseno-marca-por-sucursal-y-empresa-2026-11-12.md` (paso 9: «un color por empresa para el portal, el resto derivado»). La marca de la **sucursal** (carta) ya está construida (PR #264, #269, #270); esto es la de la **empresa** (el portal `/carta-publica/<empresa>`).
> Etiquetas: **ACTUAL** (verificado en el código o en la base de ensayo, solo lectura) · **PROPUESTA** (mía, a confirmar) · **PREGUNTA** (decide el dueño).

## 1. Qué hay hoy

- El portal tiene **12 claves de color** (`CLAVES_PORTAL_V1` en `src/core/carta/portal.ts`) que llegan al CSS como `--portal-*` (`src/app/globals.css`, líneas 389–440). Sin valor cargado, cada una cae a los tokens de la carta: tinta `#1c1b19`, tinta suave `#57534e`, borde `#e7e5e4`, fondo blanco (ACTUAL).
- **Lo cargado en la empresa real (rama de ensayo del 2026-11-13, solo lectura):** `portal_header_bg = #e5dfdf` (gris cálido claro) y **siete claves de tarjeta en `transparent`** (`card_bg`, `card_border`, `card_border_hover`, `card_color`, `card_color_hover`, `card_notas_color`, `card_flecha_color`). El resto está vacío. O sea: el portal real es un **mapa** (imagen de fondo + tarjetas posicionadas en %) cuyas tarjetas son **zonas tocables transparentes** sobre la imagen; el nombre y la foto ya vienen dibujados en la imagen (ACTUAL; lo de que el nombre «viene en la imagen» es lectura del dato, NO VERIFICADO con el dueño).
- Consecuencia de diseño: **una derivación que pinte las tarjetas (fondo blanco, texto, borde) taparía la imagen del mapa** del portal real. Por eso la pregunta 2 de abajo.

## 2. Regla de referencia (Pedernal) y cómo se aplica

Pedernal no tiene portal en v1 (`10-ux-ui/03-experiencia-de-la-carta.md` §13 punto 15: «portal de grupo… decisión aparte»; `migracion-de-la-carta-de-motor2-especificacion.md`: `PortalCartaEmpresa` y sus 22 claves no migran como libres, la identidad es de **lista cerrada**). No hay regla de Pedernal propia del portal; rige la general (`01-arquitectura-de-experiencia.md` §4.2–4.3): marca de pocos colores `#rrggbb` minúsculas, lo derivado se calcula en código y no se guarda, texto sobre la marca ≥ 4,5:1 (si ninguna tinta fija llega, se rechaza), marca contra fondo ≥ 3:1, y los colores de estado nunca toman la marca. Es la misma M1–M4 de la carta (se reutiliza `validarMarcaParaGuardar`, sin lógica nueva de contraste).

## 3. Mecanismo propuesto (igual al de la carta, para no inventar otro)

- Clave nueva `portal_color_marca` (un color por empresa) y marcador `portal_marca_derivada = "si"`, en el catálogo del portal (las claves del portal pasan de 22 a 24). Sin el marcador el portal se lee **exactamente como hoy** (los colores sueltos nunca se borran: dejan de leerse). Sin migración (el portal es JSON).
- Activación con un **botón explícito** («Pasar a color de marca» / «Volver a mis colores anteriores») y rechazo al guardar si no cumple M1/M2/M3 (misma decisión del dueño que en la carta; **PREGUNTA 4** confirma que vale también acá).

## 4. Tabla de derivación (las 12 claves)

Contrastes calculados con WCAG 2.1 sobre blanco (fondo del portal derivado = el blanco del sistema). Tinta del sistema `#1c1b19` sobre blanco 17,21:1; tinta suave `#57534e` sobre blanco 7,63:1; tinta sobre el gris real `#e5dfdf` 13,07:1 y tinta suave sobre `#e5dfdf` 5,80:1.

| # | Clave | Qué pinta | Valor actual en la empresa real | Hoy, sin valor, cae a | En modo marca (PROPUESTA) | Contraste (propuesta) |
|---|---|---|---|---|---|---|
| 1 | `portal_header_bg` | Fondo del encabezado | `#e5dfdf` | transparente | **B (recomendada):** neutro del sistema (transparente/blanco), la marca no pinta el encabezado. **A:** la marca | B: tinta 17,21:1 sobre blanco. A: según marca (M2: tinta sobre marca ≥ 4,5:1; #5c57a2 6,29 con tinta clara) |
| 2 | `portal_header_color` | Texto del encabezado | vacío | hereda | B: tinta del sistema. A: la tinta derivada sobre la marca | B 17,21:1; A ≥ 4,5:1 (M2, si no llega se rechaza al guardar) |
| 3 | `portal_etiqueta_color` | Etiqueta sobre el título | vacío | tinta suave | Tinta suave del sistema (igual que hoy) | 7,63:1 |
| 4 | `portal_titulo_color` | Título | vacío | hereda | Tinta del sistema (igual que hoy) | 17,21:1 |
| 5 | `portal_fondo_color` | Fondo de la página | vacío | transparente | Blanco del sistema (no se pinta con la marca) | — (es el fondo contra el que se mide M3) |
| 6 | `portal_card_bg` | Fondo de la tarjeta | `transparent` | `#ffffff` | **Mapa:** no se deriva, sigue transparente (PREGUNTA 2). **Grilla:** blanco | — |
| 7 | `portal_card_border` | Borde de la tarjeta | `transparent` | `#e7e5e4` | **Mapa:** transparente. **Grilla:** borde del sistema `#e7e5e4` (decorativo, no necesita 3:1) | — |
| 8 | `portal_card_border_hover` | Borde al pasar el mouse / foco | `transparent` | borde normal | **Grilla:** la marca (elemento: M3 ≥ 3:1). **Mapa:** transparente | M3: la marca contra blanco; #5c57a2 6,29, #e17360 3,08, #797d62 4,27; #96bbbb 2,07 y #ffcb69 1,50 se rechazan al guardar |
| 9 | `portal_card_color` | Nombre de la tarjeta | `transparent` | tinta `#1c1b19` | **Mapa:** no se deriva (el nombre viene en la imagen). **Grilla:** tinta del sistema (texto: nunca la marca) | 17,21:1 |
| 10 | `portal_card_color_hover` | Nombre al pasar el mouse | `transparent` | igual al normal | Igual al normal (el cambio al pasar el mouse lo da el borde, no el texto) | 17,21:1 |
| 11 | `portal_card_notas_color` | Subtítulo de la tarjeta | `transparent` | tinta suave | **Mapa:** no se deriva. **Grilla:** tinta suave del sistema | 7,63:1 |
| 12 | `portal_card_flecha_color` | Flecha de la tarjeta | `transparent` | el color del texto | **Grilla:** la marca (elemento gráfico, M3 ≥ 3:1). **Mapa:** transparente | M3 (misma tabla que la fila 8) |

Regla que ordena la tabla: **la marca pinta ELEMENTOS** (borde al pasar el mouse, flecha y, si el dueño elige A, el encabezado); **los textos usan siempre la tinta del sistema** (mismo criterio que la carta: «Marca 3:1 y textos con tinta del sistema»). Los colores de estado nunca toman la marca.

## 5. Preguntas para el dueño (una a una; la recomendada primero)

1. **Encabezado del portal.** Hoy es gris claro `#e5dfdf`. (B, recomendada) El encabezado queda neutro del sistema y la marca solo se ve en bordes y flechas: el portal real casi no cambia de aspecto. (A) El encabezado se pinta con el color de marca (con texto de la tinta que se lea): el portal cambia de aspecto.
2. **Tarjetas del mapa.** En el portal real las tarjetas son zonas tocables transparentes sobre la imagen del mapa. (Recomendada) En modo marca las tarjetas del mapa **siguen transparentes** (no se tapa la imagen); la marca solo pinta borde y flecha en la grilla. (Alternativa) Pintar también las del mapa: taparía la imagen.
3. **¿Qué color es «la marca de la empresa»?** Es UN color para todo el portal; las cinco sucursales tienen cada una el suyo (`#5c57a2`, `#797d62`, `#96bbbb`, `#e17360`, `#ffcb69`) y ninguna es «la de la empresa». Hay que elegirlo. Aviso: `#96bbbb` y `#ffcb69` no pasan M3 contra blanco (2,07:1 y 1,50:1) y `#797d62` no pasa M2 con la tinta del sistema (4,42:1): el sistema los rechazaría.
4. **¿Valen para el portal las mismas reglas que para la carta?** (Recomendada) Sí: botón explícito para activar y para volver, lo ya publicado se conserva hasta que se reedite, y un color que no se lee se rechaza diciendo qué hacer.

## 6. Qué entraría si el dueño confirma (para dimensionar; no se construye hasta entonces)

- Núcleo: `validarMarcaParaGuardar` ya existe y se reutiliza; solo hace falta decidir la tabla de arriba.
- Lectura: `resolverEstiloPortal` con el modo marca (las 12 variables según la tabla; sin marcador, idéntico a hoy); prueba «sin cambio» con el portal real (ya hay golden del portal real y del portal sin configurar).
- Guardado: el guard del portal rechaza M1/M2/M3 con marcador, antes de escribir; los mismos controles de concurrencia, idempotencia y permisos que `guardarPortalEmpresa` hoy.
- Pantalla: sección «Color de marca» en `/carta/portal` con selector, vista previa y los dos botones.
- Sin migración. Dos PR chicos (lectura; guardado y editor), como en la carta.
