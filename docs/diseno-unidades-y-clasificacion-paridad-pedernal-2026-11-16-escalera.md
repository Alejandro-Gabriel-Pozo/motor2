# Frente 2 — Escalera de diseño, niveles 1 a 5, y «¿qué pasa si…?» (2026-11-16)

> Pieza hermana de `docs/diseno-unidades-y-clasificacion-paridad-pedernal-2026-11-16.md`. **Solo documento.** No repite el diseño completo de cada módulo: **lo ordena, le pone el estado de cada decisión y remite al detalle** (que no cambia): unidades `docs/diseno-unidades-de-medida-como-pedernal-2026-11-15.md` (**UN**), merma `…diseno-merma-sobre-bruto-como-pedernal-2026-11-15.md` (**ME**), clasificación `…diseno-clasificacion-comercial-igual-a-pedernal-2026-11-13.md` (**CL**), clases `…diseno-clases-de-producto-como-pedernal-2026-11-15.md` (**CS**).
>
> **Estados.** **CONFIRMADA** = la dijo el dueño; se cita fecha y texto, y la **fuente** (en casi todos los casos es el chat del dueño con el orquestador **transmitido por un documento**: la cita llega de segunda mano; una máquina no puede probar que es del dueño, regla I1). **PROPUESTA** · **PENDIENTE** · **NO VERIFICADA**.
> Compuerta: **nivel 6 no se diseña ni migra** hasta que el dueño confirme 1 a 5. El esquema propuesto vive en las piezas hermanas y sigue PROPUESTO.

---

## Nivel 1. Propósito, necesidad y alcance

| # | Necesidad (quién la pidió, dónde está escrita) | Estado |
|---|---|---|
| 1.1 | **Pedido de este frente.** Dueño, 2026-11-16: «…Las unidades de clasificación, el tema de datos, planes y perillas…» (`motor2-docs`, `seguimiento-de-pedernal/decisiones-del-dueno-2026-11-14-mesa-resend-contador.md`, «Paridad con Pedernal: qué falta y cómo se trabaja»). Lectura: unidades de medida + clasificación del producto | **CONFIRMADA** el pedido; **PROPUESTA** la lectura (P0 abajo) |
| 1.2 | **Regla permanente.** Dueño, 2026-11-13: «Necesitamos ser iguales en todo. Por la salvedad de que nosotros usamos Prisma… El resultado tiene que ser el mismo y sobre todo de las mismas formas, salvo porque nosotros usamos Prisma.» (`AGENTS.md`) | **CONFIRMADA** |
| 1.3 | **Migraciones.** Dueño, 2026-11-16: «Sí, las migraciones van a estar aprobadas cuando ya tengamos todo el código igual.» **No autoriza nada hoy** | **CONFIRMADA**; efecto: **ninguna se aplica** |
| 1.4 | Unidades: estado final «Igual a pedernal» (las 14) y «Convertir cada una a la más parecida». Dueño, 2026-11-15 (el plan de paridad la registra en el bloque del 14/11; **la fecha exacta la fijó el orquestador**, UN §1 N-2/N-3) | **CONFIRMADA** (cita de segunda mano) |
| 1.5 | Merma sobre lo que se compra, se carga el bruto, «Sí, copiar a Pedernal en esas cinco» (2026-11-13 y 2026-11-15) | **CONFIRMADA** (ME §1 N-1 a N-10) |
| 1.6 | Clasificación: «…él agregó departamento, la primitiva de departamento, la primitiva de categoría. Así que quiero que tengamos eso también.» (2026-11-13, CL §1 N-1; la propia pieza advierte «fuente: chat, no localizable por mí») | **CONFIRMADA** (cita de segunda mano) |
| 1.7 | Clases: «Las 5 de Pedernal» (2026-11-13) y «Sí, copiar a Pedernal en esas cinco» (2026-11-15), «Unirlos par por par» (2026-11-15) (CS §1, §11) | **CONFIRMADA** (en dirección) |
| 1.8 | Presentaciones: «El de Pedernal: presentación por producto» (2026-11-13) y, sobre comprar con dos de la misma unidad, «Como lo hace pedernal?» (2026-11-15) → d1 a d5 **no se construyen** | **CONFIRMADA**; **PROPUESTA** la lectura «no se construye» (la dice el orquestador) |
| 1.9 | **Alcance.** Entra: las 14 unidades y su conversión exacta, la columna de equivalencia, la merma en bruto, el árbol de clasificación (E1 a E3), las clases y la unión de pares. **No entra** (sugerencias): fusionar unidades, nombre/peso variable de presentaciones, unidad de venta separada y porciones, filtros y reportes por departamento, responsable de departamento, departamento en la cuenta (**pregunta P1**) | **PROPUESTA** |
| 1.10 | **Poda.** Una opción cuyas combinaciones dan lo mismo o no tiene necesidad escrita es candidata a ocultarse. Candidatas declaradas: la guardia por nombre (`PARES_DE_UNIDADES`) cuando exista equivalencia; la merma en opciones y combinaciones (ME §7, «etapas posteriores»). **No se podan acá** | **PROPUESTA** |

