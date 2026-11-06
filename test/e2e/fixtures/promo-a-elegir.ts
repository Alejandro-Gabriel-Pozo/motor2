import { prisma } from "./db";
import { prismaAdmin } from "../../setup/cliente-duenio";
import { borrarRecetasDeReventa, darRecetaDeReventa } from "../../setup/receta-de-venta";
import { claveDeConfiguracion } from "../../../src/core/pos/promo-combo";
import { sembrarGrupo, sembrarProductoConOpciones } from "./opciones";

/**
 * Promo «a elegir» (etapa N1, PR C), siembra de los specs de Playwright con el caso real de la empresa: la promo «Bife con guarnición» ($ 55.000 fijo) cuyo lugar «Plato principal» (1 a 2) tiene la entrada
 * «a elegir» del Bife (producto interno «BIFE-…», base configurable: precio final por preparación) y una Milanesa de configuración fija. Lo permitido por la promo: Proteína (Nalga, Bife de chorizo; el
 * producto admite también «Ojo de bife», que la promo NO permite), Preparación («Bife a la criolla», «Bife con chimichurri») y Guarniciones (puré de papa, ensalada, papas fritas).
 *
 * `marca`: sufijo que hace únicos los nombres en la base compartida de la corrida. Sin marca (`null`) los nombres son los reales de la empresa, sin sufijos (para las capturas que se le muestran al dueño).
 * Lo sembrado de opciones no se borra (ver `fixtures/opciones.ts`); la promo, la cuenta y la mesa sí.
 */
