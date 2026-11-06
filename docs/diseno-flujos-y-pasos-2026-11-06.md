# Diseño en papel: cada columna declara su flujo, su paso y para qué sirve (2026-11-06)

**Estado:** diseño en papel, PROPUESTA salvo donde dice otra cosa. No se implementó nada, no hay migración y no se pagó ninguna deuda. Fuente de partida: `motor2-docs/_estudio/inventario-declaraciones-deuda-y-duplicados-2026-11-06.md` (main `50c11538`). Cada decisión lleva su estado: CONFIRMADA (dicha por el dueño), PROPUESTA, PENDIENTE o NO VERIFICADA.

**Pedido del dueño (2026-11-06):** un dato tiene que declarar para qué existe, de qué es parte y para qué fin. Corrección del mismo día: «el fin es el flujo, como producto. Por ejemplo, ¿cuál es la finalidad del movimiento compra? La finalidad hace que tenga pasos, en los que va requiriendo datos de forma escalonada hasta estar completo.» Además: funciones repetidas, duplicación, deuda con vencimiento, buscar lo no declarado, primitivas, invariantes, arneses.

## 1. Resumen para el dueño

- Cada flujo (por ejemplo, el movimiento de compra) declara su finalidad y sus pasos, que se acumulan.
- Cada columna declara tres cosas: de qué flujo es parte, en qué paso se vuelve necesaria y para qué sirve ese paso.
- Lo que falta de un paso se muestra «pendiente de completar», como en la escalera de producto N0 a N5.
- Quién lee la columna (carta, venta, stock, reportes, auditoría) queda como dato secundario y opcional.
- Un guardián nuevo frena en dos casos: una columna sin flujo y paso, o un flujo cuyos pasos no cubren todas sus columnas.
- La clase que ya existe (dinero, visibilidad, stock o ninguna) sigue igual: responde a otra pregunta, qué combinaciones hay que probar.
- Vencimiento: la regla G1b (responsable, aprobación y 60 días como máximo) se aplica a toda la deuda; una deuda vencida frena el gate.
- Las 168 metas pasadas son: 89 + 31 + 2 + 1 que decían «Fase 6», 23 + 17 + 3 que decían «lote 6.33» y 2 que decían «Fase 2». Se re-fechan, no se pagan.
- Ninguna etapa requiere migración. La más barata para empezar es E1.

## 2. Escalera de diseño, niveles 1 a 5

**Nivel 1, propósito.** Que todo dato declare su flujo, paso y para qué, y que toda deuda tenga vencimiento. CONFIRMADA. No se paga deuda ahora; las 168 cuentan como vencidas: CONFIRMADA. Re-fecharlas: PROPUESTA.

**Nivel 2, actores.** El dueño nombra los flujos de cada módulo y aprueba fechas y renovaciones (único responsable válido hoy: «dueño»): CONFIRMADA. El código lo escribe Sonnet (regla del 2026-11-04): CONFIRMADA. El CI «Gate (requerido)» es el árbitro: CONFIRMADA.

**Nivel 3, casos de uso (PROPUESTA).** Agregar una columna (el gate pide su flujo y paso); declarar un flujo nuevo con sus pasos; mover una columna de paso; renovar una deuda; declarar una primitiva o un invariante.

**Nivel 4, conceptos.**
- **Flujo:** identificador, finalidad escrita, modelos y pasos; cada paso tiene número, nombre y para qué sirve. PROPUESTA.
- **Declaración de la columna:** flujo, paso, para qué y, opcional, quién la lee. PROPUESTA.
- **Salida del flujo** (anulada o retirada): paso lateral, no un peldaño. PROPUESTA.
- **Columnas técnicas** (llaves, `empresaId`, `creadoEn`, `actualizadoEn`): siguen excluidas, como hoy. CONFIRMADA.
- **Qué flujos tiene cada módulo:** PENDIENTE, los nombra el dueño.

