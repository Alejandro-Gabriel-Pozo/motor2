# Diseño: caja, etapa C2 «Jornada de sucursal y cierre del día», como la decidió Pedernal (2026-11-16)

Etapa C2 del frente «caja y cobro» (`docs/diseno-caja-y-cobro-paridad-pedernal-2026-11-16.md`, escalera y auditoría hermanas). **EN LOCAL: sin aplicar nada a ninguna base real, sin push, sin PR.** Construye sobre C1 (`caja-c1-local`, commit `9518897f`).

Estados de cada decisión: **CONFIRMADA** (dicha por el dueño, con cita) · **PROPUESTA** · **PENDIENTE** · **NO VERIFICADA**.

## 0. Pedido y necesidad (nivel 1)

- **Pedido del dueño (2026-11-16, literal):** «Caja: cierre del día y cuenta de cobro» «como las decidió Pedernal, una por vez, en local y sin aplicar nada a ninguna base». Fuente: encargo del orquestador de este frente (cita del dueño de esa fecha). Habilita C2.
- **Decisión del dueño ya confirmada que se respeta (2026-11-16):** anular un ticket ENTERO ya cobrado deja la plata como **diferencia que se explica al cerrar el día**; NO sale sola de la caja y NO se corrigen renglones de un ticket cobrado. C2 **no construye la anulación**: solo el control `cobrado_contra_ticket` la refleja.
- **Fuera de C2 (con nombre):** ARCA / facturación; cobro en partes (decidido, no construido en Pedernal); datos del cobro y cuentas de cobro (C3); varias cajas (C4); mostrador en un gesto (C5); estado «en cierre» de la sesión de caja de Pedernal (`iniciarCierre`/`cancelarCierre`); desactivar sucursal según su jornada (decisión 178 de Pedernal); pantallas, Server Actions y permisos (zona restringida de otro turno).

## 1. Qué leí de Pedernal (y qué no)

Leído completo en `/home/user/zuluhub-erp` y `/home/user/zuluhub-docs`:

| Archivo | Qué saqué |
|---|---|
| `migraciones/0026_cierre.sql` | tablas `jornada_de_sucursal` y `control_de_jornada_cerrada`, J1 a J6, privilegios y RLS |
| `migraciones/0027_caja.sql` (líneas 1015 a 1330, más los disparadores de sesión y movimiento) | `correccion_de_medio`, `declaracion_de_total`, `conforme_de_jornada`, `cierre_de_caja_de_jornada`, `conciliacion_de_jornada`; reglas de sello de sesión y de `corrige_jornada` |
| `migraciones/0007_marcas_y_planes.sql` | `sucursal.hora_de_corte time NOT NULL DEFAULT '00:00'` con CHECK de minutos |
| `src/modulos/cierre/**` (dominio, casos de uso, aporte, gancho de sucursal, persistencia) | estados, transiciones, orden de pasos, códigos de error, huella, reconocimientos |
| `src/modulos/caja/dominio/{conciliacion,controles,controles-del-dia,cobrado-contra-ticket,correccion,jornada-de-caja,movimiento}.ts`, `aporte/*`, `casos-de-uso/{corregir-medio-de-cobro,declarar-total,dar-conforme-general,registrar-ajuste,abrir-sesion}.ts`, `cobrar/registrar-cobro.ts` | los seis controles, la conciliación, ajuste a jornada cerrada, corrección y declaración con secuencia |
| `src/primitivas/tiempo/fecha-de-negocio.ts` | la fórmula y sus errores |
| `src/modulos/ventas/aporte-al-cierre.ts` | `cuentas_abiertas` BLOQUEA y `tickets_por_cobrar` RECONOCIBLE |
| `zuluhub-docs/11-especificaciones/e3b-cierre-del-dia-especificacion.md` (§1 a §4), `conceptos/cierre-del-dia.md`, `conceptos/diferencia-de-caja.md` | alcance, decisiones 158 a 178 citadas |

