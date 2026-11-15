# Diseño: notas de crédito de proveedor (2026-11-04)

Estado del documento: **PROPUESTA para el dueño**. Sin código, sin migración. Lo contado del código se verificó leyendo la rama `alegp/carta-b-e1` (sobre `main` del 2026-11-04), `origin/alegp/compras-etapa-1` y `origin/alegp/diseno-pagos-y-conciliacion`, y la copia local de `motor2-docs` (último commit `2af58d6`, de alrededor del 2026-10-09). El diseño lo preparó un agente de planificación (Opus); no se corrió ningún test.

## 0. Resumen para el dueño

- **Las tablas existen, están aplicadas en producción y casi nada las lee.** Las cuatro tablas, sus reglas, la seguridad por empresa y por sucursal y los tres permisos se aplicaron el 2026-10-13. El único código que las lee impide anular una factura que tiene notas vigentes. No hay pantalla ni caso de uso que cargue una nota.
- **No hace falta crear tablas.** La forma más barata de empezar (**NC0**) no necesita migración de esquema. Como mucho, un relleno de permisos condicional (§4).
- **Hallazgo que cambia el alcance.** Hoy solo la compra **repartida** entre sucursales crea una factura como documento (`FacturaProveedor`). La compra simple de una sucursal sigue siendo un movimiento con el número de factura en texto. Por eso una nota «sobre la factura» solo se puede enganchar a facturas repartidas; para el resto la nota va **suelta** (el dueño ya lo previó en octubre, D4: «las compras sin factura se cargan como nota suelta hasta que haga falta modelarlas»).
- **NC0 = nota de crédito «solo dinero»:** sobre una factura documento o suelta, de mercadería, con el total con IVA incluido; con tope, anulación y lista. **No toca stock, costo vigente, pagos ni los reportes que ya existen.** La devolución física vinculada, los reportes netos, las notas sobre gastos y la aplicación a pagos quedan como etapas posteriores con nombre (§3).

## 1. Inventario de lo que ya existe

### 1a. Las tablas `NotaCreditoProveedor*`

Migraciones `20261018100000_nota_credito_proveedor` (M6.1), `20261018101000_rls_sucursal_nota_credito_proveedor_imputacion` (M6.2), `20261018102000_anulacion_coherente_admite_devolucion` (M6.3) y `20261018103000_permisos_notas_de_credito` (M6.4). Modelos en `prisma/schema.prisma` desde la línea ~3190.

