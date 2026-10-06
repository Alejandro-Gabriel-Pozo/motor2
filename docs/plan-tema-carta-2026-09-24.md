# Plan: el tema visual de la carta (`SiteConfig`, hoy la tab "Config" de la sheet de cada tenant) pasa a un editor con persistencia en motor2

> **Actualización 2026-09-30:** las 3 claves de miniatura de la imagen de sección (`carta_imagen_modo`, `carta_imagen_ancho_mobile`, `carta_imagen_ancho_desktop`) se retiraron del catálogo (`CLAVES_RETIRADAS`, `src/core/carta/tema.ts`); la imagen de sección se dibuja siempre como fondo de la banda, y se eliminaron los tipos `anchoImagenMobile` y `tamanoFondo` con sus validadores. El catálogo vigente tiene 64 claves por sucursal; lo que sigue es el plan original.

**Versión final para implementar.** Catálogo de 67 claves por tenant; el plan termina en M9 (motor2) y R4 (restaurant-menu-design).

Plan escrito el 2026-09-24 por un agente de planificación (Opus) y actualizado el mismo día con las resoluciones del dueño:
- Se migran de una vez los 4 bloques por tenant: A=6, B=23, C=9, D=29.
- Las 3 claves de precio (`precio_locale`, `precio_simbolo`, `precio_posicion`) quedan afuera del editor. Son la convención fija del sistema argentino: es-AR, "$", símbolo a la izquierda.
- M10 (avisos de contraste) y M11 (relajar `sheetId`) quedan descartados. No se hacen. `sheetId` sigue siendo siempre obligatorio.

**Red de seguridad:** la rama `standalone-sin-motor2` de restaurant-menu-design (local y en `origin`, y además replicada como repo independiente `restaurant-menu-design-standalone`) apunta a `544f432`, anterior a toda la integración. Verificado.

**Bases:**
- motor2: `64060b8`.
- restaurant-menu-design: `f4529ce`.
- Las dos en `claude/merge-menu-inventory-repos-5ot8uc`, con el árbol limpio.

**Molde:** el de `docs/plan-carta-catalogo-2026-09-24.md` y `docs/plan-registro-tenants-2026-09-24.md`. Tabla nueva 1:1 y opt-in en motor2, endpoint de solo lectura con `CARTA_API_TOKEN`, restaurant-menu-design que lo consume tenant por tenant con la sheet como respaldo, y pantalla de administración en motor2. El dueño ya eligió el editor con persistencia (§2.2); este plan no lo discute.

---

## A. Lo que cambia respecto del pedido (verificado en el código)

1. **Solo una página lee el `Config` de la sheet de un tenant: `app/carta/[sucursal]/page.tsx:33` (`getConfig(tenant.sheet_id)`).** Las demás leen la config **raíz** (`ROOT_SHEET_ID`, `MASTER_SHEET_ID` o `MENU_SHEET_ID`), nunca la de un tenant:
   - `app/layout.tsx:22,65` (metadata y viewport);
   - `app/manifest.ts:5`;
   - `app/page.tsx:25,39` (portal y modo single);
   - `app/carta/page.tsx` y `app/carta-demo/page.tsx`.

   Por lo tanto SEO/OG, favicon, `theme_color`, `lang`, `empresa_*`, `portal_*` y `footer_texto_derechos` **no son por tenant** y no entran en una tabla por sucursal. Queda un pendiente aparte: "config del portal/raíz".
2. **`SiteConfig` tiene 109 claves. En `/carta/[sucursal]` tienen efecto real 70**, a través de `CartaView`, `buildCssVars`, `CartaControls` (`carta-nav.tsx`, `carta-topbar.tsx`), `CartaSectionImage` y `formatPrecio`. Las otras 39 son de la raíz o no tienen efecto en la página del tenant:
   - Las 6 de `MenuHero` (`hero_pos_*` ×4, `hero_etiqueta_scroll`, `restaurante_boton_hero`) solo se dibujan en el modo single de `/`.
   - Los 6 colores semánticos `color_nav/seccion/especial/cta/tags/precio` solo los usan `menu-section.tsx`/`menu-nav.tsx`, que también son del modo single. `CartaView` usa solo `--primary`, `--hero-ink`, `--background`, `--portada-textos` y `--portada-cta`.
   - Las 27 restantes son de la raíz (A.1).

   De las 70, **3 son de precio y el dueño las fija por convención**, así que el catálogo del editor queda en **67** (D3). Las de precio se siguen resolviendo como hoy: sheet del tenant y, si no hay valor, el default de la carta, que ya es `es-AR`, `$` e `izquierda` (`lib/get-config.ts`).
3. **`sanitizeCssColor` se aplica en un solo lugar: `z()` de `buildCssVars` (`lib/utils.ts:56`).** Estos colores llegan sin sanitizar a los `style` de React:
   - `color_marca` → `--primary` (`lib/utils.ts:48`);
   - `hero_color_fondo`;
   - los 17 colores directos: índice, banda, ítems y especiales en `carta-view.tsx`, `color_nav_*` en `carta-nav.tsx` y `topbar_back_color`.

   Con la sheet como fuente, esto ya es un hueco hoy: un `;` agrega declaraciones al `style` del elemento. Con motor2 como fuente se sanea en las dos puntas (D8). Arreglar el camino de la sheet cambia el comportamiento de tenants existentes y queda como pendiente aparte (E).
4. **`hero_color_fondo` se concatena como `${acento}BF`** (`carta-view.tsx`, `menu-hero.tsx`). El overlay solo funciona con hex `#rrggbb`. `<input type="color">` también maneja solo `#rrggbb`.
5. **`claro`/`oscuro` solo tienen sentido en `hero_ink`** (`resolveHeroInk`). `sanitizeCssColor` los acepta en cualquier clave, y en las demás terminan como CSS inválido que el navegador ignora.
6. **`carta_banda_alto_desktop` se inyecta crudo dentro de un `<style>`** (`carta-view.tsx:389-393`: `.section-header-band { height: ${…} !important; }`).
   - Hoy es un vector de inyección CSS desde la sheet: un `}` cierra la regla y permite estilos arbitrarios en la página. D13 lo cierra para el camino de motor2, y restaurant-menu-design vuelve a sanear.
   - Además, un valor sin unidad ("120") en la sheet produce `height: 120 !important`, que es CSS inválido. motor2 lo normaliza a `120px`.
7. **Fuera del editor, pero registrado:** `precio_locale` puede romper el render. `formatPrecio` (`lib/format-utils.ts:32`) llama a `toLocaleString(config.precio_locale)`, y un tag inválido tira `RangeError`. Verificado: `(1).toLocaleString("es_AR")` → "Incorrect locale information provided". Como estas claves no entran a motor2, el riesgo sigue existiendo solo en el camino de la sheet. Queda como pendiente aparte (E).
8. **`restaurante_footer_maps_url` va directo a un `href`** (`carta-nav.tsx:31`). `restaurante_instagram` y `restaurante_facebook` también, cuando empiezan con `http`. Solo se aceptan `https://` (D13).
9. **Rarezas que ya existen y no se corrigen acá (motor2 solo evita cargarlas):**
   - `carta_imagen_opacidad = 0` termina siendo 38 (`Number(x) || 38`); por eso se exige 1-100.
   - `CartaSectionImage` hace `Number(bandaAltoDesktop.replace("px",""))`: con un `clamp()`, la miniatura cae al valor crudo.
