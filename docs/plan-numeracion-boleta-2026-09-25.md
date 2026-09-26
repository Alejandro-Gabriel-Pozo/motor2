# Plan: numeración de la boleta de cierre del POS, con ejemplares para las correcciones — 2026-09-25

Sigue a «imprimir la comanda y la boleta» (`docs/plan-imprimir-comanda-y-boleta-2026-09-25.md`, que dejaba la boleta sin número) sobre
la rama `feat/numeracion-boleta`. Plan diseñado por un agente de planificación contra el código real y contra fuentes de la industria,
confirmado por el dueño del producto (incluida la migración) e implementado un commit por paso, en dos fases construidas juntas:
Fase 1 (numeración, siempre ejemplar A) y Fase 2 (ejemplar B de corrección).

## A. Qué es y qué no es

La boleta de cierre es un **control interno de comandas** («guest check control»), **no un comprobante fiscal**: sigue diciendo «No
válido como factura». El número sirve para que se pueda dar cuenta de cada boleta impresa (incluidas las de ventas anuladas, que se
conservan) y para identificar la cuenta cuando el cliente o el encargado la reclaman.

## B. Qué dice el estándar (fuentes de la investigación)

- **USAR** (Uniform System of Accounts for Restaurants): no regula la numeración de la boleta; es un plan de cuentas contable.
- **Guest check control** (práctica de control interno de restaurantes): números secuenciales y únicos por punto de venta, que se pueda
  dar cuenta de cada número (las anuladas se conservan, no se borran) y los huecos en la secuencia son una señal de alerta en una
  auditoría (no una prohibición absoluta si tienen una causa legítima).
- **POS comerciales (Oracle Simphony, Toast):** resuelven la corrección de una boleta de dos maneras — «mismo número» (configurable) o
  «número nuevo + referencia al original». El esquema elegido por el dueño (566-A / 566-B) es la variante «mismo número»: coincide con
  el estándar y se prefiere porque el número identifica a la cuenta.
- Ninguna fuente usa literalmente un sufijo de letra: se guarda el ejemplar como **entero** y la letra se calcula al mostrarla
  (1 → A, 26 → Z, 27 → AA).

## C. Qué es una «corrección» (verificado en el código)

- **Reimpresión** (`reimprimirBoleta`): no llama al servidor, sale marcada REIMPRESIÓN, **no consume número ni letra**. No cambió.
- **Cuenta cerrada:** no se reabre ni se editan sus ítems.
- **`anularVenta`** anula UNA `Operacion`, y `cerrarCuenta` registra una Operacion VENTA **por línea neta**: desde Trazabilidad se puede
  anular solo una línea de una mesa (el flan de una mesa que comió milanesa y flan). Antes de este plan la boleta quedaba marcada
  «venta anulada» entera (reimpresión deshabilitada) aunque la milanesa siguiera vendida, y ningún documento reflejaba la cuenta
  corregida. Ese es el caso real del ejemplar B.
- **Anulación total** (todas las operaciones): no queda nada que cobrar; no hay ejemplar B.

## D. Decisiones

- **D1. Contador por sucursal**, no global: cada sucursal imprime lo suyo; uno global dejaría huecos en la secuencia de cada una.
- **D2. `max(numero) + 1` dentro de la transacción serializable de `cerrarCuenta`**, sin tabla contador ni SEQUENCE de Postgres. La
  numeración arranca en 1 por sucursal (no hay un número previo que continuar). SEQUENCE descartada (deja huecos en rollback/reintento y
  la reinicia el TRUNCATE de la base E2E); tabla contador descartada (mismo perfil de conflictos bajo SERIALIZABLE y un upsert más).
  Concurrencia: dos cierres de la misma sucursal chocan (índice único `(sucursalId, numero, ejemplar)` + SSI); Postgres aborta uno con
  40001 (llega como P2034) y `conTransaccionSerializable` lo reintenta con backoff. **Verificado forzando el solapamiento** de dos
  transacciones (las dos leen el máximo antes de insertar): siempre P2034, nunca P2002, y el reintento deja {1, 2}. Sin huecos por
  construcción: solo numera una transacción que confirma, y las filas nunca se borran (RESTRICT).
