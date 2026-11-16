# Caja y cobro, etapa C3: cuenta de cobro, marcas de tarjeta y datos del cobro (como Pedernal)

**Fecha:** 2026-11-16. **Estado:** construido en LOCAL (rama `caja-c3-local`), sin aplicar a ninguna base real. **Documentos hermanos:** `diseno-caja-y-cobro-paridad-pedernal-2026-11-16.md` (etapas), `...-auditoria-2026-11-16.md`, `...-escalera-2026-11-16.md` (niveles 1 a 5).
**Pedido del dueño (2026-11-16, literal):** «Caja: cierre del día y cuenta de cobro» «como las decidió Pedernal, una por vez, en local y sin aplicar nada a ninguna base». Esta etapa es solo la parte «cuenta de cobro» (y lo que la acompaña en Pedernal: marcas de tarjeta y datos opcionales del cobro). El cierre del día es la etapa C2 (otro turno).

Marcas: **(M)** leído en el código real de Motor2 (rama `caja-c1-local`, `9518897f`); **(P)** leído en Pedernal público (`ZuluHub-ERP` `migraciones/0027_caja.sql`, `src/modulos/caja/`, `src/modulos/ventas/dominio/cobranza.ts`; `ZuluHub-docs` `11-especificaciones/conceptos/*.md`). **NO VERIFICADO** = no lo leí.

## 1. Alcance (solo esto; todo nace cerrado)

1. **CuentaDeCobro**: terminal, QR o cuenta bancaria de UNA sucursal; nombre de 1 a 60 por lista de permitidos; identificador externo opcional (número de terminal o alias, nunca credenciales); único por (empresa, nombre sin mayúsculas); se desactiva y reactiva, nunca se borra; opcional en el cobro. Compatibilidad con el tipo de medio (tabla de Pedernal).
2. **Arqueo por (medio, cuenta)**: «sin cuenta» es un grupo más. Aditivo: columna nueva opcional y el índice único pasa a incluir la cuenta con `NULLS NOT DISTINCT`.
3. **Marcas de tarjeta**: lista global `ValorDeLista` (lista `MARCAS_DE_TARJETA`: Visa, Mastercard, American Express, Cabal, Naranja X y «Otra» fija). La escribe la plataforma; la app solo lee. No se construyó la consola ni su pantalla.
4. **Datos del cobro**: el medio pide o no cada dato (cupón, últimos 4, marca, cuotas, DNI; todos apagados al nacer; techo por tipo) y el cobro guarda los datos tipados. «Obligatorio» por dato **no entra** (Pedernal lo diseñó y no lo construyó).
5. **Casos de uso** (reciben al actor; sin pantallas, Server Actions ni permisos): `crearCuentaDeCobro`, `editarCuentaDeCobro`, `desactivarCuentaDeCobro`, `reactivarCuentaDeCobro`, `crearMedioDePago`, `editarMedioDePago`, `desactivarMedioDePago`, `reactivarMedioDePago`, y `cobrarCuenta` (C1) extendido. Caso de lectura: `listarMarcasDeTarjeta`.

**No entra:** ARCA, cobro en partes, propina, obligatoriedad por dato, consola de plataforma, pantallas, permisos, la lista `MOTIVOS_DE_RECHAZO` (es de compras).

## 2. Auditoría breve contra Pedernal

