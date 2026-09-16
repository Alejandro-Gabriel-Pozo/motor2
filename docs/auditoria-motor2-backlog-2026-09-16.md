# Auditoría motor2 — backlog consolidado (2026-09-16)

Este documento consolida los hallazgos de la auditoría de 6 módulos de motor2 (core-administración, catálogo, movimientos, stock, reportes, traspasos) realizada el 16/09/2026, junto con los pendientes ya identificados en rondas anteriores. Los hallazgos nuevos están agrupados por módulo y ordenados por prioridad (alta primero); al cierre se propone un orden de ataque sugerido.

## Ya resuelto hoy

- **Rendimiento real de recetas — venta directa marcada.**

## Pendiente, ya identificado antes de esta auditoría

- Sidebar sin ningún mecanismo de colapso, en ningún tamaño de pantalla (src/components/app-shell.tsx:17, `w-56 flex-shrink-0`, sin toggle ni estado) — no es un problema exclusivo de mobile (en desktop tampoco se puede achicar para ganar espacio en tablas anchas como Costos o Rendimiento real de recetas), pero en mobile el efecto es mucho más grave: 224px fijos sobre ~400px de pantalla le comen más de la mitad al contenido.
- Costos y márgenes sin explicación de fórmula (Margen $/%, Food cost %, umbral 40% hardcodeado) — agregar AyudaIcono como ya se hizo en Rendimiento real de recetas.
- Proveedores sin edición (src/app/(app)/catalogo/proveedores/page.tsx) — solo Activar/Desactivar, no se puede corregir contacto/teléfono/email/CUIT/condiciones de pago de uno ya creado.
- Diferencias de ajuste: el grupo "Solo receta" queda en "ESPERADO" sin sugerir cuánto debería cambiar la Merma% ni linkear a la receta.
- Ficha técnica de Recetas (cabecera: rendimiento/raciones/tiempos) es un form siempre editable, sin modo vista — a diferencia de Ingredientes/Pasos en la misma página.

## Hallazgos nuevos de la auditoría

### core-administracion

**Prioridad alta**

- ~~**La auto-protección de CapacidadSucursal no cubre gestion_usuarios/gestion_permisos, a diferencia de PermisoRol.**~~ — **resuelto (2026-09-16)**. `sucursalTieneCapacidad` ahora extiende la auto-protección a `ACCIONES_QUE_REQUIEREN_ADMIN_SIEMPRE` (commit `a3e1641`).
- ~~**User.activoGlobal: kill-switch de cuenta documentado en el schema pero nunca implementado.**~~ — **resuelto (2026-09-16)**. Nueva `actualizarActivoGlobalUsuario` (misma salvaguarda "nunca sin ningún admin activo", cruzando sucursales) enforzada en `emailPuedeIniciarSesion` (login nuevo) y en el callback `session` de NextAuth (sesión ya abierta, corta en la próxima request); columna "Cuenta" + botón Desactivar/Reactivar en /administracion/usuarios (commit `270977f`).
- ~~**Toda sesión nueva aterriza en una página admin-only, sin importar el rol.**~~ — **resuelto (2026-09-16)**. `/` y `/login` ahora redirigen a `/reportes` (sin gate de Acción, abierto a cualquier rol) en vez de `/administracion/usuarios` (commit `96d33be`).

**Prioridad media**

- **Sucursales: se puede crear pero nunca desactivar ni editar.** Solo existe alta (crearSucursalConAdmin); no hay actualizarActivoSucursal ni acción de renombrar, aunque Sucursal.activo se usa como filtro real en otros módulos (ej. traspasos).
- **Crear un rol nuevo no guía a configurarle permisos.** crearRol no siembra PermisoRol (correcto por deny-by-default), pero no hay link a /administracion/permisos ni mensaje de siguiente paso — un rol recién creado y asignado puede dejar a alguien con sesión válida y sin poder hacer nada, sin ningún error explicativo.

**Prioridad baja**

- **El campo "notas" de la membresía no se puede ver ni editar desde la UI.** Se llena solo por flujos automáticos de bootstrap; el form de alta manual y la tabla de membresías no lo exponen.

### catalogo

**Prioridad alta**

- ~~**El tipo (MP/PV) se puede "cambiar" al editar un producto, pero el cambio se descarta en silencio.**~~ — **resuelto (2026-09-16)**. Tratado como inmutable post-alta (mismo criterio que el código): la UI ya no muestra los radios al editar, y `actualizarProducto` rechaza explícito si igual llega un tipo distinto (commit `0850a85`).
- ~~**"Renombrar/fusionar" un Insumo no valida unidad de stock mezclada, y fusiona sin confirmación ni feedback.**~~ — **resuelto (2026-09-16)**. Nueva `validarFusionInsumos` (mismo criterio que `validarUnidadInsumo`, sobre cada unidad distinta del insumo origen) bloquea la fusión antes de mover nada; `previsualizarFusionInsumo` + un paso de confirmación explícito en el cliente avisan qué se va a fusionar antes de aplicarlo, y el resultado (éxito o error) ahora se muestra siempre (commit `eac35f0`).
- ~~**El editor de recetas descarta todos los resultados de error — agregar/editar/quitar ingrediente o paso fallan en silencio.**~~ — **resuelto (2026-09-16)**. Nuevo `FormConResultado` (components/form-con-resultado.tsx) envuelve las 7 mutaciones de la página (ficha técnica, ingredientes, pasos) y muestra siempre el mensaje, sin tocar la firma de ninguna server action (commit `6f0dc53`).
- ~~**Presentación de compra alternativa: existe en el modelo y se usa al registrar compras, pero no hay ninguna pantalla para crearla.**~~ — **resuelto (2026-09-16)**. Nueva sección en /catalogo/productos (editando un MP) para crear/activar/desactivar presentaciones, más un selector de "Presentación" en el form de Compra/Devolución a Proveedor cuando el producto elegido tiene alguna activa (commit `4d96907`).

