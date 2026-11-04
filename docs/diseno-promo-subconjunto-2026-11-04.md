# Diseño: promo con productos permitidos y reservada a una empresa («empresa A, solo agua») — 2026-11-04

Pedido del dueño (2026-11-04, textual): «que la promoción pueda seleccionar productos dentro de secciones y opciones. Por ejemplo, si tengo una promo para empresa A y a ellos les doy solo agua, que el mozo no pueda equivocarse.»

**Estado: SOLO DISEÑO Y MAQUETA.** Nada se implementa hasta que el dueño lo apruebe viendo la maqueta (`/home/user/revision-del-dueno/promo-subconjunto/index.html`; en `docs/` solo se admiten archivos `.md`, así que la maqueta no se versiona acá). Sin código, sin migraciones, sin tests. Estados de cada decisión: **CONFIRMADA** (dicha por el dueño), **PROPUESTA**, **PENDIENTE**, **NO VERIFICADA**.

Fuentes leídas en el código real (rama `alegp/diseno-promo-subconjunto`, desde `origin/main` 94cbe18): `prisma/schema.prisma`, `src/core/pos/promo-combo.ts`, `src/server/actions/pos/casos-de-uso/agregar-items.ts`, `src/server/lecturas/pos/promo-para-agregar.ts`, `src/server/lecturas/pos/entradas-de-promo-para-vender.ts`, `src/server/actions/carta/casos-de-uso/guardar-cupos-promo-carta.ts`, `src/core/carta/promo-sucursal.ts`, `src/app/(pos)/mesas/[mesaId]/armar-promo.tsx`, más `docs/adr/ADR-032-combos-menu-del-dia-y-combinaciones.md`, `docs/diseno-clientes-convenios-y-facturacion-externa-2026-10-26.md` y `docs/diseno-promo-solo-salon-2026-10-26.md`. No se revisó el repositorio `motor2-docs` (no está en esta sesión): **NO VERIFICADA** la ausencia de un plan aprobado allí para este tema.

---

## 0. Resumen para el dueño (en lenguaje de proceso)

1. **Hoy ya se puede armar «solo agua»**: una promo con un lugar «Bebida» de tipo LISTA cuyas entradas son las aguas (sin gas, con gas…). El mozo, al armarla, solo ve esas aguas y el servidor rechaza cualquier otra. Eso responde la mitad del pedido (que el mozo no se equivoque de producto).
2. **Lo que NO existe**: que esa promo valga **solo para la empresa A**. Hoy la promo se ofrece a cualquier cuenta de la sucursal: un mozo puede venderla a quien no corresponde. Es lo que falta para «que el mozo no pueda equivocarse».
3. **«Elegir entre opciones permitidas» (agua con o sin gas) también ya existe** si cada variante es una entrada del lugar (una entrada por variante): el mozo elige entre ellas con mínimo y máximo. Lo que el diseño actual **no** permite es que el mozo arme libremente grupos de opciones (tamaño, extras) dentro de un combo: eso lo decidió ADR-032 (D-6) y tocarlo es una etapa grande y aparte.
4. **Propuesta más barata**: (a) hoy, sin código, armarla con LISTA + «solo salón»; (b) una sola tabla mínima, aditiva y reversible, que reserve la promo a uno o más clientes (la empresa A es un cliente), con la regla verificada en el servidor y el selector del mozo mostrando solo lo permitido; (c) cuando se implemente la etapa N1 de convenios, esa tabla se reemplaza por «oferta permitida del convenio» sin perder nada.
5. **Lo que queda para después, con nombre**: «algunos productos de una sección sin listarlos a mano» (etapa 3) y «el mozo elige opciones libres dentro del combo» (etapa 4).

---

## 1. Inventario: qué existe hoy y qué parte del pedido ya se resuelve

### 1.1 Lo que existe (verificado, con archivo y línea)