10. **La trampa de `sheetId` (plan de registro A.1/D8).** Aunque las 67 claves pasen a motor2, **`sheetId` sigue siendo obligatorio** por decisión del dueño y por dos motivos concretos:
    - la sheet es el único respaldo del tema si motor2 falla;
    - las 3 claves de precio se siguen leyendo de la sheet del tenant.

    Sigue vigente que `getConfig(undefined)` cae **en silencio** a `MENU_SHEET_ID` (`get-config.ts:255`), mientras que `getConfig("")` devuelve `defaults`. Por eso se agrega una guarda defensiva (D10, R2).
11. **`quitarSucursalDelPortal` borra la fila de `SucursalPublica` con `deleteMany`** (`src/server/actions/carta/registro-publico.ts:150`). Una tabla hija con FK RESTRICT la haría fallar con P2003. Con Cascade, "quitar del portal" borraría el tema. Ver D1.
12. **Los tests del registro comparan el objeto completo con `toEqual`** (`test/carta/api-carta-tenants.test.ts:79`, `test/e2e/api-carta-tenants.spec.ts:41`). Cualquier campo nuevo en el contrato obliga a actualizarlos en el mismo commit. Los de `[sucursal]` (`api-carta.test.ts`, `api-carta.spec.ts`) tienen que quedar **idénticos**.
13. **Hoy no hay ninguna columna `Json` en el schema.** D2 sería la primera. Hay precedente del mismo tipo: el carta plan introdujo `String[]`, que tampoco tenía uno anterior.
14. **El test de "una sola consulta" del registro cuenta operaciones de Prisma** (`$allOperations`, `test/carta/registro-consulta.test.ts:71`). Un `select` anidado sigue contando como una.
15. **No hay mockup del editor de tema en ninguno de los dos repos** (buscado con grep). La vista previa copia las reglas de `carta-view.tsx` y los defaults de `app/globals.css` de restaurant-menu-design:
    - `--primary`: `oklch(0.76 0.14 80)`;
    - `--background`: `oklch(0.985 0.006 90)`;
    - `--foreground` y `--hero-ink`: `oklch(0.18 0.02 40)`.
16. **axe va a marcar la vista previa.** Con los defaults de la carta (ámbar sobre casi blanco) falla `color-contrast`, así que hay que excluir ese contenedor.
17. **`FormConResultado` hace `form.reset()` cuando la acción sale bien.** El editor se vuelve a montar con `key={actualizadoEn}` para que la vista previa no quede desincronizada.
18. **Frescura:** `/carta/[sucursal]` tiene `revalidate = 3600`, pero los fetch a motor2 usan `revalidate: 300` y manda el menor. Aplicar un tema se ve en hasta 5 minutos.
19. **restaurant-menu-design no tiene Vitest ni Playwright.** La paridad de lo que se porta (`sanitizeCssColor` y los defaults que tienen que pasar los validadores) solo se puede testear del lado de motor2, con tablas copiadas.

---

## B. Decisiones de diseño (con recomendación)

