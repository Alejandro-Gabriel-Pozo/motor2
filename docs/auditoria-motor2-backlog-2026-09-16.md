# Auditoría motor2 — backlog consolidado (2026-09-16)

Este documento consolida los hallazgos de la auditoría de 6 módulos de motor2 (core-administración, catálogo, movimientos, stock, reportes, traspasos) realizada el 16/09/2026, junto con los pendientes ya identificados en rondas anteriores. Los hallazgos nuevos están agrupados por módulo y ordenados por prioridad (alta primero); al cierre se propone un orden de ataque sugerido.

## Ya resuelto hoy

- **Rendimiento real de recetas — venta directa marcada.**

## Pendiente, ya identificado antes de esta auditoría

- ~~Sidebar sin ningún mecanismo de colapso, en ningún tamaño de pantalla~~ — **resuelto (2026-09-16)**. Nuevo `SidebarColapsable` (toggle siempre visible, preferencia persistida en localStorage) (commit `a3c8c51`).
- ~~Costos y márgenes sin explicación de fórmula (Margen $/%, Food cost %, umbral 40% hardcodeado)~~ — **resuelto (2026-09-16)**. `ayuda` en las columnas Margen/Food cost %/Estado (commit `54b56ce`).
- ~~Proveedores sin edición~~ — **resuelto (2026-09-16)**. Nueva `actualizarProveedor` (nombre queda fuera a propósito) + link "Editar" por fila (commit `7d5ae55`).
- Diferencias de ajuste: el grupo "Solo receta" queda en "ESPERADO" sin sugerir cuánto debería cambiar la Merma% ni linkear a la receta.
- Ficha técnica de Recetas (cabecera: rendimiento/raciones/tiempos) es un form siempre editable, sin modo vista — a diferencia de Ingredientes/Pasos en la misma página.

## Hallazgos nuevos de la auditoría

### core-administracion

**Prioridad alta**

- ~~**La auto-protección de CapacidadSucursal no cubre gestion_usuarios/gestion_permisos, a diferencia de PermisoRol.**~~ — **resuelto (2026-09-16)**. `sucursalTieneCapacidad` ahora extiende la auto-protección a `ACCIONES_QUE_REQUIEREN_ADMIN_SIEMPRE` (commit `a3e1641`).
- ~~**User.activoGlobal: kill-switch de cuenta documentado en el schema pero nunca implementado.**~~ — **resuelto (2026-09-16)**. Nueva `actualizarActivoGlobalUsuario` (misma salvaguarda "nunca sin ningún admin activo", cruzando sucursales) enforzada en `emailPuedeIniciarSesion` (login nuevo) y en el callback `session` de NextAuth (sesión ya abierta, corta en la próxima request); columna "Cuenta" + botón Desactivar/Reactivar en /administracion/usuarios (commit `270977f`).
- ~~**Toda sesión nueva aterriza en una página admin-only, sin importar el rol.**~~ — **resuelto (2026-09-16)**. `/` y `/login` ahora redirigen a `/reportes` (sin gate de Acción, abierto a cualquier rol) en vez de `/administracion/usuarios` (commit `96d33be`).

**Prioridad media**

- ~~**Sucursales: se puede crear pero nunca desactivar ni editar.**~~ — **resuelto (2026-09-16)**. Nuevas `actualizarActivoSucursal`/`renombrarSucursal` (mismo gate `alta_sucursal`), UI cableada con `FormConResultado` (commit `86aa234`).
- ~~**Crear un rol nuevo no guía a configurarle permisos.**~~ — **resuelto (2026-09-16)**. Aviso fijo + link a /administracion/permisos junto al form de alta (commit `b7a19b0`).

**Prioridad baja**

- ~~**El campo "notas" de la membresía no se puede ver ni editar desde la UI.**~~ — **resuelto (2026-09-16)**. Nueva `actualizarNotasMembresia`; columna editable inline + campo en el form de alta (commit `30abbb2`).

### catalogo

**Prioridad alta**

