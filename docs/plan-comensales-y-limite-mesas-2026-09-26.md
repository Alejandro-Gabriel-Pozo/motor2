# Comensales al abrir mesa + límite de mesas abiertas por sucursal

Task #13 del backlog. Módulo POS (`src/core/pos/`, `src/server/actions/pos/`, `src/app/(pos)/mesas/`). Única decisión de
negocio pendiente (D6) ya confirmada por el dueño: **bloqueo en seco** al llegar al límite de mesas abiertas, sin ninguna
excepción por permiso especial.

## 1. Comensales al abrir mesa

`Cuenta.comensales Int?` (migración `20260926134400_comensales_cuenta`, aditiva, sin backfill). Obligatorio y **sin valor por
defecto** al abrir la cuenta (`abrirCuenta(mesaId, comensales)`, validado con `validarComensales` — entero 1..99): un default
sesgaría la métrica de rotación que existe para medir. `NULL` = cuenta abierta antes de este cambio; nunca se inventa un dato
histórico.

**Es SOLO para medir rotación.** No hay entidad "comensal"/"asiento" ni relación con `CuentaItem`: ningún ítem se asocia a una
persona, y esto no habilita dividir la cuenta.

Se puede corregir mientras la cuenta sigue **abierta** (`corregirComensales(cuentaId, comensales)`, mismo permiso
`pos_tomar_pedido`): llega gente después, o se cargó mal al abrir. Una vez cerrada la cuenta, el dato queda congelado —
`corregirComensales` la rechaza (mismo criterio que el resto de las acciones sobre `CuentaItem`).

UI: modal "¿Cuántos comensales?" al apretar «Abrir cuenta» (`src/app/(pos)/mesas/[mesaId]/abrir-cuenta.tsx`), con botones
rápidos 1-6 más un campo "Otro" (1..99); la validación real es del servidor. Corrección con la cuenta abierta:
`comensales-cuenta.tsx`, en el encabezado de la pantalla de la mesa.

## 2. Límite de mesas abiertas por sucursal

`Sucursal.maxMesasAbiertas Int?` (migración `20260926134500_max_mesas_abiertas_sucursal`, aditiva). `NULL` (default) = sin
límite. Se cuenta como "abierta" toda `Cuenta` con `cerradaEn IS NULL` de una mesa de esa sucursal — no la cantidad de `Mesa`
dadas de alta.

- **Edición:** `actualizarMaxMesasAbiertas(limite)` (`src/server/actions/pos/mesas.ts`), mismo permiso que dar de alta mesas
  (`pos_mesas`, Editar) — no hace falta uno nuevo. Auditado (`registrarCambioAuditado`, entidad `"Sucursal"`, campo
  `"maxMesasAbiertas"`). UI: control en el mapa de mesas (`src/app/(pos)/mesas/limite-mesas.tsx`).
- **Chequeo (D6, bloqueo en seco):** dentro de la MISMA transacción SERIALIZABLE que abre la cuenta (`abrirCuenta`,
  `conTransaccionSerializable` — el mecanismo que ya usa el resto del módulo, no uno nuevo). Mensaje: *"Se alcanzó el máximo
  de N mesas abiertas en «Sucursal». Cerrá o liberá una antes de abrir otra."* Sin excepción de permiso especial para esta v1.
- **Idempotencia:** si la mesa que se intenta abrir YA tiene una cuenta abierta, `abrirCuenta` lo detecta ANTES de chequear el
  límite (y antes de validar comensales) — reabrir la MISMA mesa nunca falla por el límite.
- **Bajar el límite no cierra nada:** solo bloquea aperturas nuevas hasta que se libere o cierre alguna mesa.
- **Concurrencia:** dos aperturas simultáneas a mesas DISTINTAS que juntas superarían el límite compiten por el mismo
  predicado (`COUNT(*) WHERE cerradaEn IS NULL`) bajo SERIALIZABLE — Postgres aborta una por conflicto de escritura y
  `conTransaccionSerializable` la reintenta, viendo ya el cupo agotado. Exactamente una tiene éxito (test de concurrencia en
  `test/pos/cuenta-concurrencia.test.ts`).

## 3. Reporte de rotación de mesas

`/reportes/rotacion-mesas` (`src/core/reportes/rotacion-mesas.ts` + `src/app/(app)/reportes/rotacion-mesas/page.tsx`). Mismo
permiso `ver_reportes_operativos` que ya existe (sin migración de permisos) y mismo selector de rango que Período/Categorías
(`SelectorRango`, rango en UTC).

- **"Atendidas"** = cuentas cerradas con al menos un `CuentaItem` (aunque el neto haya quedado en cero). Las liberadas SIN
  consumo (`liberarMesa`) se cuentan aparte y no entran en ninguna métrica.
- Cuentas con `comensales: NULL` entran en los conteos generales (atendidas, franja horaria) pero no en el promedio de
  comensales ni en el desglose por tamaño de grupo.
- Métricas: comensales/cuenta promedio, duración de mesa promedio, rotación por franja horaria y por tamaño de grupo
  ("1".."6", "7+" — mismo rango que los botones rápidos del modal).
- **Zona horaria:** a diferencia del resto de los reportes de motor2 (rango de fechas en UTC), la FRANJA HORARIA de cada
  cuenta usa la hora LOCAL de Argentina (`Intl.DateTimeFormat` con `timeZone: "America/Argentina/Buenos_Aires"`, nunca un
  offset fijo `-03:00`). El RANGO de fechas sigue en UTC, igual que siempre — solo la franja horaria difiere.

## Notas para la próxima tarea (#14, clientes con descuento)

- `Cuenta.comensales` quedó como una columna simple y aislada (`Int?`, sin FK, sin índice, sin tocar ningún otro campo del
  modelo): el próximo `ADD COLUMN` de #14 es trivial de combinar con este en la misma migración si hace falta, o va en la
  suya propia sin ningún conflicto de esquema.
- `cerrarCuenta` (`src/server/actions/pos/cuenta.ts`) **no cambió**: sigue exactamente como antes de esta task (arma las
  líneas netas, registra la venta con `registrarVentaEnTx`, numera la boleta y cierra la cuenta). `Cuenta.comensales` no
  participa del cálculo de la venta ni de la boleta — es un dato que viaja "al costado", leído solo por el reporte de
  rotación. #14 puede seguir agregando su campo de descuento a `Cuenta` y su lógica a `cerrarCuenta` sin que este cambio le
  estorbe.