| Tema | Pedernal (P) | Motor2 C3 | Estado |
|---|---|---|---|
| Tipos de cuenta | `TERMINAL`, `QR`, `CUENTA_BANCARIA` | iguales (CHECK) | IGUAL |
| Cuenta ↔ medio | débito y crédito → TERMINAL; QR → QR o TERMINAL; transferencia → CUENTA_BANCARIA; otro → los tres; efectivo → ninguna | la misma tabla, en TypeScript (`CUENTAS_ADMITIDAS`) y en la base (`CuentaDeCobro_admitida_por_medio`); una prueba compara las dos y el oráculo | IGUAL |
| Cuenta opcional | decisión 151: «sin cuenta» es un grupo del arqueo | igual | IGUAL |
| Sucursal de la cuenta | `sucursal_id NOT NULL`, una sola | igual | IGUAL |
| Nombre de cuenta | 1 a 60, lista de permitidos de la explicación del cierre, único sin mayúsculas | 1 a 60, lista de permitidos propia (`A-Za-z0-9`, tildes de uso común, espacio y `. _ / -`; ya usada por C1 en `MedioDePago`/`Caja`), único sin mayúsculas | DIFIERE: la lista es la de C1 (más corta que la de Pedernal). Motivo: coherencia con las tablas de C1 y «todo nace cerrado»; ampliarla es cambiar una expresión regular y su CHECK. PROPUESTA, pregunta Q-C3-1 |
| Identificador externo | `^[A-Za-z0-9 ._/-]{1,40}$` | igual, y sin blancos en los extremos | IGUAL |
| Tipo inmutable | disparador | disparador | IGUAL |
| Editar cuenta | nombre, identificador y sucursal, con versión optimista | igual (versión + `UPDATE` condicionado) | IGUAL |
| Alta idempotente | por estado (la misma cuenta activa = `yaExistia`; otra cosa con ese nombre = `CUENTA_DUPLICADA`) | igual | IGUAL |
| Qué datos pide cada medio | `pide_cupon/ultimos4/marca/cuotas/dni`, todos `false`, CHECK por tipo (efectivo/QR/otro ninguno; débito cupón+últimos 4+marca; crédito además cuotas; transferencia solo DNI) | igual (`MedioDePago_datos_chk`) | IGUAL |
| Datos tipados del cobro | `cupon` (regla sin número de tarjeta), `ultimos4 char(4)`, `marca_de_tarjeta_id`, `cuotas` 1 a 36, `dni` 6 a 9 dígitos | iguales, con los mismos CHECK; en la tabla `Cobro` | DIFIERE (lugar): Pedernal los guarda en su tabla `cobro` 1 a 1 con el movimiento; Motor2 ya tenía `Cobro` como renglón de la `Cobranza` (C1) y los guarda ahí. Motivo: datos existentes (C1) |
| Dato no pedido por el medio | disparador `cobro_validar_alta` | disparador `Cobro_validar` (reemplaza el de C1) | IGUAL |
| Marca activa al cobrar | disparador + dominio (`NO_DISPONIBLE`) | igual | IGUAL |
| Cupón | primitiva (largo, permitidos, Luhn) + base (sin espacios, sin 13 dígitos seguidos tras quitar separadores) | las dos reglas juntas en el núcleo, el CHECK en la base | IGUAL en resultado |
| DNI | TypeScript `^[1-9][0-9]{5,8}$`; base `^[0-9]{6,9}$` | igual (el TypeScript es más estricto que la base, como en Pedernal) | IGUAL |
| Auditoría del cobro | solo la lista de datos completados | igual (en la `descripcion`: «datos completados: cupon, ultimos4»), y la cantidad de renglones con cuenta | IGUAL |
| Huella del cobro | `[medio, cuenta, importe]` + datos solo si hay alguno | `[medio, importe]` (forma de C1) + `[cuenta, datos]` solo si el renglón trae cuenta o datos | DIFIERE (forma): la huella de C1 no llevaba la cuenta. Motivo: no invalidar los cobros de C1 ya guardados |
| Arqueo por (medio, cuenta) | `UNIQUE NULLS NOT DISTINCT (sesión, medio, cuenta)`; cierre cuadra por par | igual, en migración aditiva y reversible | IGUAL |
| Marcas | `valor_de_lista` global, `lista IN ('MARCAS_DE_TARJETA','MOTIVOS_DE_RECHAZO')`, nombre único con collation ICU, «Otra» fija, la escribe la plataforma | igual, pero `lista IN ('MARCAS_DE_TARJETA')` | DIFIERE: sin `MOTIVOS_DE_RECHAZO` (es de compras y no se pidió). Una lista nueva es una migración nueva |
| Quién escribe las marcas | `pedernal_plataforma` con INSERT y UPDATE (nombre, activo) | **nadie** todavía: la app solo lee y `motor2_plataforma` no tiene grant | DIFIERE: el guardián `grants-igual-a-uso` exige que todo grant tenga uso y la consola no existe. El grant llega con la consola (zona de otro turno). Cierra por defecto: hoy solo el dueño de la base puede escribir la lista |
| Alcance por sucursal | RLS por empresa; la cuenta se compara con la sucursal de la caja | RLS por empresa **y por sucursal** (`CuentaDeCobro` es PROPIA) | DIFIERE (datos/RLS): con el alcance normal (solo la sucursal activa) una cuenta de otra sucursal es **invisible** y se rechaza como `CUENTA_DE_COBRO_NO_ENCONTRADA`; `CUENTA_DE_COBRO_DE_OTRA_SUCURSAL` solo se ve con un alcance de lectura más ancho. Ambos rechazan |
| Errores | códigos `CUENTA_DE_COBRO_*`, `DATO_DE_COBRO_*`, `DATO_NO_ADMITIDO_POR_EL_MEDIO` | los mismos nombres | IGUAL |
| `parametrizacion-de-medios-de-pago.md` | — | **NO VERIFICADO**: el archivo que cita el pedido no existe en `ZuluHub-docs/11-especificaciones/conceptos/`; leí `medio-de-pago.md`-equivalentes (`datos-opcionales-del-cobro`, `cuenta-de-cobro`, `marca-de-tarjeta`, `valor-de-lista`, `terminal-de-cobro`, `cuotas-del-cobro`, `cupon-de-pago`, `ultimos-cuatro-digitos-de-la-tarjeta`) y el SQL/TypeScript | — |
| Prototipos `medios.html`, `datos-cobro.html`, `datos-cobro-tres-estados.html` | pantallas | **NO VERIFICADO** (no se construyen pantallas; las fichas de concepto citan sus textos) | — |