- ~~**El tipo (MP/PV) se puede "cambiar" al editar un producto, pero el cambio se descarta en silencio.**~~ — **resuelto (2026-09-16)**. Tratado como inmutable post-alta (mismo criterio que el código): la UI ya no muestra los radios al editar, y `actualizarProducto` rechaza explícito si igual llega un tipo distinto (commit `0850a85`).
- ~~**"Renombrar/fusionar" un Insumo no valida unidad de stock mezclada, y fusiona sin confirmación ni feedback.**~~ — **resuelto (2026-09-16)**. Nueva `validarFusionInsumos` (mismo criterio que `validarUnidadInsumo`, sobre cada unidad distinta del insumo origen) bloquea la fusión antes de mover nada; `previsualizarFusionInsumo` + un paso de confirmación explícito en el cliente avisan qué se va a fusionar antes de aplicarlo, y el resultado (éxito o error) ahora se muestra siempre (commit `eac35f0`).
- ~~**El editor de recetas descarta todos los resultados de error — agregar/editar/quitar ingrediente o paso fallan en silencio.**~~ — **resuelto (2026-09-16)**. Nuevo `FormConResultado` (components/form-con-resultado.tsx) envuelve las 7 mutaciones de la página (ficha técnica, ingredientes, pasos) y muestra siempre el mensaje, sin tocar la firma de ninguna server action (commit `6f0dc53`).
- ~~**Presentación de compra alternativa: existe en el modelo y se usa al registrar compras, pero no hay ninguna pantalla para crearla.**~~ — **resuelto (2026-09-16)**. Nueva sección en /catalogo/productos (editando un MP) para crear/activar/desactivar presentaciones, más un selector de "Presentación" en el form de Compra/Devolución a Proveedor cuando el producto elegido tiene alguna activa (commit `4d96907`).

**Prioridad media**

- ~~**El historial de versiones de receta solo muestra ingredientes — pasos y ficha técnica quedan invisibles aunque se versionan juntos.**~~ — **resuelto (2026-09-16)**. `listarVersionesDeReceta` ya traía todo (`INCLUDE_RECETA_COMPLETA`); ahora la pantalla también renderiza el resumen de ficha técnica y los pasos por versión (commit `5877da4`).

### movimientos

**Prioridad alta**

- ~~**Una Venta confirmada no se puede anular ni corregir.**~~ — **resuelto (2026-09-16)**. `anularVenta` (gate `anular_venta`, admin-only) revierte el consumo y la Liquidación de consignación con una Operacion AJUSTE nueva, marca la venta original `anuladaEn`/`anuladaPorId` (migración aditiva) — botón "Anular venta" en Trazabilidad (commit `b347e61`).
- ~~**exigeSeccion existe en el dominio pero la UI nunca lo lee.**~~ — **resuelto (2026-09-16)**. `PROCESOS_UI` ahora deriva `exigeSeccion` de `TRANSICIONES` (nunca a mano); Compra/Producción/Transferencia/Dev. cliente/Venta preseleccionan la primera sección activa (no había ninguna sección "General" seedeada para asumir ese nombre), el resto sigue arrancando vacío — el campo sigue obligatorio en los 9 (commit `fab4cee`).

**Prioridad media**

- ~~**El selector de producto del panel genérico no filtra por proceso, a diferencia de Venta y Conteo Físico.**~~ — **resuelto (2026-09-16)**. Nuevo `filtroProducto` en `ProcesoUiConfig`, derivado por proceso espejando `productoValidoParaProceso` (Compra solo MP, Dev. consignación/proveedor filtran por `esConsignacion`, el resto exige stock real) (commit `18af7b4`).
- ~~**Ajuste de stock: nada en la UI indica que la cantidad puede ser negativa.**~~ — **resuelto (2026-09-16)**. `AyudaIcono` + placeholder junto al campo Cantidad, solo cuando `config.cantidadConSigno` (commit `fac9d40`).
- ~~**Cancelar/ajustar un conteo físico resuelto o pendiente actúa al instante, sin confirmación.**~~ — **resuelto (2026-09-16)**. Paso de confirmación inline (mismo patrón que `FormRenombrarInsumo`) antes de escribir el ajuste o la reversión; el resultado ahora se muestra siempre (commit `aa02bb1`).

