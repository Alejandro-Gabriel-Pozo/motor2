import "server-only";
import type { Prisma } from "@prisma/client";
import { precioDeCarta } from "@/core/carta/public";
import { whereDisponibleEn } from "@/core/catalogo/public";
import { redondearMoneda } from "@/core/moneda";
import { claveDeComponenteConfigurado, rechazoDeComponenteDeCombo, type ComponenteConAlicuota, type CupoDeEntradasDefinicion, type EntradaElegibleDeCupo, type LineaConfigurada } from "@/core/pos/public";
import { armarLineaConfigurada } from "@/core/pos/public-servidor";
import { fechaDeColumnaDate } from "@/core/tiempo/zona-horaria";
import { cargarCombinacionesParaVender } from "@/server/lecturas/catalogo/combinaciones";
import { preciosLocalesVigentes } from "@/server/lecturas/catalogo/precio-local";
import { cargarProductosComoComponentes } from "@/server/lecturas/carta/componentes-de-promo";
import { completarPreciosDeSucursal } from "@/server/lecturas/opciones/opciones-para-vender";

/**
 * GO-3b (ADR-032, frente D, F5 paso I2): los cupos de ENTRADAS de una promo (LISTA y DEL_DIA) tal como se pueden vender HOY en la sucursal, para `cargarPromoCartaParaAgregar`. SIEMPRE con el `tx` de
 * quien llama (la transacción SERIALIZABLE de agregar ítems: lo que decide se lee adentro).
 *
 * Una entrada es ELEGIBLE hoy si (lo que no cumple se deja afuera y, si el mozo la eligió, `ENTRADA_NO_DISPONIBLE`; un DEL_DIA sin ninguna, `MENU_DEL_DIA_SIN_CARGAR`):
 *  - LISTA: la `EntradaDeCupo` está activa; DEL_DIA: la `EntradaDelDiaDeCupo` está activa, es de ESTA sucursal y de la fecha `dia` (el día de calendario de la zona de la empresa);
 *  - su producto está DISPONIBLE en la sucursal y sigue pudiendo ser componente (`rechazoDeComponenteDeCombo`: PV, no ancla, precio de referencia, receta vigente en ESTA sucursal o stock propio);
 *  - su configuración fija (si la lleva; un DEL_DIA nunca) se arma hoy con `armarLineaConfigurada`, igual que una línea suelta: versión vigente de cada opción, apagado en ESTA sucursal, la
 *    combinación (apagada = afuera) y sin adicionales. Un producto con un grupo obligatorio y sin configuración tampoco se arma: afuera.
 * El precio de LISTA de cada entrada (la referencia del prorrateo, D-8) es el de la sucursal (precio local si rige) compuesto con su configuración, SIN el descuento de producto (dentro de una
 * promo no aplica). Se agrupa por `claveComponente` (`claveDeComponenteConfigurado`): dos configuraciones del mismo producto son dos líneas distintas.
 */

type Tx = Prisma.TransactionClient;

export interface CupoDeEntradasLeido {
  id: string;
  tipo: "LISTA" | "DEL_DIA";
  nombre: string;
  cantidadMinima: number;
  cantidadMaxima: number;
}

export interface EntradasDePromoParaVender {
  /** Cada cupo de entradas con sus elegibles de hoy, por id de cupo. */
  cupos: Map<string, CupoDeEntradasDefinicion>;
  /** El precio de lista de cada `claveComponente` elegible (la referencia del prorrateo y el `precioCartaUnitario` que se congela). */
  precioCartaPorClave: Map<string, number>;
  /** La línea configurada de cada `claveComponente` que lleva configuración (huella, fotos y combinación que se escriben con el componente). Sin configuración no está. */
  lineaPorClave: Map<string, LineaConfigurada>;
  /** La alícuota de IVA de cada producto elegible (D-2, se revisa sobre lo elegido). */
  alicuotaPorProducto: Map<string, ComponenteConAlicuota>;
  /** Para mostrar en el POS: «Café · Mediano · Almendras» (el producto y su configuración), por entrada elegible. */
  nombrePorEntrada: Map<string, string>;
}