**P0 — Lectura de «las unidades de clasificación».** Si el dueño quiso decir algo distinto de «unidades de medida y clasificación», el alcance cambia. Es la primera cosa que debe validar al leer este documento (no hace falta pregunta aparte: se corrige).

---

## Nivel 2. Actores y contexto

| Actor | Qué hace | Permiso hoy (Motor2) | Después |
|---|---|---|---|
| Quien administra el catálogo | Hoy crea unidades; después **elige** entre las 14 y resuelve las «pendientes» | `unidades` (piso administrador, `acciones.ts:61`) | Igual; deja de poder crear |
| Gerente / administrador | Edita el árbol de clasificación | `categorias` (piso administrador) | **CONFIRMADA** (2026-11-14): «Árbol: administración y gerencia; clasificar en la ficha: como hoy» |
| Quien edita productos | Elige clasificación y clase en la ficha | permiso de edición de producto de hoy | Igual |
| Cocina / quien arma recetas | Carga recetas | permiso de receta de hoy | La receta nueva se carga en **bruto** (M3b) |
| Dueño | Revisa la tabla de equivalencias de cada base y autoriza cada reescritura **por base** | — | — |
| Plataforma | Fija el tope de niveles (4) y la lista de 14; despliega | rol de base de plataforma | Sin pantalla nueva |
| Contexto | **Multiempresa** (RLS `app_empresa_actual()`); sucursal solo donde ya existe (calibración); fechas en zona Argentina (UTC-3); dinero y cantidades exactos | — | La clasificación y las unidades son **de la empresa**, no de la sucursal |

---

## Nivel 3. Casos de uso

| # | Caso | Etapa | Estado |
|---|---|---|---|
| CU-1 | Elegir la unidad de stock y de compra **dentro de las 14** | U2 | PROPUESTA |
| CU-2 | Ver las unidades existentes con el nombre de la equivalente y el original conservado; las sin equivalencia, «Pendiente de completar» | U1b/U2 | PROPUESTA |
| CU-3 | Convertir una cantidad entre unidades de la misma dimensión: exacta o rechazada | U0 (hecho) / U2 | CONFIRMADA (Pedernal «decisión 21 y 92»; NO VERIFICADO el texto del dueño de Pedernal) |
| CU-4 | Alta de empresa con las 14; **crear una unidad a mano: cerrado** | U2 | PROPUESTA (N-2) |
| CU-5 | Informe de solo lectura por base (qué unidades, qué recetas, qué pares) | A1 | PROPUESTA |
| CU-6 | Guardar una receta, opción o combinación en **bruto**; al editar una vieja, versión nueva convertida con vista previa y confirmación | M3b | CONFIRMADA (Q-M1, Q-M2, Q-M3) |
| CU-7 | Crear / renombrar / mover / desactivar / reactivar un nodo de clasificación | E1 | CONFIRMADA (CL §1, §13; permisos 2026-11-14) |
| CU-8 | Clasificar un producto («rige desde ahora», «Sin elegir» posible) | E2 | CONFIRMADA («solo desde ahora», 2026-11-13, de Pedernal) / **PROPUESTA** para Motor2 (P2) |
| CU-9 | Sellar el camino de clasificación en cada renglón vendido | E3 | **PROPUESTA** (CL P3 la asumió el orquestador) |
| CU-10 | Elegir la **clase** al crear un producto; la clase no cambia | CS E2 | CONFIRMADA en dirección |
| CU-11 | **Unir un par** materia prima + vendible en un producto de reventa (una transacción por par) | CS E6 | CONFIRMADA en dirección (2026-11-15) |