**Inventario de lo que ya existía con otro nombre (M):** el medio de pago y el arqueo son de C1; no había cuenta de cobro, lista de marcas ni datos del cobro. `Cuenta` del POS (la cuenta de una mesa) **no** es la cuenta de cobro: se llama `CuentaDeCobro` para no confundirlas.

**Necesidad (quién la pidió y dónde):** el dueño, 2026-11-16, «Caja: cierre del día y cuenta de cobro» «como las decidió Pedernal»; la etapa C3 figura en `diseno-caja-y-cobro-paridad-pedernal-2026-11-16.md` («conciliar con la terminal»).

## 3. Niveles 1 a 5 de esta etapa

- **Actores:** quien administra la caja (gerente o administrador) configura cuentas y medios; quien cobra elige cuenta y completa datos al cobrar; la plataforma administra las marcas (consola futura).
- **Ciclo de vida:** cuenta `activa` ⇄ `inactiva` (nunca se borra); medio `activo` ⇄ `inactivo` (el efectivo siempre activo); marca `activa` ⇄ `inactiva` (solo plataforma; «Otra» fija).
- **Invariantes (las hace cumplir la base):** tipo de cuenta cerrado e inmutable; nombre único sin mayúsculas; el efectivo no lleva cuenta; la cuenta de un movimiento es de su sucursal, está activa y es compatible; un dato no pedido por el medio no entra; la marca es de la lista y activa; el techo de datos por tipo; `Cobro.cuentaDeCobroId` = el de su movimiento; el arqueo cuadra por (medio, cuenta); la app no borra nada y solo lee la lista global.
- **Historia:** `Cobro`, `MovimientoCaja` y `ArqueoCaja` solo se agregan; un cobro viejo conserva la marca que se desactivó después y la cuenta que se desactivó después.

## 4. Tabla «¿qué pasa si…?» por comando

Leyenda: SER = transacción SERIALIZABLE con reintento (también ante el choque de índice único); POR_ESTADO = idempotencia por estado.

### crearCuentaDeCobro
| Caso | Resultado |
|---|---|
| Repetición | la misma cuenta activa (nombre, tipo, identificador, sucursal) → `yaExistia: true`, sin escribir ni auditar |
| Concurrencia | ocho altas iguales a la vez: una escribe, siete ven `yaExistia` tras el reintento SER; ocho con el mismo nombre y otro tipo: una gana, el resto `CUENTA_DUPLICADA`. Segunda barrera: índice único `lower(nombre)` |
| Tiempo | no usa el reloj salvo `creadoEn` (el `ahora` del contexto) |
| Incertidumbre | el cliente no sabe si se creó: reintenta y recibe `yaExistia` |
| Reintento | igual que repetición |
| Error parcial | una sola transacción: cuenta y auditoría juntas o nada |
| Datos faltantes | tipo, nombre o identificador fuera de la lista de permitidos → código sin escribir; sucursal inexistente → `SUCURSAL_NO_ENCONTRADA` |
| Cambio de permisos | sucursal fuera del alcance de escritura → `SUCURSAL_FUERA_DE_ALCANCE`; si el alcance no se declara, la RLS rechaza el `INSERT` (42501) |

