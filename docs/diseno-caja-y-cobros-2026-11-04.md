# Diseño: caja y cobros, con la factura emitida en otro sistema (2026-11-04)

Estado: **diseño en papel, a validar por el dueño. Sin código ni migraciones.** Cubre los niveles 1 a 5 de la escalera de diseño y la escalera de producto N0 a N5. **Las tablas (nivel 6) no se diseñan hasta que el dueño confirme los niveles 1 a 5** (compuerta de `AGENTS.md`).

Continúa `docs/diseno-clientes-convenios-y-facturacion-externa-2026-10-26.md` (no lo reemplaza): de ahí se toman la factura externa, el cobro y la cuenta corriente, y acá se corrigen dos puntos por lo que dijo el dueño el 2026-11-04 (ver §0.2). Se apoya en `docs/diseno-pagos-y-conciliacion-2026-11-03.md` (mismo patrón de «pago aparte que solo se agrega, y una persona decide») y en `docs/diseno-notas-de-credito-de-proveedor-2026-11-04.md` (regla N16: el documento cancela una factura y el dinero se cruza aparte).

Estados de cada decisión: **CONFIRMADA** (dicha por el dueño; se cita), **PROPUESTA** (de este diseño), **PENDIENTE** (falta decidir), **NO VERIFICADA**.

## 0. Lo que hay hoy, verificado en el código (2026-11-04)

Inventario hecho leyendo `prisma/schema.prisma` y `src/` (no los documentos).

| Pieza | Estado hoy | Evidencia |
|---|---|---|
| Cobro de una cuenta del salón, medio de pago, propina, caja, turno, arqueo | **NO EXISTE** | `cuenta-cierre.ts:17-18`: «pagar y cerrar son UNA sola acción atómica (plan B5: motor2 no tiene entidad de caja ni de pago)» |
| «Cuenta cerrada» | Significa **vendida con stock descontado**, no cobrada. Solo `cerradaEn` y `cerradaPorId` | `cerrar-cuenta.ts:54-171`; `Cuenta` `schema.prisma:2303-2348` |
| Estado «cobrada / sin cobrar» | **NO EXISTE** | idem |
| `Cliente` | Solo `nombre`, `descuentoPorcentaje`, `activo`. **Sin CUIT, tipo, condición de IVA ni cuenta corriente** | `schema.prisma:756-771` |
| Cuenta corriente de clientes (saldo, movimientos, límite) | **NO EXISTE** (lo de proveedores es otro libro) | idem |
| Factura de VENTA emitida en otro sistema (tipo, punto de venta, número, fecha) | **NO EXISTE** | ninguna columna fiscal en `Cuenta`, `Venta`, `Operacion`, `EjemplarTicket` |
| Punto de venta PROPIO de la sucursal | **NO EXISTE** (solo `PuntoDeVentaDeProveedor`) | `schema.prisma:3051-3063` |
| Reservas, alojamiento, habitaciones, folio, huésped | **NO EXISTE** (ni modelo, ni ruta, ni permiso, ni módulo) | `catalogo.ts:21-40` no tiene módulo de hotel |
| `Venta` (cabecera con total y canal) | Existe en el esquema, **nadie la escribe ni la lee** | `schema.prisma:2714-2738` |
| `EjemplarTicket` | Control interno, **«no válido como factura»** | `numeracion-ticket.ts:5` |
| Listado de tickets | `listarTicketsEmitidos` por sucursal y fechas, **sin filtro por cliente ni noción de sin cobrar** | `tickets-emitidos.ts:42-138` |
| Alcance por sucursal | `Mesa`, `Cuenta`, `CuentaItem`, `EjemplarTicket` tienen RLS por sucursal; `Cliente` es de empresa | migración `20261014140000_rls_sucursal_b4_punto_de_venta` |

**Patrones ya probados que se reutilizan** (no se inventa nada nuevo):