---

## Nivel 4. Conceptos y ciclo de vida

| Concepto | Valores / forma | Ciclo | Estado |
|---|---|---|---|
| **Unidad de medida** | Una de las 14 (código, dimensión, factor entero a la base). Los factores **no cambian nunca** | En la empresa: `SIN_EQUIVALENTE` → `CON_EQUIVALENTE` (acción explícita y auditada; sin vuelta automática) | PROPUESTA (CONFIRMADA en Pedernal) |
| **«La más parecida»** | Equivalencia solo si **1 de la vieja = 1 de la nueva**, misma dimensión (kg, kilo, gr, l, ml, «unidad»…); envases («caja», «pack», «bolsa», «botella») → **UNIDAD** con el nombre original visible; lo que no sea 1 a 1 (docena, par) → «pendiente de completar» | — | **CONFIRMADA** («A UNIDAD, con el nombre original visible», 2026-11-15, UN Q-U2) |
| **Cantidad** | `numeric(?,4)`; en Motor2, redondeada a `Unidad.decimales` (**datos existentes**); la conversión nunca redondea | — | PROPUESTA (I3 de UN) |
| **Presentación de compra** | Unidad + factor por producto; interruptor `PRESENTACIONES_VISIBLES = false` | `activa` / inactiva; con dos activas de la misma unidad, la compra **falla cerrada** | Etapas a y a2-1 **hechas**; el resto **en reserva** |
| **Base de cantidad de una versión** | `NETA` (lo existente) o `BRUTA` (lo nuevo); solo agrega; el neto es un cálculo, no un dato | La vieja queda; al editar nace una `BRUTA` | **CONFIRMADA** (N-5, N-8) |
| **Nodo de clasificación** | Departamento (nivel 1, fijo) → categoría (niveles 2 a 4); tope **4** fijado por la plataforma y **nunca reducible**; nombre único entre hermanos | `activo`/desactivado (no se borra); no se desactiva con hijos activos; no se reactiva con padre desactivado; un departamento no se mueve | CONFIRMADA en Pedernal; **PROPUESTA** para Motor2 (se amplía `CategoriaProducto`) |
| **Vínculo producto → nodo** | Solo inserción; vigente = última fila; «Sin elegir» = sin fila o `nodoId` nulo; **rige desde ahora** | Nunca se edita | PROPUESTA (CL P2) |
| **Camino en la venta** | Copia (ids y nombres) en el renglón al vender; no se reescribe | Inmutable | PROPUESTA (CL P3) |
| **Clase de producto** | MATERIA_PRIMA, INSUMO, REVENTA, ELABORADO, VENDIBLE; no cambia | Se crea el correcto y se desactiva el equivocado | CONFIRMADA en dirección |
| **Par de reventa** | MP + PV con receta 1:1 | `unir` = nuevo producto REVENTA + **desactivar** el par; costo del nuevo **«arranca vacío hasta la primera compra, avisado»** | CONFIRMADA (2026-11-15) |

---

## Nivel 5. Invariantes y políticas

Todo nace cerrado (regla del 2026-11-11): sin equivalencia declarada, una unidad es «pendiente» (nadie adivina por nombre); un árbol inconsistente **no se interpreta**; una clase fuera de la lista se rechaza; una validación declara lo que **se permite**.