### editarCuentaDeCobro
| Caso | Resultado |
|---|---|
| Repetición | si lo pedido ya es lo que hay → ok con la versión vigente, sin escribir (aunque la versión sea vieja) |
| Concurrencia | dos ediciones con la misma versión: una gana, las otras `VERSION_DESACTUALIZADA` (`UPDATE ... WHERE version`) |
| Tiempo | `actualizadoEn` = `ahora` |
| Incertidumbre / reintento | se reintenta con la misma versión: ya aplicado → ok, no es conflicto |
| Error parcial | transacción única |
| Datos faltantes | cuenta inexistente → `CUENTA_DE_COBRO_NO_ENCONTRADA`; nombre de otra → `CUENTA_DUPLICADA`; sucursal nueva inexistente → `SUCURSAL_NO_ENCONTRADA` |
| Cambio de permisos | exige escritura sobre la sucursal actual y la nueva |
| Auditoría | un registro por campo que cambió; **nunca** el valor del identificador externo |

### desactivarCuentaDeCobro / reactivarCuentaDeCobro
| Caso | Resultado |
|---|---|
| Repetición / reintento | POR_ESTADO: ya como se pide → `yaEstabaInactiva`/`yaEstabaActiva`, sin escribir ni auditar |
| Concurrencia | el `UPDATE` se condiciona a la versión leída; el choque lo reintenta SER |
| Tiempo | no aplica |
| Incertidumbre | repetible |
| Error parcial | transacción única |
| Datos faltantes | cuenta inexistente (o invisible por RLS) → `CUENTA_DE_COBRO_NO_ENCONTRADA` |
| Cambio de permisos | sin escritura en la sucursal → `SUCURSAL_FUERA_DE_ALCANCE` |
| Efecto sobre lo cobrado | ninguno; un cobro nuevo con una cuenta inactiva → `CUENTA_DE_COBRO_INACTIVA` |

### crearMedioDePago
| Caso | Resultado |
|---|---|
| Repetición / reintento | POR_ESTADO: el mismo medio activo → `yaExistia` |
| Concurrencia | ocho altas iguales: una escribe; índices únicos del efectivo, del nombre y del «sin nombre por tipo» como segunda barrera |
| Tiempo | no aplica |
| Incertidumbre | repetible |
| Error parcial | transacción única |
| Datos faltantes | tipo fuera de lista → `TIPO_DE_MEDIO_INVALIDO`; nombre fuera de la lista de permitidos → `NOMBRE_DE_MEDIO_INVALIDO`; ya hay efectivo y se pide otro → `EFECTIVO_YA_EXISTE`; nombre de otro tipo → `MEDIO_DUPLICADO`; de uno inactivo → `MEDIO_INACTIVO_CON_ESE_NOMBRE` |
| Cambio de permisos | el permiso es de la Server Action (no existe todavía); el medio es de la empresa (RLS de empresa) |
| Nace | activo y **sin pedir ningún dato** |

### editarMedioDePago
| Caso | Resultado |
|---|---|
| Repetición | lo pedido ya es lo que hay → ok sin escribir |
| Concurrencia | versión optimista: una gana, el resto `VERSION_DESACTUALIZADA` |
| Tiempo | `actualizadoEn` = `ahora` |
| Incertidumbre / reintento | ya aplicado → ok |
| Error parcial | transacción única |
| Datos faltantes | habilitar un dato que el tipo no admite → `DATO_NO_ADMITIDO_POR_EL_MEDIO { dato }` aunque no haya otro cambio; medio inexistente → `MEDIO_NO_ENCONTRADO`; otro medio con ese nombre → `MEDIO_DUPLICADO` |
| Cambio de permisos | el permiso es de la Server Action |
| Efecto | rige para los cobros que vengan; lo ya cobrado no se toca. Auditoría: nombre y lista de datos pedidos (nombres de campo, nada personal) |