| Necesidad | Patrón existente |
|---|---|
| Registro que solo se agrega y se anula con un registro nuevo, un solo vigente, reintento seguro | Pagos X0: `PagoDeFacturaProveedor` + `AnulacionDePagoDeFacturaProveedor` (índice único parcial de vigente, clave de reintento única, auditoría, nunca DELETE) |
| Número de comprobante, letra, formato y parser | `src/core/datos/numero-comprobante.ts` (`LETRAS_DE_COMPROBANTE`, `armarNumeroDeComprobante`) |
| Corregir un número mal cargado con registro | `emitirTicketCorregido` (fila nueva con `corrigeAId` y `motivo`) y `corregirCompra` (auditoría por campo) |
| «Próximo número» | `siguienteNumeroTicket(max)` = `(max ?? 0) + 1` dentro de la transacción |
| Lista cerrada de medios de pago | `MEDIOS_DE_PAGO` de proveedores (`pago-de-factura.ts:9`); sirve como forma, no como dato |
| Unicidad del número de factura vigente | `FacturaProveedor_unica_vigente_key` y su detector |

## 0.1 Lo que dijo el dueño el 2026-11-04 (CONFIRMADA, textual resumido)

1. **Facturan en otro sistema.** motor2 no emite. La idea es **conciliar con el otro sistema con un par de datos más los datos de este sistema**.
2. **Datos de la factura externa:** tipo de comprobante **A o B**; **factura o nota de crédito**; **punto de venta por sucursal, con su nombre**; **número** y **fecha**; y el **monto de la factura** («que no es cobrar tampoco»).
3. **Número:** se carga el de la primera factura y luego se **sugieren los correlativos**; si el agente carga mal uno, **debe poder corregirse**.
4. **Cliente:** por **CUIT**. Una vez cargado, el módulo de clientes lo identifica; si ya existe, **se le indica** y no se carga de nuevo.
5. **A partir de la letra, el tipo y el monto se concilia:**
   - factura **a consumidor final** → aparecen los **tickets a consumidor final sin cobrar**, para que **lleven la factura hasta su monto**;
   - **un ticket cobrado sin factura** → queda **«pendiente de declarar factura»**;
   - **cliente específico** (empresa, empleado, consumidor final recurrente identificado) → trae **sus tickets que no se cobraron**.
6. **Reservas:** poder **señalar la reserva** y guardar, **como un folio, las reservas del cliente, empresa o agente de empresa**; si no se cobraron, **se mantienen pendientes**.
7. **El cobro es según los medios de pago usados**, y **según el medio se pide información adicional**.
8. **«Cuenta corriente» es un medio de pago:** va a la cuenta corriente de **esa empresa o cliente que la posee**.
10. **Caja chica en 3 turnos por sucursal** (planilla en papel que mostró el dueño el 2026-11-04). Cada planilla dice: **hostería y sector** (ejemplo: «Hostería Manzano Amargo, Recepción»), **«Caja Chica: Dinero en efectivo»**, **turno** (ejemplo: «Tarde»), **hora** («15 a 23»), la **fecha**, una tabla de **billetes** (10, 20, 50, 100, 200, 500, 1.000, 2.000, 10.000 y 20.000) con **cantidad** e **importe** por cada uno, el **total** y la **firma** de quien cierra. Ejemplo de la foto (turno tarde del 3/11): 1 × $500 + 1 × $1.000 + 59 × $2.000 + 13 × $10.000 = **$249.500**. Se ve **corrector** sobre una fila (el conteo se corrigió tapando): el sistema debe corregir **con registro**, no tapando. CONFIRMADA como práctica actual.
9. **El alojamiento no existe ni se genera en este sistema** (aclaración del 2026-11-04). La factura a consumidor final **puede traer un cargo de alojamiento**; hoy solo se **declara** («factura $200.000, alojamiento $0» o «alojamiento $120.000»). **Los tickets son los que tienen que igualar el resto**, para que la factura quede cubierta por sus $200.000. Es decir: **monto de la factura = alojamiento declarado + tickets aplicados**.