**NO VERIFICADO** (no lo leí a fondo): `conceptos/arqueo.md` y la maqueta `cierre-del-dia.html` (las pantallas no son de esta etapa); `e3b` §5 en adelante (consultas y permisos), `src/modulos/caja/consultas/**`; las migraciones y casos de uso de Pedernal posteriores a mi clon (no hice `git fetch`: sin red en este entorno); el comportamiento real de Pedernal con datos (no corrí nada de Pedernal).

## 2. Auditoría breve contra Pedernal

| # | Tema | Pedernal | C2 en Motor2 | Categoría y motivo |
|---|---|---|---|---|
| 1 | Hora de corte | `sucursal.hora_de_corte time` default 00:00, minutos | `Sucursal.horaDeCorte TIME(0)` default 00:00, mismo CHECK | IGUAL |
| 2 | Fecha de negocio | `((instante AT TIME ZONE zona) - corte)::date`, errores `HORA_DE_CORTE_INVALIDA`, `ZONA_HORARIA_INVALIDA`, `INSTANTE_INVALIDO` | `src/core/caja/fecha-de-negocio.ts` (misma fórmula y errores) y la función SQL `caja_fecha_de_negocio` que la repite en la base | IGUAL. Se cambia por la del Frente 3 (`src/core/tiempo/`) cuando entre |
| 3 | Sello de la sesión | fecha, zona y hora de corte; la base recalcula | `SesionCaja.horaDeCorte` nueva; el disparador exige zona de la empresa, corte de la sucursal y fórmula | IGUAL |
| 4 | Jornada | clave natural `(empresa, sucursal, fecha)`, `ABIERTA → EN_AUDITORIA ⇄ ABIERTA`, `→ CERRADA` congelada | `JornadaDeSucursal` con `id uuid` y único `(empresaId, sucursalId, fechaDeNegocio)`; mismas transiciones por disparador | DIFIERE-FORMA: id `uuid` de la app (molde del Frente 3, E-0, ya usado en C1) y FK compuestas por `(empresaId, id)`; la regla de unicidad es la misma |
| 5 | Quién inicia y cierra = persona del contexto de la base (`app_persona_id()`) | por disparador | lo pone el caso de uso (`actor.usuarioId`); la base no sabe quién es la persona | DIFIERE-FORMA: el contexto de la base de Motor2 solo lleva empresa y sucursales (RLS), no persona |
| 6 | `version` y `actualizado_en` de la jornada | sí | no | DIFIERE-FORMA: nada los lee (poda: sin columnas a ciegas); la jornada cambia tres veces y cada cambio queda en `RegistroAuditoria` |
| 7 | Foto de controles | solo inserción, solo al cerrar, en la misma transacción (`xmin`) | `ControlDeJornadaCerrada`, mismo disparador (`xmin`) | IGUAL |
| 8 | Foto de la conciliación de caja (`cierre_de_caja_de_jornada`, `conciliacion_de_jornada`, `conciliacion_de_cobro_por_origen`) | se congela al cerrar | **entra en C2b** (§7) | CONFIRMADA: P-FOTO «También la conciliación por medio, como Pedernal» (2026-11-16) |
| 9 | Corrección de medio | `(cobro, secuencia)`, antes/después con cuenta de cobro | `CorreccionDeMedio` `(cobroId, secuencia)`, antes/después **solo medio** | DIFIERE-RESULTADO acotado: no hay cuenta de cobro hasta C3 |
| 10 | Declaración de total, conforme general | por par (medio, cuenta); uno por jornada | por medio; uno por jornada | idem (sin cuenta) |
| 11 | Ajuste a jornada cerrada | `AJUSTE` con `corrige_jornada`, solo gerente y administrador | igual; el permiso entra como parámetro booleano del caso de uso (`puedeAjustar`), como `puedeAnularAjenos` de C1 | IGUAL (el permiso real lo pide la Server Action, que no existe todavía) |
| 12 | Ajuste común (sin jornada a corregir) | mismo caso de uso, `corrige_jornada` nulo | **no existe**: `corrigeJornada` es obligatoria, en el caso de uso y en la base (CHECK `MovimientoCaja_corrige_chk`) | DIFIERE-RESULTADO por decisión del dueño (2026-11-16): «Solo sobre días cerrados (Recomendada)» |
| 13 | Anular un ajuste | el disparador deja anular `AJUSTE` | igual | IGUAL |
| 14 | Controles de caja | 6 (`sesiones_sin_cerrar` BLOQUEA; `diferencia_de_arqueo`, `conciliacion_por_medio`, `cobrado_contra_ticket` RECONOCIBLE; `cobros_corregidos`, `ajustes_a_jornadas_cerradas` INFORMA) | los mismos 6, claves idénticas | IGUAL |
| 15 | Controles de ventas | 6 (`cuentas_abiertas`, `tickets_por_cobrar`, `cortesias`, `anulaciones`, `correcciones`, `pendientes_de_facturar`) | solo `ventas.cuentas_abiertas` BLOQUEA y `ventas.tickets_por_cobrar` RECONOCIBLE, sobre `Cuenta` y `Cobranza` | DIFIERE-RESULTADO acotado: Motor2 no tiene cortesías, ticket con estado ni facturación; el encargo pide solo estos dos |
| 16 | Total del ticket | `ticket.total` con estado | no existe: se recalcula con `cargarCuentaParaCobrar` (el mismo cálculo del ticket «como se imprimiría ahora») y se compara con `Cobranza.total` | DIFIERE-FORMA (hallazgo D.1 de la auditoría de C1) |
| 17 | Módulos activos | el cierre solo mira los módulos activos de la empresa | no filtra: el módulo `caja` todavía no está en el catálogo (Frente 4) | DIFIERE-FORMA transitoria |
| 18 | Entrada de los comandos | `sucursalId` y fecha | fecha; la sucursal es la **activa del contexto** (`actor.sucursalId`), como C1 | DIFIERE-FORMA (convención de Motor2) |
| 19 | Arqueo conforme: quién y cuándo | por línea | por la sesión (`cerradaPorId`, `cerradaEn`) | DIFIERE-FORMA: C1 no los guarda por línea y el que da el conforme al cerrar la sesión es quien la cierra |
| 20 | Persona en `app_persona_id()`, `solo_insercion()` en el esquema | triggers | `REVOKE` de `DELETE`/`TRUNCATE`/`UPDATE` a la app y disparadores propios, **sin** disparador que bloquee al dueño | DIFIERE-FORMA: igual que C1; `limpiarBaseDeTest` borra como dueño |
| 21 | Dinero | `numeric(18,2)` | `Decimal(14,2)`, centavos `bigint` | DIFIERE: confirmado por el dueño (2026-11-16, «El de Motor2 hoy») |
| 22 | No se abre cuenta mientras la jornada está en cierre (ficha del concepto) | lo hace ventas | **no entra**: no se toca `src/server/actions/pos/**` (carril de otro frente) | PENDIENTE: pregunta P-POS |
| 23 | Cuentas abiertas que impiden empezar el cierre | `ventas.cuentas_abiertas` | idem, sobre todas las cuentas abiertas de la sucursal | IGUAL en forma; **NO VERIFICADO** en Motor2 si un mostrador deja cuentas abiertas de por vida |

