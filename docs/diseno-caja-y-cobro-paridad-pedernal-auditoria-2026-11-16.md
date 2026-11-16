# Caja y cobro, paridad con Pedernal — 1. Auditoría (2026-11-16)

Frente 1 del programa de paridad (`motor2-docs`, `_coordinacion/mapa-de-carriles-2026-11-16.md`). **Fase 1: solo documentos. Sin código, sin migraciones, nada aplicado a ninguna base.**

Documentos hermanos de este mismo diseño: `docs/diseno-caja-y-cobro-paridad-pedernal-2026-11-16.md` (resumen, etapas, carril, dependencias, preguntas) y `docs/diseno-caja-y-cobro-paridad-pedernal-escalera-2026-11-16.md` (niveles 1 a 10 y tabla «¿qué pasa si…?»).

Marcas: **(M)** leído por mí en el código real de Motor2 (`src/`, `prisma/schema.prisma`, hoy, `main` `903c0f6d`). **(P)** Pedernal: leído por un agente de lectura sobre clones locales (`ZuluHub-ERP` `ad4a9a4`, merge del PR #350, 16/11 11:36 -03:00; `ZuluHub-docs` clon superficial del mismo día); yo verifiqué directamente solo la existencia y forma de `migraciones/0026_cierre.sql`, `0027_caja.sql`, `0028_ventas.sql`, `0038_salon.sql` y los nombres de las tablas de caja. **(DOC)** solo de un documento. **NO VERIFICADO** = no lo leí.

**Límites declarados:** el clon de Pedernal es superficial y `novedades-para-motor2.md` dice que el último PR cargado es el #360; puede estar atrás de `main`. No corrí ninguna prueba de Pedernal ni miré su base real. Las fichas `conceptos/` de `ZuluHub-docs` están desactualizadas en un punto (ventas ya manda `datos` del cobro: código manda, ficha no).

## A. Qué hay hoy en Motor2 (M)

| Pieza | Estado real en Motor2 | Evidencia |
|---|---|---|
| Caja, sesión de caja, apertura con fondo, movimientos de caja, arqueo | **No existe** (ni modelo, ni permiso, ni módulo en el catálogo) | `prisma/schema.prisma` (no hay `Caja`/`Sesion*`/`Movimiento*Caja`); `src/core/modulos/catalogo.ts` (sin `caja`) |
| Medios de pago de ventas | **No existe.** Solo hay una lista de medios de pago de **proveedores** (`TRANSFERENCIA, EFECTIVO, CHEQUE, TARJETA, OTRO`) | `src/core/compras/pago-de-factura.ts:9` |
| Cobro de una cuenta / ticket | **No existe.** «Pagar y cerrar son UNA sola acción atómica (plan B5: motor2 no tiene entidad de caja ni de pago)» | `src/server/actions/pos/cuenta-cierre.ts:17-18` |
| «Cuenta cerrada» | Significa **vendida con stock descontado y ticket numerado**, no cobrada. Solo `cerradaEn`/`cerradaPorId` | `cerrarCuentaCasoDeUso` (`src/server/actions/pos/casos-de-uso/cerrar-cuenta.ts`); modelo `Cuenta` (`schema.prisma:2414`) |
| Estado «cobrada / sin cobrar» | **No existe** | idem |
| Ticket | `EjemplarTicket`: `numero`, `ejemplar`, `corrigeAId`, `motivo`; solo agrega; «no válido como factura». No lleva total ni estado | `schema.prisma:2562` |
| `Venta` (cabecera con total) | Modelo existente que **nadie escribe ni lee** (`grep` de `.venta.create/upsert/find*` vacío) | `schema.prisma:2831` |
| Mostrador | Es una **mesa tipo `MOSTRADOR`** por sucursal, habilitada por un administrador; mismas pantallas y flujo que el salón (ADR-039). `cerrarCuenta` no cobra | `abrir-cuenta-de-mostrador.ts`, `habilitar-mostrador.ts`, `src/app/(pos)/mesas/mostrador` |
| «Venta de mostrador» heredada | Ruta `/movimientos/venta` (`registrarVenta`): sin cuenta, sin ticket, sin cobro; el dueño la declaró «mal llamada» (2026-10-26) | `src/app/(app)/movimientos/venta`; `docs/diseno-ventas-salon-y-mostrador-2026-10-26.md` §0 |
| Vuelto | **No existe** | `grep` |
| Propina | **No existe** (y Pedernal decidió que no existe) | `grep` |
| Cierre del día / jornada | **No existe.** No hay modelo de jornada ni hora de corte | `Sucursal` sin hora de corte; solo `Empresa.zonaHoraria` (`schema.prisma:2602`) |
| Zona y fecha | `Empresa.zonaHoraria` (IANA); `ZONA_ARGENTINA`; `core/tiempo` es el único lugar que conoce zonas (guardián `zona-horaria-solo-en-tiempo`); límites de día por `Intl`, con horario de verano | `src/core/tiempo/zona-horaria.ts` |
| Dinero | `MONEDA_FIJA = "ARS"`; `redondearMoneda`/`importeDeLinea` con `decimal.js`, HALF_UP alejándose del cero (= `round(numeric,2)` de Postgres); columnas `Decimal(14,2)` | `src/core/moneda.ts`; `schema.prisma` |
| Idempotencia de ventas | Por estado (cuenta ya cerrada → ok sin escribir) + `conTransaccionSerializable` con reintento; hay claves I3 (`claveIdempotencia`, `payloadHash`) en `registrarVentaEnTx` | `cerrar-cuenta.ts:49-50`; `registrar-venta-en-tx.ts:326` |
| Permisos de POS | `pos_mesas`, `pos_abrir_cuenta`, `pos_tomar_pedido`, `pos_enviar_a_cocina`, `pos_cerrar_cuenta`, `pos_anular_item`, `pos_emitir_ticket_corregido`, `anular_venta`; **ninguno de caja ni cobro**. Ninguno dice «cobrar» (el propio comentario de `pos_tomar_pedido` aclara «sin poder … cobrar») | `src/core/permisos/acciones.ts:194-247` |
| Factura externa de venta | Diseñada en papel (`docs/diseno-factura-externa-n1-n2-2026-11-15.md`), **sin tablas ni código** | `schema.prisma` (no hay `FacturaExterna`) |
| Pagos de **compras** (otro libro) | `PagoDeFacturaProveedor` + `AnulacionDePagoDeFacturaProveedor`: registro que solo se agrega, índice único parcial de vigente, clave de reintento. **No** es caja de ventas | `schema.prisma:3105-3131` |

**Antecedentes de diseño propios (documentos, ya aprobados en parte):** `docs/diseno-caja-y-cobros-2026-11-04.md` (niveles 1 a 5 confirmados el 04/11, con cuenta corriente, señas, folio de reservas, caja diaria y caja chica con billetes), `docs/diseno-ventas-salon-y-mostrador-2026-10-26.md`, `docs/diseno-factura-externa-n1-n2-2026-11-15.md`. **Conflicto detectado:** el diseño del 04/11 imagina un modelo de cobro propio (imputación a cargos, señas, cuenta corriente como medio, caja grande/chica) y el dueño dijo el 14/11 «Como Pedernal: con caja, sesión y jornada». Pedernal **no tiene** cuenta corriente, seña ni caja grande. Este diseño sigue Pedernal en lo mínimo y deja lo del 04/11 que Pedernal no tiene como etapas posteriores con nombre (ver resumen, §«Qué se hace con el diseño del 04/11»). `motor2-docs` (`04-contabilidad-y-caja/compatibilidad-motor2-caja.md`, 1014 líneas) es un informe de compatibilidad de octubre contra otro sistema de referencia: **NO VERIFICADO** en detalle; solo confirma que en octubre tampoco había caja.

## B. Qué tiene Pedernal hoy (P)

Todo con `RLS ENABLE+FORCE`, sin DELETE/TRUNCATE para la app, transacción SERIALIZABLE y auditoría en la misma transacción.

**Tablas** (`ERP/migraciones/0026_cierre.sql`, `0027_caja.sql`, `0028_ventas.sql`, `0038_salon.sql`):

| Tabla | Qué es / restricciones clave |
|---|---|
| `caja` | Lugar de cobro de una sucursal («Caja 1», nace sola); `nombre` único por sucursal sin mayúsculas; no se desactiva con sesión sin cerrar; límite por perilla `cajas_por_sucursal` (base 1) |
| `medio_de_pago` | 6 tipos cerrados (`EFECTIVO`, `TARJETA_DEBITO`, `TARJETA_CREDITO`, `TRANSFERENCIA`, `QR`, `OTRO`); un efectivo por empresa que no se desactiva; `pide_cupon/ultimos4/marca/cuotas/dni` con **techo por tipo** (CHECK); el tipo es inmutable |
| `cuenta_de_cobro` | Terminal, QR o cuenta bancaria de **una** sucursal; opcional en el cobro |
| `sesion_caja` | `ABIERTA`/`EN_CIERRE`/`CERRADA`; sella `fecha_negocio`, `hora_de_corte`, `zona_horaria` al abrir; a lo sumo una sin cerrar por caja (índice único parcial); clave de idempotencia única; exige jornada `ABIERTA` |
| `movimiento_caja` | Solo inserción; clases `FONDO_INICIAL`, `COBRO`, `INGRESO_MANUAL`, `EGRESO_MANUAL`, `AJUSTE`, `ANULACION`; `numeric(18,2)` con signo y tope; moneda `ARS`; motivo obligatorio en manual/ajuste/anulación; se anula una sola vez, con espejo; un cobro **no** se anula desde caja |
| `cobro` | 1 a 1 con un movimiento `COBRO`; identidad `(empresa, origen_tipo, origen_id, origen_orden)`; datos tipados (`cupon`, `ultimos4`, `marca`, `cuotas` 1..36, `dni` 6..9 dígitos); un dato no habilitado por el medio se rechaza en la base |
| `arqueo_caja` / `arqueo_billete` | Solo inserción; por (medio, cuenta) esperado vs contado/declarado; diferencia **generada**; efectivo por billetes 20.000, 10.000, 2.000, 1.000, 500, 200 y 100 más monedas; chequeo diferido al cerrar que recalcula el esperado |
| `correccion_de_medio`, `declaracion_de_total`, `conforme_de_jornada`, `cierre_de_caja_de_jornada`, `conciliacion_de_jornada`, `conciliacion_de_cobro_por_origen` | Corrección de medio del cobro (sin tocar el original), declaración de totales por medio, conforme general, foto congelada del cierre |
| `jornada_de_sucursal` + `control_de_jornada_cerrada` | `ABIERTA`/`EN_AUDITORIA`/`CERRADA`; `CERRADA` inmutable; foto de controles con severidad `BLOQUEA`/`RECONOCIBLE`/`INFORMA` |
| `ticket`, `cobranza_de_ticket`, `aplicacion_de_cobro`, `ticket_correccion` | Ticket `EMITIDO`/`COBRADO`/`CORTESIA`/`ANULADO` con `total`; una cobranza por ticket; chequeo diferido `Σ aplicaciones = total` |
| `valor_de_lista` | Tabla global (marcas de tarjeta, motivos de rechazo); la escribe solo la plataforma |

**Comandos** (`ERP/src/modulos/caja/casos-de-uso/`, `ERP/src/modulos/ventas/casos-de-uso/`, `ERP/src/modulos/cierre/casos-de-uso/`): `abrirSesion`, `iniciarCierre`/`cancelarCierre`, `cerrarSesion` (permite cerrar con diferencia y la audita), `registrarMovimientoManual` (solo efectivo; un egreso mayor al esperado **se permite** y avisa), `registrarAjuste` (gerente/administrador), `anularMovimientoDeCaja`, `registrarCobroEnTx` (puerto, no acción de usuario; la clave es `cobro_<origen>_<orden>`), `cobrar`, `venderYCobrar`, `cobrarMesa` (cierra y cobra), `anularTicket` (**no** escribe en caja: lo cobrado queda como diferencia a explicar en el cierre), `iniciarAuditoria`, `cerrarJornada` (todo o nada), `corregirMedioDeCobro`, `declararTotal`, `darConformeGeneral`. **Regla común:** la clave de idempotencia se mira **antes** que el estado; misma clave y misma huella → devuelve lo hecho (`yaExistia`); misma clave con otro contenido → `CLAVE_REUTILIZADA`.

**Dinero y fechas:** solo ARS; dentro del código `bigint` de centavos; en la base `numeric(18,2)`; frontera como texto decimal `^[0-9]{1,9}(\.[0-9]{1,2})?$`; tope 999.999.999,99; `Σ cobros = total` al centavo (`COBRO_NO_CUADRA{falta|sobra}`); vuelto solo en efectivo, a caja va el neto, el efectivo recibido y el vuelto no se guardan. `fechaDeNegocio(instante, zona, corte) = fecha civil del instante en la zona − hora de corte`, se calcula **una vez** al abrir la sesión y se sella; la jornada no se cierra sola; un error en jornada cerrada se corrige con un ajuste del día en curso (`AJUSTE` con `corrige_jornada`).

**Permisos (3 roles base: gerente, administrador, operador):** solo gerente crea/desactiva cajas; gerente y administrador editan medios, cuentas de cobro y ajustan; los tres abren/cierran sesión, mueven efectivo, cobran, corrigen medio y operan la jornada. Que cada medio pida datos se edita con `medios_de_pago.editar` (supuesto DEC-0056 S-2 de Pedernal).

## C. Tabla de paridad

Categorías: **IGUAL** (mismo resultado y forma) · **DIFIERE-RESULTADO** · **DIFIERE-FORMA** · **FALTA-M2** (falta en Motor2) · **FALTA-PED** (Pedernal no lo tiene) · **NO VERIFICADO**.

| # | Tema | Pedernal (P) | Motor2 (M) | Categoría | Nota |
|---|---|---|---|---|---|
| 1 | Caja como lugar de cobro por sucursal | `caja`, nace sola, perilla `cajas_por_sucursal` | no existe | FALTA-M2 | Perilla = Frente 4 |
| 2 | Medios de pago de venta, 6 tipos cerrados, efectivo único | `medio_de_pago` | solo lista de proveedores (5 valores, otros nombres) | FALTA-M2 | No reutilizable: es otro libro |
| 3 | Datos del cobro por medio con techo por tipo | `pide_*` + CHECK de techo | no existe | FALTA-M2 | Etapa posterior (pedido por Pedernal 15/11, «primera versión» del mostrador) |
| 4 | Cuenta de cobro (terminal/QR/banco) | `cuenta_de_cobro` | no existe | FALTA-M2 | Opcional en Pedernal (CYN 151): etapa posterior |
| 5 | Sesión de caja con fondo inicial y sello de fecha | `sesion_caja` | no existe | FALTA-M2 | |
| 6 | Movimientos de caja solo inserción, anulación por espejo | `movimiento_caja` | no existe | FALTA-M2 | Forma ya probada en Motor2 con `PagoDeFacturaProveedor` |
| 7 | Cobro de un ticket con `Σ cobros = total` | `cobrar`, `cobranza_de_ticket` | no existe; el cierre «paga» sin registrar medio | FALTA-M2 | Diferencia de forma: Pedernal tiene `ticket` con `total` y `estado`; Motor2 tiene `EjemplarTicket` sin total ni estado (§D.1) |
| 8 | Cobrar al cerrar la mesa en un solo gesto | `cobrarMesa` = cierra y cobra | `cerrarCuenta` cierra y vende, **no cobra** | DIFIERE-RESULTADO | Pregunta Q1 |
| 9 | Mostrador: venta rápida con cobro en una transacción | `venderYCobrar` | mostrador es una mesa; cierra sin cobrar | DIFIERE-RESULTADO | Depende de Q1 |
| 10 | Vuelto (solo efectivo, a caja el neto) | `calcularVuelto` | no existe | FALTA-M2 | Presentación; el servidor solo valida `Σ=total` |
| 11 | Propina | decidida «no debe estar» (09/11) | no existe | IGUAL (no existe) | No entra |
| 12 | Arqueo por billetes + monedas | 7 denominaciones (100 a 20.000); Motor2 usa las 10 de la planilla del dueño (CONFIRMADA 2026-11-16) | no existe | FALTA-M2 | **Conflicto de datos:** la planilla del dueño del 04/11 lista 10 denominaciones (10 a 20.000); Pedernal 7. Q-DENOM |
| 13 | Cierre de sesión con diferencia permitido y auditado | `cerrarSesion` | no existe | FALTA-M2 | |
| 14 | Corrección de medio del cobro | `corregirMedioDeCobro` | no existe | FALTA-M2 | Etapa de cierre del día |
| 15 | Jornada de sucursal y cierre del día | `jornada_de_sucursal` | no existe | FALTA-M2 | Necesita hora de corte (§D.3) |
| 16 | Hora de corte por sucursal | `sucursal.hora_de_corte` | no existe (solo `Empresa.zonaHoraria`) | FALTA-M2 | Frente 3 |
| 17 | Zona horaria Argentina, cortes de día | `fecha_de_negocio` en código y en la base | `core/tiempo` con `Intl` (día calendario por zona; sin hora de corte) | DIFIERE-FORMA | La función de corte se agrega sin romper `core/tiempo` |
| 18 | Dinero en enteros/decimal exacto | `bigint` centavos / `numeric(18,2)` | `decimal.js` / `Decimal(14,2)` | DIFIERE-FORMA | Frente 3 decide ancho; las tablas nuevas usarían `Decimal(18,2)` y tope de Pedernal (NO VERIFICADO si Frente 3 lo adopta) |
| 19 | Anular ticket sin tocar caja | `anularTicket` | `anular_venta`/corrección de línea existen; sin caja | NO VERIFICADO | Depende de Q1 y de la etapa de cobro |
| 20 | Nota de crédito de venta | comprobante fiscal `NOTA_CREDITO` | no existe | FALTA-M2 | **Fuera de este frente** (facturación) |
| 21 | Cobro en partes | decidido 14/11, **no construido** | no existe | FALTA-PED | No entra hasta que Pedernal lo construya (sería diferir) |
| 22 | Cuenta corriente / seña / anticipo / folio de reservas | no existe | diseñado en papel el 04/11 | FALTA-PED | Conflicto con «igual a Pedernal»: etapa posterior con nombre, Q-CC |
| 23 | Caja grande/caja fuerte, depósitos bancarios, egresos por transferencia | no existen (solo ingreso/egreso manual de efectivo) | diseñados en papel el 04/11 | FALTA-PED | Idem |
| 24 | Permisos de caja y cobro | ~25 acciones por rol | no existen | FALTA-M2 | Zona compartida `acciones.ts` + Roles P1 |
| 25 | Módulo `caja` en catálogo comercial | `caja` `en_desarrollo` (el dueño pidió «disponible», decisión 172) | no existe | FALTA-M2 | Frente 4 |
| 26 | Facturación electrónica ARCA, comprobante, puntero ticket→comprobante | módulo fiscal | no existe; factura externa en papel | NO VERIFICADO | Fuera de este frente (pregunta Q-ARCA) |
| 27 | Marcas de tarjeta (lista global) | `valor_de_lista` | no existe | FALTA-M2 | Solo con datos del cobro; consola de plataforma = Frente 4 |
| 28 | Pantallas de cobro/caja/cierre | **no encontradas en `ERP/apps/web`** (solo config de cajas, cuentas y medios) | no existe | FALTA-PED | Hay maquetas aprobadas (`10-ux-ui/prototipos-gastronomia/`); Frente 6 |
| 29 | «Obligatorio» por dato de medio, pisos de plataforma | diseñado (`parametrizacion-de-medios-de-pago.md`), no construido | no existe | FALTA-PED | No entra |
| 30 | Cobro con cliente (transferencia lleva «cliente») | dato «cliente»: maqueta sí, código solo DNI (contradicción abierta en Pedernal) | no existe | NO VERIFICADO | No se decide; se sigue el código (solo DNI) |

## D. Hallazgos que condicionan el diseño

1. **El ticket de Motor2 no tiene total ni estado.** Pedernal cobra un `ticket` con `total` y `estado`. En Motor2 el «ticket» es un `EjemplarTicket` sin dinero. El total cobrable de una cuenta cerrada hay que **derivarlo** de las líneas vendidas (el mismo cálculo de `cerrarCuenta`: `importeDeLinea` por línea, precio cobrado con descuento congelado). Propuesta de forma: la cobranza referencia la **cuenta** (una cobranza por cuenta, único); «cobrada» se **deriva** de que exista la cobranza, sin columna de estado que se actualice (consistente con «solo se agrega»). Difiere en forma de Pedernal; motivo: Motor2 no tiene `ticket` con estado y no se reescribe lo existente (declarar en el PR de Fase 2).
2. **Un solo punto de cierre:** hoy cerrar = vender + numerar ticket, y ya hay anulaciones y correcciones de línea post-cierre (`corregirLineaDeTicket`, `quitarUnidadesDeLinea`, `anularVenta`). Si la cuenta ya está cobrada, esas acciones **cambian el total**. Pedernal resuelve con `anularTicket` que no toca caja y deja la diferencia al cierre. Queda explicitado como riesgo y como invariante a diseñar (nivel 5, R-ANU).
3. **Hora de corte de la jornada:** no existe. Es un campo de `Sucursal` (modelo compartido) y una función pura en `core/tiempo`. Se pide a Frente 3 (fechas) o al orquestador general.
4. **Pedernal usa `uuid` generado por la aplicación y `timestamptz`; Motor2 usa `cuid()` y `DateTime`.** Es el tema del Frente 3. Las tablas nuevas de caja siguen **lo que Frente 3 declare** (NO VERIFICADO aún).
5. **Dos documentos del dueño en tensión:** el diseño del 04/11 (cuenta corriente, seña, caja diaria tipo Excel con una fila por comprobante y una columna por medio, caja chica 3 turnos, caja grande) y «Como Pedernal: con caja, sesión y jornada» (14/11). Se resuelve con etapas (resumen §«Etapas»), sin descartar nada: lo del 04/11 que Pedernal no tiene queda **pendiente de decisión** y no entra en las etapas de paridad.