| Pieza | Dónde | Qué hace hoy |
|---|---|---|
| La promo y su interruptor «solo salón» | `prisma/schema.prisma:2008` (`PromoCarta`), `:2030` (`soloSalon`) | La promo es de la empresa; cada sucursal la prende (`PromoCartaSucursal`, `:2064`). `soloSalon` la saca de la carta pública y la deja en el POS. **No tiene ninguna columna ni relación con un cliente o empresa.** |
| El lugar de la promo (cupo) | `prisma/schema.prisma:2096` (`PromoCartaCupo`) | Tipos `SECCION` (todos los elegibles de una sección de la carta, los mismos que el selector del POS), `LISTA` (productos que arma el dueño, aunque no estén en la carta) y `DEL_DIA` (plato del día). Cada cupo tiene `cantidadMinima` y `cantidadMaxima`. |
| Las entradas de un lugar LISTA | `prisma/schema.prisma:2128` (`EntradaDeCupo`) y `:2151` (`OpcionDeEntradaDeCupo`) | Cada entrada es un producto con una **configuración fija opcional** de opciones («Café · Mediano · Con leche»). La identidad (cupo, producto, configuración) es inmutable; se desactiva, no se borra. |
| Quién elige y cuánto | `src/core/pos/promo-combo.ts:148`-`:259` (`validarEleccionPromo`, `validarYAplanarEleccionPromo`, `aplanarCupoDeEntradas`) | El mozo elige entradas y cantidades; el servidor exige mínimo y máximo, cantidades enteras, sin repetidos y **solo entradas elegibles hoy**. Una entrada que no es elegible se rechaza con «Esa opción de "<lugar>" no está disponible hoy en esta promo.» (`ENTRADA_NO_DISPONIBLE`, línea `:236`); un producto fuera de una sección se rechaza con «Ese producto no es una opción válida de "<sección>" en esta promo.» (`:213`). Un lugar de una sola entrada con mínimo = máximo es un **componente fijo** que completa el servidor (`esCupoFijo`, `:96`; `COMPONENTE_FIJO`, `:226`). |
| El servidor revalida todo al agregar | `src/server/actions/pos/casos-de-uso/agregar-items.ts:201` (carga la promo vigente), `:210` (valida la elección), `:205` (`PROMO_CAMBIO`: el precio cambió desde que la vio) | Dentro de UNA transacción SERIALIZABLE, todo o nada, con clave de reintento opcional (I3) y precio congelado al agregar. La promo se lee con `cargarPromoCartaParaAgregar` (`src/server/lecturas/pos/promo-para-agregar.ts`), con la **misma fuente** que el selector: nunca una lista paralela. |
| Lo elegible hoy en un lugar de entradas | `src/server/lecturas/pos/entradas-de-promo-para-vender.ts` | Una entrada es elegible si está activa, su producto está **disponible en la sucursal**, sigue pudiendo ser componente (producto de venta con precio de referencia y origen de stock: receta vigente en la sucursal o stock propio) y su configuración fija se arma hoy. Lo que no cumple queda afuera: el mozo no lo ve y, si lo manda igual, se rechaza. |
| El mozo no elige opciones dentro del combo | `docs/adr/ADR-032-combos-menu-del-dia-y-combinaciones.md` (D-6, línea 20) y `agregar-items.ts:223` (`PROMO_CON_OPCIONES`) | En un lugar de sección, un producto con grupo de opciones obligatorio no se arma en la promo; en un lugar LISTA solo entra con configuración **fija** del dueño. |
| La pantalla del mozo | `src/app/(pos)/mesas/[mesaId]/armar-promo.tsx` | Diálogo «Armar promo»: por lugar, los elegibles con −/+ y un contador «Bebida 1/1». «Agregar promo» queda deshabilitado hasta cumplir mínimos y máximos. Un lugar fijo se ve como «Viene con: …». |
| Pantalla del administrador | `src/app/(app)/carta/parametrizacion/promociones/` y `guardar-cupos-promo-carta.ts` (permiso `carta_promo_definir`, de empresa, piso administrador, `src/core/permisos/acciones.ts:75`) | Define cupos y entradas, con auditoría y reemplazo por estado (repetir no escribe nada). |
| Cliente con descuento en la cuenta | `prisma/schema.prisma:756` (`Cliente`), `Cuenta.clienteId` (modelo `Cuenta`, `:2303`) y `asignar-cliente-a-cuenta.ts` | Cualquier mozo con `pos_asignar_cliente` asigna o quita un cliente a una cuenta abierta; el % se congela. **Hoy el cliente no cambia qué promos se ofrecen.** |

### 1.2 Lo que el pedido necesita y NO existe

| Necesidad | ¿Existe? | Evidencia |
|---|---|---|
| Que la promo valga SOLO para la empresa A | **No** | `PromoCarta` no referencia a `Cliente`/`Convenio`; `wherePromoOfrecidaEn` (`src/core/carta/promo-sucursal.ts:16`) filtra solo por `activa`, sucursal y audiencia (carta pública o salón). |
| Convenio (la empresa A como «convenio») | **No** | No hay `Convenio` ni `Cuenta.convenioId` en `schema.prisma`; está solo en papel (`docs/diseno-clientes-convenios-y-facturacion-externa-2026-10-26.md`, tabla F «Etapa N1»). |
| Algunos productos de una SECCIÓN sin listarlos a mano | **No** | Un cupo `SECCION` ofrece **todos** los elegibles de su sección (`promo-para-agregar.ts`, bloque `deSeccion`); el único camino a «algunos» es un lugar LISTA con las entradas cargadas a mano. |
| El mozo arma libremente opciones (tamaño, extras) dentro del combo | **No, a propósito** | ADR-032 D-6. |

### 1.3 La lectura del coordinador, contrastada con el código

