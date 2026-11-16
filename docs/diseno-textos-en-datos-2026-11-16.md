# Diseño: los textos que viven en DATOS y los mensajes que llegan por variable (solo diseño en papel)

Fecha: 2026-11-16. Sesión de código (Sonnet), rama `diseno-textos-en-datos-2026-11-16`, base `main` `78377aab`. **No toca `src/`, `test/`, `prisma/` ni ningún texto visible.** Continúa `docs/diseno-textos-en-codigo-2026-11-16.md` (T1 a T7; en `main` están T1 y el catálogo; T2 espera turno) y `docs/inventario-de-textos-motor2-2026-11-16.md`.

**Pedido y necesidad (CONFIRMADA).** Dueño, 2026-11-16: «Los textos encargarte vos trata de reducir, textos, inventariar y empezar a reutilizar y que representen 1 sola cosa, definir primitivas e invariantes en texto igual que pedernal» (`motor2-docs`, `seguimiento-de-pedernal/decisiones-del-dueno-2026-11-14-mesa-resend-contador.md`, sección «Textos: el orquestador se encarga…»); límites de la delegación: «Sí, confirmo esos límites (Recomendada)» (misma fuente). Orden del mismo día, relatada por el orquestador: «No dejes nada pendiente de lo que se puede trabajar en paralelo». Lo que cambia dinero, permisos, texto fiscal o legal, o contradice una decisión del dueño NO es delegable: va **AL DUEÑO**.

Estados: CONFIRMADA (lo dijo el dueño), PROPUESTA (mía, la corrige quien decide), PENDIENTE, NO VERIFICADO. **†** = aproximado.

## 0. En lenguaje de proceso

1. El cerco T2 y el catálogo T1 solo ven el texto que está **dentro del JSX** y **dentro del mensaje de `fracaso`/`error`/`exito`/`ok`**. Una parte grande del texto del sistema vive en otro lado: **tablas de datos** (la descripción de cada permiso, el menú, los módulos, los rótulos de formularios y de columnas de reportes, el tema de la carta) y **constantes** (`MENSAJE_…`) que después se pasan por una variable. Hoy eso son unos 860 rótulos † y unos 240 textos en constantes †, más 535 mensajes que llegan por variable †, **sin dueño, sin fuente y sin lista de quién los usa**.
2. Se propone **la misma forma del catálogo T1**, extendida a esos lugares: una entrada por texto, que el dato **pide** al catálogo (`etiqueta: textoDe("columna.producto")`) en vez de escribirlo; y un cerco hermano de T2 (**T8**) que cuenta los textos escritos a mano en datos y constantes, con su línea de base que solo baja.
3. **Reducir** es por familias (§4). Lo más barato primero: los rechazos idénticos con el mismo código (no cambian lo que ve el cliente) y los encabezados neutros de columnas (idénticos). Lo que habla de **permisos, dinero, texto fiscal** o del **tema aprobado de la carta** no se toca sin el dueño.
4. No suma ninguna función: ordena y reduce lo que ya existe.

## 1. Qué cosa es qué (verificado contra el código de `78377aab`)

