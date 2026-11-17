# Diseño: ficha por pantalla, texto permitido, axe y conteo de palabras (regla P9 de pantallas; solo diseño, nada se construye)

Fecha: 2026-11-17. Frente 8 «Visual». Pedido: orquestador general (P9, «una regla sin chequeo no vale»). Solo documento: no toca código, pruebas ni textos. Estados: CONFIRMADA (lo dijo el dueño, con cita), PROPUESTA (mía, la corrige quien decide), PENDIENTE, NO VERIFICADO.

**Necesidad (CONFIRMADA).** Dueño, 2026-11-17 (mandato al Frente 8 y mensaje del orquestador): «en Pedernal veo pocas palabras bien elegidas, en Motor 2 veo párrafos explicativos»; «No se saca todo el texto que hay». Criterio medible fijado por el orquestador a pedido del dueño: palabras visibles por pantalla ≤ las de la maqueta de Pedernal + 10 %. Y la regla de Pedernal (DDD:174, `ficha-de-pantalla-diseno.md`): «lo no declarado en una ficha no existe en la pantalla».

## 0. En lenguaje de proceso
1. Cada pantalla de Motor2 tendrá una **ficha**: un archivo chico que dice qué muestra (botones, campos, estados, textos), de qué maqueta de Pedernal sale y cuántas palabras puede tener.
2. Un test abre la pantalla real (con datos sembrados conocidos), lee todo lo que se ve y **falla si aparece un texto que la ficha no permite** o si hay más palabras que las de la maqueta + 10 %. También corre axe sobre la misma pantalla.
3. **Arranque más barato:** dos pantallas, alta de producto y combos (en Motor2, promociones), con el chequeo por pantalla renderizada (no por análisis del código). Si la segunda cuesta la mitad que la primera, se sigue.
4. Una pantalla sin ficha falla un cerco de trinquete que solo baja (hoy 99 `page.tsx`).