- **D3. Dónde se asigna:** en `cerrarCuenta`, solo con venta (`lineas.length > 0`), DESPUÉS de `if (!venta.ok) return error(...)` y
  antes de cerrar la cuenta. **Trampa:** devolver `error(...)` desde el callback CONFIRMA la transacción; si el número se asignara antes
  de validar la venta, un cierre rechazado consumiría un número (un test lo cubre, y una mutación que mueve la numeración antes de la
  venta lo rompe). El cierre idempotente («ya estaba cerrada») no numera. El mensaje de cierre no cambió. El ejemplar A se emite en el
  mismo instante del cierre (`emitidoEn = cerradaEn`).
- **D4. Cómo se ve:** en la boleta impresa, «Boleta N.º 566-A» en su propio renglón debajo de la mesa (`data-numero-boleta`; «N.º»
  como en «N.º de factura»; sin ceros a la izquierda; no en la línea del título, que a 20 pt desborda en 58 mm). En «Cuentas
  cerradas», «N.º 566-A · Cerrada 15:10 · Atendió … · $…». Una cuenta cerrada antes de la numeración no lleva ni el renglón ni el
  prefijo.
- **D5. Sin backfill:** la numeración arranca en 1 por sucursal desde el deploy; las cuentas cerradas antes no reciben número. Antes
  del deploy a producción, correr esta consulta de SOLO LECTURA para saber cuántas quedan sin número (se documenta, no hace falta actuar
  sobre el resultado):

  ```sql
  SELECT count(*) FROM "Cuenta" c
  WHERE c."cerradaEn" IS NOT NULL
    AND EXISTS (SELECT 1 FROM "CuentaItem" i WHERE i."cuentaId" = c.id AND i."operacionId" IS NOT NULL);
  ```

  (Probada contra la base local de desarrollo: corre y devuelve un conteo. **No** se corrió contra producción.)
- **D6. Esquema de ejemplar:** `ejemplar Int` (1 = A). `corrigeAId` apunta SIEMPRE al ejemplar A (una C también), mismo criterio que
  `CuentaItem.anulaAItemId`: profundidad 1. Invariantes que valida la aplicación (no la base): `ejemplar = 1` ⇔ `corrigeAId` null; una
  corrección tiene el mismo número, cuenta y sucursal que su A; `motivo` obligatorio desde el B.

## E. Esquema (migración `20260925200000_pos_numeracion_boleta`, autorizada)

Tabla nueva `EjemplarBoleta` (ADITIVA: ninguna fila existente cambia): `sucursalId`, `cuentaId`, `numero`, `ejemplar` (default 1),
`emitidoEn`, `emitidoPorId`, `corrigeAId` (auto-referencia RESTRICT) y `motivo`. Únicos `(sucursalId, numero, ejemplar)` y
`(cuentaId, ejemplar)`; índice en `corrigeAId`. Todas las FK RESTRICT. Sin CONCURRENTLY (tabla nueva y vacía). No es una migración de
permisos: la Fase 2 reusa `pos_cerrar_cuenta`.

Consecuencia para las limpiezas de test: los ejemplares de corrección se borran antes que los originales, y los ejemplares antes que la
`Cuenta` (`limpiarBaseDeTest` en `test/setup/test-db.ts` y el `limpiar()` de `test/e2e/pos-tomar-pedido.spec.ts`). El TRUNCATE de
`global-setup`/`global-teardown` incluye la tabla nueva sola.

## F. Estado derivado de la boleta (Fase 2)

`BoletaDeCuenta` (src/core/pos/boleta.ts) suma `numero` (el último ejemplar; null sin numeración), `corrigeA` (el A, si el último es
una corrección) y `estado`:

