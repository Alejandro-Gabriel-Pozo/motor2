# Diseño: «Todo nace cerrado» (fallo cerrado) — 2026-11-11

Escalera de diseño, niveles 1 a 5. Sin tablas ni migraciones. Estados: CONFIRMADA (dicha por el dueño), PROPUESTA, PENDIENTE, NO VERIFICADA.

## Nivel 1 — Propósito y alcance
- Instalar en motor2 la regla «Todo nace cerrado» (denegar por defecto), tomada de Pedernal (`zuluhub-erp`, `CLAUDE.md`, viñeta «Todo nace cerrado»). CONFIRMADA.
- Este PR (PR 1): la regla escrita en `AGENTS.md`, un guardián mecánico de «validación por lista de prohibidos» con línea de base y vencimiento, y este documento.
- Fuera de alcance (trabajos aparte): corregir los hallazgos existentes; la regla «sin dato registrado no hay campo»; el registro de decisiones; el tope de 400 líneas por archivo (PR 2, después de mergear este).

## Nivel 2 — Actores y contexto
- Dueño: define la regla. Sonnet: escribe el guardián. Orquestador/Opus: revisa y mergea con el CI verde.
- Contexto: motor2 ya usa «cercos de trinquete» (`test/arquitectura/cercos/`) con línea de base y vencimiento máximo de 60 días.

