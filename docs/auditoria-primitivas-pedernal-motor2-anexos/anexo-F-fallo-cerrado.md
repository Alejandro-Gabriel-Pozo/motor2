# F. Auditoría «Todo nace cerrado» (fallo cerrado) — catálogo, carta, diseño, empresa

Fecha: 2026-11-12. Solo lectura. Rama/estado: el del working tree de /home/user/motor2. No se corrieron los tests del proyecto (el repo no tiene `node_modules`); sí se corrió el detector real (`contarProhibidosEnCodigo`) con `npx tsx` para ubicar líneas. Estados: VERIFICADO (leí el código) / NO VERIFICADO.

Nota de ruta: la línea de base NO está en `test/arquitectura/linea-de-base/` sino en `test/arquitectura/cercos/linea-de-base/lista-de-prohibidos.json`.

---------------------------------------------------------------------

## 1. Qué detecta el guardián y sus límites

Archivos: `test/arquitectura/cerco-lista-de-permitidos.test.ts` (37 líneas, cerco de trinquete), `cerco-lista-de-permitidos-apoyo.ts` (detector AST con `typescript`), `cerco-lista-de-permitidos-evasiones.test.ts` (una violación inyectada por forma), `cercos/vencimientos.ts`.

Qué mide: por archivo, cuántas validaciones «por lista de prohibidos» hay en `src/`, `plataforma/src/` y `scripts/` (extensiones ts/tsx/js/jsx/mjs/cjs/mts/cts), sin archivos `*.test.*`, `*.spec.*` ni carpetas `test/`. Línea de base: 21 hallazgos en 19 archivos; el trinquete exige que no suba, que al bajar se regenere (`BAJAR_CERCOS=1`), y que la deuda tenga vencimiento.

Qué cuenta como prohibición (sobre el patrón de una regex, `esPatronDeProhibicion`):
- categorías `\p{C…}`/`\p{Z…}` (y nombres largos: `General_Category=`, `White_Space`, `Default_Ignorable_Code_Point`…);
- controles/invisibles por escape (`\x00-\x1f`, `\x7f-\x9f`, U+00AD, U+200B-200F, U+2028-202E, U+2060-2064, U+FEFF) o literales; escapes cortos en clase (`[\r\n\t]`, `\0`, `\cA`) y `\u{…}`;
- `\S`, `\W`, clase con `<` o `>`;
- clase NEGADA que liste algo fuera de letras/dígitos/`._-`/`!-~` («todo menos esto»: `[^,;]`, `[^\r\n]`, `[^\s@]`).
- Además de la regex literal: `new RegExp(...)`, `RegExp(...)`, `globalThis.RegExp`, alias de `RegExp`, `globalThis[clave]`, `Reflect.get(globalThis, …)`; `new RegExp(variable)` sin texto fijo CUENTA (fail-closed); `.includes/.indexOf/.lastIndexOf/.startsWith/.endsWith` contra `<`, `>`, control o invisible; `x === "<"`/`">"`; `charCodeAt/codePointAt` comparado con un código numérico de control/invisible/`<`/`>`.
- No cuenta: regex usada solo en `replace/replaceAll/split`, ni la lista de lo permitido.

Límites declarados en el encabezado (alarma para errores honestos, NO un límite de seguridad): constante de otro archivo usada en `includes`; `x.constructor(...)`/`Function(...)`; `\s` solo y `<` fuera de clase (`/^\s*$/`, `/<script/`); `split/replace/Set/switch` contra `<` o control; comparaciones de texto (`c < " "`); códigos por variable; tablas de búsqueda; `\p{…}` con propiedad no listada; validaciones fuera de TS/JS (CHECK de migraciones SQL, esquemas en otro formato, atributos `pattern` de JSX con cadenas calculadas; no se leen `.sql`); un validador en otra zona (`z.string().refine(esSeguro)` cuenta en el archivo de `esSeguro`).

Límites que SE VEN en el código real (VERIFICADO) y no están declarados con ese ejemplo o que conviene sumar:
- `src/core/seguridad/ruta-servible.ts:23` `decodificado.includes("%")` y `src/core/navegacion/volver.ts:19` `startsWith("//")`/`startsWith("/\\")` son listas de prohibidos que el detector NO cuenta (solo ve `<`, `>`, controles, invisibles).
- No mira `prisma/` (p. ej. `prisma/seed.ts`) ni `.sql`: los CHECK de las migraciones con `~ '\S'` (`GrupoDePrecio_nombre_chk`, `PromoCartaCupo_nombre_chk`, `CombinacionEnLinea_nombre_grupo_chk`) son del tipo «algo visible», fuera de alcance. NO VERIFICADO si `src/generated` existe/entra.
- No detecta lo que NO es una lista de prohibidos pero viola «nace cerrado»: texto libre con solo largo (`validarTextoLibre`, `validarTextoLibreCarta`), `z.string()` sin forma, `String` sin CHECK, defaults que abren (`@default(true)`, `?? true`, `defaultChecked`). Hoy no existe ningún guardián de esas formas (ver sección 3). El diseño dice que es adrede (PR 1: solo prohibidos), pero la regla del dueño es más ancha.
- Falsos positivos en la línea de base (el guardián cuenta, pero no es validación de dato de usuario): ver tabla (analizar-fuente, estructura, volver, portal.extraerUrlImagen, texto.ts, ruta-servible).
- Atribución: `estructura.ts` cuenta 1 en total; probado línea por línea, la anotación de tipo `patron: RegExp` (L211) aparece sola pero el total del archivo es 1, así que el hallazgo es L218 (NO VERIFICADO cuál de las dos pesa en el conteo real).