## 3. Escalera de diseño (niveles 2 a 10, resumen de lo que cambia respecto de C1)

### Nivel 2. Actores
Operador, administrador y gerente (como Pedernal). Ajustar: solo gerente y administrador (parámetro booleano). Plataforma: no interviene.

### Nivel 3. Casos de uso (CU8 y CU13 de la escalera de C1)
`iniciarAuditoria` («Empezar el cierre»), `cancelarAuditoria`, `corregirMedioDeCobro`, `declararTotal`, `darConformeGeneral`, `cerrarJornada`, `registrarAjuste`; cambian `abrirSesion` y `cobrarCuenta`.

### Nivel 4. Conceptos y ciclo de vida
- **Jornada de sucursal** `(sucursal, fecha de negocio)`: `ABIERTA → EN_AUDITORIA ⇄ ABIERTA`; `EN_AUDITORIA → CERRADA`; nada sale de `CERRADA`. **Nace con la primera actividad** (abrir una sesión de caja) y **no se cierra sola**. Cambiar la hora de corte no mueve jornadas existentes (la fecha la sella la sesión).
- Una sesión abierta pasada la hora de corte **sigue cobrando en su jornada** (la que selló al abrir) y el resultado del cobro avisa `jornadaVencida`.
- **Corrección de medio:** traslada el importe completo del cobro del medio vigente a otro, con motivo; el cobro y el arqueo no cambian; solo se mueve la conciliación. Cada corrección es una fila con `secuencia + 1`.
- **Declaración de total:** el total que dicen los comprobantes de un medio que no es efectivo; secuencia, rige la última; gana sobre el conforme general.
- **Conforme general:** uno por jornada; no cubre el efectivo.
- **Control:** `modulo.control` con severidad `BLOQUEA` / `RECONOCIBLE` / `INFORMA`. La huella del día es el sha256 de la lista ordenada de `(clave, severidad, cantidad, detalle)`; lo que se ve es lo que se cierra.

