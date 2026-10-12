# ADR-029: La factura de proveedor es un documento de la empresa (repartida entre sucursales)

> Redactado el 2026-10-12 (Paquete 3, M3). **Estado: el MODELO está escrito en el repositorio (seis migraciones aditivas con su `down.sql` y sus pruebas); NINGÚN caso de uso las escribe todavía (Etapa C) y ninguna está aplicada a una base real. Cada migración REQUIERE AUTORIZACIÓN EXPRESA PARA APLICAR, base por base, con respaldo y ensayo en una rama de Neon.** Decisiones del dueño D1 a D5, la perilla de IVA, la recepción por sucursal y los datos del proveedor (2026-10-12): ver las secciones de abajo.

## Contexto

Hoy una compra es una `Operacion` COMPRA por línea y de UNA sola sucursal (`src/server/actions/movimientos/casos-de-uso/registrar-movimiento.ts`). No existe «la factura» como cosa: dos líneas de la misma factura son dos operaciones sueltas, y si la factura se paga entre varias sucursales hay que cargarla varias veces a mano. El aviso de posible duplicado de una compra (`src/core/compras/posible-duplicado.ts`) compara contra cada operación, así que no puede reconocer una factura repartida repetida. La clave de unicidad actual (`Operacion_factura_unica_vigente_key`, ver `src/core/movimientos/factura-unica.ts`) es por sucursal.

El negocio necesita (FR2.2/FR2.3 y las decisiones del 2026-10-11 y 12): cargar UNA factura de proveedor, repartirla entre sucursales (cada una con su parte de mercadería y de dinero), dejar una factura «pendiente de reparto» que carga una persona y reparte otra, y llevar el IVA de la factura cuando la empresa lo necesita.

## Decisión

### 1. Tres tablas y una columna, aditivas

Migración `prisma/migrations/20261016101000_factura_proveedor/migration.sql` (M3b):

- **`FacturaProveedor`** (la cabecera): proveedor, número tal cual se tecleó y su clave normalizada, letra, `fecha` (el mediodía argentino del día que eligió quien cargó: manda el stock y el costo), `fechaComprobante` (la impresa, solo dato), `importeTotal` (CON IVA incluido), `estado` (`PENDIENTE_DE_REPARTO` o `CONFIRMADA`), `origen` (`CARGA` o `MIGRACION`), condición de pago (hoy solo `CONTADO_PAGADA`), datos de pago declarados, clave de idempotencia y huella, creación y anulación.
- **`FacturaProveedorRenglon`**: lo comprado. Hoy toda naturaleza es `MERCADERIA` (producto, cantidad en unidad de stock, precio por unidad de stock calculado UNA vez, lote, texto de conversión) con `precioTotal` CON IVA incluido.
- **`FacturaProveedorSucursal`**: la parte de cada sucursal (`porcentajeDeclaradoBp` entre 1 y 10000 y `operacionId`, la `Operacion` COMPRA de esa parte; único y opcional).
- **`MovimientoStock.facturaProveedorRenglonId`**: de qué renglón salió una línea de compra (nulable; CHECK: solo en COMPRA). Los AJUSTE de una anulación quedan sin renglón.

**No se toca `Operacion`**: el vínculo va al revés (`FacturaProveedorSucursal.operacionId`). Reemplaza a las columnas `Operacion.facturaProveedorId` y `porcentajeDeclaradoBp` de los planes viejos.

El `porcentajeDeclaradoBp` es la INTENCIÓN de quien carga y **nunca atribuye dinero**: la atribución sale del dinero de cada parte (el `precioTotal` de cada línea del Kardex). El reparto de la plata usa `repartirImporte` (`src/core/moneda.ts`, mayor residuo): la suma de las partes da exacto el importe del renglón (`test/persistencia/factura-proveedor-dinero.test.ts`, propiedades contra la base).

### 2. Quién ve qué: la cabecera es de la empresa, la parte es de la sucursal

Clasificación en `test/setup/clasificacion-de-tablas.ts`: `FacturaProveedor` y `FacturaProveedorRenglon` son `DE_EMPRESA` (RLS `aislamiento_empresa`, sin FK a `Sucursal`); `FacturaProveedorSucursal` es `PROPIA`, con las 4 políticas RESTRICTIVE de alcance de sucursal de la migración M3c (`prisma/migrations/20261016102000_rls_sucursal_factura_proveedor_sucursal/migration.sql`, que es EXACTAMENTE la salida del generador, como exige el guardián B7).

