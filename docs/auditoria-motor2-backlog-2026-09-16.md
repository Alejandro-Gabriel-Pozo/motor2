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

- **La auto-protección de CapacidadSucursal no cubre gestion_usuarios/gestion_permisos, a diferencia de PermisoRol.** PermisoRol está blindado explícitamente (ACCIONES_QUE_REQUIEREN_ADMIN_SIEMPRE) para que un admin nunca pueda quitarse a sí mismo el acceso a Usuarios/Permisos. Pero la capa de red (CapacidadSucursal), que se evalúa ANTES que el permiso de rol, solo se auto-protege a sí misma. Un admin puede apagar 'gestion_usuarios' o 'gestion_permisos' en la fila Default desde /administracion/capacidades-sucursal y dejar a TODOS los admins de TODAS las sucursales sin acceso, con un solo clic — exactamente el escenario que la protección de PermisoRol dice evitar, pero sin cubrir en esta capa.
- **User.activoGlobal: kill-switch de cuenta documentado en el schema pero nunca implementado.** El campo existe para desactivar a alguien a nivel sistema sin tocar cada membresía, pero no se lee ni se escribe en ningún lado del código (login, contexto de usuario, server actions). Hoy la única baja posible es desactivar UsuarioSucursal sucursal por sucursal, y aun así la persona puede seguir iniciando sesión si su dominio está permitido o es bootstrap admin — solo queda varada en /login sin sucursal.
- **Toda sesión nueva aterriza en una página admin-only, sin importar el rol.** src/app/page.tsx y /login redirigen siempre a "/administracion/usuarios", gateada solo para 'admin' (rolesEditarSemilla). Cualquier operador ve como primera pantalla el texto rojo "No tenés permiso para ver esta sección...", sin dashboard ni indicación de adónde ir. El sidebar tampoco filtra por permiso, así que no hay ninguna señal visual previa al clic fallido.

**Prioridad media**

- **Sucursales: se puede crear pero nunca desactivar ni editar.** Solo existe alta (crearSucursalConAdmin); no hay actualizarActivoSucursal ni acción de renombrar, aunque Sucursal.activo se usa como filtro real en otros módulos (ej. traspasos).
- **Crear un rol nuevo no guía a configurarle permisos.** crearRol no siembra PermisoRol (correcto por deny-by-default), pero no hay link a /administracion/permisos ni mensaje de siguiente paso — un rol recién creado y asignado puede dejar a alguien con sesión válida y sin poder hacer nada, sin ningún error explicativo.

**Prioridad baja**

- **El campo "notas" de la membresía no se puede ver ni editar desde la UI.** Se llena solo por flujos automáticos de bootstrap; el form de alta manual y la tabla de membresías no lo exponen.

### catalogo

**Prioridad alta**

- **El tipo (MP/PV) se puede "cambiar" al editar un producto, pero el cambio se descarta en silencio.** Los radios de tipo quedan habilitados al editar, pero datosParaGuardar no incluye `tipo` (a diferencia del alta, que sí lo pasa explícito). El usuario ve "Producto actualizado" pero el tipo real en la base queda igual, sin aviso.
- **"Renombrar/fusionar" un Insumo no valida unidad de stock mezclada, y fusiona sin confirmación ni feedback.** validarUnidadInsumo existe justo para evitar mezclar unidades de stock distintas bajo el mismo Insumo, pero renombrarOFusionarInsumo (que reasigna productos en masa y borra el Insumo viejo) nunca la llama. Además el botón no tiene modal de confirmación y descarta el mensaje de resultado — el usuario no se entera de que acaba de fusionar y borrar un Insumo.
- **El editor de recetas descarta todos los resultados de error — agregar/editar/quitar ingrediente o paso fallan en silencio.** Ninguna de las mutaciones captura ni muestra el ResultadoAccion. guardarReceta tiene validaciones reales (cantidad ≤0, merma negativa, insumo duplicado, choque de versión concurrente) que hoy se traducen en "no pasó nada visible" para el usuario, a diferencia del resto del catálogo (producto-form, AsistenteHermanar, QuickCrear).
- **Presentación de compra alternativa: existe en el modelo y se usa al registrar compras, pero no hay ninguna pantalla para crearla.** agregarPresentacionAlternativa y actualizarActivaPresentacion no tienen ningún caller en src/app; el circuito nunca se puede cerrar porque nunca se puede abrir.