- **`NotaCreditoProveedor` (cabecera, de la empresa).** `tipo` `SOBRE_FACTURA` o `SUELTA` (con CHECK que lo liga a `facturaProveedorId`); número (`nroComprobante`, `nroComprobanteNormalizado`, `letra` opcional A/B/C/E/M/X); `fecha` (manda el período) y `fechaComprobante` (dato); `importeTotal` > 0, `importeNeto` e `importeIva` opcionales y juntos; `motivo` obligatorio (hasta 200); `estado` (CHECK solo `CONFIRMADA`) y `origen` (CHECK solo `CARGA`); `claveIdempotencia` única global, `payloadHash`, `resultadoMensaje`; quién y cuándo (`creadoPorId`, `creadoEn`); anulación (`anuladaEn`, `anuladaPorId`, `motivoAnulacion`, las tres juntas por CHECK). Número único entre las vigentes: índice parcial `NotaCreditoProveedor_unica_vigente_key` sobre (empresa, proveedor, `COALESCE(letra,'')`, número normalizado) `WHERE anuladaEn IS NULL`: anular libera el número. FK de tres columnas (empresa, factura, proveedor): la nota es del mismo proveedor que su factura.
- **`NotaCreditoProveedorLinea`.** Cada línea acredita exactamente un renglón de **su** factura (FK de tres columnas). `origenImporte`: `RENGLON` o `REPARTO_DEL_TOTAL` si es sobre factura; `SIN_FACTURA` si es suelta. `naturaleza`: `MERCADERIA` o `SIN_STOCK`. `admiteDevolucion` solo sobre factura y de mercadería. Importes: `importe` > 0, neto + IVA = importe. `orden` único por nota.
- **`NotaCreditoProveedorImputacion` (propia de la sucursal).** `sucursalId` obligatorio, una fila por (línea, sucursal); `importe`, `importeIvaComputable`; `cantidadStock` y `operacionDevolucionId` juntos y solo en líneas que admiten devolución; índice único por `operacionDevolucionId` (una devolución se acredita una sola vez).
- **`NotaCreditoProveedorTributo`.** Percepciones e impuestos (CHECK de tipo e importe > 0). Sin uso hasta NC3.
- **Seguridad de filas (RLS).** Las cuatro tienen aislamiento por empresa; la imputación suma cuatro políticas restrictivas por sucursal (M6.2): sin alcance en la transacción no se ve ni se escribe nada.
- **Privilegios de la app.** SELECT e INSERT en las cuatro; nunca DELETE; UPDATE solo por columna y solo en la cabecera (`anuladaEn`, `anuladaPorId`, `motivoAnulacion`, `recibidaEnAdministracionEn`). `motor2_plataforma` no tiene nada.
- **`down.sql`.** El de M6.1 aborta si hay filas; el de M6.4 aborta si alguien configuró a mano las claves; el de M6.3 aborta si ya hay una devolución anulada.
- **Lo que la base NO impone** y queda para el caso de uso (ADR-029 §12, D5): topes por renglón, por sucursal, por cantidad y por factura; que Σ líneas + Σ tributos = total y Σ imputaciones = importe de la línea; que la fecha de la nota sea ≥ la de la factura; que la factura no esté anulada.
- **Estado de aplicación.** Aplicadas a la base de empresab el 2026-10-13 (`docs/deploy-con-migraciones.md`) y verificado «149 migraciones, 0 pendientes» el 2026-11-03. **NO VERIFICADO** en zuluhub. **Contradicción documental:** `docs/adr/ADR-029-...md` §12 dice «NO están aplicadas a ninguna base real», pero su encabezado y el runbook dicen que sí: hay que corregir §12.
- **Quién las lee hoy.** Solo `tieneNotasDeCreditoVigentes` (`src/server/persistencia/compras/cargar-factura-proveedor.ts`), usada por `anular-factura-proveedor.ts` (regla C29: `CON_NOTAS_DE_CREDITO`). No hay escritor.
- **Ya preparado en pruebas y guardianes.** `test/setup/nota-credito.ts` (protocolo del candado: `bloquearFactura`, `acreditadoDelRenglon`, `cargarNotaConTope`); `test/persistencia/nota-credito-proveedor-concurrencia.test.ts` (con candado, 8 clientes que cargan 60 sobre 200 dejan exactamente 3 notas; sin candado acredita 240); tests de dinero, migración y RLS. Los tres permisos están en la base pero **fuera de `ACCIONES`** (`test/setup/claves-reservadas-en-base.ts`). Los importes son campos sensibles con piso administrador. Líneas, imputaciones y tributos están en el guardián «solo agrega».

### 1b. Devolución a proveedor hoy

- Proceso `devolucion-proveedor` del panel genérico de Movimientos (permiso `proceso_devolucion_proveedor`, piso operario). Resta stock y pide proveedor y «N.º de factura» en texto.
- **No escribe `MovimientoStock.devuelveAMovimientoId`** (la columna existe y nada la escribe): la devolución no sabe de qué compra sale, no hay tope de cantidad. **No se puede anular** desde la app aunque M6.3 ya lo permite en la base.
- No toca el costo vigente (la regla V-T1 solo toma `COMPRA` y `TRANSFERENCIA_ENTRADA_SUCURSAL`).
- `totalGastado` y el ratio compras/ventas cuentan solo COMPRA vigente e ignoran devoluciones; el reporte de devoluciones valoriza al costo de **hoy** y no filtra anuladas.
- Conclusión: la devolución es un movimiento de stock y la nota es un documento de dinero; se pueden vincular. Coincide con el plan del dueño («la nota crea o vincula su devolución»).

### 1c. Facturas, pagos y decisiones del dueño

