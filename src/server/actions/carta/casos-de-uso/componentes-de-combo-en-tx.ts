import "server-only";
import type { Prisma } from "@prisma/client";
import type { OpcionDeConfiguracionFija } from "@/core/features/carta/combos.schema";
import { fracaso, type Fracaso } from "@/core/resultado-caso";
import { claveDeConfiguracionFija, rechazoDeComponenteDeCombo, revisarAlicuotasDeCombo, type CodigoDeComponenteDeCombo } from "@/core/pos/public";
import { armarLineaConfigurada } from "@/core/pos/public-servidor";
import { redondearMoneda } from "@/core/moneda";
import { resolverPrecioVenta } from "@/server/lecturas/movimientos/precio-venta";
import { cargarAlicuotasPosiblesDeLugares, cargarLugaresActivosDePromo, cargarProductosComoComponentes, type LugaresDeCombo, type ProductoComponenteLeido } from "@/server/lecturas/carta/componentes-de-promo";
import { productoDisponibleEn } from "@/server/lecturas/catalogo/disponibilidad";

/**
 * Lo que los casos de uso de los combos y del menú del día (GO-3b, ADR-032) validan DENTRO de su transacción SERIALIZABLE, compartido (no es un caso de uso: ninguna Server Action lo importa).
 *
 *  - `validarComponenteEnTx`: un producto (con su configuración fija, si la lleva) como componente de un combo — la regla pura `rechazoDeComponenteDeCombo` (PV, no ancla, precio de referencia,
 *    receta vigente en la sucursal o stock propio) y la configuración con `armarLineaConfigurada` (lo mismo que valida la venta: opciones admitidas, mínimos y máximos, precio compuesto). En la
 *    administración el apagado de una opción en la sucursal NO cuenta (la entrada es de la empresa; la venta lo vuelve a mirar en cada sucursal). Un combo no lleva adicionales (v1).
 *  - `revisarAlicuotasEnTx`: D-2, el producto contra TODOS los componentes posibles del combo.
 */

type Tx = Prisma.TransactionClient;
type CodigoDeValidacion = "PRODUCTO_NO_ENCONTRADO" | "CONFIGURACION_INVALIDA" | CodigoDeComponenteDeCombo;

export interface ComponenteValidadoEnTx {
  producto: ProductoComponenteLeido;
  /** El canónico de la configuración (vacío sin opciones). */
  claveConfiguracion: string;
  /** El precio de lista de la entrada (la lista compuesta con la configuración; sin ella, el precio de la empresa). */
  precioDeLista: number;
}

export async function validarComponenteEnTx(
  tx: Tx,
  /** `precioDeLaSucursal`: el precio base es el de la sucursal (local si rige, `resolverPrecioVenta`), para lo que se carga en una sucursal (el plato del día); si no, el de la empresa. */
  args: { sucursalId: string; productoId: string; opciones: readonly OpcionDeConfiguracionFija[]; etiqueta: string; precioDeLaSucursal?: boolean },
): Promise<{ ok: true; componente: ComponenteValidadoEnTx } | Fracaso<CodigoDeValidacion>> {
  const producto = (await cargarProductosComoComponentes(tx, { sucursalId: args.sucursalId, productoIds: [args.productoId] })).get(args.productoId);
  if (!producto) return fracaso("PRODUCTO_NO_ENCONTRADO", "No se encontró ese producto.");
  const comoComponente = (precioDeReferencia: number, opciones?: { insumos: number; nombres: readonly string[] }) => rechazoDeComponenteDeCombo({ ...producto, precioDeReferencia, ...(opciones ? { opcionesQueDescuentan: opciones } : {}) });
  // Lo que no es un PV vendible (o es el ancla de un adicional) se rechaza antes de mirar su configuración.
  const deTipo = producto.tipo !== "PV" || producto.esAnclaDeAdicional ? comoComponente(producto.precioVenta) : null;
  if (deTipo) return fracaso(deTipo.codigo, deTipo.mensaje);

  const clave = claveDeConfiguracionFija(args.opciones);
  if (clave === null) return fracaso("CONFIGURACION_INVALIDA", `«${producto.nombre}»: la configuración repite una opción o tiene una cantidad fuera de 1 a 10.`);
  const precioBase = args.precioDeLaSucursal ? redondearMoneda(await resolverPrecioVenta(args.sucursalId, producto.id, producto.precioVenta, tx)) : producto.precioVenta;
  let precioDeLista = precioBase;
  // Lo que descuenta la configuración fija sin la base (ventas con opciones, 2026-10-29): sin ella, `undefined` y la regla de siempre.
  let opcionesQueDescuentan: { insumos: number; nombres: readonly string[] } | undefined;
  const grupos = producto.opciones.grupos.map((g) => ({ ...g, opciones: g.opciones.map((o) => ({ ...o, apagadaEnSucursal: false })) }));
  if (grupos.length > 0 || args.opciones.length > 0) {
    const armada = armarLineaConfigurada({ grupos, elegidas: args.opciones, precioBase, descuentoDeProducto: null, cantidad: 1 });
    if (!armada.ok) return fracaso("CONFIGURACION_INVALIDA", `«${producto.nombre}» ${args.etiqueta}: ${armada.mensaje}`);
    if (armada.linea !== null && armada.linea.adicionales.length > 0) {
      return fracaso("CONFIGURACION_INVALIDA", `«${producto.nombre}»: un combo no lleva adicionales (se cobran aparte); sacá el adicional de la configuración.`);
    }
    if (armada.linea !== null) {
      precioDeLista = armada.linea.precioUnitario;
      if (armada.linea.fotos.length > 0) opcionesQueDescuentan = { insumos: armada.linea.insumosSinLaBase, nombres: armada.linea.fotos.map((f) => f.nombreOpcion) };
    }
  }
  const rechazo = comoComponente(precioDeLista, opcionesQueDescuentan);
  if (rechazo) return fracaso(rechazo.codigo, rechazo.mensaje);
  return { ok: true, componente: { producto, claveConfiguracion: clave, precioDeLista } };
}

