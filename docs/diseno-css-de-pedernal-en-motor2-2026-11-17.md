# Diseño: el CSS y el marcado de las maquetas de Pedernal viven en Motor2 sin reescribirse (regla P13; solo diseño, nada se construye)

Fecha: 2026-11-17. Frente 8 «Visual». Pedido: orquestador general, regla P13 («NO REDIBUJAR, COPIAR EL HTML: cada pantalla parte del HTML de Pedernal copiado entero —marcado, CSS, clases, textos—; solo cambia la capa de datos»), fijada por la orquestadora de Pedernal a pedido del dueño. Solo documento. Estados: CONFIRMADA / PROPUESTA / PENDIENTE / NO VERIFICADO. Las cifras salen de las 46 maquetas de `ZuluHub-docs/10-ux-ui/prototipos-gastronomia/` y del código de ambos repos (leídos hoy).

## 0. En lenguaje de proceso
1. Hoy Motor2 **reescribe** cada pantalla con clases de Tailwind y primitivas; el resultado se parece pero no es igual (V1–V3 lo acercaron: letra, borde, radio). La regla nueva dice: copiar.
2. **Se puede copiar sin reescribir** porque las maquetas comparten casi todo su CSS: las clases del producto (`.campo`, `.btn`, `.tarjeta`, `.fila2`, `.franja`, `label.et`…) tienen UNA o dos definiciones distintas en las ~40 maquetas que las usan (medido, §1). Una sola hoja las contiene.
3. **Camino más barato (PROPUESTA):** una hoja global generada por script a partir de las maquetas (copia literal de las secciones «de producto», sin la del «prototipo»), cargada en una capa propia y limitada a un contenedor; los componentes de Motor2 que dibujan una pantalla **emiten exactamente el marcado de la maqueta**, con los datos entrando por props. Un test renderiza el componente con los datos de ejemplo de la maqueta y exige el **mismo HTML** que la maqueta: si hay diferencia, no es de datos.
4. Se prueba con UNA pantalla chica (proveedores, `directorio.html`) antes de tocar las demás.

## 1. Qué hay (medido)
| Hecho | Cifra / lugar |
|---|---|
| Maquetas con su propio `<style>` | 46; de 23 a 274 reglas (mediana 163); no hay una hoja compartida: cada archivo trae su copia |
| Cuántas definiciones distintas tiene cada clase de producto | `label.et` 1 (en 38 maquetas) · `.btn.prim` 1 (38) · `.franja` 1 (38) · `.fila2` 1 (55 usos) · `.btn` 2 (39) · `.ayuda` 2 (36) · `.tarjeta` 2 (56) · `.campo` 3 (40) · `.cuerpo` 2 · `.pie` 3 · `.tabs` 3 (20) · `.chip` 4 (35) · `.op` 5 (38) · `.tel` 10 (95: es el marco del celular del prototipo, no del producto) |
| Variables | Un bloque `:root` idéntico en 30 de 46 maquetas; 9 bloques distintos en total. Nombres cortos (`--e1`…`--e6`, `--r1`…`--r3`, `--objetivo`, `--brand-primary`, `--color-*`) frente a los del producto real de Pedernal (`apps/web/ui/tokens.css`: `--espacio-1`…`6`, `--radio-*`, `--objetivo-minimo`) |
| Secciones de cada hoja | Comentarios regulares: «El celular» (40), «Panel del prototipo» (39), y una por componente («Hoja de opciones» 30, «Salón» 27, «Compra» 25…). Sirve para separar mecánicamente el **chrome del prototipo** (`.tel`, `.escena`, `.lateral`, panel de estados) de lo que es producto |
| Objetivo táctil | Pedernal real, `apps/web/ui/tokens.css:81-84`: `--objetivo-minimo-operacion: 3rem` (48 px) y `--objetivo-minimo-administracion: 2.75rem` (44 px); cada plantilla fija el suyo (`PlantillaAdministracion.module.css:3`). Las maquetas usan 3 rem. **Motor2 V3 puso 44 px en todo**: corto para operación/POS. Se corrige en V3 con un token por superficie (§3 de este documento no cambia). Las superficies y sus colores están atadas en `test/web/contraste-de-superficies.test.ts` (ese test mide contraste por superficie, no el alto del toque) |
| Color primario | `--brand-primary: #1f4e79` (azul); Motor2 usa tinta (negro) (V7, pausado por P13) |
| Cómo carga CSS Motor2 | Tailwind v4: `src/app/globals.css` (873 líneas) con `@theme static` de colores (contrato `tokens-visuales`), sin CSS Modules |
| Guardianes que miran `.css` | `cerco-colores` y `cerco-tipografia` leen `src/` y `plataforma/src` con extensión `.css` (un `#hex` o un `font-size: 1rem` literal sube su cuenta y el trinquete falla); `contraste-de-color` y `tokens-del-sistema-visual` miden pares de `@theme static`; `cerco-tope-de-lineas` (400) mira solo `.ts`/`.tsx` de `src/` |

