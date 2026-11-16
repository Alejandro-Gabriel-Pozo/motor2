# Diseño: los textos en el código, cerrados por defecto, reducidos y reutilizados (solo diseño en papel)

Fecha: 2026-11-16. Sesión de documentos (rama `diseno-textos-en-codigo-2026-11-16`, base `main` `66e20d1a`). **No toca ningún texto visible, código, prueba, catálogo ni migración.** Inventario con cifras y tabla: `docs/inventario-de-textos-motor2-2026-11-16.md`.

**Pedido y necesidad (CONFIRMADA).** Dueño, 2026-11-16, chat con el orquestador (`motor2-docs`, `seguimiento-de-pedernal/decisiones-del-dueno-2026-11-14-mesa-resend-contador.md`, sección «Textos: el orquestador se encarga…»): «Los textos encargarte vos trata de reducir, textos, inventariar y empezar a reutilizar y que representen 1 sola cosa, definir primitivas e invariantes en texto igual que pedernal». Paridad con Pedernal: `AGENTS.md`, 2026-11-13. Referencia leída: `ZuluHub-docs` `11-especificaciones/inventario-de-textos-en-codigo-diseno.md` y `plan-de-construccion-de-declaraciones.md` (clon del 2026-11-16, `521fc60b`). El alcance de la delegación al orquestador figura en ese registro como **PROPUESTA** (el dueño la corrige).

Estados: CONFIRMADA (lo dijo el dueño), PROPUESTA (mía, la corrige quien decide), PENDIENTE, NO VERIFICADO. **†** = aproximado.

## 0. En lenguaje de proceso

1. **Hoy Motor2 no tiene un lugar donde viva la palabra.** Cada pantalla y cada caso de uso escribe sus frases a mano: unas 5.700 apariciones de texto visible †, 4.300 distintas †; 668 valores se repiten (2.065 apariciones) y de 167 códigos de rechazo, 46 se dicen con más de una frase. Ninguna tiene «fuente» ni «quién la usa» declarados. Esto es distinto de Pedernal, que ya tenía 886 textos en un catálogo cerrado.
2. **Se propone una sola entrada por texto, en un catálogo cerrado** (pedir una clave inexistente no compila), con **quién lo usa** y **de dónde salió**, más chequeos que fallan si aparece un texto sin declarar, sin uso, sin fuente, repetido o escrito a mano. Es la forma de Pedernal con código propio.
3. **Lo más barato primero (T1):** el esqueleto del catálogo con UNA sola entrada real (el rechazo de dos presentaciones activas en la misma unidad, etapa a2-1) y sus chequeos sobre el propio catálogo. No cambia nada para el cliente y no obliga a nadie.
4. **Reducir** va por familias de causa (§4), siempre empezando por lo que no cambia lo que ve el cliente; lo que cambia dinero, permisos o texto fiscal/legal va «AL DUEÑO».
5. **Una pregunta pendiente** (§10), para el orquestador, sobre cómo cita cada lote aceptado por delegación.

## 1. Qué cosa es qué (verificado contra el código de `66e20d1a`)