**Prioridad media**

- **El historial de versiones de receta solo muestra ingredientes — pasos y ficha técnica quedan invisibles aunque se versionan juntos.** guardarReceta versiona ingredientes/pasos/cabecera como una unidad, pero la pantalla de Historial solo renderiza `v.ingredientes`; un cambio solo en pasos o cabecera aparece indistinguible de la versión anterior.

### movimientos

**Prioridad alta**

- ~~**Una Venta confirmada no se puede anular ni corregir.**~~ — **resuelto (2026-09-16)**. `anularVenta` (gate `anular_venta`, admin-only) revierte el consumo y la Liquidación de consignación con una Operacion AJUSTE nueva, marca la venta original `anuladaEn`/`anuladaPorId` (migración aditiva) — botón "Anular venta" en Trazabilidad (commit `b347e61`).
- ~~**exigeSeccion existe en el dominio pero la UI nunca lo lee.**~~ — **resuelto (2026-09-16)**. `PROCESOS_UI` ahora deriva `exigeSeccion` de `TRANSICIONES` (nunca a mano); Compra/Producción/Transferencia/Dev. cliente/Venta preseleccionan la primera sección activa (no había ninguna sección "General" seedeada para asumir ese nombre), el resto sigue arrancando vacío — el campo sigue obligatorio en los 9 (commit `fab4cee`).

**Prioridad media**

- **El selector de producto del panel genérico no filtra por proceso, a diferencia de Venta y Conteo Físico.** panel-movimiento-form.tsx hardcodea `filtro={{ soloActivos: true }}` para los 9 procesos, así que se puede elegir un PV en Compra o un producto no-consignación en Devolución al consignante, y el error recién aparece al confirmar el formulario completo.
- **Ajuste de stock: nada en la UI indica que la cantidad puede ser negativa.** cantidadConSigno está definido para Ajuste (único proceso con delta firmado) pero panel-movimiento-form.tsx nunca lo lee; no hay placeholder ni ayuda que indique que "-5" es válido.
- **Cancelar/ajustar un conteo físico resuelto o pendiente actúa al instante, sin confirmación.** Los botones "Cancelar" y "Ajustar ahora" son forms conectados directo al server action, sin window.confirm ni diálogo intermedio, siendo las dos acciones del módulo con más potencial de tocar stock por error de un clic.

**Prioridad baja**

- **Las 3 acciones de Conteo Físico (Ajustar/Falta movimiento/Descartar) no se explican en la UI.** La diferencia de impacto sobre el stock solo está documentada en un comentario del server; el select no tiene tooltip ni AyudaIcono (que ya existe en el proyecto para esto).
- **Secciones no se puede editar el nombre una vez creada.** Solo Crear y Activar/Desactivar; la única salida es desactivar y crear una nueva, fragmentando el historial del Kardex. Mismo patrón de hueco ya señalado para Proveedores en la sección de pendientes conocidos, pero no cubierto acá tampoco.

### stock

**Prioridad alta**

- ~~**Alertas de stock ignora un Stock Mínimo explícito de 0 (y puede ocultar saldo negativo).**~~ — **resuelto (2026-09-16)**. La resolución en memoria de `calcularAlertasStock` ahora distingue "ninguna fila cargada" (null, se saltea) de "mínimo cargado en 0" (participa como umbral real), mismo criterio que `resolverStockMinimo` (commit `59f7cb4`).

**Prioridad media**

- **Reclasificar no muestra el saldo disponible antes de enviar, a diferencia de su hermano Conteo Físico.** El usuario tiene que adivinar la cantidad a repartir y recién ve el saldo real si la suma no cierra y el servidor lo informa en el mensaje de error, en vez de mostrarlo antes del submit como sí hace Conteo Físico.
- **"Eliminar" en Stock Mínimo es la única acción de borrado duro de la app y no pide confirmación.** Un clic accidental borra la fila (no es un movimiento de Kardex reversible) y deja de alertar silenciosamente sobre un producto/sección.

**Prioridad baja**

- **Reclasificar no impide un destino idéntico al origen (sección+lote), generando un par de movimientos Kardex sin efecto real.** Si origen y único destino coinciden, la operación se acepta y genera dos filas que se cancelan entre sí, agregando ruido a la trazabilidad.
- **Stock Mínimo no ofrece "editar" desde la fila.** Hay que rebuscar producto y sección desde cero cada vez que se quiere ajustar un mínimo existente, con riesgo de crear una fila duplicada por error de sección.