/** D-2: el producto contra todos los componentes posibles de los lugares del combo (de `desdeDia` en adelante para los platos del día; la carta de `sucursalIds` para los de sección). */
export async function revisarAlicuotasEnTx(
  tx: Tx,
  args: { lugares: LugaresDeCombo; desdeDia: string; sucursalIds: readonly string[]; producto: Pick<ProductoComponenteLeido, "id" | "nombre" | "alicuota"> | null },
): Promise<{ ok: true } | Fracaso<"COMBO_ALICUOTAS_DISTINTAS">> {
  const posibles = await cargarAlicuotasPosiblesDeLugares(tx, args.lugares, { desdeDia: args.desdeDia, sucursalIds: args.sucursalIds });
  const todos = args.producto ? [...posibles.filter((p) => p.productoId !== args.producto!.id), { productoId: args.producto.id, nombre: args.producto.nombre, alicuota: args.producto.alicuota }] : posibles;
  const revision = revisarAlicuotasDeCombo(todos);
  return revision.ok ? { ok: true } : fracaso(revision.codigo, revision.mensaje);
}

/** «Café · Mediano · Con leche»: el producto y, si lleva configuración, el nombre de sus opciones (en el orden pedido). Para los mensajes y la auditoría. */
export async function nombreDeLaEntrada(tx: Tx, nombreDelProducto: string, opcionIds: readonly string[]): Promise<string> {
  if (opcionIds.length === 0) return `«${nombreDelProducto}»`;
  const opciones = await tx.opcionDeGrupo.findMany({ where: { id: { in: [...opcionIds] } }, select: { id: true, nombre: true } });
  const porId = new Map(opciones.map((o) => [o.id, o.nombre]));
  return `«${[nombreDelProducto, ...opcionIds.map((id) => porId.get(id) ?? id)].join(" · ")}»`;
}

/**
 * GO-3b (D5): un producto como PLATO DEL DÍA de un lugar DEL_DIA en la sucursal activa. Lo mismo que cualquier componente (`validarComponenteEnTx`, sin configuración: un plato del día no lleva
 * opciones, D-6), con el precio de la sucursal, más que esté DISPONIBLE en la sucursal y las alícuotas contra los demás componentes posibles del menú (en la carta de esta sucursal).
 */
export async function validarPlatoDelDiaEnTx(
  tx: Tx,
  args: { sucursalId: string; sucursalNombre: string; promoCartaId: string; productoId: string; hoy: string },
): Promise<{ ok: true; producto: ProductoComponenteLeido } | Fracaso<CodigoDeValidacion | "PRODUCTO_NO_DISPONIBLE" | "COMBO_ALICUOTAS_DISTINTAS">> {
  const validado = await validarComponenteEnTx(tx, { sucursalId: args.sucursalId, productoId: args.productoId, opciones: [], etiqueta: "como plato del día (un plato del día no lleva opciones)", precioDeLaSucursal: true });
  if (!validado.ok) return validado;
  const { producto } = validado.componente;
  if (!(await productoDisponibleEn(args.sucursalId, producto.id, tx))) return fracaso("PRODUCTO_NO_DISPONIBLE", `«${producto.nombre}» no está disponible en «${args.sucursalNombre}».`);
  const alicuotas = await revisarAlicuotasEnTx(tx, { lugares: await cargarLugaresActivosDePromo(tx, args.promoCartaId), desdeDia: args.hoy, sucursalIds: [args.sucursalId], producto });
  if (!alicuotas.ok) return alicuotas;
  return { ok: true, producto };
}