## 2. Camino propuesto (PROPUESTA)
**2.1 La hoja.** `scripts/pedernal/generar-hoja.ts` lee las maquetas, toma las secciones de producto (todo menos «Panel del prototipo», «El celular»/`.tel`/`.escena`/`.lateral`), une las definiciones y escribe `src/estilos-pedernal/maquetas.css` + `maquetas.fuente.json` (commit de ZuluHub-docs, archivos y hash de cada regla). Dónde difieren las variantes de una clase (p. ej. `.campo` en 3 formas) el script **no elige**: falla y lista la diferencia; se resuelve una vez, con la decisión escrita (lo más probable: la variante más usada) y el script la recuerda. No se edita la hoja a mano.
**2.2 Cómo convive con Tailwind.** La hoja se importa en `globals.css` con `@import "…/maquetas.css" layer(pedernal);` y los selectores se limitan con `@scope (.pedernal) { … }` (los de `body`, `*`, `button, input, select` de la maqueta pasarían a ser del contenedor). Así: no pisa el resto de la app, y una utilidad de Tailwind puede ganarle en un caso puntual. Alternativa si `@scope` no alcanza a los navegadores objetivo: prefijar selectores con un transform mecánico y verificable (invertirlo da la hoja original). NO VERIFICADO: soporte de `@scope` y su orden con las capas de Tailwind v4; se prueba en el piloto.
**2.3 Variables.** La hoja trae su `:root`. Se mapean a las de Motor2 solo si hace falta (los nombres no chocan: `--e*`, `--r*`, `--objetivo`, `--color-*` frente a `--color-papel`… de `@theme static`; **`--color-fondo` y `--color-texto` existen en ambos mundos con otro valor: choque a verificar**, por eso el contenedor `.pedernal` las redefine localmente).
**2.4 Marcado.** Un componente por pantalla/estado en `src/components/pedernal/<pantalla>/` que emite el HTML de la maqueta (clases incluidas) y recibe los datos por props. Se parte desde un volcado automático del DOM de la maqueta (Playwright, por estado) convertido a JSX; el humano solo reemplaza los textos de datos por props. Archivos de hasta 400 líneas (`cerco-tope-de-lineas`): un componente por estado.
**2.5 Interacción.** La maqueta trae su JS de demostración; no se copia. Los componentes usan los formularios y acciones de servidor de Motor2 (permisos, idempotencia y validación del servidor no cambian).

## 3. Cómo se verifica que la diferencia sea solo de datos (PROPUESTA)
| Chequeo | Falla si… |
|---|---|
| Hoja = fuente | `maquetas.css` no es lo que el script genera hoy desde las maquetas (hash del contenido) |
| Marcado = maqueta | Se renderiza el componente con los **datos de ejemplo de la maqueta** (extraídos del DOM, no escritos a mano) y el HTML normalizado (espacios, orden de atributos) difiere del `.tel` de la maqueta en ese estado: diferencia de estructura, clase o texto fijo |
| Palabras | Más de maqueta + 10 % (regla de `docs/diseno-ficha-de-pantalla-y-texto-permitido-2026-11-17.md`) |
| Sin estilos sueltos | Un `className` con utilidades de Tailwind dentro de un componente `pedernal/` (salvo excepción con motivo y cita): todo estilo sale de la hoja |
La fuente de verdad es la maqueta con su commit; si Pedernal la corrige, se regenera y el diff aparece en el PR.

