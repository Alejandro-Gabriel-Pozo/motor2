# E. Lo que dicen los docs de Pedernal (zuluhub-docs), para contrastar con Motor2/motor2

Fuente: `/home/user/zuluhub-docs` (solo lectura). **Todo lo citado es DOC, NO VERIFICADO contra código** (no hay código de Pedernal disponible). Fecha de lectura: 2026-11-12. Los docs mismos citan el repo de código como `ERP:` (ZuluHub-ERP / pedernal-erp); acá nunca se verificó.

Convención de estado (el que le pone el propio doc, no yo):
- **DECIDIDO** = dicho por el dueño (con fecha/fuente en el doc).
- **PROPUESTO** = propuesta del ingeniero/sesión sin veto ni confirmación explícita.
- **CONSTRUIDO (según doc)** = el doc dice que está en `main` del ERP; no verificado.
- **PENDIENTE / NO VERIFICADO** = el doc lo marca así.

Rutas relativas a `/home/user/zuluhub-docs/`.

---------------------------------------------------------------------

## 0. Contexto en 10 líneas (útil para el contraste)

1. Pedernal es el "ERP general" hermano de Motor2 (mismo dueño). Motor2 es "el campo de pruebas"; Pedernal se escribe desde cero (`01-vision/prompt-arranque-pedernal.md` §2). Stack: Next + Kysely + Postgres (Neon), RLS forzada, contexto firmado por transacción (`08-adr/ADR-004`, `ADR-009`, `ADR-011`, `ADR-012`).
2. El "todo nace cerrado" que rige en motor2 también está en Pedernal, nombrado "denegar por defecto" y "sin dato registrado no hay campo" (en el `CLAUDE.md` de Pedernal, citado indirectamente: `11-especificaciones/e0-cimientos-especificacion.md` §2.6 líneas ~79 "denegar por defecto (`:26-37`), sin dato registrado no hay campo (`:38-45`)"). Los docs de Pedernal dicen que el caso real que lo motivó fue el CUIT de "Emitir" (`01-vision/primitivas-de-negocio.md` §7.5). **El código de motor2 menciona "caso real (Pedernal, proyecto hermano): `/\p{Cc}/u`": coincide con P1/P2 de Pedernal** (`11-especificaciones/decisiones-del-dueno-2026-11.md`, fila 2026-11-05/06 "Principios P1 y P2 de validación").
3. Las dos "escaleras" existen en Pedernal con los mismos nombres: la de diseño de 10 niveles (`01-vision/escalera-de-diseno.md`, adoptada 2026-10-26, `reglas-transversales.md` §9) y la de operación por capacidad (`niveles-de-operacion.md`). La "escalera N0-N5 por módulo" de motor2 se corresponde con "N0 anotar … N4 CRM" de `clientes.md` (D-8) y "N0-N4" de catálogo/compras.
4. Estado general (mapa de pantallas, 12/11/2026): servidor en gran parte hecho (catálogo, caja, ventas, stock, facturación, clientes, compras, salón); **de 34 pantallas del negocio ninguna construida contra datos reales** (`11-especificaciones/mapa-de-pantallas-pedernal.md` §1).
5. Regla del dueño en Pedernal: "ninguna pantalla se programa sin maqueta aprobada" (`10-ux-ui/00-descubrimiento.md`, regla 2026-10-14).
6. Regla "Motor2 no se migra" vigente; la migración es solo un estudio (`decisiones-del-dueno-2026-11.md`, filas 2026-11-11 "NO CONFIRMADA" y "B, pero no estoy seguro").
7. Nombre en código: `pedernal_app`, `PEDERNAL_*` (nombre en clave, nunca visible: `01-vision/marca-blanca.md` §2).
8. Moneda solo ARS en v1; dinero nunca `number` (ADR-006).
9. Tenant → empresa (frontera de aislamiento, un CUIT) → sucursal (`05-base-empresa-usuarios-fiscal/diseno-inicial.md` §1, §4).
10. Rol de la IA: orquestador que no escribe código, sub-agentes escriben (`10-ux-ui/06-aprendizajes-de-motor2…` §2 lo describe como "el mismo método que usamos acá").

---------------------------------------------------------------------

## 1. PRIMITIVAS DE NEGOCIO

### 1.1 Principio (ADR-014 + `01-vision/primitivas-de-negocio.md` §1-2)

- **Enunciado:** "No se modelan pantallas: se modelan primitivas de negocio, y cada marca las compone en su propia experiencia." Una primitiva existe cuando tiene identidad, reglas, estados, permisos, historial o relaciones propias. **Se relacionan, no se fusionan** (relación explícita = un identificador + un puerto; nunca una tabla única con un tipo). **Estado: DECIDIDO por el dueño 2026-10-12** (`08-adr/ADR-014-primitivas-de-negocio-independientes.md`, cabecera).
- **No se adopta:** supertipo universal ("OperaciónComercial", "Documento", "MovimientoDeDinero"); construir hoy componentes comunes (Party, Ledger, MoneyMovement) = "generalidad especulativa" (`primitivas-de-negocio.md` §2). Se extrae una abstracción común "cuando dos módulos reales la necesitan" (ADR-014 "Cuándo se revisa").
- **Reglas derivadas** (`primitivas-de-negocio.md` §7, ADR-014 Decisión 1-7): (1) dependencia de arriba hacia abajo, fiscal/caja/stock/agenda/cuenta corriente no se importan entre sí ni importan de ventas; (2) antes de crear una tabla: ¿qué primitiva es, qué estados, quién la relaciona?; (3) el vocabulario de marca no toca reglas; (6) partes opcionales = capacidades activables por perilla de plan (cuenta corriente, CRM, venta mixta, terminal compartida entre CUIT).

### 1.2 Catálogo de primitivas y estado (`primitivas-de-negocio.md` §3; estado tal como lo declara el doc, fechado 2026-10-12, probablemente desactualizado respecto del 12/11)

| Grupo | Primitivas | Estado en el doc |
|---|---|---|
| Plataforma y cuentas | Tenant, empresa, sucursal, usuario (identidad), membresía, rol, permiso, invitación, marca, plan, módulo, auditoría | Construido (H1 a H6 parcial) |
| Fiscal | Emisor, punto de venta, datos fiscales versionados, numeración, proforma, factura autorizada | Dominio construido (H7 T1/T2); persistencia pendiente (a 10/12). Hoy el mapa dice facturador completo en `apps/web` |
| Efectos externos | Trabajo en cola, correo | Construido (H5) |
| Catálogo y precios | Producto, servicio, variante, lista de precios, promoción, impuesto | "Futuro" en este doc; hoy (E2) catálogo en `main` según mapa de pantallas |
| Stock | Movimiento, reserva de stock, transferencia, ajuste, conteo, lote | "Futuro (el stock se explica por movimientos, nunca es un número suelto)"; hoy E5/E6 hechos según mapa |
| Operaciones | Venta, compra, pedido, reserva de agenda, comanda, servicio | Futuro, cada una independiente |
| Documentos | Presupuesto, orden de compra, ticket interno, remito, recibo, nota de crédito/débito | Futuro (factura ya está) |
| Dinero | Cobro, pago, anticipo, devolución, ajuste, movimiento de caja, sesión de caja, medio de pago, cuenta de cobro | Futuro |
| Saldos | Cuenta corriente (capacidad opcional), saldo, crédito, deuda | Futuro y a pedido |
| Relación con terceros | Cliente, proveedor, contacto, CRM, soporte | Futuro; cada uno separado |
| Agenda | Disponibilidad, calendario, turno, bloqueo, recurso | Futuro |
| SaaS propio | Producto SaaS, plan, suscripción, entitlement, cuenta de facturación | **No diseñado**; "puede esperar" pero antes del primer cobro (§5) |

### 1.3 Glosario de choques de nombre (DECIDIDO, `primitivas-de-negocio.md` §4 + ADR-014 Decisión 7)

| Palabra | Regla | Estado |
|---|---|---|
| `persona` = usuario/identidad que entra; las partes del negocio son otra entidad ("parte"), **no se reutiliza `persona`** | DECIDIDO |
| cliente del negocio = `customer`; "cliente del software" = suscriptor/tenant | DECIDIDO dueño 2026-10-12 |
| ticket interno vs caso de soporte | glosario |
| reserva siempre con apellido: de agenda / de stock / de número | glosario |
| cuenta siempre con apellido: de consumo / corriente / de cobro / bancaria | glosario |
| "parte" ≠ porción: en código de dinero se dice "porción" o "cuota" | `clientes-y-proveedores.md` §B.1 |

### 1.4 Reglas transversales (`01-vision/reglas-transversales.md`)

| # | Regla | Estado |
|---|---|---|
| RT-1 | **Ficha de primitiva** obligatoria por primitiva importante: estados y transiciones (quién, qué nace, qué se bloquea, qué se revierte, qué se audita), fechas, alcance, contexto de ejecución, actores, qué queda congelado, cómo se corrige, repetición/idempotencia, falla a mitad de camino, nivel de operación (§1) | DECIDIDO (por el dueño 2026-10-12, "preguntas obligatorias") |
| RT-2 | **Cinco categorías que no se mezclan**: intención / compromiso / hecho / movimiento / documento (no son cinco tablas, es clasificación conceptual) (§2) | Adoptada |
| RT-3 | **Glosario de fechas**: creación, operación, emisión, entrega, vencimiento, cobro, contable (jornada), anulación, sincronización; zona UTC-3 (§3) | Adoptado; "falta en cada plan" |
| RT-4 | Lo que NO se construye: `CorrectionPolicy` genérica, motor de flujos, supertipo operación/documento, capa de localización (§5) | Decidido |
| RT-7.1 | Un nivel = **habilitación** (perilla de plan, la cambia la plataforma) + **elección** (config del módulo, la cambia el gerente con permiso y auditoría) (§7.1) | Decidido |
| RT-7.2 | Lo que define **cómo ocurre el efecto** (momento, jornada, precio, opciones, modo de corrección) se **copia al registro** al nacer, en la misma transacción SERIALIZABLE, y se lee del registro, nunca de la config. Lo que define **si se puede hacer** se evalúa en cada acción y no deshace lo hecho (§7.2) | Decidido |
| RT-7.3 | El nivel decide cuándo, nunca la identidad; la clave de idempotencia es la misma en todos los niveles (§7.3) | Decidido |
| RT-7.4 | Cambiar config afecta solo lo que nace después; tratar lo existente es una **migración explícita** (§7.4) | Decidido |
| RT-7.5 | Ramificar por el valor copiado en el registro es correcto; ramificar por nombre de plan, fecha de alta o config actual sobre un registro viejo es un **defecto** (§7.5) | Decidido |
| RT-7.9 | **Solo lectura no bloquea lo que ya se debe**: acciones = lectura / escritura que crea o amplía / escritura que completa o cierra (esta última se permite aun con plan bajado) (§7.9). En el catálogo de permisos: efecto `LECTURA`, `CREA_AMPLIA`, `COMPLETA_CIERRA` (`clientes-y-proveedores.md` corrección 16) | Decidido |
| RT-7.10/11 | **Un efecto derivado es único por origen y tipo** (lo impone la base); **repetir no es un error**: devuelve el mismo resultado exitoso ("ya estaba"); un `err` con nombre solo para una acción distinta sobre algo ya cambiado (§7.10-11) | Decidido |
| RT-8 | **Toda regla/abstracción/convención debe justificar su existencia**: ambigüedad que elimina, categoría concreta de fallos que previene, o coste significativo de agregarla después; con chequeo mecánico que falle si se elimina o un caso real documentado; revisión de reglas al cerrar cada tramo (§8) | DECIDIDO (pedido del dueño 2026-10-12) |
| RT-9 | **Escalera de diseño de 10 niveles por compuertas**; no se diseñan tablas con una política pendiente; cada comando con matriz "¿qué pasa si…?" (8 lentes x 6 momentos de falla); sugerencia nunca presentada como regla universal (§9; `escalera-de-diseno.md`) | DECIDIDO (dueño 2026-10-26) |

### 1.5 `niveles-de-operacion.md`: método y escaleras decididas

- **Método (DECIDIDO, dueño 2026-10-12):** cada capacidad = escalera de niveles, un nivel **estándar** (viene en todos los planes) y los demás = funciones que se activan (perillas de plan, `funciones-de-pago.md`). Principio permisivo (ADR-008): el estándar es lo más parecido a lo que ARCA admite y a cómo opera el negocio. Lo que nunca es nivel: integridad (no duplicar, aislamiento, auditoría, nada se borra, dinero exacto).
- **"Dos ejes y pasos colapsados" (DECIDIDO dueño 2026-10-23, §1 bis):** (a) formalidad del proceso y (b) detalle de lo registrado son escaleras independientes; **se colapsan pasos, no se omiten**: el modelo soporta siempre el nivel más detallado; el nivel simple escribe la misma cadena de registros con pasos intermedios por defecto marcados "atajo" (`es_atajo`); un dato no cargado queda **vacío y explícito, nunca en cero ni inventado**; subir de nivel no migra, bajar conserva todo. **(Equivale muy de cerca a "escalera N0-N5 de producto: lo que falta se muestra como pendiente de completar, nunca se inventa" de motor2.)**
- **Clase de perilla** E (efecto: se copia al registro) o H (habilitación: se evalúa en cada acción) (`niveles-de-operacion.md` "Definición de listo", y `evaluacion-guardas-y-abstraccion-de-niveles.md` §3.2). Pieza común única: `nivelParaLoNuevo({estandar, elegido, habilitados})` (`reglas-transversales.md` §7.7).

Tabla de escaleras decididas (`niveles-de-operacion.md` §2; todas **DECIDIDAS por el dueño 2026-10-12** salvo donde se indica):