**Prioridad baja**

- ~~**Las 3 acciones de Conteo Físico (Ajustar/Falta movimiento/Descartar) no se explican en la UI.**~~ — **resuelto (2026-09-16)**. `AyudaIcono` en el header "Acción" + `title` nativo por opción (commit `920f0f8`).
- ~~**Secciones no se puede editar el nombre una vez creada.**~~ — **resuelto (2026-09-16)**. Nueva `renombrarSeccion` (commit `feb5af0`).

### stock

**Prioridad alta**

- ~~**Alertas de stock ignora un Stock Mínimo explícito de 0 (y puede ocultar saldo negativo).**~~ — **resuelto (2026-09-16)**. La resolución en memoria de `calcularAlertasStock` ahora distingue "ninguna fila cargada" (null, se saltea) de "mínimo cargado en 0" (participa como umbral real), mismo criterio que `resolverStockMinimo` (commit `59f7cb4`).

**Prioridad media**

- ~~**Reclasificar no muestra el saldo disponible antes de enviar, a diferencia de su hermano Conteo Físico.**~~ — **resuelto (2026-09-16)**. Nueva `obtenerSaldoDisponibleParaReclasificar`, consultada al cambiar producto/sección/lote origen — "Disponible en origen: X" antes del submit (commit `f1f4464`).
- ~~**"Eliminar" en Stock Mínimo es la única acción de borrado duro de la app y no pide confirmación.**~~ — **resuelto (2026-09-16)**. Paso de confirmación inline antes de borrar la fila (commit `6deb789`).

**Prioridad baja**

- ~~**Reclasificar no impide un destino idéntico al origen (sección+lote), generando un par de movimientos Kardex sin efecto real.**~~ — **resuelto (2026-09-16)**. Rechazado cuando hay un único destino idéntico al origen; repartir entre 2+ sigue permitido (commit `9ab628d`).
- ~~**Stock Mínimo no ofrece "editar" desde la fila.**~~ — **resuelto (2026-09-16)**. Link "Editar" por fila (`?editar=<id>`) que precarga el form (commit `9f9f040`).

### reportes

**Prioridad alta**

- ~~**Consignación: "Debido por consignante" nunca se salda — no hay forma de registrar el pago.**~~ — **resuelto (2026-09-16)**. Nuevo modelo `PagoConsignante` (append-only) + `registrarPagoConsignante` (admin-only); el reporte muestra liquidado/pagado/saldo debido con un botón "Registrar pago" por fila, más un filtro de período opcional (commit `c633f62`).

**Prioridad media**

- ~~**Salud por producto muestra los estados de Stock Consolidado en crudo, sin la humanización/color ya definidos en Stock Consolidado.**~~ — **resuelto (2026-09-16)**. Extraídas a `core/stock/estado-consolidado-ui.ts` (separado de `consolidado.ts`, que importa `prisma` — ver el commit, el primer intento co-localizado rompió el build de Turbopack), ambas pantallas ahora comparten la misma fuente (commit `cf5ca76`).
- ~~**Historial de conteos: filtro por sección ya soportado en el servidor pero nunca expuesto en la página.**~~ — **resuelto (2026-09-16)**. Firma refactorizada a un objeto de opciones (seccionId/productoId/desde/hasta/cursor); nuevo `FiltrosConteos` (mismo patrón que `/reportes/historial`), "Página siguiente" preserva los filtros (commit `a33f186`).
- ~~**Promociones: período fijo "este mes", sin filtro desde/hasta como el resto de los reportes de venta.**~~ — **resuelto (2026-09-16)**. Form desde/hasta (mismo default que Reporte por período) — `obtenerReportePromociones` ya soportaba el rango arbitrario (commit `955842d`).

**Prioridad baja**

