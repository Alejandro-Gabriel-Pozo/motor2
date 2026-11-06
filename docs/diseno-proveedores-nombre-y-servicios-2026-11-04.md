# Diseño: proveedores — corregir el nombre y marcar «productos / servicios» (2026-11-04)

Estado: **etapa de código, sin migración.** Pedido del dueño (2026-11-04): «arreglá lo de proveedores». Problema real: cargó el proveedor de la luz con un nombre abreviado y no podía corregirlo. Cada decisión lleva su estado (CONFIRMADA = dicha por el dueño, PROPUESTA = de ingeniería, a corregir por el dueño).

## 1. Propósito y alcance (CONFIRMADA)
- **Dentro:** (1) poder editar el nombre de un proveedor; (2) mostrar y editar «ofrece productos / servicios» (columnas `ofreceProductos` y `ofreceServicios`, que existían en la base desde la migración 20261015110000 y nada de `src/` leía ni escribía).
- **Fuera:** migraciones, `condicionIva`, condiciones de pago, gastos y servicios, y cualquier uso de las marcas (no filtran compras ni gastos: eso es otra etapa).

## 2. Verificación de que renombrar es seguro (hecha leyendo el código, 2026-11-04)
- **Identidad:** un proveedor se referencia SIEMPRE por `id` (clave foránea compuesta `(empresaId, proveedorId)` en `Operacion`, `FacturaProveedor`, `NotaCreditoProveedor`, `ProveedorPorProducto`, `PagoConsignante`, `PuntoDeVentaDeProveedor`, y `Producto.proveedorConsignacionId`). El `codigo` (`PRV_…`) es la identidad visible y no cambia. El nombre es un dato más (mismo criterio que `Producto`, `productos.ts` ~385).
- **Copias del nombre:** ninguna. `prisma/schema.prisma` no tiene una columna que guarde el nombre del proveedor en filas históricas. Los reportes (período, valuación, devoluciones, historial de producto, trazabilidad, consignación, compras registradas, bandeja de propuestas) lo leen por la relación en el momento de consultar; el reporte de consignación agrupa por `proveedorId`, no por nombre.
- **Texto histórico:** los textos de la auditoría que ya se escribieron («Pago a "X" registrado», `RegistroAuditoria.descripcion`) conservan el nombre de ese momento a propósito: es la foto de lo que pasó, no una clave.
- **Importadores y scripts:** `scripts/seed-demo-pizzeria.ts` crea proveedores por nombre y los busca por `altaProveedor`; no los vuelve a buscar por nombre después de renombrar. Nada más usa el nombre como clave.
- **Pruebas:** el único test que asumía «el nombre no se edita» era un e2e (`catalogo-editar-proveedor.spec.ts`), actualizado.

## 3. Reglas (nivel 5)
| # | Regla | Estado |
|---|---|---|
| R1 | El nombre del proveedor se valida igual que en el alta (`nombreDeCatalogo`: recortado, no vacío, sin caracteres de control, largo de catálogo). | PROPUESTA |
| R2 | Nombre repetido: se rechaza si OTRO proveedor de la empresa ya se llama así **sin distinguir mayúsculas** (el criterio del alta: `mode: "insensitive"`); las **tildes sí distinguen**. Cambiar solo las mayúsculas del propio nombre se permite. El mensaje nombra al otro: «Ya existe un proveedor llamado «X». Elegí otro nombre.» | PROPUESTA (mismo criterio que el alta) |
| R3 | Concurrencia sin migración: control optimista con el nombre esperado (el que vio la pantalla). Si cambia el nombre y el vigente ya no es el esperado → «el proveedor cambió mientras lo editabas». El UPDATE lleva `nombre = actual` en el `where` (0 filas = lo mismo). El índice único `(empresaId, nombre)` arbitra dos renombres al mismo nombre; el choque se reintenta y el chequeo da el mensaje claro. Todo en una transacción SERIALIZABLE. | PROPUESTA |
| R4 | Idempotencia: sin ningún cambio no se escribe ni se audita; guardar dos veces lo mismo responde bien. | PROPUESTA |
| R5 | Auditoría: una fila por columna que cambia entre `nombre`, `ofreceProductos` y `ofreceServicios` (entidad `Proveedor`, quién, cuándo, antes y después, `sucursalId` null). El contacto no deja fila (como siempre). | PROPUESTA |
| R6 | Permiso: el mismo que hoy edita al proveedor (`proveedores` de empresa), verificado en el servidor. El alta sigue con `proveedor_alta`. | CONFIRMADA (pedido) |
| R7 | «Qué le compramos»: al menos una de las dos casillas (CHECK de la base + validación con mensaje claro). El alta nueva nace «productos»; un proveedor existente conserva lo que tiene. Mandar solo una casilla deja la otra como estaba. | CONFIRMADA (pedido) |

## 4. Tabla «¿qué pasa si…?» — guardar un proveedor
| Caso | Qué pasa |
|---|---|
| Repetición (guardar dos veces lo mismo) | Responde bien; no escribe ni audita de más |
| Dos ediciones del nombre a la vez | Gana una; la otra: «cambió mientras lo editabas» |
| Dos proveedores se renombran al mismo nombre a la vez | Gana uno; el otro: «Ya existe un proveedor llamado …» |
| Nombre de otra empresa igual | Sin conflicto (la RLS acota; el único es por empresa) |
| Ninguna casilla marcada | Rechazo con «Marcá al menos una opción…», no escribe |
| Proveedor inexistente / de otra empresa | «No se encontró ese proveedor.» |
| Falla la auditoría | Se revierte todo (una transacción) |
| Cambió el permiso entre la pantalla y el envío | El servidor lo rechaza (`conPermisoDeEmpresa`) |
| Se manda el nombre sin `nombreEsperado` | Rechazo: «recargala y volvé a intentar» |

## 5. Pruebas (nivel 10)
- Unitarias: `test/core/oferta-de-proveedor.test.ts`. Integración con Postgres real (renombrar, nombre repetido, mayúsculas, tildes, concurrencia, idempotencia, auditoría, casillas, aislamiento): `test/catalogo/proveedores-nombre-y-oferta.test.ts`. E2E a 375 px con axe: `test/e2e/catalogo-proveedor-nombre-y-oferta.spec.ts`.
- Guardianes: auditoría por columna (`Proveedor`: `nombre`, `ofreceProductos`, `ofreceServicios`), entidades auditables, ficha del caso de uso.
- **Combinaciones:** las dos casillas dan 3 estados válidos y 1 inválido; la tabla de verdad está en `test/core/oferta-de-proveedor.test.ts` y en el CHECK de la base. No hay dimensión que cambie dinero ni stock.