- (a) «La promo no puede reservarse a una empresa»: **correcta**.
- (b) «Elegir un subconjunto de los productos de una sección sin listarlos a mano»: **correcta**, pero hoy hay un camino sin código: LISTA con las entradas a mano. Para «solo agua» alcanza.
- (c) «El mozo ELIGE entre las opciones permitidas en vez de una configuración fija»: **matizada**. Si «con gas» y «sin gas» son productos distintos, o dos entradas del mismo producto con configuraciones fijas distintas, el mozo **ya elige** entre ellas (un lugar LISTA con dos entradas y mínimo 1, máximo 1). Lo que falta es solo la composición libre de grupos de opciones dentro del combo (D-6), que para «agua» no hace falta.

### 1.4 El caso «solo agua» con lo que existe hoy (paso a paso, sin código)

1. Administrador, en Promociones: nueva promo «Menú empresa A», precio fijo, **solo salón** activado (no sale en la carta pública: el precio pactado no queda publicado), prendida solo en la sucursal que atiende a esa empresa.
2. Un lugar «Bebida» de tipo LISTA, mínimo 1, máximo 1, con entradas «Agua sin gas» y «Agua con gas» (productos de venta con precio de referencia y origen de stock, como cualquier componente de combo: ADR-032 D-8/D-9).
3. El mozo, en la mesa, toca la promo, ve **solo** esas dos aguas y confirma. Un producto que no sea una de esas entradas lo rechaza el servidor.
4. **Lo que sigue sin impedirse**: cualquier mozo puede vender «Menú empresa A» a cualquier cuenta, aunque no sea de la empresa A. Ese es el agujero que este diseño cierra.

---

## 2. Escalera de diseño (niveles 1 a 5)

### Nivel 1. Propósito y alcance
- **Propósito (CONFIRMADA, texto del dueño):** que una promo ofrezca solo lo permitido y que el mozo no pueda equivocarse. Ejemplo: empresa A, solo agua.
- **Necesidad escrita:** el pedido del dueño del 2026-11-04 y, más atrás, «marcar para qué cliente o agencia es un menú» (pendientes 2026-10-22, 14.ª parte, citado en `docs/diseno-clientes-convenios-y-facturacion-externa-2026-10-26.md`, «Se solapa») y la respuesta H3 del dueño del 2026-10-26: «precio pactado = una promoción propia del convenio, solo salón y solo para ese cliente» (CONFIRMADA).
- **Fuera de alcance (PROPUESTA):** descuentos por cliente o categoría, convenios completos (cuenta restringida, tope, cuenta corriente), facturación externa, composición libre de opciones dentro del combo.

### Nivel 2. Actores y contexto
| Actor | Qué hace | Permiso (hoy / propuesto) |
|---|---|---|
| Administrador de la empresa | Arma la promo, sus lugares y a quién se reserva | `carta_promo_definir` (empresa, piso administrador). **PROPUESTA:** la reserva a clientes se cambia con el mismo permiso: sin clave nueva. |
| Gerente o administrador de sucursal | Prende la promo en su sucursal | `carta_promo_activar` (sucursal, piso administrador), sin cambios. |
| Mozo | Asigna el cliente a la cuenta y arma la promo | `pos_asignar_cliente` (hoy cualquier mozo) y `pos_tomar_pedido` (piso operario). |
| Sistema (servidor) | Revalida todo al agregar | — |
- **Contexto técnico:** `Cliente` es de empresa; `Cuenta` hereda la sucursal de `Mesa`; la promo se ofrece por sucursal; el día es el de la zona de la empresa; módulo `promociones` requerido (sin él ni se ofrece ni se acepta).
- **Riesgo de permisos NO VERIFICADO como deseado por el dueño:** como cualquier mozo puede asignar cualquier cliente a la cuenta (`pos_asignar_cliente`), reservar una promo a un cliente evita **equivocarse**, no **abusar**: un mozo podría asignar «empresa A» a un cliente que no lo es para darle el menú. El diseño de convenios ya previó esto: la clave `pos_asignar_convenio` con semilla solo `admin` (tabla F de ese documento). Ver pregunta 2.

### Nivel 3. Casos de uso
| # | Caso de uso | Etapa |
|---|---|---|
| CU1 | Armar una promo «solo agua» (lugar LISTA con entradas) | N0, existe hoy |
| CU2 | Reservar una promo a uno o más clientes (llevar al estado) | N1 |
| CU3 | Ver la promo en el selector del mozo solo si la cuenta tiene un cliente permitido | N1 |
| CU4 | Agregar la promo a una cuenta: el servidor revalida producto, cliente, cantidad y disponibilidad | N0 existe; la parte «cliente» es N1 |
| CU5 | Asignar, cambiar o quitar el cliente de una cuenta que ya tiene una promo reservada | N1 (regla nueva) |
| CU6 | Declarar «algunos» productos de una sección como los permitidos de un lugar | N3 |
| CU7 | El mozo elige opciones libres dentro del combo | N4 (no recomendada) |