| # | Invariante | Estado |
|---|---|---|
| I-U1 | Los factores de las 14 no cambian nunca; una prueba compara el código con el `CHECK` de la base | PROPUESTA (CONFIRMADA en Pedernal) |
| I-U2 | Convertir es **exacto o se rechaza**, en este orden: `DIMENSION_DISTINTA`, `CONVERSION_NO_EXACTA`, `FUERA_DE_RANGO`; aritmética `bigint`, nunca `number` | PROPUESTA (**V**: ya así en `unidades-de-medida.ts`) |
| I-U3 | **Diferencia declarada:** Motor2 sigue redondeando el stock a `Unidad.decimales` en lo ya guardado (**datos existentes**); **no se toca** ninguna cantidad ni factor cargado | PROPUESTA |
| I-U4 | Una equivalencia solo entre unidades de la **misma dimensión** y relación 1 a 1 | PROPUESTA |
| I-U5 | Nada se pierde: nombre original, `id`, decimales y toda fila que la referencia quedan idénticos | PROPUESTA |
| I-U6 | Asignar/cambiar una equivalencia: permiso verificado en el servidor, **auditada** (quién, cuándo, de qué a qué), idempotente | PROPUESTA |
| I-U7 | Coherencia del factor (kg→g = 1000): si no coincide, **no se corrige solo**: se marca «pendiente de revisar» y se cuenta | PROPUESTA |
| I-U8 | Dinero: stock, costo y totales valorizados **no cambian** (suma de control antes y después) | PROPUESTA |
| I-M1 | Una versión `NETA` nunca se reescribe; al editar nace una `BRUTA` conservando **bruto** (stock y costo) y acercando el neto; **la diferencia se muestra antes de guardar, nunca en silencio** | **CONFIRMADA** (N-8, N-10) |
| I-M2 | `BRUTA`: merma `< 100` (se rechaza, no se acota); neto = bruto × (100 − p) ÷ 100, **un solo redondeo** a 4 decimales, empate que se aleja del cero | CONFIRMADA (2026-11-13) |
| I-M3 | La fórmula vive en **una** función (guardián `formula-de-merma-unica`) | **V** (ya hecho, M0) |
| I-C1 | Árbol: un padre, una empresa, sin ciclos, tope 4, un departamento no se mueve, no se desactiva con hijos activos, no se pone bajo uno desactivado, **nada se borra** | CONFIRMADA en Pedernal; PROPUESTA en Motor2 |
| I-C2 | Cada movimiento del árbol se **serializa por empresa** (candado de transacción antes de leer, lectura posterior ve lo último confirmado) | PROPUESTA (igual a Pedernal) |
| I-C3 | La clasificación es de la empresa; **no hereda** la alícuota ni el food cost (CONFIRMADA: «No se hereda») | CONFIRMADA (2026-11-13/14) |
| I-C4 | Permisos: árbol = administrador/gerente; clasificar = permiso de la ficha; **sin claves nuevas** | **CONFIRMADA** (2026-11-14) |
| I-C5 | Lo vendido no cambia si se mueve o reclasifica (E3); hasta que E3 exista, rige el aviso T7 | CONFIRMADA (T7 aprobado 2026-11-14) / PROPUESTA (E3) |
| I-K1 | La clase no cambia; «se produce» ya no se prende ni se apaga en una materia prima | CONFIRMADA (2026-11-15) |
| I-K2 | Unir un par: **una transacción por par**, informe antes (nombre, unidad y factor, stock por sección y sucursal, costo, recetas que lo usan), confirmación, el par **se desactiva y no se borra** | PROPUESTA (CS §11.3); dirección CONFIRMADA |

**Combinaciones (regla del 2026-10-28).** Dimensiones que cambian dinero, stock, visibilidad o permisos: código de unidad (14) × estado de equivalencia × relación compra/stock × decimales (0 a 6) × empresa existente/nueva × base de cantidad (`NETA`/`BRUTA`) × clase (5) × nivel del nodo (1 a 4) × activo/desactivado. Cada pieza tiene su oráculo (UN §9 y ME §9, CL §11, CS §10) y un guardián que **falla si aparece una dimensión nueva sin declarar**.

---

## «¿Qué pasa si…?» por comando

Columnas: **R**epetición · **C**oncurrencia · **T**iempo · **I**ncertidumbre · **Re**intento · **E**rror parcial · **D**atos faltantes · **P**ermisos.