## Necesidad (quién la pidió y dónde está escrita)
Pedido del dueño, 2026-11-11 (CONFIRMADO), en el encargo de esta sesión: «La idea de esto es empezar a moldearlo y decir todo nace cerrado. En este caso, por ejemplo, yo creo una promoción y nace sin ninguna sección tildada. Tildo esa sección. Y no nacen todos los platos tildados, sino que yo los tengo que tildar. Esto me asegura de que toda decisión sea adrede. Lo mismo con el código.» Antecedente de producto: diseño de promos por sección (`docs/diseno-promo-parte-de-seccion-2026-11-11.md`, PR #227).

## Nivel 3 — Casos de uso
1. Alguien escribe una validación («rechazar si contiene…») en `src/`, `plataforma/src/` o `scripts/`: el cerco falla y pide declarar lo permitido.
2. Alguien corrige una validación heredada: la cuenta baja; el cerco pide bajar la línea de base (`BAJAR_CERCOS=1`).
3. Pasa el vencimiento (60 días) sin pagar la deuda: el gate falla hasta renovarla con motivo y aprobación.

## Nivel 4 — Conceptos y ciclo de vida
- «Lista de prohibidos»: condición que describe lo que NO se quiere (controles, invisibles, `<`/`>`, «todo menos esto») y decide si un texto vale. «Lista de permitidos»: conjunto, largo y forma de lo que SÍ vale.
- Una validación pasa de deuda declarada (línea de base) → corregida (cuenta baja) → línea de base más chica. Nunca sube.

## Nivel 5 — Invariantes y políticas
- I1: una validación nueva por prohibidos no entra (el cerco falla). PROPUESTA de implementación; regla CONFIRMADA.
- I2: lo que el detector no puede analizar cuenta como prohibición (fail-closed). PROPUESTA.
- I3: la deuda existente tiene vencimiento ≤ 60 días con aprobación referenciada, como las demás listas. CONFIRMADA (regla G1b).
- I4: los límites de lo que el detector NO ve están declarados, con un ejemplo cada uno, en el encabezado de `cerco-lista-de-permitidos-apoyo.ts`; es una alarma para errores honestos, no un límite de seguridad. PROPUESTA.
- Alcance del detector: TypeScript/JavaScript de `src/`, `plataforma/src/` y `scripts/`, sin archivos de prueba. No se miran migraciones SQL (motor2 no las usa para validar texto con listas de prohibidos; queda como límite declarado). Los formatos de terceros de Pedernal (cookies, ARCA) no se copiaron: no aplican. PROPUESTA.

## Tabla «¿qué pasa si…?»
| Situación | Resultado |
|---|---|
| Repetición: se corre el test dos veces | Mismo resultado (determinista, sin estado) |
| Concurrencia: dos PR suben la cuenta del mismo archivo | El segundo en mergear falla el trinquete tras actualizarse con main |
| Tiempo: vence la deuda | El gate falla hasta renovar con motivo y aprobación nueva |
| Incertidumbre: `new RegExp(variable)` | Cuenta (no se puede analizar) |
| Error parcial: el detector no puede leer un archivo | El test falla ruidosamente; no se saltea |
| Datos faltantes: no existe la línea de base | Falla; se crea solo con `CREAR_CERCOS=1` |
| Cambio de permisos | No aplica (no toca permisos ni datos) |
| Se corrige una validación y no se baja la línea de base | Falla («bajó»): pide `BAJAR_CERCOS=1` |

## Línea de base inicial
21 validaciones en 19 archivos (el encargo estimaba 20 en 18 con otra copia del detector; la diferencia es un archivo de 1 hallazgo, ver el cuerpo del PR). Se declaran, no se corrigen aquí.

## PR 2 — Tope de 400 líneas por archivo (2026-11-12)
- Necesidad: pedido del orquestador al dueño (2026-11-12), como segundo PR de «Todo nace cerrado»: un archivo no crece sin que alguien lo decida. CONFIRMADA como pedido; el valor 400 es el del pedido.
- Alcance: archivos `.ts` y `.tsx` de `src/` (no `plataforma/src/`, `scripts/` ni `test/`). PROPUESTA (el pedido habla de `src/`).
- Mecanismo: cerco de trinquete `tope-de-lineas` que cuenta, por archivo, las líneas que se pasa de 400 (como `wc -l`). Contar el exceso impide que un archivo ya grande siga creciendo. PROPUESTA.
- Línea de base: 18 archivos (el mayor, `rendimiento-recetas.ts`, 876 líneas) = 2187 líneas de exceso. Deuda con vencimiento ≤ 60 días; partirlos queda fuera de alcance.
- ¿Qué pasa si…? Un archivo nuevo de 401 líneas: falla. Un archivo en la línea de base crece: falla. Se parte: la cuenta baja y el cerco pide bajar la línea de base (`BAJAR_CERCOS=1`). Vence el plazo: falla hasta renovar con motivo y aprobación.

## PR 3 — Se pagan las 21 validaciones por lista de prohibidos (2026-11-12)
- Necesidad: pedido del dueño, 2026-11-12 («Hacé la 1: corregí las validaciones por lista de prohibidos», respuesta a la lista de trabajos aparte del PR 2). CONFIRMADA.
- Qué se hizo: cada validación heredada pasó a declarar lo que se PERMITE; la línea de base quedó en 0 y se sacó su vencimiento.
- Supuestos PROPUESTOS (los corrige el dueño; todos ENDURECEN, ninguno suma funciones):
  1. URL de imagen (`https://`): solo ASCII de una URL (`url-https.ts`); ya no entran caracteres fuera de ASCII sin codificar, invisibles ni corchetes. Antes `metadatos.ts` y `css-valores.ts` aceptaban casi todo menos espacios.
  2. Correo: parte local de letras, números y `. _ % + -` (hasta 64) y dominio de etiquetas ASCII (254 en total); ya no entran direcciones con eñe/acentos sin punycode ni con `'`, `!`, `#`, etc. El remitente «Nombre <dirección>»: el nombre admite letras, marcas, números, espacio y `. , & ' ( ) _ -`.
  3. Texto de UNA línea (`esTextoDeUnaLinea`): letras, marcas, números, puntuación, símbolos (emojis incluidos), espacio y espacio de no separación. Lo usan el tipo «texto» del tema, el asunto y la clave de idempotencia del mail, y el path servible (un segmento decodificado con control o invisible → 404). Los emojis compuestos con unión de ancho cero ya no entran en esos campos.
  4. Ids de opción de un combo, de producto en una ruta y clave de Resend (`re_…`): `[A-Za-z0-9_-]`.
  5. «Nombre en la carta» y descripción de opción: el salto de línea lo rechaza la lista de permitidos del catálogo que ya existía; el mensaje ahora dice «va en una sola línea» dentro del aviso de caracteres no permitidos.
- Excepción declarada (una): `src/core/texto.ts` (`quitarCaracteresInadmisibles`) es un sanitizador que quita NUL y sustitutos sueltos; no valida, y listar lo que se quita es su razón de ser.
- ¿Qué pasa si…? Dato ya guardado que el nuevo criterio rechazaría (p. ej. una URL con eñe): sigue guardado; solo se rechaza al volver a guardarlo o al mostrarlo si la carta lo revalida (la carta ya revalida las URL con `urlImagenSegura`: sin imagen en vez de error). Lo existente no se migra.
