# Caja y cobro, etapa A: Server Actions, lecturas y permisos del cierre del día (diseño, 2026-11-17)

Documento de DISEÑO (sin código, sin migración, sin tocar `acciones.ts`). Escalera de diseño de 10 niveles (AGENTS.md). Estado de cada decisión: CONFIRMADA = dicha por el dueño; PROPUESTA = criterio del ingeniero, a confirmar; PENDIENTE; NO VERIFICADA.
Fuente de Pedernal leída del repositorio real y vigente: `ZuluHub-ERP` rama `origin/main` en `0fd7b50` (fetch del 2026-11-17; el checkout local estaba 114 commits atrás y NO se usó): `src/capacidades/permisos/empresa.ts`, `src/modulos/cierre/casos-de-uso/declaraciones.ts`, `src/modulos/cierre/consultas/declaraciones.ts`, `src/modulos/caja/casos-de-uso/declaraciones.ts`, `src/capacidades/modulos/catalogo.ts`.

## 1. Propósito y alcance (nivel 1)

**Necesidad (quién la pidió y dónde está escrita):** el dueño, 2026-11-17, chat con el orquestador general: «quiero que construyas lo que falta, ya. ahora.»; y «Caja: cierre del día y cuenta de cobro» «como las decidió Pedernal» (2026-11-16). Hoy el cierre del día (C2 y C2b, ya en `main`) tiene sus casos de uso, pero **nadie puede llamarlos desde la aplicación**: no hay Server Actions ni permisos. Esta etapa agrega la capa fina de acciones y lecturas, y los permisos.

**Qué entra:** 7 Server Actions (una por caso de uso de C2) y las lecturas del cierre del día (controles, estado de la jornada, lista de jornadas, conciliación), todas por el guard de permisos, y 7 claves de permiso nuevas. **Qué NO entra:** pantallas (Frente 6), reglas nuevas del cierre (ya diseñadas en C2), la regla del cobro sin cuenta (pendiente del dueño), la hora de corte (C2c, otro PR).

## 2. Actores y contexto (nivel 2)

