import "server-only";
import type { Prisma } from "@prisma/client";
import type { ContextoDeAccion } from "@/server/actions/tipos";
import { aplicarDescuentoDeProducto } from "@/core/carta/public";
import type { ComandoAgregarItems, ResultadoAgregarItems } from "@/core/features/cuentas/cuenta-pedido.schema";
import { redondearMoneda } from "@/core/moneda";
import { CODIGO_PRODUCTO_SIN_RECETA, mensajeBaseSinOpcion, rechazoSinOrigenDeStock, tieneStockReal } from "@/core/movimientos/public";
import { calcularPayloadHash, decidirIdempotencia, esChoqueDeIndiceUnico, MENSAJE_CONFLICTO_IDEMPOTENCIA } from "@/core/movimientos/public-servidor";
import { conTransaccionSerializable } from "@/lib/transaccion-serializable";
import { resolverPrecioVenta } from "@/server/lecturas/movimientos/precio-venta";
import { validarCantidadPedido } from "@/core/pos/cantidad-pedido";
import { componentesDeEleccion, prorratearPrecioPromo, validarYAplanarEleccionPromo, type ComponentePromoElegido, type FilaPromoProrrateada } from "@/core/pos/promo-combo";
import { MAXIMO_ITEMS_POR_AGREGADO } from "@/core/pos/cantidad-pedido";
import { armarLineaConfigurada, type LineaConfigurada } from "@/core/pos/linea-configurada";
import { validarOpcionesElegidas } from "@/core/opciones/public";
import { exito, fracaso } from "@/core/resultado-caso";
import { descuentosDeProductoEnSucursal } from "@/server/lecturas/carta/descuentos";
import { productoDisponibleEn } from "@/server/lecturas/catalogo/disponibilidad";
import { modulosDelPosDeEmpresa, type ModulosDelPos } from "@/server/lecturas/pos/modulos-del-pos";
import { cargarPromoCartaParaAgregar } from "@/server/lecturas/pos/promo-para-agregar";
import { cargarOpcionesParaVender, completarPreciosDeSucursal } from "@/server/lecturas/opciones/opciones-para-vender";
import { cargarAgregadoDeCuentaPorClave, escribirAgregadoDeCuenta, escribirItemsDeCuenta, escribirLineaConfigurada, escribirPromoDeCuenta } from "@/server/persistencia/pos/pedido";
import { cuentaAbiertaDeSucursal } from "@/server/persistencia/pos/cargar-cuenta-abierta";
import { cargarOrigenDeStockParaVender } from "@/server/lecturas/movimientos/receta-para-vender";
import { cargarAlicuotasDeProductos } from "@/server/lecturas/carta/componentes-de-promo";
import { revisarAlicuotasDeCombo } from "@/core/pos/public";
import { diaDeCalendario } from "@/core/tiempo/zona-horaria";
import { frasesDePuesto } from "@/core/pos/puesto";