- La factura como documento solo la crea la compra repartida. La compra simple **no** crea cabecera (la etapa E3b, que lo haría, no está construida).
- Número único de la factura: índice `FacturaProveedor_unica_vigente_key` (empresa, proveedor, letra, número normalizado).
- Pagos: `FacturaProveedor.condicionPago` solo admite `CONTADO_PAGADA` hoy. X0 («pendiente de pago», «Declarar pago») está solo en papel. X3 dice: «cuando se implemente la NC, usar el modelo existente (`SOBRE_FACTURA` y `SUELTA`); no crear otro».
- Decisiones del dueño (`motor2-docs/_planes/plan-documento-comercial-compras-y-ventas.md` §4.1, confirmadas el 2026-10-06): nota sin factura sí, solo dinero; bonificación proporcional entre todos los renglones; la nota acredita exactamente lo devuelto; nota mal cargada anulable entera; costo de la bonificación = solo gasto (el costo de reposición no cambia); saldo a favor: aplicar y reintegrar; aviso de duplicado que no bloquea (7 días, en toda la empresa); la nota nunca edita la factura; una factura por nota; el tope rechaza. Requisito: dejar abierto el camino «por pasos» al estilo Odoo.
- ARCA (fuente oficial **NO VERIFICADA**): una factura con CAE se corrige con una nota de crédito o débito asociada, que es un documento del proveedor; distinto de un error de carga nuestro (anulación o corrección).

## 2. Diseño por niveles

### Nivel 1. Propósito y alcance

- **Necesidad (CONFIRMADA):** el dueño, 2026-11-04: «que se pueda cargar notas de crédito de proveedor; las tablas existen pero nada escribe en ellas». Antecedentes: decisión #3 del 2026-10-05 y plan de documento comercial del 2026-10-06.
- **Propósito (PROPUESTA):** registrar el documento con que un proveedor le acredita dinero a la empresa y dejar trazado cuánto queda acreditable de cada factura. El error de carga **nuestro** no es una nota: se anula la factura o, a futuro, se corrige con ejemplares.
- **Dentro de NC0 (PROPUESTA):** nota de mercadería sobre factura documento (parcial o total); nota suelta de mercadería; anularla; verla.
- **Fuera de NC0 (PROPUESTA):** devolución física vinculada (NC1); reportes netos (NC2); notas sobre gastos (NC3, el módulo `gastos` no tiene código); IVA desglosado y percepciones; aplicación a pagos (NC4); nota de débito (nadie la pidió: poda).

### Nivel 2. Actores y contexto

| Actor | Qué hace | Permiso | Estado |
|---|---|---|---|
| Administrador de la sucursal | Carga y anula notas | `nota_credito_proveedor`, `anular_nota_credito_proveedor` (sucursal, piso administrador, semilla `admin`) | CONFIRMADA (D3) |
| Administrador en factura repartida | Igual, con permiso en **cada sucursal imputada** | Igual que la anulación de factura | PROPUESTA |
| Operario | Sigue con devoluciones físicas; no ve importes de notas | `proceso_devolucion_proveedor` | HOY |

Contexto: pesos argentinos, hora argentina, varias empresas y sucursales; sin cierre de períodos todavía.

### Nivel 3. Casos de uso

| CU | Caso | Etapa | Estado |
|---|---|---|---|
| CU1 | Nota sobre factura por renglón | NC0 | PROPUESTA |
| CU2 | Nota sobre factura «sobre el total»: línea `REPARTO_DEL_TOTAL` por renglón, proporcional a su `precioTotal` | NC0 | regla CONFIRMADA; forma PROPUESTA |
| CU3 | Nota suelta: líneas `SIN_FACTURA` de mercadería, imputadas a una sucursal declarada; el número de la factura afectada va en el motivo | NC0 | «nota sin factura» CONFIRMADA; número en el motivo CONFIRMADA (2026-11-04) |
| CU4 | Anular una nota entera, con motivo; libera su número | NC0 | CONFIRMADA |
| CU5 | Ver notas por proveedor y mes, y en cada factura «Acreditado $X · Queda $Y» | NC0 | PROPUESTA |
| CU6 | Nota con devolución: crear o vincular la devolución; la cantidad no supera lo comprado | NC1 | regla CONFIRMADA; etapa PROPUESTA |
| CU7 | Anular una nota con devolución revierte la devolución (M6.3) | NC1 | CONFIRMADA |
| CU8 | Gasto neto de notas en reportes y ratio | NC2 | PENDIENTE (pregunta 2) |
| CU9 | Nota sobre gastos (`gasto_nota_credito`) | NC3 | después de E4 |
| CU10 | Aplicar la nota a un pago o reintegro | NC4 | «las dos» CONFIRMADO; etapa depende de X3 |

