# Diseño: cada parte de una promo decide qué entra, en la fila del cupo — 2026-11-11

Estado de este documento: **niveles 1 a 5 CONFIRMADOS por el dueño el 2026-11-11** («Ok, bueno», respondiendo «¿Aprobás este enfoque?», más sus respuestas a P1, P2 y P3 de abajo). Es solo diseño: no hay migración en este documento ni en las etapas E0 a E2 (ver §6). Estados: **CONFIRMADA** (lo dijo el dueño, con fecha), **PROPUESTA**, **PENDIENTE**, **NO VERIFICADA**. Código leído en `main` a0ca384f.

Antecedentes: `docs/diseno-promo-subconjunto-2026-11-04.md` (PR #161, solo docs, abierto: decisiones 1 a 5 del 2026-11-04/05), `docs/adr/ADR-030` (GO-2d, «pedilo suelto») y `docs/adr/ADR-032` (D-6).

## 0. Resumen para el dueño (lenguaje de proceso)

1. Hoy cada parte de una promo (un «cupo») es «toda una sección de la carta» o «una lista de productos», y se arman en dos lugares y en dos pasos: se crea la lista con un nombre, se guarda, y recién más abajo aparece dónde tildar los platos.
2. Se propone que en la fila de cada sección se elija **«Toda la sección»** o **«Solo estos platos»**. Con «Solo estos platos» se abre ahí mismo el tildado: de cada plato se decide si la opción viene **fija** o si el mozo **elige** entre las permitidas. Hay una fila **«No está en la carta»** (siempre «solo estos platos»). «Sumar un lugar» se retira.
3. **Todo nace cerrado** (CONFIRMADA como principio, 2026-11-11): una promo nace sin secciones tildadas; tildar una sección no tilda sus platos; nada «viene tildado» salvo decisión explícita.
4. El mín/máx es del **conjunto** de la parte (CONFIRMADA): sumar platos no sube el cupo. Con «de 0 a 2» el mozo **puede elegir dos platos de la sección, incluso el mismo plato dos veces** (CONFIRMADA: sirve para representar un 2x1).
5. En «Toda la sección», un plato con opciones obligatorias **deja de decir «pedilo suelto»**: el mozo elige cualquier opción disponible (CONFIRMADA: por ejemplo cualquier tamaño de café). **También las opciones solo opcionales** se ofrecen y el mozo puede elegirlas (CONFIRMADA: si no, no se las ofrecés al cliente).
6. El precio de la promo es fijo: elegir otra opción solo cambia el reparto entre platos. Los adicionales con recargo siguen afuera (decisión 3 del 2026-11-04).
7. Una parte «Solo estos platos» sin ningún plato tildado y con mínimo mayor a 0 **se bloquea al guardar** (CONFIRMADA).
8. Esto cambia una regla escrita («en una promo armada por sección no se eligen opciones», ADR-030 supuesto 9 de GO-2d y ADR-032 D-6). Enmienda en §5.5, aprobada por el dueño el 2026-11-11.
9. Sin migración: todo se arma con tablas que ya existen.

## 1. Inventario contra el código real (HEAD a0ca384f)

| Pieza | Dónde | Qué hace hoy |
|---|---|---|
| Parte (cupo) | `prisma/schema.prisma:2100-2125` | Tipo `SECCION`, `LISTA` o `DEL_DIA`; mín/máx; baja lógica `activo`; `@@unique([promoCartaId, seccionCartaId])` (`:2123`): una parte por sección en cada promo |
| Entrada de lista | `schema.prisma:2132-2155` | Producto + `modoDeOpciones` `FIJAS`/`A_ELEGIR` |
| Modo «el mozo elige» (N1) | migración `20261105120000_promo_entrada_a_elegir`, `src/core/pos/opciones-permitidas-de-entrada.ts:25-49` | Ya implementado |
| El mín/máx es del conjunto | `src/core/pos/promo-combo.ts:250-270` y `:291-326` | Suma el total de la parte contra `cantidadMaximaCupo` |
| Repetir el mismo plato | `promo-combo.ts:258-263, 299-305, 320-323` | Se acepta (una fila con cantidad 2) |
| «Pedilo suelto» | `agregar-items.ts:250-258` (`PROMO_CON_OPCIONES`), `elegir-opciones-estado.ts:179-185` (`avisoEnPromo`), `armar-promo.tsx:22-23, 61, 107` | Un plato de sección con grupo obligatorio no se arma |
| «Sumar un lugar» | `parametrizacion/formularios.tsx:237-257`, `promociones/page.tsx:243-311` | Crea la lista con nombre y mín/máx; los platos se tildan en otro bloque, más abajo |
| Tildar platos por origen | `agregar-entrada-de-lugar.tsx`, `src/core/carta/armar-lugar-de-lista.ts:27-86` | Existe (origen = sección o «no está en la carta»). Hoy un plato con grupo obligatorio abre en «el mozo elige» con **todas** las opciones tildadas (`:60-65`) |
| Guardar las partes | `guardar-cupos-promo-carta.ts:59-117` | SERIALIZABLE, «llevar al estado»; piso de precio sobre **todas** las partes (`:79-87`) |
| Lecturas al agregar | `promo-para-agregar.ts:89-100`, `entradas-de-promo-para-vender.ts:104-120` | Selector y servidor leen de la misma fuente |
| Peso del reparto en sección | `promo-para-agregar.ts:92`, `selector-carta.ts:121` | Usa el `precioVenta` guardado (no rige en productos «se venden por opción», ADR-035) |
| Permisos | `src/core/permisos/acciones.ts:86` (`carta_promo_definir`), `:198` (`pos_tomar_pedido`) | Sin cambios |

## 2. Escalera de diseño (niveles 1 a 5)

### Nivel 1. Propósito, necesidad y alcance
- **Propósito (CONFIRMADA, 2026-11-11):** en cada parte de una promo el dueño decide qué entra, en un solo lugar: toda la sección; o solo ciertos platos de una sección o de «no está en la carta»; y de cada plato elegido, opción fija o «el mozo elige» entre las permitidas.
- **Necesidad escrita:** pedido del dueño del 2026-11-11 (este documento); antes, 2026-11-04 («solo los bifes», lista explícita) y 2026-11-05 (decisión 5: el origen de un lugar es una sección o «no está en la carta»), en `diseno-promo-subconjunto-2026-11-04.md`; el «pedilo suelto» viene de GO-2d (ADR-030, 2026-10-14) y el dueño pidió sacarlo para «Toda la sección» (2026-11-11).
- **Alcance:** la pantalla de armado de partes; que «Toda la sección» acepte platos con opciones (obligatorias y opcionales); que el servidor valide eso.
- **Fuera de alcance:** adicionales con recargo; el plato del día (`DEL_DIA`, sin opciones, ADR-032:51); reservar promos a empresas o convenios (N2); reportes de margen por configuración.

### Nivel 2. Actores y contexto
| Actor | Qué hace | Permiso |
|---|---|---|
| Administrador de la empresa | Define qué entra en cada parte | `carta_promo_definir` (sin clave nueva) |
| Gerente de sucursal | Prende o apaga la promo y las opciones en su sucursal | sin cambios |
| Mozo | Arma la promo y elige platos y opciones | `pos_tomar_pedido` |
| Servidor | Revalida todo dentro de la transacción SERIALIZABLE | — |

La promo es de la empresa; la carta, la disponibilidad, el stock y el apagado de opciones son por sucursal. Con el módulo `promociones` apagado no se vende ninguna promo.

### Nivel 3. Casos de uso
| # | Caso | Hoy | Etapa |
|---|---|---|---|
| CU1 | «Toda la sección» con mín/máx | Existe | — |
| CU2 | Pasar una sección a «Solo estos platos» y tildar sus platos en la misma fila | Existe en dos pasos | E2 |
| CU3 | De cada plato tildado: «viene fijo» o «el mozo elige» y las opciones permitidas | Existe (se reubica) | E2 |
| CU4 | Parte «No está en la carta» con platos tildados | Existe en dos pasos | E2 |
| CU5 | Volver de «Solo estos platos» a «Toda la sección» | No existe como gesto | E2 |
| CU6 | El mozo arma «Toda la sección» y elige la opción de un plato con grupos (obligatorios u opcionales) | No existe | E1 |
| CU7 | El servidor valida lo de CU6 | No existe (`PROMO_CON_OPCIONES`) | E1 |

### Nivel 4. Conceptos y ciclo de vida
- **Parte (cupo):** un lugar de la promo con su mín/máx del conjunto (CONFIRMADA). Nombre visible: el de la sección, o uno libre si es «No está en la carta».
- **«Toda la sección»:** regla **viva** (PROPUESTA, coherente con el código): el mozo ve los platos que hoy se ofrecen en esa sección en la sucursal. Se guarda como parte `SECCION`.
- **«Solo estos platos»:** lista **explícita** (CONFIRMADA por las decisiones 2 y 5 del 2026-11-04/05): la sección es solo la fuente para tildar. Se guarda como parte `LISTA` con sus entradas.
- **Nace cerrado (CONFIRMADA como principio; aplicación PROPUESTA):** una promo nace sin partes; al tildar una sección no queda elegida ninguna de las dos modalidades hasta que el dueño elige «Toda la sección» o tilda platos; en «Solo estos platos» ningún plato nace tildado; de un plato tildado en «el mozo elige», las opciones permitidas tampoco nacen tildadas. Esto cambia el comportamiento actual de `armar-lugar-de-lista.ts:60-65` (opciones todas tildadas): se revisa con captura real en E2b.
- **Plato con grupos dentro de «Toda la sección» (CONFIRMADA, 2026-11-11):** se ofrece con **todas** las opciones de sus grupos que no sean adicionales, tanto obligatorias como opcionales. Lo elegible se calcula en el momento: lo que el producto admite, menos lo apagado en la sucursal, menos los grupos `ADICIONAL`. Es la misma función que usa una lista «a elegir» (`opcionesPermitidasEfectivas`, `opciones-permitidas-de-entrada.ts:25-49`) pasándole todas las opciones como permitidas. Si un grupo obligatorio queda sin opciones, o el plato tiene un adicional obligatorio, el plato **no se ofrece** (falla cerrado).
- **Ciclo de una parte:** creada → activa → cambia entre «Toda» y «Solo estos» → dada de baja (nunca se borra, `cupos-de-promo.ts:54-58`). Lo vendido queda congelado: precio, reparto, opciones y foto.

| Si después… | «Toda la sección» | «Solo estos platos» | Lo ya cargado en la cuenta |
|---|---|---|---|
| Se agrega un plato a la sección | Entra solo | No entra | No cambia |
| Se apaga el plato en la sucursal | Sale | Sale | No cambia |
| Se agota (stock 0) | Se sigue ofreciendo; al cobrar avisa «Quedó stock negativo» (NO VERIFICADA aquí) | Igual | No cambia |
| Se apaga una opción | Sale de lo elegible; si deja vacío un obligatorio, el plato sale | Igual | No cambia |
| El plato pasa a otra sección | Sale de esta parte y entra en la otra (si es «Toda») | Sigue en la lista | No cambia |
| Se agrega una opción nueva al plato | Entra sola | No entra (valen las tildadas) | No cambia |

### Nivel 5. Invariantes y políticas
| # | Invariante | Lo impone | Estado |
|---|---|---|---|
| I1 | El precio cobrado es el de la promo, elija lo que elija el mozo; solo cambia el reparto | `prorratearPrecioPromo` (`promo-combo.ts:398-436`) | CONFIRMADA (04/11); EXISTE |
| I2 | El mín/máx es del total de la parte; sumar platos no lo cambia | `promo-combo.ts:265-270, 325-326` | CONFIRMADA; EXISTE |
| I2b | Con máx ≥ 2 se puede elegir el mismo plato más de una vez (2x1) | hoy ya se acepta | CONFIRMADA (2026-11-11); EXISTE |
| I3 | Nunca entra un adicional con recargo; un plato con adicional **obligatorio** no se ofrece | `opciones-permitidas-de-entrada.ts:31-34` | CONFIRMADA (decisión 3, 04/11); PROPUESTA para secciones |
| I4 | En «Toda la sección», un plato con grupos se elige con cualquier opción disponible (no adicional), obligatorias y opcionales, respetando mín/máx **de su grupo** | `opcionesPermitidasEfectivas` + `armarLineaConfigurada` | CONFIRMADA (2026-11-11); implementación PROPUESTA |
| I5 | Selector y servidor calculan lo elegible con la misma función y la misma lectura | paridad como `test/pos/promo-combo-consulta.test.ts` | PROPUESTA |
| I6 | Una opción fuera de lo elegible se rechaza antes de escribir (`OPCION_NO_PERMITIDA_EN_PROMO`); versión vieja: `OPCION_CAMBIO` | `configuracion-de-entrada-a-elegir.ts:34-51` | EXISTE para listas; PROPUESTA para secciones |
| I7 | Cada configuración elegida es un componente válido: precio de referencia ≥ $0,01 y origen de stock | `rechazoDeComponenteDeCombo` | EXISTE; PROPUESTA para secciones |
| I8 | El peso del reparto es el precio de lista **de la configuración elegida**, no el precio guardado | como en lista «a elegir» (`agregar-items.ts:225-235`) | PROPUESTA |
| I9 | Lo agregado a la cuenta no cambia si después cambia el catálogo o la promo | lectura al agregar | EXISTE |
| I10 | Una sola parte por sección en cada promo; «Toda» y «Solo estos» de la misma sección no conviven | `@@unique` (`schema.prisma:2123`) / regla del comando | EXISTE / PROPUESTA |
| I11 | Cambiar entre «Toda» y «Solo estos» es todo o nada, en una transacción | comando nuevo (E2a) | PROPUESTA |
| I12 | Parte con mínimo > 0 y ninguna entrada elegible hoy: la promo no se puede armar (nunca «todos») | `promo-combo.ts:325` | EXISTE |
| I12b | «Solo estos platos» sin ningún plato tildado y con mínimo > 0 **se bloquea al guardar** | comando (E2a) y pantalla | CONFIRMADA (P3, 2026-11-11) |
| I13 | Auditoría en la misma transacción; las partes y entradas no se borran | patrón existente | EXISTE |
| I14 | Un combo no mezcla alícuotas de IVA distintas | `agregar-items.ts:259-267` | EXISTE |

**Qué ve el mozo (PROPUESTA):** en «Toda la sección», el plato con opciones tiene «+»; cada unidad abre debajo sus grupos con las opciones elegibles (`OpcionesDeUnidad`, `armar-promo-opciones.tsx`); «Agregar promo» se habilita cuando cada unidad cumple los mínimos de sus grupos. «Pedilo suelto» queda solo para lo que de verdad no se puede: un adicional obligatorio o un grupo obligatorio sin opciones activas.

## 3. Alternativas (de la más barata a la más cara)

**Punto 1: elegir qué entra en una sola fila.**
| Alt. | Qué es | Base de datos | Costo | Recomendación |
|---|---|---|---|---|
| A0 | Solo un aviso «ahora tildá los platos más abajo» | No | Muy bajo | No: no cumple «en un solo lugar» |
| **A** | Fila de sección con «Toda / Solo estos platos»; «Solo estos» se guarda como parte `LISTA` con el nombre de la sección; comando `guardarParteDePromo` en UNA transacción | **Sin migración** | Medio (2 PR) | **Sí** |
| A' | Igual que A con los comandos de hoy | No | Menor | No: deja la lista vacía entre dos pasos; no cumple I11 |
| C | Como A + columna `PromoCartaCupo.origenSeccionCartaId` | **REQUIERE AUTORIZACIÓN EXPRESA** | A + migración | Solo si el enganche por nombre falla en la práctica (E3) |
| B | Subconjunto de sección N1b (columna + tabla `ProductoPermitidoDeCupo`) | **REQUIERE AUTORIZACIÓN EXPRESA** | Alto | No: duplica `EntradaDeCupo` |

**Punto 3: «Toda la sección» con platos con opciones.**
| Alt. | Qué es | Base de datos | Recomendación |
|---|---|---|---|
| **3α** | Un plato de sección con grupos pasa a ser un «a elegir» implícito con todas sus opciones no adicionales | Sin migración | **Sí** |
| 3β | Al tildar «Toda la sección», crear una lista con todos los platos | Sin migración | No: es una foto, un plato nuevo no entra |
| 3γ | Columna «el mozo elige opciones sí/no» por parte | **REQUIERE AUTORIZACIÓN EXPRESA** | No: opción que nadie pidió |

**Qué cambia con 3α (sin migración):** `src/core/pos/promo-combo.ts` (la elección por sección acepta `opciones`; identidad de fila = `producto|configuración`; sin opciones el resultado es idéntico al de hoy, lo cuida `test/pos/promo-combo-go3.propiedades.test.ts`); `src/server/lecturas/pos/promo-para-agregar.ts:89-100` (arma los «a elegir» implícitos con `opcionesPermitidasEfectivas`); `src/server/actions/pos/casos-de-uso/agregar-items.ts` (`:109-118` precios de MEDIDAS, `:225-247` configuración y peso del reparto, `:250-258` `PROMO_CON_OPCIONES` queda solo para lo no armable, `:284-315` escritura de componentes configurados); POS: `selector-carta`, `armar-promo-estado.ts`, `armar-promo.tsx:58-61`, `elegir-opciones-estado.ts:179-185`.

**Riesgos de 3α:** R1 stock (cada opción elegida descuenta sus insumos; el origen de stock se valida por configuración elegida; el cobro no se bloquea con stock en cero); R2 dinero (el total no cambia; el margen depende de lo que elige el mozo; el peso del reparto usa la configuración elegida, I8); R3 adicionales (no se ofrecen; uno obligatorio deja el plato afuera); R4 comanda y ticket (mismo camino que una lista «a elegir»); R5 versiones de opciones (`OPCION_CAMBIO`); R6 despliegue (primero servidor, después pantalla; la pantalla vieja no manda opciones para esos platos).

## 4. «¿Qué pasa si…?»

**Comando 1: definir o cambiar lo que entra en una parte (`guardarParteDePromo`, administrador).**
| Situación | Resultado propuesto |
|---|---|
| Repetición o doble clic | «Llevar al estado»: repetirlo no escribe ni audita nada |
| Concurrencia | SERIALIZABLE con reintento; el segundo relee y ve el estado nuevo o falla con «recargá» |
| Tiempo | Rige desde que se guarda; no toca lo ya cargado en mesas |
| Incertidumbre | Un plato que no puede ser componente o una configuración inválida: se rechaza todo con el motivo |
| Reintento tras corte | Mismo resultado (por estado) |
| Error parcial | Parte, entradas y auditoría en UNA transacción: todo o nada (I11) |
| Datos faltantes | «Solo estos platos» sin plato tildado y con mínimo > 0: **se bloquea** (I12b) |
| Cambio de permisos | `carta_promo_definir` se verifica en el servidor en cada guardado |
| Piso de precio | El peor caso (todos los máximos) debe alcanzar $0,01 por unidad |

**Comando 2: agregar la promo a la cuenta (mozo).**
| Situación | Resultado |
|---|---|
| Repetición o doble clic | Clave de idempotencia: una sola vez |
| Concurrencia | El servidor lee adentro; si lo elegido ya no vale, rechaza sin escribir |
| Tiempo | `PROMO_CAMBIO` si el precio cambió desde que la vio (`agregar-items.ts:210-212`) |
| Incertidumbre | Opción apagada: rechazo; versión vieja: `OPCION_CAMBIO`; agotado: se vende con aviso |
| Error parcial | Todo o nada |
| Datos faltantes | Plato con grupo obligatorio sin opciones: «Elegí …» (`OPCIONES_INVALIDAS`) |
| Cambio de permisos | `pos_tomar_pedido`; módulo apagado: `PROMO_NO_DISPONIBLE` |

**Comando 3: cambiar el catálogo después.** La promo solo **lee** al agregar; vale la tabla del nivel 4; lo ya cargado no cambia. Una parte con mínimo > 0 sin elegibles hace que la promo no se pueda armar (falla cerrado) y se muestra en la administración como «pendiente de completar» (PROPUESTA).

## 5. Combinaciones y enmienda de la regla

### 5.1 Dimensiones que cambian dinero, visibilidad o stock
M modo de la parte (`TODA_LA_SECCION`, `SOLO_ESTOS`) · F modo de la entrada, solo con `SOLO_ESTOS` (`FIJAS`, `A_ELEGIR`) · K tipo de plato (`SIN_GRUPOS`, `SOLO_OPCIONALES`, `CON_OBLIGATORIO`, `ADICIONAL_OBLIGATORIO`, `BASE_POR_OPCION`) · X lo elegido (`DENTRO`, `OPCION_FUERA`, `PLATO_FUERA`) · G opción en la sucursal (`ACTIVA`, `APAGADA`) · P plato en la sucursal (`DISPONIBLE`, `APAGADO`, `SIN_ORIGEN_DE_STOCK`) · Q total de la parte (`BAJO_MIN`, `EN_RANGO`, `SOBRE_MAX`) · R repetición (`DISTINTOS`, `MISMO_PLATO_X2`: se acepta, CONFIRMADA) · V versión de la opción (`VIGENTE`, `VIEJA`). Declaradas sin efecto: sucursal (la promo ya viene filtrada), quién es el mozo, medio de pago, precio local (cambia el importe, no lo que se acepta).

### 5.2 Reglas esperadas (gana la primera que se cumple)
1. `P ≠ DISPONIBLE` o `X = PLATO_FUERA` → se rechaza.
2. `K = ADICIONAL_OBLIGATORIO` → el plato no se ofrece y se rechaza.
3. `F = FIJAS` con opciones mandadas → se rechaza (`promo-combo.ts:319`).
4. `X = OPCION_FUERA` o `G = APAGADA` sobre la elegida → `OPCION_NO_PERMITIDA_EN_PROMO`.
5. `V = VIEJA` → `OPCION_CAMBIO`.
6. (`K = CON_OBLIGATORIO` o `BASE_POR_OPCION`) sin el mínimo del grupo → `OPCIONES_INVALIDAS`.
7. `Q ≠ EN_RANGO` → mensaje de mínimo o máximo.
8. Lo demás → se acepta; el total cobrado es siempre el precio de la promo; el reparto pondera por la configuración elegida.
Cambio frente a hoy: con `M = TODA_LA_SECCION` y `K ∈ {SOLO_OPCIONALES, CON_OBLIGATORIO, BASE_POR_OPCION}`, hoy las opciones no se pueden elegir (`PROMO_CON_OPCIONES` o entra sin opciones); con 3α se aplican las reglas de arriba. Imposibles (se declaran, no se prueban): `F` con `M = TODA_LA_SECCION`; `G` con `K = SIN_GRUPOS`; `X = OPCION_FUERA` con `K = SIN_GRUPOS`.

### 5.3 Prueba propuesta
La regla es pura (`core/pos`): exhaustivo (unos 3.240 casos brutos menos imposibles) contra una tabla escrita aparte (`docs/oraculo-combinaciones-promo-parte-de-seccion-2026-11-xx.md`, extendiendo `test/pos/promo-a-elegir.oraculo.ts`); contra Postgres real, un subconjunto por pares, concurrencia (dos agregados a la vez; el administrador cambia «Toda/Solo estos» mientras el mozo confirma) e idempotencia. Guardián: falla si aparece un valor nuevo en `TIPOS_DE_CUPO`, `modoDeOpciones` o `GrupoDeOpciones.tipo` sin declararlo. Mutaciones: dejar pasar un adicional → rojo; pesar con el precio guardado → rojo; abrir una lista vacía a «todos» → rojo. Sin librerías nuevas (`fast-check` ya se usa).

### 5.4 Qué parte de la regla vieja deja de valer
ADR-032 D-6 («en un cupo de sección sigue `PROMO_CON_OPCIONES`», línea 20) y el supuesto 9 de GO-2d (ADR-030:155) dejan de valer **para las partes de sección**. Se mantienen: el plato del día sigue sin opciones (ADR-032:51) y nunca se permite un adicional.

### 5.5 Enmienda propuesta (aprobada por el dueño el 2026-11-11)
«En una parte de promo armada por sección, el mozo elige las opciones de cada plato entre todas las disponibles (obligatorias y opcionales, nunca adicionales con recargo); el plato que no se puede armar (adicional obligatorio, grupo obligatorio sin opciones activas) no se ofrece. El precio de la promo es fijo y la elección solo cambia el reparto entre componentes.» Se aplica a ADR-030 (supuesto 9 de GO-2d) y ADR-032 (D-6) en E1b, junto con el código.

## 6. Etapas (cada una un PR chico y reversible)

| Etapa | Qué | Base de datos | Vuelta atrás |
|---|---|---|---|
| **E0** | Este documento (solo docs) | No | Revertir el PR |
| **E1a** | Núcleo puro: la elección por sección acepta opciones; oráculo exhaustivo; las propiedades viejas siguen idénticas sin opciones | No | Revertir |
| **E1b** | Servidor: lectura de «a elegir» implícitos de sección; `agregarItems` los valida y escribe; `PROMO_CON_OPCIONES` solo para lo no armable; enmienda de ADR-030/032; test de paridad selector-servidor | No | Revertir (la pantalla vieja no manda opciones) |
| **E1c** | POS: el selector pasa los grupos; en «Toda la sección» se eligen opciones por unidad (obligatorias y opcionales); «pedilo suelto» solo para lo no armable | No | Revertir |
| **E2a** | Comando `guardarParteDePromo` (parte y entradas en una transacción, auditado, «llevar al estado», `carta_promo_definir`, bloqueo de I12b) | No | Revertir |
| **E2b** | Pantalla: fila de sección con «Toda la sección / Solo estos platos» y tildado en la misma fila, todo nace sin tildar; fila «No está en la carta»; listas sin enganche con una sección se muestran como «otras partes»; se retira «Sumar un lugar» (`SUMAR_LUGAR_DE_LISTA_VISIBLE = false`, `cupos-de-promo.ts:21`); se reescribe la ayuda de «Cupos» (`promociones/page.tsx:199-200`). Captura real a 375 px y escritorio con los datos reales del dueño antes de aprobar | No | Revertir o prender el interruptor |
| E3 (solo si hace falta) | Columna de origen de la lista (alternativa C) | **REQUIERE AUTORIZACIÓN EXPRESA** (migración aditiva, `down.sql`, respaldo y ensayo) | `down.sql` |

### Paso FINAL obligatorio: verificación sobre la suite TOTAL
Línea de base: antes de tocar nada, en `main`, correr los 8 comandos y anotar resultados y tiempos; cualquier rojo previo se registra aparte. Después de cada etapa, en la MISMA corrida y todos limpios:
```
npx tsc --noEmit
npm run lint
npm run arquitectura
npm run analizar:muerto
npm test
npm run build
npm run plataforma:build
npm run test:e2e
```
Criterio de éxito: código 0 en los 8; knip con 0 hallazgos; ningún test salteado nuevo; specs nuevos a 1366×768 y 390 px con axe sin violaciones. e2e nuevos: `test/e2e/carta-promo-parte-de-seccion.spec.ts` y `test/e2e/pos-promo-seccion-con-opciones.spec.ts`. Specs existentes que tocan este flujo: `carta-promo-cupos-lista.spec.ts`, `carta-promo-solo-salon.spec.ts`, `pos-promo-combo.spec.ts`, `pos-promo-a-elegir.spec.ts`, `pos-mesa-opciones.spec.ts` (`:182-209` espera «Con tamaño: pedilo suelto»: cambia), `pos-dialogos.spec.ts`, `movil-pos-mesa.spec.ts`, `pos-menu-del-dia.spec.ts`. Unitarios que cambian: `test/pos/agregar-items-opciones.test.ts:162-164`, `elegir-opciones-estado.test.ts:237-238`, `armar-promo-estado.test.ts`, `promo-combo-consulta.test.ts`, `promo-combo-go3.propiedades.test.ts`, `test/carta/sumar-lugar-interruptor.test.tsx`, `agregar-entrada-de-lugar.test.tsx`.

## 7. Decisiones del dueño del 2026-11-11 (preguntas abiertas resueltas)
- **P1:** con «de 0 a 2» el mozo puede elegir el mismo plato dos veces (2x1). **CONFIRMADA.** No cambia el código actual.
- **P2:** en «Toda la sección», las opciones solo opcionales también se ofrecen y el mozo puede elegirlas («si no, no se las estás ofreciendo al cliente»). **CONFIRMADA.** Amplía el alcance de E1 respecto de la primera versión de este diseño.
- **P3:** una parte «Solo estos platos» sin plato tildado y con mínimo > 0 **se bloquea**. **CONFIRMADA.**
- **Principio «todo nace cerrado»:** una promo nace sin secciones tildadas; tildar una sección no tilda sus platos. **CONFIRMADA** como principio; su aplicación a las opciones permitidas es PROPUESTA y se confirma mirando la pantalla real en E2b.
- **Pregunta abierta nueva (PENDIENTE):** ninguna que frene E1.

## 8. Hallazgos aparte (vistos, sin tocar)
- H1. El `TypeError 'nombre' of null` de `src/server/consultas/carta/admin.ts` **no parece real**: `admin.ts:230` lee `pr.seccionCarta.nombre`, pero `PromoCarta.seccionCartaId` es obligatorio (`schema.prisma:2016`), la FK es `ON DELETE RESTRICT` y una sección nunca se borra, se apaga. NO VERIFICADA contra los logs de producción: si se vio, hace falta la traza completa.
- H2. El aviso de «peor caso» de `promociones/page.tsx:205-216` suma solo las partes de sección (`admin.ts:183`) y no cuenta las listas; el servidor sí las cuenta (`guardar-cupos-promo-carta.ts:79-82`): el aviso subestima el piso.
- H3. Comentarios viejos dicen que el código «solo sabe armar cupos de sección» (`cupos-de-promo.ts:2-7`, `admin.ts:181`): desde GO-3b no es así.
- H4. ADR-032 línea 20 en `main` todavía dice D-6 sin la enmienda del 2026-11-05, y el diseño del 04/11 no está en `main` (PR #161 abierto), pero el código «a elegir» ya está mergeado.
- H5. El peso del reparto de un plato de sección es el `precioVenta` guardado; para un producto «se vende por opción» no rige (ADR-035). Se vuelve real con el punto 3; cubierto por I8.
- H6. NO VERIFICADO: en el selector del POS una promo solo aparece si su propia sección está en la carta (`selector-carta.ts:302`); no se revisó si afecta a las promos «solo salón» con la sección apagada.
