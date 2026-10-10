import "server-only";
import type { ContextoUsuario } from "@/core/auth/contexto";
import type { ComandoActualizarProducto, EntradaProducto, ResultadoActualizarProducto } from "@/core/features/catalogo/productos.schema";
import { guardComandoDatosDeProducto, MENSAJE_SIN_PERMISO_CAMPOS_SENSIBLES } from "@/core/features/catalogo/productos.guard";
import { rechazoDeReferenciaDeProducto } from "@/core/features/catalogo/referencias-de-producto";
import { registrarCambioAuditado } from "@/server/auditoria/registrar-cambio-auditado";
import { exito, fracaso } from "@/core/resultado-caso";
import { texto } from "@/core/texto";
import { datosParaGuardar, validarDatosDeProducto } from "@/server/lecturas/catalogo/datos-de-producto";
import { productoTieneHistoria, productoTieneLiquidaciones } from "@/server/lecturas/catalogo/historia-de-producto";
import { actualizarCamposDeProducto } from "@/server/persistencia/catalogo/productos";

/**
 * Caso de uso «editar un producto del catálogo» (Hito 4 de la pureza, bloque 4.3, paso H4C-13 — `docs/plan-hito-4-pureza.md` §3). Es el cuerpo que antes vivía en
 * línea en la Server Action `actualizarProducto` (`src/server/actions/catalogo/productos.ts`), movido TAL CUAL:
 *
 * A diferencia de Apps Script (renombrarProductoEnHistorial_, Catalogo.js:1270-1314), acá el nombre es un campo más: Receta/Presentación/ProveedorPorProducto
 * referencian por `productoId` (FK real), no por nombre — no hace falta reescribir nada más al renombrar. El producto se lee con la base de la transacción; el tipo NO
 * se puede cambiar (cambiar el tipo de un producto con historial —recetas, ventas, stock— rompe invariantes reales, así que se rechaza explícito en vez de
 * silenciarlo); los datos se validan (`validarDatosDeProducto`, con la base de la transacción), y el `update` y las filas de auditoría de lo que cambió van en UNA
 * transacción (Task #41, M10): antes iban sueltos y, si la auditoría fallaba (o el proceso se caía en el medio), el precio quedaba cambiado sin rastro.
 *
 * S-05 (plan de endurecimiento de seguridad, tanda T2; decisión CAT-1 del dueño). Antes solo se auditaban el precio de venta, el de consignación y el paso de venta, y un
 * operario con `producto_editar` cambiaba sin rastro lo que da significado a las cantidades y a la deuda. Ahora, TODO dentro de la transacción (la lectura del producto,
 * la validación y la pregunta por su historia ven el mismo estado que el `update`; antes la validación corría afuera):
 *  - cada una de las columnas `factorConversion`, `unidadStockId`, `unidadCompraId`, `seProduce`, `esConsignacion` y `proveedorConsignacionId` deja su fila de
 *    auditoría (del anterior al nuevo; no-op si no cambió);
 *  - `UNIDAD_CON_HISTORIA` (CAT-1): la unidad de stock no se cambia si el producto ya tiene historia (`productoTieneHistoria`), igual que el tipo; sin historia se puede seguir
 *    corrigiendo;
 *  - `CONSIGNANTE_CON_HISTORIA`: ni el consignante ni el «es consignación» se cambian si el producto ya tiene liquidaciones (`productoTieneLiquidaciones`): el reporte
 *    de consignación atribuye cada liquidación al consignante ACTUAL del producto, así que cambiarlo pasaría la deuda ya devengada a otro proveedor.
 *
 * S-12 (D8 del dueño): el costo de consignación (es consignación, proveedor y precio) es de quien tiene `pagar_consignante`. El caso de uso no chequea permisos: la Server Action
 * calcula `comando.puedeGestionarConsignacion` con el gate y acá, sin él, un campo de consignación que no viene queda como estaba y uno distinto del guardado es `SIN_PERMISO_COSTO`.
 *
 * M.2 (clave fina `producto_campos_sensibles`): cambiar el precio de venta, el factor de conversión o una unidad (de stock o de compra) es de quien tiene esa clave además de `producto_editar`. El caso de uso
 * tampoco chequea esto: la Server Action calcula `comando.puedeEditarCamposSensibles` con el gate y acá, sin él, un valor distinto del guardado, ya normalizado y leído dentro de la transacción, es
 * `SIN_PERMISO_CAMPOS_SENSIBLES`, ANTES de `UNIDAD_CON_HISTORIA`, de `CONSIGNANTE_CON_HISTORIA` y del `update`. Un campo sensible que NO viene (`undefined`) queda como estaba, tenga o no la clave (M.2-A4: se completa con lo
 * guardado antes de validar; el formulario abierto sin la clave no los manda y la clave puede llegar mientras edita).
 *
 * La Server Action quedó como adaptador (`conPermisoDeEmpresa("producto_editar")` → este caso de uso → `aResultadoAccion` → si salió bien, revalidar la carta
 * pública y DESPUÉS, si el precio de venta cambió (`datos.precioAnterior`/`precioNuevo`), ofrecer sincronizarlo con los hermanos del ítem agrupado —
 * `sincronizable`, docs/plan-agrupacion-items-carta-2026-09-24.md, D11/M8—, como antes). Sin guard: la validación lee la unidad de stock a mitad de camino.
 *
 * `import "server-only"` y SIN `"use server"`: no es un endpoint. No chequea permisos.
 *
 * @contract Deja el producto con los datos pedidos (sin cambiar su tipo, ni su unidad de stock si ya tiene historia, ni su consignante si ya tiene liquidaciones, ni su costo de consignación sin el permiso, ni su precio de venta, factor y unidades sin la clave fina) y una fila de auditoría por cada uno de sus valores de mayor impacto que cambió: todo o nada. Lo sensible que no viene queda como estaba.
 * @idempotency No aplica — repetir el pedido vuelve a escribir los mismos datos (sin filas de auditoría nuevas: no cambió nada).
 * @transaction `actor.transaccion` (READ COMMITTED): la lectura del producto, la validación, la pregunta por su historia, el `update` y sus auditorías, todo junto.
 * @sideEffects registrarCambioAuditado (Producto.precioVenta, .precioConsignacion, .pasoVenta, .factorConversion, .unidadStockId, .unidadCompraId, .seProduce, .esConsignacion y .proveedorConsignacionId, del anterior al nuevo), en la misma transacción. La revalidación de
 *   la carta pública y el `sincronizable` los hace la Server Action.
 * @ficha permiso=producto_editar transaccion=SIMPLE idempotencia=NO_APLICA auditoria=REGISTRO_AUDITORIA reloj=INYECTADO periodo=NO_APLICA
 */