### Nivel 4. Conceptos y ciclo de vida

- **Nota:** se carga ya `CONFIRMADA` (la única opción del CHECK). Puede pasar a anulada. Ciclo de dos estados, con ampliación aditiva del CHECK prevista para el flujo por pasos.
- **Saldo acreditable (calculado, nunca guardado):** por factura = `importeTotal` − Σ de sus notas vigentes; por renglón = `precioTotal` − Σ importe de las líneas vigentes; por (renglón, sucursal) = lo que costó esa parte − lo imputado vigente.
- **Una nota es dinero.** Con devolución de stock: nota + devolución vinculada (NC1). Ajuste de precio sin stock: NC0. Nota global sin renglones: `REPARTO_DEL_TOTAL` o línea suelta.
- **Número:** separado del de las facturas (tabla e índice propios; **NO VERIFICADO** en fuente oficial que ARCA lo numere aparte). Se escribe con el canónico de compras etapa 1: letra + punto de venta de 5 + número de 8.

### Nivel 5. Invariantes y políticas

| # | Regla | Estado |
|---|---|---|
| N1 | Dinero `DECIMAL(14,2)`; se reparte en centavos con `repartirImporte` (mayor residuo, orden determinista); el último toma el resto exacto; los topes se comparan en SQL con numeric, nunca en float | CONFIRMADA |
| N2 | Moneda única, la de la empresa | CONFIRMADA |
| N3 | Total = Σ líneas (sin tributos en NC0); Σ imputaciones de cada línea = su importe | CONFIRMADA |
| N4 | Topes que **rechazan**: por renglón, por (renglón, sucursal) y por factura; una nota total es válida (llega a 0) | CONFIRMADA |
| N5 | Número único entre las notas vigentes de (empresa, proveedor, letra, número normalizado). La letra va siempre en `letra` **y** el normalizado sale del mismo `normalizarNumeroDeComprobante` sobre el canónico; un único constructor para todos los escritores (si no, «A» + «A:1-77» y «» + «A:1-77» no chocan) | PROPUESTA (riesgo real detectado) |
| N6 | Idempotencia I3: clave obligatoria + huella; misma clave y contenido = mismo mensaje; otro contenido = conflicto | CONFIRMADA |
| N7 | Fecha de la nota ≥ fecha de la factura y ≤ hoy (hora argentina); cuenta en el mes de la **nota** (NC2) | ≥ factura CONFIRMADA; ≤ hoy PROPUESTA; mes de la nota CONFIRMADA (2026-11-04, pregunta 2) |
| N8 | No se carga nota sobre una factura anulada | CONFIRMADA |
| N9 | No se carga nota sobre una factura con propuestas de reparto sin aceptar | PROPUESTA |
| N10 | No se anula una factura con notas vigentes (C29, ya en código) | CONFIRMADA |
| N11 | La nota nunca edita la factura; no mueve stock ni costo vigente; en NC0 no toca pagos | CONFIRMADA |
| N12 | La nota suelta exige que el usuario declare la sucursal (fallo cerrado); en NC0, una sola | fallo cerrado CONFIRMADA; una sola PROPUESTA |
| N13 | Nota sobre factura repartida: imputación por sucursal proporcional a lo que le costó a cada parte (calculada); permiso en cada sucursal con parte | CONFIRMADA (2026-11-04, pregunta 3: reparto automático y proporcional, con vista previa) |
| N14 | Trazabilidad: quién/cuándo/motivo en la propia nota + `registrarCambioAuditado` en la misma transacción; nada se borra | CONFIRMADA |
| N15 | Aislamiento por RLS de empresa; la imputación solo con alcance de escritura en su sucursal; importes con piso administrador | CONFIRMADA |
| N16 | **Cada nota se aplica a una factura (nivel documento) y el dinero se cruza aparte (nivel conciliación).** Para conciliar, una nota siempre cancela (total o parcialmente) una factura concreta: la «factura afectada». Pero el flujo de dinero no tiene que coincidir con ese vínculo: se puede haber pagado de más la factura 124 por la nota 25 y pagar de menos la 125, descontando la nota 25 del saldo a pagar. El saldo de **cada factura** se calcula con sus propias notas (N4); el neteo entre facturas ocurre solo en el pago, en la relación N a N de `diseno-pagos-y-conciliacion-2026-11-03.md` (I1 e I10). La nota nunca se «mueve» a otra factura para que cierre el dinero. | CONFIRMADA (dueño, 2026-11-04) |
| N16 | Aviso de posible duplicado (mismo proveedor e importe a ±7 días, en toda la empresa); no bloquea y nombra la sucursal | CONFIRMADA (2026-10-06); en NC0 PROPUESTA |