## 4. Guardianes existentes (qué cambia, sin esconderlo)
| Guardián | Efecto de la hoja copiada | Resolución propuesta |
|---|---|---|
| `cerco-colores` (`.css` en `src/`) | Sus `#hex` subirían la línea de base | Ubicar la hoja bajo `src/estilos-pedernal/` y **excluirla por ruta exacta con motivo** («copia literal de Pedernal; la verifica el chequeo hoja = fuente y el contraste de Pedernal, `apps/web/ui/tokens.test.ts`»). Es una excepción declarada del cerco, con vencimiento ≤ 60 días renovable por decisión |
| `contraste-de-color` / `tokens-visuales` | Miden `@theme static`, no la hoja | Se agrega una medición de contraste de los pares de la hoja (texto sobre fondo ≥ 4,5:1; borde ≥ 3:1), calculada desde sus variables |
| `cerco-tipografia` | `font-size` literales de la hoja | Misma exclusión por ruta con motivo; el piso de 16 px se verifica sobre la hoja (ninguna medida < 1rem: los de Pedernal ya cumplen, `tokens.test.ts`) |
| `cerco-tope-de-lineas` | Solo `.ts`/`.tsx` | Los componentes generados respetan 400 líneas por archivo |
| `legibilidad-movil.spec` (rama `ci-legibilidad-movil`) | Mide el DOM final | Sin cambios; es la prueba de que la copia cumple 16 px y sin desborde a 375 px |
| V1–V3 (piso 16 px, borde, radio) | Pasan a ser de las pantallas NO migradas | Se mantienen mientras existan pantallas con primitivas; no se tocan |

## 5. Tabla «¿qué pasa si…?»
| Situación | Resultado |
|---|---|
| Pedernal corrige su maqueta | `generar-hoja` y la extracción de marcado cambian; el diff va al PR; ninguna edición a mano |
| Dos maquetas definen distinto la misma clase | El script se detiene y lo dice; una decisión por clase |
| El componente necesita un estado que la maqueta no tiene | Se pide la maqueta (P-reglas: lo que no está en la maqueta no existe); no se inventa |
| Un dato real es más largo que el de ejemplo | Cae en el CSS de la maqueta (`min-width: 0`, `text-wrap`); si desborda, lo detecta `legibilidad-movil` y se corrige la maqueta, no el componente |
| La hoja choca con una clase de Motor2 (`.campo`, `.btn`) | Hoy no hay ninguna con ese nombre (buscado en `src/`); `@scope` + capa la contienen |

## 6. Tramos (PROPUESTA)
| Tramo | Contenido | Tamaño |
|---|---|---|
| H0 | Probar `@scope` + capa de Tailwind v4 con 3 reglas a mano en una rama descartable | S |
| H1 | `generar-hoja.ts` + `maquetas.css` + chequeo hoja = fuente | M |
| H2 | Extracción del DOM por estado y conversión a JSX; test «marcado = maqueta» | M |
| H3 | Piloto: proveedores (`directorio.html`), sin dinero ni stock; capturas lado a lado con `ZuluHub-docs` | M |
| H4 | Excepciones declaradas en `cerco-colores` y `cerco-tipografia`; contraste de la hoja | S |
| H5+ | Una pantalla por vez, dentro del trabajo de cada frente | recurrente |
Criterio de seguir: si la segunda pantalla cuesta la mitad que la primera.

## 7. Dos niveles de referente (precisión de Pedernal, 2026-11-17; reemplaza la pregunta anterior)
Pedernal NO usa en su app las clases de las maquetas: sus pantallas usan CSS Modules sobre `apps/web/ui/tokens.css` (`Campo.module.css`, `Boton.module.css`). Entonces:
1. **Contrato visual** (lo que juzga «igual/difiere»): la maqueta HTML renderizada, con capturas lado a lado; el código real de Pedernal ya la reproduce.
2. **Código de referencia cuando la pantalla YA está construida en Pedernal:** el componente real con sus CSS Modules (ej. alta de producto: `plantillas/catalogo/FormularioDeFichaDeProducto.cliente.tsx` + `.module.css`; lista: `PantallaDeListaDeProductos.module.css`; caja: `plantillas/caja/PantallaDeListaDeCaja.module.css`; fiscal: `plantillas/configuracion-fiscal/*.module.css`). Se compara el nombre de la pantalla contra `plantillas/` en `origin/main` (no en ramas) y que no esté en deuda.
3. **Pantalla NO construida en Pedernal** (ej. proveedores/directorio: no existe en `apps/web`): el referente es el HTML de la maqueta, y vale todo el camino de este documento.
Consecuencia para el diseño: para las pantallas construidas la fuente de la hoja son los `*.module.css` + `tokens.css` de Pedernal (se copian tal cual, con sus tokens `--espacio-*`, `--radio-*`, `--objetivo-minimo`), no las clases de la maqueta; el piloto (H3) queda en una pantalla NO construida (proveedores) y se suma un segundo piloto con una construida (la lista de productos) para probar el otro origen.

## 8. Pregunta abierta
Resuelta por Pedernal (§7). Queda una a medida que se construya: para cada pantalla de Motor2, ¿está ya en `plantillas/` de Pedernal (origen = módulos CSS) o no (origen = maqueta)? Lo decide la comparación contra `origin/main`, no una opinión.