| # | Decisión | Recomendación |
|---|---|---|
| D1 | ¿1:1 con `Sucursal` o con `SucursalPublica`? | **Con `Sucursal`** (`sucursalId @unique`, RESTRICT), como todas las tablas de carta, que cuelgan de entidades del núcleo. Colgar de `SucursalPublica` tiene sentido semántico, pero por A.11 obliga a tocar `quitarSucursalDelPortal` o a usar Cascade, y Cascade borraría el tema en una operación que la pantalla presenta como "vuelta atrás". La regla "el tema de motor2 solo aplica a tenants de su registro" se cumple igual, porque restaurant-menu-design se entera por el registro (D5). Además, así se puede preparar el tema **antes** de agregar la sucursal al portal. |
| D2 | ¿Columnas tipadas o `Json`? | **Una columna `valores Json` con claves iguales a las de `SiteConfig`, más un catálogo en código** (`CLAVES_TEMA_V1`: clave, tipo, bloque, zona, etiqueta en castellano, restricciones, default de la carta). El catálogo alimenta la validación, el formulario, el importador y el contrato. Con 67 claves homogéneas, la alternativa serían 67 columnas `String?`. La salida se sanea como en `filaATenantV1`, porque una carga hecha por `db:studio` no pasa por las acciones. |
| D3 | Alcance | **67 claves por tenant, todas en el catálogo desde el arranque.**<br>**A. Identidad y portada (6):** `restaurante_nombre`, `restaurante_subtitulo`, `restaurante_descripcion`, `restaurante_logo_url`, `hero_imagen_fondo_url`, `hero_etiqueta_superior`.<br>**B. Colores (23):** `color_marca`, `hero_color_fondo`, `hero_ink`, `color_fondo_dia`, `color_portada_textos`, `color_portada_cta`, `color_nav_flechas`, `color_nav_iconos`, `color_indice_numeros`, `color_indice_titulos`, `color_indice_titulo`, `color_banda_etiqueta`, `color_banda_titulo`, `color_banda_descripcion`, `color_item_nombre`, `color_item_precio`, `color_item_descripcion`, `color_item_tags`, `color_especial_item_nombre`, `color_especial_item_precio`, `color_especial_item_descripcion`, `color_especial_item_tags`, `topbar_back_color`.<br>**C. Textos y contacto (9):** `carta_texto_portada_cta`, `carta_texto_portada_separador`, `carta_texto_indice_etiqueta`, `carta_texto_indice_titulo`, `topbar_back_label`, `restaurante_instagram`, `restaurante_facebook`, `restaurante_whatsapp`, `restaurante_footer_maps_url`.<br>**D. Tipografía y layout (29):** los 17 `carta_fuente_*` (banda: etiqueta/titulo/descripcion; item: nombre/precio/descripcion/tags; portada: etiqueta/nombre/subtitulo/descripcion/cta; indice: etiqueta/titulo/numero/categoria/item), `topbar_back_size`, `carta_pos_bloque`, `carta_pos_cta`, `carta_banda_alto_mobile`, `carta_banda_alto_desktop`, `carta_imagen_modo`, `carta_imagen_ancho_mobile`, `carta_imagen_ancho_desktop`, `carta_imagen_pos_x`, `carta_imagen_pos_y`, `carta_imagen_overlay`, `carta_imagen_opacidad`.<br>**Fuera del editor por convención fija del sistema (3):** `precio_locale` (es-AR), `precio_simbolo` ("$"), `precio_posicion` (izquierda). motor2 no las emite, así que siguen saliendo de la sheet o del default (A.2).<br>**Fuera por no ser por sucursal (39):** A.1/A.2.<br>**Total:** 67 + 3 + 39 = 109. |
| D4 | Opt-in | **Si no hay fila, la carta sigue con la sheet.** Además, `aplicarEnCarta Boolean @default(false)`: con `false`, el tema es un borrador que se edita y previsualiza en motor2 mientras la carta sigue con la sheet. Vuelta atrás = desaplicar, sin perder los datos. No se permite aplicar un tema vacío, sin ninguna clave cargada. |
| D5 | Cómo se entera restaurant-menu-design | **Un campo aditivo `temaDesdeMotor2: boolean` en `TenantV1`** del registro, sin subir `version`, igual a `sucursal.temaCarta?.aplicarEnCarta === true`. Espeja `menuDesdeMotor2`. La guardia de restaurant-menu-design lo acepta **opcional** (`undefined` = `false`), así que el orden de deploy da igual. Alternativa descartada: consultar `/tema` para cada tenant de motor2, porque cuesta un fetch por tenant aunque no tenga tema. |
| D6 | Endpoint | **`GET /api/carta/[sucursal]/tema`**, con `[sucursal]` = `Sucursal.id` (D1 del plan de carta) y `autorizarServicioCarta` tal cual.<br>Mismo 404 para: sucursal inexistente o inactiva, sin fila de tema, `aplicarEnCarta=false`, o id de más de 100 caracteres.<br>200 con `Cache-Control: no-store`. 500 genérico con `reportarError`. Solo `GET`. |
| D7 | Contrato | `TemaCartaV1 = { version: 1, generadoEn, sucursalId, actualizadoEn, valores: Record<clave, string \| null> }`. motor2 emite **siempre las 67 claves** del catálogo, con `null` en las que no están cargadas. En restaurant-menu-design:<br>• Una clave **presente y conocida por su tabla de tipos** (R1) la decide motor2. `null`, `""` o un valor que no pasa el saneamiento → **default de la carta, no la sheet**.<br>• Una clave ausente o desconocida → la sheet. Las 3 de precio caen siempre en este caso.<br>Es el "motor2 gana toda la fila" de D7 del registro, aplicado clave por clave. |
| D8 | Validación por tipo | **Validar en la entrada en motor2 y volver a sanear en restaurant-menu-design** (defensa en profundidad).<br>• **Colores:** se portan a motor2 `sanitizeCssColor`, `resolveHeroInk` y `resolvePrimaryForeground` con sus parsers (copia literal, nota de origen, test de paridad).<br>• **Reglas extra en motor2:** alias solo en `hero_ink`; `hero_color_fondo` solo `#rgb`/`#rrggbb`, normalizado a `#rrggbb`; máximo 100 caracteres.<br>• **Longitudes CSS, enumerados, números, URLs y textos:** D13.<br>• **restaurant-menu-design** sanea con su propio `sanitizeCssColor`, sin reimplementarlo, más chequeos mínimos por tipo (R1). No hay paquete compartido: son repos separados. |
| D9 | Combinación en restaurant-menu-design | `getConfigForTenant(tenant)` lee en paralelo la sheet (`getConfig(sheet_id)`) y motor2, y combina con `combinarConfig(sheet, tema)`, que es pura.<br>• `tema === null` → la sheet tal cual.<br>• motor2 falla → la sheet completa (el comportamiento de hoy).<br>• La sheet falla → defaults (el comportamiento de hoy). |
| D10 | `sheetId` | **Siempre obligatorio para publicar, sin cambios:** `guardarSucursalPublica` y `tenantMotor2ATenant` no se tocan. Motivos en A.10. Guarda defensiva nueva: `getConfigForTenant` nunca llama a `getConfig` con un id vacío o `undefined`. |
| D11 | Pantalla y vista previa | **`/catalogo/carta/tema`, sobre la sucursal activa** (precedente: las promos de `/catalogo/carta`).<br>• Editor cliente con los **67 campos agrupados por zona en `<details>`** y un widget según el tipo (M9).<br>• Vista previa esquemática en vivo que simula A, B, C, la tipografía y parte del layout (alto de banda, posición de bloque y CTA). Los precios se muestran con la convención fija (es-AR, `$` a la izquierda). No simula los modos de imagen de sección.<br>• Botones Guardar y Aplicar/Desaplicar separados. |
| D12 | Carga inicial | **"Pegar desde la sheet":** un textarea donde se pegan las columnas A:B de la tab Config (TSV). Un parser puro rellena el formulario **sin guardar** y clasifica lo que no entra: fijas del sistema (las 3 de precio), no por tenant (39), desconocidas, e inválidas con su motivo. Alternativa: que motor2 lea el gviz, lo que suma una dependencia saliente a Google y un port de `lib/gviz.ts`. |
| D13 | Validadores de tipografía, layout y contacto | Módulo puro `src/core/carta/css-valores.ts`, diseñado abajo. Cada clave del catálogo declara su tipo, y cada tipo tiene su validador y su normalización. |

### D13 en detalle: gramática y validadores

**Filtro de caracteres.** Es la primera línea contra la inyección y se aplica a todo valor CSS. El valor, ya recortado y pasado a minúsculas, tiene que cumplir `^[0-9a-z.%+\-(), ]{1,80}$`. Así quedan afuera `; { } < > " ' \ / * : ! @ # =`, los saltos de línea y lo que no sea ASCII, y no hay forma de cerrar una regla ni un `<style>`. La gramática de abajo asegura además que el valor sea CSS correcto.

**Gramática de longitud** (tokenizador y parser chicos, no una regex única):
- `numero` = `\d+(\.\d+)?|\.\d+`. Sin signo, porque ningún tamaño es negativo. Máximo 10000.
- `unidad` ∈ `px | rem | em | % | vw | vh | svh | dvh | lvh | vmin | vmax`.
- `longitud` = `numero unidad` o `0`.
- `suma` = `longitud ( ␠[+-]␠ longitud )*`. Los espacios alrededor de `+` y `-` son obligatorios dentro de funciones, como exige CSS (ej. `4vw + 1.5rem`).
- `funcion` = `clamp(suma, suma, suma)`, `min(suma, suma[, suma…])` o `max(…)` con hasta 4 argumentos, o `calc(suma)`. **No se anidan funciones**: ningún default de la carta lo necesita.
- Se aceptan espacios alrededor de las comas y dentro de los paréntesis.

**Tipos del catálogo:**