**Escalera de producto:** N0 hoy (devolución suelta sin nota); N1 NC0 (nota solo dinero, anulación, lista, «acreditado / queda»; pagos y reportes netos «pendiente de completar»); N2 NC1 (con devolución vinculada y tope de cantidad); N3 NC2 (reportes netos); N4 NC3 (gastos, IVA, percepciones); N5 NC4/NC5 (aplicada en pagos o reintegrada; enganche a la compra simple).

**«¿Qué pasa si…?»**

*Registrar nota sobre factura:* repetición → una sola nota (clave I3 única; el reenvío devuelve el mismo mensaje). Concurrencia → primera sentencia útil `SELECT … FOR UPDATE` sobre `FacturaProveedor` dentro de `conTransaccionSerializable`; la segunda espera, relee las sumas y se rechaza si se pasa del tope; mismo número a la vez: gana uno por el índice parcial. Tiempo → nota en otro mes válida; fecha anterior a la factura o posterior a hoy: rechazo. Incertidumbre → «Queda $Y» en pantalla es orientativo; manda el tope dentro de la transacción. Reintento → misma clave, mismo resultado; un 40001 se reintenta solo. Error parcial → cabecera, líneas, imputaciones y auditoría en una transacción: todo o nada. Datos faltantes → sin número, letra, motivo, total o líneas no guarda; Σ distinto del total: «Faltan / Sobran $X». Cambio de permisos → permiso y alcance se piden en cada sucursal imputada antes de abrir la transacción; la RLS rechaza el INSERT si el alcance ya no está.

*Registrar nota suelta:* igual, sin factura que bloquear ni tope; arbitran el número y la clave; dos notas con números distintos por el mismo concepto generan el aviso de duplicado, no un bloqueo; sin sucursal declarada no guarda.

*Anular nota:* repetición → `UPDATE … WHERE "anuladaEn" IS NULL` deja una ganadora; **la nota no tiene clave de idempotencia de anulación** (hueco): PROPUESTA, si ya está anulada por el mismo usuario y con el mismo motivo se responde éxito «ya estaba anulada»; si no, `YA_ANULADA`. Concurrencia → en nota sobre factura se toma primero el candado de la factura (serializa con la carga y con la anulación de la factura). Error parcial → anulación + auditoría en una transacción. Sin motivo no anula. Permiso `anular_nota_credito_proveedor` en cada sucursal imputada.

### Nivel 6. Historia y persistencia

- **NC0 no agrega tablas ni columnas.** Usa cabecera, línea e imputación como están: `tipo` `SOBRE_FACTURA` o `SUELTA`; naturaleza siempre `MERCADERIA`; `estado` `CONFIRMADA`; `origen` `CARGA`; neto e IVA en NULL; tributos sin uso hasta NC3.
- **Puntos de extensión (aditivos, para más adelante):** registro de anulación con su clave (como `AnulacionDeFacturaProveedor`); `Imputacion.operacionCompraId` o `comprobanteAsociadoTexto` para enganchar la nota suelta a una compra simple (NC5, o innecesario si llega E3b); ampliar los CHECK de `estado` y `origen` para el flujo por pasos.
- **Historia:** líneas e imputaciones solo se agregan (guardián vigente); la cabecera solo actualiza las columnas de anulación.