### desactivarMedioDePago / reactivarMedioDePago
| Caso | Resultado |
|---|---|
| Repetición / reintento | POR_ESTADO |
| Concurrencia | versión leída; reintento SER |
| Datos faltantes | inexistente → `MEDIO_NO_ENCONTRADO`; el efectivo no se desactiva (`EFECTIVO_NO_SE_DESACTIVA`; CHECK de C1 de segunda barrera) |
| Efecto | un medio inactivo no cobra (`MEDIO_NO_HABILITADO`) |

### cobrarCuenta (C1, extendido)
| Caso | Resultado |
|---|---|
| Repetición | la clave de reintento se mira **antes** que el estado; misma clave y misma huella → `yaExistia`; la huella ahora incluye cuenta y datos por renglón. Un cobro **sin** cuenta ni datos conserva la huella de C1 (`[medio, importe]`): los cobros ya guardados siguen siendo repetibles |
| Concurrencia | ocho cobros a la vez de la misma cuenta con datos: uno escribe; ocho reintentos con la misma clave: el mismo cobro (índices únicos por cuenta y por clave de C1) |
| Tiempo | el medio, la cuenta y la marca se validan al cobrar; un cambio posterior no toca lo cobrado |
| Incertidumbre | repetible con la misma clave |
| Error parcial | todo o nada: cobranza, movimientos, renglones y auditoría en una transacción; el disparador diferido verifica la suma |
| Datos faltantes | cuenta inexistente → `CUENTA_DE_COBRO_NO_ENCONTRADA`; del efectivo → `..._NO_ADMITIDA`; de otra sucursal → `..._DE_OTRA_SUCURSAL`; inactiva → `..._INACTIVA`; de tipo incompatible → `..._INCOMPATIBLE`; dato no pedido → `DATO_DE_COBRO_NO_HABILITADO { dato }`; mal escrito → `DATO_DE_COBRO_INVALIDO { dato, motivo }` (`FORMA`, `NUMERO_DE_TARJETA`, `NO_DISPONIBLE`). Ningún dato es obligatorio: pedirlo y no mandarlo es válido |
| Cambio de permisos | la cuenta de otra sucursal es invisible con el alcance normal (RLS) |
| Orden de chequeos | clave → cuenta cobrable → total → sesión → por renglón (medio activo → par medio/cuenta → datos → marca) → cuadre al centavo |
| Auditoría | el total, la cantidad de medios, cuántos renglones llevan cuenta y **solo la lista de datos completados**. Nunca valores (DNI y últimos 4 son datos personales) |

### cerrarSesion (C1, por (medio, cuenta))
Una línea de arqueo por cada par con movimientos (y la del efectivo, que nunca lleva cuenta); «sin cuenta» es un grupo más; los pares que no son efectivo se dan por «conforme» (`conformeDeLosDemasMedios`, igual que C1). El disparador diferido recalcula por par.

## 5. Oráculo de combinaciones (escrito aparte del código)

Archivo: `test/caja/oraculo-de-combinaciones-del-cobro.ts` (no importa nada de `src/`). Dimensiones: **tipo de medio** (6) × **datos que pide el medio** (5, con el techo) × **datos que manda el cobro** (5) × **cuenta de cobro** (ninguna / compatible / incompatible / inactiva / otra sucursal).

| Regla | Efecto |
|---|---|
| R1 | efectivo con cualquier cuenta → `CUENTA_DE_COBRO_NO_ADMITIDA` |
| R2 | cuenta de otra sucursal → `..._DE_OTRA_SUCURSAL` |
| R3 | cuenta inactiva → `..._INACTIVA` |
| R4 | cuenta de tipo no admitido → `..._INCOMPATIBLE` |
| R5 | sin cuenta, o compatible, activa y de la sucursal → pasa a los datos |
| R6 | dato mandado y no pedido → `DATO_DE_COBRO_NO_HABILITADO` (el primero: cupón, últimos 4, marca, cuotas, DNI) |
| R7 | dato mandado y pedido, bien escrito → entra; pedir y no mandar es válido |
| R8 | techo por tipo: efectivo, QR y otro ninguno; débito cupón/últimos 4/marca; crédito + cuotas; transferencia solo DNI |