| Tipo | Claves | Acepta | Se guarda como |
|---|---|---|---|
| `tamanoFuente` | 17 `carta_fuente_*` + `topbar_back_size` | número solo entre 4 y 200 (restaurant-menu-design lo convierte a px con `normFuente`) · `longitud` · `funcion` | tal cual |
| `altoBandaMobile` | `carta_banda_alto_mobile` | número solo entre 20 y 600 (px, como hoy) · `longitud` · `funcion` | tal cual |
| `altoBandaDesktop` | `carta_banda_alto_desktop` (va dentro de `<style>`) | número solo entre 20 y 600 · `longitud` · `funcion` | **un número solo se guarda como `"<n>px"`** (A.6) |
| `anchoImagenMobile` | `carta_imagen_ancho_mobile` | número solo entre 1 y 400 (% del alto de la banda, `calcHeightPx`) · `longitud` | tal cual |
| `tamanoFondo` | `carta_imagen_ancho_desktop` (`background-size`) | `contain`, `cover`, `auto`, o 1-2 tokens que sean `auto` o `longitud` (ej. `auto 100%`) | tal cual |
| `porcentaje` | `carta_pos_bloque`, `carta_pos_cta` | número entre 0 y 100, hasta 2 decimales, sin `%` (restaurant-menu-design le agrega `%`) | `"50"` |
| `opacidad` | `carta_imagen_opacidad` | entero entre 1 y 100 (A.9) | `"38"` |
| `enum` | `carta_imagen_modo` ∈ {fondo, miniatura, ambos}; `carta_imagen_pos_x` ∈ {left, center, right}; `carta_imagen_pos_y` ∈ {top, center, bottom}; `carta_imagen_overlay` ∈ {si, no} | sin distinguir mayúsculas. En `overlay`, "sí"/"true"/"1"/"yes" valen `si` y "no"/"false"/"0" valen `no` (el `isTruthy` de hero-utils) | el valor canónico en minúsculas |
| `redSocial` | `restaurante_instagram` | usuario `@?[A-Za-z0-9._]{1,30}`, o URL `https://` con host `instagram.com` o `www.instagram.com` (parseada con `new URL`) | el usuario sin `@`, o la URL |
| `redSocial` | `restaurante_facebook` | usuario `[A-Za-z0-9.\-]{1,50}`, o URL `https://` con host `facebook.com`, `www.facebook.com`, `m.facebook.com` o `fb.com` | el usuario o la URL |
| `telefono` | `restaurante_whatsapp` | entre 8 y 15 dígitos, después de quitar espacios, `+`, `-`, `(` y `)` | solo los dígitos (restaurant-menu-design igual los filtra) |
| `urlHttps` | `restaurante_footer_maps_url` | `new URL(v)` con `protocol === "https:"`, sin espacios ni comillas, hasta 500 caracteres (A.8) | la URL |
| `texto` | `carta_texto_portada_cta` (60), `carta_texto_portada_separador` (10), `carta_texto_indice_etiqueta` (60), `carta_texto_indice_titulo` (120), `topbar_back_label` (40), y los textos del bloque A: `restaurante_nombre`/`subtitulo`/`hero_etiqueta_superior` (120) y `restaurante_descripcion` (500) | `validarTextoLibreCarta` con el máximo indicado, sin caracteres de control | tal cual |
| `imagen` | `restaurante_logo_url`, `hero_imagen_fondo_url` | `validarImagenUrlCarta` | tal cual |
| `color`, `colorHeroInk`, `colorHex` | bloque B (`colorHeroInk` = `hero_ink`; `colorHex` = `hero_color_fondo`) | D8 | normalizado (en `colorHex`, un hex de 3 dígitos pasa a 6) |

**Paridad obligatoria:** todos los defaults **no vacíos** de los bloques A a D en `lib/get-config.ts` de restaurant-menu-design tienen que pasar su validador sin cambios. Entre ellos: `clamp(1.7rem, 7vw, 2.1rem)`, `clamp(80px, 18vh, 140px)`, `auto 100%`, `0.55rem`, `← Menú`, `12px`, `fondo`, `left`, `top`, `si`, `38`, `50`, `18`, `90`, `160`. Esos defaults se copian como tabla en el test de M3.

---

## C. Paso 0: línea de base (antes de tocar nada)

**motor2** (`/home/user/motor2`, checkout principal, rama `claude/merge-menu-inventory-repos-5ot8uc`, limpio):
- Bases locales nuevas: `motor2_tema` (dev) y `motor2_tema_e2e` (e2e), usuario `motor2`/`motor2`, Postgres local en el puerto 5432.
- `.env` local:
  - `DATABASE_URL` y `DIRECT_URL` → `motor2_tema`;
  - `MOTOR2_E2E_DATABASE_URL` → `motor2_tema_e2e`;
  - `AUTH_SECRET` (`npx auth secret`);
  - `CARTA_API_TOKEN=dev-token`.
- Migrar las dos bases con `DIRECT_URL=... npx prisma migrate deploy`.
- Correr y anotar:
  1. `npx tsc --noEmit` (el único ruido esperado es `LayoutProps`);
  2. `npm run lint`;
  3. `npm test` (Test Files X / Tests Y);
  4. `npm run build` (anotar los warnings);
  5. `npm run test:e2e` (N passed; confirmar `[e2e] Servidor: build`).

**restaurant-menu-design** (`/home/user/restaurant-menu-design`, limpio; respaldo en `standalone-sin-motor2` → `544f432`, y en el repo `restaurant-menu-design-standalone`):
1. `pnpm lint`.
2. `pnpm build`.
3. Extra, solo informativo: `npx tsc --noEmit`. Anotar cuántos errores hay.

---

## D. Pasos de implementación (un commit por paso, en orden)

### motor2

**M1 — Schema y migración. REQUIERE AUTORIZACIÓN EXPRESA. Solo contra las bases locales, nunca contra Neon ni producción.**

En `prisma/schema.prisma`, sección `// CARTA`, después de `SucursalPublica`:

```prisma
/// Tema visual de la carta pública de una sucursal: lo que hoy es la tab "Config" de la sheet de cada tenant de
/// restaurant-menu-design (las 67 claves por tenant del catálogo CLAVES_TEMA_V1 de src/core/carta/tema.ts; los precios
/// son convención fija del sistema y no están acá). FILA AUSENTE = la carta sigue con la tab Config (opt-in; sin backfill).
model TemaCartaSucursal {
  id             String   @id @default(cuid())
  sucursalId     String   @unique
  sucursal       Sucursal @relation(fields: [sucursalId], references: [id])
  /// clave de SiteConfig → valor ya validado. Claves fuera del catálogo se ignoran al servir.
  valores        Json     @default("{}")
  /// false = borrador (se edita y previsualiza en motor2; la carta sigue con la sheet). true = la carta usa este tema.
  aplicarEnCarta Boolean  @default(false)
  actualizadoEn  DateTime @updatedAt
}
```

- Una sola línea en `model Sucursal`: `temaCarta TemaCartaSucursal?`. Sin Cascade.
- Crear la migración con `npx prisma migrate dev --create-only --name carta_tema_sucursal`. Revisar el SQL: 1 `CREATE TABLE`, 1 índice único, 1 FK, sin backfill. Después aplicarla.
- **Mismo commit:** en `test/setup/test-db.ts::limpiarBaseDeTest`, agregar `await prisma.temaCartaSucursal.deleteMany();` al bloque de carta, antes de `sucursal.deleteMany()`, y cambiar el comentario a "6 tablas".
- Chequeo: `npx tsc --noEmit` y `npm test` completos, sin cambios de resultado.