### Nivel 5. Invariantes y políticas
1. Todo nace cerrado: la jornada solo se crea por actividad; lo escrito después de cerrada solo entra como ajuste del día en curso.
2. Una jornada `CERRADA` es inmutable (disparador); los controles solo se guardan al cerrarla, en la misma transacción.
3. Abrir sesión y cobrar exigen jornada `ABIERTA`; mover efectivo, anular, ajustar también (disparador de la base, con `FOR SHARE`).
4. Corregir medio, declarar total y dar conforme exigen jornada `EN_AUDITORIA`.
5. Empezar el cierre exige que no haya impedimentos: sesiones sin cerrar y cuentas abiertas.
6. Cerrar exige: la huella vista igual a la actual (`CONTROLES_CAMBIARON`), ningún `BLOQUEA` con hallazgos, todo `RECONOCIBLE` con hallazgos reconocido (el texto es opcional), reconocimientos válidos.
7. Texto de explicación, motivo y observación: lista de permitidos (letras latinas, dígitos, espacio y signos de una frase), 1 a 500, sin blancos en los extremos; lo repiten el caso de uso y los CHECK.
8. Anular el ticket entero **no** mueve la caja: queda como diferencia en `cobrado_contra_ticket`.

### Nivel 6. Historia y persistencia (migración `20261117114000_caja_c2_jornada`, aditiva, reversible)
Tablas nuevas (5): `JornadaDeSucursal`, `ControlDeJornadaCerrada`, `CorreccionDeMedio`, `DeclaracionDeTotal`, `ConformeDeJornada`. Columnas nuevas: `Sucursal.horaDeCorte`, `SesionCaja.horaDeCorte`, `MovimientoCaja.corrigeJornada`. Cambios de reglas de C1: `AJUSTE` en el CHECK de clase, signo y motivo; disparadores de `SesionCaja` y `MovimientoCaja` ampliados. RLS por empresa en la misma migración y por sucursal en `20261117115000_rls_sucursal_caja_c2` (salida exacta del generador). `down.sql` aborta si hay filas con significado; `verificacion-previa.sql` es solo lectura. Para las sesiones que ya existieran, la migración crea su jornada `ABIERTA` (idempotente).

### Nivel 7. Atomicidad y concurrencia
Cada comando en `conTransaccionSerializable` con el `true` final. La clave de reintento se mira **antes** que el estado. Quien tiene actividad en la jornada la toma `FOR SHARE`; quien cambia su estado (iniciar, cancelar, cerrar) la toma `FOR UPDATE`: o la actividad entra antes y el impedimento la ve, o la jornada ya está en cierre y no se escribe. Segunda barrera: únicos (`(cobro, secuencia)`, `(jornada, medio, secuencia)`, uno por jornada, claves de reintento) y los disparadores.

### Nivel 8. Acceso
Los casos de uso reciben el actor y, donde hace falta, un booleano (`puedeAjustar`). Sin Server Actions, pantallas ni claves de permiso en esta etapa.

### Nivel 9. Consultas
La lectura de controles y su huella (`leerControlesDeLaJornada`) es la que usa `cerrarJornada` y la que usará la pantalla. La consulta pública y las pantallas son de otro turno.

### Nivel 10. Pruebas, migración y operación
Ver §5 (oráculo) y `test/caja/`. Sin datos que migrar. Despliegue congelado; aplicar solo con autorización expresa por base.

## 4. Tabla «¿qué pasa si…?» por comando