### Nivel 7. Atomicidad y concurrencia

Una transacción `conTransaccionSerializable` por comando, en este orden: (1) I3; (2) candado de la factura (`bloquearFactura`, ya existe); (3) factura anulada o con propuestas pendientes: rechazo; (4) sumas vigentes leyendo imputaciones con `lecturaDeVerificacionEnLaEmpresa` (si no, con una sola sucursal la regla falla abierta); (5) reglas puras; (6) escritura por **un único escritor** (`escribir-nota-credito-proveedor.ts`) con su guardián de arquitectura.

**NO VERIFICADO:** la prueba de concurrencia existente demuestra el protocolo en READ COMMITTED con clientes `pg` sueltos. En SERIALIZABLE la foto se toma en la primera sentencia, así que tras el candado la suma podría estar desactualizada; la protección real la daría SSI con un 40001 y el reintento. **NC0 debe agregar la prueba del caso de uso real** (8 cargas simultáneas de 60 sobre 200 → exactamente 3, corrida 3 veces) y una mutación (sacar el candado → rojo).

### Nivel 8. Acceso e interfaces

- Server Actions en `src/server/actions/movimientos/notas-de-credito-proveedor.ts`: `registrarNotaCreditoProveedor` y `anularNotaCreditoProveedor` (adaptador fino: permiso → guard → caso de uso).
- Casos de uso `registrar-nota-credito-proveedor.ts` y `anular-nota-credito-proveedor.ts`; reglas puras en `src/core/compras/nota-credito.ts` (`evaluarNotaCredito`, `repartirDelTotal`, `imputarPorSucursal`); esquema y guard en `src/core/features/compras/`.
- Permisos: `nota_credito_proveedor` y `anular_nota_credito_proveedor` entran a `ACCIONES` (módulo `compras`) y salen de `claves-reservadas-en-base.ts`; `gasto_nota_credito` sigue reservada hasta NC3.

### Nivel 9. Consultas y experiencia

- En Reportes → Compras, para cada factura documento: «Acreditado $X · Queda $Y» y «Cargar nota de crédito» (solo con permiso).
- Página «Notas de crédito de proveedor»: filtro por proveedor y mes, botón de nota suelta, botón de anular con motivo y confirmación.
- Formulario: proveedor → letra + punto de venta + número → fecha → motivo → por renglón o «sobre el total» → vista previa del reparto por sucursal → confirmar. Se muestra «Aplicación al pago: pendiente de completar (cuenta corriente)» y «No cambia el stock ni el costo».

### Nivel 10. Pruebas, migración y operación

- Reglas puras con propiedades de `fast-check` (ya es dependencia): suma exacta, 100 = 33,33 + 33,33 + 33,34, nota total que deja el saldo en 0.
- Integración: topes en sus tres niveles; factura anulada o con propuestas; número y clave repetidos; nota anulada libera el número; C29 en los dos órdenes; RLS; campos sensibles.
- Concurrencia: las del nivel 7.
- Invariancia: sobre el seed, `totalGastado`, ratio, costo de reposición, valuación y reporte de devoluciones dan exactamente lo mismo antes y después de cargar notas en NC0.
- E2E: cargar una nota sobre factura repartida, verla, anularla y recargar el mismo número; cargar una nota suelta.
- Mutaciones: sacar el candado; sacar el tope por sucursal; aceptar fecha anterior a la factura; escribir fuera del único escritor.
- Operación: corregir ADR-029 §12; agregar al runbook la verificación de permisos (§4).

## 3. Etapas