- **vigente:** ninguna Operacion VENTA de la cuenta se anuló después de emitirse el último ejemplar. Se reimprime (aunque sea un B).
- **desactualizada:** alguna se anuló DESPUÉS de emitirse el último ejemplar (sin número, la referencia es el cierre). No se reimprime;
  habilita «Emitir boleta corregida» (si está numerada).
- **anulada:** se anularon todas. Todo deshabilitado, «Venta anulada», como antes.

Las líneas y el total son solo lo vigente (ítems cuya operación no se anuló; funciona por línea porque `cerrarCuenta` enlaza a la
operación de su línea también las filas espejo). `ventaAnulada` se mantiene y significa «alguna».

## G. «Emitir boleta corregida» (Fase 2)

Server Action `emitirBoletaCorregida(cuentaId, motivo)` (src/server/actions/pos/cuenta.ts), con `pos_cerrar_cuenta` y en una
transacción serializable: cuenta de la sucursal, cerrada con número, estado «desactualizada» y al menos una línea vigente. Crea el
ejemplar siguiente con el mismo número, `corrigeAId` al A y el motivo (`validarMotivoAnulacion`), y audita (entidad `Cuenta`, campo
`ejemplarBoleta`, «566-A» → «566-B»). Rechazos: «La boleta N.º 566-B ya refleja las anulaciones.», «La venta se anuló entera: no hay
boleta que corregir.», cuenta abierta o cerrada antes de la numeración. Devuelve `ResultadoBoletaCorregida` (número y ejemplar
emitidos, precedente `ResultadoEnvioACocina`): la pantalla imprime ese ejemplar (`PedidoImpresion` `boleta-correccion`). Dos emisiones a
la vez dejan un solo B.

Documento impreso `data-tipo="boleta-correccion"`: encabezado «CORRECCIÓN», «Boleta N.º 566-B», «Reemplaza a N.º 566-A», las líneas
vigentes y el total nuevo. El motivo NO se imprime (queda en pantalla y en la auditoría). La reimpresión de un B sale «REIMPRESIÓN» y
conserva «Reemplaza a».

## H. Pasos (un commit por paso)

1. Núcleo puro (`src/core/pos/numeracion-boleta.ts`): `siguienteNumeroBoleta`, `letraDeEjemplar`, `formatearNumeroBoleta`.
2. Migración + test de esquema + limpiezas de test.
3. `cerrarCuenta` asigna el número (tests de acción y de concurrencia).
4. La boleta lee su número.
5. Número en la impresión y en «Cuentas cerradas» + E2E.
6. Estado derivado (vigente / desactualizada / anulada).
7. Server Action `emitirBoletaCorregida`.
8. Interfaz: «Emitir boleta corregida», impresión de la corrección y reimpresión del B + E2E y caso axe.
9. Esta documentación.

## I. Verificación

- `npm run build` contra una base local descartable RECIÉN CREADA (`motor2_build_numeracion_boleta`, nunca Neon ni producción):
  `prisma migrate deploy` encontró 40 migraciones y aplicó `20260925200000_pos_numeracion_boleta` sin error («All migrations have been
  successfully applied.»), y `next build` terminó bien.
- La migración se aplicó con `prisma migrate deploy` a las dos bases locales (`motor2_seccion_directa` y
  `motor2_seccion_directa_e2e`); `prisma migrate diff` contra el schema solo muestra la deriva previa y ajena de
  `Operacion_motivoId_fkey` / `Operacion_destinoId_fkey` (ver `20260925152432_pos_tomar_pedido`).

## J. Aceptación manual (pendiente, en el local)

- Cerrar una mesa real e imprimir en el rollo de **58 mm**: el renglón «Boleta N.º …» se lee bien, no corta ni desborda, y queda
  debajo del número de mesa.
- Anular una línea de esa venta desde Reportes › Trazabilidad, volver a la mesa y emitir la boleta corregida: sale «CORRECCIÓN»,
  «Boleta N.º …-B» y «Reemplaza a N.º …-A», con solo lo que sigue vendido y el total nuevo.
- Reimprimir el B desde «Cuentas cerradas».