| Capacidad | Niveles | Estándar |
|---|---|---|
| Marca propia del cliente | 0 marca principal; 1 nombre/logo/colores; 2 subdominio; 3 dominio y mail propios; 4 white-label | **0** en esta tabla — **pero ver contradicción C-1: marca-blanca (2026-11-09) subió el nivel 1 a incluido en el plan** |
| Dos CUIT | A cada CUIT por su lado; B una empresa con varios emisores; 3 punto de venta atado al emisor; 4 stock separado por CUIT con caja común | A |
| Cobro de venta mixta | un cobro por comprobante; terminal compartida con saldo | un cobro por comprobante |
| Propina | efectivo: no se registra; terminal: se factura aparte | ambos |
| Cuenta corriente | no incluida; capacidad propia | no incluida |
| Corregir ticket cobrado | 1 solo bajar; 2 también subir; 3 cualquier cambio | **1** |
| Corregir facturado | B nota de crédito parcial; A NC total + factura nueva | **B** |
| Descuento de stock: momento | 1 al solicitar; 2 al cerrar la cuenta; 3 al cobrar | **2** |
| Opciones de producto | 1 combinación=producto; 2 modificadores con recargo; 2b modificadores que cambian la receta; 3 variantes con stock | hasta **2b** |
| Recetas | sin receta; receta simple; mermas; sub-recetas | **receta simple** |
| Precio | 1 por empresa; 2 lista por sucursal; 3 por canal u horario | 1 (**luego el dueño pidió precio por sucursal: decisión 147, 9/11**: ver C-9) |
| Día contable de un cobro | 1 día reloj; 2 jornada de caja; 3 jornada con corte por sucursal | **3** (corte 00:00 por defecto) |
| Reserva con seña | 1 nace confirmada; 2 provisoria con vencimiento; 3 confirmación automática | 1 |
| Devolver dinero | D1 misma sucursal; D2 cualquier caja abierta de la empresa; D3 fuera de caja | **D2** |
| Corregir movimiento de caja | A1 anular solo con sesión abierta; A2 corregir sesión cerrada | A1 |
| Pago parcial / cargo a habitación | 1 ticket entero (varios medios) + seña; 2 dividir; 3 combinar | 1 |
| Asignación de recurso en reserva | 1 inmediata; 2 al check-in; 3 overbooking | 1 |
| Cambio de plan | 1 config congelada; 2 migración manual; 3 automática | 1+2 |
| Visibilidad del catálogo | 1 uso interno; 2 carta pública/QR (solo lectura); 3 pedidos online | 1 de fábrica; QR construido y disponible como extra |

Decisiones sin escalera (`niveles-de-operacion.md` §2 bis, "quedan todas así"): cajas adicionales las habilita la plataforma; cobro con tarjeta/QR/transferencia exige terminal o cuenta (efectivo nunca); una sesión de caja cerrada no se reabre; nadie "aprueba" un arqueo (queda como se contó con su diferencia); el operador anula solo lo que cargó él en la sesión abierta; solo la plataforma activa módulos; el cliente no cambia de marca ni edita la marca en v1 (**ver C-1**); clientes: el operador busca/alta/edita, no desactiva ni anonimiza; auditoría guarda qué campo cambió, no los valores; el email es solo contacto y solo el documento es único; anonimiza solo el gerente; el directorio viene siempre activo.

### 1.6 Modelo de dominio y decisiones de producto (`01-vision/modelo-de-dominio-y-decisiones-de-producto.md`)

- §1: capacidades y primitivas, no pantallas/rubros/planes. El plan habilita capacidades; no redefine entidades.
- §3.1: independencia conceptual — Vender≠cobrar, Cobrar≠facturar, Comprar≠pagar, Reserva≠disponibilidad, Ticket≠cuenta corriente, Cliente≠persona, Marca≠cliente del software, Plan≠precio.
- §3.4 "Tramo común": solo conceptos realmente compartidos y estables: Dinero, Cantidad, Domicilio, Parte o participante, Cuenta, Documento, Movimiento de dinero, Evento de auditoría. "No debe convertirse en una megaabstracción."
- §4 decisiones de producto fijadas: marca propia (nivel actual: marca principal, **desactualizado por C-1**), dos CUIT cada uno por separado, un cobro por comprobante, propina (efectivo no se registra, terminal se factura aparte), sin cuenta corriente, corrección de ticket solo reducir, corrección de facturado con NC parcial.
- §7: **cada proceso pide sus propios permisos** ("toda transición relevante de un proceso debe tener una autorización específica, una identidad responsable y un evento auditable"). Ejemplos de acciones granulares: crear/confirmar/anular/devolver venta, registrar/devolver cobro, abrir/cerrar/reabrir caja, etc. Estado: DECIDIDO (dueño 2026-10-12) / "regla propuesta" en este doc.

### 1.7 Primitivas "de campo" y registro de datos (`primitivas-de-negocio.md` §7.4-7.5) — directamente comparable con "lista cerrada / todo nace cerrado" de motor2

- **Ficha del dato (regla 4):** cada dato de contacto reutilizable (correo, teléfono, web) lleva su ficha al tope de su primitiva en `src/primitivas/contacto/`, con prueba de integración que compara los CHECK de la base con las constantes de la primitiva (`test/integracion/contacto-check.test.ts`). Plantilla: qué es, cómo se escribe, obligatorio/opcional y qué significa vacío, único (ámbito), quién lo cambia, verificado o declarado, se congela en comprobantes, dato personal, cómo se compara e imprime, código de error, ejemplos. Lo no decidido: "SIN DECIDIDO"; lo propuesto: "SUPUESTO". Fuente: pedido del dueño 2026-11-04. Estado: DECIDIDO ("hacelo chico").
- **Regla 5 "Sin dato registrado no hay campo; todo dato declara su existencia" (DECISIÓN DEL DUEÑO 2026-11-05):** catálogo declarativo compartido servidor/web; cada dato declara ficha/primitiva, propósitos (para qué existe, referencia a casos de uso reales), dónde puede pedirse, quién puede ponerlo (acción de permiso y contexto), qué necesita para existir. Chequeos mecánicos **fail-closed con violación inyectada**: campo que pide dato no registrado falla; dato registrado sin consumidor (huérfano) falla; consumidor no declarado falla; escritura sin la acción de permiso declarada falla; en la base, cada columna de texto con su CHECK derivado de la primitiva. **Reemplaza** el "alcance cerrado" de la regla 4. Estado: DECIDIDO; "el estado final es que TODO dato esté declarado; la transición es gradual; lo no declarado queda como deuda con vencimiento".
  - Palabras del dueño citadas: «todo nace cerrado: cada cosa declara su existencia… son canillas cerradas hasta que una se abre declarando que esa es quien puede poner ese dato; sin declaración de existencia debería fallar; si nadie necesita el dato, ¿para qué existe?; y tiene que haber una bisagra: qué dato puede pedir el servidor y qué dato puede pedir la web».
  - Dato en código (`e0-cimientos-especificacion.md` §2.4): `src/capacidades/datos/registro.ts` con 10 datos (correo, telefono, web, fecha-civil, importe, cantidad, nombre-o-razon-social, documento-de-identidad, domicilio-libre, condicion-iva); regla "solo se registran datos cuya primitiva ya está en main y que tienen al menos una pantalla real que los pide". DOC, NO VERIFICADO.
- **5.b Caminos y pantallas declarados** (2026-11-05, PROPUESTA): cada paso declara qué dato completa, qué toma de los anteriores, qué deriva (p. ej. letra A/B/C); chequeos: lo que la acción requiere está cubierto por los pasos + derivados; ningún paso pide un dato que nadie consume.
- **Orden C1..C7** (prioridad del dueño 2026-11-05: «ordená para que todo pase por el catálogo declarativo de datos, en varios PRs chicos; es la prioridad»).
- **Resolución 2026-11-12 (estudio `generacion-de-pantallas-estudio.md`):** "B más D1": el registro de datos y los caminos se usan como **verificador** más piezas comunes, no como plano que genera pantallas; se termina 5.b como verificador sin generar; piloto de dos partes autorizado (`decisiones-del-dueno-2026-11.md`, fila 2026-11-12).

---------------------------------------------------------------------

## 2. FICHA DE PARTE (cliente/proveedor/contacto)

Documentos: `11-especificaciones/clientes-y-proveedores.md` (plan 2026-10-12, con registros de cambios hasta 2026-10-26), `11-especificaciones/clientes.md` (diseño por la escalera 2026-10-27, DDL verificado en base de prueba PG16, **"ninguna fila figura construido"** al momento de escribirlo), `11-especificaciones/e9-compras-especificacion.md` §3.1 (qué se adopta al construir: migración `0034_clientes.sql`), `h3-identidad.md` (SOLO identidad/usuarios, no partes), `05-base-empresa-usuarios-fiscal/diseno-inicial.md` (tenant/empresa/persona/membresías), ADR-012 (modelo físico).

**Estado construcción:** `mapa-de-pantallas-pedernal.md` §2 F1: "Clientes y proveedores: pantalla NO EXISTE; servidor en main (E9 parte 1, #261, `0034_clientes.sql`)". DOC, NO VERIFICADO contra código. Que el `0034` construido coincida con el DDL de `clientes.md` Anexo C: NO VERIFICADO (e9 §3.1 dice "se adopta con estos cambios: pasaporte 6-9, once condiciones de IVA, sin `anonimizarParte`").

### 2.1 Decisión de modelado (B.0 de `clientes-y-proveedores.md`; D-2 de `clientes.md`)

- **Una sola entidad `parte` por empresa, con roles** (`parte_rol`) y vínculos (`parte_vinculo`). La misma entidad puede ser cliente y proveedor sin cargarse dos veces (un CUIT, una ficha). **DECIDIDO** por el dueño 2026-10-15 (B.12 punto 3, con su caso real). No es supertipo universal: `parte` guarda solo identidad y contacto; nada específico de un rol (lista de precios → catálogo/ventas; condición de pago → compras; saldo → cuenta corriente; registro de pasajeros → reservas).
- Tres clases de "rol" que no se mezclan: rol del directorio (`CUSTOMER`, `PROVEEDOR`), vínculo entre partes (`CONTACTO`, `AGENTE_DE`), rol en una operación (huésped, responsable de pago, receptor del comprobante: viven en el módulo de la operación con el id de la parte e instantánea).
- "Huésped/paciente/comensal" no son roles: son el vocabulario de marca para `CUSTOMER`.
- **Consumidor final = ausencia de parte** (no hay fila "consumidor final"): D-14, "Supuesto del plan que el dueño no corrigió"; estado en `clientes.md` = **propuesta**.
- Directorio **es de la empresa**, no del grupo ni de la sucursal (D-15, propuesta del ingeniero; R2 de `diseno-inicial.md`).

### 2.2 Campos de la ficha (DDL de `clientes.md` Anexo C, líneas ~946-1040; e9 §3.1 lo adopta con cambios)

| Campo | Regla (DOC) | Estado |
|---|---|---|
| `id` | `uuid` generado por la base (a diferencia de ventas, donde lo manda la app) | propuesta (D-21) |
| `empresa_id` | NOT NULL, FK compuestas `(x_id, empresa_id)`; RLS forzada | invariante (IN-1) |
| `idempotencia_alta` | `uuid NOT NULL`, **única por empresa** (la manda la pantalla; evita oráculo de existencia entre empresas) | propuesta (D-21) |
| `naturaleza` | `HUMANA` \| `JURIDICA` (palabras del Código Civil y Comercial; "no se dice persona física ni persona") | confirmada (CP B.1; dueño 2026-10-12) |
| `nombre` | 1-200, `texto_fiscal_valido`; razón social si es JURIDICA; NULL solo si está anonimizada | propuesta |
| `apellido` | solo HUMANA, ≤100; para JURIDICA queda vacío | **propuesta** (D-24; CP B.12.5 la dejó "ASUMIDO: el dueño corrige") |
| `alias` | ≤100, texto fiscal válido | propuesta |
| `documento_tipo` | `CUIT`, `CUIL`, `CDI`, `DNI`, `PASAPORTE`, `ID_EXTRANJERO` | confirmada (A.1) |
| `documento_numero` | CUIT/CUIL/CDI: `cuit_valido()` (11 dígitos, módulo 11, función de la migración 0001, la misma de empresa/emisor/comprobante); DNI `^[1-9][0-9]{5,8}$` (6 a 9); pasaporte/ID extranjero alfanumérico con país | D-27 **no verificada** (contador): que CUIL/CDI usen la misma regla de CUIT y los formatos |
| `documento_pais` | char(2); solo para PASAPORTE / ID_EXTRANJERO | |
| Naturaleza × documento | una JURIDICA solo admite CUIT o ID_EXTRANJERO (`parte_naturaleza_documento_ck`) | D126 |
| `condicion_iva` | **11 valores de WSFE v4.8** (RESPONSABLE_INSCRIPTO, EXENTO, CONSUMIDOR_FINAL, MONOTRIBUTO, NO_CATEGORIZADO, PROVEEDOR_DEL_EXTERIOR, CLIENTE_DEL_EXTERIOR, IVA_LIBERADO_LEY_19640, MONOTRIBUTISTA_SOCIAL, IVA_NO_ALCANZADO, MONOTRIBUTO_TRABAJADOR_INDEPENDIENTE_PROMOVIDO); **solo valor sugerido**: vale la que se elige en cada comprobante, congelada en la instantánea del receptor | **DECIDIDO** (D-18; dueño 2026-10-15, B.12.4); las once: D-22 propuesta; ver contradicción C-5 |
| `email` | minúsculas+trim, patrón `_@_`, sin blancos, ≤254; solo contacto (aviso de duplicado, no único) | F3 DECIDIDO (dueño 2026-10-12) |
| `telefono` | `^\+?[0-9 ()./-]{6,30}$` y 6-15 dígitos; solo contacto | F3 DECIDIDO |
| Domicilio (uno por ficha, en columnas de `parte`) | `dom_pais` + (**AR estructurado**: `dom_calle` ≤100, `dom_numero` `^[0-9]{1,6}$` o `S/N`, `dom_piso`/`dom_departamento` ≤20, `dom_localidad` ≤100, `dom_provincia` FK a tabla `provincia`, `dom_codigo_postal` `^[A-Z0-9]{4,8}$`) o (**exterior**: `dom_texto` línea libre ≤300, y ninguna columna estructurada). "Completo o ninguno" (CHECK con `coalesce`) | D-28 propuesta (el domicilio de una ficha tiene que poder vaciarse al anonimizar, por eso no se usa la tabla solo-inserción `domicilio` de fiscal) |
| `nota` | `text`, no vacía, **≤ 2000 caracteres** (`parte_nota_ck`); NV12: "tamaño de los textos 200, 100, 20, 300, 2000: valores del dominio y del plan, ninguno es requisito de ARCA; se pueden aflojar sin migrar" | propuesta |
| `estado` | `ACTIVA` ⇄ `INACTIVA`, → `ANONIMIZADA` (terminal; ni el dueño de la base puede editarla; el documento queda libre) | D-47 propuesta; la anonimización la fija la base (`anonimizada_en`) |
| `es_atajo` | boolean inmutable: constancia de alta rápida (dos ejes, 2026-10-23); índice "fichas por completar" (sin documento) | D-25 propuesta |
| Columnas calculadas por la base | `nombre_busqueda` (apellido+nombre+alias, sin acentos ni mayúsculas, vía `translate`), `documento_normalizado` (`T…`, `D…`, `P<país>:…`, `I<país>:…`; CUIT=CUIL=CDI del mismo número es la misma clave), `telefono_digitos` | IN-7 |
| Auditoría | `creado_por`, `version`, `creado_en`, `actualizado_en`; la auditoría guarda **qué campo cambió, nunca el valor** (F2) | F2 DECIDIDO (dueño 2026-10-12) |

