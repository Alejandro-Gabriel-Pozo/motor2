import "server-only";
import type { ContextoUsuario } from "@/core/auth/contexto";
import { crearConCodigoAutogenerado, esErrorDeUnicidad } from "@/core/catalogo/public-servidor";
import { MENSAJE_SIN_PERMISO_CAMPOS_SENSIBLES } from "@/core/features/catalogo/productos.guard";
import { rechazoDeReferenciaDeProducto } from "@/core/features/catalogo/referencias-de-producto";
import type { EntradaProducto, PuertaDeDatosDeProducto, ResultadoDarDeAltaProducto } from "@/core/features/catalogo/productos.schema";
import { exito, fracaso } from "@/core/resultado-caso";
import type { FuenteDeAzar } from "@/core/seguridad/azar";
import { datosParaGuardar, validarDatosDeProducto } from "@/server/lecturas/catalogo/datos-de-producto";
import { crearProductoNuevo, sembrarDisponibilidadDeProductoNuevo } from "@/server/persistencia/catalogo/productos";

/**
 * Caso de uso «alta de un producto desde el formulario completo» (Hito 4 de la pureza, bloque 4.3, paso H4C-12 — `docs/plan-hito-4-pureza.md` §3). Es el cuerpo
 * que antes vivía en línea en la Server Action `darDeAltaProducto` (`src/server/actions/catalogo/productos.ts`), movido TAL CUAL: valida los datos
 * (`validarDatosDeProducto`, que lee la unidad de stock, un producto disponible con ese nombre y la unidad del insumo, con la base del contexto), crea el producto
 * con el código manual o uno autogenerado (`${tipo}_…`, con reintento) y DESPUÉS siembra su disponibilidad. Devuelve el id: al guardar, la pantalla lleva a su ficha.
 *
 * El `createMany` de disponibilidad va DESPUÉS de crear el producto, fuera de una transacción interactiva con él a propósito
 * (docs/plan-disponibilidad-por-sucursal-2026-09-23.md §4.2): `crearConCodigoAutogenerado` reintenta hasta 5 veces atrapando el
 * `P2002` del INSERT, y dentro de una transacción interactiva de Postgres el primer INSERT fallido aborta la transacción
 * entera, así que los reintentos fallarían todos. Si el `createMany` fallara después de crear el producto, éste queda sin
 * ninguna fila de disponibilidad ⇒ no disponible en ninguna sucursal ⇒ invisible pero inofensivo (nunca a medias activo en
 * algunas sucursales sin querer), y se puede arreglar desde `/catalogo/productos`, donde aparece con "0 de N sucursales".
 *
 * Tilde del alta (decisión 2 del dueño, docs/plan-disponibilidad-por-sucursal-2026-09-23.md §4): `activoEnTodasLasSucursales` ausente o `true` → disponible en
 * TODAS las sucursales que existen hoy; `false` → solo en la sucursal activa (`actor.sucursalId`).
 *
 * La Server Action quedó como adaptador (`conPermisoDeEmpresa("alta_producto")` → este caso de uso, con la fuente de azar del proceso → `aResultadoAccion` y el id y
 * el nombre para su `ResultadoConId`). Sin guard: la validación lee la unidad de stock a mitad de camino.
 *
 * S-12 (D8 del dueño): sin `pagar_consignante` (`puedeGestionarConsignacion`, que calcula la Server Action) el alta no puede traer costo de consignación (es consignación, proveedor o precio):
 * `SIN_PERMISO_COSTO`, antes de leer o escribir nada.
 *
 * M.2 (D-2 del dueño): sin `producto_campos_sensibles` (`puedeEditarCamposSensibles`, que calcula la Server Action) el alta no puede traer precio de venta distinto de 0, factor de conversión distinto de 1 ni unidad de compra:
 * `SIN_PERMISO_CAMPOS_SENSIBLES`, fallo cerrado y antes de leer o escribir nada. La unidad de stock queda libre.
 *
 * `import "server-only"` y SIN `"use server"`: no es un endpoint. No chequea permisos. No lee el azar por su cuenta: lo recibe (`azar`).
 *
 * @contract Crea el producto (con un código único) y lo deja disponible donde pide el tilde, salvo que los datos no sean válidos o ya haya uno disponible con ese nombre; devuelve su id y su nombre.
 * @idempotency Por estado — repetir el pedido encuentra el producto ya disponible con ese nombre y se rechaza: no crea otro.
 * @transaction Ninguna, a propósito: el reintento del código autogenerado necesita que el INSERT fallido no aborte nada; la disponibilidad va después, con `actor.db`.
 * @sideEffects Ninguno (el alta no se audita: excepciones `crearProductoNuevo` y `sembrarDisponibilidadDeProductoNuevo` de escrituras-auditadas; cada cambio posterior del precio lo audita la edición).
 * @ficha permiso=alta_producto transaccion=NINGUNA idempotencia=POR_ESTADO auditoria=DOCUMENTO_PROPIO reloj=INYECTADO periodo=NO_APLICA
 */