## 0.2 Qué corrige este diseño del documento del 2026-10-26

| Punto del diseño viejo | Qué cambia | Por qué |
|---|---|---|
| Decisión 7 del mapa: «Cuenta corriente no es un medio de pago, es lo que queda sin cobrar» (PROPUESTA) | **Se reemplaza.** La cuenta corriente **se elige como medio al cobrar** y registra un cargo en la cuenta del cliente, sin ingreso a caja | Punto 8 del dueño. CONFIRMADA |
| Los cobros se imputaban a la **factura** (`CobroDeCliente → ImputacionDeCobro → FacturaExterna`) | **El cobro se imputa al TICKET**, con su medio, antes o sin factura. La factura se **concilia** con tickets, no recibe el cobro | Puntos 5 y 7. «Cobrado» y «facturado» son **dos ejes independientes** del ticket |
| Reservas: solo texto en la línea | Se mantiene como **referencia de texto** hasta que exista un módulo de reservas (no existe), con la idea de **folio** anotada | Punto 6, sin módulo que lo sostenga |

## Nivel 1. Propósito y alcance

- **Propósito:** que la administración pueda **saber qué se cobró, qué falta cobrar y qué falta facturar**, y **conciliar** lo que motor2 sabe (tickets, clientes, cobros) con las facturas que se emiten en otro sistema, **cargando pocos datos** de esas facturas.
- **Necesidad:** pedido del dueño del 2026-11-04 (§0.1); antecedentes `docs/diseno-clientes-convenios-y-facturacion-externa-2026-10-26.md` y la validación del 2026-10-26. CONFIRMADA.
- **Alcance:**
  - **Entra:** identificar al cliente por CUIT, cobrar un ticket con medios de pago, cuenta corriente como medio, cargar el comprobante externo (factura o nota de crédito), conciliarlo con tickets, ver pendientes.
  - **No entra:** emitir comprobantes fiscales, hablar con ARCA, importar desde el otro sistema (idea posterior), alojamiento y reservas como módulo, contabilidad. **Sí entra, más adelante (N5), el cierre de caja chica por turno con arqueo de billetes**, porque hoy se hace en papel.
- **Primero lo más barato (regla del 2026-10-27):** motor2 ya tiene el cierre de cuenta, el cliente y los patrones de pago y anulación; lo que falta es **una capa de cobro y una de comprobante externo**. No se toca `cerrarCuenta`.

## Nivel 2. Actores y contexto

| Actor | Qué hace | Estado |
|---|---|---|
| Cajero u operario de la sucursal | Cobra tickets con medios de pago | PROPUESTA |
| Administración | Carga comprobantes externos, concilia, ve pendientes y cuentas corrientes, anula | PROPUESTA |
| Gerente | Ve todo de su sucursal y de la empresa, corrige | PROPUESTA |
| Agente de una empresa cliente | Es quien consume por la empresa; no usa el sistema (vínculo agente–empresa, etapa N3 del diseño del 26/10) | CONFIRMADA (H2 del 26/10) |
| Sistema externo de facturación | **No se integra.** Sus datos se tipean | CONFIRMADA (punto 1) |

Contexto: multiempresa; la **sucursal** es la unidad (punto de venta por sucursal); fecha y cortes de día en zona horaria Argentina (UTC-3); moneda única de la empresa.

## Nivel 3. Casos de uso

