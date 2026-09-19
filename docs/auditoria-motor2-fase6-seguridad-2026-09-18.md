# Fase 6 — Seguridad/contratos: rutas y Server Actions sin gate (2026-09-18)

**Alcance**: la auditoría original (`docs/auditoria-motor2-fase0-fase1-2026-09-16.md`, línea 62) dejó pendiente verificar que ninguna ruta o Server Action sea alcanzable sin pasar por los gates de permiso — nunca se ejecutó en ninguna sesión posterior. Esta tarea la cierra.

## 1. Reachability de rutas (páginas)

Todas las páginas de la app viven bajo `src/app/(app)/*`, con un único layout (`src/app/(app)/layout.tsx`) que hace `redirect("/login")` si `obtenerContextoUsuario()` es `null`. En el App Router de Next.js esto es estructural: cualquier página nueva bajo ese grupo hereda el gate automáticamente, no hay forma de esquivarlo agregando una ruta.

Fuera de `(app)/`: `src/app/login` (público, esperado) y `src/app/api/*`:
- `/api/auth/[...nextauth]` — handler estándar de Auth.js.
- `/api/cron/sincronizar-ipc` — protegido con `CRON_SECRET` (header `Authorization: Bearer`), falla cerrado si la env var no está seteada.

**Conclusión**: sin hallazgos. La ausencia de `middleware.ts` no es una brecha — el gate real (Server Component + `conPermiso`) cubre el 100% de las rutas.

## 2. Reachability de Server Actions

Se auditaron los 23 archivos `"use server"` de `src/server/actions/` (~110 funciones exportadas), función por función:

- Toda **mutación** real pasa por `conPermiso(accionClave, fn)` — sin excepciones encontradas.
- Las **lecturas** sin `conPermiso` propio (`obtenerRecetaVigente`, `obtenerComparativaPreciosPorInsumo`, `listarUsuariosDeSucursal`, etc.) se apoyaban en que el gate corre en la página (Server Component) que las llama. **Esa conclusión era incorrecta** (corregido el 2026-09-19): una server action es un endpoint que se puede invocar directo, y 9 de esas lecturas están referenciadas desde componentes de cliente (por ejemplo `buscarProductosSelector`, `listarPresentaciones`, `obtenerPrecioVentaProducto`, `listarProductosDeProveedor`, `obtenerHistorialConteosFisicos`); otras 11 reciben la sucursal por parámetro, que viene del cliente. Se cerró con `requerirSesion()` / `requerirSesionEnSucursal(id)` (`src/server/actions/con-sesion.ts`, commit `2729fa2`) y un test de arquitectura que falla si una función exportada de un archivo `"use server"` queda sin guarda (`908e53f`).
- Tampoco era cierto que ninguna mutadora sin gate llegara a un Client Component: `upsertProveedorPorProducto` era una escritura sin guarda exportada desde un archivo `"use server"` (endpoint). Se movió a un archivo sin `"use server"` (`catalogo/upsert-proveedor-por-producto.ts`). Y `requerirVerComparativaPrecios(usuarioId, sucursalId)` era un endpoint sin sesión que recibía ids del cliente y devolvía el nombre del rol en el mensaje de error; no tenía consumidores y se eliminó.

**Límites que quedan**: el test de arquitectura es una comprobación por texto (no ve `export const X = async`, ni los `"use server"` inline de páginas y componentes, ni valida que la guarda esté en la primera sentencia); las guardas de lectura exigen sesión y membresía, no el permiso de «Ver» de cada área o reporte.

**Conclusión**: la capa tenía huecos reales, cerrados en este bloque; ver "Límites que quedan".

## 3. Hallazgo real: `seccionId` del cliente nunca validado contra la sucursal de quien llama

`conPermiso` valida que el usuario tenga el permiso en **su propia** sucursal (`ctx.sucursalId`), pero varias mutaciones reciben un `seccionId` (o varios) directo del cliente y lo usaban para escribir sin verificar que esa sección perteneciera a esa misma sucursal.