Convención: R repetición · C concurrencia · T tiempo · I incertidumbre · Re reintento · EP error parcial · DF datos faltantes · CP cambio de permisos.

| Comando | R | C | T | I / Re | EP | DF | CP |
|---|---|---|---|---|---|---|---|
| `iniciarAuditoria` | ya `EN_AUDITORIA` → `yaEstabaEnAuditoria`, sin escribir ni auditar | dos a la vez: `FOR UPDATE` serializa, escribe uno | jornada inexistente → `JORNADA_NO_ENCONTRADA`; la hora de corte no la cierra | doble clic = un solo cambio | estado + auditoría juntos o nada | fecha inválida → `FECHA_INVALIDA`; con sesiones o cuentas abiertas → `JORNADA_CON_IMPEDIMENTOS` | cualquier rol operativo |
| `cancelarAuditoria` | ya `ABIERTA` → `yaEstabaAbierta` | idem `FOR UPDATE` | `CERRADA` → `JORNADA_CERRADA` | seguro | idem | — | idem |
| `corregirMedioDeCobro` | misma clave y mismo pedido → `yaExistia`; otro contenido → `CLAVE_REUTILIZADA`; mismo medio → `MEDIO_DEL_COBRO_SIN_CAMBIOS` | dos correcciones del mismo cobro: el único `(cobro, secuencia)` deja una; la otra ve `MEDIO_DEL_COBRO_CAMBIO` | solo con jornada `EN_AUDITORIA`; cerrada → `JORNADA_CERRADA`; abierta → `JORNADA_NO_EN_AUDITORIA` | reintento con la misma clave devuelve lo hecho | corrección + auditoría juntas; el cobro original no cambia | cobro inexistente → `COBRO_NO_ENCONTRADO`; sin motivo → `MOTIVO_INVALIDO`; medio inactivo → `MEDIO_NO_HABILITADO` | permiso propio (Server Action) |
| `declararTotal` | idem por clave; secuencia `+1` | dos a la vez: único del par con secuencia | `EN_AUDITORIA` | idem | declaración + auditoría | efectivo → `MEDIO_NO_DECLARABLE`; importe fuera de rango → `IMPORTE_INVALIDO` | idem |
| `darConformeGeneral` | uno por jornada: repetirlo o con otra clave devuelve el que ya está (`yaExistia`) | único por jornada | `EN_AUDITORIA` | idem | idem | — | idem |
| `cerrarJornada` | ya cerrada con el mismo pedido → `yaEstabaCerrada` sin escribir; otro contenido → `JORNADA_CERRADA` | `FOR UPDATE`: uno cierra, el otro ve cerrada | `ABIERTA` → `JORNADA_NO_EN_AUDITORIA`; nunca se cierra sola | reintento con la misma huella | **todo o nada**: estado, foto de controles y auditoría juntos | huella distinta → `CONTROLES_CAMBIARON` con los controles de ahora; `BLOQUEA` → `CONTROLES_QUE_BLOQUEAN`; `RECONOCIBLE` sin reconocer → `CONTROLES_SIN_RECONOCER`; reconocer lo que no corresponde → `RECONOCIMIENTO_INVALIDO` | permiso propio |
| `registrarAjuste` | misma clave y mismo pedido → `yaExistia` | contra el cierre de la sesión: serializable | solo con la sesión `ABIERTA`; jornada a corregir `CERRADA` y anterior a la de la sesión | idem | movimiento + auditoría | sin motivo, importe 0 o fuera de rango → rechaza | `puedeAjustar` falso → `SIN_PERMISO_PARA_AJUSTAR` (cierra por defecto) |
| `abrirSesion` (cambia) | idem C1 | idem C1 | jornada `EN_AUDITORIA` → `JORNADA_EN_AUDITORIA`; `CERRADA` → `JORNADA_CERRADA`; sin jornada: la crea | idem | jornada + sesión + fondo + auditoría | — | idem |
| `cobrarCuenta` (cambia) | idem C1 | idem C1 | jornada de la sesión no `ABIERTA` → `JORNADA_EN_AUDITORIA` / `JORNADA_CERRADA`; sesión pasada su corte → cobra y avisa `jornadaVencida` | idem | idem | — | idem |