| Comando | R | C | T | I | Re | E | D | P |
|---|---|---|---|---|---|---|---|---|
| **Convertir cantidad** (U0) | misma entrada, mismo resultado | función pura: sin estado | sin reloj | no exacta → `CONVERSION_NO_EXACTA`, no redondea | idéntico | n/a | otra dimensión → `DIMENSION_DISTINTA` | n/a |
| **Asignar equivalencia** (U1b/U2) | una sola asignación; la segunda no escribe ni audita | gana la primera (`UPDATE … WHERE "codigoFijo" IS NULL`); la otra recibe «ya tiene equivalencia» | movimientos históricos intactos; cambia solo el rótulo | duda («caja» o «docena») → queda «pendiente», nunca por parecido | idempotente | una transacción por base: todo o nada | magnitud incompatible → se omite y se cuenta; la corrida termina distinto de cero | permiso `unidades` en el servidor en cada pedido; el script corre con autorización expresa |
| **Alta de empresa con las 14** (U2) | el alta repetida no duplica (único + `upsert`) | dos altas: una gana, la otra ve «ya existe» | n/a | n/a | idempotente | misma transacción: nace con las 14 o no nace | n/a | el alta es de plataforma |
| **Crear unidad a mano** (U2) | cerrado | cerrado | n/a | n/a | n/a | n/a | n/a | el servidor rechaza **después** de verificar el permiso, sin texto nuevo |
| **Guardar receta en bruto / convertir al editar** (M3b) | el mismo guardado con la misma versión base = una sola versión (la segunda ve versión desactualizada) | optimistic locking por versión de receta; dos ediciones: gana la primera | una venta en curso usa la versión vigente al momento; la vieja queda | conversión inexacta → se muestra la diferencia y se pide confirmar | idéntico; no duplica versiones | **una transacción** (versión + calibraciones arrastradas) | merma `≥ 100` en `BRUTA` → rechazo en el campo | permiso de receta de hoy; la vista previa no cambia nada |
| **Crear nodo** (E1) | mismo `id` de la app = «ya existía» | candado por empresa; dos con el mismo nombre entre hermanos: una gana, la otra «ya existe» | n/a | n/a | clave natural por `id` | todo o nada con la auditoría | nombre vacío/inválido → rechazo; padre inexistente o desactivado → rechazo | `categorias`, verificado en servidor |
| **Renombrar** (E1) | misma versión: la segunda falla por versión | versión de fila (`version`) | los reportes del pasado muestran el nombre nuevo hasta E3 (aviso T7) | n/a | idempotente por versión | todo o nada | nombre repetido entre hermanos → rechazo | ídem |
| **Mover** (E1) | «ya estaba» si el padre es el mismo | candado por empresa: dos movimientos que juntos harían un ciclo: el segundo se rechaza | idem T7 | n/a | idempotente | todo o nada | departamento no se mueve; tope 4 contando la altura del subárbol | ídem |
| **Desactivar / reactivar** (E1) | «ya estaba» | candado por empresa | los productos conservan su vínculo (el historial no cambia) | n/a | idempotente | todo o nada | con hijos activos → «Primero desactivá lo que tiene adentro.» | ídem |
| **Clasificar un producto** (E2) | mismo `id` de la app = no duplica | `UNIQUE (empresa, producto, vigenteDesde)`: dos a la vez, una gana | rige **desde ahora** (instante del servidor, zona Argentina); no hay fecha futura | n/a | `id` de la app | **una transacción** con la copia en `Producto.categoriaId` | nodo desactivado → rechazo; `nodoId` nulo = «Sin elegir» | permiso de la ficha, servidor |
| **Sellar el camino en la venta** (E3) | una sola vez al insertar; **sin `UPDATE`** | misma transacción que la venta | lo vendido no cambia | n/a | la venta ya es idempotente por su clave | si falla el sellado, **no hay venta** | producto «Sin elegir» → camino vacío (nunca inventa) | n/a |
| **Unir un par** (CS E6) | el par ya unido → «ya estaba» | un par a la vez; lo toca el candado del producto | stock y costo **a esa fecha**; el nuevo costo arranca vacío | si el informe no cuadra, **no se une** | por par; no duplica el producto REVENTA | **una transacción por par**; los demás siguen | sin recetas que reapuntar → se une igual; sin costo → «pendiente de completar» | autorización expresa por base + permiso de edición |

---

## Pendiente (para el dueño, una por vez)

La primera es la **P1** de la entrada (§8): **departamento en la cuenta de venta (Pedernal 0048)**, recomendada (a): no por ahora. Las siguientes (P2 a P4) están en fila. **P0** (lectura del pedido) se corrige leyendo este documento.