**Nivel 5, reglas que hace cumplir el gate (PROPUESTA).**
- R1. Columna de un modelo con flujo y sin flujo y paso declarados: falla.
- R2. Cobertura: todo paso tiene al menos una columna, y toda columna de los modelos del flujo cae en algún paso o en la salida.
- R3. Una columna obligatoria desde que nace la fila (NOT NULL sin valor por defecto) tiene que ser del paso 1. NO VERIFICADO que el lector actual del esquema distinga el valor por defecto.
- R4. Toda deuda tiene fecha (máximo 60 días). Vencida, falla; a 14 días, avisa. Se reusa `evaluarVencimientos` de `test/arquitectura/contratos/politica.ts`.
- R5. Renovar exige motivo y aprobación («PR #n» o «DEC-nn»); más de 2 renovaciones se avisa. CONFIRMADA (G1b).
- Combinaciones: ningún guardián nuevo cambia dinero, permisos, visibilidad ni stock. Cada flujo apunta al oráculo que ya tiene; si un flujo de dinero o stock no tiene oráculo, queda como deuda con fecha en el registro de arneses.

## 3. Flujos como escalera, con ejemplos reales (PROPUESTA)

### Flujo «compra de mercadería»
**Finalidad:** dejar registrado que entró mercadería de un proveedor, para tener stock y costo y poder pagarla. Modelo real: `FacturaProveedor` (estado `PENDIENTE_DE_REPARTO` o `CONFIRMADA`) y Pagos X0.

| Paso | Qué se completa | Columnas | Para qué |
|---|---|---|---|
| P1 Cargada | El comprobante | `proveedorId`, `fecha`, `importeTotal`, `nroFactura`, `letra`, `nroFacturaNormalizado`, `fechaComprobante`, `condicionIvaEmpresa`, `importeNeto`, `importeIva`, `origen`, `detalleLibre`, `claveIdempotencia`, `payloadHash` | Saber qué se debe y a quién, sin cargarlo dos veces |
| P2 Repartida y confirmada | El reparto | Renglones, partes por sucursal, `estado` = CONFIRMADA, `confirmadaEn`, `confirmadaPorId` | La mercadería entra al stock y el costo queda en cada sucursal |
| P3 Recibida en administración | La recepción | `recibidaEnAdministracionEn` | Saber que el papel llegó para pagar |
| P4 Pagada | El pago | `condicionPago`, `PagoDeFacturaProveedor.fechaPago`, `.medio` | Saldar la deuda con el proveedor |
| Salida: anulada | — | `anuladaEn`, `anuladaPorId` | Sacarla del stock y de la deuda |

Hallazgo: `fechaPagoDeclarada` y `medioPagoDeclarado` no tienen uso en `src/` (`docs/diseno-pagos-y-conciliacion-2026-11-03.md` §4); la regla R2 las obliga a caer en un paso o a quedar como candidatas a poda. Conciliación y retenciones serían un P5; hoy no existen (PENDIENTE).

### Flujo «producto vendible» (catálogo hasta la carta)
| Paso | Qué se completa | Columnas (ejemplos) | Para qué |
|---|---|---|---|
| V1 Existe | El producto | `Producto.nombre`, `tipo` | Darlo de alta |
| V2 Tiene precio | El precio | `Producto.precioVenta`, `alicuotaIvaVenta` | Que se pueda cobrar y facturar |
| V3 Está en la sucursal | La disponibilidad | `DisponibilidadProducto.disponible`, precio local | Que se pueda vender en esa sucursal |
| V4 Está en la carta | Su lugar en la carta | `ContenidoCartaProducto.visibleEnCarta`, `seccionCartaId`, `nombreEnCarta`, `descripcion`, `orden` | Que el cliente lo vea y lo pida |

- `ContenidoCartaProducto.nombreEnCarta`: producto vendible, paso V4; es opcional (vacío = nombre interno).
- `Producto.precioVenta`: paso V2; lo que paga el cliente, con IVA.
- `Producto.alicuotaIvaVenta`: paso V2. Hallazgo del inventario: nadie la escribe, así que V2 nunca puede quedar completo; la escalera lo deja a la vista.
- `CuentaItem.nombreEnTicket` no es del producto: pertenece a otro flujo, «cuenta del salón» (PENDIENTE de que el dueño lo nombre), en el paso «línea agregada» (el nombre se congela al agregar la línea). Discrepancia comprobada: el esquema dice que los reportes no la leen, pero `src/server/consultas/reportes/tickets-emitidos.ts:76,99` la lee para reimprimir el ticket «como se imprimió».

## 4. Etapas chicas y reversibles, en orden

Ninguna requiere migración. Requiere autorización expresa: ninguna.

- **E0 «Flujos en papel».** Este documento más la lista de flujos por módulo para que el dueño los nombre.
- **E1 «Producto vendible declarado»** (la más barata). `test/arquitectura/guardas/flujos.ts` (registro de flujos y declaraciones por columna), `flujos-declarados.test.ts` (R1 a R3), solo `Producto`, `DisponibilidadProducto` y `ContenidoCartaProducto`. Reusa `columnas-del-esquema.ts` y `cercos/trinquete.ts`. Las columnas sin certeza quedan en una lista de deuda nueva con fecha. Unos 3 archivos.
- **E2 «Compra declarada».** Los modelos de la compra y su pago, pasos P1 a P4. 1 o 2 archivos.
- **E3 «Resto de la cadena hasta la carta».** Los otros 28 modelos de los 31. Depende de que el dueño nombre los flujos (opciones de venta, promo de carta, cuenta del salón…): PENDIENTE.
- **E4 «Vencimiento en los cercos».** Cada lista de deuda suma «vence» y «dónde se resuelve» (hito concreto, no «Fase 6»). Las 13 listas con entradas se re-fechan, escalonadas (por ejemplo una por semana desde el 2026-12-04 hasta el 2027-01-05). Unos 30 archivos, cambios mecánicos (las 15 listas se regeneran con `BAJAR_CERCOS=1`).
- **E5 «Primitivas declaradas».** Registro `guardas/primitivas.ts`: `nombreDeCarta` (4 copias) y `repartirImporte` (2 copias) pasan a contratos con cada copia como deuda con fecha; el formato de dinero (143 usos) y los redondeos sueltos se cuentan en una lista de deuda con fecha; el normalizador de nombres y «hoy» con la zona de la empresa quedan «sin fuente única, PENDIENTE» con fecha; se amplía `reportes-compras-anuladas.test.ts` a `src/server/consultas/reportes`. Unos 8 archivos.
- **E6 «Registro de invariantes y arneses».** `guardas/invariantes.ts`: cada invariante con su test (archivo más marca `[INV:id]` en el título), o deuda con fecha, o «solo en papel» (por ejemplo C1 a C37 de caja). Los arneses que faltan van como deuda.
- **E7 «Resto de la deuda con fecha».** 35 cruces, 5 consultas sin tope, 4 interruptores apagados y 1 permiso reservado.

### ¿Qué pasa si…? (E1, E2, E4, E5 y E6)
| Situación | Qué pasa |
|---|---|
| Repetición o reintento | Solo leen archivos: mismo resultado; excepción: cruzar la medianoche UTC el día que algo vence. |
| Concurrencia | Dos ramas que tocan la misma lista de deuda dan conflicto en git; se regenera y queda la cuenta más baja. |
| Tiempo | Una deuda que vence frena el gate sin cambiar código: es lo buscado; aviso a 14 días y fechas escalonadas. |
| Incertidumbre | Si no se sabe el paso de una columna no se inventa: deuda con fecha y pregunta al dueño. |
| Error parcial | Si se renombra una columna o se borra un paso, la declaración huérfana falla. |
| Datos faltantes | Un modelo sin flujo declarado no se mira; lo cubre `clasificacion-de-tablas.ts`. |
| Cambio de permisos | Solo «dueño» renueva, con aprobación verificable. |

## 5. Riesgos y qué podría frenar el gate
- E4 vuelve el gate sensible a la fecha: una renovación olvidada deja el CI en rojo ese día.
- Al sumar «vence», todas las listas de deuda cambian de formato: se regeneran en el mismo PR.
- Cada contrato nuevo de E5 necesita su aprobación registrada.
- R3 depende de que el lector del esquema vea el valor por defecto; si no, primero hay que ampliarlo (1 archivo).
- Una columna que sirve a dos flujos (por ejemplo `Producto.alicuotaIvaCompra`): la declaración es por columna, no por modelo.

## 6. Verificación final obligatoria
Antes de E1, anotar el conteo de tests de `npx vitest run` en main. Después de cada etapa, en una sola corrida y todos limpios: `npx tsc --noEmit`, `npm run lint`, `npm run arquitectura`, `npm run analizar:muerto` (cero hallazgos), `npm test`, `npm run build`, `npm run plataforma:build`, `npm run test:e2e`; además `npm run auditar:dependencias` y `npx vitest run test/arquitectura`. Criterio: los ocho en verde y «Gate (requerido)» en verde en GitHub; conteo de tests igual o mayor más los nuevos; ninguna lista de deuda sube; y prueba en rojo a propósito (sin guardarla): columna nueva sin flujo y paso, paso sin columnas y fecha de ayer deben frenar el gate con un mensaje que diga cómo arreglarlo.

## 7. Preguntas abiertas y no verificado
- **PENDIENTE (dueño):** qué flujos tiene cada módulo, empezando por la cadena hasta la carta. ¿Alcanzan «producto vendible», «opción de venta», «promo de carta» y «cuenta del salón»?
- **PENDIENTE (dueño, para E4):** ¿las 168 se re-fechan con el tope de 60 días de G1b (propuesta) o con plazos más largos por hito?
- **NO VERIFICADO:** los conteos del inventario (31 modelos, 139 columnas, 46 declaradas, 19 de deuda, 74 ciegas); que la Fase 6 esté cerrada; que el lector del esquema distinga el valor por defecto; si leer `nombreEnTicket` en reportes es la reimpresión (F2) o un uso nuevo; que no haya lectores por SQL crudo.