| Etapa | Qué entrega | Migración | Depende de |
|---|---|---|---|
| **NC0 «solo dinero»** | CU1 a CU5 | Ninguna de esquema; relleno de permisos condicional (§4) | Conviene fusionar antes compras etapa 1 (número canónico) |
| **NC1 «con devolución»** | CU6 y CU7: crear o vincular `Operacion` DEVOLUCION_PROVEEDOR con `devuelveAMovimientoId`; tope de cantidad; anular revierte; el reporte de devoluciones filtra anuladas | Ninguna (M2-2 y M6.3 ya aplicadas) | NC0 |
| **NC2 «reportes netos»** | Gasto y ratio netos de notas, en el mes de la nota | Ninguna | Pregunta 2 |
| **NC3 «gastos e IVA»** | `gasto_nota_credito`, notas sobre renglones sin stock; tributos y desglose | Ninguna de esquema | E4 y etapa IVA |
| **NC4 «en pagos»** | La nota como documento aplicable en la conciliación o reintegrable | Las de X3 | X3 |
| **NC5 «enganche a la compra simple»** | Vínculo aditivo de la nota suelta a la `Operacion` COMPRA | Aditiva, requiere autorización | Decisión entre E3b y NC5 |

## 4. Migración mínima de NC0 (REQUIERE AUTORIZACIÓN EXPRESA, base por base, con respaldo y ensayo en rama de Neon)

**No hay migración de esquema.** Antes de habilitar NC0 se corren lecturas de solo lectura (con OK del dueño para leer producción):

1. `npx prisma migrate status` en cada base: las cuatro de M6 aplicadas (**NO VERIFICADO en zuluhub**).
2. `SELECT count(*) FROM "Accion" WHERE clave IN ('nota_credito_proveedor','gasto_nota_credito','anular_nota_credito_proveedor')` debe dar 3.
3. Empresas sin la fila del admin dadas de alta después del 2026-10-13: `SELECT r."empresaId" FROM "Rol" r WHERE r."clave"='admin' AND NOT EXISTS (SELECT 1 FROM "PermisoRol" p WHERE p."rolId"=r.id AND p."accionClave"='nota_credito_proveedor')`.

**Solo si (3) devuelve filas**, una migración de datos `relleno_permisos_notas_de_credito`: el mismo segundo INSERT de M6.4, idempotente (`ON CONFLICT ("rolId","accionClave") DO NOTHING`) para `nota_credito_proveedor` y `anular_nota_credito_proveedor` sobre los roles `admin`. Su `down.sql` aborta si hay alguna fila en `NotaCreditoProveedor` o si la configuración de esas claves no es la semilla; si no, borra solo las filas de `PermisoRol` de esas dos claves de las empresas listadas. Es aditiva, no toca esquema y no hace falta si (3) da vacío. El código de NC0 se revierte antes que esta migración.

## 5. Dimensiones y oráculo de combinaciones

| Dimensión | Valores |
|---|---|
| D1 tipo | `SOBRE_FACTURA` / `SUELTA` |
| D2 origen del importe | `RENGLON` / `REPARTO_DEL_TOTAL` (solo sobre factura) / `SIN_FACTURA` (solo suelta) |
| D3 partes de la factura | 1 / 2 o más / con propuesta pendiente |
| D4 importe frente al saldo | menor / igual / mayor |
| D5 permiso y alcance en las sucursales imputadas | todas / falta una |
| D6 estado de la factura | vigente / anulada |
| D7 repetición | clave nueva / misma clave y mismo contenido / misma clave y otro contenido |

Sobre factura: 2 × 3 × 3 × 2 × 2 × 3 = **216**; suelta: 1 × 3 × 2 × 3 = **18** (D3 y D6 no aplican); **total 234**, exhaustivas. Salidas esperadas por fila: acepta o rechaza con código; Δ saldo de la factura; imputación por sucursal en centavos; Δ stock = 0; Δ costo vigente = 0; Δ `totalGastado` = 0 (en NC0). Declaradas «no afecta» en NC0: letra presente o ausente (solo afecta la unicidad, que tiene su prueba), `fechaComprobante`, `recibidaEnAdministracionEn`. El oráculo se escribe aparte del código en `docs/oraculo-combinaciones-notas-de-credito-AAAA-MM-DD.md`. **Guardián:** falla si aparece un valor nuevo en los CHECK de `tipo`, `origenImporte`, `naturaleza`, `estado` u `origen`, o una columna nueva en las cuatro tablas, sin declarar si afecta; registrar la entrada en `docs/mapa-cobertura-de-combinaciones-2026-10-28.md`.