### Nivel 4. Conceptos y ciclo de vida
- **Promo reservada:** una promo con al menos un cliente permitido activo. **Sin ningún cliente permitido activo, la promo no está reservada** (lo de siempre: ofrecida a todos). Ese es el único comportamiento que no falla cerrado; ver riesgo en el nivel 5, I2, y la decisión de diseño de la pregunta 3.
- **Cliente permitido:** el par (promo, cliente). Se agrega o se da de baja (`activa`); **nunca se borra**.
- **Subconjunto** (etapa 3): de un lugar de sección, la lista de productos que de verdad se ofrecen. Modo `TODOS` (lo de hoy) o `ALGUNOS`; con `ALGUNOS` y ninguno activo, el lugar queda sin elegibles (falla cerrado).
- **Ciclo:** `Promo armada` → `reservada a clientes` → `ofrecida en la sucursal` → `agregada a una cuenta` (precio y componentes congelados, I5). Lo ya agregado no cambia si después se reserva, se da de baja un cliente o se apaga un producto.

### Nivel 5. Invariantes y políticas
| # | Invariante | Lo impone | Estado |
|---|---|---|---|
| I1 | Un componente que no sea elegible hoy en el lugar nunca entra a la cuenta | `validarYAplanarEleccionPromo` (`promo-combo.ts`), ya existente, sobre la misma fuente del selector | EXISTE |
| I2 | Una promo reservada solo se ofrece y solo se acepta si la cuenta tiene asignado un cliente permitido activo; con cuenta sin cliente, **no se ofrece ni se acepta** | `cargarPromoCartaParaAgregar` (servidor) y el selector con el MISMO filtro (fail-closed) | PROPUESTA |
| I3 | El rechazo de una promo reservada no revela que existe ni para quién es: mismo mensaje que «no se encontró esa promo, o ya no está disponible» (`PROMO_INVALIDA`) | caso de uso | PROPUESTA |
| I4 | El precio de la promo y los componentes se congelan al agregar; cambiar la reserva después no toca lo cargado | lectura al agregar, nunca al cerrar (como la vigencia, ADR-032 D-7) | EXISTE para el precio; PROPUESTA para la reserva |
| I5 | No se puede quitar o cambiar el cliente de una cuenta que tiene una promo reservada vigente cargada sin antes quitar esa promo (evita «agregar con A y cobrar a B») | caso de uso `asignarClienteACuenta`, con la cuenta tomada con `FOR UPDATE` | PROPUESTA |
| I6 | Una promo reservada que además es de «solo salón» nunca sale en la carta pública | `wherePromoOfrecidaEn(…, "publico")` ya existente | EXISTE (la reserva exige «solo salón» en la pantalla: PROPUESTA) |
| I7 | La reserva no se borra: se da de baja (`activa = false`) y toda alta, baja o cambio deja auditoría en la misma transacción | privilegios sin DELETE; `registrarCambioAuditado` | PROPUESTA |
| I8 | Todo se valida en el servidor; nada de lo que manda el cliente web (cliente, producto, precio) se toma sin revalidar | `agregarItems` | EXISTE |
| I9 | Aislamiento por empresa | RLS `aislamiento_empresa` y FK compuestas `(empresaId, x)` | PROPUESTA (misma regla de todas las tablas nuevas) |

**Políticas:** `carta_promo_definir` para reservar (empresa, administrador, semilla `admin`); `pos_tomar_pedido` para agregar (sin cambios); quien asigna el cliente sigue siendo `pos_asignar_cliente` (**pendiente de decisión**, ver pregunta 2). Con el módulo `promociones` apagado nada se ofrece ni se acepta, como hoy.

---

## 3. Qué es lo MÁS BARATO (propuesta) y la etapa posterior con nombre

**Orden propuesto (PROPUESTA; «primero lo más barato»):**

| Peldaño | Qué se hace | ¿Tabla/columna? | Resuelve |
|---|---|---|---|
| **N0 — hoy, sin código** | Armar la promo con un lugar LISTA «Bebida» (las aguas como entradas), «solo salón», prendida solo en la sucursal que corresponde | Ninguna | El mozo solo ve esas aguas; el servidor rechaza otra cosa. **No impide venderla a otro cliente.** |
| **N1 — la más barata que cierra el agujero** | Reservar la promo a uno o más clientes (la empresa A es un `Cliente`). Selector y servidor ofrecen y aceptan la promo solo en cuentas con un cliente permitido; I2, I3, I5 | **Una** tabla mínima, aditiva y reversible: `PromoCartaCliente` (ver §6, solo en papel) | «Empresa A, solo agua», sin que el mozo pueda equivocarse de empresa |
| N2 — convenio completo | Implementar la etapa N1 del diseño de convenios (`Convenio`, `ConvenioOferta`, `Cuenta.convenioId`, permisos propios, cuenta restringida a ofertas pactadas) | Las del diseño del 26/10 | Además: la cuenta de la empresa A solo admite lo pactado (hoy otro producto suelto sí entra) y asignación con permiso de administrador |
| N3 — algunos productos de una sección | Un lugar de sección con modo `ALGUNOS` | Una columna en `PromoCartaCupo` y una lista permitida | «Solo estas 3 aguas de la sección Bebidas», sin listar como entradas |
| N4 — opciones libres dentro del combo | Revisar ADR-032 D-6 | Sí, grande | El mozo arma tamaño y extras dentro de un combo |