## 1. Qué existe (verificado contra el código real; Pedernal contra `ZuluHub-ERP` y `ZuluHub-docs` vigentes)
| Qué | Dónde | Relación |
|---|---|---|
| Ficha de pantalla de Pedernal (solo la forma) | `src/capacidades/pantallas/tipos-de-fichas.ts` (`FichaDePantalla`: `id`, `archivos`, `rutas`, `titulo`, `acceso`, `caminos`, `rotulos`, `botones`, `modales`, `estados`, `textos`, `estadoDeLaFicha`), `ficha-de-mesas.ts` (190 líneas, con la fuente de cada texto: quién lo decidió y dónde), `fichas.ts` (vacío) | Es el modelo a igualar en la FORMA |
| Diseño del chequeo de Pedernal | `ZuluHub-docs/11-especificaciones/ficha-de-pantalla-diseno.md` §4 (P1 a P9: botón, acción, campo, modal, texto, estado, pantalla sin ficha, menú, ficha terminada) y §7 (tramos T0–T8, piloto «Medios de pago») | Analizador AST, **sin construir todavía** en Pedernal |
| Catálogo de textos cerrado de Motor2 | `src/core/textos/` (`catalogo.ts`, `textoDe`), diseño `docs/diseno-textos-en-codigo-2026-11-16.md` | T1 hecho con UNA entrada real; ~5.700 apariciones de texto a mano sin migrar |
| Cerco de ayudas fijas | `test/arquitectura/cerco-ayudas-fijas.test.ts` (rama V5, #461) | Cuenta párrafos explicativos; no sabe de fichas |
| axe por pantalla | `test/e2e/accesibilidad.spec.ts`: 55 tests, 123 usos de `AxeBuilder` | Ya cubre muchas pantallas, sin lista que diga cuáles faltan |
| Legibilidad móvil | `test/e2e/legibilidad-movil.spec.ts` (rama `ci-legibilidad-movil`, 11 rutas) | Mide desborde y letra ≥ 16 px, no texto |
| Maquetas | `ZuluHub-docs/10-ux-ui/prototipos-gastronomia/*.html` (46) | Fuente aprobada de los textos y de las palabras |
| NO EXISTE en Motor2 | ficha por pantalla, lista de texto permitido, conteo de palabras, cerco «pantalla sin ficha» | Lo que se diseña acá |

## 2. Forma de la ficha (PROPUESTA)
`src/core/pantallas/fichas/<id>.ts` (carpeta nueva, dominio puro como `core/textos`; clasificar en `.dependency-cruiser-dominios.cjs`). Mismos nombres que Pedernal donde significan lo mismo:
- `id`, `rutas`, `archivos` (donde se leen botones/campos/textos), `titulo`, `acceso` (la acción de permiso de lectura que abre la pantalla: la que ya exige el servidor).
- `maqueta`: `{ archivo: "productos.html", estado: "datos", palabras: 111 }` (las palabras se calculan con un script, no a mano).
- `botones`: `{ id, texto, hace: navega | envia(acción de permiso) | abre(modal), sinPermiso: APAGADO | OCULTO }`.
- `campos`: `{ nombre, rotulo, dato }` (el rótulo siempre visible; el dato es el campo de la base que escribe).
- `estados`: CARGANDO, VACIO, ERROR, SIN_PERMISO, SOLO_LECTURA con su texto.
- `textos`: lista PERMITIDA, cada texto con **fuente**: `{ decidio: "el dueño, AAAA-MM-DD, «cita»", donde: "maqueta X, tabla «Textos nuevos»" }` (la regla I1: nunca «lo aprobó el orquestador»).
- `estadoDeLaFicha`: `EN_CONSTRUCCION` o terminada con decisión y huella (se copia de Pedernal; se agrega al final, no en el arranque).
Lo que la ficha NO repite: permisos (viven en `core/permisos`), textos que ya están en el catálogo (se referencian por clave).

## 3. Los cuatro chequeos
| Chequeo | Cómo falla | Cómo se mide |
|---|---|---|
| (b) Texto permitido | Un texto visible que no está en la ficha ni es un dato sembrado | e2e «ficha»: abre la ruta a 375 y 1280 px con datos sembrados CONOCIDOS, recorre los nodos de texto visibles (misma lógica que `legibilidad-movil.spec.ts`), descuenta los valores sembrados (nombres, precios) y compara el resto con `textos`, rótulos, botones y estados de la ficha |
| (c) axe | Cualquier violación | La misma corrida llama a `AxeBuilder` por cada estado que la ficha declara alcanzable |
| (d) Palabras | Palabras de la pantalla (sin datos sembrados) > `maqueta.palabras` × 1,10 | Cuenta del mismo recorrido; la cifra de la maqueta sale de `scripts/` (marco `.tel`, mismo estado) |
| (a) Pantalla sin ficha | Un `page.tsx` de `(app)`/`(pos)` sin ficha | Cerco de trinquete (`cercos/trinquete.ts`): hoy 99 pantallas, línea de base que solo baja; una nueva sin ficha no entra |
Por qué por pantalla renderizada y no por análisis del código (diferencia con Pedernal, declarada): Motor2 escribe ~5.700 textos a mano y solo tiene una entrada en el catálogo; un analizador AST (P5 de Pedernal) no tendría nada que comparar. El render ve lo que la persona ve (también texto armado en tiempo de ejecución) y se puede empezar sin migrar el código. Cuando el catálogo crezca, el chequeo de Pedernal (P5) se suma encima, no lo reemplaza.
**Límites (alarma para errores honestos, no un límite de seguridad):** solo ve los estados que el test provoca; un texto de dato no sembrado parece texto fijo (falso positivo: se siembra o se declara); el contenido de un modal cerrado no se ve; la maqueta trae datos de ejemplo distintos de los sembrados, por eso el conteo descuenta datos.

## 4. Excepciones con motivo (PROPUESTA)
En la misma ficha: `excepciones: [{ patron | texto, motivo (≥ 20 caracteres), cita (del dueño, con fecha), vence (≤ 60 días) }]`. Una excepción que no atrapa nada hace fallar el test (se borra); una vencida falla. Mismo mecanismo y misma regla que `cercos/vencimientos.ts`.

## 4 bis. Fuente del texto permitido: dos orígenes (precisión de Pedernal, ZuluHub-ERP `4fa7f3b8` / ZuluHub-docs `6b0b88d`)
| La pantalla en Pedernal | Fuente de los textos permitidos |
|---|---|
| YA construida (carpeta `apps/web/ui/plantillas/`, verificada en `origin/main` y no en deuda) | El catálogo `src/capacidades/vocabulario/catalogo-*.ts`: cada clave con sus `usos` y su `fuente` |
| Solo en maqueta (p. ej. proveedores/directorio, que no existe en `apps/web`) | La tabla «Textos nuevos» y las fichas de la maqueta HTML aprobada |
El chequeo por pantalla renderizada (arriba) queda como **control adicional**: cada texto visible tiene que existir en una de las dos fuentes. Nota: el chequeo propio de Pedernal (`test/arquitectura/declaracion-de-pantallas.test.ts`) hoy mide y no falla; no hay nada para copiar, así que el de Motor2 empieza por el control renderizado.

## 5. Tabla «¿qué pasa si…?»
| Situación | Resultado |
|---|---|
| Un texto de dato (nombre del producto) no está sembrado | Falso positivo: el test lo lista; se siembra o se declara como excepción con motivo |
| La maqueta cambia (Pedernal corrige un texto) | Cambia la cifra de palabras y la lista permitida al regenerarla; el diff se ve en el PR |
| Dos pantallas comparten un texto | Se declara en cada ficha (una regla, un lugar: si ya está en el catálogo, por clave) |
| Estado imposible de provocar en el test (SIN_CONEXION) | Se declara `noProbado` con motivo; no se finge |
| Falla un chequeo | El test dice ruta, estado y el texto o la cifra que sobra |

## 6. Arranque más barato y tramos (PROPUESTA)
| Tramo | Contenido | Tamaño |
|---|---|---|
| F0 | Script que extrae de una maqueta los textos y las palabras del marco `.tel` por estado | S |
| F1 | Tipo `FichaDePantalla` y la carpeta `core/pantallas/fichas/` + guardián de forma | S |
| F2 | Pilotos: ficha de **alta de producto** (`productos.html`, estados «Nuevo producto» y «Datos») y de **combos** (`combos.html`; en Motor2 `carta/parametrizacion/promociones`) | M |
| F3 | e2e «ficha» (texto permitido + palabras + axe) sobre las dos | M |
| F4 | Cerco «pantalla sin ficha» con la línea de base actual | S |
| F5+ | Una pantalla por vez, dentro del trabajo de cada frente | recurrente |
Criterio de seguir: si F3 de la segunda pantalla cuesta la mitad que la primera.

## 7. Diferencias con Pedernal (con motivo)
1. Chequeo por render y no por AST: Motor2 no tiene el catálogo de textos ni los `caminos` declarados (motivo: datos existentes en el código).
2. Carpeta `core/pantallas/fichas/` y no `src/capacidades/pantallas/`: la estructura de Motor2 es `src/core/<dominio>` (motivo: convención del proyecto).

## 8. Pregunta abierta
Resuelta por Pedernal el 2026-11-17 (§4 bis): dos fuentes según la pantalla esté construida o solo en maqueta. Queda por decidir con el dueño, pantalla por pantalla de Motor2, cuál de las dos corresponde (se mira la carpeta `plantillas/` en `origin/main`).