/**
 * Caso de uso «agregar ítems y promos sin enviar a una cuenta abierta» (Hito 4 de la pureza, bloque 4.1, paso 12a — `docs/plan-hito-4-pureza.md` §5). Es el
 * cuerpo que antes vivía en línea en la Server Action `agregarItems` (`src/server/actions/pos/cuenta-pedido.ts`), movido TAL CUAL: las mismas lecturas, en el
 * mismo orden y la misma cantidad (lo fija `test/pos/agregar-items-consultas.test.ts`, editado después solo por S-22 / D2 y P18 / D18: la lectura del registro de módulos), dentro de la misma transacción SERIALIZABLE, y los
 * mismos mensajes. La Server Action quedó como adaptador (`conPermiso("pos_tomar_pedido")` → `guardComandoAgregarItems` → este caso de uso →
 * `aResultadoAccion`). El criterio de negocio (precio congelado al agregar, promo revalidada con la misma fuente que el selector, todo o nada) está documentado
 * en la Server Action.
 *
 * `import "server-only"` y SIN `"use server"`: no es un endpoint. No chequea permisos (`conPermiso`) ni el formato de las listas ni el tope (el guard).
 *
 * En UNA transacción SERIALIZABLE (`conTransaccionSerializable`, con reintento ante un conflicto de escritura):
 *  0. (P3, solo con clave) el comprobante de la clave: duplicado → el mensaje original; otra huella → conflicto;
 *  1. la cuenta, de una mesa de ESTA sucursal y abierta (`cuentaAbiertaDeSucursal`, server/persistencia/pos/cargar-cuenta-abierta.ts);
 *  1b. (S-22 / D2) se lee el registro de módulos de la empresa (siempre, una vez): si el pedido trae promos, tiene que tener el módulo Promociones (`PROMO_NO_DISPONIBLE`);
 *      y (P18 / D18) el descuento de producto de la sucursal solo rige con el módulo Carta;
 *  2. VALIDAR todo, sin escribir nada: cada ítem suelto (producto PV, disponible en la sucursal, cantidad con los decimales de su unidad, precio de lista
 *     resuelto y descuento de producto de la sucursal, si la empresa tiene Carta) y cada promo (definición vigente con `cargarPromoCartaParaAgregar`, cupos, prorrateo). El N+1 por ítem
 *     (cada producto se valida con sus propias lecturas) queda como estaba: decisión del dueño (D5 del plan del POS, 2026-10-08), fijado por el conteo de
 *     consultas;
 *  3. ESCRIBIR, recién acá (paso 12b: en server/persistencia/pos/pedido.ts): una `PromoCuenta` por promo (`escribirPromoDeCuenta`, que devuelve el id que
 *     referencian sus componentes) y TODOS los `CuentaItem` (sueltos y componentes) en UN solo `createMany` (`escribirItemsDeCuenta`) y, con clave, lo último: el comprobante (`escribirAgregadoDeCuenta`).
 *
 * Idempotencia I3 (P3 del Paquete 1; cierra O.12): la `claveIdempotencia` es OPCIONAL (igual que compras, mermas y ventas). Con clave, el PRIMER paso de la transacción (antes de mirar la cuenta, para que un
 * reintento con la mesa ya cerrada devuelva el mensaje original y no «ya está cerrada») busca el comprobante `AgregadoDeCuenta` de esa clave: con la misma huella devuelve su mensaje sin escribir nada; con otra huella,
 * `CONFLICTO_IDEMPOTENCIA`. Al final, después de los ítems y en la MISMA transacción, graba el comprobante con el mensaje ya armado: todo o nada. El comprobante es una tabla aparte (no columnas de `CuentaItem`)
 * porque quitar un ítem sin enviar BORRA filas, y con ellas se iría la clave. La carrera de dos envíos simultáneos con la misma clave: el perdedor recibe el 40001 (`conTransaccionSerializable` repite y ve al ganador) o el
 * 23505 del índice único; este se atrapa afuera y se relee al ganador (misma huella: su mensaje; otra, o no visible desde esta empresa: el conflicto, nunca un error genérico ni el contenido ajeno). No se enciende
 * `tambienChoqueDeUnico`: el único índice único que este caso de uso puede chocar es el de la clave, y si el ganador es de otra empresa repetir no lo hace visible (gastaría los 5 intentos con espera antes del mismo conflicto).
 *
 * GO-2b (ADR-030), las OPCIONES DE VENTA, aditivo: un producto sin grupos admitidos y sin opciones pedidas se valida, se escribe y se cuenta EXACTAMENTE como antes.
 *  - Después de la cuenta y del registro de módulos, y antes de validar cada ítem: UNA lectura agrupada (`cargarOpcionesParaVender`) con lo que admite cada producto
 *    del pedido (sueltos y componentes de las promos), siempre (el mínimo obligatorio se exige aunque el cliente no mande opciones); y la grilla de la sucursal solo
 *    si se eligió una MEDIDA en ABSOLUTO (`completarPreciosDeSucursal`).
 *  - En cada ítem, los chequeos de producto de siempre van PRIMERO (existe, PV, disponible, cantidad, precio y descuento) y los de opciones DESPUÉS: un producto ancla
 *    pedido suelto es `PRODUCTO_INVALIDO` («se vende solo como adicional»); lo elegido pasa por `armarLineaConfigurada` (`OPCION_CAMBIO` si cambió la versión que vio
 *    el mozo; `OPCIONES_INVALIDAS` cualquier otro problema). El precio nunca viene del cliente.
 *  - En las promos (v1), un componente cuyo producto tiene un grupo obligatorio es `PROMO_CON_OPCIONES`; con grupos opcionales entra sin opciones.
 *  - El tope de líneas (`MAXIMO_ITEMS_POR_AGREGADO`) cuenta también los adicionales (`OPCIONES_INVALIDAS`): recién acá se sabe cuáles son.
 *  - Escrituras, todas al final y en este orden: las `PromoCuenta`, el `createMany` de las líneas sin opciones (si hay alguna, o si no hay configuradas: la forma de
 *    siempre), cada línea configurada (`escribirLineaConfigurada`: la línea, sus adicionales y las fotos) y el comprobante. El mensaje cuenta los ítems pedidos, sin los adicionales.
 *
 * Qué protege: el reintento del MISMO envío (corte de red, doble envío, doble clic). Qué NO protege: dos pestañas (o dos mozos) con dos pedidos distintos — son dos claves, o sea dos intenciones, y se agregan las dos.
 * Sin clave (llamada a mano, cliente viejo) dos llamadas iguales siguen duplicando los ítems, como antes (lo fija `test/pos/cuenta-concurrencia.test.ts`, (d)).
 *
 * @contract Agrega a una cuenta abierta de la sucursal los ítems sueltos y las promos pedidos, con el precio congelado, todo o nada; con `claveIdempotencia`, exactamente una vez por clave.
 * @idempotency I3 opcional, a mano como `registrarConteoFisico` y `registrarPagoConsignante` (por eso la ficha dice NO_APLICA: `ficha-de-caso-de-uso.test.ts` ata `idempotencia=I3` a llamar a `chequearIdempotencia`, que lee `Operacion`) (claveIdempotencia + payloadHash en AgregadoDeCuenta, sin la clave no hay comprobante) — chequeo dentro de la transacción + catch del choque de unicidad fuera de ella. No cubre dos pedidos distintos con dos claves.
 * @transaction conTransaccionSerializable (SERIALIZABLE + reintento).
 * @sideEffects Con clave, un `AgregadoDeCuenta` (comprobante, solo se agrega). Sin auditoría: `CuentaItem`, `PromoCuenta` y la foto de las opciones (`OpcionElegidaEnLinea`) son documentos del POS con su usuario. Refrescar la vista lo hace el cliente (`router.refresh()`).
 * @ficha permiso=pos_tomar_pedido transaccion=SERIALIZABLE idempotencia=NO_APLICA auditoria=DOCUMENTO_PROPIO reloj=INYECTADO periodo=NO_APLICA
 */