`test/caja/oraculo-de-combinaciones-del-cobro.test.ts`: (1) el código y la base tienen las mismas tablas que el oráculo; (2) recorrido **exhaustivo** sobre el núcleo puro (más de 2.000 combinaciones); (3) recorrido sobre la base real, con los disparadores, en transacciones que se revierten (más de 300 combinaciones: cada tipo × cuenta × «pide nada / pide todo lo posible» × «manda nada / cada dato / todos»); (4) el techo por tipo contra `MedioDePago_datos_chk`; (5) **guardián de dimensiones**: toda columna escalar de `MedioDePago`, `Cobro` y `CuentaDeCobro` de `schema.prisma` tiene que figurar en `COLUMNAS_DECLARADAS` con «afecta / no afecta» y su motivo; una columna `pide*` o un dato nuevo sin declarar hace fallar el test.

## 6. Persistencia y migración (nivel 6)

Migración **aditiva y reversible** `20261117112000_caja_c3_cuenta_de_cobro` (`migration.sql`, `down.sql` que aborta si se perdería algo y es idempotente, `verificacion-previa.sql` solo lectura) y `20261117113000_rls_sucursal_caja_c3` (salida exacta del generador). Tablas nuevas: `CuentaDeCobro` (por empresa y sucursal, RLS) y `ValorDeLista` (global, sin RLS). Columnas nuevas, todas opcionales o con default `false`: `MedioDePago.pide*`, `MovimientoCaja.cuentaDeCobroId`, `Cobro.{cuentaDeCobroId,cupon,ultimos4,marcaDeTarjetaId,cuotas,dni}`, `ArqueoCaja.cuentaDeCobroId`. Reemplaza tres funciones de C1 (`MovimientoCaja_validar`, `Cobro_validar`, `SesionCaja_verificar_cierre`); la reversa las restaura byte por byte (la prueba compara el código con `md5(prosrc)`). Requiere Postgres 15 o más (`NULLS NOT DISTINCT`; CI y local usan 17) y ICU (collation de la lista).

Privilegios: la app lee y agrega `CuentaDeCobro` (UPDATE por columna: nombre, identificador, sucursal, activa, versión); lee `ValorDeLista` y nada más; `MedioDePago` suma el UPDATE de las cinco columnas `pide*`. Plataforma: sin privilegios hasta que exista la consola.

## 7. Pruebas, migración y operación (nivel 10)

- Núcleo: `test/caja/nucleo-de-cuentas-y-datos.test.ts`. Oráculo: arriba. Casos de uso contra Postgres real, con concurrencia e idempotencia: `test/caja/caja-c3-casos-de-uso.test.ts`. Subir/bajar/subir: `test/aislamiento/caja-c3-subir-bajar-subir.test.ts` (y la lista de `m1-mostrador-subir-bajar-subir`). Los tests de C1 siguen pasando.
- Aplicar en una base real: **no** (congelado). Cuando se autorice: `verificacion-previa.sql`, respaldo, ensayo en rama de Neon, `migrate deploy`,.

## 8. Preguntas abiertas para el dueño (no se asumió nada)

- **Q-C3-1 — Lista de caracteres de los nombres.** Hoy letras, números, tildes de uso común, espacio y `. _ / -` (la de C1). Pedernal permite además signos como `, ; : ! ? ¿ ¡ ( ) % $ # & ' " ° + *`. ¿Querés la de Pedernal? (PROPUESTA: dejar la de C1.)
- **Q-C3-2 — Valores iniciales de las marcas.** Se sembraron los de ejemplo de Pedernal (Visa, Mastercard, American Express, Cabal, Naranja X y «Otra»); Pedernal tampoco los tiene confirmados por su dueño. ¿Son estos?
- **Q-C3-3 — Quién carga la lista de marcas hasta que exista la consola.** Hoy solo el dueño de la base puede escribirla (por migración).
- **Q-C3-4 — Tope de 36 cuotas** (supuesto del ingeniero de Pedernal, sin cita del dueño). Cambiarlo es una constante y un CHECK.
- **Q-C3-5 — Cupón.** Pedernal endureció la regla escrita (sin espacios, sin tramos de 13 dígitos): Motor2 la copia. ¿Confirmás?
- **Q-C3-6 — Una cuenta en todas las sucursales.** Hoy una sola sucursal (como Pedernal, supuesto suyo).
- **Q-C3-7 — Quién ve los datos guardados del cobro** (DNI, últimos 4): hoy solo se leen con las lecturas que se construyan; no hay pantalla ni permiso.