**Por qué N1 y no ir directo a convenios (PROPUESTA):** el convenio completo es un bloque grande (tres objetos nuevos, dos claves, módulo, cuenta caliente del POS). Para «empresa A, solo agua» alcanza con una relación promo↔cliente. Cuando llegue N2, `PromoCartaCliente` se reemplaza por `ConvenioOferta` copiando cada fila a «el convenio activo de ese cliente»: **no hay trabajo perdido ni dato huérfano**, y el diseño del 26/10 no se duplica (la «oferta del convenio» sigue siendo UNA promo propia, H3). Qué parte del diseño del 26/10 habría que implementar **antes** si el dueño prefiere ir directo: sus pasos 1 a 4 de la Fase 5 (núcleo puro, `Convenio`/`ConvenioOferta`, asignación con `FOR UPDATE` y `agregarItems` con la regla I4 de ese documento); la otra opción es hacer N1 ahora.

**Qué NO hacer (PROPUESTA):** no crear una clave de permiso nueva (alcanza `carta_promo_definir`), no tocar el cierre de cuentas ni los goldens de venta, no tocar la carta pública.

---

## 4. «El mozo no puede equivocarse»: cómo queda garantizado

1. **Selector del mozo (comodidad, no seguridad):** el diálogo «Armar promo» solo ofrece las entradas elegibles hoy del lugar (como hoy). Con N1, la promo reservada **no aparece** en el selector de una cuenta sin cliente permitido; aparece cuando el mozo asigna el cliente.
2. **Servidor (la defensa real, fail-closed):** `agregarItems` vuelve a leer la promo con `cargarPromoCartaParaAgregar` dentro de la transacción SERIALIZABLE y la revalida con la **misma** función de siempre. Con N1, esa lectura además exige, para una promo reservada, que `Cuenta.clienteId` esté entre los clientes permitidos activos.
3. **Intento de agregar otra cosa:**
   - producto que no es una entrada del lugar: «Esa opción de "Bebida" no está disponible hoy en esta promo.» (existe, `ENTRADA_NO_DISPONIBLE`);
   - promo reservada en una cuenta sin cliente o con otro cliente: el mismo mensaje que una promo inexistente: «No se encontró esa promo, o ya no está disponible.» (`PROMO_INVALIDA`, existe). No revela para quién es.
4. **Concurrencia, repetición, cambio de permisos:** ver las tablas «¿qué pasa si…?» de abajo.

### Tabla «¿qué pasa si…?» — comando «Reservar la promo a clientes» (CU2, administrador)

| Situación | Resultado propuesto |
|---|---|
| Repetición o doble clic | Por estado: llevar al estado pedido; repetir no escribe ni audita nada (como `guardarCuposPromoCarta`) |
| Concurrencia | SERIALIZABLE con reintento; dos administradores que reservan lo mismo: el segundo ve el estado y no cambia nada; uno que quita y otro que agrega: ganan los dos en orden (cada cliente es una fila con clave natural `(promo, cliente)`) |
| Tiempo o vigencia | Sin vigencia propia: rige la de la promo (`vigenteDesde`/`vigenteHasta`/`diasDeSemana`). Cambiar la reserva no toca lo ya agregado (I4) |
| Incertidumbre | Si la reserva tiene clientes dados de baja y ninguno activo, la promo **deja de estar reservada**: se ofrece a todos. Para evitarlo en silencio, la pantalla avisa «esta promo no tiene ningún cliente activo: se ofrecerá a todos» (pregunta 3: ¿es lo que el dueño quiere?) |
| Reintento | Mismo resultado: por estado |
| Error parcial | Alta, bajas y auditoría en UNA transacción: todo o nada |
| Datos faltantes | Cliente inexistente o desactivado: rechazo con mensaje; sin cliente en el pedido: no cambia nada |
| Cambio de permisos | `carta_promo_definir` se verifica en el servidor; un administrador sin ese permiso no reserva; el cambio de permisos no afecta lo ya cargado |

### Tabla «¿qué pasa si…?» — comando «Agregar la promo a la cuenta» (CU4, mozo)