| CU | Caso | Etapa | Estado |
|---|---|---|---|
| CU1 | Identificar o dar de alta un cliente por **CUIT** (si existe, se indica) | N3 | CONFIRMADA (punto 4) |
| CU2 | **Cobrar un ticket** con uno o más medios de pago y sus datos adicionales; el cobro puede ser **parcial** | N1 | CONFIRMADA (punto 7 y respuesta P2 del 2026-11-04) |
| CU3 | Cobrar **con cuenta corriente**: el importe pasa a la cuenta del cliente | N2 | CONFIRMADA (punto 8) |
| CU4 | **Cargar un comprobante externo**: letra A o B, factura o nota de crédito, punto de venta de la sucursal, número (sugerido), fecha, monto, cliente, y **cuánto de ese monto es alojamiento u otro concepto de la lista de la empresa** (se escribe; vale 0 si no hay) | N3 | CONFIRMADA datos (puntos 2, 3 y 9) |
| CU5 | **Corregir** un comprobante mal cargado (con registro) | N3 | CONFIRMADA (punto 3) |
| CU6 | **Conciliar**: a partir del comprobante, proponer tickets (consumidor final sin cobrar; o los del cliente sin cobrar) y que **una persona confirme** | N4 | CONFIRMADA el flujo (punto 5); la confirmación humana es PROPUESTA (como I9 de pagos) |
| CU7 | **Pendientes:** tickets sin cobrar, cobrados sin factura («pendiente de declarar factura»), saldo de cuenta corriente | N4 | CONFIRMADA (punto 5) |
| CU8 | **Anular** un cobro o un comprobante (con registro nuevo, nunca borrando) | N1 y N3 | PROPUESTA (regla del sistema) |
| CU9 | **Reservas informativas (folio)**: anotar a mano las reservas de un cliente, empresa o agente y ver cuáles están sin cobrar. **Informativo**: no hay módulo de reservas ni integración | N5 | CONFIRMADA que se arme como apartado informativo (respuesta del 2026-11-04); su forma PROPUESTA (ver nivel 4) |
| CU11 | **Cerrar la caja chica del turno**: elegir sucursal, turno y hora; cargar la **cantidad de billetes por denominación**; el sistema calcula importes y total; queda firmado por quien cierra | N5 | CONFIRMADA la práctica (punto 10); su comparación con lo esperado PENDIENTE (Q4) |
| CU10 | Nota de crédito externa: **baja el monto a conciliar de la factura que corrige** | N3 | CONFIRMADA (punto 2 y respuesta P5 del 2026-11-04) |

## Nivel 4. Conceptos y ciclo de vida

- **Ticket** = la `Cuenta` cerrada con venta (no `Venta`, que nadie escribe). Tiene **dos ejes independientes y derivados**, no guardados como estado:
  - **Cobro:** `sin cobrar` → (`parcial`) → `cobrado` (o `a cuenta corriente`);
  - **Facturación:** `sin factura` → `facturado` (aplicado a un comprobante vigente).
- **Combinaciones que importan** (de lo que dijo el dueño):

| Cobro | Facturación | Cómo se lee | Dónde aparece |
|---|---|---|---|
| sin cobrar | sin factura | Pendiente de cobrar | lista de sin cobrar del cliente |
| cobrado | sin factura | **Pendiente de declarar factura** | lista de pendientes de factura |
| sin cobrar | facturado | Facturado y a cobrar | cuenta corriente / sin cobrar |
| cobrado | facturado | Cerrado | no aparece |