export async function actualizarProductoCasoDeUso(
  actor: Pick<ContextoUsuario, "transaccion" | "usuarioId">,
  comando: ComandoActualizarProducto,
): Promise<ResultadoActualizarProducto> {
  const { productoId } = comando;
  // Los rechazos devuelven ANTES de escribir, así que la transacción no deja nada. `actor.transaccion` puede reintentar el cuerpo: no tiene efectos fuera de la base.
  // O.175: un id de OTRA empresa (o inexistente) en el proveedor de consignación, la categoría, el insumo o las unidades lo rechaza la clave foránea compuesta de la base al hacer el `update`;
  // la transacción ya quedó abortada (y deshecha), así que el error se traduce AFUERA de ella, a «No se encontró …» (nada se escribió: ni el `update` ni las auditorías).
  try {
    return await actualizarProductoEnTransaccion(actor, comando, productoId);
  } catch (e) {
    const rechazo = rechazoDeReferenciaDeProducto(e);
    if (rechazo) return fracaso("REFERENCIA_NO_ENCONTRADA", rechazo);
    throw e;
  }
}

async function actualizarProductoEnTransaccion(
  actor: Pick<ContextoUsuario, "transaccion" | "usuarioId">,
  comando: ComandoActualizarProducto,
  productoId: string,
): Promise<ResultadoActualizarProducto> {
  return actor.transaccion(async (tx): Promise<ResultadoActualizarProducto> => {
    const existente = await tx.producto.findUnique({ where: { id: productoId } });
    if (!existente) return fracaso("PRODUCTO_NO_ENCONTRADO", "No se encontró el producto.");

    // M.2: un campo sensible AUSENTE no es «ponelo en cero» ni «borralo» sino «queda como estaba», TENGA O NO quien edita la clave: el formulario arma un FormData y un input deshabilitado no viaja (sin la clave), y
    // si le dan la clave mientras tiene el formulario abierto, el servidor la ve y el formulario sigue sin mandarlos (M.2-A4). Sin completar, `datosParaGuardar` convertiría un precio ausente en 0 y una unidad de
    // compra ausente en null, y `validarDatosDeProducto` rechazaría la unidad de stock. Se completan con lo guardado ANTES de lo demás, y la puerta se vuelve a calcular con los datos que de verdad se validan (el
    // guard es la única definición, como en S-52 y S-12). Solo `undefined` es «ausente»: `null` o vacío en la unidad de compra es «sin unidad» a propósito, y un valor presente (aunque vacío) se valida como siempre.
    const pedidos = comando.datos;
    let datos: EntradaProducto = {
      ...pedidos,
      unidadStockId: pedidos.unidadStockId === undefined ? existente.unidadStockId : pedidos.unidadStockId,
      factorConversion: pedidos.factorConversion === undefined ? Number(existente.factorConversion) : pedidos.factorConversion,
      precioVenta: pedidos.precioVenta === undefined ? Number(existente.precioVenta) : pedidos.precioVenta,
      unidadCompraId: pedidos.unidadCompraId === undefined ? existente.unidadCompraId : pedidos.unidadCompraId,
    };
    const hayAusentes = pedidos.unidadStockId === undefined || pedidos.factorConversion === undefined || pedidos.precioVenta === undefined || pedidos.unidadCompraId === undefined;
    let puerta = hayAusentes ? guardComandoDatosDeProducto({ datos }) : comando.puerta;

    // S-12 (D8 del dueño): el costo de consignación (es consignación, proveedor y precio) es de quien tiene `pagar_consignante`. Sin esa clave un campo que NO viene queda como estaba
    // (la pantalla del operador no lo manda) y uno que viene DISTINTO del guardado se rechaza: nunca se confía en lo que manda el cliente.
    if (!comando.puedeGestionarConsignacion) {
      const intentaCambiarlo =
        (datos.esConsignacion !== undefined && datos.esConsignacion !== existente.esConsignacion) ||
        (datos.proveedorConsignacionId !== undefined && (datos.proveedorConsignacionId || null) !== existente.proveedorConsignacionId) ||
        (datos.precioConsignacion !== undefined && Number(datos.precioConsignacion) !== Number(existente.precioConsignacion ?? 0));
      if (intentaCambiarlo) {
        return fracaso(
          "SIN_PERMISO_COSTO",
          "El costo de consignación (si el producto es de consignación, su proveedor y su precio) lo gestiona quien puede pagar a consignantes: no tenés permiso para cambiarlo.",
        );
      }
      datos = { ...datos, esConsignacion: existente.esConsignacion, proveedorConsignacionId: existente.proveedorConsignacionId, precioConsignacion: Number(existente.precioConsignacion ?? 0) };
      // S-52: los campos de consignación ya no son los del cliente sino los guardados: la puerta se vuelve a calcular con los datos que de verdad se validan (el guard es la única definición).
      puerta = guardComandoDatosDeProducto({ datos });
    }
    // datosParaGuardar (abajo) no incluye `tipo` a propósito — cambiar el
    // tipo de un producto con historial (recetas, ventas, stock) rompe
    // invariantes reales, así que se rechaza explícito en vez de
    // silenciarlo (antes: se ignoraba sin aviso, "Producto actualizado"
    // mostraba éxito con el tipo viejo intacto).
    if (datos.tipo !== existente.tipo) {
      return fracaso(
        "TIPO_DISTINTO",
        `El tipo no se puede cambiar — este producto ya es "${existente.tipo}". Dado de baja y creá uno nuevo si necesitás el otro tipo.`,
      );
    }

    const validado = await validarDatosDeProducto(tx, datos, productoId, puerta);
    if ("error" in validado) return fracaso("DATOS_INVALIDOS", validado.error);

    const nuevos = datosParaGuardar(datos, validado.numeros);
    const nombreActual = texto(datos.nombre);

    // M.2: cambiar el precio de venta, el factor de conversión o una unidad exige `producto_campos_sensibles`. Se compara lo NORMALIZADO (`nuevos`: lo que se escribiría) contra la fila leída ACÁ
    // ADENTRO, en la misma transacción que el `update`: mandar el mismo valor no es un cambio, y lo que otra persona cambió mientras este editaba se ve como cambio (el mensaje lo avisa). Va ANTES de
    // `UNIDAD_CON_HISTORIA`, de `CONSIGNANTE_CON_HISTORIA` y del `update`: quien no tiene la clave no se entera de si el producto tiene historia.
    if (!comando.puedeEditarCamposSensibles) {
      const cambiaUnCampoSensible =
        Number(nuevos.precioVenta) !== Number(existente.precioVenta) ||
        Number(nuevos.factorConversion) !== Number(existente.factorConversion) ||
        nuevos.unidadStockId !== existente.unidadStockId ||
        nuevos.unidadCompraId !== existente.unidadCompraId;
      if (cambiaUnCampoSensible) return fracaso("SIN_PERMISO_CAMPOS_SENSIBLES", MENSAJE_SIN_PERMISO_CAMPOS_SENSIBLES);
    }

    // CAT-1: la unidad de stock es inmutable una vez que el producto tiene historia, igual que el tipo (reinterpretaría en silencio todas las cantidades guardadas).
    if (nuevos.unidadStockId !== existente.unidadStockId && (await productoTieneHistoria(tx, productoId))) {
      return fracaso(
        "UNIDAD_CON_HISTORIA",
        "La unidad de stock no se puede cambiar — este producto ya tiene historia (movimientos, recetas, presentaciones o proveedores que la usan). Dado de baja y creá uno nuevo con la unidad correcta si te equivocaste.",
      );
    }
    // El consignante (y el «es consignación») no se cambian si ya hay liquidaciones: la deuda ya devengada pasaría al consignante nuevo.
    const cambiaElConsignante = nuevos.proveedorConsignacionId !== existente.proveedorConsignacionId || nuevos.esConsignacion !== existente.esConsignacion;
    if (cambiaElConsignante && (await productoTieneLiquidaciones(tx, productoId))) {
      return fracaso(
        "CONSIGNANTE_CON_HISTORIA",
        "El consignante no se puede cambiar — este producto ya tiene liquidaciones de consignación y la deuda ya devengada pasaría al proveedor nuevo. Dejá saldada la deuda con el actual y dá de alta un producto nuevo.",
      );
    }

    // M.2 (concurrencia): la lectura de `existente` va sin candado (READ COMMITTED). Sin la clave, el precio de venta, el factor y las unidades NO se escriben: la validación ya comprobó que son los guardados, y escribirlos
    // de nuevo pisaría, con el valor viejo del formulario y sin auditoría, lo que otra persona (con la clave) haya cambiado entre la lectura y esta escritura.
    const { precioVenta, factorConversion, unidadStockId, unidadCompraId, ...sinCamposSensibles } = nuevos;
    void [precioVenta, factorConversion, unidadStockId, unidadCompraId];
    await actualizarCamposDeProducto(tx, { id: productoId, campos: comando.puedeEditarCamposSensibles ? nuevos : sinCamposSensibles });

    // Auditoría administrativa (A3, Pivote 6) — los precios, que son los campos de mayor impacto de negocio/control interno (ver
    // docs/auditoria-motor2-fase6-seguridad-2026-09-18.md)...
    await registrarCambioAuditado(tx, {
      entidad: "Producto", entidadId: productoId, campo: "precioVenta",
      descripcion: `Producto "${nombreActual}": precio de venta`,
      valorAnterior: Number(existente.precioVenta), valorNuevo: Number(nuevos.precioVenta), actorId: actor.usuarioId,
    });
    await registrarCambioAuditado(tx, {
      entidad: "Producto", entidadId: productoId, campo: "precioConsignacion",
      descripcion: `Producto "${nombreActual}": precio de consignación`,
      valorAnterior: Number(existente.precioConsignacion), valorNuevo: Number(nuevos.precioConsignacion), actorId: actor.usuarioId,
    });
    // Venta fraccionada (Task #25): se audita igual que el resto de los campos de mayor impacto de negocio.
    await registrarCambioAuditado(tx, {
      entidad: "Producto", entidadId: productoId, campo: "pasoVenta",
      descripcion: `Producto "${nombreActual}": paso de venta`,
      valorAnterior: existente.pasoVenta !== null ? Number(existente.pasoVenta) : null,
      valorNuevo: nuevos.pasoVenta,
      actorId: actor.usuarioId,
    });
    // ...y (S-05) lo que da significado a las cantidades y a la deuda: el factor, las unidades, si se produce y el consignante.
    await auditarSignificadoDeProducto(tx, actor.usuarioId, { productoId, nombre: nombreActual, existente, nuevos });

    return exito(`Producto "${nombreActual}" actualizado.`, { precioAnterior: Number(existente.precioVenta), precioNuevo: Number(nuevos.precioVenta) });
  });
}