**Invariante de unicidad:** "un documento, una parte, por empresa, **incluidas las inactivas**" (índice único parcial `parte_documento_uk (empresa_id, documento_normalizado)`); el mismo CUIT en dos empresas es válido. Pasa lo mismo con la idempotencia del alta (100 rondas de 6 sesiones simultáneas: 100/100, `clientes.md` §0.4 — DOC, probado en base de prueba por esa sesión).
**Sin dinero en la ficha:** IN-10 `clientes-sin-dinero` (regla de arquitectura) — DECIDIDO (D-11, dueño 2026-10-12): cuenta corriente, descuentos por cliente, condición de pago viven en otros módulos.
**Pasaporte (decisión posterior que pisa el DDL):** "se guarda tal cual (letras y números, **6 a 9** caracteres) y a ARCA se informa solo la parte numérica" (DECIDIDO, dueño 2026-11-06, `decisiones-del-dueno-2026-11.md`; migración `0024_pasaporte_con_letras.sql` según e9 §3.1). El DDL de `clientes.md` sigue con `{3,20}` → contradicción C-4.

### 2.3 Vínculos "Contacto" y "Agente de" (reglas de base) — `clientes.md` DDL y B.12

Tabla `tipo_de_vinculo` (vocabulario **global como dato**, no CHECK: R6 de `catalogo-y-stock-diseno-de-datos.md` §2.2), con dos banderas `contacto_humana` y `de_parte_juridica`:

| Tipo | Significado | Reglas de base |
|---|---|---|
| `CONTACTO` | "Alguien con quien se habla de la otra parte" | el contacto es `HUMANA`; no hereda ni pisa datos fiscales de la otra parte; `cargo` opcional |
| `AGENTE_DE` | "Persona que consume por cuenta de una empresa y cuya cuenta paga la empresa" (pax de una agencia) | agente `HUMANA`, la empresa `JURIDICA`; **una persona puede ser agente de varias empresas y a la vez cliente por su cuenta**; DECIDIDO (dueño 2026-10-15, B.12.2) |
| `EMPLEADO` (rol, no vínculo) | fuera de v1 (F6); "un `INSERT`" en una fila de `rol_de_parte` cuando se pida | DECIDIDO (dueño 2026-10-12) |

Reglas adicionales (tabla de transiciones, `clientes.md` Nivel 4): un vínculo no puede ser consigo misma ni con una anonimizada; "contacto no humano" y "agente de una persona no jurídica" se rechazan; la **naturaleza no cambia si un vínculo la exige** (`parte_naturaleza_con_vinculo`); PK `(empresa_id, parte_id, de_parte_id, tipo)`; los vínculos se apagan (`activo`), no se borran; disparador diferido `parte_anonimizada_relaciones`: no confirma una transacción que deje una anonimizada con rol o vínculo activo (T7). Se apagan/reactivan con `partes.vincular_contacto` / `desvincular_contacto` (los tres roles).

### 2.4 Roles, permisos y decisiones del dueño sobre la ficha (todas DECIDIDAS 2026-10-12 salvo indicación)

F1: operador busca, da de alta y edita (también roles y contactos), no desactiva ni anonimiza; `desactivar`/`reactivar`: gerente y administrador. F2: auditoría sin valores. F3: email/teléfono solo contacto con aviso de posible duplicado; solo el documento es único. F4: anonimiza solo el gerente. F5: directorio obligatorio y siempre activo. F6: roles iniciales `CUSTOMER` y `PROVEEDOR`. 2026-10-15 (B.12): tres papeles distintos en una operación (consume / paga / receptor del comprobante), AGENTE_DE, saldo a favor es del pagador, qué datos exige una operación (la decide la **operación**, no la ficha: `DATO_REQUERIDO {campo}`; la ficha guarda todo opcional; alojamiento exige identificar al huésped). 2026-10-27: D-43 "A" (impedimentos de anonimización: algo en curso) y D-44 "A" (descuento fijo del cliente fuera de clientes, entra como condición comercial de ventas N2, congelada). 2026-11-11: DEC-0305 "no hay acción de anonimizar partes hasta que alguien la pida" (confirmado "OK 0305"). → ver C-12.

### 2.5 Escalera de operación de clientes (D-8, **propuesta**; estándar N1 = propuesta D-9)

N0 anotar (consumidor final sin ficha, o ficha de 2 datos: nombre y persona/empresa) · **N1 identificar** (documento, condición IVA, contacto, domicilio, roles, contactos, agentes) · N2 con condiciones comerciales · N3 con cuenta corriente · N4 con seguimiento (CRM). "No se sellan en la ficha (clase H)": subir no migra, bajar conserva (D-10).

### 2.6 Lo que Pedernal toma/no toma de Motor2 en la ficha (`clientes-y-proveedores.md` A.5; `clientes.md` "Contraste con Motor2")

| Motor2 | Qué hace Pedernal |
|---|---|
| `Proveedor`: CUIT único por empresa | **Se adopta** (misma invariante) |
| `Proveedor.condicionIva` nula = "no declarada" | Se adopta como "vacío explícito" |
| `Proveedor`: nombre único por empresa | **No** (F3: solo el documento es único) |
| `Proveedor.condicionesPago` texto | **No** (es dato del comprobante en compras) |
| código `PRV_…` | No (el id lo genera la base) |
| `Cliente`: solo nombre + **descuento % fijo** (0 ≤ % < 100, 2 decimales; congelado en la cuenta al asignar, D7) | **No** en la ficha (D-11, D-44 "A"): va a ventas N2, congelado en la cuenta |
| "El mozo no crea clientes" (decisión 9 de Motor2) | **No**: el operador busca/da de alta/edita (F1) |
| ADR-015 de Motor2: POS **requiere** clientes | No: ventas lo usa de forma blanda |
| `GENERICO` como naturaleza | No: consumidor final = ausencia |
| `PagoConsignante` | Fuera de alcance (dinero/cuentas a pagar) |
| Iva.ts de Motor2 tiene 3 valores (`auditoria-de-motor2-2026-11-09.md` A37) | Pedernal: 11 |

---------------------------------------------------------------------

## 3. CATÁLOGO / PRODUCTO VENDIBLE

Documentos principales (orden de autoridad dentro del propio Pedernal: lo más nuevo gana, ver `e2-catalogo-minimo-especificacion.md` §7): `e2-catalogo-minimo-especificacion.md` (9/11, "E2 mínimo", manda sobre el diseño viejo), `catalogo-y-stock-diseno-de-datos.md` (653 KB; DDL aplicado en base de prueba; sus 15 tablas de catálogo **se achicaron a 9** en E2), `catalogo-y-stock.md` (spec base, 247 KB), `catalogo-carta-niveles-y-elecciones.md` (13/10, 2ª pasada 26/10: "vidriera" N0-N4), `carta-real-especificacion.md` (12/11: carta pública real + botón Ocultar), `catalogo-y-niveles-maqueta.md` (registro de decisiones numeradas 1..175; todas las citas "decisión N" de abajo son de ahí), `02-arquitectura-y-fronteras/referencias/elemento-configurable-y-variantes.md` (referencia, no decisión).

Estado: según `e2-catalogo-minimo-especificacion.md` y `mapa-de-pantallas-pedernal.md`, la migración `0025_catalogo.sql` (9 tablas) y los casos de uso están en `main` del ERP; **no hay pantalla de catálogo** (DOC, NO VERIFICADO). `carta_publica`/lector real: ESPECIFICADO (carta-real 12/11), sin código.

### 3.1 Clases y reglas de la ficha (e2 §1, §3.2, §3.3; decisiones 69, 131)

- **Ficha única con cinco clases de uso** (`clase_de_uso`): MATERIA_PRIMA, INSUMO, REVENTA, ELABORADO, VENDIBLE; se elige al crear y **no cambia** (disparador). **Decididas 69/131** (la inmutabilidad es SUPUESTO de la 131).
- Por clase (lo hace cumplir la base con CHECK, no la pantalla): solo REVENTA y VENDIBLE llevan alícuota, sección de carta, nombre de cocina, descripción, precio y opciones; MATERIA_PRIMA/INSUMO/ELABORADO no se venden.
- **Alta rápida:** nombre + qué es + unidad; queda `falta_completar = true`.
- **`se_vende` es columna generada, no escrita:** `clase IN ('VENDIBLE','REVENTA') AND alicuota_iva IS NOT NULL AND NOT falta_completar` (para que no exista estado inválido). Sin valor por defecto de alícuota "es decisión fiscal".
- **Alícuota de IVA** (obligatoria para poder vender): `CHECK IN ('0','2.5','5','10.5','21','27','EXENTO','NO_GRAVADO')` (8 códigos; los mismos de `0009_facturacion.sql`). Catálogo declara su propia lista `ALICUOTAS_DEL_PRODUCTO` (no importa fiscal; `catalogo-y-stock.md` C3). **PERO** el prototipo de compra usa 4 o solo 21%, y Motor2 usa solo "21% todos" en la migración (P2 de la carta): contradicción #4 y A.? (ver C-6 y sección 6).
- **Nombre:** 1-120, único por empresa **incluidos desactivados** (`nombre_clave` NFC+minúsculas); `nombre_de_cocina` (≤80, decisiones 71/72; vacío = la cocina ve `nombre`); `descripcion_en_carta` ≤300 (**SUPUESTO**: el tope no tiene fuente); `codigo` `^[A-Za-z0-9._-]{1,40}$` único; `codigo_de_barras` `^[0-9]{8,14}$` único; `tipo = 'BIEN'` (servicios fuera de E2, SUPUESTO).
- **Forma de venta** (decisiones 162, 166, 169): `unidad_de_venta_id` (misma dimensión que la base) + `paso_minimo numeric(18,4)` (decimal exacto 1, 0.5, 0.25…). El piloto lo deja en paso 1 y unidad = base; fracciones/peso apagadas por constante en el comando, **sin migración** al habilitarlas. Un precio con `NULL` de empresa = "precio abierto" (solo lo escribe `cambiarFormaDeVenta`, decisión 169).
- **Unidades:** lista cerrada de unidades con su dimensión en código (`src/primitivas/unidades/`, PP-2 decidida B ampliada: con `convertirCantidad` exacta, `CONVERSION_NO_EXACTA`) (`e0-cimientos-especificacion.md` §8.0).

### 3.2 Precios (e2 §3.2 `precio_de_venta`; decisiones 138, 147, 159, 166)

- **Regla de precio (DECIDIDO, decisión 138, 9/11):** precio = **precio del tamaño (o del producto) + recargo por opción**; **sin precio por combinación** (retirado como en Motor2).
- Tabla `precio_de_venta` **solo inserción**; alcance `sucursal_id NULL` = precio de la empresa; `sucursal_id` no nulo = precio propio de la sucursal (DECIDIDO decisión 147, 9/11: el precio varía por sucursal); con `opcion_id` = precio de la opción de la variante (tamaño) o recargo propio de sucursal de una ADICIONAL (decisión 159). IVA incluido y ARS (CHECK).
- Vigencia: desde el instante del cambio (`ahora` del contexto), **sin programación a futuro** (PENDIENTE Q6); `vigente_desde` estrictamente mayor que el último (`precio_fuera_de_orden`); precio **por instante**, no por jornada. **Un solo lector** `precio_vigente(...)` en SQL (`STABLE`, sin `SECURITY DEFINER`).
- **`cotizarParaVender`**: una sola función que suma precio del tamaño + recargos; el precio se congela en la línea del ticket ("el cierre no vuelve a cotizar"). Carta y caja usan **la misma cuenta** (prueba de paridad P-5, `carta-real-especificacion.md` §4.4: para **toda combinación** de tamaño y adicionales, carta = `cotizarParaVender` **al centavo**).
- Cero = cortesía (>= 0 permitido); en Motor2 cero es ambiguo ("sin dato") → la migración **no carga** precio 0 como precio real (`migracion-de-la-carta…` §2.1).
- Trampa R-18 del propio Pedernal (`10-ux-ui/06-aprendizajes…` §3.1): un producto "por variante" con precio propio inerte; cerrado en el diseño con `precio_propio_con_variante`.