Por qué la cabecera NO tiene `sucursalCargaId`: una FK a `Sucursal` la volvería «de sucursal» por la regla R3 de `test/arquitectura/alcance-de-sucursal.test.ts`, y con las políticas por sucursal la cabecera quedaría invisible desde las partes de las otras sucursales (el problema del «padre invisible», ver ADR-028). Así, desde cualquier sucursal de la empresa se llega a la cabecera de la propia parte. **Consecuencia aceptada:** el total y los precios de la factura quedan legibles en la base para cualquier sucursal de la empresa; lo que se MUESTRA lo decide el gate (la bandeja de pendientes pide `compra_repartir`; los importes tienen piso administrador en `test/arquitectura/guardas/campos-sensibles.ts`). Precedente: `ProveedorPorProducto`, que también tiene precios y es de empresa.

### 3. La unicidad del número la decide la base

Un índice único parcial, `FacturaProveedor_unica_vigente_key`, sobre `(empresaId, proveedorId, COALESCE(letra, ''), nroFacturaNormalizado)` donde el número no es nulo y la factura no está anulada. No hay lectura previa que decida: dos cargas simultáneas del mismo número dan una ganadora y una perdedora con 23505; si la primera hace ROLLBACK, la segunda entra. Una factura anulada libera el número; una **pendiente de reparto lo reserva** (D2). La prueba es contra el índice real y con conexiones `pg` como `motor2_app` (`test/persistencia/factura-proveedor-concurrencia.test.ts`). La clave de idempotencia (`claveIdempotencia`) es única GLOBAL, como en las demás tablas (ADR-028).

La clave normalizada (qué hace igual «1-1234» y «0001-00001234») la calcula la Etapa C, con su primer consumidor; su nombre se suma a los índices reconocidos como «factura duplicada» para que un choque no salga como error 500.

### 4. Solo se agrega: privilegios por columna (D4)

`motor2_app` tiene SELECT e INSERT en las tres tablas (y en la de tributos), **nunca DELETE**. En `FacturaProveedor` el UPDATE es por columna y solo de dos grupos: el estado y la anulación, y la lista cerrada de datos que IDENTIFICAN la factura (proveedor, número, letra, detalle, fecha del comprobante, recepción en administración y datos de pago declarados), como la corrección de K1b. **El dinero no se corrige**: `importeTotal`, `fecha`, `origen`, `condicionPago`, la clave de idempotencia, los renglones, las partes y todo el desglose de IVA no tienen UPDATE en la base; un error de importe se anula y se vuelve a cargar, o va una nota de crédito. Es una excepción explícita a «documentos solo por versiones»: una tabla de versiones sería abstracción de más para la etapa. Por eso no hay `@updatedAt`.

### 5. Estados de la cabecera (D2)

`PENDIENTE_DE_REPARTO`: cargada y con su número reservado, la ven y anulan solo quienes tienen `compra_repartir`, **su mercadería NO entra al stock hasta repartirse** (no se puede vender ni consumir antes) y la fecha del stock es la que eligió quien la cargó. `CONFIRMADA`: repartida (o cargada ya al 100 % en una sucursal). CHECK: la confirmación (cuándo y quién) existe si y solo si el estado es `CONFIRMADA`, y lo migrado (`origen = MIGRACION`) nace confirmado. **Limitación declarada:** la base no impide con un CHECK volver de `CONFIRMADA` a `PENDIENTE_DE_REPARTO` (no se usa un trigger); el caso de uso lo hace con un UPDATE condicionado al estado (`WHERE estado = 'PENDIENTE_DE_REPARTO'`), y la lista de escritores se cierra en la Etapa C.

### 5b. La recepción de la mercadería por sucursal (cambio del dueño, 2026-10-12)

**Regla de negocio:** el stock de una factura entra recién cuando la factura está REPARTIDA (cabecera `CONFIRMADA`, no `PENDIENTE_DE_REPARTO`) **y** la parte de esa sucursal está RECIBIDA. Al cargar la factura el usuario elige, para cada sucursal, «recibida» (entra al stock con la fecha de recepción elegida) o «pendiente» (se confirma después desde la bandeja «mercadería por recibir», que es de la Etapa C). Las partes sin mercadería con stock (solo gastos, M4) las crea la aplicación directamente RECIBIDA.