type Tx = Parameters<typeof registrarCambioAuditado>[0];

/**
 * S-05: una fila de auditoría por cada columna que da significado a las cantidades y a la deuda de un producto y cambió. Los ids de unidad y de proveedor se guardan como
 * están (`valorAnterior`/`valorNuevo`); los NOMBRES van en la descripción, para que la pantalla de auditoría se lea sin cruzar ids.
 */
async function auditarSignificadoDeProducto(
  tx: Tx,
  actorId: string,
  datos: {
    productoId: string;
    nombre: string;
    existente: { factorConversion: unknown; unidadStockId: string; unidadCompraId: string | null; seProduce: boolean; esConsignacion: boolean; proveedorConsignacionId: string | null };
    nuevos: { factorConversion: number; unidadStockId: string; unidadCompraId: string | null; seProduce: boolean; esConsignacion: boolean; proveedorConsignacionId: string | null };
  },
): Promise<void> {
  const { existente, nuevos } = datos;
  const idsDeUnidad = [existente.unidadStockId, nuevos.unidadStockId, existente.unidadCompraId, nuevos.unidadCompraId].filter((id): id is string => id !== null);
  const idsDeProveedor = [existente.proveedorConsignacionId, nuevos.proveedorConsignacionId].filter((id): id is string => id !== null);
  const cambiaUnidad = nuevos.unidadStockId !== existente.unidadStockId || nuevos.unidadCompraId !== existente.unidadCompraId;
  const cambiaProveedor = nuevos.proveedorConsignacionId !== existente.proveedorConsignacionId;
  const unidades = cambiaUnidad ? new Map((await tx.unidad.findMany({ where: { id: { in: idsDeUnidad } }, select: { id: true, nombre: true } })).map((u) => [u.id, u.nombre])) : new Map<string, string>();
  const proveedores = cambiaProveedor ? new Map((await tx.proveedor.findMany({ where: { id: { in: idsDeProveedor } }, select: { id: true, nombre: true } })).map((p) => [p.id, p.nombre])) : new Map<string, string>();
  const nombreDe = (nombres: ReadonlyMap<string, string>, id: string | null) => (id === null ? "ninguna" : (nombres.get(id) ?? id));

  const cambios: { campo: string; descripcion: string; anterior: unknown; nuevo: unknown }[] = [
    { campo: "factorConversion", descripcion: "factor de conversión", anterior: Number(existente.factorConversion), nuevo: nuevos.factorConversion },
    {
      campo: "unidadStockId",
      descripcion: `unidad de stock (de «${nombreDe(unidades, existente.unidadStockId)}» a «${nombreDe(unidades, nuevos.unidadStockId)}»)`,
      anterior: existente.unidadStockId,
      nuevo: nuevos.unidadStockId,
    },
    {
      campo: "unidadCompraId",
      descripcion: `unidad de compra (de «${nombreDe(unidades, existente.unidadCompraId)}» a «${nombreDe(unidades, nuevos.unidadCompraId)}»)`,
      anterior: existente.unidadCompraId,
      nuevo: nuevos.unidadCompraId,
    },
    { campo: "seProduce", descripcion: "se produce (tiene receta propia)", anterior: existente.seProduce, nuevo: nuevos.seProduce },
    { campo: "esConsignacion", descripcion: "es consignación", anterior: existente.esConsignacion, nuevo: nuevos.esConsignacion },
    {
      campo: "proveedorConsignacionId",
      descripcion: `proveedor de consignación (de «${nombreDe(proveedores, existente.proveedorConsignacionId)}» a «${nombreDe(proveedores, nuevos.proveedorConsignacionId)}»)`,
      anterior: existente.proveedorConsignacionId,
      nuevo: nuevos.proveedorConsignacionId,
    },
  ];
  for (const c of cambios) {
    await registrarCambioAuditado(tx, {
      entidad: "Producto",
      entidadId: datos.productoId,
      campo: c.campo,
      descripcion: `Producto "${datos.nombre}": ${c.descripcion}`,
      valorAnterior: c.anterior,
      valorNuevo: c.nuevo,
      actorId,
    });
  }
}