## 9. Mensajes nuevos para el catálogo de textos (clave sugerida, texto, uso)

| Clave sugerida | Texto | Uso |
|---|---|---|
| `caja.cuenta_de_cobro.creada` | Cuenta de cobro creada. | éxito de crear |
| `caja.cuenta_de_cobro.duplicada` | Ya hay una cuenta de cobro con ese nombre. | `CUENTA_DUPLICADA` |
| `caja.cuenta_de_cobro.nombre_invalido` | El nombre de la cuenta no es válido. | `NOMBRE_DE_CUENTA_INVALIDO` |
| `caja.cuenta_de_cobro.identificador_invalido` | El identificador de la cuenta no es válido. | `IDENTIFICADOR_EXTERNO_INVALIDO` |
| `caja.cuenta_de_cobro.sin_acceso` | No tenés acceso a esa sucursal. | `SUCURSAL_FUERA_DE_ALCANCE` |
| `caja.cobro.cuenta_incompatible` | El medio de pago no admite ese tipo de cuenta de cobro. | `CUENTA_DE_COBRO_INCOMPATIBLE` |
| `caja.cobro.cuenta_inactiva` | La cuenta de cobro está desactivada. | `CUENTA_DE_COBRO_INACTIVA` |
| `caja.cobro.cuenta_de_otra_sucursal` | La cuenta de cobro es de otra sucursal. | `CUENTA_DE_COBRO_DE_OTRA_SUCURSAL` |
| `caja.cobro.efectivo_sin_cuenta` | El efectivo no lleva cuenta de cobro. | `CUENTA_DE_COBRO_NO_ADMITIDA` |
| `caja.cobro.dato_no_pedido` | El medio de pago no pide ese dato. | `DATO_DE_COBRO_NO_HABILITADO` |
| `caja.cobro.dato_mal_escrito` | Hay un dato del cobro mal escrito. | `DATO_DE_COBRO_INVALIDO` |
| `caja.medio.dato_no_admitido` | Ese tipo de medio no admite pedir ese dato. | `DATO_NO_ADMITIDO_POR_EL_MEDIO` |
| `caja.medio.efectivo_no_se_desactiva` | El efectivo no se desactiva: siempre se puede cobrar en efectivo. | `EFECTIVO_NO_SE_DESACTIVA` |
| `caja.version_desactualizada` | Cambió mientras lo mirabas: volvé a abrirlo antes de editarlo. | `VERSION_DESACTUALIZADA` |

(Los textos están hoy en los casos de uso como mensajes de `fracaso`; la pantalla los traduce por el código estable.)


## Decisiones del dueño asentadas (2026-11-16, literales; registradas en `motor2-docs`, «Caja C3: tres respuestas del dueño» y «Caja C3»; relatadas por el orquestador general)

| Pregunta | Respuesta literal | Estado |
|---|---|---|
| Q-C3-7 quién ve DNI y últimos 4 | «También quien cobra» | **CONFIRMADA:** el operador que cobró lo ve, además de gerente y administrador. Son datos personales: lectura solo dentro de su empresa y sucursal (RLS); nunca en listados ni con su valor en la auditoría (solo los nombres de los datos). La Server Action de lectura (PR-B) lo hace cumplir. |
| Q-C3-6 una cuenta de cobro por sucursal | «Una cuenta por sucursal (Recomendada)» | **CONFIRMADA** |
| Q-C3-4/5 cuotas y cupón | «Sí, como Pedernal (Recomendada)» | **CONFIRMADA:** tope de 36 cuotas y cupón sin espacios ni 13 dígitos seguidos |
| Q-C3-2/3 marcas iniciales | «Esas seis (Recomendada)» | **CONFIRMADA:** Visa, Mastercard, American Express, Cabal, Naranja X y «Otra»; una marca nueva la agrega la plataforma y, hasta que exista su pantalla, se carga con un cambio técnico avisando antes al dueño |
| Q-C3-1 caracteres de los nombres | cubierta por la lista de nombres confirmada | **CONFIRMADA** |

**Orden de migraciones (decisión del orquestador, 2026-11-16):** esta etapa va como `20261117112000` y `20261117113000`; C2 va después (`20261117114000` y `20261117115000`) y fusiona la función `"MovimientoCaja_validar"` partiendo de la de esta etapa.