export async function cargarEntradasDePromoParaVender(
  tx: Tx,
  args: { sucursalId: string; dia: string; cupos: readonly CupoDeEntradasLeido[]; precioLocalActivo: boolean | Promise<boolean> },
): Promise<EntradasDePromoParaVender> {
  const listaIds = args.cupos.filter((c) => c.tipo === "LISTA").map((c) => c.id);
  const delDiaIds = args.cupos.filter((c) => c.tipo === "DEL_DIA").map((c) => c.id);
  const [deLista, delDia] = await Promise.all([
    listaIds.length
      ? tx.entradaDeCupo.findMany({
          where: { cupoId: { in: listaIds }, activa: true },
          select: { id: true, cupoId: true, productoId: true, claveConfiguracion: true, opciones: { select: { opcionId: true, cantidad: true }, orderBy: [{ creadoEn: "asc" }, { id: "asc" }] } },
          orderBy: [{ orden: "asc" }, { creadoEn: "asc" }, { id: "asc" }],
        })
      : Promise.resolve([]),
    delDiaIds.length
      ? tx.entradaDelDiaDeCupo.findMany({
          where: { cupoId: { in: delDiaIds }, sucursalId: args.sucursalId, fecha: fechaDeColumnaDate(args.dia), activa: true },
          select: { id: true, cupoId: true, productoId: true },
          orderBy: [{ creadoEn: "asc" }, { id: "asc" }],
        })
      : Promise.resolve([]),
  ]);
  const entradas = [
    ...deLista.map((e) => ({ id: e.id, cupoId: e.cupoId, productoId: e.productoId, claveConfiguracion: e.claveConfiguracion, opciones: e.opciones })),
    ...delDia.map((e) => ({ id: e.id, cupoId: e.cupoId, productoId: e.productoId, claveConfiguracion: "", opciones: [] as { opcionId: string; cantidad: number }[] })),
  ];
  const productoIds = [...new Set(entradas.map((e) => e.productoId))];
  const [productos, disponibles, locales] = await Promise.all([
    cargarProductosComoComponentes(tx, { sucursalId: args.sucursalId, productoIds }),
    productoIds.length ? tx.producto.findMany({ where: { id: { in: productoIds }, ...whereDisponibleEn(args.sucursalId) }, select: { id: true } }) : Promise.resolve([]),
    preciosLocalesVigentes(args.sucursalId, tx, productoIds, args.precioLocalActivo),
  ]);
  const disponible = new Set(disponibles.map((p) => p.id));
  // La grilla de la sucursal de las MEDIDAS en ABSOLUTO que las configuraciones fijan, y las combinaciones de los productos con ejes (solo si hay alguno).
  const opciones = await completarPreciosDeSucursal(
    tx,
    args.sucursalId,
    new Map([...productos].map(([id, p]) => [id, p.opciones])),
    entradas.filter((e) => e.opciones.length > 0).map((e) => ({ productoId: e.productoId, opcionIds: e.opciones.map((o) => o.opcionId) })),
  );
  const conEjes = [...opciones].filter(([, o]) => o.grupos.some((g) => g.ejeDeCombinacion !== undefined)).map(([id]) => id);
  const combinaciones = conEjes.length ? await cargarCombinacionesParaVender(tx, { sucursalId: args.sucursalId, productoIds: conEjes }) : new Map();

  const resultado: EntradasDePromoParaVender = { cupos: new Map(), precioCartaPorClave: new Map(), lineaPorClave: new Map(), alicuotaPorProducto: new Map(), nombrePorEntrada: new Map() };
  const elegiblesPorCupo = new Map<string, Map<string, EntradaElegibleDeCupo>>(args.cupos.map((c) => [c.id, new Map()]));
  for (const e of entradas) {
    const producto = productos.get(e.productoId);
    if (!producto || !disponible.has(producto.id)) continue;
    const precioBase = redondearMoneda(precioDeCarta(producto.precioVenta, locales.get(producto.id)));
    const grupos = opciones.get(producto.id)?.grupos ?? [];
    let precioDeLista = precioBase;
    let linea: LineaConfigurada | null = null;
    if (grupos.length > 0 || e.opciones.length > 0) {
      const delProducto = combinaciones.get(producto.id);
      const armada = armarLineaConfigurada({ grupos, elegidas: e.opciones, precioBase, descuentoDeProducto: null, cantidad: 1, ...(delProducto ? { combinaciones: delProducto } : {}) });
      if (!armada.ok || (armada.linea !== null && armada.linea.adicionales.length > 0)) continue;
      linea = armada.linea;
      if (linea !== null) precioDeLista = linea.precioUnitario;
    }
    if (rechazoDeComponenteDeCombo({ ...producto, precioDeReferencia: precioDeLista }) !== null) continue;
    // Una entrada que lleva línea configurada nunca comparte la clave del producto pelado (la de un componente de sección): si no, el prorrateo la juntaría con él en una línea sin su foto.
    const claveComponente = linea === null ? producto.id : e.claveConfiguracion === "" ? `${producto.id}#` : claveDeComponenteConfigurado(producto.id, e.claveConfiguracion);
    elegiblesPorCupo.get(e.cupoId)?.set(e.id, { entradaId: e.id, productoId: producto.id, claveComponente });
    resultado.precioCartaPorClave.set(claveComponente, precioDeLista);
    if (linea !== null) resultado.lineaPorClave.set(claveComponente, linea);
    resultado.alicuotaPorProducto.set(producto.id, { productoId: producto.id, nombre: producto.nombre, alicuota: producto.alicuota });
    resultado.nombrePorEntrada.set(e.id, [producto.nombre, ...(linea?.fotos ?? []).map((f) => (f.cantidad > 1 ? `${f.nombreOpcion} ×${f.cantidad}` : f.nombreOpcion))].join(" · "));
  }
  for (const c of args.cupos) {
    resultado.cupos.set(c.id, { cupoId: c.id, tipo: c.tipo, nombre: c.nombre, cantidadMinima: c.cantidadMinima, cantidadMaximaCupo: c.cantidadMaxima, entradas: elegiblesPorCupo.get(c.id) ?? new Map() });
  }
  return resultado;
}