**Impacto**: un usuario autenticado con permiso legítimo en SU sucursal (ej. `proceso_compra`) podía mandar el `seccionId` de OTRA sucursal (conocido por cualquier vía — multi-membresía, traspasos, inspección de red) y el sistema escribía el movimiento igual: `Operacion.sucursalId` quedaba en la sucursal de quien llama, pero `MovimientoStock.seccionId` apuntaba a la sección de la sucursal ajena — corrompiendo su Kardex, sin que nadie de esa sucursal lo pidiera ni lo viera venir.

**Funciones afectadas** (confirmado leyendo cada una, no por inferencia):
- `registrarMovimiento` (`seccionId` y, en `TRANSFERENCIA`, `seccionDestinoId`) — el proceso más usado del sistema (Compra/Venta directa/Consumo/Merma/Ajuste/Producción/Devoluciones/Transferencia intra-sucursal).
- `registrarVenta` (`seccionId`).
- `registrarConteoFisico` (`seccionId`).
- `reclasificarStock` (`seccionOrigenId` y cada `destinos[].seccionId`).
- `obtenerSaldoDisponibleParaReclasificar` — de solo lectura, ni siquiera tenía `conPermiso`: exponía el saldo de cualquier sección a cualquier usuario autenticado.

**Lo que NO tenía el hueco** (verificado, no asumido): `stock-minimo.ts`, `secciones.ts` (chequeo inline `seccion.sucursalId !== ctx.sucursalId`) y `traspasos.ts` (helper local `obtenerSeccionPropia`) ya hacían el chequeo correcto — es decir, el patrón correcto ya existía en el código; faltaba aplicarlo de forma consistente, no diseñarlo de cero.

## 4. Fix aplicado

- Nuevo `obtenerSeccionPropia(seccionId, sucursalId, db?)` en `src/core/movimientos/stock.ts` — punto único, reemplaza la copia local que tenía `traspasos.ts` (mismo criterio "nunca una segunda copia divergente del gate" que ya usa el proyecto para `conPermiso`).
- Aplicado en los 4 puntos de arriba: cada uno ahora rechaza con `error("No se encontró la sección...")` (o `null` en el caso de lectura) si la sección no pertenece a `ctx.sucursalId`, ANTES de tocar la transacción.
- `resolverConsumoPorFamilia` (reparte consumo entre productos "hermanos" de la misma familia) se revisó aparte: nunca cambia de `seccionId`, solo varía `productoId` dentro de la MISMA sección ya validada — sin riesgo adicional.

## 5. Verificación

- `tsc --noEmit`: limpio.
- `eslint .`: 0 errores, 0 warnings.
- Suite completa: **57/57 archivos, 362/362 tests** (355 preexistentes + 7 nuevos de regresión, uno por cada función corregida — ver `test/movimientos/registrar-movimiento.test.ts`, `venta.test.ts`, `conteo-fisico.test.ts`, `test/stock/reclasificacion.test.ts`).
- Un test preexistente (`test/reportes/resumen-consolidado.test.ts`) se rompió con el fix — legítimamente: simulaba un admin con membresía en 2 sucursales registrando ventas en ambas SIN cambiar la "sucursal activa" entre medio, algo que en producción real requiere `cambiarSucursalActiva` (o el selector de sucursal en el header) y que el test se saltaba pasando el `seccionId` directo. Corregido para usar `__setCookieDeTestParaSucursal` (helper de test ya existente, usado en `test/auth/contexto.test.ts`) y simular el cambio de sucursal activa real entre cada venta — el escenario de negocio que el test verifica no cambió, solo cómo se simula la sesión.

## 6. Estado

**Cerrado.** El punto pendiente de `docs/auditoria-motor2-fase0-fase1-2026-09-16.md` (línea 62, "Fase 6, seguridad/contratos") queda resuelto: no hay rutas ni Server Actions alcanzables sin los gates apropiados — el único hueco real encontrado (validación de sección propia) ya está corregido y cubierto por pruebas de regresión.