- **Cobro:** registro que **solo se agrega**; se anula con un registro nuevo. Lleva medio de pago, importe, quién y cuándo, y los datos que pide el medio.
- **Medio de pago:** catálogo de la empresa; cada medio declara **qué datos adicionales pide** (por ejemplo, transferencia: referencia y fecha; cheque: banco, número y fecha de cobro; tarjeta: últimos 4 dígitos y cupón). **La cuenta corriente es un medio especial que no ingresa a caja.**
- **Cuenta corriente del cliente:** saldo **derivado** (cargos − cobros posteriores). Solo para clientes que la posean. Nunca se guarda un saldo editable.
- **Comprobante externo:** `BORRADOR → CONFIRMADO → ANULADO`. Clase `FACTURA` o `NOTA_DE_CREDITO`; letra `A` o `B`; punto de venta; número; fecha; monto; cliente. Una nota de crédito **cancela una factura** (la factura afectada), y el dinero se cruza aparte (regla N16 del diseño de notas de crédito).
- **Conceptos declarados:** importes que **se escriben en el comprobante** y que **no salen de este sistema**. El primero es **alojamiento** (no hay módulo de alojamiento); el dueño pidió además **«productos regionales»** y **poder armar la lista** (CONFIRMADA, 2026-11-04). Entonces: **catálogo de conceptos de la empresa** (nombre, activo), y en cada comprobante cero o más líneas «concepto + importe». Vale 0 si no hay. Cuando exista un módulo de alojamiento, el importe podrá salir de ahí.
- **Composición del comprobante:** **monto = Σ conceptos declarados + Σ tickets aplicados**. La diferencia se **muestra** («falta $X» o «sobra $X»); nunca se fuerza ni se esconde, y la decide una persona.
- **Punto de venta de la sucursal:** número y **nombre**, propio de cada sucursal.
- **Conciliación:** la **aplicación** de un ticket a un comprobante. La diferencia entre el monto del comprobante y lo aplicado se **muestra**; una persona decide.
- **Turno de caja chica:** una **sucursal** tiene **tres turnos** por día (por ejemplo, mañana, tarde y noche, con su franja horaria: el de la foto es «tarde, 15 a 23»). PROPUESTA: los turnos son **configurables por sucursal** (nombre, desde, hasta).
- **Cierre de caja chica (arqueo):** el conteo del **efectivo** de un turno: por cada **denominación** (lista cerrada de billetes: 10, 20, 50, 100, 200, 500, 1.000, 2.000, 10.000, 20.000) una **cantidad entera**; el importe de cada fila y el **total son calculados**, nunca tipeados. Lo firma quien cierra (usuario del sistema, con fecha y hora). Solo se agrega; una corrección es un cierre **anulado con motivo y uno nuevo**, nunca tapar.
- **Reserva informativa y folio** (PROPUESTA de forma; el dueño pidió el apartado informativo): una **reserva** se anota a mano con su **referencia** (el código del sistema de reservas, como texto), el **cliente** (persona o empresa), el **agente** si es de una empresa, las **fechas**, el **importe estimado** y su **estado de cobro** (`pendiente` o `cobrada`, que se marca a mano o por el cobro). El **folio** es la vista de las reservas de un cliente, empresa o agente. **No** crea habitaciones, tarifas ni disponibilidad, **no** integra con el sistema de reservas y **no** genera cargos solo.

## Nivel 5. Invariantes y políticas