### 3.3 Variantes, grupos de elecciones y opciones (e2 §3.2)

- `grupo_de_elecciones` **propio de cada producto** (DECIDIDO 9/11, A3 de la auditoría: "tenés razón: en Motor2 lo que consume cada opción vive en el grupo compartido, así que 'Pollo' gastaría lo mismo en la milanesa que en el bife"); "Copiar de otro producto" (copia independiente, tabla `copia_de_opciones` solo inserción).
- Tres clases: `VARIANTE` (fija el precio; **a lo sumo una variante activa por producto**, índice parcial; `es_tamano` boolean; obligatoria y de una sola elección), `INCLUIDA` (recargo 0), `ADICIONAL` (con recargo). La clase no se escribe después. (DECIDIDO dueño 13/10, punto 5 de `catalogo-carta-niveles-y-elecciones.md` §0.4.)
- `es_obligatorio`, `admite_varias` reemplazan `minimo/maximo` (**pierde el tope "hasta N"**; R6 de la migración).
- `se_muestra_en_carta boolean DEFAULT false` (decisión 157: **nace en "no"**, a favor de la 82). El CHECK de VARIANTE exige true; contradicción #6 con el modelo de datos viejo (que lo deja "sí" por defecto) — ver C-6.
- `opcion` + `version_de_opcion` (solo inserción; la línea del ticket guarda su id): `recargo numeric(18,6) >= 0` (**no admite recargo negativo**), `factor_de_tamano` (0 < f ≤ 100; solo en la opción de tamaño), `nombre` 1-80. Disparador: recargo = 0 en grupo INCLUIDA o VARIANTE; recargo = 0 si el grupo no se muestra en carta (`ELECCION_OCULTA_CON_PRECIO`, SUPUESTO de la 82).
- `consumo_de_opcion` (decisión 139): "solo dato" (no descuenta nada en E2): qué insumo consume cada opción, `cantidad > 0` en unidad base del insumo, `escala_con_tamano`; solo en grupos INCLUIDA/ADICIONAL; el insumo es MP/INSUMO/REVENTA y no el producto dueño.
- **El elemento configurable del dueño** (`elemento-configurable-y-variantes.md`): elemento base + grupos de opciones + obligatoriedad + precio/recargo + disponibilidad + efecto operativo + snapshot histórico; **variante ≠ modificador** (variante: stock propio, código de barras propio, la línea guarda la variante; modificador: descuenta insumos por receta, la línea guarda base + opciones); **combo/promoción es una tercera cosa**. Referencia, "no decisión"; primer cliente gastronomía → caso real = café con modificadores y stock por insumo; variantes con stock propio = "oportunidad sin caso real".

### 3.4 "Nombre en carta" y vistas del producto

- Dos vistas (decisión 71, DECIDIDO dueño 2026-11-08): **cliente (carta y ticket comparten el nombre; la carta suma descripción y foto; el ticket usa solo nombre + opciones elegidas porque el comprobante limita cada descripción a 200 caracteres)** y **cocina (comanda: `nombre_de_cocina` + estación)**. `catalogo-y-niveles-maqueta.md` líneas 559-593.
- Una elección **oculta** del corte de bife elegida por quien comanda (carta y ticket dicen "Bife a la criolla" sin nombrar el corte) (`catalogo-y-niveles-maqueta.md` ~593).
- Sección de la carta = campo del producto (A8 de la auditoría), tabla `seccion_de_carta` (nombre 1-80, `orden`, `activa`).
- Orden dentro de la sección: **alfabético `(nombre_clave, id)`** (DECIDIDO dueño 2026-11-12 Q2).
- Caracteres: ver contradicción C-3 (lista de permitidos vs `¿ ¡ ? ! % $`).

### 3.5 Carta pública real (`carta-real-especificacion.md`, 12/11/2026; **especificada, sin código**)

- Tabla nueva `carta_publica` (id lo manda la app, FK compuesta `(sucursal_id, empresa_id)`, `codigo` ≥128 bits base64url **único en toda la plataforma** = única excepción a "toda única incluye `empresa_id`", `nombre` 1-80, `rubro` opcional ≤40, `lugar` opcional ≤120, `estado` `EN_LINEA`/`FUERA_DE_LINEA`, nace fuera de línea; **una carta por sucursal**; `codigo` y `sucursal_id` inmutables; RLS forzada, sin DELETE).
- Rol `pedernal_publico` solo lectura **por columna y con políticas**, filtradas por `app.codigo_de_carta` fijado con `set_config(…, true)`; "sin ese valor ninguna tabla devuelve filas: no se pueden recorrer cartas probando códigos"; **meta-test falla si se suma una columna más**; "nunca alícuota, código, barras, unidad, nombre de cocina, se_vende, falta_completar, consumo".
- **"Falla cerrado"** (`marcas-productos-y-planes.md` §B.2: "mientras este puerto no esté construido y probado… la puerta no sirve ninguna carta").
- Un producto aparece si: carta EN_LINEA, sucursal activa, empresa opera, tenant pertenece a la marca del host, producto activo con sección activa, **no oculto**, **con precio para la carta en esa sucursal** (decisión 175: sin precio no sale), orden alfabético.
- **Botón "Ocultar"** (DECIDIDO dueño 2026-11-12): dos alcances (toda la empresa / un local), **independiente de desactivar**; oculto = no aparece en carta pública, ni en POS/salón, ni en conteos; **no se puede ocultar con existencia ≠ 0 ni con un conteo abierto con cargas**; lo ya cargado en una cuenta abierta se puede cobrar. **Hallazgo:** hoy `desactivarProducto` **no mira la existencia** (solo el depósito), contra lo que cree el dueño.
- `vidriera_por_qr` (extra de pago, perilla comercial, apagada de base; sin cargo en el piloto; "más adelante se va a cobrar seguro": dueño 2026-11-12).

### 3.6 Escalera de niveles del catálogo/vidriera (`catalogo-carta-niveles-y-elecciones.md`; estado: propuesta del ingeniero 13/10, 2ª pasada 26/10; **pisada parcialmente por E2 mínimo y decisiones 138/139 del 9/11**)

| Nivel | Qué | Estándar | Estado |
|---|---|---|---|
| N0 Vidriera | productos activos con precio, secciones, orden, "agotado", QR; ejes de variante con base + agregado | Sí | el N0 de E2 mínimo lo cumple |
| N1 | precio **completo por combinación** y grupos de precio único (`grupo_de_precio`, `variante`) | extra, perilla `variantes_y_grupos_de_precio` base 0 (ASUMIDA) | **Contradice decisión 138 y A2 de la auditoría (fuera de la 1ª versión)**: C-7 |
| N2 | conjuntos (combos) con contenido versionado | extra, `conjuntos` | E8 |
| N3 | grupos de elecciones reutilizables (biblioteca) | extra, `elecciones_reutilizables` | **Contradice la decisión del 9/11** (grupo propio, A3): C-7 |
| N4 | composiciones por tamaño con envase (stock) | extra, `composiciones_por_tamano` | stock |

Dinero en conjuntos: reparto del precio por alícuota exacto a 6 decimales (restos mayores); "el criterio fiscal del reparto es NO VERIFICADO (contador)"; E8: el centavo sobrante va al componente de **mayor resto** (A17 de `decisiones-tomadas-sin-el-dueno-2026-11.md`; **el prototipo dice "al más caro"**: difiere 1 o 2 centavos). Combos no mezclan alícuotas hasta consultar al contador (A15 de la auditoría; Motor2 los tiene bloqueados).

### 3.7 Las 4 "formas de leer un plato" y lectura pública (ADR-035 de Motor2 → `vidriera-lectura-de-productos.md`, especificado 2026-10-28)

`LecturaDeProducto` (proyección única en el servidor; **nunca compara nombres**): simple / columnas (≤3) / tabla (2 ejes) / lista; escala de letra por roles con piso del dueño más estricto que el de Motor2; impresión de la carta completa sin QR; salida pública campo por campo con lista cerrada de claves ("una clave nueva sin inventariar falla": LP-6) — `10-ux-ui/06-aprendizajes-de-motor2-ola-precio-y-carta.md` §3, `vidriera-lectura-de-productos.md` línea 200.

### 3.8 Combinaciones y "familias" (la parte más reciente, 11-12/11, relayada y **condicionada a que el dueño decida migrar**)

Un producto por combinación (milanesas, wok en 2 líneas) y **"familia"** con precio compartido y dos interruptores (carta y/o POS), sin vínculo permanente de precio; café = familia en tabla con "aplicar el precio por tamaño a toda la familia"; **portal B** (imagen con tarjetas) por empresa, hasta 3 MB; "duplicar producto"; descripción de opciones fuera por ahora (`migracion-de-la-carta-de-motor2-especificacion.md` §12.5-12.28; `decisiones-del-dueno-2026-11.md` fila 2026-11-11 "Carta de Motor2": "relayadas por esa sesión, el padre no las verificó con cita literal").

---------------------------------------------------------------------

## 4. INVARIANTES (ADR-003/004/006/008, arquitectura, calidad)

### 4.1 Tabla de invariantes con id, enunciado, estado y cita