### YA EXISTE
| Qué | Dónde | Qué hace / límite |
|---|---|---|
| Regla de NOMBRES («texto de catálogo») | `src/core/datos/texto-de-catalogo.ts` (cabecera y `textoDeUnaLineaDesdeTexto`), `fichas-de-texto.ts` (`FICHAS_DE_TEXTO`, 4 fichas) | Valida lo que la persona ESCRIBE (nombre de producto, proveedor…). **No es un catálogo de rótulos:** el nombre se parece pero es otra cosa. Se llama «texto de catálogo» y choca con la palabra del diseño nuevo (§9, D1). Conectado por `nombre-de-ficha.ts` |
| Su guardián de dimensiones y su oráculo | `test/arquitectura/texto-de-catalogo-declarado.test.ts`, `test/core/oraculo-texto-de-catalogo.ts` (192 líneas) | Falla si aparece una ficha, opción, motivo o función sin declarar. **Plantilla del tipo de chequeo que se reutiliza** |
| Tabla de puntos de validación declarados | `test/arquitectura/nombres-puntos-declarados.ts`, `nombres-puntos-de-validacion.test.ts` | Cada punto que valida un nombre figura en una tabla |
| Recuento de nombres y CUIT | `docs/e1-recuento-de-textos-y-cuit-2026-11-15.md` | Cuenta nombres guardados que romperían la regla. Mide datos, no rótulos |
| Texto en UN lugar por tema (patrón «motivo tipado → texto») | `src/core/permisos/motivos.ts:11` (`Denegacion`) y `:21` (`textoDeDenegacion`, «único lugar donde se escriben estas frases»); `src/core/pos/puesto.ts:27` (`rotuloDePuesto`), `:45` (`frasesDePuesto`); `src/core/carta/texto-de-la-carta.ts:18,26,51`; `plataforma/src/app/instalaciones/[instalacion]/empresas/textos.ts:9,16,29` | Cuatro familias ya resueltas a mano, sin declarar quién las usa ni su fuente |
| Texto-como-dato en tablas | `src/core/permisos/acciones.ts` (131 `descripcion:`), `src/core/navegacion/estructura.ts:52` (`GRUPOS_NAV`), `src/core/modulos/catalogo.ts`, `src/core/carta/tema.ts`, `src/core/movimientos/ui-config.ts`, `src/core/movimientos/motivos-semilla.ts` | Rótulos de menú, permisos, tema y motivos |
| Resultado de un caso de uso con código estable | `src/core/resultado-caso.ts:32` (`fracaso(codigo, mensaje)`), `:28` (`exito`), `:37` (`aResultadoAccion`); `src/server/actions/tipos.ts:47,59` (`ok`, `error`) | El `codigo` ya nombra UNA causa y es público (lo comparan pruebas); **el mensaje se escribe a mano en cada llamada** |
| Un solo lugar para el nombre del puesto | `test/arquitectura/puesto-sin-texto-de-mesa-a-mano.test.ts` | Único chequeo de «texto a mano» que existe, solo para «Mesa N» |
| Cercos de trinquete (cuenta por archivo que solo baja) | `test/arquitectura/cercos/trinquete.ts` (`Cerco`, `medirPorArchivo`, `BAJAR_CERCOS`, `CREAR_CERCOS`), `linea-de-base/*.json` (24 listas), `vencimientos.ts` (60 días) | **Mecanismo a reutilizar para la deuda de texto a mano**; ejemplo de detector sobre JSX: `cerco-dialogos-y-avisos-a-mano.test.ts` |
| Registro de decisiones y su guardián | `docs/registro-de-decisiones.md` (11 DEC, todas `ACEPTADA`), `test/arquitectura/registro-de-decisiones.test.ts` y `guardas/registro-de-decisiones.ts:19` (`ESTADOS`), `:21` (`TOPE_DE_PENDIENTES = 10`) | Fuente verificable desde el CI. Es Markdown, no JSON |
| Lista de permitidos | `test/arquitectura/cerco-lista-de-permitidos*.ts` | «Declarar lo permitido» |
| Oráculos y goldens que fijan frases | 1.132 de 2.747 textos estáticos de 12+ caracteres †: citados literalmente en `test/`; 16 `.golden*`; `test/carta/*.oraculo.ts` | Hoy un texto «aprobado» se protege solo si alguien lo citó en una prueba |

### DISEÑADO (en documentos, sin código)
- Todo lo de Pedernal (`inventario-de-textos-en-codigo-diseno.md`, T1–T7; `plan-de-construccion-de-declaraciones.md`, D1–D14): en Motor2 no hay nada construido.
- El recuento E1 §5.2 deja explícito que algunos datos «no tienen regla de Pedernal» (nombres de rol, sucursal…): tema de nombres, no de rótulos.