Quien cierra el día es quien está en la sucursal. Contexto de todas las claves: **sucursal** (la jornada es de una sucursal), como las seis de caja ya existentes. Módulo provisorio `salon` (el catálogo de módulos es del Frente 4 y no tiene `caja`; ya declarado en #368; al existir se cambia solo el campo `modulo` de las claves de caja).

## 3. Los permisos de Pedernal (lo leído)

| Clave en Pedernal (`empresa.ts`) | Roles | Qué hace |
|---|---|---|
| `jornadas.ver` | gerente, administrador, operador | ver la jornada, sus controles, la lista y «hoy» (lecturas de `cierre/consultas`) |
| `jornadas.iniciar_auditoria` | gerente, administrador, operador | empezar el cierre del día |
| `jornadas.cancelar_auditoria` | gerente, administrador, operador | cancelar el cierre del día |
| `jornadas.cerrar` | gerente, administrador, operador | cerrar la jornada |
| `cobros.corregir_medio` | gerente, administrador, operador | corregir el medio de un cobro (solo con la jornada en auditoría) |
| `declaraciones_de_total.registrar` | gerente, administrador, operador | declarar el total de un medio **y** dar el conforme general (los dos casos de uso usan la MISMA clave) |
| `movimientos_caja.ajustar` | gerente, administrador | registrar un ajuste (el operador no) |

Comentario de Pedernal: «Cierre del día (e3b §3.6, decisión 161): los tres roles»; «el ajuste es de quien administra o gerencia» (decisión 123). Lecturas: todas bajo `jornadas.ver`.

## 4. Permisos nuevos propuestos para Motor2 (nivel 5, PROPUESTA)

Reglas de Motor2 (leídas del código): pisos `operario < administrador < administrador_sistema < gerente`; el piso manda sobre la fila de la matriz; semilla solo en el rol `admin` («todo nace cerrado», 2026-11-11), el gerente delega. «Los tres roles» de Pedernal = piso **operario**; «gerente y administrador» = piso **administrador**.

| Clave propuesta | Contexto | Piso | Semilla (`rolesEditarSemilla`) | Solo ver | Qué hace | Equivalente en Pedernal |
|---|---|---|---|---|---|---|
| `caja_jornada_ver` | sucursal | operario | admin | sí | ver la jornada, sus controles, la lista de jornadas y la conciliación | `jornadas.ver` |
| `caja_jornada_iniciar_auditoria` | sucursal | operario | admin | no | empezar el cierre del día | `jornadas.iniciar_auditoria` |
| `caja_jornada_cancelar_auditoria` | sucursal | operario | admin | no | cancelar el cierre del día | `jornadas.cancelar_auditoria` |
| `caja_jornada_cerrar` | sucursal | operario | admin | no | cerrar la jornada | `jornadas.cerrar` |
| `caja_corregir_medio_de_cobro` | sucursal | operario | admin | no | corregir el medio de un cobro con la jornada en auditoría | `cobros.corregir_medio` |
| `caja_declarar_total` | sucursal | operario | admin | no | declarar el total de un medio y dar el conforme general | `declaraciones_de_total.registrar` |
| `caja_registrar_ajuste` | sucursal | administrador | admin | no | registrar un ajuste sobre una jornada cerrada | `movimientos_caja.ajustar` |

Descripciones (texto que ve el cliente; las fija la sesión de Textos): se redactan al construir, con el molde de `test/textos/oraculo-de-permisos.ts`.

**Matriz resultante (lo que decide el gate; el piso manda sobre la fila):**

| Quién | `caja_jornada_ver` y las 5 de piso operario | `caja_registrar_ajuste` |
|---|---|---|
| Gerente (con rol `admin` en alguna sucursal) | sí | sí |
| Administrador (rol `admin`) | sí | sí |
| Operador (rol `operador`) | solo si el gerente le prende la fila («todo nace cerrado»; Pedernal se lo da de entrada) | **nunca** (el piso lo anula) |
| Rol propio | solo si el gerente le prende la fila | nunca |
| Sin membresía en la sucursal | no | no |

(El oráculo rol × piso se escribe aparte del código y se ejecuta como test de combinaciones, como hicimos con `renombrar_sucursal`: VERIFICADO el mecanismo con las funciones puras `nivelesEnLaEmpresa`/`decidirEnSucursal`.)

### Diferencias con Pedernal (declaradas con su motivo)

1. **Semilla cerrada:** en Motor2 nadie fuera del rol `admin` las tiene hasta que el gerente las delega; Pedernal da `OPERADOR` de entrada. Motivo: regla del dueño «Todo nace cerrado» (2026-11-11).
2. **Roles editables:** Pedernal tiene tres roles fijos; Motor2 tiene la matriz de roles por sucursal. El «piso» traduce la intención de Pedernal. Motivo: modelo de permisos propio de Motor2 (Prisma, matriz).
3. **Conforme general sin clave propia:** igual que Pedernal, comparte `caja_declarar_total` (en Pedernal: `declaraciones_de_total.registrar`).
4. **Módulo `salon` provisorio** (ver arriba).
5. **HALLAZGO sobre PR-B (#368), a resolver con el dueño:** al leer Pedernal vigente, DOS de las seis claves de caja de PR-B tienen un piso MÁS ALTO que Pedernal, y #368 dijo «como Pedernal»: `caja_cerrar_sesion` (piso administrador; en Pedernal `sesiones_caja.iniciar_cierre` / `cancelar_cierre` / `cerrar` son de los tres roles) y `caja_mover_efectivo` (piso administrador; en Pedernal `movimientos_caja.registrar_manual` es de los tres roles). Las otras cuatro (`caja_ver`, `caja_abrir_sesion`, `cobrar_cuenta`, `caja_anular_movimiento_ajeno`) coinciden. Las acciones de iniciar/cancelar el cierre de C1b reutilizan `caja_cerrar_sesion`, así que heredan la diferencia. **Una diferencia sin motivo es un defecto** (regla de paridad): hay que decidir (a) bajar esos dos pisos a operario (como Pedernal) o (b) confirmar con el dueño que se quedan más altos y dejar el motivo escrito. **No lo cambio yo:** los permisos son del dueño. PENDIENTE.

## 5. Casos de uso y acciones (nivel 3 y 8)

Cada acción es un adaptador fino, igual que las de caja de PR-B: `conPermiso(<clave>)` → formato por lista de permitidos en el guard (DENTRO del envoltorio) → caso de uso existente de C2 → resultado cerrado. Sin lógica nueva de negocio.

| Acción propuesta (nombre) | Caso de uso (C2, ya en `main`) | Clave | Entrada |
|---|---|---|---|
| `iniciarAuditoriaDeJornada` | `iniciarAuditoria` | `caja_jornada_iniciar_auditoria` | `{ fechaDeNegocio }` |
| `cancelarAuditoriaDeJornada` | `cancelarAuditoria` | `caja_jornada_cancelar_auditoria` | `{ fechaDeNegocio }` |
| `corregirMedioDeCobroDeCaja` | `corregirMedioDeCobro` | `caja_corregir_medio_de_cobro` | `{ claveIdempotencia, cobroId, medioDestinoId, motivo }` |
| `declararTotalDeMedio` | `declararTotal` | `caja_declarar_total` | `{ claveIdempotencia, fechaDeNegocio, medioDePagoId, importeEnCentavos }` |
| `darConformeGeneralDeJornada` | `darConformeGeneral` | `caja_declarar_total` | `{ claveIdempotencia, fechaDeNegocio }` |
| `cerrarJornadaDeCaja` | `cerrarJornada` | `caja_jornada_cerrar` | `{ fechaDeNegocio, huellaVista, reconocimientos, observacion }` |
| `registrarAjusteDeCaja` | `registrarAjuste` | `caja_registrar_ajuste` | `{ claveIdempotencia, sesionId, medioDePagoId, importeEnCentavos, motivo, corrigeJornada }` |

Lecturas (todas con `caja_jornada_ver`, patrón de `lecturas-de-caja.ts`): estado de una jornada; controles de la jornada (con su huella); lista de jornadas; conciliación de una jornada cerrada. El importe viaja como texto de centavos (nunca flotante). Los nombres exactos los fija la construcción; este es el contrato que el Frente 6 puede esperar.

## 6. Invariantes y políticas (nivel 5)

Las del diseño de C2 (no se repiten). Propias de esta capa: (I1) el permiso se evalúa ANTES de cualquier lectura de datos; (I2) la sucursal es la activa del contexto, nunca una que mande el frontend; (I3) las claves de reintento las genera la pantalla al abrir el formulario (como Pedernal) y el caso de uso decide el reintento; (I4) ninguna acción devuelve datos de otra empresa o sucursal (RLS); (I5) un rechazo por permiso no escribe nada.

## 7. Historia, atomicidad y concurrencia (niveles 6 y 7)

**Sin tablas ni migración de esquema.** Sí hay una **migración de DATOS** (siembra de las 7 claves en el rol `admin`, con su `down.sql`, aditiva, en el bloque de migraciones de caja: propuesta `20261117119100_permisos_cierre_del_dia`), igual que `20261117118000_permisos_caja_c1`; **solo se escribe cuando el orquestador confirme con la respuesta del dueño** y sin aplicar a ninguna base real. Atomicidad y concurrencia: las de los casos de uso de C2 (SERIALIZABLE, `FOR SHARE`/`FOR UPDATE` sobre la jornada, único por clave de reintento).

## 8. «¿Qué pasa si…?» por comando (nivel 10)

Todas las acciones comparten las filas de permiso. Para cada una, lo que agrega la CAPA DE ACCIÓN sobre lo ya definido por el caso de uso en el diseño de C2 (§ de los comandos):

| Situación | Resultado esperado en la acción |
|---|---|
| **Cambio de permisos** (se revoca entre pantalla y envío) | rechazo por permiso, sin tocar la base; el permiso se evalúa en cada llamada |
| **Sin la clave / piso no alcanzado** | rechazo por permiso; el operador nunca puede `registrarAjusteDeCaja` aunque tenga la fila |
| **Sucursal ajena o sin acceso** | rechazo; ninguna lectura ni escritura |
| **Datos faltantes o mal formados** (fecha, importe, clave, texto) | rechazo de formato del guard (lista de permitidos), sin llegar al caso de uso |
| **Repetición / doble clic** | `iniciarAuditoria` y `cancelarAuditoria`: idempotentes por estado (ok sin escribir); `corregirMedio`, `declararTotal`, `darConforme`, `registrarAjuste`: misma clave y mismo pedido → `yaExistia`; misma clave y otro pedido → `CLAVE_REUTILIZADA`; `cerrarJornada`: ya cerrada → ok sin escribir |
| **Concurrencia** (dos cierres, cobro vs. iniciar auditoría, dos declaraciones) | las arbitra el caso de uso (SERIALIZABLE y únicos de C2/C2b); la acción nunca devuelve un error crudo |
| **Tiempo** (la sesión pasó su hora de corte; el día cambió) | rige el sello de la sesión y la fecha de negocio ya calculada (C2/C2c) |
| **Incertidumbre / reintento tras corte de red** | la clave de reintento hace segura la repetición; el estado hace idempotentes los otros dos |
| **Error parcial** | todo o nada dentro de la transacción del caso de uso; la acción no escribe nada por su cuenta |
| **`cerrarJornada` con controles que cambiaron desde que la pantalla los vio** | rechazo por huella desactualizada (regla de C2): nada se cierra con algo que nadie vio |

## 9. Pruebas (nivel 10)

(1) **Oráculo rol × piso × clave** escrito aparte (las 7 claves × gerente, administrador, operador sin fila, operador con fila, rol propio, sin membresía) ejecutado contra la decisión de acceso real y por las acciones con usuarios reales. (2) **Matriz de denegación por defecto:** las 7 acciones y las lecturas con su control positivo (familia «caja», ya existe). (3) **Concurrencia e idempotencia** por las acciones reales (cierre simultáneo, doble clic, cobro vs. iniciar auditoría). (4) **Golden de la huella de gobierno y caracterizaciones congeladas** actualizados (zona restringida: se declara en el PR). (5) **Mutaciones:** quitar el permiso de una acción → rojo; bajar un piso → rojo en el oráculo; quitar una clave de la semilla → rojo en la prueba de la migración de datos. (6) **Combinaciones (regla del 2026-10-28):** dimensiones que cambian permisos: (clave) × (rol) × (fila de la matriz) × (piso); guardián que falla si aparece una clave nueva sin declarar.

## 10. Preguntas abiertas para el dueño

- **Q-A1 (permisos):** ¿los pisos propuestos (cinco de operario, ajuste de administrador, semilla solo `admin`) son como querés? (PROPUESTA: sí, «como Pedernal».)
- **Q-A2 (hallazgo sobre PR-B):** ¿`caja_cerrar_sesion` y `caja_mover_efectivo` bajan a piso operario como Pedernal, o se quedan más altos? Hoy un operador (aunque el gerente se lo delegue) NO puede cerrar la caja ni mover efectivo; en Pedernal sí.
- **Q-A3:** el conforme general comparte clave con declarar total (como Pedernal); ¿está bien?

**Estado:** DISEÑO. No se escribe `acciones.ts`, migración de semilla ni acciones hasta que el orquestador confirme con la respuesta del dueño. Lo que no necesita permiso nuevo (los casos de uso y lecturas internas ya existentes) ya está construido.

## 11. Construido (2026-11-17)

Decisión del dueño que lo habilita: «ok pedernal» (2026-11-17), que confirmó la tabla de §4, y «quiero que construyas lo que falta, ya. ahora.» (2026-11-17, chat con el orquestador general). Sin tablas ni migración nuevas; los 7 permisos ya estaban declarados en `src/core/permisos/acciones.ts` (PR de permisos separado, #429) y esta etapa no los toca.

### Server Actions (`src/server/actions/caja/cierre-del-dia.ts`, `"use server"`; adaptadores finos: `conPermiso` → guard → caso de uso de C2 → resultado)

| Acción | Clave | Entrada (`EntradaDe…`, en `caja.schema.ts`) | Caso de uso |
|---|---|---|---|
| `iniciarAuditoriaDeJornada` | `caja_jornada_iniciar_auditoria` | `EntradaDeJornada { fechaDeNegocio }` | `iniciarAuditoriaCasoDeUso` |
| `cancelarAuditoriaDeJornada` | `caja_jornada_cancelar_auditoria` | `EntradaDeJornada` | `cancelarAuditoriaCasoDeUso` |
| `corregirMedioDeCobroDeCaja` | `caja_corregir_medio_de_cobro` | `EntradaDeCorregirMedioDeCobro { claveIdempotencia, cobroId, medioDestinoId, motivo }` | `corregirMedioDeCobroCasoDeUso` |
| `declararTotalDeMedio` | `caja_declarar_total` | `EntradaDeDeclararTotal { claveIdempotencia, fechaDeNegocio, medioDePagoId, importe }` | `declararTotalCasoDeUso` |
| `darConformeGeneralDeJornada` | `caja_declarar_total` (la MISMA) | `EntradaDeDarConformeGeneral { claveIdempotencia, fechaDeNegocio }` | `darConformeGeneralCasoDeUso` |
| `cerrarJornadaDeCaja` | `caja_jornada_cerrar` | `EntradaDeCerrarJornada { fechaDeNegocio, huellaVista, reconocimientos: { clave, texto \| null }[], observacion }` | `cerrarJornadaCasoDeUso` |
| `registrarAjusteDeCaja` | `caja_registrar_ajuste` | `EntradaDeRegistrarAjuste { claveIdempotencia, sesionId, medioDePagoId, importe, motivo, corrigeJornada }` | `registrarAjusteCasoDeUso` (recibe `puedeAjustar = true`: la acción solo llega ahí con el permiso aprobado; el piso administrador lo impone el gate) |

La sucursal es la activa del contexto; nada la manda el navegador. Importes: TEXTO decimal en pesos («1234.56», a lo sumo 2 decimales; el del ajuste admite «-» y no puede ser cero), nunca número; pasan a centavos enteros (`bigint`) dentro del guard. Los nombres coinciden con la tabla de §5 sin ninguna colisión.

**Resultado** (`ResultadoDeCierreDelDia = ResultadoAccion & { … }`, todo opcional): `ok`, `mensaje`; `codigo` (el código estable del fallo; con un rechazo de formato es el del guard y `mensaje` repite el código) y `campo` (el dato rechazado, p. ej. `reconocimientos.0.clave`); marcas de repetición `yaExistia`, `yaEstabaEnAuditoria`, `yaEstabaAbierta`, `yaEstabaCerrada`; ids `correccionId`, `declaracionId`, `conformeId`, `movimientoId` y `secuencia` (número); `vigenteId` (con `MEDIO_DEL_COBRO_CAMBIO`); `impedimentos: { clave, cantidad, referencias }[]` (con `JORNADA_CON_IMPEDIMENTOS`); `controles: { clave, severidad, cantidad, reconocido, texto }[]` (al cerrar, y con `CONTROLES_CAMBIARON` los de ahora) y `huellaActual` (con `CONTROLES_CAMBIARON`); `claves` (con `CONTROLES_QUE_BLOQUEAN` / `CONTROLES_SIN_RECONOCER`). Solo se copian campos de una lista; nunca se vuelca `datos` entero. Esta capa no devuelve dinero.

**Códigos de rechazo de formato (guard, `CodigoDeRechazoDeGuardDeCaja`):** los de PR-B más `FECHA_INVALIDA`, `HUELLA_INVALIDA` y `RECONOCIMIENTOS_INVALIDOS`. **Códigos de los casos de uso** (sin cambios, de C2): `FECHA_INVALIDA`, `JORNADA_NO_ENCONTRADA`, `JORNADA_CERRADA`, `JORNADA_NO_EN_AUDITORIA`, `JORNADA_CON_IMPEDIMENTOS`, `CLAVE_REUTILIZADA`, `COBRO_NO_ENCONTRADO`, `MOTIVO_INVALIDO`, `MEDIO_NO_ENCONTRADO`, `MEDIO_NO_HABILITADO`, `MEDIO_NO_DECLARABLE`, `MEDIO_DEL_COBRO_SIN_CAMBIOS`, `MEDIO_DEL_COBRO_CAMBIO`, `IMPORTE_INVALIDO`, `OBSERVACION_INVALIDA`, `RECONOCIMIENTO_INVALIDO`, `CONTROLES_CAMBIARON`, `CONTROLES_QUE_BLOQUEAN`, `CONTROLES_SIN_RECONOCER`, `SIN_PERMISO_PARA_AJUSTAR`, `SESION_NO_ENCONTRADA`, `SESION_CERRADA`, `CAJA_EN_CIERRE`, `JORNADA_A_CORREGIR_NO_ENCONTRADA`, `JORNADA_A_CORREGIR_NO_CERRADA`, `JORNADA_A_CORREGIR_NO_ANTERIOR`. Un rechazo por permiso es `{ ok: false, mensaje }` sin `codigo` (como las de PR-B).

### Lecturas (`src/server/actions/caja/lecturas-del-cierre.ts`, `"use server"`; todas con `requerirVer("caja_jornada_ver")` en la sucursal activa; sin permiso o con una fecha que no es un día real LANZAN, como las de `lecturas-de-caja.ts`)

- `leerEstadoDeJornada(fechaDeNegocio)` → `EstadoDeJornada | null` (`null` = ese día todavía no tuvo actividad): `{ jornadaId, fechaDeNegocio, estado: ABIERTA|EN_AUDITORIA|CERRADA, auditoriaIniciadaEn, auditoriaIniciadaPorId, cerradaEn, cerradaPorId, observacion, sesiones: { sesionId, estado, abiertaEn, abiertaPorId }[] }`.
- `leerControlesDeJornada(fechaDeNegocio)` → `ControlesDeLaJornadaLeidos`: `{ fechaDeNegocio, estadoDeLaJornada (null si no hay jornada), controles: { modulo, clave, severidad, cantidad, detalle, referencias }[], conciliacion: { medioDePagoId, tipoDeMedio, nombreDelMedio, registradoEnCentavos, correccionesEnCentavos, declaradoEnCentavos|null, estadoDeConteo, conformePorId, conformeEn, diferenciaEnCentavos|null }[], origenesConDiferencia: { cobranzaId, cobradoEnCentavos, totalDelTicketEnCentavos }[], huella }`. Calculada AHORA con `leerControlesDeLaJornada` (el mismo helper que usan `iniciarAuditoria` y `cerrarJornada`) dentro de una transacción; la `huella` es la que la pantalla manda de vuelta como `huellaVista`.
- `leerJornadasDeCaja(cursor?)` → `PaginaDeJornadas { items: { jornadaId, fechaDeNegocio, estado, auditoriaIniciadaEn, cerradaEn, cerradaPorId }[], nextCursor }`: la fecha de negocio más reciente primero, de a `TAMANO_PAGINA_DE_JORNADAS = 30` (tope), el cursor es el `nextCursor` anterior (un cursor que no es UUID devuelve una página vacía).
- `leerConciliacionDeJornada(fechaDeNegocio)` → `ConciliacionDeJornada | null` (`null` si no existe o no está cerrada): la foto congelada al cerrar (C2b): `{ jornadaId, fechaDeNegocio, congeladoEn, cerradaPorId, huellaDeCierre, observacion, lineas: { medioDePagoId, tipoDeMedio, nombreDelMedio, registradoEnCentavos, correccionesEnCentavos, declaradoEnCentavos|null, estadoDeConteo, conformeEn, diferenciaEnCentavos|null, explicacion }[], origenes: { cobranzaId, cobradoEnCentavos, totalDelTicketEnCentavos, diferenciaEnCentavos|null, explicacion }[], controles: { clave, severidad, cantidad, reconocido, texto }[] }`. No recalcula: lee lo guardado (la diferencia es la columna que calcula la base).

Lecturas internas nuevas: `src/server/lecturas/caja/jornadas-de-sucursal.ts` y `conciliacion-de-jornada.ts`. Todos los importes salen como TEXTO de centavos (con signo), nunca `Decimal` ni `number`.

### Diferencias con el diseño de §5

1. Las cuatro lecturas se nombraron al construir (§5 dejaba los nombres a la construcción): `leerEstadoDeJornada`, `leerControlesDeJornada`, `leerJornadasDeCaja`, `leerConciliacionDeJornada`.
2. Los campos de las lecturas agregan lo que hace falta para no obligar a la pantalla a cruzar otra lectura (`tipoDeMedio` y `nombreDelMedio` en las líneas de conciliación; `abiertaPorId` en las sesiones; `cerradaPorId` en la lista). Son datos que ya existían en las tablas; no hay reglas nuevas.
3. `controles-de-la-jornada.ts` (helper de C2) sigue en `casos-de-uso/` (la regla `persistencia-solo-desde-casos-de-uso` impide moverlo a otra capa) y ahora lo importa una lectura: por eso lleva sus cuatro tags y su `@ficha`, y figura con motivo en `CASOS_SIN_PERMISO` (`ficha-de-caso-de-uso.test.ts`: la lectura se protege con `requerirVer`, que la ficha no distingue) y en `SIN_ENVOLTORIO_TODAVIA` (`frontera-aresultadoaccion-caso-de-uso.test.ts`: es una lectura, no devuelve `ResultadoCaso`). Dos entradas nuevas en listas cerradas con motivo; ningún techo numérico subió.
4. Las `@ficha` de siete casos de uso de C2 decían una clave de permiso provisoria (`jornada_operar`, `cobro_corregir_medio`…) y vocabulario fuera de la lista (`POR_CLAVE`, `reloj=NO_APLICA`): se corrigieron a la clave real y a `idempotencia=NO_APLICA` / `reloj=INYECTADO` (como `abrir-sesion.ts`).

### Pruebas y guardianes

`test/caja/cierre-del-dia-acciones.test.ts` (Postgres real): por cada acción, (a) con todas las claves MENOS la que exige rechaza sin tocar la base, (b) sin ninguna, (c) con la clave exacta pasa (el ajuste: administrador), (d) el permiso antes que el formato y los rechazos de formato; el operador con las siete filas prendidas NO registra ajustes (piso administrador) pero sí inicia el cierre; permiso revocado a mitad (rechaza aunque sea el mismo pedido, sin `yaExistia`); membresía desactivada; resultados y repetición (`yaEstabaEnAuditoria`, `yaEstabaAbierta`, `yaEstabaCerrada`, `yaExistia`, `CLAVE_REUTILIZADA`); carreras de verdad por las acciones (seis cierres a la vez, ocho iniciar y cancelar, seis declaraciones con la misma clave, iniciar el cierre contra cerrar la caja, abrir la caja contra iniciar el cierre); aislamiento entre sucursales; las cuatro lecturas (permiso, fecha, contenido en centavos como texto, paginación). `test/caja/cierre-del-dia-guard.test.ts`: los seis guards puros. Matriz de denegación por defecto: las 7 acciones y las 4 lecturas con su control positivo (`PREPARACION_DEL_CONTROL`, `mundo.ts`: claves nuevas `fechaDeNegocioDeCaja` y `cobroId` y una jornada cerrada anterior con la cabecera de su foto). Guardianes: `toda-accion-se-usa` (las 7 claves salen de `RESERVADAS_SIN_USO_TODAVIA`), `acciones-clasificadas`, `.dependency-cruiser-excepciones.cjs` (`ACCIONES_CON_CASO_DE_USO`).

### NO VERIFICADO / pendiente

- Ninguna pantalla consume todavía estas acciones (Frente 6): el contrato de arriba es el que esperan.
- Q-A1, Q-A2 y Q-A3 de §10 siguen abiertas con el dueño; el hallazgo sobre los pisos de `caja_cerrar_sesion` y `caja_mover_efectivo` no se tocó.
- No se corrió e2e (Playwright) ni `npm run build` ni `plataforma:build`: el gate completo de AGENTS.md lo corre quien integra.
- La matriz de denegación por defecto (`denegacion-por-defecto-*`, mundo en `test/aislamiento/denegacion/mundo.ts`) se verificó (11 archivos, 2375 pruebas en verde) con UN parche local TEMPORAL en `mundo.ts` (encender `recepcion_de_compras` en la empresa E2, lo que hace `encenderRecepcionDeCompras` en `origin/main`), porque la base de pruebas ya traía migraciones de `main` (la guarda de apagado de compras) que esta rama todavía no trae y el mundo de esta rama no podía sembrarse. El parche se quitó: al integrar con `origin/main` el mundo ya trae esa corrección y los cambios de esta etapa en `mundo.ts` (claves `fechaDeNegocioDeCaja` y `cobroId` y la jornada cerrada anterior) se resuelven junto a ella.
- `test/aislamiento/rls-empresa.test.ts` (3 pruebas) y `test/persistencia/multiempresa-estructura.test.ts` (2) fallan en esta base por tablas que están en la base de pruebas y no en esta rama (`FamiliaDeProducto`, `MiembroDeFamilia`, de la migración de familias de `main`): nada que ver con esta etapa; se esperan en verde al integrar con `main`.
- El control positivo de `iniciarAuditoriaDeJornada`, `cerrarJornadaDeCaja` y de la conciliación en la matriz de denegación parte de estados armados con el dueño de la base (jornada ya en cierre o ya cerrada), no del camino completo, porque el mundo de la matriz tiene una caja abierta y cuentas abiertas que lo impedirían; el camino completo lo cubre `cierre-del-dia-acciones.test.ts`.