| Id | Enunciado | Estado | Cita |
|---|---|---|---|
| INV-AIS-1 | **La empresa es la frontera de aislamiento**: todo dato de negocio lleva `empresaId`; RLS forzada + FK compuestas `(x_id, empresa_id)` + rol de app sin privilegios; tenant agrupa pero NO da acceso a datos | DECIDIDO (dueño, R2, 2026-10-11) | `05-base-empresa-usuarios-fiscal/diseno-inicial.md` §1.1; ADR-011; ADR-012 |
| INV-AIS-2 | `FORCE ROW LEVEL SECURITY` en toda tabla con `empresaId`; el rol de app no es dueño ni tiene `BYPASSRLS`; la plataforma usa otro rol y otra conexión; el `PROPIETARIO` lee todas las empresas de su tenant, **nunca escribe** (R3) | DECIDIDO (R3) / propuesto técnico | ADR-004, ADR-011, ADR-012 |
| INV-CTX | Contexto por transacción: `set_config(..., true)` firmado (HMAC-SHA256, `v1.<kid>.<payload>.<mac>`, 300 s, única función `SECURITY DEFINER` `contexto_firmado()`); **sin clave instalada el sistema falla cerrado (0 filas)** | "decidido por el dueño" (contexto firmado) | ADR-012 "Endurecimiento" |
| INV-PERS | Un único puerto `Transacciones` por el que pasa toda escritura y lectura con contexto; SERIALIZABLE + reintento completo ante 40001/40P01; ningún efecto externo ni lectura de reloj dentro del trabajo (`ahora` entra en el contexto); errores tipados por SQLSTATE (23505 → `Conflicto.Unicidad`, 23514 → `Check`, 42501 → `AccesoDenegado`…); **una restricción sin traducción declarada sale como error inesperado y rompe un test** | Propuesto (ingeniero); el dominio no depende del ORM = DECIDIDO (decisión 2) | ADR-004 |
| INV-EFEC | Efectos externos (mail) fuera de la transacción: tabla `trabajo` + intento inmediato post-commit + cron de respaldo; clave de idempotencia **única por empresa** (no global: oráculo de existencia) | Propuesto/decidido mixto | ADR-007; ADR-012 hallazgos |
| INV-DIN | **Dinero**: `Importe` en centavos (bigint); `MontoExacto` (fracción reducida de bigint, solo intermedio, no se persiste ni muestra); **redondeo UNA sola vez por comprobante, sobre el total**; total repartido entre líneas por restos mayores (desempate por orden) con suma exacta; IVA **por alícuota** (`neto_a = redondear(total_a/(1+a))`, `iva_a = total_a − neto_a`); precios IVA incluido; alícuotas 0, 2,5, 5, 10,5, 21, 27, exento, no gravado; NC en positivo y sin tope; moneda ARS (otra se rechaza en v1); JSON como texto `{"moneda":"ARS","monto":"1234.56"}`; PROHIBIDO `Number/parseFloat/Math/+unario` en `primitivas/dinero` y `cantidad`; sin `as` sobre tipos de dinero fuera de `primitivas/` | DECIDIDO por el dueño (decisión 3) en lo de negocio; el modo de redondeo (la mitad sube, simétrico) y la impresión del IVA contenido = **a validar con el contador** | ADR-006; `07-validaciones-con-contador/redondeo-e-iva.md` |
| INV-DIN-EJ | Ejemplo numérico del propio ADR-006: 3 líneas de 3 × $9,95 con 10 % de descuento: exacto 26,865 c/u = 80,595; **redondeando línea por línea 26,87×3 = 80,61 (no se hace)**; total redondeado una vez **80,60**; prorrateo → 26,87 / 26,87 / **26,86**. Dos alícuotas: 21 % total 1.210,00 → neto 1.000,00, IVA 210,00; 10,5 % total 1.050,00 → neto 950,23 (950,2262…), IVA 99,77; total 2.260,00 = 1.950,23 + 309,77 | DECIDIDO (opción A de la consulta 2) | ADR-006 "Ejemplo 1" y "Ejemplo 2" |
| INV-AUD | **Trazabilidad**: auditoría solo inserción, sin UPDATE/DELETE para ningún rol **y** disparador que lo impide hasta al dueño de la base (también TRUNCATE); nada se borra; ningún rol tiene DELETE ni TRUNCATE en ninguna tabla; correcciones con documento nuevo (NC), no reescribir la factura | Propuesto, probado en H2 | ADR-012; ADR-006 "Reglas de §5" |
| INV-IDEM | Toda acción puede llegar dos veces: claves de idempotencia, restricciones únicas, upsert; **repetir devuelve el mismo resultado exitoso**; unicidad de efecto derivado impuesta por la base | DECIDIDO (regla del dueño, `prompt-arranque` §5; RT-7.10/11) | `prompt-arranque-pedernal.md` §5 |
| INV-ATOM | Todo o nada; SERIALIZABLE; auditoría **dentro de la misma transacción**; control optimista `version` + `WHERE version = esperada` | DECIDIDO | `prompt-arranque` §5; ADR-004; ADR-012 |
| INV-FECH | Argentina UTC-3; corte de día por sucursal; `timestamptz`; zona por empresa; **el reloj entra como dato** | DECIDIDO | `prompt-arranque` §5; ADR-012 |
| INV-AUTZ | **Autorización en el servidor** (el frontend nunca decide): checklist de 10 puntos (quién lo pide, si puede, sobre qué dato, todas las puertas al mismo efecto, qué se devuelve, secretos, concurrencia, abuso, datos de terceros, despliegue); guard `módulo activo → capacidad de sucursal → permiso del rol`, motivos tipados `MODULO_EN_DESARROLLO`, `MODULO_NO_ACTIVO`, `SIN_CAPACIDAD`, `SIN_PERMISO`; guard síncrono y puro | DECIDIDO (checklist) / ADR-003 propuesto | ADR-003; `prompt-arranque` §5 |
| INV-FICHA | `modulo.ts` (ficha) por módulo de código + catálogo comercial `capacidades/modulos/catalogo.ts` = **dos declaraciones**, todo lo demás se deriva; cruces X1-X5 (una acción por caso de uso; X2 dependencia entre comerciales → `requiere`/`usaSiExiste` por puerto; sin ciclos; fichas existentes; cada regla generada con su **violación inyectada**) | Propuesto (ADR-003); decidido por dueño: catálogo de módulos como código, planes como datos (C7), guard módulo → capacidad → rol (C9) | ADR-003 |
| INV-DEP | ADR-001: estructura por tipo de módulo (Primitiva, Contexto, Capacidad, Dominio, Caso de uso, Contrato, Adaptador, Infraestructura, Interfaz, Plataforma, Vertical); dependencias de arriba hacia abajo; `modulos-solo-por-publico`; `capacidades-sin-negocio`; `fiscal-sin-negocio-ajeno`; "nunca se debilitan las reglas para que el diseño nuevo entre" | Mixto | ADR-001; `prompt-arranque` §3.1 y §1 |
| INV-CTRL | **Invariante ≠ control** (ADR-008): lo que protege al sistema/terceros es invariante y **nunca configurable** (no duplicar, aislamiento, trazabilidad, exactitud del dinero, autorización en servidor, **lo que ARCA rechaza**, invariantes de gobierno: CUIT único, un gerente activo por empresa, empresa nunca sin administrador, ARS en v1). Lo que protege al negocio de sus propios errores es **control** con nivel `permitir`/`avisar`/`bloquear`, **por defecto `permitir`**; el plan decide si está disponible; empresa fija nivel; sucursal solo endurece (supuesto); saltear un control deja registro de excepción en la misma transacción; un test con **lista cerrada** exige que ninguna invariante figure en el catálogo de controles. Primer control: tope de NC sobre el comprobante asociado (ARCA la aprueba con observación 10237) | **Mixto: DECIDIDO** (decisión 4, "Pedernal acepta lo que ARCA acepta"; permisivo por defecto; integridad nunca opcional; saltear deja registro) / **propuesto** (forma, resolución por ámbito, promoción a módulo con el 2.º control real) | ADR-008 |
| INV-GOB | Invariantes de gobierno: `cuit_valido()` (módulo 11); CUIT único entre empresas no canceladas; `tenant_id` de la empresa inmutable; instalación `SINGLE` a lo sumo un tenant; estados con CHECK + disparador con tabla de transiciones que un test compara con el dominio | Decidido/implementado H2 | ADR-012 |
| INV-SALIDA | Un solo traductor `aRespuesta` en el borde web: código estable + mensaje en castellano sin datos internos + referencia `PD-…`; error inesperado nunca sale con detalle; mutación declara su repetición; la pantalla nunca decide autorización; regla: acciones/componentes no importan de `publico.ts` las funciones que arman repositorios | **Propuesto** (ADR-016: "se convierte en decisión al implementar el primer flujo") | ADR-016 |
| INV-NIVEL | Ver RT-7.2/7.5 (copiar el nivel al registro; nunca ramificar por plan/fecha/config actual sobre registros viejos) | Decidido | `reglas-transversales.md` §7 |
| INV-CONTR | Matriz de invariantes del guardián (`arquitectura/contratos/invariantes.cjs`): I1..I10 (ruta con exactamente una clase; unidad declara contratos; la declaración coincide con el uso; contrato con única fuente de verdad; excepciones acotadas, vencidas, ≤60 días; exclusiones explícitas y temporales; "pasó" significa "se analizó algo"; registro no se debilita en silencio vs `main`; el guardián corre y bloquea en CI; la matriz está completa), **155 mutaciones (150 ejecutables)**; meta-invariantes M1-M5; "el guardián se prueba a sí mismo" (mutación de los propios `.cjs` con Stryker, meta 100 %) | Construido (según doc, G1c 2026-10-21) | `03-calidad-y-ci/contratos-arquitectonicos.md` §4 |

### 4.2 Reglas duras de calidad y CI (03-calidad-y-ci; **DOC, NO VERIFICADO**)

- Gate de Pedernal (según `prompt-arranque-pedernal.md` §2 describiendo a **Motor2**; y `ci-desde-el-minuto-1.md`): `tsc`, lint, arquitectura (dependency-cruiser), knip con 0 hallazgos, tests, build, build de la consola, e2e Playwright; Pedernal lista 16 checks "obligatorios desde el primer commit" (install reproducible, tsc, lint, format:check, tests de núcleo, arquitectura, **aislamiento multitenant**, contexto/permisos, base y migraciones, integración, build, código muerto, contrato, efectos y movimientos, e2e, seguridad básica) (`ci-desde-el-minuto-1.md` líneas 76-157). "Cada módulo nuevo nace junto con su contrato, sus tests y su regla de dependencia."
- Mutación (Stryker) obligatoria para toda regla nueva (`ci-desde-el-minuto-1.md` nota final y `prompt-arranque` §5); en ADR-006 "324 mutantes, 0 sobrevivientes".
- Reglas del repo ERP citadas por las specs: "dinero sin `number`", "denegar por defecto", "sin dato registrado no hay campo", "una regla un lugar", "fuente verificable para todo texto" (`e0-cimientos-especificacion.md` §2.6, citando `ERP:CLAUDE.md:20,26-37,38-45,66-74,75-80`).
- Excepciones con vencimiento ≤60 días y motivo (`contratos-arquitectonicos.md` I5), **igual que el trinquete "deuda con vencimiento (máx 60 días)" de motor2**.
- Quién escribe: orquestador no escribe código; sub-agentes escriben; el orquestador revisa. `orquestacion-*` y `metodo-de-trabajo.md`.
- CI: "Estabilidad" (12 copias de la integración) solo si el cambio toca integración/persistencia/migraciones/workflows, siempre en `main` y de noche (DECIDIDO dueño 2026-11-07).

### 4.3 Fallo cerrado / lista de permitidos / denegar por defecto: dónde aparece en Pedernal (DOC)

| Aparición | Qué dice | Estado | Cita |
|---|---|---|---|
| P1 (validación de un dato declara lo PERMITIDO, nunca prohibidos) y P2 (largo y conjunto permitido viven UNA vez en la primitiva como constantes de código; la base solo los copia con una prueba que falla si difieren; **lo existente que viola P1 se reescribe YA**) | DECIDIDO (dueño 2026-11-05/06) | `decisiones-del-dueno-2026-11.md` fila 2026-11-05 y 06 |
| Exención de "formatos de terceros" (`set-cookie.ts`, `saneamiento.ts`) como categoría cerrada de dos archivos con conteo fijo de prohibiciones; un archivo nuevo requiere aprobación del dueño | DECIDIDO (2026-11-06) | idem, PR #203 (C1) |
| "Una sola lista de caracteres para lo que se imprime" (lista de permitidos de texto: letras latinas con tilde y ñ, dígitos, espacio y `. , & - ' / ( ) ° + : ; " # º ª ’ “ ” – — « » ® ™`, sin saltos de línea, sin empezar con `+` ni `-`) | DECIDIDO (P1/P2) — **luego ampliada por Q3 del 2026-11-12** (C-3) | `migracion-de-la-carta…` §2.4; `carta-real` §11 Q3 |
| "Denegar por defecto" del guard: módulo `en_desarrollo` rechaza a todos, incluido `null`; acción no declarada = `RangeError`; "los módulos que no se declaran siguen sin dar permisos" | Verificado en `e0-cimientos` §2.1 (por la sesión de especificación leyendo el ERP) | `e0-cimientos-especificacion.md` líneas ~390 |
| "**Todo nace cerrado**": "Un ítem sin unidad, alícuota o depósito no se vende; cada tabla filtra por empresa y el servidor verifica quién pide y con qué permiso, también en caché" (`catalogo-y-niveles-maqueta.md` líneas 938, 1087 "Un ítem sin alícuota o condición declarada no se puede vender (todo nace cerrado)", 1311 decisión 26 "lotes: los que se declaren, uno por uno (todo nace cerrado)") | DECIDIDO (maqueta, decisiones) | `catalogo-y-niveles-maqueta.md` |
| Promoción/sección: no hay documento de Pedernal que diga textualmente "una promo nace sin secciones tildadas" (eso es motor2); el equivalente en catálogo: `se_muestra_en_carta` **nace false** (decisión 157), "alícuota sin valor por defecto: es decisión fiscal" (e2 §3.2), el cargador de migración "**no tiene valor por defecto propio**: rechaza toda fila sin alícuota, clase o sección" (`migracion-de-la-carta…` §3.1, recomendación C, PROPUESTA) | Mixto | e2; migración carta |
| Lectura pública: lista cerrada de claves de salida, meta-test que falla si se suma una columna, sin código no se sirve ninguna carta ("falla cerrado") | DECIDIDO (dueño, carta por QR como extra con puerta de solo lectura) | `marcas-productos-y-planes.md` §B.2; `carta-real` §3.3; `vidriera-lectura-de-productos.md` LP-6 |
| "Falla cerrado ante la duda" como principio acordado de Motor2 (`prompt-arranque` §5, "los principios que ya acordamos para Motor2") — pedido de aplicarlo a Pedernal | DECIDIDO (principio) | `prompt-arranque-pedernal.md` línea ~295 |
| **Tensión explícita con ADR-008** (permisivo por defecto): ver C-2 | | |

---------------------------------------------------------------------

## 5. DISEÑO VISUAL

### 5.1 Marca blanca (`01-vision/marca-blanca.md`; `11-especificaciones/marcas-productos-y-planes.md`; `10-ux-ui/02-marca-iconos-metadatos-y-seo.md`)

- **"La marca es un dato, nunca código"**: ninguna pantalla, mail, PDF ni mensaje tiene escrito un nombre, logo o color; estilos con nombres neutros `--brand-primary`, `--brand-secondary`, `--brand-accent`; resuelve el **dominio/host** en el servidor; un dominio desconocido devuelve página neutra (no cae en la principal); el proveedor no desaparece legalmente (contrato/privacidad/factura del servicio). DECIDIDO (`marca-blanca.md` §3, `00-descubrimiento.md` "Regla de marca 2026-10-12").
- **Operador = dueño de la plataforma**; una marca tiene muchos tenants; una marca padre + hijas ("submarca" = producto con nombre, dominio, tema, módulos iniciales, vocabulario, plan por defecto; jerarquía hasta nivel 2); **marca y módulos son independientes** (la marca solo trae un paquete inicial; **no hay una marca por módulo**).
- **Tema = LISTA CERRADA de tokens** (`marcas-productos-y-planes.md` §B.3): claves `primary`, `on-primary`, `secondary`, `accent` (→ `--brand-primary`, …); valores `#rrggbb` en minúsculas; "**Nada de CSS libre**" (no `rgb()`, `url()`, `;}`); contraste WCAG: `on-primary` sobre `primary` ≥ 4,5:1 (`CONTRASTE_INSUFICIENTE`), `accent` sobre blanco ≥ 3:1; propuesto: `primary` contra fondo ≥ 3:1; `on-primary` pasa a opcional (se deriva el más legible de dos valores fijos); hover/presionado/deshabilitado se **derivan en código** (no se guardan); "ningún estado se comunica solo por color". **Tokens semánticos en código** (`fondo`, `superficie`, `texto`, `borde`, `foco`, `peligro`, `exito`, `aviso`, `info` con su `sobre-*`): **los de estado nunca toman valor de marca** (la marca no puede hacer que "Anular" se vea como "Cobrar") (`10-ux-ui/01-arquitectura-de-experiencia.md` §4.1-4.3). DECIDIDO ([MPP] §B.3, §B.11) / "propuestos" para tipografía y radio.
- Tipografía: cuerpo fijo; títulos de un **catálogo cerrado** de pocas familias alojadas por nosotros; radios `RECTO|SUAVE|REDONDEADO` — ASUMIDO, P3 abierta. Densidad no es de marca. Escala fija (el usuario agranda con el navegador, unidades relativas).
- **Modo oscuro:** "No en v1; los tokens semánticos quedan preparados" — DECIDIDO como supuesto de [MPP] (P4 `01-arquitectura-de-experiencia.md` §12 A); ver C-2b.
- Activos: lista cerrada de **ranuras** (`icono_192`, `icono_512`, apple-touch 180, `logo_sobre_primario`…), PNG/WebP, **sin SVG** (puede llevar scripts), sin maskable/monochrome en v1; herencia ranura por ranura; íconos por host; `robots`, `sitemap`, `manifest` dinámicos por host; sin `favicon.ico` estático en `app/` (regla R1); carta del host compartido `noindex` y sin sitemap (no publicar la lista de códigos); carta en dominio propio, indexable (`02-marca-iconos…` §3, Q2 recomendada A).
- **Niveles de marca propia por cliente** (`marca-blanca.md` §4): 0 marca principal; **1 nombre, logo y colores propios por sucursal INCLUIDO EN EL PLAN sin costo extra (dueño 2026-11-09)**; 2 subdominio; 3 dominio y mail propios; 4 white-label. El logo y colores de sucursal **no son un extra pago**; "quien gerencia una sucursal cambia su identidad"; el logo se sube desde el celular (decisiones 101-107). Ver C-1.
- **Herencia empresa → sucursal** (`migracion-de-la-carta…` §12.13-12.14, citando `plan-de-construccion-gastronomia.md` E2 y `migracion 0014_aspecto_de_marca.sql`): cada sucursal usa lo de la empresa o tiene lo propio, grupo por grupo.
- **Cambio relayado 2026-11-11 (dueño, sesión de la carta de Motor2; NO verificado por el padre con cita literal):** "colores **libres** con color de marca por sucursal y control de contraste (**reabre la decisión del 13/10 de paletas cerradas**, solo en el color de marca; claro/oscuro con serifa siguen siendo del sistema)". Ver C-2.