| Situación | Resultado |
|---|---|
| Repetición o doble clic | Con clave (I3): exactamente una vez; el reintento devuelve el mensaje original (existe) |
| Concurrencia | Dos mozos agregando a la misma cuenta: SERIALIZABLE; ambos agregan (son dos intenciones). **Nuevo:** asignar el cliente contra agregar la promo reservada: se ordenan por la fila de la cuenta; el segundo ve el estado nuevo |
| Tiempo o vigencia | La promo y la reserva se evalúan al agregar con «hoy» de la empresa (`promoVigenteEl`); lo ya cargado no cambia (I4) |
| Incertidumbre | Producto apagado o sin origen de stock entre que lo vio y que confirma: `ENTRADA_NO_DISPONIBLE` y no se agrega nada; precio cambiado: `PROMO_CAMBIO` |
| Reintento tras corte de red | Mismo mensaje original; no duplica ítems |
| Error parcial | Todo o nada: ninguna `PromoCuenta` ni `CuentaItem` si algo no valida |
| Datos faltantes | Cuenta sin cliente y promo reservada: rechazo (I2, I3) |
| Cambio de permisos | Se pide `pos_tomar_pedido` en el servidor; si lo pierde a mitad de camino, el siguiente pedido se rechaza; lo ya agregado queda |

### Tabla «¿qué pasa si…?» — comando «Asignar, cambiar o quitar el cliente de la cuenta» (CU5, mozo) — regla nueva I5

| Situación | Resultado propuesto |
|---|---|
| La cuenta tiene una promo reservada vigente cargada y se quiere quitar o cambiar el cliente | Rechazo: «Esta cuenta tiene una promo reservada. Quitala antes de cambiar el cliente.» (PROPUESTA) |
| La cuenta no tiene promo reservada | Como hoy |
| Doble clic / reintento | Como hoy (reasignar el mismo cliente no escribe auditoría nueva) |
| Concurrencia con agregar la promo | Se ordenan por la fila de la cuenta (SERIALIZABLE): o se asigna y después se agrega, o se agrega con el cliente viejo y el cambio ya ve la promo y se rechaza |
| Cambio de permisos | `pos_asignar_cliente` se verifica en el servidor (hoy cualquier mozo; pregunta 2) |

---

## 5. Relación con el diseño de convenios del 26/10 (no se duplica)

- La «oferta del convenio» del 26/10 es **una promo propia** (respuesta H3, CONFIRMADA), con «solo salón» ya implementado y «reservada a convenio» pendiente. Este diseño es esa segunda mitad, en su forma mínima: reservar a **clientes** en lugar de a **convenios**.
- `PromoCartaCliente` (N1) es la versión «sin convenio» de `ConvenioOferta`. Migración futura: por cada fila `(promo, cliente)`, crear (si no existe) el convenio activo de ese cliente y su `ConvenioOferta`. Por eso la tabla nace con las mismas reglas que `ConvenioOferta`: baja lógica (nunca DELETE), único `(promo, cliente)`, FK compuestas con la empresa, auditoría.
- **Lo que el convenio agrega y N1 NO da:** que la cuenta de la empresa A solo admita lo pactado (I4 del 26/10), el permiso propio de asignar convenio (`pos_asignar_convenio`, semilla solo `admin`) y el tope y la cuenta corriente. Si el dueño quiere ya «que a la empresa A no se le pueda vender otra cosa», es N2, no N1 (pregunta 1).
- **Qué habría que implementar antes de N2** (Fase 5 del 26/10): núcleo puro de «qué beneficio tiene la cuenta» y «esta oferta entra en este convenio»; `Convenio` y `ConvenioOferta` con auditoría y versión; el caso de uso hermano de `asignarClienteACuenta`; y la regla en `agregarItems`.

---

## 6. Tablas y columnas (EN PAPEL; nivel 6 solo después de que el dueño confirme los niveles 1 a 5)

Regla de la casa: ninguna tabla sin necesidad; solo la mínima, aditiva y reversible. **No se migra nada de esto en este paso.**

**N1 — `PromoCartaCliente` (NUEVA, PROPUESTA, la única para el caso pedido)**

| Campo | Regla |
|---|---|
| `id`, `empresaId` (default `app_empresa_actual()`) | como el resto de las tablas de empresa; RLS `aislamiento_empresa` |
| `promoCartaId` | FK compuesta `(empresaId, promoCartaId)` → `PromoCarta`, RESTRICT |
| `clienteId` | FK compuesta `(empresaId, clienteId)` → `Cliente`, RESTRICT |
| `activa` | BOOLEAN, DEFAULT true: la baja lógica |
| `creadoPorId`, `creadoEn`, `actualizadoEn` | trazabilidad |
| Único `(promoCartaId, clienteId)`; sin DELETE; UPDATE solo de `activa` y `actualizadoEn` | solo agrega |
| `down.sql` | aborta si hay filas (precedente de las demás migraciones) |

Clasificación `DE_EMPRESA`. Sin columnas nuevas en `Cuenta` ni en `PromoCarta` (la promo está «reservada» si tiene al menos una fila activa: **sin interruptor propio**, decisión de ahorro; ver la pregunta 3 por el riesgo).