- ~~**Reporte por período: el aviso de "compras sin precio" se calcula pero nunca se muestra.**~~ — **resuelto (2026-09-16)**. `rep.compras.aviso` ahora se renderiza, mismo patrón que ventas/margen (commit `610e1b2`).
- ~~**Vencimientos: el criterio "consistente" vs. "revisar" de la conciliación no se explica en la pantalla.**~~ — **resuelto (2026-09-16)**. Nuevo campo `ayuda` en `ColumnaReporte` (genérico, reusable en cualquier reporte), usado en la columna "Estado" (commit `934f65a`).
- ~~**Valuación de inventario usa una tabla HTML cruda, sin el orden/export CSV que sí tiene el resto de los reportes.**~~ — **resuelto (2026-09-16)**. Migrado a `TablaReporte` (commit `2e76640`).

### traspasos

**Prioridad alta**

- ~~**La cantidad de una solicitud PULL entra al Kardex sin redondear a los decimales de la unidad.**~~ — **resuelto (2026-09-16)**. `crearSolicitudTransferencia` ahora redondea con `redondearACantidadDeUnidad`, mismo criterio que `crearEnvioDirectoTransferencia` (commit `bfd0ec0`).
- ~~**Los traspasos que el propio usuario inició y todavía están en curso se muestran mezclados en "Historial", no como pendientes.**~~ — **resuelto (2026-09-16)**. `condicionesEnCurso()` ahora cubre ambos casos (distinguiendo por `iniciadoPor` para no confundir un PULL ya aprobado con un PUSH propio); nuevo bucket "Esperando respuesta" en la Bandeja, separado de Historial (commit `4a9bc7d`).
- ~~**Quien crea una solicitud PULL (SOLICITADA) no tiene ninguna forma de cancelarla ella misma.**~~ — **resuelto (2026-09-16)**. Nueva `cancelarSolicitudTransferencia` (estado `CANCELADA`), disponible mientras sigue SOLICITADA — nunca tocó stock en ese estado (commit `4a9bc7d`).

**Prioridad media**

- ~~**El detalle y el motivo de rechazo se calculan pero nunca se muestran en la tabla de Historial.**~~ — **resuelto (2026-09-16)**. Nueva columna "Detalle" (detalle libre, motivo de rechazo, secciones, creado por) (commit `6627ca1`).

## Top 5 recomendado para atacar primero

Los 5 quedaron resueltos el 2026-09-16, en este orden:

1. ~~**Toda sesión nueva aterriza en una página admin-only (core-administracion)**~~ — bloqueaba el uso básico de la app para la mayoría de los usuarios (operadores) desde el primer login. Commit `96d33be`.
2. ~~**La auto-protección de CapacidadSucursal no cubre gestion_usuarios/gestion_permisos (core-administracion)**~~ — un solo clic podía dejar a todos los admins de todas las sucursales sin acceso a Usuarios o Permisos. Commit `a3e1641`.
3. ~~**Una Venta confirmada no se puede anular ni corregir (movimientos)**~~ — no había forma de arreglar un error de carga en la operación más frecuente del sistema. Commit `b347e61`.
4. ~~**El tipo (MP/PV) se descarta en silencio al editar un producto (catalogo)**~~ — corrompía el catálogo sin ningún aviso, con impacto en costos y recetas aguas abajo. Commit `0850a85`.
5. ~~**La cantidad de una solicitud PULL entra al Kardex sin redondear (traspasos)**~~ — rompía un invariante de datos ya documentado y contaminaba la trazabilidad de stock en 3 puntos del ciclo. Commit `bfd0ec0`.

Los 29 hallazgos restantes (todo "prioridad media" y "prioridad baja" de los 6 módulos) quedaron resueltos el 2026-09-16, uno por uno, en el mismo orden en que aparecen arriba — ver cada bullet tachado para su commit. Los 34 hallazgos de "Hallazgos nuevos de la auditoría" quedan cerrados por completo.

Sigue abierta la sección "Pendiente, ya identificado antes de esta auditoría" (arriba del todo) — esos 5 ítems son de una ronda anterior, no del audit de los 6 módulos, y no se tocaron en esta pasada.