## 6. Preguntas al dueño (con recomendación)

1. **[CONFIRMADA 2026-11-04: sí a la recomendación] Compra simple con nota de crédito.** Cuando el proveedor manda una nota por una compra cargada «normal» (no repartida entre sucursales), ¿alcanza con cargarla como nota suelta, escribiendo en el motivo el número de la factura que corrige, o necesitan que quede enganchada a esa compra desde el primer día? *Recomendación:* suelta con el número en el motivo; el enganche llega cuando toda compra sea documento (E3b), sin rehacer nada.
2. **[CONFIRMADA 2026-11-04] Reportes.** ¿La nota tiene que bajar el gasto en compras y la relación compras/ventas? ¿En el mes de la nota o en el de la factura (factura de octubre, nota de noviembre)? *Recomendación:* sí, en el mes de la **nota**, como el documento fiscal, en NC2. En NC0 se ve en su propia lista sin cambiar los números que ya conocen.
3. **[CONFIRMADA 2026-11-04: sí a la recomendación] Factura repartida entre sucursales.** Si llega una bonificación sobre el total de una factura repartida (hotel y restaurante), ¿se reparte sola en la misma proporción o prefieren elegir a qué sucursal le toca? *Recomendación:* sola y proporcional, con vista previa antes de confirmar; quien la carga necesita permiso en cada sucursal.
4. **[CONFIRMADA 2026-11-04: sí a la recomendación] Devolución con mercadería.** ¿Al cargar la nota quieren poder elegir la devolución ya registrada (o hacerla en el mismo paso) para no acreditar dos veces, o por ahora alcanza con cargarlas por separado? *Recomendación:* por separado en NC0 y vinculadas en NC1.

**Consecuencia de la regla N16 sobre la pregunta 1 (aclaración del dueño, 2026-11-04):** en NC0 la nota suelta lleva el número de la factura solo como texto en el motivo. Eso alcanza para cargarla, pero **no alcanza para conciliarla**: como una nota siempre debe cancelar una factura, antes de que NC4 (nota aplicable en la conciliación) pueda usar una nota suelta hay que enganchar esa nota a su factura (NC5, o E3b si antes toda compra es documento). Dependencia declarada: **NC4 requiere NC5 para las notas sueltas**; las notas cargadas sobre una factura documento ya cumplen la regla desde NC0.

## 7. Verificación end-to-end al cerrar NC0

Línea de base antes de tocar nada: cantidad de archivos `*.test.ts` y de specs e2e, y los valores de `totalGastado`, ratio, costo de reposición y valuación sobre el seed. Los 8 comandos del gate en la misma corrida: `npx tsc --noEmit`, `npm run lint`, `npm run arquitectura`, `npm run analizar:muerto`, `npm test`, `npm run build`, `npm run plataforma:build`, `npm run test:e2e`.

Criterio de éxito: los 8 terminan con código 0 y `analizar:muerto` da 0 hallazgos; el conteo de tests y specs es mayor o igual que la línea de base más los nuevos (reglas puras, integración, concurrencia del caso de uso real corrida 3 veces, oráculo de 234 combinaciones, guardián de dimensiones, guardián del escritor único y e2e); cada test nuevo con su mutación demostrada; la prueba de invariancia da exactamente los valores de la línea de base; `test/permisos/paridad-catalogo-migraciones.test.ts` en verde con las dos claves movidas de reservadas a `ACCIONES`; la migración de §4, solo si hizo falta, ensayada subir-bajar-subir en una rama de Neon.

## 8. Lo que no se pudo verificar

- Si las migraciones M6 están aplicadas en zuluhub.
- Si en producción hay empresas creadas después del 2026-10-13 sin la fila de permiso del admin.
- El comportamiento del candado bajo SERIALIZABLE con el caso de uso real (nivel 7).
- Las reglas oficiales de ARCA sobre numeración y comprobante asociado.
- Si la copia local de `motor2-docs` (al 2026-10-09) es la última.