## 5. Oráculo de combinaciones (escrito aparte del código)

El oráculo vive en `test/caja/oraculo-de-jornada.ts` como tablas de datos legibles (no como `if`). Los tests lo recorren **exhaustivamente** contra la base real y contra el núcleo puro. Un guardián (`test/caja/oraculo-de-jornada.test.ts`) falla si aparece una dimensión nueva sin declarar si afecta o no: un estado de jornada, una clave de control, una clase de movimiento o una columna de las tablas nuevas.

**Dimensiones que cambian dinero, permisos, visibilidad o stock:**
1. estado de la jornada (`SIN_ACTIVIDAD`, `ABIERTA`, `EN_AUDITORIA`, `CERRADA`) × comando (`abrirSesion`, `cobrarCuenta`, `iniciarAuditoria`, `cancelarAuditoria`, `corregirMedioDeCobro`, `declararTotal`, `darConformeGeneral`, `cerrarJornada`).
2. `registrarAjuste` (siempre sobre una jornada cerrada): permiso (sí, no) × estado de la sesión (`ABIERTA`, `CERRADA`) × jornada a corregir (relación con la de la sesión: anterior, igual, posterior × estado de esa jornada).
3. control: severidad (`BLOQUEA`, `RECONOCIBLE`, `INFORMA`) × hay hallazgos (sí, no) × reconocido (sí, no) → permite cerrar o el código de rechazo.
4. fecha de negocio: instante × hora de corte × zona (incluido el pasaje de medianoche UTC contra Argentina y `05:59:59.999` contra `06:00:00.000`).
5. clase de movimiento × signo del importe (ya cubierto en C1; ahora con `AJUSTE`).

## 6. Decisiones del dueño (2026-11-16) y preguntas abiertas

Respondidas por el dueño, con sus palabras (CONFIRMADAS): **P-CORTE** «00:00; la cambia el gerente o administrador (Recomendada)» (la hora de corte por defecto es 00:00; cambiarla es una pantalla de otro turno); **P-CTA** «Sí, hay que cobrarla o anularla antes de cerrar (Recomendada)» (una cuenta abierta frena el cierre: `ventas.cuentas_abiertas` BLOQUEA); **P-FOTO** «También la conciliación por medio, como Pedernal» (se construye en la etapa C2b, §7); **P-AJUSTE** «Solo sobre días cerrados (Recomendada)» (`corrigeJornada` obligatoria).

Sigue abierta:

- **P-POS.** «Mientras la jornada está en cierre no se abre cuenta» (ficha de Pedernal): no se toca el POS en esta etapa. ¿Se pide en el frente del POS?

## 7. Etapa C2b: la foto congelada de la conciliación por medio (migraciones `20261117116000_caja_c2b_conciliacion` y `20261117117000_rls_sucursal_caja_c2b`)

Necesidad (nivel 1): el dueño pidió «También la conciliación por medio, como Pedernal» (2026-11-16, respuesta a P-FOTO). Qué es: al cerrar el día se congela, por medio de pago, lo registrado, las correcciones, el total declarado y la diferencia, más las cobranzas cuyo cobrado difiere del total del ticket. Así el cierre de un día queda con la conciliación tal como se vio al cerrarlo, aunque después cambie el total vigente de un ticket.

### 7.1 Auditoría contra Pedernal (lo que se reproduce y lo que cambia)