**N3 — solo si el dueño confirma que necesita «algunos de una sección»:** `PromoCartaCupo.elegibles` TEXT NOT NULL DEFAULT `'TODOS'` CHECK `('TODOS','ALGUNOS')` más una lista permitida. Dos alternativas, a decidir después: una tabla mínima `ProductoPermitidoDeCupo (cupo, producto, activa)`, o reutilizar `EntradaDeCupo` con configuración vacía. **PROPUESTA: tabla mínima propia**, para no recargar el significado de `EntradaDeCupo` (cuyas entradas deben ser productos de venta con precio de referencia y origen de stock; una lista de permitidos de una sección no necesita eso porque la sección ya filtra). `ALGUNOS` sin ningún permitido activo = **ningún elegible**: falla cerrado, nunca «todos».

**N4:** no se diseña (NO recomendada hasta que haya un caso real).

---

## 7. Escalera de producto N0 a N5 (lo que ve el cliente)

| Peldaño | El cliente ve | Se muestra «pendiente» si falta |
|---|---|---|
| N0 | Armar una promo con un lugar de aguas y venderla; solo salón | — |
| N1 | En la promo, «Reservada a: Empresa A». En el mozo, la promo aparece al asignar a esa empresa | Promo sin clientes: «Se ofrece a todos» (explícito) |
| N2 | Convenio con ofertas pactadas; la cuenta solo admite lo pactado | Convenio sin ofertas: «no se puede vender nada» |
| N3 | En un lugar de sección: «Todos» o «Algunos»: se tildan los productos | Sin ninguno tildado: «ningún producto: la promo no se puede armar» |
| N4 | El mozo elige tamaño y extras dentro del combo | — |
| N5 | Reporte de consumo por empresa (qué promos reservadas se vendieron, cuántas y a qué cliente) | Cuenta sin cliente: «sin cliente» |

Formalidad y detalle son ejes separados: cada peldaño suma sin romper lo cargado; lo que falta se marca «pendiente de completar».

---

## 8. Oráculo de combinaciones (dimensiones y reglas escritas aparte; sin test todavía)

**Dimensiones que cambian el resultado (dinero, permisos, visibilidad o stock):**

| Dim. | Valores | Qué representa |
|---|---|---|
| **T** tipo de lugar | `SECCION` · `LISTA` · `DEL_DIA` | De dónde salen los elegibles |
| **S** subconjunto | `TODOS` · `ALGUNOS` · `NINGUNO` | Todo lo elegible, una parte, o ninguno (algunos con cero activos) |
| **O** opciones | `FIJAS` · `A_ELEGIR` | Configuración fija del dueño o el mozo elige entre permitidas (solo N4) |
| **C** cliente | `PROMO_LIBRE` · `RESERVADA_SIN_CLIENTE` · `RESERVADA_CLIENTE_PERMITIDO` · `RESERVADA_OTRO_CLIENTE` | Promo no reservada; reservada y la cuenta sin cliente; reservada y cliente permitido; reservada y otro cliente |
| **P** producto en la sucursal | `DISPONIBLE` · `APAGADO` · `SIN_ORIGEN_DE_STOCK` | Producto disponible, apagado en la sucursal, o sin receta ni stock propio |
| **Q** cantidad | `BAJO_MINIMO` · `EN_RANGO` · `SOBRE_MAXIMO` | Contra mínimo y máximo del lugar |
| **E** lo elegido | `DENTRO` · `FUERA` | Está o no entre lo permitido del lugar |

**Combinaciones imposibles (marcadas, no probadas):** `DEL_DIA` no tiene subconjunto propio ni opciones a elegir; `SECCION` y `DEL_DIA` no admiten `A_ELEGIR` en v1; `E = FUERA` solo existe si hay algo permitido a lo que oponerse (con `NINGUNO` todo es fuera).

**Reglas esperadas (el resultado de cada combinación):**
1. Se **acepta** si y solo si: la promo está ofrecida hoy en la sucursal (vigencia, activa, módulo) **y** (`C = PROMO_LIBRE` **o** `C = RESERVADA_CLIENTE_PERMITIDO`) **y** `P = DISPONIBLE` **y** `E = DENTRO` **y** `Q = EN_RANGO`.
2. Se **rechaza** sin escribir nada en cualquier otro caso. Códigos esperados: `C` = reservada sin cliente u otro cliente → `PROMO_INVALIDA` (mensaje genérico, I3); `P ≠ DISPONIBLE` o `E = FUERA` en un lugar de entradas → `ENTRADA_NO_DISPONIBLE`; `E = FUERA` en un lugar de sección → «Ese producto no es una opción válida…»; `Q ≠ EN_RANGO` → mensaje de mínimo o máximo.
3. `S = NINGUNO` con mínimo mayor que 0: **la promo no se puede armar** (falla cerrado), nunca «todos».
4. **C no cambia** el resultado cuando falla otra condición: el mensaje de la promo reservada es el genérico aunque además el producto esté mal (no se filtra información).