**Prioridad media**

- **El historial de versiones de receta solo muestra ingredientes — pasos y ficha técnica quedan invisibles aunque se versionan juntos.** guardarReceta versiona ingredientes/pasos/cabecera como una unidad, pero la pantalla de Historial solo renderiza `v.ingredientes`; un cambio solo en pasos o cabecera aparece indistinguible de la versión anterior.

### movimientos

**Prioridad alta**

- **Una Venta confirmada no se puede anular ni corregir.** A diferencia de Conteo Físico (que tiene resolverConteoPendiente/cancelarConteoFisico), no existe ningún camino para corregir cantidad/producto/precio ni anular una venta. La única salida documentada, "Devolución de cliente", es un concepto de negocio distinto y no corrige cargas mal tipeadas.
- **exigeSeccion existe en el dominio pero la UI nunca lo lee.** TRANSICIONES define exigeSeccion para que Compra/Producción/Devolución de cliente/Venta puedan preseleccionar "General" sin preguntar, pero panel-movimiento-form.tsx y venta-form.tsx nunca lo consultan: el select de Sección siempre arranca vacío y required en los 9 procesos por igual.

**Prioridad media**

- **El selector de producto del panel genérico no filtra por proceso, a diferencia de Venta y Conteo Físico.** panel-movimiento-form.tsx hardcodea `filtro={{ soloActivos: true }}` para los 9 procesos, así que se puede elegir un PV en Compra o un producto no-consignación en Devolución al consignante, y el error recién aparece al confirmar el formulario completo.
- **Ajuste de stock: nada en la UI indica que la cantidad puede ser negativa.** cantidadConSigno está definido para Ajuste (único proceso con delta firmado) pero panel-movimiento-form.tsx nunca lo lee; no hay placeholder ni ayuda que indique que "-5" es válido.
- **Cancelar/ajustar un conteo físico resuelto o pendiente actúa al instante, sin confirmación.** Los botones "Cancelar" y "Ajustar ahora" son forms conectados directo al server action, sin window.confirm ni diálogo intermedio, siendo las dos acciones del módulo con más potencial de tocar stock por error de un clic.

**Prioridad baja**

- **Las 3 acciones de Conteo Físico (Ajustar/Falta movimiento/Descartar) no se explican en la UI.** La diferencia de impacto sobre el stock solo está documentada en un comentario del server; el select no tiene tooltip ni AyudaIcono (que ya existe en el proyecto para esto).
- **Secciones no se puede editar el nombre una vez creada.** Solo Crear y Activar/Desactivar; la única salida es desactivar y crear una nueva, fragmentando el historial del Kardex. Mismo patrón de hueco ya señalado para Proveedores en la sección de pendientes conocidos, pero no cubierto acá tampoco.

### stock

**Prioridad alta**

- **Alertas de stock ignora un Stock Mínimo explícito de 0 (y puede ocultar saldo negativo).** calcularAlertasStock reimplementa su propia resolución y trata cualquier `stockMinimo <= 0` como "sin mínimo configurado", saltando la fila antes de comparar el saldo — incluso si el saldo es negativo. El helper correcto (resolverStockMinimo, que distingue null de 0) existe pero no lo llama nadie.

**Prioridad media**