Migración `prisma/migrations/20261016101500_factura_proveedor_recepcion/migration.sql`, sobre `FacturaProveedorSucursal`: `estadoRecepcion` (TEXT NOT NULL DEFAULT `PENDIENTE`, CHECK `PENDIENTE` o `RECIBIDA`), `recibidaEn` (TIMESTAMP(3) NULL, UTC: es la **fecha de stock** elegida) y `recibidaPorId` (FK a `User`). CHECK: `(estadoRecepcion = 'RECIBIDA') = (recibidaEn IS NOT NULL)` y la persona va junto con la fecha. UPDATE **solo por columna** sobre esas tres, y un **disparador** `BEFORE UPDATE` que permite únicamente la transición PENDIENTE a RECIBIDA (una recibida no vuelve atrás, ni cambia de fecha ni de persona: se corrige anulando); rige también para el dueño y repetir con los mismos valores es inofensivo. Es la única excepción a «sin disparadores» y la pidió el dueño; las reglas entre filas siguen sin trigger.

**Concurrencia e idempotencia** (`test/persistencia/factura-proveedor-recepcion.test.ts`, transacciones reales como `motor2_app`): la guarda es `UPDATE ... WHERE "estadoRecepcion" = 'PENDIENTE'` más la unicidad de `operacionId`. Dos confirmaciones a la vez de la misma parte: la segunda espera a la primera, re-evalúa la fila al confirmar la primera y toca 0 filas; el caso de uso escribe el stock **solo si el UPDATE tocó una fila**, así que dejan UNA recepción y UNA línea de stock (probado con 2 y con 8 a la vez, y repitiendo). Lo que la base no mira —que la cabecera esté confirmada al recibir— lo valida el caso de uso.

### 6. Los permisos `compra_repartir` (D3) y `compra_recibir`

Migración de datos `prisma/migrations/20261016100000_permiso_compra_repartir/migration.sql` (M3a): clave de empresa, piso administrador, semilla solo `admin`; se da al rol de clave `admin` de cada empresa (con el `empresaId` de la fila del rol), con el molde de la migración M.2. Es la clave de la clase A en `test/arquitectura/clases-de-claves.test.ts` y queda reservada en `test/arquitectura/toda-accion-se-usa.test.ts` hasta que la primera guarda la use. Cada sucursal destino además exige `proceso_compra` en ella: lo valida el caso de uso.

**`compra_recibir`** (misma migración): clave de **sucursal** (quien recibe es la sucursal), módulo `compras`, piso operario y semilla solo `admin` (clase O, delegable al encargado de la sucursal por configuración); se siembra igual que la anterior (al rol `admin` de cada empresa, nadie más) y también queda reservada hasta la Etapa C.

### 7. IVA, tributos y la perilla (M3d, D1)

Migración `prisma/migrations/20261016103000_factura_proveedor_iva/migration.sql`:

- **La perilla** `Empresa.llevaIvaDeCompras` (BOOLEAN NOT NULL DEFAULT false), un supuesto declarado del dueño. **Apagada** (hoy, en toda empresa): la factura NO exige neto, IVA ni alícuota; todo se carga con IVA incluido. **Prendida**: se exigen según la letra y alimentan el IVA computable. La carga la hace la plataforma, nunca la propia empresa (igual que `Empresa.condicionIva`; está en la lista de perillas de `test/arquitectura/politica-de-empresa-solo-plataforma.test.ts`). **Las ventas no dependen de la perilla.**
- **Qué no puede hacer la base:** un CHECK no lee `Empresa`. Por eso las columnas de desglose son NULLABLES (cabecera: `condicionIvaEmpresa`, `importeNeto`, `importeIva`; renglón: `alicuotaIva`, `importeNeto`, `importeIva`) y **no hay ningún CHECK de obligatoriedad** que dependa de la perilla o de la letra. **La exigencia según la perilla y la letra la hace la Etapa C en el SERVIDOR** (que lee la empresa): con la perilla prendida pide el desglose que corresponda a la letra, y con la apagada no pide nada. Esto es responsabilidad del caso de uso; la base solo garantiza coherencia cuando hay valores.
- **Lo que sí está en la base** (CHECK con nombre): neto + IVA = total del renglón EXACTO en centavos; neto e IVA juntos o ninguno; importes no negativos; alícuota de la lista cerrada `ALICUOTAS_IVA` (`src/core/fiscal/iva.ts`, la misma del producto; una prueba compara el CHECK con la constante); condición de IVA de `CONDICIONES_IVA`; con alícuota 0 %, exento o no gravado el IVA discriminado es cero; el IVA computable (`importeIvaComputable`, NOT NULL DEFAULT 0) va de cero al IVA del renglón; el neto + IVA de la cabecera no supera su total.
- **Tributos** (`FacturaProveedorTributo`): percepciones e impuestos que trae la factura además del IVA; cuelgan de la cabecera, son `DE_EMPRESA`, de tipo de lista cerrada y con importe mayor que cero; solo SELECT e INSERT. **Supuesto a confirmar por el dueño:** `importeTotal` es lo que se debe pagar, es decir la suma de los renglones MÁS los tributos; la base no suma filas, lo valida el caso de uso.
- **Datos del proveedor (M3e, C36)**, migración `prisma/migrations/20261016104000_proveedor_condicion_iva_y_puntos_de_venta/migration.sql`: `Proveedor.condicionIva` (TEXT NULL con CHECK de la misma lista cerrada que `Empresa.condicionIva`, `CONDICIONES_IVA`; NULL = no declarada, sin default ni relleno; una prueba compara la lista con la base) y la tabla `PuntoDeVentaDeProveedor` (`DE_EMPRESA`, `numero` de 1 a 99999, único por proveedor, `activo`; **nunca se borra, se apaga**: `motor2_app` tiene SELECT, INSERT y UPDATE solo de `activo`; `motor2_plataforma`, nada). **No se implementa la función que sugiere la letra de la factura (A, B o C)**: las reglas fiscales se verifican contra ARCA antes de ponerlas en código; queda anotado para la Etapa C.
- **La letra** vive en la cabecera desde M3b (no en M3d) porque entra en el índice único (D5) y se crea una sola vez: A, B, C, E, M o X, o ninguna.