### NO EXISTE (verificado con `grep` en `src/`)
- Un catálogo, diccionario o vocabulario de textos de interfaz: **0 entradas**. `textoDe`, `ClaveDeTexto`, `UsoDeTexto`, `FuenteDeTexto` no existen. (`vocabulario`/`diccionario` aparece en 4 archivos con otro sentido: `reportes/compras-registradas.ts`, `carta/incluye-en-carta.ts`, `datos/nombre-de-ficha.ts`, `catalogo/clases-de-producto.ts`.)
- Vocabulario por marca o por plan para los textos; idioma. Pedernal los tiene; acá no se piden (§6).
- Registro de datos con «consumidores» (`campos-con-dato` de Pedernal): en Motor2 el equivalente son las fichas de `test/arquitectura/guardas/` y `nombres-puntos-declarados.ts`; no hay `DATO`.
- Fuente por texto; «quién lo usa»; chequeo de texto sin uso, de consumidor no declarado, de mismo valor bajo dos claves, de texto a mano en JSX o en casos de uso.
- «Este producto está oculto.» (ejemplo del pedido): **no está en `main`**. Ocultar E3b/E3c1 (#305, #310) ya trae los 8 códigos internos que el dueño aprobó, pero la pantalla y sus frases todavía no.

## 2. Cifras (detalle en el inventario)

Medido con un script de solo lectura sobre `66e20d1a` (no se commitea): 5.697 apariciones †, 4.300 distintas †, 718 archivos; 2.347 en JSX (texto y atributos), 847 en `server/actions`, 1.484 en `core/`; 396 mensajes de error y 163 de éxito; 364 `fracaso(codigo, texto)` con 167 códigos, **46 códigos con más de una frase**; 668 valores repetidos (516 en más de un archivo, 236 entre capas); 5.612 sin fuente declarada † (85 tienen una cita cerca en el código).

## 3. Escalera de diseño, niveles 1 a 5

### Nivel 1. Propósito y alcance
- **Propósito (CONFIRMADA, frase del dueño):** que cada texto que ve una persona esté inventariado, exista una sola vez y signifique una sola cosa; y que Motor2 tenga primitivas e invariantes de texto como Pedernal.
- **Alcance (PROPUESTA):** textos que ve una persona en `src/` y `plataforma/src/`: rótulos, botones, encabezados, avisos, ayudas, y los mensajes que devuelven los casos de uso. **Fuera de alcance:** lo que la persona escribe (nombres: ya tienen su regla), lo que viene de la base, los textos de la carta pública del cliente (son datos del cliente), `scripts/`, pruebas, y cualquier cambio de redacción que nadie haya pedido.

### Nivel 2. Actores y contexto
| Actor | Qué hace con un texto |
|---|---|
| Dueño | Aprueba con sus palabras lo que cambia dinero, permisos, texto fiscal/legal, contradice una decisión suya o es una palabra de negocio nueva sin parecido aprobado (CONFIRMADA la delegación en dirección; su alcance, PROPUESTA) |
| Orquestador | Acepta o rechaza un lote (inventario) por delegación y lo asienta en una DEC |
| Sesión de código (Sonnet) | Escribe el catálogo y los chequeos; declara cada texto nuevo con `usos` y `fuente`; no acepta nada |
| Cliente final / personal | Lee el texto; no lo edita |
| CI | Hace cumplir las invariantes (alarma para errores honestos, no un límite de seguridad) |

### Nivel 3. Casos de uso
1. **Declarar un texto nuevo** (alta). 2. **Cambiar la redacción** de uno existente. 3. **Unir** dos o más en uno (reducir). 4. **Retirar** uno (borrado). 5. **Aceptar un lote** (inventario → DEC). 6. **Leer** un texto (`textoDe`). 7. **Medir** la deuda (script/cerco). Sus tablas «¿qué pasa si…?» están en §5.

### Nivel 4. Conceptos y ciclo de vida
- **Texto**: una entrada del catálogo (clave, valor por defecto, marcadores, usos, fuente). **Clave**: nombre estable de UNA cosa. **Marco y causa**: un texto puede componerse de un marco («No se pudo agregar la presentación: {causa}.») y una causa compartida.
- **Ciclo de vida de un texto:** `LITERAL` (hoy: escrito a mano, deuda) → `DECLARADO` (en el catálogo, fuente `HEREDADO` o una DEC) → `ACEPTADO` (fuente = DEC aceptada) → `UNIDO` (varias claves reducidas a una) → `RETIRADO` (sin usos: se borra la entrada). Una entrada nunca vuelve a `LITERAL`.
- **Lote**: conjunto de textos aceptados juntos con una sola DEC.

### Nivel 5. Invariantes y políticas

**Primitivas propuestas (PROPUESTA; forma de Pedernal, código propio).** Se declaran en `src/core/textos/` (carpeta nueva dentro de `core/`: pura, sin I/O; S-4):

| Primitiva | Qué es |
|---|---|
| `ClaveDeTexto` | Tipo cerrado (unión de literales): una clave inexistente **no compila**. Convención: `rechazo.<CODIGO>` (reutiliza el `codigo` público de `fracaso`, 167 hoy), `rotulo.<concepto>`, `accion.<verbo>`, `aviso.<tema>`, `ayuda.<campo>`, `titulo.<pantalla>` |
| `DefinicionDeTexto` | `porDefecto` (el literal de hoy, palabra por palabra), `marcadores?` (nombre y tipo de cada hueco: `texto`, `numero`, `dinero`, `entidad`), `usos`, `fuente`, `homonimoDe?` (clave + motivo, solo si el mismo valor se mantiene aparte a propósito) |
| `UsoDeTexto` | `{ archivo, nombre }`: función o constante exportada de ese archivo cuyo cuerpo cita la clave (S-1, igual que Pedernal). No hay `DATO` (no existe registro de datos, D4) |
| `FuenteDeTexto` | `{ decision: "DEC-nnnn" }` (existe en `docs/registro-de-decisiones.md` y está `ACEPTADA` o `CORREGIDA`) o `"HEREDADO"` (línea base que solo baja) |
| `textoDe(clave, valores?)` | Lee el texto; `valores` tipados por los marcadores (un hueco mal pasado no compila). Si algo falla en ejecución, devuelve el mensaje genérico cerrado y deja el error en los registros; nunca un texto vacío ni el código crudo |
| `Entidad` (marcador) | `{ nombre, genero }`: resuelve «el/la/un/una» (único modo de evitar «No se encontró el depósito» ≠ «la sucursal» al unir 69 frases) |
| Marco + causa (PROPUESTA, solo si un caso real lo pide: el de a2-1) | Un hueco `{causa}` se llena con otra clave del catálogo, un solo nivel (sin recursión: falla cerrado) |

**Invariantes (cada una con su chequeo, su violación inyectada y su costo).** Numeración propia `IT-n` para no pisar I1–I9 de `AGENTS.md`; `R-n` es la regla equivalente de Pedernal.

| Inv. | Dice | Chequeo (falla si…) | Violación inyectada | Costo |
|---|---|---|---|---|
| IT-1 | Un texto = **una sola cosa** | R5: mismo valor normalizado (minúsculas, sin tildes ni signos finales) bajo dos claves sin `homonimoDe` con motivo; el mismo valor en dos catálogos | Copiar «Cantidad» a otra clave | S |
| IT-2 | Una cosa = **un solo texto**; reutilizar antes de crear | R5 + el `codigo` de rechazo tiene UNA clave (`rechazo.<CODIGO>`): `fracaso(c, literal)` con literal falla | `fracaso("PRODUCTO_NO_ENCONTRADO", "No hay producto")` | M |
| IT-3 | **Ningún texto sin fuente** | R7: `fuente` ausente, DEC inexistente o no `ACEPTADA`/`CORREGIDA`; R8: `HEREDADO` fuera de su línea base (una lista que solo baja) | Texto nuevo sin `fuente`; marcar uno nuevo `HEREDADO` | M |
| IT-4 | **Ningún texto sin consumidor** y **ningún consumidor no declarado** | R1 (texto usado sin declarar), R2 (consumidor no declarado), R3 (texto sin consumidor), R4 (uso declarado que ya no existe) | Usar una clave desde un archivo nuevo; borrar el único uso; renombrar la función sin tocar `usos` | L (el analizador, ~500 líneas †; partible en R1–R4 y R5–R8) |
| IT-5 | **Ninguna palabra a mano** fuera del inventario | R6: texto JSX, atributos `aria-label`/`placeholder`/`title`/`alt`/`label` y el mensaje de `ok`/`error`/`exito`/`fracaso` con literal. Con trinquete por archivo (`cercos/trinquete.ts`), línea de base que solo baja y vencimiento (`cercos/vencimientos.ts`, 60 días) | `<button>Guardar</button>` en una pantalla | M |
| IT-6 | **Cerrado por defecto** | Clave inexistente no compila; marcador mal pasado no compila; sin texto en ejecución → mensaje genérico cerrado, no el código ni vacío; la validación declara lo PERMITIDO | Pedir `textoDe("rechazo.NO_EXISTE")`; quitar un marcador | S |
| IT-7 | **Lo aprobado con palabras del dueño no cambia en silencio** | R9: oráculo `test/textos/oraculo-de-textos-aprobados.ts` (clave → texto exacto, citado con DEC); cambiar el `porDefecto` de una entrada con DEC del dueño falla hasta avisar | Cambiar una coma de «Guardar y pasar a bruto» | S |
| IT-8 | Un cambio de texto **no pierde un hueco** | R10: los marcadores del texto = los declarados | Quitar `{importe}` del valor | S |

**Políticas.** (1) Un texto nuevo entra al catálogo, no al código: hasta T2 se entrega con su inventario (clave, texto, dónde se ve, quién lo usa, fuente, ¿cambia dinero/permisos/fiscal/decisión previa?). (2) Lo que el dueño no pidió no entra (`AGENTS.md`): el catálogo no suma textos, reduce y ordena. (3) Dinero, permisos, texto fiscal o legal: siempre AL DUEÑO. (4) Los textos con marcador `dinero` o `numero` se llenan con los formateadores centrales (`src/core/formato-de-numero.ts`, `moneda.ts`), nunca con una cuenta a mano (ya lo hacen cumplir `cerco-numero-sin-formato-central`). (5) Una DEC por lote aceptado: ya `ACEPTADA` no cuenta para el tope de 10 pendientes (`guardas/registro-de-decisiones.ts:124` cuenta solo `PENDIENTE_DE_OK`).

## 4. Plan de reducir y reutilizar

Orden: lo que no cambia lo que ve el cliente va primero. «Aprobado con palabras del dueño» = hay cita en el código o en los registros; **NO VERIFICADO** donde no la encontré.

| # | Familia | Texto actual (ejemplos medidos) | Texto único propuesto | Dónde (†) | ¿Cambia lo que ve? | ¿Aprobado por el dueño? | Decide |
|---|---|---|---|---|---|---|---|
| R-1 | Rótulos de pantalla repetidos | «Producto» 38×, «Cancelar» 29×, «Cantidad» 28×, «Nombre» 24×, «Acciones» 23×, «Guardar» 11× … (100 valores, inventario §5) | `rotulo.*` / `accion.*`, mismo valor | 33–25 archivos cada uno; pantallas y componentes | **No** | NO VERIFICADO (palabras que ya ve el cliente; sin cita) | Orquestador |
| R-2 | Constantes repetidas dentro de un archivo | «Encabezado y títulos» 11×, «Portada e identidad» 9×, «Colores generales» 8× (`src/core/carta/tema.ts`) | Una constante local o `titulo.*` | 1 archivo | **No** | NO VERIFICADO | Orquestador |
| R-3 | Mismo mensaje idéntico en varios casos de uso | «No se encontró el producto.» 33×, «No se encontró la promo.» 9×, «El nombre no puede estar vacío.» 9×, «Elegí un depósito» 8×, «No se encontró el depósito.» 7× | `rechazo.<CODIGO>` (una entrada por código) | `core/` y `server/actions` | **No** (idénticos) | NO VERIFICADO | Orquestador |
| R-4 | Mismo código, frases variantes | `PRODUCTO_NO_ENCONTRADO`: 5 frases («No se encontró el producto.» ×19, «…ese producto.», «El producto no existe.», «…ya no existe en el catálogo.», «No hay ningún producto para cambiar.») | `rechazo.PRODUCTO_NO_ENCONTRADO` = «No se encontró el producto.»; «ya no existe en el catálogo» se evalúa aparte (puede ser otra causa: borrado, no ausente) | 24 llamadas | **Sí**, en 4 de 5 | NO VERIFICADO | Orquestador (verificar que sea la misma causa) |
| R-5 | `NO_ENCONTRADO` por entidad | 69 frases «No se encontró {el/la/ese/esa} X.» | «No se encontró {el/la} {entidad}.» con `Entidad{nombre, genero}` | 174 apariciones | **Sí** (ese/esa → el/la; las que traen una cola «recargá la pantalla» quedan aparte) | NO VERIFICADO | Orquestador |
| R-6 | Nombre repetido | `NOMBRE_REPETIDO`: 16 frases; mezcla comillas « » y " " para lo mismo; unas con «Elegí otro nombre.» y otras sin él; unas aclaran «no distingue mayúsculas» | «Ya existe {un/una} {entidad} llamado «{nombre}». Elegí otro nombre.»; la aclaración de mayúsculas queda como marco aparte | 16 llamadas | **Sí** (comillas, cola) | NO VERIFICADO | Orquestador |
| R-7 | Versión desactualizada | `VERSION_DESACTUALIZADA`: 8 frases («Otra persona cambió «X» mientras la editabas. Recargá…», «…mientras lo mirabas», «…otra persona la guardó antes») | «Otra persona cambió {objeto} mientras lo editabas. Recargá la pantalla y volvé a intentar.» | 8 llamadas | **Sí**, leve | NO VERIFICADO | Orquestador |
| R-8 | Precio desactualizado | `PRECIO_DESACTUALIZADO`: 6 frases; algunas **muestran el precio vigente** | Un marco, con o sin `{precioActual}` (`dinero`) | 6 llamadas | **Sí**; el texto habla de dinero | NO VERIFICADO | **AL DUEÑO** |
| R-9 | «Revisá tu conexión» | 11 frases del tipo «No se pudo {leer/agregar/consultar} …. Revisá tu conexión; si venís trabajando ha…» | Marco «No se pudo {accion}.» + causa compartida | 11 llamadas | **Sí**, leve | NO VERIFICADO | Orquestador |
| R-10 | Falta de permiso suelta | 14 frases «No tenés permiso/acceso…»; varias ya salen de `textoDeDenegacion` (`motivos.ts:21`); las otras (alícuota de IVA, corregir una venta, historial de conteos…) nombran el permiso que falta | Paso 1: que pasen por `textoDeDenegacion` con las MISMAS palabras (no cambia). Cualquier reescritura: no | `core/permisos`, acciones | Paso 1 **no**; después sí | Las de `motivos.ts` son «de siempre, palabra por palabra» (cabecera) | **AL DUEÑO** si se reescribe (habla de permisos) |
| R-11 | a2-1, dos frases de una causa | «No se pudo agregar la presentación: ya hay más de una en esa unidad.» (`agregar-presentacion-alternativa.ts:59`, código `PRESENTACION_AMBIGUA`) y «No se puede registrar la compra de "X": hay más de una presentación activa en esa unidad.» (`armar-linea-de-movimiento.ts:113`, **sin código**) | Causa `rechazo.PRESENTACION_AMBIGUA` = «hay más de una presentación activa en esa unidad»; dos marcos: «No se pudo agregar la presentación: {causa}.» y «No se puede registrar la compra de «{producto}»: {causa}.» | 2 archivos; ninguna prueba cita estos textos (`grep` en `test/`) | **Sí**: la primera gana «activa» | Aceptadas por el orquestador por delegación (2026-11-16, palabras «presentación» y «unidad» ya aprobadas) **con la condición** de evaluar unirlas | Orquestador (ya condicionó; PROPUESTA: sí, unir en T1; avisar) |
| R-12 | «Este producto está oculto.» y vecinos | No existe como frase en `main`. Hay 4 textos de Ocultar («Oculto · decisión tuya», «Ocultos, sin sección», «Está en la carta pero oculto», «Producto "X" {}: oculto») y los 8 códigos internos aprobados por el dueño | Entran al catálogo cuando existan, con `fuente` = la DEC | Sesión Ocultar | n/a hoy | **Sí**, 8 códigos («topdo eso tiene mi ok», 2026-11-16, chat con el orquestador) | No se tocan sin avisar; **AL DUEÑO** si cambian |
| R-13 | Textos aprobados con palabras del dueño | E1: «Esta acción no está permitida» (`nombre-de-ficha.ts:22`), mensajes de CUIT; textos de costos T1–T8 (14/11); merma sobre bruto T-M1–T-M4 (15/11) | Entran con `fuente` DEC y al oráculo IT-7 | varios | **No** | **Sí** | **AL DUEÑO** ante cualquier cambio |
| R-14 | Texto fiscal, legal o de dinero | CUIT, IVA, comprobante, importes | No se reducen sin cita | varios | — | — | **AL DUEÑO** siempre |

**Reglas de lectura.** Un valor repetido no prueba que sea la misma cosa («Estado» de una empresa ≠ «Estado» de una operación; «Fecha»). Antes de unir, se mira qué dice cada uso; si son cosas distintas se queda cada una con su clave y la segunda lleva `homonimoDe` con motivo. La cota de lo que desaparece si se unen TODOS los repetidos es 1.397 entradas †, pero el tramo real son decenas de familias, no 668 uniones.

## 5. ¿Qué pasa si…? (por comando)

Los textos viven en archivos versionados; no hay base de datos, así que «concurrencia» es entre sesiones y PR.

| ¿Qué pasa si…? | Alta de un texto | Cambio de redacción | Unión de dos o más | Retiro |
|---|---|---|---|---|
| **Repetición** (se hace dos veces) | Dos entradas con el mismo valor: IT-1 falla hasta poner `homonimoDe` o unir | El mismo cambio dos veces es idempotente (mismo `porDefecto`) | Unir algo ya unido: R4/R5 no encuentran qué unir, sin efecto | Retirar lo ya retirado: no hay nada que retirar |
| **Concurrencia** (dos sesiones) | Misma clave en dos ramas: conflicto de fusión visible; la clave duplicada la rechaza el tipo | Dos redacciones distintas: conflicto de fusión; si el texto tiene DEC, IT-7 falla hasta decidir quién gana | Una sesión usa una clave que la otra une: R1/R4 fallan al fusionar | Una retira y otra empieza a usar: R1 falla |
| **Tiempo** | Un texto con `HEREDADO` vence con su línea de base (60 días, `vencimientos.ts`); una DEC `PENDIENTE_DE_OK` ≥14 días sube primero en el resumen (I6) | Un cambio de un texto aprobado no vence: espera cita | La unión pendiente no vence sola: la deuda sí | El retiro se hace en el tramo de su pantalla |
| **Incertidumbre** (no sé si está aprobado) | `fuente` ausente o «SIN VERIFICAR» **no entra** (cierra) | Se trata como no aprobado: pasa por el filtro del orquestador | No se unen dos textos si uno es del dueño y no hay aviso | No se retira un texto del dueño sin aviso |
| **Reintento** | Re-correr el script de línea base da el mismo resultado | Reintentar no duplica | Un PR reintentado no vuelve a unir | Idem |
| **Error parcial** | Entrada sin `usos`: R3 falla; sin `fuente`: R7 falla | Cambió la entrada y no el oráculo: IT-7 falla | Se une la clave pero queda un uso viejo: R4 falla (no compila: la clave vieja ya no existe) | Se borra la entrada y queda un uso: no compila |
| **Datos faltantes** | Sin marcador declarado: IT-8 falla | Se quita un hueco: IT-8 falla | Marcadores que no coinciden: falla | — |
| **Cambio de permisos** (quién puede aceptar) | Solo el orquestador por delegación o el dueño; la sesión no (I1) | Si habla de dinero, permisos o fiscal: solo el dueño | Idem | Idem |

**Lectura en ejecución (`textoDe`).** Repetición/concurrencia no aplican (puro y sin estado). Faltante de marcador en ejecución: lo atrapa el tipo; lo que el tipo no ve (un `any`) devuelve el mensaje genérico cerrado y se registra, no rompe la pantalla.

## 6. Combinaciones

Dimensiones que HOY cambian lo que ve el cliente (y por lo tanto entran al oráculo): (a) **puesto** (mesa N o mostrador; `frasesDePuesto`, ya con su guardián); (b) **propósito de acceso** × **caso de denegación** (`editar`/`ver` × 7 casos de `Denegacion`, `motivos.ts:11`); (c) **género y número de la entidad** (nueva, nace con R-5/R-6/R-7; sin ella «el/la/un/una» se rompe); (d) **módulo activo / en desarrollo** (`MODULO_NO_ACTIVO`).

**NO existen y no se piden (no entran):** marca de empresa, idioma, plan. En Pedernal hay un reemplazo por marca (`diccionario`); en Motor2 los textos no dependen de la marca (la marca solo cambia colores y el nombre público de la carta). Si el dueño los quiere, es otra decisión.

**Oráculo aparte del código (propuesta), `test/textos/oraculo-de-textos.ts`**, ejemplo del eje (c) escrito a mano:

| `entidad` | género | `rechazo.NO_ENCONTRADO` | `rechazo.NOMBRE_REPETIDO` |
|---|---|---|---|
| producto | m | No se encontró el producto. | Ya existe un producto llamado «X». Elegí otro nombre. |
| depósito | m | No se encontró el depósito. | Ya existe un depósito llamado «X». Elegí otro nombre. |
| sección de carta | f | No se encontró la sección de carta. | Ya existe una sección de carta llamada «X». Elegí otro nombre. |
| promo | f | No se encontró la promo. | (no aplica hoy) |

Guardián: falla si aparece una entidad, un tipo de marcador o un eje nuevo (una opción en el marco, una clase de clave) sin declarar si cambia lo que se ve. Recorrido exhaustivo (pocas combinaciones). Mismo estilo que `texto-de-catalogo-declarado.test.ts`.

## 7. Niveles 6 a 10 (esbozo; se completan en el tramo que los necesite)

- **6. Historia y persistencia:** el catálogo es código en el repo; la historia es el historial de git más la DEC de cada lote (que solo agrega, no se borra). Sin tablas ni migración. Sin migraciones aditivas necesarias.
- **7. Atomicidad y concurrencia:** un lote = un PR; una unión se hace de punta a punta en un solo PR (clave nueva, usos migrados, clave vieja fuera). Dos sesiones sobre el mismo archivo: conflicto de fusión, no estado a medias.
- **8. Acceso e interfaces:** `textoDe` en `src/core/textos/` (pura; `server`, `ui` y `app` pueden importarla). Sin pantalla nueva. La edición del catálogo no es una función del producto (no hay edición desde la pantalla ni por empresa).
- **9. Consultas y experiencia:** el cliente ve lo mismo salvo en las uniones marcadas «Sí» de §4. Informe de deuda: el script de medición (se regenera en cada tramo) y el JSON de la línea de base.
- **10. Pruebas, migración y operación:** una prueba por invariante con su violación inyectada (estilo `campos-con-dato-evasiones` de Pedernal y `cerco-lista-de-permitidos-evasiones.test.ts`); oráculo de §6; golden de textos aprobados (IT-7). Migración: ninguna de datos. Compuerta de arquitectura: `npm run arquitectura`, `analizar:muerto`, tests; cada cerco nuevo se agrega a `vencimientos.ts` y a `linea-de-base/`.

## 8. Tramos de construcción

Tamaños: S ≤ 150 líneas, M ≤ 400 (un PR), L = dos PR. Estimación del ingeniero †. Orden: T1 → T2 → T3 → T5 → T4 → T6; T7 recurrente.

| Tramo | Qué | Tamaño | Costo en cambios para el cliente | Archivos calientes / choques |
|---|---|---|---|---|
| **T1 (el más barato)** | `src/core/textos/` con `tipos.ts`, `texto-de.ts` (`textoDe`) y UNA entrada real: `rechazo.PRESENTACION_AMBIGUA` con sus dos marcos (R-11); guardián IT-1/IT-3/IT-6/IT-8 **solo sobre el catálogo** (R3 y R7 sobre sus propias entradas); la DEC del lote. Reemplaza los dos literales de a2-1 | M | **Sí, pequeño**: la frase de «agregar presentación» gana «activa» (avisar) | `agregar-presentacion-alternativa.ts:59` y `armar-linea-de-movimiento.ts:113` (Presentaciones). **No bloquea a nadie**: nadie más usa el catálogo todavía |
| T2 | Medición de lo existente: cerco `textos-a-mano` (trinquete, R6) en JSX y mensajes de casos de uso, con la línea de base de HOY y vencimiento; **con aviso de una semana**, porque desde ahí un texto nuevo a mano en un archivo hace subir la cuenta y falla (los textos nuevos van al catálogo) | M | No | `test/arquitectura/cercos/vencimientos.ts` y `linea-de-base/` (todas las sesiones que agregan un cerco); **Ocultar, Parte, Nombre de cocina y Presentaciones agregan texto en `server/actions` y pantallas: les rompe** si no avisan |
| T3 | R1–R4: analizador de uso (qué consume qué) y sus evasiones; `usos` obligatorios para toda entrada fuera de la línea base | L | No | `src/core/textos/` (nuevo), `test/arquitectura/` (nuevo) |
| T5 | R7 y R8: fuente verificable (`ACEPTADA`/`CORREGIDA` en `docs/registro-de-decisiones.md`), línea base `textos-heredados` que solo baja, oráculo IT-7 | S–M | No | `registro-de-decisiones` (solo se lee) |
| T4 | Reducir por familias, un PR por familia (R-1 a R-10), primero las que no cambian nada (R-1, R-2, R-3) | M por familia | Según §4 | `server/actions/**/casos-de-uso/*.ts` (todas las sesiones), `core/carta/tema.ts`, `core/permisos/motivos.ts` (**no se toca**; se redirigen los sueltos hacia él) |
| T6 | Texto literal de `AGENTS.md` (§3, política 1) y plantilla de inventario que entregan las sesiones | S | No | `AGENTS.md`, `docs/pull_request_template.md` |
| T7 | Saldar la deuda por módulo dentro del tramo de cada pantalla: pasar los literales al catálogo | recurrente | No | Cada pantalla |

**Qué choca con otras sesiones.** Ocultar (ya trae 8 códigos y 4 textos), Parte (agrega permisos `partes_*` con descripción en `acciones.ts`), Nombre de cocina, Presentaciones (a2-1; sus dos frases son T1): todas agregan literales. Mientras no corra T2, nada las rompe. Cuando corra T2, un texto nuevo va al catálogo, con su inventario.

## 9. Diferencias con Pedernal (declaradas, con motivo)

| # | Diferencia | Motivo |
|---|---|---|
| D1 | La función se llama `textoDe`, no `texto(diccionario, clave)`; no hay `diccionario` | `texto(v)` ya existe en `src/core/texto.ts` con otro sentido, y el reemplazo por marca de Pedernal no existe en Motor2 y no se pidió. Costo de cambiar: bajo |
| D2 | El estado de una DEC aceptada se llama `ACEPTADA`; Pedernal usa `CONFIRMADA` | Es el que define `guardas/registro-de-decisiones.ts:19`. R7 acepta `ACEPTADA` y `CORREGIDA` |
| D3 | El registro de decisiones es Markdown (`docs/registro-de-decisiones.md`, 11 entradas), no `arquitectura/decisiones/registro/DEC-*.json` (195 en Pedernal) | Es lo que hay; el chequeo reutiliza `parsearRegistro` |
| D4 | No hay `UsoDeTexto` de tipo `DATO` | Motor2 no tiene registro de datos con consumidores; el equivalente (texto en tablas como `acciones.ts`) se declara como `{archivo, nombre}` de la constante |
| D5 | R6 (texto a mano) también cubre los mensajes de los casos de uso | En Motor2 hay 847 apariciones en `server/actions`; Pedernal lo documenta solo para `apps/*`. NO VERIFICADO si Pedernal cubre los mensajes del servidor |
| D6 | El punto de partida es 0 claves y ~5.700 literales; la línea base es una cuenta por archivo (trinquete), no una lista de claves `HEREDADO` | Motor2 no tiene catálogo previo |
| D7 | Código de rechazo = clave (`rechazo.<CODIGO>`) | Motor2 ya tiene códigos públicos estables en `fracaso`; no hace falta inventar otro nombre |

## 10. Supuestos, pregunta, hallazgos y verificación

**Supuestos (costo de revertir).** S-1: los usos se declaran por archivo + nombre de función o constante (bajo). S-2: un valor repetido falla salvo `homonimoDe` con motivo (bajo). S-3: un lote = una DEC ya `ACEPTADA` (ver pregunta; bajo). S-4: la carpeta es `src/core/textos/` (renombrar: bajo; verificar `dependency-cruiser` en T1). S-5: la clave de rechazo es el código existente (bajo). S-6: la composición tiene un solo nivel (bajo).

**Pregunta pendiente (UNA, para el orquestador).** `AGENTS.md` I1 exige que toda aceptación sea del dueño, con cita literal. Un lote aceptado por delegación se cita con la frase del 2026-11-16 («Los textos encargarte vos…») y el alcance de esa delegación todavía figura como PROPUESTA. ¿Esa cita alcanza como `Cita del dueño` de la DEC del lote, o cada lote necesita una cita nueva del dueño? Mientras no se resuelva, ningún lote se asienta como `ACEPTADA`: T1 solo se puede cerrar con una DEC cuya cita sea válida. Estado: PENDIENTE.

**Hallazgos aparte (no se tocaron).**
1. `fracaso("TIENE_EXISTENCIA", "TIENE_EXISTENCIA")` (`ocultar-producto.ts:80,134`): el mensaje es el código crudo; NO VERIFICADO si la pantalla lo traduce (E3b no trae pantalla).
2. `armar-linea-de-movimiento.ts:113` devuelve `{ ok: false, mensaje }` sin código, así que esa causa no se distingue por código en las pruebas.
3. `NOMBRE_REPETIDO` mezcla comillas « » y " " para lo mismo (16 frases).
4. `pieDeLaCartaImpresa` (`texto-de-la-carta.ts:51`) fija «Precios vigentes al …» y es-AR en el código.
5. Las 131 `descripcion:` de `acciones.ts` se leen como texto de permisos: cualquier cambio es AL DUEÑO.
6. El nombre «texto de catálogo» (nombres) y el diseño nuevo comparten palabra: conviene llamarlo «catálogo de textos de interfaz» o «frases» en los documentos para no confundir.

**Qué verifiqué.** Código de `66e20d1a` (leído, con `file:línea` arriba): `texto-de-catalogo.ts`, `fichas-de-texto.ts`, `texto.ts`, `mensaje-seguro.ts`, `texto-de-la-carta.ts`, `motivos.ts`, `resultado-caso.ts`, `tipos.ts`, `trinquete.ts`, `vencimientos.ts`, `registro-de-decisiones.ts` (guardián), los dos archivos de a2-1; `test/` (búsqueda de las dos frases de a2-1: sin citas). Referencias de Pedernal: los dos documentos nombrados; los números de Pedernal (886 claves, 195 DEC) son los que ese documento dice, no los recalculé. Cifras: script de solo lectura (no commiteado), aproximadas †. **No verifiqué:** cuántos textos del inventario son del dueño con sus palabras (no hay marca legible: «SIN VERIFICAR»); `dependency-cruiser` para la carpeta nueva; el tamaño real del analizador; si Pedernal cubre los mensajes del servidor (D5). No corrí `tsc`, lint ni pruebas: solo documentos.