Vencimiento (`cercos/vencimientos.ts`): regla `lista-de-prohibidos`, inicio 2026-11-11, vence 2027-01-09 (59 días; tope 60), responsable dueño, aprobación `{por: "dueño (pendiente de aprobar al mergear el PR)", referencia: "PR #229"}`. O sea: la aprobación consta como PENDIENTE (igual que `numero-sin-formato-central`, commit 58f066f2). Faltan 58 días desde hoy. Mismo plazo y sin escalonar por riesgo, a diferencia de las otras listas.

---------------------------------------------------------------------

## 2. Línea de base completa (21 hallazgos, 19 archivos), por módulo

Leyenda de área: CAT = catálogo, CARTA = carta/promos/tema/marca, EMP = empresa/plataforma/correo, PREC = precios/dinero, PARTES = partes de stock, DIS = diseño visual (tema/colores). Línea = la que cuenta el detector (por línea aislada). Todas vencen 2027-01-09.

### CARTA / DISEÑO (marca, colores, imágenes, tema, portal) — 8 hallazgos
| # | Archivo:línea | Forma | Qué valida | Veredicto |
|---|---|---|---|---|
| 1 | src/core/carta/armar-menu.ts:306 | regex literal, clase negada `[^\s"'()\\<>`]+` | `urlImagenSegura`: URL https de imagen que la carta mete en `backgroundImage: url(...)`; después `new URL()` | CARTA/DIS. Deuda real: «todo menos esto». Pasan controles no-espacio, invisibles, bidi, `{};`. Medio-bajo (React escapa el style; un carácter inválido solo rompe el CSS). |
| 2 | src/core/carta/color-css.ts:25 | regex `[;{}"'<>\\]` | `sanitizeCssColor`: bloqueo previo de caracteres peligrosos | CARTA/DIS. REDUNDANTE: justo debajo ya hay allowlists (hex, funciones `[\d\s,./a-zA-Z%+-]`, nombres `[a-zA-Z]+`). Se borra sin perder nada. Bajo. |
| 3 | src/core/carta/css-valores.ts:164 | clase negada `[^\s"'<>`\\]+` | `urlHttpsSegura`: URL de red social / urlHttps del tema y portal | CARTA/DIS. Igual que #1 pero permite paréntesis. Medio-bajo. |
| 4 | src/core/carta/metadatos.ts:86 | clase negada `[^\s]+` | `imagenParaCompartir`: imagen para OG/compartir, solo https | CARTA. Más débil que #1 (acepta comillas, `<>`); defensa en profundidad de un dato ya validado al guardar. Bajo. |
| 5 | src/core/carta/portal.ts:87 | regex `\[[^\]]*\]\(([^)]+)\)` | `extraerUrlImagen`: saca la URL de un link markdown | CARTA. FALSO POSITIVO de forma: es un normalizador; el resultado pasa luego por `validarImagenUrlCarta`. |
| 6 | src/core/carta/portal.ts:89 | `^\(([^()]+)\)$` | ídem (paréntesis) | idem #5. |
| 7 | src/core/carta/tema.ts:221 | `RE_CONTROL = /[\u0000-\u001f\u007f]/` | claves de tipo `texto` del tema y del portal (`portal_titulo`, `portal_etiqueta`, `footer_texto_derechos`): rechaza controles, y después solo largo (`validarTextoLibreCarta`) | CARTA/DIS. Deuda real: texto que va a la carta pública solo prohíbe controles; pasan `<>`, bidi (U+202E), invisibles. Medio. |

(Zona carta/diseño: armar-menu 1, color-css 1, css-valores 1, metadatos 1, portal 2, tema 1 = 7; el octavo, `contenido-producto.guard.ts`, está en la tabla de catálogo, fila 13.)

### CATÁLOGO — 2 hallazgos
| # | Archivo:línea | Forma | Qué valida | Veredicto |
|---|---|---|---|---|
| 13 | src/core/features/carta/contenido-producto.guard.ts:27 | `/[\r\n]/` | `validarNombreEnCarta` (nombre del producto EN LA CARTA): sin saltos de línea | CAT/CARTA. REDUNDANTE: tres líneas más abajo `RE_TEXTO_CATALOGO` (allowlist `^[\p{L}\p{N} \-.,()%&/'_]+$`) ya excluye `\r\n`; queda solo por el mensaje. Bajo. |
| 14 | src/core/features/catalogo/opciones-de-venta.guard.ts:256 | `/[\r\n]/` | `descripcionEnCarta` de una opción de grupo (120 car.) | CAT. Copia de #13; mismo veredicto (la allowlist está en L261). Bajo. |

### CATÁLOGO/PRECIOS — contacto de proveedor y emails
| # | Archivo:línea | Forma | Qué valida | Veredicto |
|---|---|---|---|---|
| 15 | src/core/datos/limites.ts:34 | `RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/` | `validarEmailOpcional` → `Proveedor.email` (guard `contacto-de-proveedor.ts`) | CAT. Deuda real: acepta `<>`, comillas, comas, controles no-espacio. Medio-bajo. |
| 16 | src/core/plataforma/primer-admin.ts:53 | misma regex | email del primer admin de la empresa | EMP. Deuda real (la 3.ª copia de «qué es un email» en el repo: además `direcciones.ts` y `z.email()` en `empresa.schema.ts`). |

### EMPRESA / CORREO — 4 hallazgos (3 archivos)
| # | Archivo:línea | Forma | Qué valida | Veredicto |
|---|---|---|---|---|
| 17 | src/core/correo/direcciones.ts:1 | clase negada larga `[^\s@<>"',;()[\]\\]` | `DIRECCION`: destinatarios del correo | EMP. Deuda real; menos grave porque `\s` cubre CR/LF (anti header-injection). Pasan controles no-espacio e invisibles. Medio-bajo. |
| 18 | src/core/correo/direcciones.ts:2 | `^([^<>@\r\n"]+)<(\S+)>$` | `REMITENTE_CON_NOMBRE`: «Nombre <ana@dominio>» | EMP. Deuda real (nombre = todo menos…; dirección `\S+`). Medio-bajo. |
| 19 | src/core/correo/enviar.ts:37 | `UNA_LINEA = /^[^\r\n]+$/` | asunto/campos de una línea del mail | EMP. Deuda real: solo CR/LF; pasan U+2028/2029/NEL (0x85) y otros controles. Medio (cabeceras de mail). |
| 20 | src/env.ts:32 | `^re_\S+$` | forma de la clave de Resend | EMP. Deuda real pero inocua (config del operador, no dato de usuario): `\S+` → `[A-Za-z0-9_]+`. Bajo. |

### POS / PROMOS (precios) — 1 hallazgo
| # | Archivo:línea | Forma | Qué valida | Veredicto |
|---|---|---|---|---|
| 21 | src/core/pos/promo-combo.ts:152 | `^[^;=\s]+$` | `opcionId` dentro de la clave canónica de configuración de un combo (separadores `;` y `=`) | PREC/CARTA. Deuda real: debería ser `esIdentificador` (allowlist `[A-Za-z0-9_-]{1,64}`); hoy acepta cualquier id sin `;`, `=` ni espacio, dentro de una clave que decide precio/stock. Medio. |

### Resto (no son catálogo/carta/empresa de dato de usuario)
| # | Archivo:línea | Forma | Qué valida | Veredicto |
|---|---|---|---|---|
| 22 | scripts/arquitectura/analizar-fuente.ts:269 | `[^/]+` | patrón de ruta de un script de análisis del repo | FALSO POSITIVO (no valida dato). |
| 23 | src/core/navegacion/estructura.ts:218 | `[^/]+` | patrón de ruta (mapa de pantallas) | FALSO POSITIVO. |
| 24 | src/core/navegacion/volver.ts:22 | `/[^\x21-\x7e]\|\\/` | destino de «volver»: rechaza todo lo que no sea ASCII imprimible sin espacio, y `\` | Semánticamente ES una allowlist (solo `\x21-\x7e` salvo `\`) escrita en negativo. Reescribir en positivo `^[\x21-\x5b\x5d-\x7e]+$` la saca de la deuda. Bajo. |
| 25 | src/core/seguridad/ruta-servible.ts:22 | `includes("\u0000")` | corta un 404 para paths con NUL (router, no seguridad) | FALSO POSITIVO funcional: es un filtro de enrutado declarado «no decide nada de seguridad». |
| 26 | src/core/texto.ts:17 | `includes("\u0000")` + `RE_SUSTITUTOS` | `quitarCaracteresInadmisibles`: SANEA (saca NUL/sustitutos sueltos) antes de buscar | FALSO POSITIVO funcional (sanea, no valida). |

Conciliación de la cuenta: contando por archivo del JSON hay 21 hallazgos: analizar-fuente 1, armar-menu 1, color-css 1, css-valores 1, metadatos 1, portal 2, tema 1, direcciones 2, enviar 1, limites 1, contenido-producto.guard 1, opciones-de-venta.guard 1, estructura 1, volver 1, primer-admin 1, promo-combo 1, ruta-servible 1, texto 1, env 1 = 21. (La numeración 1-26 de arriba es de lectura, no del JSON.)

Resumen de la deuda: 21 hallazgos = 6 falsos positivos/normalizadores/sanitizadores (analizar-fuente, estructura, portal×2, ruta-servible, texto) + 1 allowlist en negativo (volver) + 3 redundantes con una allowlist vecina (color-css, contenido-producto.guard, opciones-de-venta.guard) + 11 deudas reales (armar-menu, css-valores, metadatos, tema, limites, primer-admin, direcciones×2, enviar, env, promo-combo). Ligadas a catálogo/carta/diseño: 11 (carta/tema/colores/URLs 7 + nombre/descripcion 2 + email proveedor 1 + combo 1).

---------------------------------------------------------------------

## 3. Hallazgos por inspección propia (fuera del guardián)

Clave de riesgo: A alto / M medio / B bajo. Arreglo: BD / pantalla / código.

### 3.1 Defaults que «abren»
| ID | Dónde | Qué pasa | Riesgo | Arreglo propuesto |
|---|---|---|---|---|
| D1 | src/components/carta/contenido-del-producto.tsx:147 `defaultChecked={p.contenido?.visibleEnCarta ?? true}` | Al abrir el formulario de contenido de un producto SIN contenido, «Se muestra en la carta» viene TILDADO. Contradice el ejemplo del dueño y a la propia columna (`ContenidoCartaProducto.visibleEnCarta @default(false)`, schema L1880). Además la acción exige sección si es visible (DA2), así que el default tildado provoca el error «sección obligatoria» a quien solo cargó la descripción. | M | pantalla: `?? false`. Test: el formulario nuevo nace sin tildar. |
| D2 | prisma/schema.prisma:2022 `PromoCarta.activa @default(true)` y :2034 `soloSalon @default(false)`; src/server/persistencia/carta/promos.ts:34-43 y src/server/actions/carta/casos-de-uso/guardar-promo-carta.ts:45,64 | La promo nace activa en la empresa y PÚBLICA. Se mitiga con la fila `PromoCartaSucursal` (nace apagada si quien crea no tiene `carta_promo_activar`), pero quien SÍ lo tiene la prende en la sucursal en el mismo gesto y sale en la carta pública sin paso adrede. Es el caso exacto del dueño («creo una promoción y nace sin ninguna sección tildada»): la parte de cupos/secciones SÍ nace cerrada (ver 3.4), la visibilidad no. | M | código: `prendida=false` siempre al crear y «Prender en esta sucursal» como paso aparte; y/o `soloSalon` default true («nace solo salón») hasta publicar. BD: `PromoCarta.activa DEFAULT false` (migración aditiva; el código pasa explícito). Decisión del dueño (cambia producto). |
| D3 | prisma/schema.prisma:1932 `ItemAgrupadoCarta.activo @default(true)` (sección obligatoria) y :1963 `GeneroCarta.activo`, :1850 `SeccionCarta.activa` | Un ítem agrupado nace activo y visible en su sección. La sección vacía no muestra nada (B); el ítem agrupado sí. | M/B | código/BD: nacer `activo=false` y «Mostrar en la carta» explícito, o aceptar como decisión (NO VERIFICADO que el dueño lo haya pedido así). |
| D4 | prisma/schema.prisma:3704 `ProductoAdmiteGrupo.seMuestraEnCarta @default(true)` | Un grupo de opciones vinculado a un producto nace «leído por la carta» (decisión 2026-10-29: `false` = el dueño pidió ocultarlo). La carta lo oculta solo si el grupo no cambia el precio. | M | BD: default false + backfill de lo existente en true (migración aditiva); o dejar como decisión confirmada. |
| D5 | prisma/schema.prisma:2076 `PromoCartaSucursal.activa @default(true)`, :2147 `EntradaDeCupo.activa`, :2119 `PromoCartaCupo.activo`, :2190 plato del día `activa`; también `Boolean @default(true)` en ~50 columnas (`activo/activa/habilitado`) | El default del esquema abre aunque el código pase explícito (persistencia/carta/promos.ts:42,57 sí lo pasa). Una fila creada por otra vía (script, SQL, otro caso de uso futuro) nace prendida. | B | BD: `DEFAULT false` en las que significan «ofrecer/visible/vendible» (PromoCartaSucursal.activa, PrecioLocal*.habilitado, ProductoAdmiteGrupo.activo…); dejar `true` en bajas lógicas (el «activo» de catálogo es baja lógica: aceptable). Guardián nuevo: `Boolean @default(true)` sin comentario `/// ABRE: motivo`. |
| D6 | src/app/(app)/catalogo/productos/producto-form.tsx:114,455 `useState(true)` «Activo en todas las sucursales» | Un producto nuevo nace vendible en TODAS las sucursales (se apaga solo si «nace sin poder venderse»). | M | pantalla: tildado vacío; elegir sucursales adrede. Decisión del dueño (alta rápida). |
| D7 | src/app/(app)/movimientos/precio-local/precio-local-form.tsx:27 `useState(true)` «Habilitado» | El precio local nace habilitado (precio, dinero). | B | pantalla: sin tildar por defecto, o aceptado (el campo exige un precio). |
| D8 | src/app/(app)/catalogo/proveedores/proveedor-form.tsx:62 `ofreceProductos ?? true`; schema L654 | Un proveedor nace «ofrece productos»; documentado («el alta nace productos como siempre») y hay CHECK de al menos una marca. | B | Dejar (compatibilidad declarada) o forzar elegir. |
| D9 | src/app/(app)/carta/parametrizacion/formularios.tsx:178 | Días de la promo: `diasDeSemana === null` → los 7 tildados = «vale todos los días»; NULL en BD significa «todos». La vigencia está oculta por `VIGENCIA_DE_PROMO_VISIBLE`. | B | Aceptable (vigencia opcional). |
| D10 | formularios.tsx:224 `lugar_incluir_* defaultChecked` | Los lugares EXISTENTES de una promo vienen tildados al editar (full-replace: destildar = dar de baja). Es edición, no alta. | B | Aceptable; documentar. Contraste: `CamposCupos` (L278) usa `defaultChecked={!!g}` → NACE CERRADO, es el modelo a copiar. |
| D11 | `permisoRol.puedeVer/puedeEditar @default(false)` (schema L~253), `SucursalPublica.publicada @default(false)` (L2220), `TemaCartaSucursal.aplicarEnCarta @default(false)`, `ContenidoCartaProducto.visibleEnCarta @default(false)`, `especial/mostrarNombreArriba @default(false)` | Correctos (cerrados). `especial` en guard: `datos.especial === true`. | — | Mantener; son el patrón. |

### 3.2 Texto libre sin forma (solo largo)
| ID | Dónde | Campo | Qué falta | Riesgo | Arreglo |
|---|---|---|---|---|---|
| T1 | src/core/carta/validaciones.ts:54-62 `validarTextoLibreCarta` (usado por secciones.guard.ts:39,41, promos.guard.ts:34,37, items-agrupados.guard.ts:37, contenido-producto.guard.ts:40, registro-publico.guard.ts:58,60, tema.ts:271) | `SeccionCarta.titulo/descripcion`, `PromoCarta.titulo/descripcion`, `PromoCuenta.titulo` (copia), `ItemAgrupadoCarta.descripcion`, `ContenidoCartaProducto.descripcion` (500), `SucursalPublica.etiqueta/subtituloPortal` | Solo `texto()` (trim) + largo. Sin juego de caracteres: pasan `<>` (React escapa, pero un `<` en un título público…), bidi/zero-width (spoofing en la carta pública), controles (`\u0000` rompe Postgres con 500; hay `quitarCaracteresInadmisibles` solo para búsquedas). La BD no tiene CHECK de largo ni de forma para estas columnas (`SeccionCarta.titulo` L1843, `PromoCarta.titulo` L2018, etc.). | M | código: `validarTextoLibreCarta` declara lo PERMITIDO: `^[\p{L}\p{M}\p{N}\p{P}\p{S}\p{Zs}\n]+$` (sin Cc/Cf/Zl/Zp salvo `\n` donde corresponda) y largo en `Array.from`, no `.length`. BD: CHECK de largo (`char_length <= 500`) aditivo. |
| T2 | src/core/datos/limites.ts:44-49 `validarTextoLibre` (notas, motivos, detalle, contacto, teléfono, observaciones: ver guards en compras/traspasos/ventas/proveedores/productos/recetas) | `Proveedor.notas/contacto/condicionesPago/telefono`, `Producto.observaciones`, `Operacion.detalleLibre`, `motivoAnulacion`, etc. | Solo largo. `telefono` debería ser dígitos/`+ - ( )`/espacio (hoy cualquier texto de 40). | B/M | código: variante `validarTextoLibre` con allowlist + `validarTelefono` (ya existe `validarTelefono` en css-valores.ts:~193 con normalización; reusarla). BD: CHECK largo. |
| T3 | src/core/features/empresa/empresa.schema.ts:15,29,72 `z.string().trim().min(1).max(120)` | `Empresa.nombre`, nombre de la primera sucursal | Largo sin forma (al revés que `Sucursal.nombre`, que pasa por `RE_TEXTO_CATALOGO`). El nombre de empresa se imprime en carta/ticket/mails. | M | código: usar el mismo `nombreDeCatalogo`/allowlist. |
| T4 | src/core/features/empresa/empresa.schema.ts:21 `moneda: z.string().length(3)` | `Empresa.moneda` (schema L2498, sin CHECK) | Cualquier 3 caracteres (`"123"`, `"€€€"`); hay `MONEDA_FIJA` en `core/moneda`. | M | código: `z.enum([...])`/`z.literal(MONEDA_FIJA)`; BD: `CHECK ("moneda" IN ('ARS'))` aditivo. |
| T5 | src/core/features/empresa/ciclo-de-vida.ts:16,25 `cuit: z.string().trim().min(1)`/`trim()` | corrección/confirmación de CUIT de la empresa | Sin forma en el esquema (la validación con dígito verificador está en otro lado: `validarCuit` en `core/fiscal`; NO VERIFICADO que plataforma la aplique antes de escribir `Empresa.cuit`). | M | código: `z.string().regex(/^\d{11}$/)` + `validarCuit`. BD: CHECK `cuit ~ '^[0-9]{11}$'`. |
| T6 | src/core/features/empresa/ciclo-de-vida.ts:13 `motivoSchema` min 3 / max 200 | motivo de suspensión | Solo largo; es auditoría interna. | B | idem T1. |
| T7 | src/core/carta/validaciones.ts:21-29 `validarImagenUrlCarta` (largo 1000 + `urlImagenSegura`) | `SeccionCarta.imagenUrl`, imágenes del tema/portal | Allowlist solo por «todo menos» (#1 de la deuda); sin lista de HOSTS permitidos. | M | código: allowlist de caracteres RFC 3986 y, si se quiere cerrar, hosts (cdn/almacén propio). |
| T8 | src/core/carta/color-css.ts:35-41 | colores del tema | `/^[a-zA-Z]+$/` acepta cualquier palabra como «nombre CSS» (`inherit`, `initial`, `expression`…); hex `{3,8}` acepta 5 y 7 dígitos (inválidos); funciones aceptan letras libres. | B | código: lista cerrada de ~148 nombres CSS + hex `{3}|{4}|{6}|{8}` + funciones con argumentos numéricos. |
| T9 | normalizarTagsCarta (validaciones.ts:36-52) | `tags String[]` (ContenidoCartaProducto L1884, ItemAgrupadoCarta) | App: 8 tags × 30 con allowlist `RE_TAG` (BIEN). BD: sin CHECK de cantidad ni largo (`String[]`). | B | BD: `CHECK (cardinality(tags) <= 8)`. |
| T10 | validarNombreEnCarta (contenido-producto.guard.ts:20-34) vs descripción de ContenidoCartaProducto | `nombreEnCarta` (80) y `descripcionEnCarta` de opción (120) usan allowlist; la descripción del producto en la carta (500) NO (T1). | Inconsistencia: la misma carta, dos criterios. | M | unificar en un `validarLineaDeCarta`/`validarTextoDeCarta`. |

### 3.3 Valores sin enum cerrado en BD (`String` sin CHECK) — esquema Prisma
Método: analicé las 571 columnas `String` de `prisma/schema.prisma` (112 modelos) contra los CHECK acumulados de las migraciones (agregados y borrados en orden): 81 tienen CHECK de lista (`IN (...)`), 23 de largo, 25 de otro tipo, 442 ninguno; casi todas las que representan estado/tipo SÍ tienen CHECK (p. ej. `Mesa.tipo`, `PromoCartaCupo.tipo`, `EntradaDeCupo.modoDeOpciones`, `FacturaProveedor.estado/origen/condicionPago`, `Producto.modoDeVenta`, `CombinacionEnLinea.origenPrecio`) y hay 11 enums nativos de Postgres (`TipoProducto`, `EstadoEmpresa`, `EstadoModulo`…). Heurística: el cruce por nombre de constraint puede fallar con CHECKs multilínea (NO VERIFICADO al 100%; los casos de abajo los confirmé uno por uno con grep).

Columnas categóricas SIN CHECK (VERIFICADO):
| ID | Columna (schema:línea) | Valores reales | Riesgo | Arreglo |
|---|---|---|---|---|
| E1 | `Empresa.moneda` (L2498) | `MONEDA_FIJA`; zod solo `length(3)` | M | BD `CHECK moneda IN (...)` + `z.enum`. |
| E2 | `Empresa.zonaHoraria` (L2497) | IANA, validada solo en zod (`esZonaHorariaValida`) | M | BD no puede listar IANA fácil; se acepta la validación de app pero declarar en el diseño (NO es lista cerrada en BD). |
| E3 | `UsuarioEmpresa.rolEmpresa` (L3081) | `NULL` o `'gerente'` (índice único parcial); `Invitacion.rolEmpresa` toma `gerente/usuario/vinculacion` | M | BD `CHECK (rolEmpresa IS NULL OR rolEmpresa IN ('gerente'))` (espejo de `ROL_EMPRESA_GERENTE`). |
| E4 | `ModuloEmpresa.modulo` (L2626) | claves del catálogo `src/core/modulos` («TEXT validado en código a propósito: agregar un módulo no requiere migración») | B | Excepción declarada; mantener la validación en `plataforma/src/servidor/modulos.ts` (usa `z.string().min(1).max(60)` y luego contra el registro: verificar en el caso de uso). NO VERIFICADO que una clave desconocida ya guardada se ignore al leer. |
| E5 | `CotizacionDolar.fuente` (L1805) | `'BNA'` \| `'BCRA'` | B | BD `CHECK (fuente IN ('BNA','BCRA'))`. |
| E6 | `AuditoriaPlataforma.accion` (L3162) | claves libres tipo `ingreso`, `alta-de-empresa` | B | Es append-only; opcional CHECK de forma `^[a-z-]+$`. |
| E7 | `RegistroAuditoria.entidad/campo` (L302-307) | nombres de modelo/columna | B | Se escriben desde `registrarCambioAuditado`; opcional CHECK de forma. |
| E8 | `EjemplarTicket.motivo` (L2473) | texto libre de la corrección | B | Largo (ver T2). |
| E9 | `PermisoRol.accionClave`, `CapacidadSucursal.accionClave` | FK a `Accion.clave` | — | Cerrado por FK. OK. |
| E10 | `Account.type/provider/scope`, tokens | datos de NextAuth | — | No aplica. |
| E11 | `JSON valores` de `TemaCartaSucursal` (L2243) y `PortalCartaEmpresa` (L2261) | `{clave: valor}` | M | La app valida contra `CLAVES_TEMA_V1`/`CLAVES_PORTAL_V1` al guardar y «ignora claves fuera del catálogo o valores inválidos al servir» (lectura cerrada: BIEN). BD sin forma. B-M: aceptable; sumar un guardián que verifique que la lectura filtra por catálogo. |
| E12 | `Proveedor.cuit`, `Empresa.cuit` | 11 dígitos con dígito verificador | M | BD `CHECK (cuit IS NULL OR cuit ~ '^[0-9]{11}$')`. |
| E13 | `Producto.codigo`, `Proveedor.codigo` | generados | B | CHECK de forma `^[A-Z0-9-]+$`. |
| E14 | CHECK de «nombre» con `~ '\S'` (`PromoCartaCupo_nombre_chk`, `GrupoDePrecio_nombre_chk`, `CombinacionEnLinea_nombre_grupo_chk`) | «algo visible» | B | Es «no vacío», pero el guardián no lee SQL. OK; opcional reemplazar por allowlist `^[\p{L}…]` (PG no soporta `\p`: usar `[[:alnum:] ...]`). |

Nombres de catálogo SIN CHECK en BD (la defensa es solo de app): `Producto.nombre`, `Insumo.nombre`, `Proveedor.nombre`, `Cliente.nombre`, `CategoriaProducto.nombre`, `Unidad.nombre`, `Seccion.nombre`, `Rol.nombre`, `Sucursal.nombre`, `SeccionCarta.nombre`, `GeneroCarta.nombre`, `ItemAgrupadoCarta.nombre`, `MotivoMerma.nombre` (todos pasan por `validarTextoCatalogo`/`nombreDeCatalogo` en el guard: allowlist `RE_TEXTO_CATALOGO` + 80 + sin `-` inicial — BIEN). Con CHECK de largo en BD: `ContenidoCartaProducto.nombreEnCarta`, `CuentaItem.nombreEnTicket`, `OpcionDeGrupo.nombre/descripcionEnCarta`, `GrupoDeOpciones.nombre`, `GrupoDePrecio.nombre`, `ConceptoDeGasto.nombre`, `PlanDeCostos.nombre`, `CentroDeCostos.nombre`. Riesgo: cualquier escritor que no pase por el guard (script, seed, SQL) no tiene red. B-M. Arreglo BD: CHECK de largo (`char_length("nombre") BETWEEN 1 AND 80`) en los nombres de catálogo; aditivo, `NOT VALID` primero.

### 3.4 Lo que YA nace cerrado (para no «arreglar» lo que está bien)
- `CamposCupos` (formularios.tsx:278) `defaultChecked={!!g}`: ninguna sección tildada al crear una promo armable; tildar una sección no tilda sus platos (cupos con `PromoCartaCupo`/`EntradaDeCupo` explícitos; promo «a elegir» `FIJAS` por defecto).
- `wherePromoOfrecidaEn(sucursalId, audiencia)` (core/carta/promo-sucursal.ts): audiencia obligatoria, cualquier valor raro = ve MENOS (falla cerrado); «sin fila = no la ofrece».
- `esFijo`, `guardComandoGuardarSoloSalonPromoCarta`: el interruptor exige un booleano EXACTO (rechaza `"true"`, `1`, ausencia).
- Permisos: `PermisoRol.puedeVer/puedeEditar @default(false)`; `Accion` por FK; `carta_promo_activar` separado de `carta_promo_definir`.
- `SucursalPublica.publicada=false`, `TemaCartaSucursal.aplicarEnCarta=false` (borrador), «FILA AUSENTE = estilo por defecto».
- Tema/portal: lectura filtra por catálogo de claves; `validarEnum` es lista cerrada; `validarSlugTenant` allowlist `^[a-z0-9]+(-[a-z0-9]+)*$` + 60; `RE_TAG` allowlist; `RE_TEXTO_CATALOGO` allowlist (el modelo de cómo se hace).
- `Empresa.condicionIva` NULL = «no declarada: quien la lea falla cerrado».

### 3.5 `z.string()` sin límite (25 usos en `src/`, más `plataforma/src`)
VERIFICADO: la mayoría son variables de entorno (`src/env.ts`: `z.string().min(1)`, sin máximo, config del operador: B) o campos del módulo empresa (T3-T6). `plataforma/src/servidor/modulos.ts:35` sí acota (`min(1).max(60)`, `.max(20)`). `empresa.schema.ts:28,73` usa `z.email()` (hay 3 criterios de email en el repo: ver #15, #16, #17). El resto de la validación de entrada NO usa zod sino guards propios (`ResultadoDato`), donde el patrón es «trim + largo» (T1-T2).

---------------------------------------------------------------------

## 4. Arreglos propuestos, en orden (pasos chicos; Sonnet escribe, Opus verifica)

1. Pantalla D1 (`?? false` en `contenido-del-producto.tsx:147`) + test del formulario. Bajo costo, caso literal del dueño.
2. Un único `validarTextoDeCarta(valor, etiqueta, maximo, {multilinea})` allowlist (`\p{L}\p{M}\p{N}\p{P}\p{S}\p{Zs}`, `\n` opcional) usado por `validarTextoLibreCarta`, `tema.ts` tipo `texto`, `descripcionEnCarta` y `validarNombreEnCarta`; borra las 3 líneas redundantes (#2, #13, #14) y `RE_CONTROL` (#7). Baja la deuda de 21 a 18 y cierra T1/T10.
3. Un único `esEmailValido` allowlist (local `[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+`, dominio en punycode) usado por limites.ts, primer-admin.ts, direcciones.ts: baja #15-#18.
4. URLs: un `urlHttpsPermitida` con caracteres RFC 3986 para armar-menu, css-valores, metadatos: baja #1, #3, #4.
5. `promo-combo.ts:152`: `esIdentificador(opcionId)` (#21).
6. `enviar.ts:37` `UNA_LINEA` → `^[\p{L}\p{M}\p{N}\p{P}\p{S}\p{Zs}]{1,N}$`; `env.ts:32` `^re_[A-Za-z0-9_]+$`; `volver.ts:22` en positivo.
7. Falsos positivos: declararlos con una marca explícita permitida (p. ej. comentario `// cerco-lista-de-permitidos: sanea, no valida`) si el guardián la soporta; si no, aceptarlos como piso (analizar-fuente, estructura, texto.ts, ruta-servible, portal×2 = 6) y fijar la meta en 6, no en 0 (hoy la meta dice «0», inalcanzable sin cambiar el detector).
8. BD (aditivas, `NOT VALID` y luego `VALIDATE`): CHECK `Empresa.moneda`, `Empresa.cuit`, `UsuarioEmpresa.rolEmpresa`, `CotizacionDolar.fuente`, largo de nombres de catálogo y de `tags`.
9. Defaults D2-D6: llevar al dueño como decisiones (cambian producto): promo nace apagada y solo salón; ítem agrupado nace oculto; grupo de opciones `seMuestraEnCarta=false`; producto nuevo sin sucursales tildadas.
10. Guardianes nuevos que hoy no existen (cada uno con su línea de base y vencimiento): (a) `Boolean @default(true)` en `schema.prisma` que signifique visible/vendible sin comentario justificativo; (b) `defaultChecked`/`?? true`/`useState(true)` en `src/` de formularios; (c) `z.string()` sin `.max()`; (d) `validarTextoLibre*` sin allowlist. Antes de crearlos aplicar la regla del dueño «poda»: si no ligan a una necesidad escrita, no entran.
11. Vencimiento: pedir al dueño la aprobación real (hoy «pendiente de aprobar al mergear el PR #229») y escalonar la fecha por riesgo (emails/URLs/combo primero, como las otras listas).

## 5. NO VERIFICADO
- No corrí `npm test`/`tsc`/`lint` (sin `node_modules`); los números de la línea de base son los del JSON y los del detector corrido con `npx tsx` (21 en 19 archivos: coinciden).
- Que `plataforma/src` aplique `validarCuit` antes de escribir `Empresa.cuit` (T5).
- Qué pantallas de `plataforma/src` tienen formularios con texto libre (revisé solo `modulos.ts` y `entorno.ts`).
- Que `src/generated` o `prisma/seed.ts` queden fuera/dentro del alcance del detector.
- Si el dueño confirmó que ítems agrupados/grupos de opciones nacen activos/visibles (D3, D4): son decisiones de producto, no errores demostrados.
- El render de los textos libres de la carta pública (escape React vs. otros contextos como JSON-LD): `grep` de `ld+json` y `dangerouslySetInnerHTML` en `src/app` y `src/components` no devolvió usos, así que el riesgo de T1 es de spoofing/ruido, no de XSS (VERIFICADO por grep, no por prueba).
