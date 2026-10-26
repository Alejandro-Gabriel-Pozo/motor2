# Validación del borrador «Features faltantes de motor2» contra el código (2026-10-26)

Estado: **borrador a validar, no definitivo** (aclaración del dueño: el plan es modificable). Se verificó contra el código de `main` en `8d9d4930` (solo lectura). El estado de la base real sale de `docs/deploy-con-migraciones.md`, no de una consulta.

## Concepto nuevo del dueño: cliente–empresa «como agente» (F17, no está en el borrador)
Una persona física consume esta vez como agente de una empresa: consume la persona, se imputa y factura a la empresa. Feature de POS: «sacar por POS» a nombre de ese agente/empresa.
- Hoy: `Cuenta.clienteId` y el snapshot `descuentoPorcentaje`; el cierre copia el cliente a cada `Operacion`; el cliente se elige en la mesa antes de cerrar (`asignarClienteACuenta`, permiso `pos_asignar_cliente`, nivel operario). `Cliente` solo tiene nombre, descuento y activo: no hay tipo persona/empresa, documento ni vínculo entre clientes.
- Faltaría: `Cliente.tipo`, documento y condición de IVA; relación agente–empresa con vigencia; en la cuenta, quién consumió y a quién se imputa (hoy `clienteId` mezcla «a quién se descuenta» con «a quién se factura»).
- Enganche sin tocar el cierre: campos nuevos opcionales en `Cuenta` y una acción hermana de `asignarClienteACuenta`, siempre antes de cerrar (asignar dentro de `cerrarCuenta` rompería la idempotencia: el reintento devuelve «ya cerrada» y ignora el cambio).
- Riesgos: autorización del agente (un operario no debería imputar a una empresa ajena: clave propia de piso administrador); tope de crédito (advertir, no bloquear: hoy «la mesa ya comió»); aislamiento entre empresas clientes (no hay RLS: solo filtros de la aplicación); `Cliente.nombre` es único por empresa.

### Aclaración del dueño (2026-10-26, segunda): F17 es un CONVENIO, no solo una imputación
- Lo que quiere el dueño: que a un agente/empresa **solo se le pueda generar ticket de lo pactado**, por ejemplo el menú ejecutivo. Es una restricción de qué se puede vender en el POS a ese cliente, no solo a quién se imputa.
- Peldaños propuestos (escalera de producto, acumulativos; a validar): **N0** cliente con % de descuento (ya existe: es lo más básico); **N1** convenio con lista de ofertas permitidas (solo menú ejecutivo); **N2** precio pactado propio del convenio; **N3** persona–empresa como agente (consume uno, se imputa a la otra); **N4** tope de crédito y cuenta corriente.
- El cierre de cuenta no recibe cliente: el cliente se asigna a la cuenta abierta antes de cerrar (hoy solo con % de descuento). El convenio se aplicaría en ese mismo momento, al asignar el cliente, antes de cargar ítems.
- Preguntas de producto (una por vez, con recomendación): ¿el convenio es exclusivo (solo puede pedir eso) o es un descuento sobre cualquier cosa?; ¿precio pactado o % de descuento?; ¿límite de un menú por agente por día?; ¿quién autoriza que alguien sea agente de la empresa?
- Base existente para el menú ejecutivo: promociones/combos de la carta (`PromoCarta`, ADR-032 y el rediseño del menú del día, GO-3d, pendiente en `docs/pendientes-sesion-2026-10-22.md`).

### Aclaración del dueño (2026-10-26, tercera): precio, descuento y agentes son configuraciones separadas
- **Precio del convenio.** Hay dos formas, independientes: (a) el convenio da acceso a una OFERTA armada (p. ej. menú ejecutivo) y el precio es el de esa oferta, y fin; (b) el convenio da acceso a PRODUCTOS elegidos de la carta, a su precio de carta. Un descuento sobre (b) es OTRA configuración, aparte.
- **Descuento sin identificar vs identificado.** «Consumidor final con 15 % por residente» es un descuento por CATEGORÍA, sin nombre ni documento (no se identifica a la persona). «Descuento a empleados» es un descuento IDENTIFICADO, con nombre. Son dos tipos de descuento distintos; hoy solo existe el segundo (`Cliente.descuentoPorcentaje`, con nombre).
- **Agentes en la configuración de la empresa.** Los agentes se administran desde la ficha de la empresa cliente. Atajo desde esa ficha (y desde el POS): crear el agente si no existe, o VINCULAR a un agente existente si ya estaba cargado como consumidor final identificado.
- Supuestos mientras no se confirmen: (1) un ticket lleva UN solo beneficio (convenio o descuento), sin acumular; (2) todo descuento aplicado deja registrado su concepto (residente, empleado, convenio de X) aunque la persona no se identifique, para reportes y control; (3) aplicar un descuento por categoría sin identificar exige un permiso propio, porque es la vía más fácil de abusar (decirlo y que se aplique).
- Preguntas que quedan abiertas (cuando se llegue a ese módulo): ¿se pueden acumular beneficios?; ¿quién puede aplicar el descuento de residente sin identificar?; ¿se pide algún dato mínimo (tipo de documento) para el residente?