| # | Regla | Estado |
|---|---|---|
| C1 | Dinero en decimal exacto (`DECIMAL(14,2)`), moneda de la empresa, redondeo definido; nunca flotantes | CONFIRMADA (regla permanente) |
| C2 | Cobrar **no** cambia la venta ni el stock: no se toca `cerrarCuenta` | PROPUESTA |
| C3 | Un cobro **solo se agrega**; se anula con un registro nuevo con motivo; nunca DELETE | CONFIRMADA (regla de trazabilidad) |
| C4 | Un ticket no se cobra **más de su total**; el total sale del ticket ya cerrado (con sus correcciones) | PROPUESTA |
| C5 | Un ticket tiene **a lo sumo una aplicación vigente** a un comprobante (índice único parcial) | PROPUESTA (del diseño del 26/10, B4) |
| C6 | El **número** de un comprobante es único entre los **vigentes** de (empresa, clase, letra, punto de venta, número) | PROPUESTA |
| C7 | El **número se sugiere** como el último de esa serie + 1, **y se puede cambiar**; la sugerencia nunca es obligatoria | CONFIRMADA (punto 3) |
| C8 | Corregir un comprobante deja la **auditoría** (quién, cuándo, antes/después, motivo); el número anterior queda libre solo si se anula | CONFIRMADA (punto 3) |
| C9 | **Letra A** exige un cliente con CUIT; **letra B** admite consumidor final | CONFIRMADA (respuesta P4 del 2026-11-04) |
| C10 | El **punto de venta** pertenece a **una sucursal**, y un comprobante usa un punto de venta de **su** sucursal | CONFIRMADA (punto 2) |
| C11 | Un comprobante cubre tickets de **una sola sucursal** (la de su punto de venta) | CONFIRMADA (respuesta P3 del 2026-11-04) |
| C12 | El sistema **propone** la conciliación; **una persona confirma**; nunca se aplica solo | PROPUESTA (como I9 de pagos) |
| C13 | **Cuenta corriente** como medio exige un cliente con cuenta corriente **habilitada por administración**; sin cliente identificado, se rechaza. Sin límite por cliente al principio | CONFIRMADA (respuesta P7 del 2026-11-04) |
| C14 | El **CUIT** se valida con el dígito verificador (`validarCuit`) y es único por empresa; si ya existe, se indica y se usa el existente | CONFIRMADA (punto 4); la unicidad PROPUESTA |
| C15 | Todo se filtra por empresa; los tickets, además, por el alcance de sucursal; el servidor valida quién lo pide y con qué permiso | CONFIRMADA (regla permanente) |
| C16 | Los permisos nuevos nacen **excluidos** (fail-closed): cobrar, cargar comprobante, conciliar, anular, ver cuenta corriente | CONFIRMADA (principio del 22/10) |
| C17 | Fechas en zona Argentina; la fecha del cobro y la del comprobante son de **día local** | CONFIRMADA (regla permanente) |
| C19 | **Monto del comprobante = Σ conceptos declarados + Σ tickets aplicados.** Cada concepto declarado es ≥ 0 y su suma es ≤ monto. Si la suma no cierra, se muestra la diferencia y la persona decide (no se bloquea guardar) | CONFIRMADA el principio (punto 9); no bloquear PROPUESTA |
| C20 | Un **concepto declarado no crea cobro, ticket ni cargo** en este sistema: solo explica una parte del monto del comprobante | CONFIRMADA (punto 9) |
| C21 | **Un ticket se puede cobrar con varios medios y en partes**: la suma de sus cobros vigentes no pasa de su total; «cobrado» es cuando la suma lo iguala | CONFIRMADA (respuesta P2 del 2026-11-04) |
| C22 | Una **nota de crédito** se aplica a una factura y **baja el monto a conciliar** de esa factura; el dinero se cruza aparte | CONFIRMADA (respuesta P5 del 2026-11-04) |
| C24 | Hay **un solo cierre vigente** por (sucursal, fecha local, turno). Un segundo cierre del mismo turno se rechaza; para corregir, se anula el vigente con motivo y se carga otro | PROPUESTA |
| C25 | **Denominaciones** de lista cerrada; **cantidades enteras ≥ 0**; el importe de cada fila y el total los **calcula el sistema** (cantidad × denominación) en dinero exacto; no se aceptan importes tipeados | PROPUESTA |
| C26 | El cierre lo **firma** el usuario autenticado: se guarda **quién y cuándo** (hora de Argentina). Una firma impresa o escrita a mano no reemplaza al usuario | PROPUESTA |
| C27 | El permiso de **cerrar caja chica** nace **excluido** (fail-closed), por sucursal; el servidor lo valida | CONFIRMADA (principio del 22/10) |
| C23 | La **reserva informativa** no cambia el stock, la venta, el cobro ni el comprobante: es un registro para ver pendientes; solo se agrega y se anula con registro nuevo | PROPUESTA |
| C18 | Un cliente «consumidor final» es la cuenta **sin cliente**; el **recurrente identificado** es un cliente con nombre y, si quiere comprobante A, CUIT | PROPUESTA |