- **Reclasificar no muestra el saldo disponible antes de enviar, a diferencia de su hermano Conteo Físico.** El usuario tiene que adivinar la cantidad a repartir y recién ve el saldo real si la suma no cierra y el servidor lo informa en el mensaje de error, en vez de mostrarlo antes del submit como sí hace Conteo Físico.
- **"Eliminar" en Stock Mínimo es la única acción de borrado duro de la app y no pide confirmación.** Un clic accidental borra la fila (no es un movimiento de Kardex reversible) y deja de alertar silenciosamente sobre un producto/sección.

**Prioridad baja**

- **Reclasificar no impide un destino idéntico al origen (sección+lote), generando un par de movimientos Kardex sin efecto real.** Si origen y único destino coinciden, la operación se acepta y genera dos filas que se cancelan entre sí, agregando ruido a la trazabilidad.
- **Stock Mínimo no ofrece "editar" desde la fila.** Hay que rebuscar producto y sección desde cero cada vez que se quiere ajustar un mínimo existente, con riesgo de crear una fila duplicada por error de sección.

### reportes

**Prioridad alta**

- **Consignación: "Debido por consignante" nunca se salda — no hay forma de registrar el pago.** El reporte suma todas las liquidaciones históricas sin filtro de período, y no existe en todo el proyecto ninguna acción para marcar un saldo como pagado. Es un circuito que se abre solo y nunca se puede cerrar desde la UI.

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

- **La cantidad de una solicitud PULL entra al Kardex sin redondear a los decimales de la unidad.** crearEnvioDirectoTransferencia (PUSH) redondea explícitamente antes de guardar, pero crearSolicitudTransferencia (PULL) guarda `datos.cantidad` tal cual. El valor sin redondear se usa después en 3 puntos del ciclo (aprobar, aceptar, reingresar), violando el invariante documentado de que toda cantidad que entra al Kardex se redondea a los decimales de su unidad.
- **Los traspasos que el propio usuario inició y todavía están en curso se muestran mezclados en "Historial", no como pendientes.** condicionesEnCurso() no cubre "soy destino y mi SOLICITADA espera respuesta de origen" ni "soy origen y mi ENVIADA (push) espera respuesta de destino". Esos casos caen en la tabla de Historial junto con traspasos realmente cerrados, sin ninguna marca visual que los distinga, y pueden quedar empujados a una página siguiente por la paginación de a 30.
- **Quien crea una solicitud PULL (SOLICITADA) no tiene ninguna forma de cancelarla ella misma.** crearSolicitudTransferencia aclara que crear una solicitud no toca stock, pero no existe ninguna acción de cancelación para el creador; la única salida es esperar a que la sucursal origen la rechace.

**Prioridad media**

- **El detalle y el motivo de rechazo se calculan pero nunca se muestran en la tabla de Historial.** aFila computa detalle/motivos/secciones/creadoPorEmail para cada traspaso, pero la tabla de Historial solo pinta Fecha/Producto/Cantidad/Otra sucursal/Estado — esa información desaparece de la UI apenas el traspaso se resuelve.

## Top 5 recomendado para atacar primero

1. **Toda sesión nueva aterriza en una página admin-only (core-administracion)** — bloquea el uso básico de la app para la mayoría de los usuarios (operadores) desde el primer login.
2. **La auto-protección de CapacidadSucursal no cubre gestion_usuarios/gestion_permisos (core-administracion)** — un solo clic puede dejar a todos los admins de todas las sucursales sin acceso a Usuarios o Permisos.
3. **Una Venta confirmada no se puede anular ni corregir (movimientos)** — no hay forma de arreglar un error de carga en la operación más frecuente del sistema.
4. **El tipo (MP/PV) se descarta en silencio al editar un producto (catalogo)** — corrompe el catálogo sin ningún aviso, con impacto en costos y recetas aguas abajo.
5. **La cantidad de una solicitud PULL entra al Kardex sin redondear (traspasos)** — rompe un invariante de datos ya documentado y contamina la trazabilidad de stock en 3 puntos del ciclo.