### YA EXISTE
| Qué | Dónde |
|---|---|
| Catálogo cerrado `CATALOGO`, `textoDe`, guardián C1 a C5, DEC-0013 | `src/core/textos/`, `test/arquitectura/catalogo-de-textos.test.ts` (T1, #316) |
| Texto en un lugar por tema (motivo tipado → frase) | `core/permisos/motivos.ts`, `core/pos/puesto.ts`, `core/carta/texto-de-la-carta.ts` |
| Texto-como-dato en tablas | `core/permisos/acciones.ts` (`descripcion:`), `core/navegacion/estructura.ts` (`GRUPOS_NAV`), `core/modulos/catalogo.ts`, `core/*/ui-config.ts`, `core/carta/tema.ts`, `core/movimientos/motivos-semilla.ts` |
| Constantes `MENSAJE_*` por guard y por caso de uso | `core/features/**/*.guard.ts`, `core/movimientos/*`, `core/permisos/*`, `server/actions/**` (ver §2) |

### DISEÑADO (en documentos, sin código)
El cerco T2 (`textos-a-mano`, rama `textos-t2-cerco`, retenido: entra último). La extensión a datos y constantes de este documento.

### NO EXISTE
Ningún dato con texto pide su texto al catálogo; ningún cerco cuenta el texto de propiedades de objeto ni de constantes; los `usos` de un texto que vive en una tabla (`UsoDeTexto` con el nombre de la constante: D4 del diseño de T1) todavía no se declararon.

## 2. Inventario (script de solo lectura sobre `78377aab`, no se commitea; cifras aproximadas †)

**Propiedades de objeto con texto** (claves `etiqueta`, `descripcion`, `mensaje`, `label`, `texto`, `motivo`, `nombre`, `titulo`, `ayuda`, `encabezado`, `rotulo`, `detalle`, `aviso`; valor literal de 6+ caracteres con letras): **862**.
| Clave | Cuántas | Clave | Cuántas |
|---|---|---|---|
| `etiqueta` | 304 | `descripcion` | 145 |
| `mensaje` | 129 | `label` | 73 |
| `texto` | 51 | `motivo` | 48 |
| `nombre` | 45 | `titulo` | 18 |
| `ayuda` | 17 | `encabezado` | 14 |
| `rotulo` | 11 | `detalle` | 5 |

**Los archivos con más** (cada uno es una familia): `core/permisos/acciones.ts` 133 (descripción de cada permiso), `core/carta/tema.ts` 72, `core/navegacion/estructura.ts` 46, `app/(app)/reportes/periodo/tabla-periodo.tsx` 40, `core/carta/portal.ts` 27, `components/carta/carta-ejemplo.ts` 24, `plataforma/src/servidor/ciclo-de-vida.ts` 18 (consola), `core/carta/ui-config.ts` 15, `core/catalogo/espacio-del-producto.ts` 14, `core/compras/carga-por-pasos.ts` 13, y 8 `tabla-*.tsx` de reportes con 7 a 12 cada una.

**Constantes con texto** (nombre en MAYÚSCULAS, valor con letras): **240**; unas **95 son `MENSAJE_*`** (guards, invariantes de gestión de usuarios, limitadores, casos de uso).

**Mensajes que llegan por variable** (`fracaso(c, X)`, `error(X)`, `exito(X, …)`, `ok(X)` con `X` que no es un literal): **535** (306 propiedad como `comando.mensaje` 104, `base.mensaje` 28, `r.mensaje` 18; 199 identificador, de los cuales `MENSAJE_CONFLICTO_IDEMPOTENCIA` 25 veces, `mensaje` 30; 30 llamada). **Se resuelven en su origen**: el literal está en un guard (`core/features/**/*.guard.ts`) o en una constante, no en el caso de uso.

**Repetidos** (propiedades más constantes): **71 valores distintos que se repiten, 223 apariciones** †. Los más fuertes: «Producto» 21, «Cantidad» 10, «Importe» 8, «Sección» 8, «Proveedor» 6, «Estado» 5, «Insumo» 5, «La empresa no existe.» 7, «No se encontró esa invitación pendiente.» 4. Entre los **mensajes de `fracaso`/`error` con literal directo**: 255 apariciones, 174 distintas †, 35 repetidas (116 apariciones), 21 códigos de 103 con más de una frase.

## 3. Primitivas e invariantes (extienden las de T1; PROPUESTA)

**Primitivas nuevas.** (a) Clases de clave `columna.<tema>` (encabezado de tabla), `menu.<tema>` (rótulo de navegación), `campo.<tema>` (rótulo de formulario): el tipo `ClaveDeTexto` sigue cerrado, la clase se declara en el guardián. (b) El **uso de un texto en datos** es `{ archivo, nombre }` con el nombre de la constante o de la tabla (ya previsto: D4 de T1). (c) **Un dato con texto no lo escribe: lo pide**: `etiqueta: textoDe("columna.producto")`. `textoDe` es puro y sin imports, así que llamarlo al cargar un módulo no crea ciclos de importación (**NO VERIFICADO** para `core/` entero: se comprueba con `npm run arquitectura` en el primer lote).

**Invariantes (numeración propia `IT-n`; las de T1 son IT-1 a IT-8).**
| Inv. | Dice | Chequeo (falla si…) | Violación inyectada | Costo |
|---|---|---|---|---|
| IT-9 | Ninguna palabra a mano **en datos**: una propiedad de texto de un objeto (claves de §2) no lleva un literal | cerco **T8**, trinquete por archivo (como T2), línea de base `textos-en-datos` que solo baja, con vencimiento | agregar `etiqueta: "Producto"` a una tabla | M |
| IT-10 | Ninguna palabra a mano **en constantes**: una constante `MENSAJE_*` con literal se cuenta como deuda; cuando sale de `textoDe(...)`, la variable que la usa ya no es deuda | cerco T8, tipo `constante-texto` | `const MENSAJE_X = "No se pudo."` en un guard nuevo | S (mismo cerco) |
| IT-11 | Un mensaje por variable viene de UNA constante o de un guard con su clave (**no se rastrea la variable**: se cierra el origen) | límite declarado: T8 no sigue la variable; cuenta el literal donde nace | — | — |

**Combinaciones (regla del 2026-10-28).** Las dimensiones nuevas que cambiarían lo que se ve: **ninguna**. «Producto», «Cantidad», etc. son rótulos únicos; las dimensiones de T1 (género y número de la entidad para los `No se encontró…`) siguen y se declaran en el oráculo de T1 antes de unir esa familia. «Estado», «Fecha» y «Detalle» **no se unen sin mirar** qué dice cada uso (IT-1: un valor repetido no prueba que sea la misma cosa; la segunda lleva `homonimoDe` con motivo).

## 4. Familias, qué es reutilizable y quién decide

«Aprobado con palabras del dueño» = hay cita en el código o en los registros; **NO VERIFICADO** donde no la encontré.
| # | Familia | Cuántos † | Una sola cosa propuesta | ¿Cambia lo que ve? | Decide |
|---|---|---|---|---|---|
| D-1 | Descripción de cada permiso (`acciones.ts`) | 133 | — | Cualquier cambio sí | **AL DUEÑO** (permisos) |
| D-2 | Mensajes de gestión de usuarios, invariantes, matriz, política, decisión de acceso (`core/permisos`) | ~25 | — | Sí | **AL DUEÑO** (permisos) |
| D-3 | Tema, portal, validaciones y ejemplo de la carta (`core/carta`, `components/carta`) | ~150 | — | Sí | **AL DUEÑO** (tema aprobado con maquetas); y es un frente activo |
| D-4 | Rótulos monetarios de reportes («Importe», «Cobrado», «Margen real (cobrado)», «Costo unitario», «Food cost %») | ~15 | `columna.<tema>` | No (idénticos) | **AL DUEÑO** (dinero) |
| D-5 | Encabezados NEUTROS de columnas («Producto», «Cantidad», «Sección», «Proveedor», «Estado», «Insumo», «Sucursal», «Detalle», «Origen», «Categoría», «Período», «Resumen», «Unidades») | ~85 | `columna.<tema>` (idénticos; si dos usos dicen cosas distintas, `homonimoDe`) | **No** | Orquestador |
| D-6 | Rechazos «No se encontró …» idénticos y con el mismo código (R-3 del diseño de T1) | ~25 en archivos sin otro frente | `rechazo.<CODIGO>` | **No** (idénticos) | Orquestador |
| D-7 | Constantes `MENSAJE_*` duplicadas de un mismo texto («No se encontró esa factura de proveedor.» ×3, «El producto no existe.» ×3, «No se encontró el producto.» ×2) | ~10 | `rechazo.<CODIGO>` | **No** | Orquestador (los archivos de compras y producto esperan: frentes) |
| D-8 | Menú y módulos (`estructura.ts`, `modulos/catalogo.ts`, `ui-config.ts`) | ~70 | `menu.<tema>` | No | Orquestador; **AL DUEÑO** si son palabras de negocio sin parecido aprobado (planes y módulos son un frente) |
| D-9 | Consola de plataforma (`plataforma/src/servidor/*`) | ~35 | — | — | Fuera: frente de planes y plataforma |
| D-10 | Variantes de un mismo rechazo (`NO_ENCONTRADO` con «ese/esa/el/la», `NOMBRE_REPETIDO` con comillas) (R-4 a R-9 de T1) | ~100 | marcos con `Entidad` | **Sí** | Orquestador; si habla de precio o permiso, **AL DUEÑO** |

**Qué es reutilizable.** D-5 y D-6 son lo más barato: el valor ya es idéntico, la reducción no cambia nada para el cliente y se puede revertir con un `git revert`. D-7 también, pero sus archivos los tocan otros frentes. D-10 cambia el texto (una palabra) y necesita el oráculo de combinaciones de T1.

## 5. ¿Qué pasa si…? (por comando)

Heredan la tabla de §5 de T1 (alta, cambio de redacción, unión, retiro); este tramo solo agrega lo propio de los datos.
| ¿Qué pasa si… | En datos y constantes |
|---|---|
| **Repetición** | Pasar un literal al catálogo dos veces da la misma clave; el guardián C2 falla si el mismo valor queda bajo dos claves sin `homonimoDe` |
| **Concurrencia** (dos sesiones) | Dos sesiones migran el mismo archivo: conflicto de fusión visible (un archivo = un lote); el frente que lo toca primero gana, el otro rehace |
| **Tiempo** | La línea de base de T8 vence a los 60 días con su aprobación (`cercos/vencimientos.ts`) |
| **Incertidumbre** (¿es la misma cosa?) | Se deja cada una con su clave y `homonimoDe` con motivo; nunca se une por parecido |
| **Reintento / error parcial** | Se migra por archivo completo (clave nueva, usos, literal fuera, línea de base bajada) en un solo PR; una prueba que cita la frase vieja se adapta y se declara |
| **Datos faltantes** | `textoDe` falla cerrado: mensaje genérico y registro; no se muestra un texto vacío ni el código |
| **Cambio de permisos** | Quien acepta un lote: el orquestador dentro de los límites; D-1, D-2 y D-4 siempre el dueño |
| **Pruebas que fijan frases** | Hoy unas 1.100 frases estáticas † están citadas en pruebas: un lote que las toca las adapta en el mismo PR y lo declara |

## 6. Tramos

| Tramo | Qué | Tamaño † | Cliente | Choques |
|---|---|---|---|---|
| T8 | Cerco hermano de T2: cuenta propiedades de texto (§2) y constantes `MENSAJE_*` con literal, por archivo; línea de base `textos-en-datos` con vencimiento. Solo `test/` | M | No | `cercos/vencimientos.ts`, `linea-de-base/`; **entra después de T2** (dos cercos juntos duplican el aviso a las demás sesiones) |
| T9-a | D-6: rechazos «No se encontró …» idénticos con el mismo código (una DEC por lote) | S–M por lote | No | `server/actions/**/casos-de-uso/*.ts` solo de archivos sin otro frente |
| T9-b | D-5: encabezados neutros de columnas de reportes | M | No | `app/(app)/reportes/**/tabla-*.tsx` |
| T9-c | D-7, D-8, D-10 | según lote | Según §4 | Frentes de compras, catálogo, planes |

## 7. Diferencias con Pedernal

No releí Pedernal para este tramo (**NO VERIFICADO**: ni sus mensajes de servidor ni su tratamiento de texto en datos). Se copia la forma del diseño de T1 (D1 a D7 de su §9). Si Pedernal resuelve los textos en datos de otra manera, se declara acá antes del primer lote.

## 8. Supuestos, preguntas y verificación

**Supuestos (costo de revertir).** S-1: las claves nuevas son `columna.`, `menu.` y `campo.` (bajo: renombrar). S-2: «Estado», «Fecha», «Detalle» se miran uno por uno (bajo). S-3: los textos de la consola de plataforma quedan fuera (frente propio). S-4: los 1.100 textos citados en pruebas se adaptan en el mismo lote (bajo).

**Preguntas al dueño** (solo si el orquestador quiere avanzar con esas familias; no bloquean D-5 ni D-6): (1) ¿las descripciones de permisos (D-1) y los mensajes de gestión de usuarios (D-2) entran al catálogo con las mismas palabras, sin reescribir? (2) ¿los rótulos monetarios de reportes (D-4) pueden unirse con las mismas palabras? (3) ¿el tema de la carta (D-3) queda afuera hasta que termine el frente de carta?

**Qué verifiqué.** Cifras: scripts de solo lectura con el AST de TypeScript sobre `78377aab` (no se commitean; †). Archivos «de otros frentes»: la unión de lo que tocan las ramas remotas con commits de los últimos tres días contra `origin/main` (`git diff --name-only origin/main...rama`, conservadora: incluye ramas ya fusionadas), más las carpetas de los frentes nombrados por el orquestador. **No verifiqué:** el tamaño real de T8 ni de cada lote; Pedernal (§7); que `textoDe` en constantes de `core/` no cree ciclos (se prueba en el primer lote); cuántas frases de §5 están en goldens.