export async function darDeAltaProductoCasoDeUso(
  actor: Pick<ContextoUsuario, "db" | "sucursalId">,
  datos: EntradaProducto,
  azar: FuenteDeAzar,
  /** S-12 (D8): si quien da de alta tiene `pagar_consignante` EDITAR en la sucursal activa (lo calcula la Server Action con el gate; este caso de uso no chequea permisos). */
  puedeGestionarConsignacion: boolean,
  /** S-52: el resultado de `guardComandoDatosDeProducto`, que la Server Action calcula con lo que mandó el cliente y que `validarDatosDeProducto` aplica en el lugar de siempre. */
  puerta: PuertaDeDatosDeProducto,
  /** M.2 (D-2): si quien da de alta tiene `producto_campos_sensibles` EDITAR (lo calcula la Server Action con el gate; este caso de uso no chequea permisos). */
  puedeEditarCamposSensibles: boolean,
): Promise<ResultadoDarDeAltaProducto> {
  // S-12 (D8 del dueño): crear un producto en consignación, con su proveedor o con un precio de consignación, es fijar su costo: solo con `pagar_consignante`. Fallo cerrado, antes de leer nada.
  if (!puedeGestionarConsignacion && (datos.esConsignacion || datos.proveedorConsignacionId || (datos.precioConsignacion !== undefined && Number(datos.precioConsignacion) !== 0))) {
    return fracaso(
      "SIN_PERMISO_COSTO",
      "El costo de consignación (si el producto es de consignación, su proveedor y su precio) lo gestiona quien puede pagar a consignantes: no tenés permiso para fijarlo.",
    );
  }
  // M.2 (D-2 del dueño): crear un producto con precio de venta, con un factor de conversión que no sea el neutro o con unidad de compra es fijar justo lo que la edición protege con `producto_campos_sensibles`.
  // Fallo CERRADO y antes de leer nada: sin la clave, lo único aceptado es precio 0 (o sin precio), factor 1 y sin unidad de compra; cualquier otra cosa —un texto, un NaN— cuenta como «distinto». La unidad de STOCK queda
  // libre (sin ella no hay producto).
  if (!puedeEditarCamposSensibles) {
    const traePrecio = datos.precioVenta !== undefined && Number(datos.precioVenta) !== 0;
    const traeFactor = datos.factorConversion !== undefined && Number(datos.factorConversion) !== 1;
    const traeUnidadDeCompra = Boolean(datos.unidadCompraId);
    if (traePrecio || traeFactor || traeUnidadDeCompra) return fracaso("SIN_PERMISO_CAMPOS_SENSIBLES", MENSAJE_SIN_PERMISO_CAMPOS_SENSIBLES);
  }
  const validado = await validarDatosDeProducto(actor.db, datos, undefined, puerta);
  if ("error" in validado) return fracaso("DATOS_INVALIDOS", validado.error);

  try {
    const producto = await crearConCodigoAutogenerado(
      datos.tipo,
      datos.codigo,
      (codigo) => crearProductoNuevo(actor.db, { codigo, tipo: datos.tipo, campos: datosParaGuardar(datos, validado.numeros) }),
      azar,
    );
    const sucursalIds =
      datos.activoEnTodasLasSucursales !== false ? (await actor.db.sucursal.findMany({ select: { id: true } })).map((s) => s.id) : [actor.sucursalId];
    await sembrarDisponibilidadDeProductoNuevo(actor.db, { productoId: producto.id, sucursalIds });
    return exito(`Producto "${producto.nombre}" (${producto.codigo}) creado.`, { id: producto.id, nombre: producto.nombre });
  } catch (e) {
    if (esErrorDeUnicidad(e)) return fracaso("CODIGO_REPETIDO", "Ya existe un producto con ese código.");
    // O.175: un id de OTRA empresa (o inexistente) en la categoría, el insumo, las unidades o el proveedor lo rechaza la clave foránea compuesta de la base: se traduce a «No se encontró …». Sin transacción acá, el INSERT fallido no aborta nada.
    const rechazo = rechazoDeReferenciaDeProducto(e);
    if (rechazo) return fracaso("REFERENCIA_NO_ENCONTRADA", rechazo);
    throw e;
  }
}