## «¿Qué pasa si…?» de los comandos principales

| | **Cobrar un ticket** | **Cargar comprobante externo** | **Conciliar (aplicar tickets)** | **Anular cobro o comprobante** |
|---|---|---|---|---|
| Repetición (doble clic) | Clave de idempotencia: el mismo envío no duplica el cobro | Clave de idempotencia; el mismo número vigente rechaza con mensaje claro | Una aplicación vigente por ticket; repetir da «ya estaba aplicado» | `YA_ANULADO`; no repite |
| Concurrencia | Dos cajeros cobran el mismo ticket: uno gana; el otro ve el cobro hecho (candado de la cuenta y suma ≤ total) | Dos personas cargan el mismo número: gana uno (índice único parcial) | Dos conciliaciones sobre el mismo ticket: gana una | Anular contra cobrar: se serializa |
| Tiempo | La fecha es la del día local; cortes de día de caja en N5 | La fecha del comprobante puede ser anterior; no puede ser futura | El ticket puede ser de otro mes: se muestra, no se bloquea | Se puede anular después, con motivo |
| Incertidumbre | La pantalla muestra «queda $X» orientativo; manda el total dentro de la transacción | El correlativo sugerido es orientativo; manda el índice único | Lo que se muestra como propuesta se revalida al confirmar | — |
| Reintento | Misma clave, mismo resultado | Idem | Idem | Idem |
| Error parcial | Cobro y sus datos del medio se guardan juntos o no se guarda nada | Cabecera y auditoría juntos | Aplicaciones y auditoría juntas | Anulación y auditoría juntas |
| Datos faltantes | Sin medio o sin los datos que el medio pide: no cobra | Sin letra, clase, punto de venta, número, fecha o monto: no confirma (puede quedar en borrador) | Sin comprobante confirmado: no concilia | Sin motivo: no anula |
| Cambio de permisos | Se valida cada vez en servidor y por sucursal | Idem | Idem, y por cada sucursal de los tickets | Idem |

## Escalera de producto N0 a N6

Peldaños acumulativos, que no rompen lo cargado; lo que falta se muestra como «pendiente de completar», nunca se inventa. **Orden elegido por el dueño el 2026-11-04: comprobante → conciliar → cobrar → cuenta corriente.**

| Etapa | Qué ve el cliente | Qué hay que construir | Depende de |
|---|---|---|---|
| **N0 (hoy)** | Se cierra la cuenta y listo; no hay cobro, medio de pago ni comprobante | — | — |
| **N1 Comprobante externo** | Cargar la factura o nota de crédito del otro sistema, con número sugerido y corrección, **los conceptos declarados** (alojamiento, productos regionales…) y clientes con CUIT | Punto de venta por sucursal, comprobante, catálogo de conceptos, clientes con CUIT | — |
| **N2 Conciliar** | La factura propone los tickets sin factura; se ve la diferencia; lista de «sin factura». **La columna de cobro dice «pendiente de completar»** hasta la etapa N3 | Aplicación ticket–comprobante, listas | N1 |
| **N3 Cobrar** | Al cobrar un ticket se elige el medio (uno o varios, parcial) y se cargan sus datos; aparecen «sin cobrar» y «**pendiente de declarar factura**» (cobrado sin factura) | Cobro, catálogo de medios, anulación; pantalla del cajero | N2 para las listas cruzadas |
| **N4 Cuenta corriente** | «Cuenta corriente» como medio; saldo del cliente | Clientes con cuenta corriente habilitada, cargos y saldo derivado | N1 (CUIT), N3 |
| **N5 Caja chica por turno** | Cierre de caja chica de cada turno con el conteo de billetes por denominación y el total, firmado; lo que hoy se hace en papel | Turnos por sucursal, cierre y arqueo | — (puede ir antes o después de N3) |
| **N6 Reservas informativas** | Apartado de reservas por cliente, empresa o agente con su estado de cobro | Reserva informativa | N3 |