| Pedernal | Motor2 | Motivo de la diferencia |
|---|---|---|
| Cabecera `cierre_de_caja_de_jornada`, una por jornada | `CierreDeCajaDeJornada` (`jornadaId` único), con `id` propio | Prisma pide clave propia en la cabecera; la unicidad por jornada se mantiene |
| `conciliacion_de_jornada`: una línea por medio, con `estado_de_conteo` CONTADO / DECLARADO / CONFORME / SIN_DATO | `ConciliacionDeJornada`, mismos estados, único por (empresa, cabecera, medio) | igual |
| `diferencia` = declarado − (registrado + correcciones) | columna generada por la base (`diferencia`), nunca escrita por la app | igual resultado; la base la calcula |
| `conciliacion_de_cobro_por_origen` con `origen_tipo` / `origen_id` / `ticket_id` | `ConciliacionDeCobroPorOrigen` con `cobranzaId` (clave foránea a la `Cobranza`) | en Motor2 el origen de un cobro es la cobranza de la cuenta; no hay origen opaco (impone el modelo de datos existente) |
| ids texto o uuid | uuid | lo que usa Motor2 |
| Importes | `Decimal(14,2)` | lo que usa Motor2 |
| Conforme de la línea: «por» y «en» | del cierre de caja de la sesión (`cerradaPorId`, `cerradaEn`) o del conforme general; desempate por mayor id | determinismo igual en el núcleo y en la base |
| La foto puede escribirse con la jornada en cierre o cerrada | SOLO con la jornada pasando a `CERRADA` en la misma transacción (`xmin = pg_current_xact_id()`) | decisión de diseño más estricta: la foto no se puede sembrar antes ni agregar después. Diferencia declarada, sin cita del dueño: es una barrera de la base, no una función |
| Chequeo de persona | no hay | Motor2 audita con `RegistroAuditoria` |

### 7.2 Tabla «¿qué pasa si…?» de la foto (parte de `cerrarJornada`)

| Situación | Qué pasa |
|---|---|
| Repetición | el segundo `cerrarJornada` ve la jornada `CERRADA` y devuelve `yaEstabaCerrada` sin escribir: una sola cabecera |
| Concurrencia (seis cierres a la vez) | `FOR UPDATE` sobre la jornada: uno escribe la foto, los demás ven cerrada; índice único por jornada como segunda barrera |
| Tiempo | la foto lleva `congeladoEn` = el instante del cierre; lo que cambie después (total del ticket) no la toca |
| Incertidumbre (hay un medio sin dato) | el cierre exige reconocer `caja.conciliacion_por_medio`; esa explicación se copia SOLO a las líneas SIN_DATO / con diferencia; sin reconocimiento no se cierra y no queda nada de la foto |
| Reintento tras caída | la transacción es una sola (estado, controles y foto): o está todo o no hay nada |
| Error parcial | si falla cualquier escritura de la foto o el disparador diferido `CierreDeCajaDeJornada_verificar` (recalcula y compara) se deshace el cierre entero |
| Datos faltantes | una línea sin el medio con movimientos o con un medio de más: `caja_conciliacion_incompleta`; un valor alterado: `caja_conciliacion_no_cuadra` |
| Cambio de permisos | la app solo puede leer y agregar (privilegios SELECT e INSERT; sin UPDATE, DELETE ni TRUNCATE); RLS por empresa y por sucursal |
| Foto fuera del cierre | con la jornada abierta o con una foto de antes: `foto_de_caja_solo_al_cerrar_la_jornada` / `lineas_de_la_foto_solo_con_su_cabecera_en_la_misma_transaccion` |
| Un día sin movimientos | cabecera sin líneas |

### 7.3 Oráculo del conteo (escrito aparte del código)

`test/caja/oraculo-de-jornada.ts` (`ORACULO_DE_CONTEO`, `ESTADO_DEL_EFECTIVO`): el efectivo es siempre CONTADO; en los demás medios manda la declaración vigente, después el conforme general, después lo derivado de los cierres de caja (todos contados: DECLARADO; todos conformes: CONFORME; mezcla o nada: SIN_DATO). Las 16 combinaciones se recorren en `nucleo-de-jornada.test.ts`; la base y el caso de uso se prueban en `conciliacion-congelada.test.ts` y el subir/bajar/subir en `test/aislamiento/caja-c2b-subir-bajar-subir.test.ts`. El guardián de columnas del oráculo falla si aparece una columna nueva de las tres tablas sin declarar. Alcance de la prueba: el caso «todos contados» en un medio que no es efectivo no se da con C1 (la sesión da por conforme los demás medios) y solo se prueba en el núcleo puro.

### 7.4 Orden de migraciones

C2b va después de C2 y C3 usa 112000 y 113000: al rebasar sobre C3, la función `"MovimientoCaja_validar"` la reemplazan C3 y C2 (ver `114000`); lo resuelve quien integra, no esta etapa.