## Hallazgos transversales
1. «Ticket» = `Cuenta` cerrada con venta. Los ejemplares (`EjemplarTicket`) son el papel impreso: «566-A» y «566-B» son dos ejemplares del mismo número. El importe no se guarda: se deriva de las líneas no anuladas.
2. `cerrarCuenta` NO cobra (decisión B5, `docs/plan-tomar-pedido-2026-09-25.md`): no hay caja, pago ni medio de pago. «Ticket no cobrado» es vacío hoy.
3. «Empresa» en el repo es el tenant (ADR-001). Una empresa cliente de la hostería es un `Cliente`.
4. Existen tablas que nadie escribe todavía (Etapa C): `Venta`, `FacturaProveedor*`, `NotaCreditoProveedor*`, `ImputacionDeGasto`, `PlanDeCostos`, `CentroDeCostos`.
5. El borrador cita mal el ADR-008: los defaults son restrictivos (fail-closed), no permisivos.

## Estado por ítem
- **Ya existe o parcial:** F1 alcance por sucursal (`UsuarioSucursal`, RLS por sucursal, ADR-028; falta el cliente por sucursal y el rango «encargado»); F4 descuento simple; F7 parcial (cliente y sucursal en la cuenta, ejemplar vigente derivado); F8 parcial (asignar cliente a cuenta abierta con auditoría; no se puede cambiar en cuenta cerrada); F15 parcial (`CentroDeCostos`, ADR-031).
- **Falta:** F2 letras y puntos de venta propios; F3 documento/CUIT, cuenta corriente y «consumidor final» (hoy `clienteId = null` significa «sin cliente»); F5 factura externa (`Operacion.nroFactura` es texto libre); F6, F9 a F14 (composición, reservas, señas, medios de pago, caja diaria); F16 compras por unidad.
- **Contradice lo construido:** F15 códigos «21», «41» no pasan el CHECK actual (`^[A-Z][A-Z0-9_]{0,39}$`); F16 la mercadería queda fuera de la distribución por unidad (ADR-031); estados de ticket abierto/pendiente/aplicado/cobrado (la cuenta solo tiene abierta o cerrada).
- **Solapan tablas existentes:** `NivelModulo`, `ConfiguracionNivelEmpresa` y `PoliticaEmpresa` duplican `ModuloEmpresa`, las columnas de `Empresa` y los planes del ADR-013; `UnidadNegocio` duplica `CentroDeCostos`; `ReglaAplicacion` contradice la práctica del repo (cada regla se declara una vez en código) y el propio §15 del borrador.
- Los ejemplos de DNI/CUIT del borrador no pasan `validarCuit` (dígito verificador).

## Contradicciones internas del borrador
1. Tres modelos de aplicación de un ticket (`ticket.facturaAplicadaId`, `estado = APLICADO`, tabla `AplicacionTicket`); además `AplicacionTicket.importe` sugiere aplicación parcial, que choca con «un ticket no se aplica dos veces».
2. Unicidad de factura por sucursal+letra+PV+número: el comprobante fiscal se identifica por emisor (CUIT) + tipo de comprobante + punto de venta + número; la letra la determina el tipo.
3. `saldoResultante` como columna: el repo deriva los saldos (`SUM`); una columna obliga a serializar por cliente.
4. Obligatoriedad (F6: restante = 0) contra niveles permisivos N0/N1 (§5.1) y «permisivo por defecto» (§4.2).
5. Dos listas de niveles de compras (§4.1 y §5.5).
6. Dos mecanismos de reglas (`TipoConceptoFactura.requiere*` y `ReglaAplicacion`).
7. Dinero sin tipo ni moneda ni IVA en todos los importes (la base usa `Decimal(14,2)` sin columna de moneda).

## Las 5 preguntas de diseño que más cambian el modelo (con recomendación)
1. **¿Todo ticket se factura y dónde vive «cobrado»?** Recomendación: unidad facturable = cuenta cerrada con venta vigente; la aplicación vive en una tabla `AplicacionTicket` con único parcial por ticket activo; «pendiente de facturar» se deriva; «cobrado» sale de los pagos de la factura, nunca del ticket; estado explícito «no se factura» para el consumidor que paga en el acto.
2. **Persona vs empresa y el agente (F17).** `Cliente.tipo`, documento separado (CUIT/CUIL/DNI), condición de IVA, relación agente–empresa con vigencia; en `Cuenta`, consumidor + imputado.
3. **Emisor y comprobante.** Clave única `(empresa, tipo de comprobante, punto de venta, número)` parcial sobre no anuladas; definir notas de crédito/débito externas y el IVA; varios CUIT implican varias empresas.
4. **Saldo y cuenta corriente.** Saldo derivado, nunca columna; pagos aplicados a facturas o saldo global; tope de crédito que advierte y no bloquea; señas como crédito a favor; `Decimal(14,2)` en la moneda de la empresa.
5. **Alcance de clientes y permisos.** Mantener `Cliente` de toda la empresa y aislar por permisos y consultas (`ClienteSucursal` obliga a una familia nueva «sin fila», ADR-009); clave nueva de piso administrador para autorizar agentes; no crear tablas de niveles hasta que un segundo módulo las necesite.
Quedan para después: reservas (módulo propio vs referencia externa: existe un repo separado `reservations-api`) y los niveles de compras N0 a N4.

## Regla de trabajo
Nada de esto se construye hasta cerrar los niveles 1 a 5 de la escalera de diseño de cada módulo (propósito, actores, casos de uso, ciclo de vida, invariantes y políticas), con las preguntas de arriba contestadas por el dueño.