**Consecuencia del orden elegido:** hasta que exista N3, el sistema **no puede decir «cobrado»**. Por eso en N2 la lista de «tickets sin cobrar» y la de «pendientes de declarar factura» (que son las de cobro) **se muestran como «pendiente de completar»**, y solo funciona «tickets sin factura». Esto es coherente con la regla del producto, pero hay que tenerlo presente al probar.

## Decisiones del dueño del 2026-11-04 (respuestas a las preguntas)

| # | Pregunta | Respuesta | Estado |
|---|---|---|---|
| P1 | Orden de las etapas | **Comprobante → conciliar → cobrar → cuenta corriente** (no la que yo recomendaba; ver consecuencia arriba) | CONFIRMADA |
| P2 | Un ticket, ¿varios medios y pago parcial? | **Sí, varios medios y parcial** | CONFIRMADA |
| P3 | ¿Un comprobante cubre varias sucursales? | **No: una factura, una sucursal** | CONFIRMADA |
| P4 | Reglas de letra | **A exige cliente con CUIT; B admite consumidor final** | CONFIRMADA |
| P5 | Nota de crédito externa | **Baja el monto de la factura que corrige** | CONFIRMADA |
| P6 | Medios de pago | Los propuestos (efectivo, transferencia, débito, crédito, cheque, cuenta corriente) **más QR / billetera virtual**. Los **datos que pide cada medio**: «cambiar alguno», **todavía no dijo cuál** | Medios CONFIRMADA; datos PENDIENTE |
| P7 | Cuenta corriente | **Administración la habilita, sin límite al principio** | CONFIRMADA |
| P8 | Reservas | **Armar el apartado como informativo** (no esperar al módulo de reservas); su forma, PROPUESTA (nivel 4) | CONFIRMADA que se arme; forma PROPUESTA |
| P9 | Otros conceptos en la factura | **Sí: «productos regionales», y que se pueda armar la lista** (catálogo de la empresa) | CONFIRMADA |

**Preguntas que quedan abiertas:**
- **Q1.** ¿Qué dato de cada medio de pago hay que cambiar? Propuesta mía: transferencia, referencia y fecha; débito y crédito, últimos 4 dígitos y número de cupón; cheque, banco, número y fecha de cobro; QR o billetera, referencia de la operación; efectivo, nada; cuenta corriente, cliente.
- **Q2.** Reserva informativa: ¿qué datos se anotan? Propuesta: referencia (código del otro sistema), cliente, agente, fechas de entrada y salida, importe estimado y estado de cobro.
- **Q4.** El cierre de caja chica, ¿se **compara con algo** o solo se registra? Hoy la planilla solo cuenta y suma. Opciones: (a) solo registrar el conteo y el total, como la planilla (recomendado para empezar); (b) compararlo con un **esperado** (fondo inicial del turno + cobros en efectivo − egresos), lo que exige la etapa de cobros.
- **Q5.** Los **turnos**: ¿son siempre tres por sucursal, con nombre y horario propios de cada una? Propuesta: configurables por sucursal (nombre, desde, hasta), y un cierre por turno por día.
- **Q3.** ¿Una reserva informativa se puede **vincular** a una factura como parte de su concepto «alojamiento», o queda aparte (solo para ver pendientes)? Recomiendo **aparte** por ahora.

## Qué sigue

Con los niveles 1 a 5 confirmados se diseña el nivel 6 (tablas, solo las de la etapa elegida, aditivas y reversibles), el 7 (atomicidad y concurrencia), el 8 (permisos y pantallas), el 9 (consultas) y el 10 (pruebas con oráculo de combinaciones: medio × parcial × cuenta corriente × facturado × letra). Ver las pantallas dibujadas en la maqueta que acompaña a este documento.