**Cómo se prueba (nivel 10, después de la aprobación):**
- La regla de elegibilidad es una función **pura** (`core/pos`): se recorre el producto cartesiano **completo** de las dimensiones válidas contra una tabla escrita aparte (un oráculo legible en `docs/`), igual que `oraculo-combinaciones-compras-etapa-1`/`2a`. Con 3×3×2×4×3×3×2 = 1296 combinaciones crudas, menos las imposibles, es exhaustivo y barato (solo lógica pura).
- Contra Postgres real: un subconjunto representativo por pares (tipo × cliente × producto), más concurrencia (dos agregados a la vez, asignar cliente contra agregar) e idempotencia (misma clave repetida).
- **Guardián de dimensiones nuevas:** falla si aparece una columna, opción o clave nueva en la regla (`PromoCartaCliente`, un modo de subconjunto) sin declarar si afecta o no, con el patrón de `test/arquitectura/combinaciones-*-declaradas.test.ts`.
- Mutaciones: sacar el chequeo de cliente → rojo; abrir `NINGUNO` a «todos» → rojo.

**Dimensiones que NO cambian el resultado** (para declarar con su motivo): sucursal de la cuenta (la promo se ofrece por sucursal ya filtrado antes), el mozo que la arma (mismo permiso), el medio de pago (no interviene), el precio local de la promo (cambia el importe, no la elegibilidad), la hora del día fuera de la vigencia declarada.

---

## 9. Nivel 6 a 10: lo que queda para después de la aprobación

- **Nivel 6 (persistencia):** solo lo de §6. Compuerta: no se diseña ni migra sin que el dueño confirme los niveles 1 a 5.
- **Nivel 7 (atomicidad y concurrencia):** `agregarItems` y `asignarClienteACuenta` ya son SERIALIZABLE; la regla nueva se lee **adentro** de la misma transacción, con la fila de la cuenta tomada con `FOR UPDATE` para ordenar asignar contra agregar.
- **Nivel 8 (acceso e interfaces):** una sola pantalla nueva en la administración de la promo («Reservada a»), con la primitiva de casillas existente y aviso de «sin clientes: se ofrece a todos»; en el POS, ningún control nuevo: la promo aparece o no.
- **Nivel 9 (consultas):** el selector del POS y la lectura para agregar comparten el filtro (paridad con test, como `promo-combo-consulta`).
- **Nivel 10 (pruebas, migración, operación):** §8; migración aditiva con `down.sql` que aborta si hay filas; **aplicación a cualquier base real solo con autorización expresa, respaldo y ensayo** (`docs/deploy-con-migraciones.md`).

---

## 10. Preguntas para el dueño (máximo 5, ordenadas por impacto en modelo, dinero y permisos)

1. **¿«Que el mozo no pueda equivocarse» es solo que la promo no se ofrezca a otras empresas, o también que a la cuenta de la empresa A no se le pueda vender nada más?** (modelo y dinero). Lo primero es N1 (una tabla). Lo segundo es el convenio completo (N2: cuenta restringida). *Recomendación: N1 ahora; N2 cuando haya más de una empresa con convenio.*
2. **¿Quién puede asignar la empresa A a una cuenta?** (permisos y dinero). Hoy cualquier mozo con `pos_asignar_cliente`; un mozo podría poner «empresa A» a quien no lo es para darle el menú. *Recomendación: dejarlo así en N1 (se evita el error, no el abuso) y pasar la asignación a administrador (clave propia, como `pos_asignar_convenio` del 26/10) cuando se haga el convenio.*
3. **Si una promo reservada se queda sin ningún cliente activo, ¿se ofrece a todos o a nadie?** (modelo y dinero). La opción más barata la deja ofrecida a todos (sin columna); la segura agrega un interruptor «reservada» (una columna) para que sin clientes sea «a nadie». *Recomendación: agregar el interruptor «reservada» (una columna, fail-closed): un menú pactado no tiene que volverse público porque se dio de baja a un cliente.*
4. **¿Necesitás «algunos productos de una sección» sin listarlos uno por uno?** (modelo). Para «solo agua» la lista a mano alcanza. *Recomendación: no construirlo ahora; es la etapa N3 con una tabla mínima, solo si aparece un caso con muchos productos que cambian seguido.*
5. **¿El cliente «empresa A» tiene descuento propio (%)?** (dinero). Hoy una cuenta con cliente aplica ese % al cerrar y **no verifiqué (NO VERIFICADA) si ese % se aplica también a las líneas de una promo**; el diseño de convenios previó que no (un solo beneficio por ticket). *Recomendación: cargar a la empresa A con 0 % y que el precio sea el de la promo.*

---

## 11. Riesgos y pendientes

- **NO VERIFICADA:** si el % del cliente se aplica a las líneas de una promo al cerrar (pregunta 5); si existe en `motor2-docs` un plan aprobado sobre este tema; cuántos clientes y empresas se cargaron como `Cliente` hoy (no se leyó ninguna base).
- Sin `Cliente.tipo` (persona o empresa) hoy: la «empresa A» es un `Cliente` más; el discriminador llega con el N3 del diseño de convenios.
- No se tocó código, tests, migraciones, Neon ni Vercel. La maqueta usa datos de ejemplo marcados como tales.
