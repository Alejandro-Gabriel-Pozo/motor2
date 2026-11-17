# Carta: la pantalla «Apariencia y publicación» igual a Pedernal (niveles 1 a 10)

> **Estado:** Frente 7 (CARTA), 2026-11-17. **Prioridad: LO VISIBLE VA PRIMERO** (orden del orquestador general, que relata la del dueño). Este documento decide qué pide la pantalla y qué se esconde; la construcción va en el mismo PR (ver §8).
> **Pedido del dueño (2026-11-17, chat con el orquestador general, literal; registrado en `motor2-docs` 12d2cd4):** «apariencia y publicación de la carta pide un montón de cosas que Pedernal ya da por sentadas […] Pedernal acortaba la petición de datos y la hacía bastante más breve. Te pedía color de marca nada más. Lo otro iba por contraste y como era oscuro quedaba ahí. El color de marca se aplicaba a determinadas cosas y era bastante puntual y rápido.» y «hemos consumido un montón de tiempo… las pantallas no parecen las de Pedernal».
> **Estados:** CONFIRMADA (la dice la cita de arriba) · PROPUESTA · PENDIENTE · NO VERIFICADO (†).
> **Fuentes de Pedernal leídas hoy (ZuluHub-docs `main`, solo lectura):** `10-ux-ui/prototipos-gastronomia/{carta.html, carta-caras.html, carta-en-linea.html}`, `11-especificaciones/conceptos/{color-de-la-carta-y-otro-color, cara-de-la-carta, logo-de-la-carta, herencia-empresa-sucursal-de-la-identidad, nombre-propio-de-la-carta-por-sucursal, rubro-y-lugar-de-la-carta, qr-de-la-carta-y-qr-con-logo, estado-de-la-carta-en-linea-y-fuera-de-linea}.md` y `sql-pendientes-otros-modulos/0077_identidad_de_la_carta.sql`. † `carta-identidad-y-portal-datos-diseno.md` (nombrado por el orquestador) **no está en `main`** de ZuluHub-docs: no pude leerlo; las fichas de concepto citan sus decisiones (CYN 101 a 108).

## 1. Propósito y alcance (CONFIRMADA)

Que la pantalla de apariencia de la carta pida **lo mínimo**, como Pedernal: **el color de marca** y lo poco que Pedernal pide junto con él, y que todo lo demás se **derive por contraste** sobre el fondo oscuro de la carta. **Dentro del alcance de esta etapa:** la pestaña **Tema** (la carta de la sucursal activa). **Fuera (etapa siguiente, con el portal PR-A):** la pestaña **Portal** (empresa) y la publicación (slug, publicada). No se agregan funciones: se **achica** lo que se pide.

## 2. Qué pide Pedernal, qué pide Motor2 hoy y qué pasa con cada campo de más

**Pedernal (pantalla «Marca de la sucursal» y «Carta en línea»):** *color principal* (6 paletas o «Otro color» `#rrggbb`; el sistema elige el texto blanco o negro y, si no llega a **7:1**, oscurece el color conservando el tono y avisa; deja guardar: CYN 107); *logo* (el símbolo sin el nombre, sobre una placa clara; si no hay, la inicial del nombre); *nombre y lema* (carta.html: nombre ≤ 40, lema ≤ 60; carta en línea: nombre de la carta ≤ 80, rubro ≤ 40, lugar ≤ 120). Una «cara» a elegir entre tres (catálogo cerrado; por defecto la «Pastelería de día»), no pedida por el dueño: **no entra**. Texto, fondo, precio y foco son **del sistema** (contraste ≥ 7:1, «del código»). Nada de tamaños de letra por zona, colores por elemento ni posiciones.

**Motor2 hoy (Tema, 65 claves en 15 zonas):**

| Zona del Tema hoy | Claves | Qué es | Qué pasa con ellas (esta etapa) |
|---|---|---|---|
| Colores generales | 7 | `color_marca`, `marca_derivada` («Usar solo el color de marca») y 5 colores sueltos (fondo, portada…) | **`color_marca` se queda y es lo único que pide.** `marca_derivada` deja de preguntarse (se aplica sola al elegir la marca). Los colores sueltos se **esconden**; si tienen valor, **mandan** |
| Portada e identidad | 8 | nombre, subtítulo, descripción, etiqueta superior, logo, imagen de fondo, dos posiciones | **Quedan 3: nombre, subtítulo (lema) y logo** (lo mínimo de Pedernal). Descripción, etiqueta, imagen de fondo y posiciones: escondidos |
| Contacto | 4 | Instagram, Facebook, WhatsApp, Maps | Escondidos (Pedernal los resuelve en el Libro, 0086, otro frente: Motor2 ya tiene las claves) |
| Índice · Banda de sección · Ítems · Ítems especiales · Navegación y barra superior | 3+3+4+4+5 | colores por elemento y botón «volver» | Escondidos: **por contraste** salen del color de marca y del fondo oscuro |
| Textos fijos | 4 | textos de portada e índice | Escondidos (vale el texto por defecto) |
| Tipografía general · de portada · de índice · de banda · de ítems | 1+5+4+3+4 | familia y tamaños de letra por zona | Escondidos (Pedernal: el tamaño lo cambia el comensal con el control «Letra») |
| Banda e imagen de sección | 6 | alto de banda, posición, degradé, opacidad de la imagen | Escondidos |

**Regla que rige todo lo escondido (CONFIRMADA por la cita: «lo otro iba por contraste»):** los campos de más **no se borran**; se esconden con un **interruptor reversible** (una constante del código, `TEMA_AVANZADO_VISIBLE = false`, que con `true` muestra el editor de hoy completo) y **lo ya cargado por una empresa sigue mandando**: si una sucursal tiene un color o un texto cargado, la carta pública lo sigue usando como hasta ahora; solo lo **vacío** se resuelve por contraste.

