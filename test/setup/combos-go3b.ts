import { clienteConEmpresaDePrueba, EMPRESA_TESTIGO_ID } from "./empresa-de-prueba";
import { sembrarEscenarioDeOpciones, type EscenarioDeOpciones } from "./opciones";
import { actorDePrueba } from "./opciones-de-venta";
import { darRecetaDeReventa } from "./receta-de-venta";
import { urlDeSembradoDeVitest } from "./rol-de-pruebas";
import { prisma } from "./test-db";
import { AHORA_DE_LA_CORRIDA } from "./tiempo";

/**
 * Ayudas de los tests de ADMINISTRACIÓN de combos y menú del día (GO-3b, ADR-032): el escenario de las opciones de venta (empresa con dos sucursales A y B, el «Café» con su MEDIDA obligatoria,
 * su VARIANTE, su INCLUIDA y su ADICIONAL) más una promo «Menú del día» ($ 9.500) con un lugar LISTA («Entrada»), un lugar DEL_DIA («Plato del día») y un lugar LISTA fijo («Postre»), y los
 * productos de venta del ejemplo del diseño, todos con receta de reventa y disponibles en la sucursal A: Sopa ($ 3.000), Milanesa ($ 8.000), Guiso ($ 7.000, fuera de carta) y Flan ($ 2.500). El
 * Café también tiene receta y su tamaño va en DIFERENCIA. «Sin receta» ($ 1.000) es un PV sin receta y «Harina» la materia prima del escenario. Sin alícuotas declaradas (las pone cada test).
 */
export interface EscenarioDeCombosGo3b extends EscenarioDeOpciones {
  promoId: string;
  cupoEntradaId: string;
  cupoDelDiaId: string;
  cupoPostreId: string;
  sopaId: string;
  milanesaId: string;
  guisoId: string;
  flanId: string;
  sinRecetaId: string;
}

const ZONA_DE_PRUEBA = "America/Argentina/Buenos_Aires";

/** El actor de un caso de uso como lo arma `conPermiso` en la sucursal dada, con la zona de la empresa y la hora del pedido. */
export function actorDeCombos(usuarioId: string, sucursalId: string, ahora: Date = AHORA_DE_LA_CORRIDA) {
  return { ...actorDePrueba(usuarioId, sucursalId, ahora), empresaZonaHoraria: ZONA_DE_PRUEBA };
}

export async function sembrarCombosGo3b(): Promise<EscenarioDeCombosGo3b> {
  const e = await sembrarEscenarioDeOpciones();
  const seccionCartaId = (await prisma.seccionCarta.create({ data: { nombre: "Menús" } })).id;
  const promoId = (await prisma.promoCarta.create({ data: { seccionCartaId, titulo: "Menú del día", precio: "9500.00", sucursales: { create: { sucursalId: e.sucursalA } } } })).id;
  const cupo = async (tipo: string, nombre: string, orden: number, cantidad = 1) =>
    (await prisma.promoCartaCupo.create({ data: { promoCartaId: promoId, tipo, nombre, cantidadMinima: cantidad, cantidadMaxima: cantidad, orden } })).id;
  const cupoEntradaId = await cupo("LISTA", "Entrada", 1);
  const cupoDelDiaId = await cupo("DEL_DIA", "Plato del día", 2);
  const cupoPostreId = await cupo("LISTA", "Postre", 3);

  const pv = async (codigo: string, nombre: string, precioVenta: string, conReceta = true) => {
    const producto = await prisma.producto.create({ data: { codigo, nombre, tipo: "PV", unidadStockId: e.unidadId, precioVenta } });
    await prisma.disponibilidadProducto.create({ data: { sucursalId: e.sucursalA, productoId: producto.id, disponible: true } });
    if (conReceta) await darRecetaDeReventa(prisma, producto, { sucursalIds: [e.sucursalA, e.sucursalB] });
    return producto.id;
  };
  const sopaId = await pv("PV_SOPA", "Sopa de calabaza", "3000.00");
  const milanesaId = await pv("PV_MILA", "Milanesa con puré", "8000.00");
  const guisoId = await pv("PV_GUISO", "Guiso de lentejas", "7000.00");
  const flanId = await pv("PV_FLAN", "Flan", "2500.00");
  const sinRecetaId = await pv("PV_SIN", "Sin receta", "1000.00", false);
  const cafe = await prisma.producto.findUniqueOrThrow({ where: { id: e.cafeId } });
  await prisma.disponibilidadProducto.create({ data: { sucursalId: e.sucursalA, productoId: e.cafeId, disponible: true } });
  await darRecetaDeReventa(prisma, cafe, { sucursalIds: [e.sucursalA, e.sucursalB] });
  // El tamaño del café en DIFERENCIA (en el escenario de las opciones está sin definir, y una MEDIDA sin modo no se vende).
  await prisma.productoAdmiteGrupo.update({ where: { productoId_grupoId: { productoId: e.cafeId, grupoId: e.grupoMedidaId } }, data: { modoPrecio: "DIFERENCIA" } });
  return { ...e, promoId, cupoEntradaId, cupoDelDiaId, cupoPostreId, sopaId, milanesaId, guisoId, flanId, sinRecetaId };
}

/** Lo de la empresa TESTIGO (otra empresa): un PV con receta y una promo con un lugar LISTA, para probar que nada cruza. */
export async function sembrarCombosAjenos() {
  const testigo = clienteConEmpresaDePrueba(urlDeSembradoDeVitest(), EMPRESA_TESTIGO_ID);
  const unidad = await testigo.unidad.create({ data: { nombre: "u", magnitud: "CANTIDAD", decimales: 0 } });
  const sucursal = await testigo.sucursal.create({ data: { nombre: "Testigo" } });
  const producto = await testigo.producto.create({ data: { codigo: "PV_T", nombre: "Plato testigo", tipo: "PV", unidadStockId: unidad.id, precioVenta: "5000.00" } });
  await darRecetaDeReventa(testigo, producto, { sucursalIds: [sucursal.id], empresaId: EMPRESA_TESTIGO_ID });
  const seccion = await testigo.seccionCarta.create({ data: { nombre: "Menús T" } });
  const promo = await testigo.promoCarta.create({ data: { seccionCartaId: seccion.id, titulo: "Menú testigo", precio: "9000.00" } });
  const cupoLista = await testigo.promoCartaCupo.create({ data: { promoCartaId: promo.id, tipo: "LISTA", nombre: "Entrada", cantidadMinima: 1, cantidadMaxima: 1 } });
  const cupoDelDia = await testigo.promoCartaCupo.create({ data: { promoCartaId: promo.id, tipo: "DEL_DIA", nombre: "Plato", cantidadMinima: 1, cantidadMaxima: 1 } });
  const entrada = await testigo.entradaDeCupo.create({ data: { cupoId: cupoLista.id, productoId: producto.id } });
  return { testigo, sucursal, producto, promo, cupoLista, cupoDelDia, entrada };
}