**M2 — Validadores puros de bajo nivel: `src/core/carta/color-css.ts` y `src/core/carta/css-valores.ts`.**
- **`color-css.ts`:** copia literal de `sanitizeCssColor`, `resolveHeroInk` y `resolvePrimaryForeground` con sus parsers, desde `restaurant-menu-design/lib/hero-utils.ts`. El encabezado indica el origen y que un cambio se hace en las dos copias.
- **`css-valores.ts`** (D13):
  - `valorCssSeguro(v)`: el filtro de caracteres;
  - `parsearLongitudCss(v, { funciones: boolean })`;
  - `validarTamanoFuente`, `validarAltoBanda(v, { normalizarPx })`, `validarAnchoImagenMobile`, `validarTamanoFondo`, `validarPorcentaje`, `validarOpacidad`, `validarEnum(v, opciones, alias?)`, `validarRedSocial(v, "instagram" | "facebook")`, `validarTelefono`, `validarUrlHttps`.
  - Todos devuelven el mismo `Resultado<T>` que `validaciones.ts`.
- **Test nuevo `test/carta/color-css.test.ts`:**
  - tabla de paridad: hex de 3, 4, 6 y 8 dígitos; `rgb`, `rgba`, `hsl`, `oklch` y `color()`; nombres; alias;
  - rechazos: `;`, `{`, `}`, `<`, `>`, comillas, `\`, `url(`, `</style>`, `red;background:x`;
  - `resolvePrimaryForeground`: `#000` → claro, `#fff` → oscuro, y un caso `oklch`.
- **Test nuevo `test/carta/css-valores.test.ts`:**
  - aceptados: `14`, `0.88rem`, `12px`, `18vh`, `clamp(80px, 18vh, 140px)`, `clamp(2.25rem, 4vw + 1.5rem, 3.75rem)`, `min(10vw, 40px)`, `calc(100% - 2rem)`, `auto 100%`, `contain`;
  - rechazados: `90px}body{display:none`, `90px;x:y`, `</style>`, `expression(1)`, `url(x)`, `var(--x)`, `clamp(clamp(1px,2px,3px),1px,2px)`, `4vw+1rem` (sin espacios), `-5px`, `1e3px`, `12pt`, `１２px`, y un valor de 81 caracteres;
  - normalización: `altoBandaDesktop("120")` → `"120px"`; enums con alias (`Sí` → `si`, `Fondo` → `fondo`);
  - redes: usuario, URL válida, `http://instagram.com` rechazado, `https://evil.com` rechazado;
  - teléfono: `+54 9 294 123-4567` → `5492941234567`;
  - maps: `javascript:alert(1)` y `http://…` rechazados.

**M3 — `src/core/carta/tema.ts`: puro, sin Prisma, importable desde el cliente.**
- **`CLAVES_TEMA_V1`:** las 67 claves de D3. Cada una lleva:
  - `tipo` (tabla de D13) y `bloque` (A a D);
  - `zona`, para agrupar en el formulario. Son 14: Portada e identidad, Colores generales, Índice, Banda de sección, Ítems, Ítems especiales, Navegación y barra superior, Textos fijos, Contacto, Tipografía de portada, Tipografía de índice, Tipografía de banda, Tipografía de ítems, Banda e imagen de sección;
  - `etiqueta`;
  - `defaultCarta`: el default de restaurant-menu-design, para el placeholder y la vista previa.
- **`CLAVES_FIJAS_DEL_SISTEMA`** (las 3 de precio, con su valor de convención) y **`CLAVES_NO_POR_TENANT`** (las 39 de A.1/A.2). Solo se usan para clasificar lo que se pega; la vista previa usa los valores fijos de precio.
- Tipos `TemaCartaV1` y `ValoresTema`.
- `validarValorTema(clave, valor)` delega en el validador de su tipo.
- `validarValoresTema(entrada)`: devuelve los valores normalizados o **hasta 5 errores** juntos en un mensaje, con la etiqueta en castellano. Los vacíos se omiten.
- `parsearConfigPegada(texto)`: lee TSV, toma las dos primeras columnas y las recorta. Devuelve `{ valores, fijasDelSistema, noPorTenant, desconocidas, invalidas: {clave, motivo}[] }`.
- `armarTemaCarta(fila, ahora)`:
  - emite **las 67 claves**;
  - vuelve a validar cada valor del Json: si es inválido o no es string, sale `null`;
  - ignora las claves ajenas, incluidas las de precio si alguien las cargara por `db:studio`.
- **Test nuevo `test/carta/tema.test.ts`:**
  - **Catálogo:**
    - exactamente 67 claves, iguales a una lista fija copiada de D3, con 6/23/9/29 por bloque;
    - sin repetidas y sin intersección con `CLAVES_FIJAS_DEL_SISTEMA` ni con `CLAVES_NO_POR_TENANT`;
    - 67 + 3 + 39 = las 109 de `SiteConfig` (lista fija de las 109 copiada de `lib/get-config.ts`);
    - cada clave tiene tipo, zona, etiqueta y `defaultCarta`;
    - ninguna clave `precio_*` está en el catálogo.
  - **Paridad de defaults:** todos los defaults no vacíos de A a D pasan `validarValorTema` sin cambios.
  - **Validación por bloque:** un caso bueno y uno malo de cada tipo. En particular: alias fuera de `hero_ink`, `hero_color_fondo` en `oklch`, imagen `http://`.
  - **Pegado real:** encabezado, líneas vacías, una clave de SEO (va a `noPorTenant`), `precio_locale` (va a `fijasDelSistema`), un color inválido y un `carta_banda_alto_desktop` con `}`.
  - **Saneamiento de salida** con Json cargado a mano: `"color_marca": "red;x"`, `"carta_banda_alto_desktop": "1px}*{x:y"`, `"precio_simbolo": "US$"`, `"foo"` y un valor numérico en vez de string. Todos salen `null` o ausentes, y siempre salen exactamente las 67 claves.

**M4 — `src/core/carta/tema-consulta.ts`: lectura con Prisma, nunca escribe.**
- `resolverTemaCarta(sucursalId, db = prisma, ahora)`: un solo `temaCartaSucursal.findUnique({ where: { sucursalId }, select: { valores, aplicarEnCarta, actualizadoEn, sucursal: { select: { id, activo } } } })`. Devuelve `null` si no hay fila, si `!aplicarEnCarta` o si la sucursal está inactiva. En otro caso, `armarTemaCarta`.
- `cargarTemaAdmin(sucursalId)` va en `admin-consulta.ts`: los valores crudos, `aplicarEnCarta`, `actualizadoEn`, y el `slug`/`publicada` de `SucursalPublica` si la hay.
- **Test nuevo contra Postgres, `test/carta/tema-consulta.test.ts`:**
  - sin fila, no aplicado o sucursal inactiva → `null`;
  - aplicado → las 67 claves;
  - exactamente una consulta (mismo `$allOperations` que `registro-consulta.test.ts`).

**M5 — Endpoint `src/app/api/carta/[sucursal]/tema/route.ts`.**
- Antes de escribir, confirmar en `node_modules/next/dist/docs` (Next 16.3.5, regla de AGENTS.md):
  - que un segmento estático anidado bajo uno dinámico funciona;
  - la firma `ctx: { params: Promise<{ sucursal: string }> }`, tipada a mano como en `[sucursal]/route.ts`.
- Flujo de D6, calcado de `[sucursal]/route.ts`, que no se toca.
- `.env.example`: ampliar el comentario de `CARTA_API_TOKEN` (ahora son tres endpoints). `vercel.json` no se toca.
- **Test nuevo `test/carta/api-carta-tema.test.ts`:**
  - 401 sin header, con token incorrecto y sin la variable (con `reportarErrorUnaVez`);
  - 404 con id inexistente, sucursal inactiva, sin fila, no aplicado e id de más de 100 caracteres;
  - 200 con `version === 1`, **exactamente las 67 claves** en `valores` (ninguna `precio_*`), `null` en las no cargadas, sin `id` ni `aplicarEnCarta`, y `no-store`.
- Guardián `test/arquitectura/carta-solo-lectura.test.ts`: en "encuentra los archivos", sumar `app/api/carta/[sucursal]/tema/route.ts` y `core/carta/tema-consulta.ts`. La carpeta ya se recorre en forma recursiva.

**M6 — El registro emite `temaDesdeMotor2` (aditivo, D5).**
- `src/core/carta/registro-tenants.ts`:
  - `TenantV1.temaDesdeMotor2: boolean`;
  - `FilaRegistroTenant.sucursal.temaCarta?: { aplicarEnCarta: boolean } | null`, opcional para no romper los fixtures puros;
  - `filaATenantV1` lo calcula.
- `registro-consulta.ts`: agregar `temaCarta: { select: { aplicarEnCarta: true } }` al `select` de la sucursal. Sigue siendo una sola operación (A.14).
- En el mismo commit:
  - `test/carta/api-carta-tenants.test.ts`: agregar `temaDesdeMotor2: false` a cada objeto (A.12);
  - `registro-consulta.test.ts` y `registro-tenants.test.ts`: un caso con tema aplicado y otro sin aplicar;
  - `test/carta/api-carta.test.ts` queda idéntico.
- Opcional: en `/catalogo/carta/portal`, una línea de solo lectura "Tema: motor2 / sheet".

**M7 — E2E de los endpoints en el build de producción.**
- **Spec nuevo `test/e2e/api-carta-tema.spec.ts`:**
  - 401 sin token;
  - 404 con id inexistente;
  - 404 para "Central" sin tema;
  - con un tema aplicado sembrado → 200 con las 67 claves (y un valor de cada bloque tal cual);
  - desaplicar → 404;
  - 405 para POST;
  - todo se limpia en `finally`.
- `test/e2e/api-carta-tenants.spec.ts`: agregar `temaDesdeMotor2: false` al objeto esperado. `test/e2e/api-carta.spec.ts` queda idéntico.

**M8 — Server Actions: `src/server/actions/carta/tema.ts`.**
- Todas envueltas en `conPermiso("carta", …)`. Es la acción que ya existe, así que no hace falta una migración de datos de permisos.
- `guardarTemaCarta(sucursalId, valores)`: `validarValoresTema` (hasta 5 errores en el mensaje) y `upsert` por `sucursalId`. Al crear, no toca `aplicarEnCarta`.
- `cambiarAplicacionTema(sucursalId, aplicar)`:
  - exige que exista la fila;
  - rechaza aplicar un tema vacío;
  - si la sucursal no está en el portal, guarda igual y lo avisa ("sin efecto hasta agregarla al portal").
- Opcional: registro en `RegistroAuditoria` con `entidad: "TemaCartaSucursal"`.
- Guardián: agregar `"temaCartaSucursal"` a `TABLAS_DE_CARTA` y actualizar el texto a "6 tablas".
- **Test nuevo `test/carta/acciones-tema.test.ts`:**
  - permiso;
  - inyección rechazada en cada tipo peligroso (`color`, `altoBandaDesktop`, `urlHttps`, `redSocial`);
  - un guardado con las 67 claves válidas;
  - una clave `precio_*` en la entrada se ignora y no se guarda;
  - normalizaciones: `120` → `120px`, `Sí` → `si`, hex de 3 dígitos → 6, teléfono → solo dígitos;
  - varios errores juntos;
  - `upsert` idempotente;
  - aplicar sin fila o con el tema vacío → error;
  - desaplicar conserva los valores.

**M9 — Pantalla `src/app/(app)/catalogo/carta/tema/page.tsx` y `src/components/carta/editor-tema.tsx` ("use client").**
- Protegida con `requierePermisoVer(..., "carta")`, sobre la sucursal activa, como `/catalogo/carta`.
- Encabezado con el estado: "no está en el portal", `/carta/<slug>`, "tema aplicado" o "borrador".
- Nota fija: los precios usan la convención del sistema (es-AR, `$` a la izquierda) y no se editan acá.

**Formulario.** `FormConResultado` con inputs no controlados, uno por clave, generados recorriendo el catálogo. Se agrupan por zona en `<details>` (14 zonas, solo la primera abierta). Cada campo muestra como placeholder el `defaultCarta` ("vacío = default de la carta"). Widget según el tipo:
- `color`: `CampoColor`. El swatch no tiene `name` y escribe en el campo de texto, que sí lo tiene. Si el valor no es `#rrggbb`, el swatch queda neutro con la nota "formato avanzado".
- `enum`: `<select>` con una opción vacía "(default de la carta: X)".
- `porcentaje` y `opacidad`: `<input type="number">` con `min`/`max`.
- Longitudes y tamaños: texto, con una ayuda debajo ("número = px, o 0.9rem, 12px, clamp(…)").
- `urlHttps`, `imagen` y redes: `<input type="url">` o texto.
- `texto`: `<input>` con `maxLength`.

**Vista previa** (`VistaPreviaTema`, con `data-vista-previa-tema`):
- Un `onInput` en el contenedor vuelve a leer `FormData`, y el componente se vuelve a montar con `key={actualizadoEn}`.
- Estilos en línea con los fallbacks de A.15 y los `resolvePrimaryForeground`/`resolveHeroInk` portados.
- Simula:
  - la portada: colores, textos, tamaños, separador, CTA, y la posición del bloque y del CTA;
  - el índice: etiqueta, título y tamaños;
  - la banda: colores, tamaños y alto mobile;
  - un ítem común y uno especial, con el precio formateado como `$` + `toLocaleString("es-AR")`;
  - la barra superior y la de navegación: colores, etiqueta, tamaño e íconos de las redes cargadas.
- **No simula** los modos, anchos, posiciones, overlay ni opacidad de la imagen de sección, y lo dice en una nota.
- No usar `text-amber-600` ni `text-neutral-400` sin su par (`contraste-de-color.test.ts`).

**Resto de la pantalla:**
- Bloque **"Pegar desde la sheet"** (D12): rellena el formulario desde el cliente y muestra las cinco listas.
- Formulario aparte para Aplicar/Desaplicar.
- Los closures capturan solo `sucursalId` y llaman a `refrescarVistaSiHaceFalta` cuando sale bien.
- `src/core/navegacion/estructura.ts`: `{ href: "/catalogo/carta/tema", label: "Tema de la carta", accion: "carta" }`. `test/e2e/rutas-sin-parametros.ts`: sumar la ruta.

**Spec nuevo `test/e2e/carta-tema-admin.spec.ts`:**
1. Pegar 6 líneas:
   - un color válido;
   - un color inválido;
   - una clave de SEO;
   - `precio_locale` (tiene que caer en "fijas del sistema");
   - `carta_fuente_item_nombre` = `clamp(0.8rem, 2vw, 1rem)`;
   - `carta_banda_alto_desktop` = `90px}body{display:none`.
2. Verificar las listas, y el color y el tamaño de fuente calculados en `[data-vista-previa-tema]`.
3. Guardar, recargar y verificar que los valores persisten.
4. Aplicar y verificar que `GET /api/carta/<id>/tema` responde 200.
5. Desaplicar y verificar el 404.

**Chequeo de axe** en `test/e2e/accesibilidad.spec.ts`: con dos `<details>` abiertos y `.exclude('[data-vista-previa-tema]')`, justificado en un comentario (A.16). Cada swatch y cada `select` necesita su etiqueta accesible.

### restaurant-menu-design (`/home/user/restaurant-menu-design`)

**R0 — Solo si la línea de base mostrara el lint roto.**

**R1 — Tipos, guardia, saneamiento y mapper puros, sin cambios de comportamiento.**
- **`lib/tema-motor2.ts`** (`import "server-only"`):
  - `TemaMotor2V1`.
  - `esTemaMotor2V1(x)`, escrita a mano: `version === 1`, strings, y `valores` como objeto plano con valores `string | null`.
  - **`TIPOS_TEMA`:** las 67 claves con un tipo simplificado (`color`, `heroInk`, `colorHex`, `css`, `enum:<opciones>`, `numero`, `url`, `texto`). Las claves `precio_*` no están, así que siempre salen de la sheet o del default.
  - `sanearValorTema(clave, v)`, según el tipo:
    - `color` → `sanitizeCssColor` de `lib/hero-utils.ts`, sin reimplementarlo;
    - `heroInk` → `claro`, `oscuro` o `sanitizeCssColor`;
    - `colorHex` → `^#[0-9a-fA-F]{6}$`;
    - `css` → `^[0-9a-zA-Z.%+\-(), ]{1,80}$`, el mismo filtro de caracteres que motor2 (A.6);
    - `enum` → pertenece a las opciones;
    - `numero` → `Number.isFinite`;
    - `url` → empieza con `https://` y no tiene espacios ni comillas;
    - `texto` → tal cual, porque React lo escapa.
  - `combinarConfig(sheet: SiteConfig, tema: TemaMotor2V1 | null): SiteConfig`, pura (D7/D9). Solo toma claves que estén en `TIPOS_TEMA` y en `CONFIG_POR_DEFECTO`. Si el valor es `null`, `""` o no pasa el saneamiento, usa el default.
- `lib/get-config.ts`: exportar `defaults` como `CONFIG_POR_DEFECTO`, sin cambiar la lógica.
- `lib/tenants.ts`: agregar `Tenant.motor2_tema_sucursal_id?: string`.
- `lib/tenants-motor2.ts`:
  - `TenantMotor2V1.temaDesdeMotor2?: boolean`, y la guardia acepta que falte;
  - el mapper asigna `motor2_tema_sucursal_id = t.temaDesdeMotor2 ? t.sucursalId : undefined`. En este paso nadie lo lee todavía.
  - `tenantMotor2ATenant` sigue devolviendo `null` si falta `sheetId` (D10).

**R2 — `getConfigForTenant` con fallback.**
- En `lib/tema-motor2.ts`:
  - `fetchTemaMotor2(id)` usa `configMotor2()`, `Authorization`, `next: { revalidate: 300 }` y `AbortSignal.timeout(5000)`, y lanza si el status no es 200 o la forma es inválida;
  - `leerTemaMotor2(id)` devuelve `null` con `console.error` si falla.
- En `lib/get-config.ts`, `getConfigForTenant(tenant: Pick<Tenant, "tenant_id" | "sheet_id" | "motor2_tema_sucursal_id">)`:
  - base = `tenant.sheet_id?.trim() ? getConfig(tenant.sheet_id) : CONFIG_POR_DEFECTO`. Nunca `getConfig(undefined)` (D10);
  - en paralelo, `leerTemaMotor2`, solo si hay `motor2_tema_sucursal_id` y `motor2Configurado()`;
  - resultado: `combinarConfig`.
- `app/carta/[sucursal]/page.tsx`: cambia una línea, `getConfig(tenant.sheet_id)` → `getConfigForTenant(tenant)`.
- **No se tocan:** `/`, `/carta`, `/carta-demo`, `layout.tsx` y `manifest.ts`. `git diff --stat components/ proxy.ts lib/get-menu.ts lib/carta-motor2.ts lib/format-utils.ts` tiene que salir vacío.

**R3 — Documentación.**
- `docs/setup-sucursal.md`, sección "Tema desde motor2":
  - motor2 manda las 67 claves por tenant;
  - los precios (`precio_*`) son convención fija y siguen en la sheet o en el default, con la recomendación de no cambiarlos;
  - en un tenant migrado, la tab Config de su sheet sirve de respaldo y para los precios, y editar las otras claves ahí no tiene efecto mientras motor2 responda;
  - `sheet_id` sigue siendo obligatorio;
  - vuelta atrás = desaplicar;
  - rama de respaldo: `standalone-sin-motor2` (y el repo `restaurant-menu-design-standalone`).
- `ARCHITECTURE.md` §3.6.2 "Tema: sheet o motor2": la semántica de clave presente/ausente, el saneamiento de R1, las 3 claves fijas y el pendiente aparte de la config raíz (39 claves).
- `docs/template-config-sheet.md`: marcar qué claves maneja motor2 (67), cuáles son fijas del sistema (3) y cuáles son de la raíz (39).

**R4 — Operación, no código (fuera de alcance).** Por cada tenant:
1. Copiar A:B de la tab Config.
2. En motor2, usar "Pegar desde la sheet" y revisar las listas y la vista previa.
3. Guardar y aplicar.
4. Revisar `/carta/<slug>` a los 5 minutos, o con `/api/revalidate`.

---

## E. Riesgos y temas abiertos (ninguno bloquea)

- **La vista previa es aproximada.** No simula los modos de imagen de sección, y no hay vista real antes de aplicar, porque una sucursal sin publicar no se ve en la carta.
- **Valores de sheets reales que no pasan la gramática** (por ejemplo `pt`, o funciones anidadas). El importador los lista como inválidos y quedan en el default: es el costo del validador estricto. Si aparecen casos legítimos, se amplía D13 con un test.
- **Hasta 5 minutos para que se vea un tema aplicado.** Un botón "revalidar ahora" necesitaría `REVALIDATE_SECRET` en motor2; queda fuera.
- **Confusión de fuentes.** En un tenant migrado, editar la sheet no cambia nada salvo los precios. Se documenta en R3.
- **`generateStaticParams`.** El build de restaurant-menu-design consulta el tema de cada tenant de motor2; si motor2 no responde, queda la sheet.
- **Pendientes aparte, fuera de este plan:**
  - sanear también el camino de la sheet (A.3, A.6, A.8);
  - `precio_locale` inválido en la sheet tira la página (A.7). Hoy afecta solo al camino de la sheet, porque la convención fija es `es-AR`;
  - las rarezas de A.9;
  - la config raíz/portal (A.1);
  - "copiar el tema de otra sucursal" o paletas (trivial con Json).
- **Json sin validación en la base.** Lo cubren el saneamiento de salida (M3) y el de restaurant-menu-design (R1).

---

## F. Verificación end-to-end final (obligatoria)

**Criterio de cierre:** el pendiente está terminado solo cuando **todos** los comandos siguientes pasan limpios **en la misma corrida**, con las mismas bases locales del Paso 0, después del último commit.

**motor2** (bases `motor2_tema`/`motor2_tema_e2e` locales, nunca Neon ni producción):

| Comando | Criterio |
|---|---|
| `npx tsc --noEmit` | Salida vacía, salvo el ruido de `LayoutProps` de `layout.tsx` que ya estaba |
| `npm run lint` | 0 errores y 0 warnings nuevos respecto de la línea de base |
| `npm test` (suite ENTERA) | Todo en verde. Tests ≥ línea de base más: `color-css`, `css-valores`, `tema` (catálogo de 67 claves, 67+3+39=109, paridad de defaults, un validador por tipo), `tema-consulta`, `api-carta-tema` (200 con exactamente 67 claves y ninguna `precio_*`) y `acciones-tema`. `api-carta.test.ts` y `acciones-registro-publico.test.ts` idénticos |
| `npm run build` | Aplica la migración `carta_tema_sucursal` sobre la base local sin errores. Build limpio y sin warnings nuevos. `/api/carta/[sucursal]/tema`, `/api/carta/[sucursal]` y `/api/carta/tenants` como rutas dinámicas (ƒ) |
| `npm run test:e2e` (suite ENTERA, `[e2e] Servidor: build`) | Todo en verde. Specs ≥ línea de base más `api-carta-tema.spec.ts`, `carta-tema-admin.spec.ts` y el chequeo de axe nuevo. `api-carta.spec.ts` idéntico |

**restaurant-menu-design:**

| Comando | Criterio |
|---|---|
| `pnpm lint` | 0 errores |
| `pnpm build` | `next build` limpio, sin variables de motor2 y también con ellas |
| Extra: `npx tsc --noEmit` | Errores ≤ línea de base y **ninguno** en `lib/tema-motor2.ts`, `lib/get-config.ts`, `lib/tenants.ts`, `lib/tenants-motor2.ts` ni `app/carta/[sucursal]/page.tsx` |

**Verificación manual:**
1. **curl:** 401 sin token; 404 sin tema; 200 aplicado con 67 claves; 404 al desaplicar; 405 para POST.
2. **Importar un tenant real:** pegar su tab Config completa y comparar la vista previa con la carta real. Confirmar que las 39 claves de la raíz salen como "no por tenant" y las 3 de precio como "fijas del sistema".
3. **Aplicar y revisar `/carta/<slug>`**, con un cambio de cada bloque:
   - A: el nombre;
   - B: el color del ítem especial;
   - C: el texto del CTA de portada y el link de WhatsApp;
   - D: la fuente del ítem, el alto de banda en desktop con `clamp()` y `carta_imagen_modo=miniatura`.

   Además:
   - cambiar esas mismas claves en la sheet no tiene efecto;
   - los precios siguen saliendo como `$` + formato es-AR, a la izquierda.
4. **motor2 apagado o token incorrecto:** el tenant vuelve a la sheet completa, con `console.error`, y el render termina en unos 5 segundos.
5. **Otro tenant sin tema de motor2:** sin cambios.
6. **`/`, `/carta`, `/carta-demo` y la metadata:** sin cambios.
7. **Carga a mano por `db:studio`:** `"color_marca": "red;position:fixed"`, `"carta_banda_alto_desktop": "1px}*{display:none"` y `"precio_simbolo": "US$"`. El endpoint devuelve las dos primeras en `null` y no emite la tercera. La carta muestra los defaults en las dos primeras y `$` en el precio.
8. **Publicar sin `sheetId`** en `/catalogo/carta/portal` sigue fallando con el mensaje de siempre (D10).

**Áreas a mirar con atención especial:**
- `carta-solo-lectura.test.ts`: los archivos nuevos y la sexta tabla.
- `acciones-con-guarda.test.ts`.
- `menu-con-permiso`, `enlaces-con-permiso` y `contraste-de-color.test.ts`.
- `region-de-las-funciones.test.ts`: no tocar `vercel.json`.
- Tests del registro (`api-carta-tenants`, unit y e2e): solo cambian por `temaDesdeMotor2`.
- `acciones-registro-publico.test.ts`: tiene que salir idéntico.
- Tests de `src/server/actions/auth/sucursales.ts`: la relación nueva en `Sucursal` no tiene que romper altas, renombres ni desactivaciones.

### Archivos críticos para la implementación
- /home/user/motor2/prisma/schema.prisma (`model Sucursal`, sección `// CARTA`)
- /home/user/motor2/src/core/carta/validaciones.ts (patrón `Resultado<T>`, `validarTextoLibreCarta`, `validarImagenUrlCarta`), junto con los nuevos `css-valores.ts`, `color-css.ts` y `tema.ts`
- /home/user/motor2/src/core/carta/registro-tenants.ts y /home/user/motor2/src/core/carta/registro-consulta.ts (campo aditivo `temaDesdeMotor2`)
- /home/user/motor2/src/core/carta/autorizar-servicio.ts y /home/user/motor2/src/app/api/carta/[sucursal]/route.ts (autenticación y forma del endpoint a copiar)
- /home/user/motor2/src/app/(app)/catalogo/carta/portal/page.tsx y /home/user/motor2/src/components/form-con-resultado.tsx (molde de pantalla)
- /home/user/motor2/test/arquitectura/carta-solo-lectura.test.ts y /home/user/motor2/test/setup/test-db.ts
- /home/user/restaurant-menu-design/lib/get-config.ts (las 109 claves y los defaults que tienen que pasar los validadores; `getConfigForTenant`)
- /home/user/restaurant-menu-design/lib/hero-utils.ts (`sanitizeCssColor`, que se reusa y se porta)
- /home/user/restaurant-menu-design/components/carta-view.tsx, /home/user/restaurant-menu-design/components/carta-section-image.tsx y /home/user/restaurant-menu-design/components/carta-controls/carta-nav.tsx (cómo se usa cada clave de C y D: `<style>`, `href`, estilos en línea)
- /home/user/restaurant-menu-design/lib/tenants-motor2.ts, /home/user/restaurant-menu-design/lib/tenants.ts y /home/user/restaurant-menu-design/app/carta/[sucursal]/page.tsx