export async function sembrarBifeAElegir(sucursalId: string, marca: string | null) {
  const sufijo = marca ? ` ${marca}` : "";
  const codigo = (c: string) => `${c}${marca ? `-${marca}` : ""}`;
  const m = marca ?? "real";
  const unidad = await prisma.unidad.findFirstOrThrow({ where: { nombre: "unidad" } });
  const kg = await prisma.unidad.findFirstOrThrow({ where: { nombre: "kg" } });
  const admin = await prisma.user.findUniqueOrThrow({ where: { email: "e2e-admin@local.test" } });
  const seccionStock = await prisma.seccion.findFirstOrThrow({ where: { sucursalId, nombre: "Depósito E2E" } });

  const insumo = async (nombre: string) => {
    const p = await prisma.producto.create({ data: { codigo: codigo(`MP-${nombre.replace(/\s+/g, "-").toUpperCase()}`), nombre: `${nombre}${sufijo}`, tipo: "MP", unidadStockId: kg.id } });
    await prisma.disponibilidadProducto.create({ data: { sucursalId, productoId: p.id, disponible: true } });
    return p;
  };
  const [nalga, chorizo, ojo, pure, ensalada, papas] = await Promise.all(["Nalga", "Bife de chorizo", "Ojo de bife", "Puré de papa", "Ensalada", "Papas fritas"].map(insumo));
  const consumo = (p: { id: string }, cantidad: number) => [{ insumoProductoId: p.id, cantidad }];

  const proteina = await sembrarGrupo({
    nombre: `Proteína${sufijo}`,
    tipo: "INCLUIDA",
    cantidadMinima: 1,
    cantidadMaxima: 1,
    marca: m,
    opciones: [{ nombre: "Nalga", consumos: consumo(nalga!, 0.25) }, { nombre: "Bife de chorizo", consumos: consumo(chorizo!, 0.3) }, { nombre: "Ojo de bife", consumos: consumo(ojo!, 0.3) }],
  });
  const preparacion = await sembrarGrupo({ nombre: `Preparación${sufijo}`, tipo: "MEDIDA", cantidadMinima: 1, cantidadMaxima: 1, marca: m, opciones: [{ nombre: "Bife a la criolla" }, { nombre: "Bife con chimichurri" }] });
  const guarniciones = await sembrarGrupo({
    nombre: `Guarniciones${sufijo}`,
    tipo: "VARIANTE",
    cantidadMinima: 0,
    cantidadMaxima: 2,
    marca: m,
    opciones: [{ nombre: "Puré de papa", consumos: consumo(pure!, 0.2) }, { nombre: "Ensalada", consumos: consumo(ensalada!, 0.15) }, { nombre: "Papas fritas", consumos: consumo(papas!, 0.25) }],
  });
  const nombreBife = `Bife${sufijo}`;
  const { productoId: bifeId } = await sembrarProductoConOpciones({
    nombre: nombreBife,
    codigo: codigo("BIFE-"),
    precioVenta: 18000,
    sucursalId,
    grupos: [{ grupo: proteina }, { grupo: preparacion, modoPrecio: "ABSOLUTO", preciosAbsolutos: { "Bife a la criolla": 18000, "Bife con chimichurri": 19000 } }, { grupo: guarniciones, cantidadMaxima: 2 }],
  });
  await prisma.producto.update({ where: { id: bifeId }, data: { modoDeVenta: "BASE_CONFIGURABLE" } });

  const nombreMilanesa = `Milanesa napolitana${sufijo}`;
  const milanesa = await prisma.producto.create({ data: { codigo: codigo("MILA"), nombre: nombreMilanesa, tipo: "PV", unidadStockId: unidad.id, precioVenta: 17000 } });
  await prisma.disponibilidadProducto.create({ data: { sucursalId, productoId: milanesa.id, disponible: true } });
  const reventa = await darRecetaDeReventa(prisma, milanesa, { sucursalIds: [sucursalId], stock: { cantidad: 1000, seccionIds: [seccionStock.id], usuarioId: admin.id } });

  const seccion = await prisma.seccionCarta.create({ data: { nombre: `Promos${sufijo}`, orden: 1 } });
  await prisma.contenidoCartaProducto.create({ data: { sucursalId, productoId: milanesa.id, visibleEnCarta: true, seccionCartaId: seccion.id, orden: 1 } });
  const titulo = `Bife con guarnición${sufijo}`;
  const promo = await prisma.promoCarta.create({ data: { sucursales: { create: { sucursalId } }, seccionCartaId: seccion.id, titulo, precio: 55000 } });
  const cupo = await prisma.promoCartaCupo.create({ data: { promoCartaId: promo.id, tipo: "LISTA", nombre: "Plato principal", orden: 0, cantidadMinima: 1, cantidadMaxima: 2 } });
  const permitidas = [proteina.opciones["Nalga"]!, proteina.opciones["Bife de chorizo"]!, preparacion.opciones["Bife a la criolla"]!, preparacion.opciones["Bife con chimichurri"]!, guarniciones.opciones["Puré de papa"]!, guarniciones.opciones["Ensalada"]!, guarniciones.opciones["Papas fritas"]!];
  const entradaBife = await prisma.entradaDeCupo.create({
    data: {
      cupoId: cupo.id,
      productoId: bifeId,
      modoDeOpciones: "A_ELEGIR",
      orden: 0,
      claveConfiguracion: claveDeConfiguracion(permitidas.map((o) => ({ opcionId: o.opcionId, cantidad: 1 })))!,
      opciones: { create: permitidas.map((o) => ({ opcionId: o.opcionId, cantidad: 1 })) },
    },
  });
  const entradaMilanesa = await prisma.entradaDeCupo.create({ data: { cupoId: cupo.id, productoId: milanesa.id, orden: 1 } });

  const mesa = await prisma.mesa.create({ data: { sucursalId, numero: 5000 + Math.floor(Math.random() * 4000) } });
  const cuenta = await prisma.cuenta.create({ data: { mesaId: mesa.id, abiertaPorId: admin.id } });

  return {
    titulo,
    nombreBife,
    /** Cómo lo ve quien elige (`nombreParaMostrar`): la base sin la carta que la nombre sale por los rótulos de su medida, con el nombre interno entre paréntesis. */
    nombreEnPantalla: `Bife a la criolla · Bife con chimichurri (${nombreBife})`,
    nombreMilanesa,
    seccion,
    cupo,
    entradaBife,
    entradaMilanesa,
    mesa,
    cuenta,
    /** Los nombres de los grupos tal como los muestra la pantalla. */
    grupos: { proteina: `Proteína${sufijo}`, preparacion: `Preparación${sufijo}`, guarniciones: `Guarniciones${sufijo}` },
    bifeId,
    limpiar: async () => {
      const items = await prisma.cuentaItem.findMany({ where: { cuentaId: cuenta.id }, select: { operacionId: true } });
      const operacionIds = [...new Set(items.flatMap((i) => (i.operacionId ? [i.operacionId] : [])))];
      await prismaAdmin.opcionElegidaEnLinea.deleteMany({ where: { cuentaItem: { cuentaId: cuenta.id } } });
      await prismaAdmin.cuentaItem.deleteMany({ where: { cuentaId: cuenta.id, lineaPadreId: { not: null } } });
      await prismaAdmin.cuentaItem.deleteMany({ where: { cuentaId: cuenta.id } });
      await prismaAdmin.registroAuditoria.deleteMany({ where: { entidadId: { in: [...operacionIds, cuenta.id] } } });
      await prisma.movimientoStock.deleteMany({ where: { OR: [{ operacionId: { in: operacionIds } }, { productoId: { in: [milanesa.id, nalga!.id, chorizo!.id, ojo!.id, pure!.id, ensalada!.id, papas!.id] } }] } });
      await prisma.operacion.deleteMany({ where: { id: { in: operacionIds } } });
      await prisma.promoCuenta.deleteMany({ where: { cuentaId: cuenta.id } });
      await prismaAdmin.agregadoDeCuenta.deleteMany({ where: { cuentaId: cuenta.id } });
      await prisma.cuenta.deleteMany({ where: { id: cuenta.id } });
      await prisma.mesa.deleteMany({ where: { id: mesa.id } });
      await prismaAdmin.opcionDeEntradaDeCupo.deleteMany({ where: { entradaId: { in: [entradaBife.id, entradaMilanesa.id] } } });
      await prismaAdmin.entradaDeCupo.deleteMany({ where: { cupoId: cupo.id } });
      await prisma.promoCartaCupo.deleteMany({ where: { promoCartaId: promo.id } });
      await prisma.promoCartaSucursal.deleteMany({ where: { promoCarta: { id: promo.id } } });
      await prisma.promoCarta.deleteMany({ where: { id: promo.id } });
      await prisma.contenidoCartaProducto.deleteMany({ where: { seccionCartaId: seccion.id } });
      await prisma.seccionCarta.deleteMany({ where: { id: seccion.id } });
      await borrarRecetasDeReventa(prisma, { pvIds: [milanesa.id], mpIds: [reventa.id] });
      await prisma.disponibilidadProducto.deleteMany({ where: { productoId: milanesa.id } });
      await prisma.producto.deleteMany({ where: { id: milanesa.id } });
    },
  };
}