### reportes

**Prioridad alta**

- ~~**Consignación: "Debido por consignante" nunca se salda — no hay forma de registrar el pago.**~~ — **resuelto (2026-09-16)**. Nuevo modelo `PagoConsignante` (append-only) + `registrarPagoConsignante` (admin-only); el reporte muestra liquidado/pagado/saldo debido con un botón "Registrar pago" por fila, más un filtro de período opcional (commit `c633f62`).

**Prioridad media**

- **Salud por producto muestra los estados de Stock Consolidado en crudo, sin la humanización/color ya definidos en Stock Consolidado.** El mismo tipo EstadoStockConsolidado ya tiene etiquetas legibles y color en otra pantalla del propio código base, pero acá se imprime el enum tal cual ("NEGATIVO", "CON_DESVIO").
- **Historial de conteos: filtro por sección ya soportado en el servidor pero nunca expuesto en la página.** obtenerHistorialConteosFisicos acepta seccionId, pero la página siempre pasa undefined; tampoco hay filtro por producto ni rango de fechas, a diferencia de casi todos los demás reportes del módulo.
- **Promociones: período fijo "este mes", sin filtro desde/hasta como el resto de los reportes de venta.** La función sí soporta un rango arbitrario, pero la página lo hardcodea y no ofrece formulario de fecha.

**Prioridad baja**

- **Reporte por período: el aviso de "compras sin precio" se calcula pero nunca se muestra.** El mismo tipo de aviso sí se muestra para Ventas y Margen en la misma pantalla, pero `rep.compras.aviso` no se renderiza en ningún lado.
- **Vencimientos: el criterio "consistente" vs. "revisar" de la conciliación no se explica en la pantalla.** La regla real (ventasPeriodo vs. conteoReal) solo está en un comentario del código; la UI solo colorea la palabra sin tooltip ni leyenda.
- **Valuación de inventario usa una tabla HTML cruda, sin el orden/export CSV que sí tiene el resto de los reportes.** Todos los demás reportes usan el componente compartido TablaReporte; Valuación, que es justo el caso de uso pensado para llevar a una planilla contable, no.

### traspasos

**Prioridad alta**

- ~~**La cantidad de una solicitud PULL entra al Kardex sin redondear a los decimales de la unidad.**~~ — **resuelto (2026-09-16)**. `crearSolicitudTransferencia` ahora redondea con `redondearACantidadDeUnidad`, mismo criterio que `crearEnvioDirectoTransferencia` (commit `bfd0ec0`).
- **Los traspasos que el propio usuario inició y todavía están en curso se muestran mezclados en "Historial", no como pendientes.** condicionesEnCurso() no cubre "soy destino y mi SOLICITADA espera respuesta de origen" ni "soy origen y mi ENVIADA (push) espera respuesta de destino". Esos casos caen en la tabla de Historial junto con traspasos realmente cerrados, sin ninguna marca visual que los distinga, y pueden quedar empujados a una página siguiente por la paginación de a 30.
- **Quien crea una solicitud PULL (SOLICITADA) no tiene ninguna forma de cancelarla ella misma.** crearSolicitudTransferencia aclara que crear una solicitud no toca stock, pero no existe ninguna acción de cancelación para el creador; la única salida es esperar a que la sucursal origen la rechace.

**Prioridad media**

- **El detalle y el motivo de rechazo se calculan pero nunca se muestran en la tabla de Historial.** aFila computa detalle/motivos/secciones/creadoPorEmail para cada traspaso, pero la tabla de Historial solo pinta Fecha/Producto/Cantidad/Otra sucursal/Estado — esa información desaparece de la UI apenas el traspaso se resuelve.

## Top 5 recomendado para atacar primero

Los 5 quedaron resueltos el 2026-09-16, en este orden:

1. ~~**Toda sesión nueva aterriza en una página admin-only (core-administracion)**~~ — bloqueaba el uso básico de la app para la mayoría de los usuarios (operadores) desde el primer login. Commit `96d33be`.
2. ~~**La auto-protección de CapacidadSucursal no cubre gestion_usuarios/gestion_permisos (core-administracion)**~~ — un solo clic podía dejar a todos los admins de todas las sucursales sin acceso a Usuarios o Permisos. Commit `a3e1641`.
3. ~~**Una Venta confirmada no se puede anular ni corregir (movimientos)**~~ — no había forma de arreglar un error de carga en la operación más frecuente del sistema. Commit `b347e61`.
4. ~~**El tipo (MP/PV) se descarta en silencio al editar un producto (catalogo)**~~ — corrompía el catálogo sin ningún aviso, con impacto en costos y recetas aguas abajo. Commit `0850a85`.
5. ~~**La cantidad de una solicitud PULL entra al Kardex sin redondear (traspasos)**~~ — rompía un invariante de datos ya documentado y contaminaba la trazabilidad de stock en 3 puntos del ciclo. Commit `bfd0ec0`.

Quedan 29 hallazgos más (ver arriba, por módulo) sin atacar todavía.