export async function agregarItemsCasoDeUso(
  // `ahora` (O.22-c): la hora del pedido que fija `conPermiso`; solo llega a la carta del selector que valida cada promo (`generadoEn`, que se descarta).
  // `db` (P3): solo para releer al ganador de una carrera por la misma clave, FUERA de la transacción que chocó.
  // `empresaZonaHoraria` (GO-3b): el día de calendario de la empresa, para la vigencia de las promos y los platos del día.
  actor: Pick<ContextoDeAccion, "usuarioId" | "empresaId" | "sucursalId" | "sucursalNombre" | "empresaZonaHoraria" | "transaccion" | "ahora" | "db">,
  comando: ComandoAgregarItems,
): Promise<ResultadoAgregarItems> {
  const { items: items_, promos: promos_, claveIdempotencia } = comando;
  // La huella es del pedido (cuenta, ítems y promos tal cual llegaron) y de la sucursal; sin clave no hay comprobante ni huella.
  const payloadHash = claveIdempotencia ? calcularPayloadHash("POS_AGREGAR_ITEMS", actor.sucursalId, { cuentaId: comando.cuentaId, items: items_, promos: promos_ }) : "";
  return conTransaccionSerializable(actor.transaccion, async (tx): Promise<ResultadoAgregarItems> => {
    // P3 (I3): PRIMER paso, antes de mirar la cuenta: un reintento con la mesa ya cerrada devuelve el mensaje original (nunca «ya está cerrada», que invitaría a cargarlo de nuevo).
    if (claveIdempotencia) {
      const chequeo = decidirIdempotencia(await cargarAgregadoDeCuentaPorClave(tx, claveIdempotencia), payloadHash);
      if (chequeo.estado === "duplicado") return exito(chequeo.mensaje, null);
      if (chequeo.estado === "conflicto") return fracaso("CONFLICTO_IDEMPOTENCIA", MENSAJE_CONFLICTO_IDEMPOTENCIA);
    }

    const abierta = await cuentaAbiertaDeSucursal(tx, comando.cuentaId, actor.sucursalId);
    if (!abierta.ok) return fracaso("CUENTA_NO_ABIERTA", abierta.mensaje);

    // S-22 / D2 (decisión del dueño): «si Promociones está apagado, no se pueden agregar promociones para el POS». El gate de `pos_tomar_pedido` solo mira Salón; la promo es un
    // dato de OTRO módulo y el selector no es una barrera (una Server Action se llama a mano con un `promoCartaId`). El registro de módulos se lee SIEMPRE, UNA vez y después de
    // la cuenta (el guard ya garantiza que el pedido trae al menos un ítem o una promo): sirve para rechazar la promo sin el módulo Promociones y para decidir si rige el descuento de
    // producto (P18 / D18, decisión del dueño 2026-10-11: sin el módulo Carta NO se aplica, igual que las promos). Se pasa a la lectura de cada promo para que no lo vuelva a leer.
    // Va ANTES de validar los ítems: sin el módulo no hay nada de la promo que mirar. Las promos que la cuenta YA tiene no pasan por acá (enviar, anular y cerrar no agregan nada).
    const modulos: ModulosDelPos = await modulosDelPosDeEmpresa(actor.empresaId, tx);
    if (promos_.length > 0 && !modulos.promociones) return fracaso("PROMO_NO_DISPONIBLE", "Las promociones no están disponibles: el módulo Promociones no está activo en tu empresa.");

    // GO-2b: lo que admite cada producto del pedido (sueltos y componentes de las promos, tal como llegaron), en UNA lectura; y la grilla de la sucursal solo para las
    // MEDIDAS en ABSOLUTO elegidas. Antes de validar los ítems: la validación de cada uno la usa después de sus chequeos de siempre.
    const productoIdsDelPedido = [
      ...items_.map((i) => i?.productoId),
      ...promos_.flatMap((p) => componentesDeEleccion(Array.isArray(p?.elecciones) ? p.elecciones : []).map((c) => (c && "productoId" in c ? c.productoId : undefined))),
    ].filter((id): id is string => typeof id === "string");
    const opcionesLeidas = await completarPreciosDeSucursal(
      tx,
      actor.sucursalId,
      await cargarOpcionesParaVender(tx, { sucursalId: actor.sucursalId, productoIds: productoIdsDelPedido }),
      items_.flatMap((i) => (typeof i?.productoId === "string" && Array.isArray(i.opciones) ? [{ productoId: i.productoId, opcionIds: i.opciones.map((o) => o.opcionId) }] : []))
    );

    // RECETA (ADR-033, sin receta no se vende): de cada producto del pedido (sueltos y componentes), si tiene origen de stock — receta vigente en ESTA sucursal o stock propio —, en
    // lecturas agrupadas por pedido. Es el error temprano para el mozo: el cobro lo vuelve a mirar (`armarLinea`), por si la receta se desactivó entre medio.
    const origenDeStock = await cargarOrigenDeStockParaVender(tx, { sucursalId: actor.sucursalId, productoIds: productoIdsDelPedido });
    // Ni un suelto ni un componente es el ancla de un adicional (el ancla suelta ya se rechazó; los adicionales de una línea configurada no pasan por acá). Un id que la lectura no ve, sin receta.
    const sinReceta = (productoId: string, nombreSiNoSeVe: string) => {
      const leido = origenDeStock.get(productoId);
      return rechazoSinOrigenDeStock(leido ? { ...leido, esAnclaDeAdicional: false } : { nombre: nombreSiNoSeVe, seProduce: false, esAnclaDeAdicional: false, ingredientesDeLaRecetaVigente: 0 });
    };

    // Fase 1: VALIDAR todo, sin escribir nada — ni los sueltos ni las promos (mismo criterio que registrarVentaEnTx).
    const filasSueltas: Prisma.CuentaItemCreateManyInput[] = [];
    const configuradas: { productoId: string; cantidad: number; linea: LineaConfigurada }[] = [];
    for (const item of items_) {
      const producto = typeof item?.productoId === "string" ? await tx.producto.findUnique({ where: { id: item.productoId }, include: { unidadStock: { select: { decimales: true } } } }) : null;
      if (!producto) return fracaso("PRODUCTO_INVALIDO", "El producto no existe.");
      if (producto.tipo !== "PV") return fracaso("PRODUCTO_INVALIDO", `«${producto.nombre}» no se puede pedir: solo se piden productos de venta (PV).`);
      if (!(await productoDisponibleEn(actor.sucursalId, producto.id, tx))) return fracaso("PRODUCTO_INVALIDO", `«${producto.nombre}» no está disponible en «${actor.sucursalNombre}».`);
      const paso = producto.pasoVenta !== null ? { pasoVenta: Number(producto.pasoVenta), tieneStockReal: tieneStockReal(producto.tipo, producto.seProduce) } : null;
      const cantidad = validarCantidadPedido(item.cantidad, producto.unidadStock.decimales, paso);
      if (!cantidad.ok) return fracaso("PRODUCTO_INVALIDO", `«${producto.nombre}»: ${cantidad.mensaje}`);
      const precioDeLista = redondearMoneda(await resolverPrecioVenta(actor.sucursalId, producto.id, Number(producto.precioVenta), tx));
      // Producto con descuento (Fase 2): el descuento de ESTA sucursal se aplica acá y el precio de lista queda congelado aparte en `precioCartaUnitario`. P18 / D18: solo con el
      // módulo Carta (sin él, `null`: precio de lista y `precioCartaUnitario` nulo, así que el cierre aplica solo el descuento del cliente); lo mismo hace el selector (paridad).
      const descuento = modulos.carta ? ((await descuentosDeProductoEnSucursal(actor.sucursalId, tx, [producto.id])).get(producto.id) ?? null) : null;
      // GO-2b: recién después de los chequeos de siempre, las opciones (sin grupos admitidos ni opciones pedidas, el ítem sigue igual que antes).
      const admite = opcionesLeidas.get(producto.id) ?? { grupos: [], anclaDeOpcionId: null, esBase: false };
      if (admite.anclaDeOpcionId !== null) return fracaso("PRODUCTO_INVALIDO", `«${producto.nombre}» se vende solo como adicional de otro producto.`);
      const rechazoReceta = sinReceta(producto.id, producto.nombre);
      if (rechazoReceta !== null) return fracaso(CODIGO_PRODUCTO_SIN_RECETA, rechazoReceta);
      const elegidas = item.opciones ?? [];
      // GO-3b: el precio de LISTA que vio el mozo (opcional): si cambió desde entonces (el precio local, una opción), no se cobra otro en silencio: `PRECIO_CAMBIO`.
      const esperado = typeof item.precioDeListaEsperado === "number" ? item.precioDeListaEsperado : null;
      const cambioElPrecio = (lista: number) => esperado !== null && redondearMoneda(lista) !== redondearMoneda(esperado);
      const mensajeDePrecioCambiado = `«${producto.nombre}»: el precio cambió desde que lo elegiste. Volvé a mirarlo y agregalo de nuevo.`;
      if (admite.grupos.length > 0 || elegidas.length > 0) {
        const armada = armarLineaConfigurada({ grupos: admite.grupos, elegidas, precioBase: precioDeLista, descuentoDeProducto: descuento, cantidad: cantidad.cantidad });
        if (!armada.ok) {
          const codigo = armada.codigo === "OPCION_CAMBIO" ? armada.codigo : "OPCIONES_INVALIDAS";
          return fracaso(codigo, `«${producto.nombre}»: ${armada.mensaje}`);
        }
        if (armada.linea) {
          if (cambioElPrecio(armada.linea.precioCartaUnitario ?? armada.linea.precioUnitario)) return fracaso("PRECIO_CAMBIO", mensajeDePrecioCambiado);
          configuradas.push({ productoId: producto.id, cantidad: cantidad.cantidad, linea: armada.linea });
          continue;
        }
      }
      // Fase 4 (ADR-035): un producto que se vende por opción nunca cae a la línea suelta a su precio guardado (defensa; la barrera del cobro lo repite).
      if (admite.esBase) return fracaso("OPCIONES_INVALIDAS", mensajeBaseSinOpcion(producto.nombre));
      if (cambioElPrecio(precioDeLista)) return fracaso("PRECIO_CAMBIO", mensajeDePrecioCambiado);
      const aplicado = aplicarDescuentoDeProducto(precioDeLista, descuento);
      filasSueltas.push({
        cuentaId: abierta.cuenta.id,
        productoId: producto.id,
        cantidad: cantidad.cantidad,
        precioUnitario: aplicado.precio,
        precioCartaUnitario: aplicado.precioLista,
        numeroEnvio: null,
        creadoPorId: actor.usuarioId,
      });
    }

    const promosValidadas: {
      titulo: string;
      promoCartaId: string;
      precio: number;
      componentes: (ComponentePromoElegido & { precioCarta: number })[];
      filas: FilaPromoProrrateada[];
      /** GO-3b: la línea configurada de cada `claveComponente` de una entrada que la lleva (se escribe con su huella y sus fotos). */
      lineaPorClave: ReadonlyMap<string, LineaConfigurada>;
    }[] = [];
    // GO-3b: el día de calendario de la zona de la empresa (la vigencia de cada promo y los platos del día).
    const dia = diaDeCalendario(actor.ahora, actor.empresaZonaHoraria);
    for (const p of promos_) {
      const def = typeof p?.promoCartaId === "string" ? await cargarPromoCartaParaAgregar(actor.sucursalId, p.promoCartaId, tx, actor.ahora, modulos, dia) : null;
      if (!def) return fracaso("PROMO_INVALIDA", "No se encontró esa promo, o ya no está disponible.");
      // GO-3b: el precio que vio el mozo (si lo manda) tiene que ser el de hoy: nunca se cobra otro.
      if (typeof p.precioEsperado === "number" && redondearMoneda(p.precioEsperado) !== redondearMoneda(def.precio)) {
        return fracaso("PROMO_CAMBIO", `«${def.titulo}»: el precio de la promo cambió desde que la elegiste. Volvé a mirarla y agregala de nuevo.`);
      }
      const elecciones = Array.isArray(p.elecciones) ? p.elecciones : [];
      // S-01 (O.50): los componentes salen de la elección YA VALIDADA (cupos, elegibles, sin repetidos), nunca de aplanar lo que mandó el cliente. GO-3b: un componente fijo lo completa el
      // servidor; una entrada que ya no se puede elegir hoy o un lugar del día sin plato tienen su propio código (la pantalla marca el lugar).
      const validacion = validarYAplanarEleccionPromo(def.cupos, elecciones);
      if (!validacion.ok) {
        const codigo = validacion.codigo === "ENTRADA_NO_DISPONIBLE" || validacion.codigo === "MENU_DEL_DIA_SIN_CARGAR" ? validacion.codigo : "PROMO_INVALIDA";
        return fracaso(codigo, `«${def.titulo}»: ${validacion.mensaje}`);
      }
      const entradas = def.entradas;
      // Un componente de un cupo de entradas pesa con el precio de lista de SU entrada (por `claveComponente`: con su configuración); uno de sección, con el de siempre.
      const componentes = validacion.componentes.map((c) => ({
        ...c,
        precioCarta: c.entradaId !== undefined && c.claveComponente !== undefined ? (entradas?.precioCartaPorClave.get(c.claveComponente) ?? 0) : (def.precioCartaPorProducto.get(c.productoId) ?? 0),
      }));
      const prorrateo = prorratearPrecioPromo(def.precio, componentes);
      if (!prorrateo.ok) return fracaso("PROMO_INVALIDA", `«${def.titulo}»: ${prorrateo.mensaje}`);
      // GO-2b (v1): un componente DE SECCIÓN no lleva opciones. Si su producto tiene un grupo obligatorio, no se puede armar en la promo; con grupos opcionales entra sin opciones. GO-3b: un
      // componente de un cupo de ENTRADAS ya se validó al leerlo (su configuración armada hoy, receta y disponibilidad: `cargarEntradasDePromoParaVender`).
      for (const c of componentes) {
        if (c.entradaId !== undefined) continue;
        const sinOpciones = validarOpcionesElegidas(opcionesLeidas.get(c.productoId)?.grupos ?? [], []);
        if (!sinOpciones.ok) return fracaso("PROMO_CON_OPCIONES", `«${def.titulo}»: uno de sus productos necesita que elijas opciones (${sinOpciones.mensaje}) y en una promo todavía no se puede: pedilo suelto.`);
        const rechazoReceta = sinReceta(c.productoId, "Un producto de la promo");
        if (rechazoReceta !== null) return fracaso(CODIGO_PRODUCTO_SIN_RECETA, `«${def.titulo}»: ${rechazoReceta}`);
      }
      // GO-3b (D-2): un combo con cupos de entradas no mezcla alícuotas de IVA declaradas distintas entre lo ELEGIDO (las promos de solo secciones, como antes: se revisan al guardar sus cupos).
      if (entradas) {
        const deSeccion = await cargarAlicuotasDeProductos(tx, componentes.filter((c) => c.entradaId === undefined).map((c) => c.productoId));
        const alicuotas = revisarAlicuotasDeCombo(componentes.flatMap((c) => {
          const a = c.entradaId !== undefined ? entradas.alicuotaPorProducto.get(c.productoId) : deSeccion.get(c.productoId);
          return a ? [a] : [];
        }));
        if (!alicuotas.ok) return fracaso(alicuotas.codigo, `«${def.titulo}»: ${alicuotas.mensaje}`);
      }
      promosValidadas.push({ titulo: def.titulo, promoCartaId: def.id, precio: def.precio, componentes, filas: prorrateo.filas, lineaPorClave: entradas?.lineaPorClave ?? new Map() });
    }

    // GO-2b: el tope de líneas, contando ahora los adicionales de las líneas configuradas (el guard no podía saber cuáles son).
    const lineasDelPedido =
      filasSueltas.length + promosValidadas.reduce((suma, p) => suma + p.filas.length, 0) + configuradas.reduce((suma, c) => suma + 1 + c.linea.adicionales.length, 0);
    if (lineasDelPedido > MAXIMO_ITEMS_POR_AGREGADO) return fracaso("OPCIONES_INVALIDAS", `No se pueden agregar más de ${MAXIMO_ITEMS_POR_AGREGADO} ítems de una vez (contando los adicionales).`);

    // Fase 2: ESCRIBIR — recién acá, con todo ya validado. Una PromoCuenta por promo (necesita su id antes de poder crear los
    // CuentaItem que la referencian); todos los CuentaItem sin opciones (sueltos y componentes) en UN solo createMany; después, cada línea configurada.
    const filas = [...filasSueltas];
    // GO-3b: los componentes de una promo que llevan configuración (una entrada con configuración fija): se escriben como línea configurada, colgados de su PromoCuenta.
    const componentesConfigurados: { promoCuentaId: string; productoId: string; cantidad: number; precioUnitario: number; linea: LineaConfigurada }[] = [];
    for (const p of promosValidadas) {
      const promoCuentaId = await escribirPromoDeCuenta(tx, { cuentaId: abierta.cuenta.id, promoCartaId: p.promoCartaId, precio: p.precio, titulo: p.titulo, creadoPorId: actor.usuarioId });
      const precioCartaDe = (productoId: string) => p.componentes.find((c) => c.productoId === productoId)?.precioCarta ?? null;
      for (const fila of p.filas) {
        if (fila.claveComponente !== undefined) {
          const linea = p.lineaPorClave.get(fila.claveComponente);
          if (linea) {
            componentesConfigurados.push({ promoCuentaId, productoId: fila.productoId, cantidad: fila.cantidad, precioUnitario: fila.precioUnitario, linea });
            continue;
          }
          filas.push({
            cuentaId: abierta.cuenta.id,
            productoId: fila.productoId,
            cantidad: fila.cantidad,
            precioUnitario: fila.precioUnitario,
            numeroEnvio: null,
            creadoPorId: actor.usuarioId,
            promoCuentaId,
            precioCartaUnitario: p.componentes.find((c) => c.claveComponente === fila.claveComponente)?.precioCarta ?? null,
          });
          continue;
        }
        filas.push({
          cuentaId: abierta.cuenta.id,
          productoId: fila.productoId,
          cantidad: fila.cantidad,
          precioUnitario: fila.precioUnitario,
          numeroEnvio: null,
          creadoPorId: actor.usuarioId,
          promoCuentaId,
          precioCartaUnitario: precioCartaDe(fila.productoId),
        });
      }
    }

    // Sin líneas configuradas, el createMany va SIEMPRE (la forma de siempre); con alguna, solo si además hay líneas sin opciones.
    if (filas.length > 0 || (configuradas.length === 0 && componentesConfigurados.length === 0)) await escribirItemsDeCuenta(tx, filas);
    for (const c of componentesConfigurados) {
      // El precio es el PRORRATEADO (lo que se cobra dentro del combo); la lista compuesta de la entrada queda en `precioCartaUnitario` (la referencia del reparto), como cualquier componente.
      await escribirLineaConfigurada(tx, {
        cuentaId: abierta.cuenta.id,
        creadoPorId: actor.usuarioId,
        linea: {
          productoId: c.productoId,
          cantidad: c.cantidad,
          precioUnitario: c.precioUnitario,
          precioCartaUnitario: c.linea.precioUnitario,
          huellaOpciones: c.linea.huellaOpciones,
          fotos: c.linea.fotos,
          promoCuentaId: c.promoCuentaId,
        },
        adicionales: [],
      });
    }
    for (const c of configuradas) {
      await escribirLineaConfigurada(tx, {
        cuentaId: abierta.cuenta.id,
        creadoPorId: actor.usuarioId,
        linea: {
          productoId: c.productoId,
          cantidad: c.cantidad,
          precioUnitario: c.linea.precioUnitario,
          precioCartaUnitario: c.linea.precioCartaUnitario,
          huellaOpciones: c.linea.huellaOpciones,
          fotos: c.linea.fotos,
        },
        adicionales: c.linea.adicionales.map((a) => ({ productoId: a.productoId, cantidad: a.cantidad, precioUnitario: a.precioUnitario, foto: a.foto })),
      });
    }
    // El mensaje cuenta los ítems PEDIDOS: los adicionales van con su producto, no suman.
    const pedidos = filas.length + configuradas.length + componentesConfigurados.length;
    const mensaje = `${pedidos === 1 ? "Se agregó 1 ítem" : `Se agregaron ${pedidos} ítems`} ${frasesDePuesto(abierta.cuenta.mesa.numero).al}.`;
    const nombresPromos = promosValidadas.map((p) => `«${p.titulo}»`);
    const mensajeFinal = nombresPromos.length ? `${mensaje} Incluye ${nombresPromos.join(", ")}.` : mensaje;
    // P3 (I3): el comprobante, en la MISMA transacción y lo último: si la clave ya la usó otro (carrera, o una clave ajena), se deshace TODO — los ítems también.
    if (claveIdempotencia) await escribirAgregadoDeCuenta(tx, { cuentaId: abierta.cuenta.id, claveIdempotencia, payloadHash, resultadoMensaje: mensajeFinal, creadoPorId: actor.usuarioId });
    return exito(mensajeFinal, null);
  }).catch(async (e): Promise<ResultadoAgregarItems> => {
    // Carrera real (dos envíos con la MISMA clave): el índice único deja pasar a uno y al otro lo rechaza con 23505 (la transacción ya hizo rollback). Se relee al ganador FUERA de ella: con el MISMO
    // payloadHash es un reenvío y se devuelve su mensaje; con otro, o si no se ve desde esta empresa (la clave es única global pero la política de empresa oculta los comprobantes ajenos), es un conflicto
    // — nunca un error genérico ni el contenido de otro. Sin clave el choque no es de acá: se relanza (falla cerrado).
    if (claveIdempotencia && esChoqueDeIndiceUnico(e)) {
      const ganador = await cargarAgregadoDeCuentaPorClave(actor.db, claveIdempotencia);
      if (ganador && ganador.payloadHash === payloadHash) return exito(ganador.resultadoMensaje, null);
      return fracaso("CONFLICTO_IDEMPOTENCIA", MENSAJE_CONFLICTO_IDEMPOTENCIA);
    }
    throw e;
  });
}