### 5.2 Carta/experiencia (`10-ux-ui/03-experiencia-de-la-carta.md`; `04-analisis-carta-motor2.md`)

- Celular primero; **sin modo sin conexión** (DECIDIDO 2026-10-11); sin app instalable en v1; fuente del sistema en v1; `<dialog>` nativo como `Superposicion`.
- Lista primero (DECIDIDO Q3 13/10: lista → fotos → cuadrícula y libro con prueba medida); **el Libro = el de Motor2** (DECIDIDO 2026-10-13: modelo cerrado de la plataforma, 2 variantes clara/oscura con serifa, pintado con tokens de marca; el comerciante carga solo contenido de portada y, con identidad del negocio, logo y colores dentro de los tokens). 2026-11-11: "el Libro entra a la tanda si la maqueta da el mismo resultado".
- **Legibilidad (D4/D10, DECIDIDO por el dueño):** nombre, precio y descripción con contraste ≥ **7:1**; nombre y precio ≥ **18 px** (precio peso ≥ 600), ningún texto de carta < **16 px**, unidades relativas (`rem/em`), control visible "Letra" con tres pasos; el fondo y texto son tokens **semánticos del código** (no de la marca); "Agotado" es texto, no color; viewport sin bloquear zoom.
- Mediciones de Motor2 (sobre capturas del dueño, `04-analisis-carta-motor2.md` §0.5): contador 2,93:1, "ÍNDICE" 3,69:1, destacado 4,16:1, botón imprimir ≈1:1; objetivos táctiles 32-36 px; 11-14 px por defecto; 64 claves libres de tema por sucursal y 22 del portal.
- Peticiones del dueño: tarjeta de producto con foto y descripción propia (hoja inferior hasta 90 % en celular), guarniciones visibles, enlace directo por sección/producto, mejor contraste.
- Fotos: validar por bytes, sin decodificar; 480 px ≤ 80 KB, 1200 px ≤ 300 KB; chequeo diario de fotos externas.

### 5.3 Mobile-first y accesibilidad

- **Celular es el dispositivo principal (DECIDIDO 2026-10-11)**; escritorio se adapta desde ahí; objetivos táctiles grandes; tablas que se vuelven tarjetas; flujos cortos (`00-descubrimiento.md` T1). **Venta rápida de mostrador** = primer flujo; búsqueda por nombre o código escribiendo; sin escaneo en v1.
- Objetivo táctil: propuesta propia de **48 px en operación** (no es cifra de la norma, ASUMIDO); Motor2 mide toques < 44 px en selector de sucursal, "Salir", "Editar", "Marcarlo agotado" (auditoría, informe Playwright).
- Accesibilidad con `axe` desde el primer componente (ADR-001); criterios WCAG 1.4.3, 1.4.11, 1.4.1, 1.4.4, 1.4.10, 2.4.7, 2.5.8, 3.3.x, 4.1.3, 2.2.1 (**"de memoria: NO VERIFICADO contra el texto oficial"**, `01-arquitectura-de-experiencia.md` §4.4).
- Regla del dueño 2026-10-14: **ninguna pantalla sin prototipo aprobado**; una pantalla que difiere del prototipo es un defecto. 2026-11-05 (motor2 hermano): maquetas con datos reales — **en Pedernal el equivalente son las maquetas HTML en `10-ux-ui/prototipos-gastronomia/` aprobadas por el dueño (18 aprobadas, 5 contradichas por decisiones posteriores, 3 "en lo general", 1 sin aprobar, 7 sin maqueta: `mapa-de-pantallas-pedernal.md` §1)**.
- 2026-11-12: maquetas del recorrido mínimo: aprobadas conteo y secciones; **NO aprobada venta rápida** ("debería tener otro diálogo… de apretar el producto que es y luego elegir y elegir la cantidad; de paso parece plana y no sabés si estás apretando o no en el celular, porque el botón de venta y cobro queda muy abajo") → rehacer v4 con barra fija inferior (`decisiones-del-dueno-2026-11.md` fila 2026-11-12).
- **Campo numérico argentino** (DECIDIDO dueño 2026-11-12): solo dígitos y coma; **se rechaza el punto** ("Yo rechazaría '.'"); pegar "1234.56" se rechaza; los puntos de miles los agrega el sistema; CUIT y DNI se formatean mientras se escriben (SÍ, 2026-11-12). Contra: en las maquetas de Pedernal el punto se lee como miles ("1234.50" → $ 123.450), defecto reproducido.
- ADR-038 de Motor2 (números tecleados, notación argentina, cercos `type="number"`, `Number(formData.get())`, `new Date(texto)`) = precedente del "contrato de campos tipados" que Pedernal tiene como candidato (`contratos-arquitectonicos.md` §13, sin construir).
- Frontend: Next.js; evaluación de arquitectura (`10-ux-ui/05-evaluacion-arquitectura-frontend-serverless.md`; ADR-015: interfaz web integrada, alternativa E aceptada por el dueño).

---------------------------------------------------------------------

## 6. COMPARACIONES YA HECHAS CON MOTOR2 (misma entrada → distinta salida)