### 8. Los índices van sin `CREATE INDEX CONCURRENTLY`

`CONCURRENTLY` no puede correr dentro de un bloque de transacción y Prisma corre cada `migration.sql` de varias sentencias como una. Los índices de las tablas nuevas caen sobre tablas vacías que nadie lee ni escribe; el único índice sobre una tabla existente (`MovimientoStock`) cae sobre 0 filas en la base real (medido el 2026-10-11). Además una migración falla entera o no deja nada, y `CONCURRENTLY` deja un índice `INVALID` que hay que limpiar a mano. Precedentes: `prisma/migrations/20260924150903_pos_mesas_cuentas/migration.sql` y `prisma/migrations/20260929110000_indice_compras_por_producto/migration.sql`. Guarda de volumen y salida alternativa (un archivo aparte de una sola sentencia con `CONCURRENTLY`): `docs/deploy-con-migraciones.md`.

### 9. Qué NO hace este ADR (Etapa C, a construir después)

Ningún caso de uso, pantalla ni Server Action escribe estas tablas. La Etapa C trae: el reparto exacto por renglón (cantidad y dinero), la clave de unicidad del comprobante, `registrarFacturaRepartida` y la carga/reparto de pendientes con su bandeja, la anulación entera y atómica de una factura repartida (una compra sola anula también su cabecera, si no el número queda reservado), la sincronización de la cabecera en la corrección de una compra, el aviso de duplicado también contra cabeceras, **la exigencia de IVA según la perilla y la letra**, los guardianes de escritura (la lista cerrada de UPDATE de la cabecera, la auditoría de `FacturaProveedor` y la cobertura de idempotencia concurrente) y las pruebas de concurrencia de los casos de uso.

## Lo que M4 necesita de M3 (contrato)

M4 (conceptos de gasto, renglón sin stock, imputación por sucursal) apoya sus tablas en estas, con estos nombres exactos:

| Pieza | Nombre exacto |
|---|---|
| Renglón: id y empresa | `FacturaProveedorRenglon.id` (TEXT PK), `empresaId`; único `FacturaProveedorRenglon_empresaId_id_key` |
| Naturaleza | `naturaleza` TEXT NOT NULL DEFAULT `MERCADERIA`; CHECK `FacturaProveedorRenglon_naturaleza_chk` (M4 lo borra y lo vuelve a crear con `SIN_STOCK`) |
| Pareo de mercadería | CHECK `FacturaProveedorRenglon_pareo_mercaderia_chk` sobre `productoId`, `cantidadStock`, `precioPorUnidadStock` y `detalle` (M4 lo reemplaza por el pareo de las dos naturalezas; el plan de M4 pedía este nombre) |
| Dinero | `precioTotal` DECIMAL(14,2) NOT NULL ≥ 0, con IVA incluido; `importeIvaComputable` DECIMAL(14,2) NOT NULL DEFAULT 0 (el desglose `alicuotaIva`, `importeNeto`, `importeIva` es NULLABLE: NULL = no se desglosó, y el computable es 0) |
| Cabecera | `FacturaProveedor` con único `FacturaProveedor_empresaId_id_key`, `fecha`, `anuladaEn`, `proveedorId`, `estado`, `origen`, `condicionPago`; alcance `DE_EMPRESA` |
| Partes | `FacturaProveedorSucursal` (`PROPIA`), único `FacturaProveedorSucursal_facturaProveedorId_sucursalId_key`; M4 no la referencia, pero las partes de **solo gastos** las crea la aplicación directamente con `estadoRecepcion = 'RECIBIDA'` (y `recibidaEn`, `recibidaPorId`; CHECK `FacturaProveedorSucursal_recepcion_coherente_chk`) y `operacionId` NULL |
| Recepción | `estadoRecepcion` (`PENDIENTE`/`RECIBIDA`), `recibidaEn`, `recibidaPorId`; CHECK `FacturaProveedorSucursal_estado_recepcion_chk`, `..._recepcion_coherente_chk`, `..._recibida_por_chk`; disparador `FacturaProveedorSucursal_recepcion_transicion_chk` (PENDIENTE a RECIBIDA); M4 no los toca |
| Permisos de M3 | `compra_repartir` (empresa, clase A) y `compra_recibir` (sucursal, clase O): M4 suma los suyos aparte |
| Permisos | solo SELECT e INSERT; los CHECK de M3b llevan nombre `<Tabla>_<regla>_chk` para que M4 los pueda borrar y volver a crear |