## 3. Lo que la pantalla pide (PROPUESTA, mínimo de Pedernal)

Cuatro campos, en este orden: **Color de marca** (con las 6 paletas de Pedernal y «Otro color» `#rrggbb`; vista previa con el color aplicado), **Logo** (dirección de imagen; vacío = la inicial del nombre), **Nombre** y **Lema**. Guardar = aplicar (como hoy). Un solo botón. Sin «pasar/volver»: elegir la marca ya la aplica.

## 4. Dónde se aplica el color de marca (PROPUESTA, «puntual»)

El color de marca se usa **solo** en: la banda y el título de la portada, el acento (precio, botones, vínculos) y el realce de la sección activa. El texto, el fondo y los bordes son del sistema (oscuro), con contraste ≥ 7:1 calculado por una función pura (`razonDeContraste`, ya existe en `src/core/carta/color-css.ts`). † Verificar qué claves del Tema consume hoy `marca_derivada` (`src/core/carta/marca-derivada.ts` y la lectura pública) para listar exactamente a qué elementos llega la marca; no se agregan elementos nuevos.

## 5. Invariantes y políticas

- **I1. Lo cargado manda.** Guardar desde la pantalla simple cambia **solo** las claves de la pantalla simple y **conserva todas las demás** tal cual están (el guardado de hoy vacía lo que no viene en el formulario: no sirve). Prueba: una sucursal con 40 claves cargadas guarda un color nuevo y las 40 siguen iguales.
- **I2. Contraste.** Con la marca que sea, el texto sobre la marca y los elementos contra el fondo oscuro llegan a 7:1 **al mostrar** (ajustando la luminosidad sin cambiar el tono, nunca guardando otro color). † **PENDIENTE (UNA pregunta al dueño):** hoy el guardado **rechaza** un color que no se lee (decisión del dueño 2026-11-13 «Se rechaza y dice qué hacer (Recomendada)»); Pedernal lo **ajusta y avisa** y deja guardar (CYN 107). Mientras no se responda, **se mantiene el rechazo de hoy** (estado actual, sin cambios).
- **I3. Todo nace cerrado.** Un campo nuevo no se muestra sin declararlo; el interruptor nace en `false`.
- **I4. Permisos.** Los de hoy (`carta_tema`): operador no edita; gerente y administrador sí. Sin permiso nuevo.

## 6. Historia y persistencia

**Sin migración ni tabla.** El Tema sigue siendo `TemaCartaSucursal.valores` (JSON) y `aplicarEnCarta`. El guardado nuevo hace **mezcla** (lee lo guardado, cambia 4 claves, escribe todo junto) en una transacción SERIALIZABLE con `versionEsperada`, e idempotente por estado (mismo contenido: no escribe ni versiona), con la auditoría que ya tiene el guardado del tema.

## 7. Combinaciones (oráculo, tabla aparte del código)

Dimensiones que cambian lo que se ve: **color de marca** (paleta por defecto, cada una de las 6 paletas, extremos: blanco, negro, amarillo claro, azul oscuro) × **valores ya cargados** (ninguno / algunos / todos) × **interruptor** (escondido / visible) × **logo** (con / sin). Resultado esperado escrito aparte: con cualquier marca el contraste del texto y de los elementos es ≥ 7:1; un valor cargado no cambia al guardar la marca; con el interruptor en `true` se ve el editor de hoy. Test exhaustivo de la tabla y un guardián que falle si aparece una clave del Tema sin declarar si es de la pantalla simple o escondida.

## 8. Construcción (en el mismo PR; PR borrador con plantilla)

Archivos probables: `src/core/carta/` (constante del interruptor, lista de claves simples, derivación por contraste), `src/server/actions/carta/tema.ts` (acción de guardado simple con mezcla; permiso `carta_tema`), `src/components/carta/editor-tema.tsx` y `src/app/(app)/carta/tema/page.tsx` (pantalla simple; **archivos de pantalla: se coordina con el Frente 6**), tests de contraste (paleta por defecto y extremos), de mezcla, de permisos (con la mutación `void gate;`), de aislamiento y de combinaciones. **Zona restringida:** si el guardián de textos T1 o los goldens piden tocar `src/core/textos/*` o los goldens, **no se tocan**: se pide el turno (los textos nuevos de la pantalla —«Color de marca», «Logo», «Nombre», «Lema»— están, según Pedernal, ya aprobados en `carta.html` el 09/11/2026 para «Identidad de la carta»).

## 9. Lo que NO se hace (alcance del pedido)

No se agrega la «cara» (no pedida); no se tocan el portal ni la publicación en esta etapa; no se borra ningún valor cargado; no se cambia la carta pública para quien ya tiene valores; no se agregan campos.

## 10. Pruebas, capturas y operación

Contraste (paleta por defecto y 12 extremos), mezcla («lo cargado manda»), idempotencia (guardar dos veces), concurrencia (dos guardados con la misma versión: gana uno), permisos, aislamiento (otra sucursal/empresa), y **capturas ANTES/DESPUÉS a 375 px y a escritorio** de la pantalla real. † **Datos de Huinganco:** no están en la única base de Motor2 que tengo permitida para leer (la rama `main` del proyecto Neon «motor2-multitenancy-fase-a» tiene «Zulu Hub Demo» con una sucursal «Central» y 1 tema, sin productos); las capturas se hacen sobre esa empresa de demostración y quedan marcadas; si los datos de Huinganco están en otro lugar, el orquestador me dice cuál.