Documentos: `11-especificaciones/auditoria-de-motor2-2026-11-09.md` (v3, contra Motor2 `50226ac8` del 8/11; informes en `auditoria-de-motor2-informes/`: 4 lecturas + 4 corridas Playwright en Chromium 390 y 1280 px), `migracion-de-motor2-a-pedernal-factibilidad.md` (11/11), `migracion-de-la-carta-de-motor2-especificacion.md` (11-12/11), `contradicciones-entre-documentos-2026-11-09.md`, `decisiones-del-dueno-2026-11.md`, `10-ux-ui/04-analisis-carta-motor2.md` (13/10, sobre HEAD `183f102`) y `10-ux-ui/06-aprendizajes-de-motor2-ola-precio-y-carta.md` (26/10, sobre PR #130 de Motor2). Nota: Motor2 "actual" para estos docs es una foto del 8-11/11, no el estado de hoy.

### 6.1 Diferencias de reglas con ejemplos numéricos explícitos (misma entrada → distinta salida)

| # | Tema | Entrada | Motor2 | Pedernal (doc) | Fuente |
|---|---|---|---|---|---|
| D1 | **Precio por combinación** | Sorrentino con precio distinto por tamaño × tipo; "Entera con Jamón y queso a $ 13.500" | **No se puede**: ofrece precio final por tamaño + un recargo igual para todos los tamaños: "con 4 números no se llega a 6 precios independientes" (retirado el 20/10: "0 filas en producción y la carta mostraba el precio aditivo mientras el POS cobraba otro", ADR-032:134) | Diseño viejo: grilla de 6 celdas libres (12 clics, 15 campos); **luego DECIDIDO 9/11 (decisión 138): también solo suma** (tamaño + recargo); un caso aislado = producto aparte | `auditoria-de-motor2…` tabla "Lo que medí", A1, A2; `04-analisis`; `lectura-catalogo-opciones-y-carta.md` hallazgo previo |
| D2 | **Recargo en % vs monto** | Opción con recargo 10 % sobre precio base | `PORCENTAJE`: `porcentaje × precio base`, redondeo a 2 decimales **alejándose del cero** (`componer-precio-de-linea.ts:139-141`; **se mueve con el precio base**) | Solo monto fijo en pesos (`recargo >= 0`); al migrar se convierte con la regla de Motor2 y cada caso lo aprueba el dueño: **"el porcentaje se mueve con el precio base en Motor2; el monto fijo, no"** | `migracion-de-la-carta…` §2.1 filas VersionDeOpcion PORCENTAJE (S4, P7) |
| D3 | **Recargo negativo** | Opción con diferencia −$ (descuento por elegirla) | Admitida (`diferenciaPrecio` puede ser negativa) | **No admitida** (`recargo >= 0`); al migrar **no se carga**, va al informe ("dinero") | idem |
| D4 | **Adicional: línea hija vs opción** | Adicional "Huevo +$ 600" | Se cobra como **línea hija** con su propio producto "ancla" oculto y su propio stock (`componer-precio-de-linea.ts:235-245`) | Es una opción **dentro** de la misma línea; "el **total** es el mismo; **la forma del ticket no**" | idem |
| D5 | **Tope "hasta N"** | "Hasta 2 salsas" / "mínimo 2" | `cantidadMinima/Maxima` por grupo y por producto | Solo `es_obligatorio` y `admite_varias`: "hasta 2" pasa a "varias" sin tope; "mínimo 2" pasa a "obligatorio" | idem (R6) |
| D6 | **Precio cero** | `precioVenta = 0` | Ambiguo: "venta vieja sin precio" vs cortesía real (`hallazgo-venta-en-cero-real-vs-legada`) | `0` = precio real $ 0 (cortesía); **al migrar no se carga como precio** (queda "precio abierto", no sale en carta) | `migracion-de-la-carta…` §2.1; A46 de la auditoría |
| D7 | **Producto sin receta** | Vender un producto sin receta | **"Sin receta no se vende"** (ADR-033); producción: N productos de venta, **0 recetas, 0 ventas** | Se vende con aviso "falta receta" (DECIDIDO decisión 140, 9/11; el aviso aún no sale: B8 de `decisiones-tomadas-sin-el-dueno`) | auditoría A6; `decisiones-tomadas…` B8 |
| D8 | **Alícuota de IVA** | Cargar una gaseosa de reventa con precio e IVA | Hay campo en la base (`Producto.alicuotaIvaVenta`) pero **ninguna pantalla lo carga**; solo 2 clases (MP/PV); gaseosa = ≈12 clics, 7 campos, 3 guardados, receta de 1 unidad | Alícuota **obligatoria** para vender (se_vende generado); 5 clases; gaseosa 6 clics, 4 campos, 2 guardados (prototipo) | auditoría tabla "Lo que medí" y A9; `migracion-de-la-carta…` §3.1 |
| D9 | **Costo con IVA** | Compra de insumo con IVA | Guarda costo **con IVA incluido** y "eso distorsiona el margen de un responsable inscripto" | **Costo neto del IVA recuperable**: inscripto → costo neto; monotributista o exento → costo con IVA incluido; B o C → importe de la línea; crédito fiscal computable solo inscripto en Factura A (DECIDIDO 2026-11-11 "Sí, aplicalo", PC-1; el contador puede corregir) | auditoría A32; `decisiones-del-dueno-2026-11.md` fila 2026-11-11 PC-1 |
| D10 | **Costo: método** | Costo de un artículo | **Última entrada** (ADR-040: promedio móvil resolvió después el problema del traspaso sin costo) | Decisión 24: promedio ponderado **por depósito**; el diseño de datos: método elegido por la empresa y costo **por artículo** (contradicción #8); la auditoría propone promedio móvil por artículo (A20) | auditoría A20; contradicciones #8 |
| D11 | **Devolución de proveedor / NC** | Devolver mercadería | Se costea **al valor de hoy** ("tiene el mismo problema que Pedernal con el método vigente") | Propuesta: al **costo de la compra original** (A31); NC: 2 estados (pedida/recibida) con recordatorio vs 4 en Motor2 | auditoría A31 |
| D12 | **Cambiar "Precio por" de Caja a Kilogramo** | Bife: cambiar la unidad de precio de Caja a Kg | (no medido en Motor2) | **Defecto del prototipo de Pedernal**: el precio no se convierte, el total se infla **23,5 veces sin aviso: $ 258.500 → $ 6.074.750** | `playwright-compra-y-stock.md`; auditoría tabla de defectos (Compra, media) |
| D13 | **Punto decimal** | Escribir "1234.50", "15.50", "2.5" | (Motor2 con ADR-038: "21.000" es miles en un importe y es ambiguo en una cantidad con decimales: se pregunta, no se adivina; muestra "Se entendió: $ 21.000,00") | En los prototipos de Pedernal: "1234.50" → **$ 123.450**; "15.50" → **$ 1.550**; "2.5" → **25** (compra/producción) y **2,5** (stock); "1.234,50" se rechaza en stock → **un mismo número se lee distinto según la pantalla**. Decisión posterior del dueño 12/11: **se rechaza el punto** | auditoría "Qué exigir al sistema real" y tabla de defectos; `decisiones-del-dueno-2026-11.md` 2026-11-12 |
| D14 | **Precio sospechoso** | Cambiar $ 2.200 a $ 12,5 | Aviso "precio sospechoso: $ 2.200 pasa a $ 12,5, **−99,4 %**" | Pedido a copiar (A17: sí a los tres: vista previa, aviso, "Quitar de este producto"); "precio por sucursal: confirmación extra si el cambio supera el **30 %**" (Motor2, ADR-037) | auditoría A17; `06-aprendizajes` §2 |
| D15 | **Doble clic** | Doble clic en "Guardar/Cobrar/Abrir caja" | **Una sola acción**; botón deshabilitado mientras corre | Prototipos: doble clic en **Cobrar cobra directo sin pasar por la pantalla de cobro**; doble clic en **Abrir caja abre y la 2.ª pulsación cae en "Cerrar caja"**; F4 cobra dos veces la misma cuenta; doble clic en "Abrir conteo" termina en "Aplicado" sin contar nada | auditoría "Defectos de nuestros prototipos" (gravedad alta) |
| D16 | **Efectivo de más / vuelto** | Pagar de más en efectivo | Sin cobro, medios ni vuelto (Motor2 no tiene caja) | Salón: vuelto; venta rápida: bloqueo (dos pantallas de Pedernal se contradicen); DECISIÓN posterior: "un egreso mayor al efectivo esperado se acepta, deja el esperado en negativo y avisa, **nunca bloquea**" (DEC-0027) | auditoría "Dos pantallas se contradicen"; decisiones 2026-11-11 caja |
| D17 | **Pedir compra con cantidad 0, negativa o texto y precio 0 o negativo** | "Pedir" | Rechaza nombrando el insumo | Prototipo: crea "Compra 8 · Pedida · $ 0,00" | auditoría tabla de defectos (Compra, media) |
| D18 | **Stock: cuándo sale** | Cierre de cuenta | Descuenta **al cerrar** (`cerrar-cuenta.ts`) | DECIDIDO dueño 9/11: **al cerrar la cuenta**; el aviso de stock insuficiente es al enviar (decisión 85); pero **la maqueta de salón decía "al enviar"** (contradicción dentro de Pedernal, "stock al enviar contra stock al cerrar") | auditoría A40 y "Qué exigir al sistema real" |
| D19 | **Importes sin tope** | Fondo de caja "90.071.992.547.409,93" | (no aplica) | Prototipo muestra "$ 90.071.992.547.409,94" (pierde centavos sobre 2^53); "12345678901234567890" → "$ 12.345.678.901.234.567.000,00" (baja). Dinero en `bigint`/texto en el diseño real; B3: importe máximo **999.999.999,99** | `playwright-defectos-administracion-caja-y-carta.md`; `decisiones-tomadas…` B3 |
| D20 | **Rendimiento medido → merma** | "Pasar a la receta" con medidas 9,4 % y 10,5 % | — | Prototipo edita merma 9 y 10 (**redondea**): "medida con conteos 9,4 %" y "10,5 %" → 9 y 10 | `playwright-defectos-administracion-caja-y-carta.md` |
| D21 | **Corte de día de los reportes** | Reporte cerca de medianoche | **Corta el día en UTC, no en hora argentina** (`prompt-arranque` §2 "Lo que sé que está mal") | **Jornada con corte por sucursal** (nivel 3, 00:00 por defecto), día contable por jornada; fecha del ticket con la regla de jornada | `prompt-arranque` §2; `niveles-de-operacion.md` correcciones 7 |
| D22 | **Dos recorridos de venta** | Mostrador vs salón | Un solo motor (mesa 0 con la misma pantalla del salón): 13 clics, 4 guardados, "Enviar a cocina" obligatorio antes de cerrar | Pantallas distintas: venta rápida 5 clics (ítems de 1 toque), salón 13; decisión 144: **un solo motor, dos pantallas** | auditoría A38/tabla |
| D23 | **Descuento fijo de cliente** | Cliente con X % | `Cliente.descuento` 0 ≤ % < 100, congelado en la cuenta al asignar | Fuera de `parte`; ventas N2 (D-44 "A") | `clientes.md` D-44 |
| D24 | **Sección de carta / tema de carta** | Carta distinta por sucursal / apariencia | `TemaCartaSucursal` 64 claves **libres** por sucursal; `PortalCartaEmpresa` 22 claves; slugs adivinables; `ContenidoCartaProducto` | Tema = 4 tokens `#rrggbb` de lista cerrada; **`codigo` no adivinable ≥128 bits**; **luego (2026-11-11, relayado)**: color libre acotado con control de contraste por sucursal | `04-analisis-carta-motor2.md` §0.6-0.8; `migracion-de-la-carta…` §2.1, §12.14 |
| D25 | **Precio en carta vs caja** | Producto con tamaño y opciones | Carta mostraba el precio aditivo y el POS cobraba otro (causa del retiro del 20/10) | Prueba de paridad P-5: carta = `cotizarParaVender` **al centavo para toda combinación**; "una sola función" | `carta-real` §4.4; e2 línea 14 |
| D26 | **Anular compra ya recibida con stock usado** | Anular | Rechaza ("callejón sin salida") | Corregir con **ajuste y motivo** (DECIDIDO decisión 143) | auditoría A30 |
| D27 | **Proveedor: puntos de venta** | Ficha del proveedor | `PuntoDeVentaDeProveedor`: lista cerrada, **0 usos**, diseñada y migrada sin código | "Los últimos usados" con letra sugerida (A35); la ficha como lista cerrada con confirmaciones (decisión 110) → contradicción #7 | auditoría A35; contradicciones #7 |
| D28 | **Combos** | Combo con alícuotas mixtas | Bloqueado hasta confirmar (D-2), reparto proporcional al precio de lista; en producción: 0 lugares de lista y 0 del día | Pedernal "reparte por alícuota al centavo" (pendiente del contador, A15) | `lectura-catalogo…` |
| D29 | **Descripción de opciones** | "lechuga, tomate, cebolla" (≤120) | `OpcionDeGrupo.descripcionEnCarta` | Sin columna; "fuera por ahora" (dueño); en el cargador va a informe | `migracion-de-la-carta…` §2.1, §12.14, §12.25 |
| D30 | **Textos con `¿ ¡ ? ! % $`** | "¿Querés papas?", "Pizza muzza!", "Combo 2x1 50% off", "Precio $500" | Aceptados | **No pasan** la lista de permitidos de Pedernal (verificado por la sesión con la expresión de la base); P8; **luego Q3 (2026-11-12): se permiten en nombres** | `migracion-de-la-carta…` §2.4; `carta-real` Q3 |
| D31 | **Migración de producción de Motor2** | Qué hay cargado | N productos de venta, **0 materias primas, 0 insumos, 0 proveedores, 0 recetas, 0 ventas** (docs de Motor2 del 3/11 y 12/10, no verificado contra la base); "cargó toda la carta, nada de stock/recetas/ventas" (dueño 2026-11-11) | La primera tanda de migración sería **solo la carta** (catálogo), sin stock | `factibilidad` §1, §4.1; `decisiones-del-dueno` 2026-11-11 |
| D32 | **Infra/escala** | — | 112 modelos, 158 migraciones, 97 pantallas (`src/app`), 26 reportes (otras cifras: "17 reportes" en `prompt-arranque`, "28 reportes" en la auditoría) | 28 tablas de compras y 57 de stock **diseñadas antes del primer uso** ("el mismo riesgo": Motor2 migró gastos, NC de proveedor, centros de costos y puntos de venta del proveedor **sin una línea de código que los use**) → regla C5: "una migración se escribe solo cuando su pantalla está aprobada y tiene un caso de uso en la misma entrega" | auditoría "Qué cambió", C5; `factibilidad` §3.2 |

Nota: el conteo de reportes de Motor2 varía entre docs (17/26/28): ver C-14.

### 6.2 Brecha de funcionalidad según la factibilidad (11/11; DOC, no verificado)

- Pedernal `main`: backend de catálogo, caja, venta rápida, facturación y stock, **ninguna pantalla** de catálogo, carta (admin), caja, venta ni stock (`apps/web/app/s/app/(operacion)/` solo facturación, configuración fiscal, cuenta y sucursal). **Un cliente de Motor2 no podría operar hoy en Pedernal.**
- Lo que Pedernal decidió **no** hacer en 1.ª versión y Motor2 tiene: traspasos con solicitud/aprobación, consignación, la mayoría de los 26 reportes, varias funciones de la carta (menú del día, promos con cupo, género/agrupado, descuento tachado, etiquetas/destacado, orden de productos dentro de la sección, apagado de opción por sucursal).
- Conteo físico: Pedernal = **a ciegas** por depósito, uno abierto a la vez, aplica un ajuste por diferencia, **no se aplica vacío** (E5); Motor2 = una fila por producto/sección/lote con saldo del sistema y diferencia; falta en Pedernal frecuencia de conteo por producto y acciones `FALTA_MOVIMIENTO`/`DESCARTAR`. Decisión posterior del dueño 11/11: registrar la hora del conteo y filtros de preguntas (el sistema descuenta solo lo movido después de la hora; "re engorroso" listar tickets).
- **Decisión de migrar: NO TOMADA** (`decisiones-del-dueno-2026-11.md` filas 2026-11-11): "B, pero no estoy seguro, depende de las olas y su resultado"; regla "Motor2 no se migra" sigue vigente; el estudio es solo estudio.

### 6.3 Las 49+ sugerencias A/B/C de la auditoría (lista corta; decididas por el dueño)

ACEPTADAS/DECIDIDAS el 9/11 por el dueño: A1/138 (sin precio por combinación), A3 (grupos propios del producto), A4/139 (consumo por opción en la pestaña Opciones del producto), A6/140 (se vende sin receta con aviso), A7/147 (precio por sucursal), A26/141 (compras N1 y N2 primero), A28/142 (pagar factura mínimo), A30/143 (corregir con ajuste), A38/144 (mostrador y salón un solo motor), B2/145 (estado "Abrí la caja para cobrar"), C1/146 (primer cliente = cafetería sin producción). El resto: recomendaciones del ingeniero ("sin veto") — `contradicciones…` #16 anota que las matrices usan como decididas propuestas "pendientes de veto".

---------------------------------------------------------------------

## 7. CONTRADICCIONES INTERNAS ENTRE DOCUMENTOS DE PEDERNAL

A. Las 20 que el propio doc registra (`contradicciones-entre-documentos-2026-11-09.md`; todas con estado "decidir/alinear", algunas ya resueltas después):

| # | Tema | Cómo se resolvió después (si hay evidencia en otro doc) |
|---|---|---|
| 1 | Condición IVA: 6 valores (`clientes-y-proveedores.md`) vs 11 (`clientes.md`, `h7-facturacion.md`) vs etiquetas libres (decisión 110, prototipo de compra) | **Resuelta**: 11 (e9 §3.1: "Contradicción #1 ya resuelta") |
| 2 | Largo del pasaporte: 3-20 (`clientes.md`) vs 6-9 (decisiones nov.) | **Resuelta**: 6-9 (e9 §3.1; migración 0024) — **pero el DDL de `clientes.md` sigue con 3-20** |
| 3 | Validación en forma de prohibidos ("sin espacios ni caracteres de control") vs principio del 05/11 (declarar permitido) | Reescribir al construir, chequeo `fuente-unica` |
| 4 | Alícuotas: 8 en el diseño de datos vs 4 o solo 21 % en prototipos de compra y receta | Prototipo de productos usa 8 |
| 5 | Tipos de medio de pago: 3 (mostrador), 5 (salón), 6 (diseño) | La pantalla de medios usa 6 |
| 6 | "¿Se muestra en la carta?": decisión 82 empieza en "no" vs modelo de datos "sí" por defecto, sin columna por producto ni elección | Resuelta parcialmente: decisión 157 → `se_muestra_en_carta DEFAULT false` |
| 7 | Decisiones sin dónde guardarse (nombre de cocina y estación 71/72, descripción, peso variable 109, clases de uso 69, ofertas de proveedor 70, ficha del proveedor con puntos de venta y letra 110-113) | Parcialmente: nombre de cocina, descripción y clase ya en e2; peso variable/presentaciones en catálogo (A25) |
| 8 | Costo por depósito (decisión 24) vs método elegido por la empresa y costo por artículo (diseño) | Abierta; A20 propone promedio móvil por artículo |
| 9 | Aprobación sobre un umbral (decisiones 23/36) vs sin umbral | A19: "una orden de compra no necesita aprobación de una segunda persona" (decisión del orquestador, ★ pendiente de veto) |
| 10 | Quién confirma una recepción: responsable del depósito destino (51/52) vs quien opera, administra o gerencia | A18: gerente y administrador |
| 11 | Uso del depósito y su alcance: "sucursal o central" (decisión 5) vs el diseño exige sucursal | Abierta |
| 12 | Baja por vencimiento: operador la registra (documento) vs reservada a administra/gerencia (decisión 118) | B6: exige gerente o administrador |
| 13 | Variantes y su perilla: sin perilla / `variantes_y_grupos_de_precio` base 0 / "estándar de gastronomía" (decisión 79) | Abierta (ver C-7) |
| 14 | Stock negativo: decisión 85 "avisar con confirmación" vs control por defecto "permitir" | B8: con control en "avisar" el cierre de venta **falla** (ventas aún no sabe confirmar) |
| 15 | Receta por sucursal (decisión 74) vs alcance empresa (ficha G.8) | Abierta |
| 16 | Permisos del operador sin vetar (F6, F7 de catálogo y stock) usados como decididos | Pendiente de veto |
| 17 | Tolerancias de compras: `configuracion_de_compras` vs `tolerancia_de_compras` | A27 propone quitar tolerancias de la 1.ª versión |
| 18 | OC frente a decisiones 92/109 (presentaciones, depósito destino); "parcialmente recibida" es derivado | Abierta |
| 19 | Cajas por sucursal: decisión 88 solo medios; perilla `cajas_por_sucursal` de sucursal; P3 abierta | Abierta |
| 20 | Dos documentos de clientes: `clientes.md` "no reemplaza" a `clientes-y-proveedores.md` pero pide reemplazar su §B.9 | `e9-compras` §3.1 usa `clientes.md:904-1284` como base |

B. Otras contradicciones que encontré en mi lectura (no están en esa lista):

| Id | Qué dicen | Dónde |
|---|---|---|
| **C-1** Marca propia, nivel estándar y quién edita | `niveles-de-operacion.md` §2: "Marca propia del cliente… Estándar **0**" y §2 bis: "**el cliente no cambia de marca**… el cliente no edita la marca en v1"; `modelo-de-dominio…` §4: "No incluida en el nivel actual; se utiliza la marca principal". Pero `marca-blanca.md` §1 y §4 (**dueño 2026-11-09**): "nivel 1 (nombre, logo y colores propios **por sucursal**) incluido en el plan sin costo"; `03-experiencia-de-la-carta.md` registro 2026-11-09: "quien gerencia una sucursal cambia su identidad". La tabla de `niveles-de-operacion.md` no se actualizó | `niveles-de-operacion.md` §2, §2 bis; `modelo-de-dominio…` §4; `marca-blanca.md` §1/§4 |
| **C-2** Colores: lista cerrada vs libres | `marcas-productos-y-planes.md` §B.3 ("Nada de CSS libre", 4 tokens `#rrggbb`) y `04-analisis-carta-motor2.md` Q1 ("modelo cerrado de la plataforma… tokens de marca") vs `migracion-de-la-carta…` §12.14 (**dueño 11/11, relayado, no verificado literal**: "colores libres, la marca es por sucursal"; "Reabre y reemplaza la decisión del 13/10 de paletas cerradas solo en el color de marca" y mantiene control de contraste). Además "El dueño: 'había muchos colores configurables, creo que en exceso'. Después: 'para las cartas podrían ser libres, manteniendo el color de marca'" (§12.4 punto 10) — el mismo dueño dice las dos cosas | `marcas-productos-y-planes.md` §B.3; `04-analisis…`; `migracion-de-la-carta…` §12.4, §12.14 |
| **C-2b** Modo oscuro | `01-arquitectura-de-experiencia.md` P4/§4.2 y `02-marca-iconos…` ("sin modo oscuro en v1"; íconos sin variante oscura) vs `04-analisis…` Q1 DECIDIDO: libro con **2 variantes clara y oscura con serifa** vs auditoría: "ninguno de los 8 prototipos define modo oscuro… diseñar el modo oscuro al pasar al sistema real". Cierre parcial: libro = capa propia del sistema | `01-arquitectura-de-experiencia.md`; `04-analisis`; auditoría |
| **C-3** Caracteres permitidos en nombres | P1/P2 (DECIDIDO 5-6/11) y `migracion-de-la-carta…` §2.4 listan `¿ ¡ ? ! % $` como **no permitidos** y la "lista única para lo que se imprime" afecta el PDF de las facturas (P8: "¿se amplía la lista de permitidos (afecta el PDF de las facturas)?"); `carta-real` Q3 (dueño 12/11): permitidos `¿ ¡ ? ! % $` en **nombres** de productos. Falta decidir qué pasa con el PDF fiscal | `decisiones-del-dueno…` 05-06/11; `migracion-de-la-carta…` §2.4, P8; `carta-real` Q3 |
| **C-4** Pasaporte | DDL de `clientes.md` Anexo C: `^[A-Z0-9]{3,20}$` y D-27; el dueño dijo 6-9 (2026-11-06); e9 y `0024_pasaporte_con_letras.sql` (6-9). El anexo DDL del doc "verificado" quedó viejo | `clientes.md` líneas ~960-975; `decisiones-del-dueno…`; e9 §3.1 |
| **C-5** Condición IVA (efectos) | Además de #1: la ficha admite 11 valores pero `comprobante.receptor_documento_numero` solo dígitos hasta 11 (T10) → pasaporte alfanumérico se sugiere "sin identificar"; DNI 87 vs 96 códigos ARCA "discrepancia entre fuentes" (`clientes-y-proveedores.md` A.5) | `clientes.md` T10; CP A.5 |
| **C-6** `se_vende` y carta | `catalogo-y-stock.md` §F8 y C3: la vidriera muestra productos activos con precio, vendibles o no, sin alícuota; `e2-catalogo-minimo` §3.2: alícuota obligatoria solo para `se_vende` pero **ubicar un producto en una sección exige alícuota** (`editar-producto.ts:68`, `producto.ts:119`) → "sin alícuota, la carta no queda visible" (migración carta §3.1); `carta-real` §4.3 punto 4: "no depende de `se_vende`" | `catalogo-y-stock.md`; e2; `migracion-de-la-carta…` §3.1 |
| **C-7** Escalera del catálogo N1/N3 vs decisiones del 9/11 | `catalogo-carta-niveles-y-elecciones.md` (13/10, 26/10): N1 = precio completo por combinación + grupos de precio, máximo dos ejes; N3 = biblioteca de elecciones reutilizables. `e2-catalogo-minimo` §1 y auditoría A1/A2/A3 (dueño 9/11): sin precio por combinación, **una única variante (tamaño)**, grupos propios del producto, 3 tablas menos. e2 §7 lista cuáles mandan; pero el doc de niveles sigue diciendo lo viejo y la perilla `variantes_y_grupos_de_precio` sigue "ASUMIDA" | `catalogo-carta-niveles…` §2.1; e2 §7; auditoría A1-A3 |
| **C-8** Alta de proveedor / parte | `clientes.md` "no reemplaza" pero el DDL de la parte con `idempotencia_alta NOT NULL` y `id` por la base choca con el ayudante de compras (T8); `clientes-y-proveedores.md` §B.6.3 dice "reservas sin FK a `parte`, `customer_id` opaco" y la conciliación §1 decía otra cosa (corrección 9 del 2026-10-12) | CP registro de cambios; `clientes.md` T8 |
| **C-9** Precio por sucursal | `niveles-de-operacion.md` y `escaleras/a-stock-y-catalogo.md` §3: "Precio: nivel 1 un precio por empresa… **'lo demás se paga'**" (dueño 2026-10-12) vs decisión 147 (dueño 9/11): el precio varía por sucursal y e2 lo incluye en el estándar de E2 | `niveles-de-operacion.md` §2; e2 §1 fila 6 |
| **C-10** Stock: momento | Maqueta aprobada del salón dice "al enviar" vs decisión 132 y `niveles-de-operacion.md`: "al cerrar la cuenta" (estándar 2) | auditoría "Dos pantallas se contradicen"; mapa §1 ("5 maquetas aprobadas pero contradicen decisiones posteriores: venta rápida, salón, unir cuentas, escritorio, conteo de stock") |
| **C-11** Un cobro por venta vs por comprobante | `funciones-de-pago.md` decía "un cobro por venta", correcto "un cobro por comprobante"; permiso de cobrar con tres nombres (`ventas.cobrar`, `tickets.cobrar`, `caja.cobrar`) — "correcciones que esto obliga a hacer en los planes" | `niveles-de-operacion.md` §2 bis, correcciones 1-9 |
| **C-12** Anonimizar partes | F4 y D-43 (dueño 2026-10-27, "A": impedimentos mientras haya algo en curso) y `clientes-y-proveedores.md` (casos de uso `anonimizarParte`, `ImpedimentosDeAnonimizacion`, `CopiasDePartes`, trabajo `clientes.parte_anonimizada`) vs DEC-0305 (dueño 2026-11-11 "OK 0305": **no hay acción de anonimizar partes hasta que alguien la pida**; e9 mantiene el estado `ANONIMIZADA` pero sin la acción) y retención "del contador" | `clientes.md` D-5/D-43; e9 §3.1; `decisiones-del-dueno…` |
| **C-13** Combos: centavo sobrante | E8: "mayor resto" (regla de `prorratear`, ADR-006) vs prototipo aprobado "al más caro": difiere 1 o 2 centavos | `decisiones-tomadas-sin-el-dueno…` A17 |
| **C-14** Cifras sobre Motor2 | Reportes: 17 (`prompt-arranque` §2), 26 (`factibilidad` §3.1), 28 (auditoría B16); "112 modelos, 158 migraciones" (auditoría) vs fechas distintas; Motor2 "no tiene caja" (auditoría) vs `prompt-arranque`: "caja, facturación y contabilidad no está implementado, ya diseñado" | varios |
| **C-15** Estado de las primitivas | `primitivas-de-negocio.md` §3 (fechado 2026-10-12) marca Catálogo/Stock/Operaciones/Dinero como "Futuro"; `mapa-de-pantallas` (12/11) dice catálogo, caja, ventas, stock, clientes, compras, salón, comandas en `main` (solo producción/lotes #267 abierto, combos sin código). El catálogo de primitivas no se actualizó | `primitivas-de-negocio.md` §3 vs `mapa-de-pantallas-pedernal.md` §1 |
| **C-16** Regla "Motor2 no se migra" | `prompt-arranque` §2 con nota 11/11 (regla sigue vigente) vs 1.ª fila de `decisiones-del-dueno` 2026-11-11 (sesión padre: "Sí, pasar los datos…") vs el mismo día "por ahora no quiero migrar… Eso lo anotó el agente y no yo". El propio doc marca "NO CONFIRMADA", luego "B, pero no estoy seguro". Estado correcto: **no decidido** | `decisiones-del-dueno…` |
| **C-17** ADR-008 permisivo vs "todo nace cerrado" | ADR-008 (dueño decisión 4): controles por defecto **permitir**, "Pedernal acepta lo que ARCA acepta"; DEC-0026/0027 de caja (cierre con diferencia siempre permitido, egreso sobre efectivo nunca bloquea). Frente a "todo nace cerrado" y "denegar por defecto" (guard) y la carta/QR "falla cerrada". No es una contradicción dura: son dos capas (reglas de negocio = permitir; autorización, datos y exposición pública = cerrado), pero **nunca se escribió una frase que las ordene**; lo más cercano: ADR-008 "Lo que nunca puede ser un control" lista la integridad/autorización y el resto "permitir" | ADR-008; `decisiones-del-dueno…`; `catalogo-y-niveles-maqueta.md` 938 |
| **C-18** Gate | `prompt-arranque` describe el gate de Motor2 con 8 comandos (incl. knip, build consola, e2e) como piso de Pedernal; `ci-desde-el-minuto-1.md` lista 16 checks y dice que mutación/gate de Motor2 son otro nivel; "Estabilidad" solo en ciertos cambios (2026-11-07) | `prompt-arranque` §2; `ci-desde-el-minuto-1.md` |
| **C-19** Carta: orden/Ocultar | `carta-real` rev.1: "agotado/producto solo en un local B"; rev.3: botón Ocultar con dos alcances; premisa del dueño "desactivar ya rechaza con existencia" **falsa** (hoy solo el depósito rechaza). El spec lo corrige (H13) | `carta-real` revisiones 2-3 |
| **C-20** Eje "libro" vs "lista" | `migracion-de-la-carta…` §0.3: "lo aprobado es la Lista; el Libro está 'para después', como extra (tramo C-6)" vs dueño 11/11: "el cliente ya usa el Libro y rechazaría otro modelo" (el Libro entra a la tanda condicionado a la maqueta) | `migracion-de-la-carta…` §0.3, §12 |

Nota de método: las filas C-1..C-20 son lecturas mías de los documentos; la clasificación "contradicción" vs "decisión posterior que pisa a la anterior" es criterio mío cuando el doc no lo dice.

---------------------------------------------------------------------

## 8. COSAS PARA RECORDAR AL USAR ESTO EN EL CONTRASTE CON motor2

1. Pedernal y motor2 comparten el origen de varias reglas (P1/P2 de validación por lista de permitidos, "todo nace cerrado", escalera de diseño de 10 niveles, escalera de producto N0..N4, "poda"/necesidad escrita, "primero lo más barato"). Dentro de Pedernal las reglas están en el `CLAUDE.md` de su ERP (no disponible) y los docs las citan con número de línea (ej.: `ERP:CLAUDE.md:26-37`).
2. Pedernal usa **`parte`** (con `naturaleza`, `nombre`/`apellido`/`alias`, 6 tipos de documento, 11 condiciones de IVA, domicilio AR estructurado o `dom_texto` ≤300, nota ≤2000, roles `CUSTOMER`/`PROVEEDOR`, vínculos `CONTACTO`/`AGENTE_DE`); la comparación de campos con la ficha de motor2 sale directa de §2.2.
3. En el catálogo, las **diferencias que cambian dinero** que más pesan: (a) sin precio por combinación (suma de tamaño + recargo; recargo ≥ 0; sin porcentajes, sin recargo negativo); (b) adicional es opción dentro de la línea, no línea hija; (c) alícuota obligatoria para vender; (d) `se_muestra_en_carta` nace en false; (e) oculto ≠ desactivado, con bloqueo por existencia; (f) precio por sucursal por instante, no por jornada; (g) cero = cortesía vs "sin dato"; (h) carta = caja al centavo (prueba de paridad); (i) costo neto del IVA según condición del emisor.
4. Los números concretos de ADR-006 (80,60 / 26,87-26,87-26,86; 1.950,23 + 309,77 = 2.260,00) son el mejor candidato a "oráculo" para una tabla de combinaciones: redondeo único sobre el total, reparto por restos mayores, IVA por alícuota.
5. Casi todo lo "CONSTRUIDO" es **DOC, NO VERIFICADO contra código**; lo verificable por documentos es solo lo que cada sesión dice haber leído (`ERP:archivo:línea`).