El módulo de gastos se llama `gastos` (P8). El orden de las migraciones es M3a (`20261016100000`), M3b (`20261016101000`), la recepción (`20261016101500`), M3c (`20261016102000`), M3d (`20261016103000`), M3e (`20261016104000`) y recién después las de M4.

## Limitaciones conocidas (documentadas, no resueltas)

- **Reglas entre filas sin trigger.** Que los porcentajes declarados de las partes sumen 10000, que la sucursal de la parte sea la de su `Operacion`, que la suma de los renglones (más los tributos) sea el total de la cabecera y que la suma de las líneas del Kardex de un renglón sea su `precioTotal` no se pueden expresar sin un trigger ni leyendo otras filas (la regla de la etapa es no usar triggers): las valida el caso de uso y una consulta de coherencia del chequeo posterior de `docs/deploy-con-migraciones.md`.
- **El estado de la cabecera puede retroceder por SQL directo** (ver «Estados»): lo impide el caso de uso, no la base. La recepción de la parte, en cambio, tiene su disparador.
- **La cabecera confirmada al recibir** no se puede exigir en la base (mira otra fila): el caso de uso la valida.
- **La cabecera y el renglón no tienen RLS por sucursal**, a propósito (ver «Quién ve qué»).
- **El tipo de tributo y la lista de letras son listas cerradas elegidas por el constructor** (ampliarlas es ampliar un CHECK): conviene que el dueño las confirme antes de la Etapa C.
- **Sin medir:** el costo de las políticas de la parte con volumen real (hoy hay 0 filas).

## Por qué no las alternativas

- **`sucursalCargaId` en la cabecera:** vuelve la cabecera «de sucursal» y la esconde de las demás partes.
- **Columnas en `Operacion` (`facturaProveedorId`, porcentaje):** cambia una tabla caliente y muy referenciada; el vínculo inverso no toca el Kardex.
- **Enums de Prisma para el estado, la naturaleza o los tributos:** hay que tocar el esquema para ampliarlos; `TEXT` + CHECK con nombre se amplía con una migración chica (así lo necesita M4).
- **Una tabla de versiones de la cabecera:** abstracción de más; alcanza con el candado por columna y la anulación.
- **Un CHECK de obligatoriedad del IVA según la perilla:** la base no lee `Empresa`; sería un trigger.
- **Decidir la unicidad del número leyendo antes de escribir:** es la carrera que el índice único parcial elimina.

## Consecuencias

- Seis migraciones aditivas, cada una con su `down.sql` y su prueba de subir, bajar y subir (`test/aislamiento/m3-factura-proveedor-subir-bajar-subir.test.ts`); la reversa de M3b, su recepción, M3a, M3d y M3e es destructiva si ya hay datos (ver `docs/deploy-con-migraciones.md`).
- El código desplegado hoy no lee ni escribe nada de esto: la base va primero y no rompe al código anterior.
- Los goldens de caracterización (la huella de gobierno, la matriz de acceso, el menú de la empresa principal, la huella del Kardex y las matrices de venta, más los que vuelquen filas de `Proveedor`) cambian por las claves nuevas, la perilla y las columnas nuevas en `null`/`false`: se regeneran al integrar, con `git diff --word-diff` mostrando solo lo esperado, y se declaran en `test/arquitectura/caracterizaciones-congeladas.test.ts`.
