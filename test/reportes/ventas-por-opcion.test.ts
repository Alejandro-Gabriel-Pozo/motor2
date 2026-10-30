import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));

import { baseDeTest, limpiarBaseDeTest, prisma, sembrarSeccion } from "../setup/test-db";
import { clienteConEmpresaDePrueba, EMPRESA_TESTIGO_ID } from "../setup/empresa-de-prueba";
import { urlDeSembradoDeVitest } from "../setup/rol-de-pruebas";
import { elegida, HUELLA_DE_PRUEBA, sembrarCafeDelSalon, type CafeDelSalon } from "../setup/opciones";
import { entrarComo, sembrarCuenta, sembrarSalon } from "../pos/salon-fixture";
import { agregarItems, enviarACocina } from "../../src/server/actions/pos/cuenta-pedido";
import { anularItemEnviado } from "../../src/server/actions/pos/cuenta-anulacion";
import { anularVenta } from "../../src/server/actions/movimientos/venta";
import { cerrarCuenta } from "../../src/server/actions/pos/cuenta-cierre";
import { generarVentasPorOpcion } from "../../src/server/consultas/reportes/ventas-por-opcion";
import { obtenerReportePorPeriodo } from "../../src/server/consultas/reportes/periodo";
import { ZONA_ARGENTINA, diaDeCalendario, fechaDeColumnaDate } from "../../src/core/tiempo/zona-horaria";

/**
 * «Ventas por opción» de Período (2026-10-29), contra Postgres real. Dos partes:
 *
 * 1. EL ORÁCULO. Un mundo con TODAS las combinaciones de: operación vigente o anulada × tipo de opción (MEDIDA, VARIANTE, INCLUIDA, «ninguna» y ADICIONAL) × dentro o fuera de un combo × costo congelado o no ×
 *    sucursal activa u otra × fecha (dentro, y los bordes del día argentino: 00:00, 23:30, un minuto antes y 00:30 del día siguiente), más una empresa AJENA. Lo esperado sale de una función escrita aquí, aparte del SQL: solo
 *    cuentan las ventas vigentes de la sucursal activa dentro del día argentino; el ADICIONAL no aparece (su padre sí, por su propia opción); sin costo la fila dice «costo incompleto»; lo de otra empresa no se ve.
 * 2. EL FLUJO REAL (pedir, enviar, anular un ítem antes de cobrar, cobrar, anular la venta): las unidades de la MEDIDA suman lo mismo que el producto en «Ventas por producto» de Período.
 */
let s: Awaited<ReturnType<typeof sembrarSalon>>;
let c: CafeDelSalon;
const DIA = new Date("2026-10-15T00:00:00.000Z");
const dbDe = (sucursalId: string) => baseDeTest({ lectura: [sucursalId], escritura: [sucursalId] }).db;

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// 1. El oráculo
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

type Estado = "vigente" | "anulada";
type Tipo = "MEDIDA" | "VARIANTE" | "INCLUIDA" | "NINGUNA" | "ADICIONAL";
type Fecha = "dentro" | "borde-fin" | "borde-inicio" | "antes" | "despues";
interface Spec {
  estado: Estado;
  tipo: Tipo;
  enCombo: boolean;
  conCosto: boolean;
  sucursal: "activa" | "otra";
  fecha: Fecha;
}
const ESTADOS: Estado[] = ["vigente", "anulada"];
const TIPOS: Tipo[] = ["MEDIDA", "VARIANTE", "INCLUIDA", "NINGUNA", "ADICIONAL"];
const FECHAS: Fecha[] = ["dentro", "borde-fin", "borde-inicio", "antes", "despues"];
/** El 15/10/2026 argentino es de las 03:00Z del 15 a las 02:59:59Z del 16. */
const INSTANTE: Record<Fecha, string> = {
  dentro: "2026-10-15T15:00:00.000Z",
  "borde-fin": "2026-10-16T02:30:00.000Z", // 23:30 del 15 en Argentina
  "borde-inicio": "2026-10-15T03:00:00.000Z", // 00:00 del 15 en Argentina
  antes: "2026-10-15T02:59:00.000Z", // 23:59 del 14 en Argentina
  despues: "2026-10-16T03:30:00.000Z", // 00:30 del 16 en Argentina
};

/** Lo esperado, escrito aparte del SQL: ¿cuenta esta venta en el reporte de la sucursal activa del 15/10? */
const cuenta = (e: Spec) => e.estado === "vigente" && e.sucursal === "activa" && (e.fecha === "dentro" || e.fecha === "borde-fin" || e.fecha === "borde-inicio");
/** Qué opción del café lleva cada tipo (el ADICIONAL cuelga de un café con tamaño «Mediano»: el padre cuenta por su MEDIDA). */
const OPCION_DE: Record<Tipo, { grupo: string; opcion: string }> = {
  MEDIDA: { grupo: "Tamaño", opcion: "Mediano" },
  VARIANTE: { grupo: "Leche", opcion: "De vaca" },
  INCLUIDA: { grupo: "Viene con", opcion: "Azúcar" },
  NINGUNA: { grupo: "Leche", opcion: "Sin leche" },
  ADICIONAL: { grupo: "Tamaño", opcion: "Mediano" },
};
const UNIDADES = 2;
const IMPORTE_CENTAVOS = 100_000;
const COSTO_UNITARIO = 150;

function esperado(specs: readonly Spec[]) {
  const filas = new Map<string, { unidades: number; importeCentavos: number; costoCentavos: number; ventas: number; ventasSinCosto: number }>();
  for (const e of specs.filter(cuenta)) {
    const { grupo, opcion } = OPCION_DE[e.tipo];
    const k = `${grupo}|${opcion}`;
    const f = filas.get(k) ?? { unidades: 0, importeCentavos: 0, costoCentavos: 0, ventas: 0, ventasSinCosto: 0 };
    f.unidades += UNIDADES;
    f.importeCentavos += IMPORTE_CENTAVOS;
    f.ventas += 1;
    if (e.conCosto) f.costoCentavos += UNIDADES * COSTO_UNITARIO * 100;
    else f.ventasSinCosto += 1;
    filas.set(k, f);
  }
  return [...filas].map(([k, f]) => {
    const [grupo, opcion] = k.split("|");
    const completo = f.ventasSinCosto === 0;
    return {
      grupo,
      opcion,
      unidades: f.unidades,
      importeCentavos: f.importeCentavos,
      costoCentavos: completo ? f.costoCentavos : null,
      margenCentavos: completo ? f.importeCentavos - f.costoCentavos : null,
      costoIncompleto: completo ? null : { sinCosto: f.ventasSinCosto, de: f.ventas },
    };
  });
}

/** Un mundo de ventas sembradas directo (sin RLS, como el dueño de pruebas): todas las combinaciones de `specs` sobre el café de la sucursal dada. */
async function sembrarMundo(specs: readonly Spec[], o: { sucursalActiva: string; seccionActiva: string; sucursalOtra: string; seccionOtra: string }, ninguna: { grupoId: string; opcionId: string; versionId: string }, incluida: { grupoId: string; opcionId: string; versionId: string }) {
  let numeroDeMesa = 90;
  const mesa = async (sucursalId: string) => (await prisma.mesa.create({ data: { sucursalId, numero: numeroDeMesa++ } })).id;
  const cuentaDe = async (sucursalId: string) => (await prisma.cuenta.create({ data: { mesaId: await mesa(sucursalId), abiertaPorId: s.admin.id, cerradaEn: new Date("2026-10-20T12:00:00Z"), cerradaPorId: s.admin.id } })).id;
  const cuentas = { activa: await cuentaDe(o.sucursalActiva), otra: await cuentaDe(o.sucursalOtra) };
  const seccionDe = { activa: o.seccionActiva, otra: o.seccionOtra };
  const sucursalDe = { activa: o.sucursalActiva, otra: o.sucursalOtra };
  // Un combo: una promo y su instancia en cada cuenta (los componentes de un combo cuelgan de ella, al precio prorrateado).
  const seccionCarta = await prisma.seccionCarta.create({ data: { nombre: "Combos" } });
  const promo = await prisma.promoCarta.create({ data: { seccionCartaId: seccionCarta.id, titulo: "Desayuno", precio: "1500.00" } });
  const promoCuenta = {
    activa: (await prisma.promoCuenta.create({ data: { cuentaId: cuentas.activa, promoCartaId: promo.id, precio: "1500.00", titulo: "Desayuno", creadoPorId: s.admin.id } })).id,
    otra: (await prisma.promoCuenta.create({ data: { cuentaId: cuentas.otra, promoCartaId: promo.id, precio: "1500.00", titulo: "Desayuno", creadoPorId: s.admin.id } })).id,
  };
  const fotoDe = (tipo: Tipo) => {
    switch (tipo) {
      case "MEDIDA":
      case "ADICIONAL":
        return { grupoId: c.grupoMedidaId, opcionId: c.medianoId, versionDeOpcionId: c.versionDe[c.medianoId]!, tipoGrupo: "MEDIDA", nombreGrupo: "Tamaño", nombreOpcion: "Mediano", modoPrecio: "DIFERENCIA", tipoDeDiferencia: "MONTO", factorEscala: "1.0000" };
      case "VARIANTE":
        return { grupoId: c.grupoLecheId, opcionId: c.vacaId, versionDeOpcionId: c.versionDe[c.vacaId]!, tipoGrupo: "VARIANTE", nombreGrupo: "Leche", nombreOpcion: "De vaca" };
      case "INCLUIDA":
        return { grupoId: incluida.grupoId, opcionId: incluida.opcionId, versionDeOpcionId: incluida.versionId, tipoGrupo: "INCLUIDA", nombreGrupo: "Viene con", nombreOpcion: "Azúcar" };
      case "NINGUNA":
        return { grupoId: ninguna.grupoId, opcionId: ninguna.opcionId, versionDeOpcionId: ninguna.versionId, tipoGrupo: "VARIANTE", nombreGrupo: "Leche", nombreOpcion: "Sin leche" };
    }
  };

  const operaciones: Record<string, unknown>[] = [];
  const movimientos: Record<string, unknown>[] = [];
  const items: Record<string, unknown>[] = [];
  const fotos: Record<string, unknown>[] = [];
  for (const e of specs) {
    const opId = randomUUID();
    const itemId = randomUUID();
    const fecha = new Date(INSTANTE[e.fecha]);
    const base = { sucursalId: sucursalDe[e.sucursal], fecha, usuarioId: s.admin.id, proceso: "VENTA" };
    const anulada = e.estado === "anulada" ? { anuladaEn: new Date("2026-10-25T12:00:00Z"), anuladaPorId: s.admin.id, motivoAnulacion: "test" } : {};
    const promoCuentaId = e.enCombo ? promoCuenta[e.sucursal] : null;
    operaciones.push({ id: opId, ...base, ...anulada, promoCuentaId });
    movimientos.push({
      operacionId: opId,
      productoId: c.cafeId,
      seccionId: seccionDe[e.sucursal],
      proceso: "VENTA",
      cantidad: -UNIDADES,
      detalle: "Venta",
      precioTotal: (IMPORTE_CENTAVOS / 100).toFixed(2),
      precioPorUnidadStock: (IMPORTE_CENTAVOS / 100 / UNIDADES).toFixed(4),
      costoUnitarioVenta: e.conCosto ? COSTO_UNITARIO : null,
    });
    // La línea del café: dos ítems con la misma foto (la misma configuración pedida en dos veces: una Operación, el reporte no la cuenta dos veces).
    for (const [i, id] of [itemId, randomUUID()].entries()) {
      items.push({ id, cuentaId: cuentas[e.sucursal], productoId: c.cafeId, cantidad: 1, precioUnitario: "500.00", creadoPorId: s.admin.id, numeroEnvio: 1, operacionId: opId, huellaOpciones: HUELLA_DE_PRUEBA, promoCuentaId });
      fotos.push({ cuentaItemId: id, cantidad: 1, importeUnitario: "0.00", orden: i, ...fotoDe(e.tipo) });
    }
    if (e.tipo === "ADICIONAL") {
      // El adicional «Shot extra»: su propia operación (colgada de la del café) con la venta de su producto ancla, y su foto de ADICIONAL.
      const adicionalOp = randomUUID();
      const adicionalItem = randomUUID();
      operaciones.push({ id: adicionalOp, ...base, ...anulada, operacionPadreId: opId });
      movimientos.push({
        operacionId: adicionalOp,
        productoId: c.anclaDelShotId,
        seccionId: seccionDe[e.sucursal],
        proceso: "VENTA",
        cantidad: -UNIDADES,
        detalle: "Venta",
        precioTotal: "400.00",
        precioPorUnidadStock: "200.0000",
        costoUnitarioVenta: e.conCosto ? 10 : null,
      });
      items.push({ id: adicionalItem, cuentaId: cuentas[e.sucursal], productoId: c.anclaDelShotId, cantidad: 2, precioUnitario: "200.00", creadoPorId: s.admin.id, numeroEnvio: 1, operacionId: adicionalOp, lineaPadreId: itemId });
      fotos.push({
        cuentaItemId: adicionalItem,
        grupoId: c.grupoExtrasId,
        opcionId: c.shotId,
        versionDeOpcionId: c.versionDe[c.shotId]!,
        tipoGrupo: "ADICIONAL",
        nombreGrupo: "Extras",
        nombreOpcion: "Shot extra",
        cantidad: 2,
        tipoDeDiferencia: "MONTO",
        importeUnitario: "200.00",
        orden: 5,
      });
    }
  }
  await prisma.operacion.createMany({ data: operaciones as never });
  await prisma.movimientoStock.createMany({ data: movimientos as never });
  // Los padres antes que sus adicionales (la FK de la línea padre).
  await prisma.cuentaItem.createMany({ data: items.filter((i) => i.lineaPadreId === undefined) as never });
  await prisma.cuentaItem.createMany({ data: items.filter((i) => i.lineaPadreId !== undefined) as never });
  await prisma.opcionElegidaEnLinea.createMany({ data: fotos as never });
}

beforeEach(async () => {
  await limpiarBaseDeTest();
  s = await sembrarSalon();
  c = await sembrarCafeDelSalon(s);
  await entrarComo(s.admin);
});

describe("ventas por opción: el oráculo de combinaciones", () => {
  it("todas las combinaciones (vigente/anulada × tipo × combo × costo × sucursal × fecha) dan EXACTAMENTE lo que dice la tabla escrita aparte; una empresa ajena no se ve", async () => {
    const otra = await prisma.sucursal.create({ data: { nombre: "Norte" } });
    const seccionOtra = await sembrarSeccion(otra.id, "Salón Norte");
    // Lo que el café del salón no trae: la INCLUIDA «Viene con» y la «ninguna» de «Leche».
    const grupoIncluida = await prisma.grupoDeOpciones.create({ data: { nombre: "Viene con", tipo: "INCLUIDA", cantidadMinima: 1, cantidadMaxima: 1 } });
    const azucar = await prisma.opcionDeGrupo.create({ data: { grupoId: grupoIncluida.id, nombre: "Azúcar", orden: 1 } });
    const vAzucar = await prisma.versionDeOpcion.create({ data: { opcionId: azucar.id, numero: 1, tipoDeDiferencia: "MONTO", diferenciaPrecio: "0.00", creadoPorId: s.admin.id } });
    const sinLeche = await prisma.opcionDeGrupo.create({ data: { grupoId: c.grupoLecheId, nombre: "Sin leche", orden: 3, esNinguna: true } });
    const vSinLeche = await prisma.versionDeOpcion.create({ data: { opcionId: sinLeche.id, numero: 1, tipoDeDiferencia: "MONTO", diferenciaPrecio: "0.00", creadoPorId: s.admin.id } });

    // Todas las combinaciones de estado × tipo × costo × sucursal × fecha; el combo solo cambia si la venta cuenta, así que se cruza con las que cuentan (vigente, sucursal activa, dentro del día).
    const specs: Spec[] = [];
    for (const estado of ESTADOS)
      for (const tipo of TIPOS)
        for (const conCosto of [true, false])
          for (const sucursal of ["activa", "otra"] as const)
            for (const fecha of FECHAS) {
              specs.push({ estado, tipo, enCombo: false, conCosto, sucursal, fecha });
              if (cuenta({ estado, tipo, enCombo: false, conCosto, sucursal, fecha })) specs.push({ estado, tipo, enCombo: true, conCosto, sucursal, fecha });
            }
    expect(specs).toHaveLength(200 + 5 * 2 * 3);
    await sembrarMundo(
      specs,
      { sucursalActiva: s.sucursalId, seccionActiva: s.seccion.id, sucursalOtra: otra.id, seccionOtra: seccionOtra.id },
      { grupoId: c.grupoLecheId, opcionId: sinLeche.id, versionId: vSinLeche.id },
      { grupoId: grupoIncluida.id, opcionId: azucar.id, versionId: vAzucar.id }
    );

    // Una empresa AJENA con ventas del mismo estilo en el mismo día: nunca aparece en el reporte de esta.
    const testigo = clienteConEmpresaDePrueba(urlDeSembradoDeVitest(), EMPRESA_TESTIGO_ID);
    const unidad = await testigo.unidad.create({ data: { nombre: "u", magnitud: "CANTIDAD", decimales: 0 } });
    const sucursalAjena = await testigo.sucursal.create({ data: { nombre: "Testigo" } });
    const seccionAjena = await testigo.seccion.create({ data: { sucursalId: sucursalAjena.id, nombre: "Salón T" } });
    const productoAjeno = await testigo.producto.create({ data: { codigo: "PV_AJENO", nombre: "Café ajeno", tipo: "PV", unidadStockId: unidad.id, precioVenta: "1000.00" } });
    const grupoAjeno = await testigo.grupoDeOpciones.create({ data: { nombre: "Tamaño", tipo: "MEDIDA", cantidadMinima: 1, cantidadMaxima: 1 } });
    const opcionAjena = await testigo.opcionDeGrupo.create({ data: { grupoId: grupoAjeno.id, nombre: "Mediano", orden: 1 } });
    const versionAjena = await testigo.versionDeOpcion.create({ data: { opcionId: opcionAjena.id, numero: 1, tipoDeDiferencia: "MONTO", diferenciaPrecio: "0.00", factorEscala: "1.0000", creadoPorId: s.admin.id } });
    const mesaAjena = await testigo.mesa.create({ data: { sucursalId: sucursalAjena.id, numero: 1 } });
    const cuentaAjena = await testigo.cuenta.create({ data: { mesaId: mesaAjena.id, abiertaPorId: s.admin.id, cerradaEn: new Date("2026-10-20T12:00:00Z"), cerradaPorId: s.admin.id } });
    const operacionAjena = await testigo.operacion.create({ data: { sucursalId: sucursalAjena.id, proceso: "VENTA", fecha: new Date(INSTANTE.dentro), usuarioId: s.admin.id } });
    await testigo.movimientoStock.create({
      data: { operacionId: operacionAjena.id, productoId: productoAjeno.id, seccionId: seccionAjena.id, proceso: "VENTA", cantidad: -7, detalle: "Venta", precioTotal: "7000.00", precioPorUnidadStock: "1000.0000", costoUnitarioVenta: 1 },
    });
    const itemAjeno = await testigo.cuentaItem.create({ data: { cuentaId: cuentaAjena.id, productoId: productoAjeno.id, cantidad: 7, precioUnitario: "1000.00", creadoPorId: s.admin.id, numeroEnvio: 1, operacionId: operacionAjena.id, huellaOpciones: HUELLA_DE_PRUEBA } });
    await testigo.opcionElegidaEnLinea.create({
      data: { cuentaItemId: itemAjeno.id, grupoId: grupoAjeno.id, opcionId: opcionAjena.id, versionDeOpcionId: versionAjena.id, tipoGrupo: "MEDIDA", nombreGrupo: "Tamaño", nombreOpcion: "Mediano", modoPrecio: "DIFERENCIA", tipoDeDiferencia: "MONTO", importeUnitario: "0.00", factorEscala: "1.0000" },
    });

    const filas = await generarVentasPorOpcion(s.sucursalId, DIA, DIA, dbDe(s.sucursalId), ZONA_ARGENTINA);
    expect(filas.every((f) => f.producto === "Café")).toBe(true);
    const porClave = (fs: typeof filas) =>
      fs
        .map((f) => ({ grupo: f.grupo, opcion: f.opcion, unidades: f.unidades, importeCentavos: f.importeCentavos, costoCentavos: f.costoCentavos, margenCentavos: f.margenCentavos, costoIncompleto: f.costoIncompleto }))
        .sort((a, b) => `${a.grupo}|${a.opcion}`.localeCompare(`${b.grupo}|${b.opcion}`));
    expect(porClave(filas)).toEqual(esperado(specs).sort((a, b) => `${a.grupo}|${a.opcion}`.localeCompare(`${b.grupo}|${b.opcion}`)));
    // El ADICIONAL no aparece como opción, y de las cuatro opciones del precio hay una fila cada una (con ventas vigentes dentro del día).
    expect(filas.map((f) => f.opcion).sort()).toEqual(["Azúcar", "De vaca", "Mediano", "Sin leche"]);

    // La empresa ajena: con el RLS del actor propio no se ve ni pidiéndola por su sucursal; y la propia no la trae.
    expect(await generarVentasPorOpcion(sucursalAjena.id, DIA, DIA, dbDe(s.sucursalId), ZONA_ARGENTINA)).toEqual([]);
    expect(filas.some((f) => f.unidades === 7)).toBe(false);
    // La otra sucursal de la empresa se ve con el alcance de ELLA, y solo con lo suyo (mismo oráculo cambiando la sucursal).
    const deLaOtra = await generarVentasPorOpcion(otra.id, DIA, DIA, baseDeTest({ lectura: [otra.id], escritura: [otra.id] }).db, ZONA_ARGENTINA);
    expect(porClave(deLaOtra)).toEqual(
      esperado(specs.filter((e) => e.sucursal === "otra").map((e): Spec => ({ ...e, sucursal: "activa" }))).sort((a, b) => `${a.grupo}|${a.opcion}`.localeCompare(`${b.grupo}|${b.opcion}`))
    );
  }, 120_000);

  it("los bordes del día argentino y un rango de varios días: 23:30 del último día entra, 00:30 del siguiente no; el día 16 completo trae lo suyo", async () => {
    await sembrarMundo(
      [
        { estado: "vigente", tipo: "VARIANTE", enCombo: false, conCosto: true, sucursal: "activa", fecha: "borde-fin" },
        { estado: "vigente", tipo: "VARIANTE", enCombo: false, conCosto: true, sucursal: "activa", fecha: "despues" },
      ],
      { sucursalActiva: s.sucursalId, seccionActiva: s.seccion.id, sucursalOtra: s.sucursalId, seccionOtra: s.seccion.id },
      { grupoId: c.grupoLecheId, opcionId: c.vacaId, versionId: c.versionDe[c.vacaId]! },
      { grupoId: c.grupoLecheId, opcionId: c.vacaId, versionId: c.versionDe[c.vacaId]! }
    );
    const db = dbDe(s.sucursalId);
    const dia15 = await generarVentasPorOpcion(s.sucursalId, DIA, DIA, db, ZONA_ARGENTINA);
    expect(dia15.map((f) => [f.opcion, f.unidades])).toEqual([["De vaca", 2]]);
    const dia16 = await generarVentasPorOpcion(s.sucursalId, new Date("2026-10-16T00:00:00.000Z"), new Date("2026-10-16T00:00:00.000Z"), db, ZONA_ARGENTINA);
    expect(dia16.map((f) => [f.opcion, f.unidades])).toEqual([["De vaca", 2]]);
    const ambos = await generarVentasPorOpcion(s.sucursalId, DIA, new Date("2026-10-16T00:00:00.000Z"), db, ZONA_ARGENTINA);
    expect(ambos.map((f) => [f.opcion, f.unidades])).toEqual([["De vaca", 4]]);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// 2. El flujo real
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

describe("ventas por opción: el flujo real de la caja", () => {
  async function cobrar(items: Parameters<typeof agregarItems>[1], antesDeCobrar?: (cuentaId: string) => Promise<void>) {
    const mesa = await prisma.mesa.create({ data: { sucursalId: s.sucursalId, numero: 10 + (await prisma.cuenta.count()) } });
    const cuentaId = (await sembrarCuenta(mesa.id, s.admin.id)).id;
    const r = await agregarItems(cuentaId, items);
    expect(r.ok, r.mensaje).toBe(true);
    const ids = (await prisma.cuentaItem.findMany({ where: { cuentaId }, select: { id: true } })).map((i) => i.id);
    expect((await enviarACocina(cuentaId, ids)).ok).toBe(true);
    await antesDeCobrar?.(cuentaId);
    const cierre = await cerrarCuenta(cuentaId);
    expect(cierre.ok, cierre.mensaje).toBe(true);
    return cuentaId;
  }

  it("la suma de unidades del grupo MEDIDA es la del producto en «Ventas por producto»; los adicionales no suman; un ítem anulado antes de cobrar y una venta anulada después restan", async () => {
    // El día de HOY en Argentina (la zona con la que corta el reporte), como fecha «de solo día».
    const dia = fechaDeColumnaDate(diaDeCalendario(new Date(), ZONA_ARGENTINA));
    // Café grande con almendras y un shot; dos chicos (uno se anula antes de cobrar); un mediano suelto.
    await cobrar([{ productoId: c.cafeId, cantidad: 1, opciones: [elegida(c, c.grandeId), elegida(c, c.almendrasId), elegida(c, c.shotId)] }]);
    await cobrar([{ productoId: c.cafeId, cantidad: 2, opciones: [elegida(c, c.chicoId)] }], async (cuentaId) => {
      const item = await prisma.cuentaItem.findFirstOrThrow({ where: { cuentaId, productoId: c.cafeId } });
      const q = await anularItemEnviado(item.id, 1, "Se equivocó", 2);
      expect(q.ok, q.mensaje).toBe(true);
    });
    await cobrar([{ productoId: c.cafeId, cantidad: 1, opciones: [elegida(c, c.medianoId), elegida(c, c.vacaId)] }]);
    // Una venta cobrada y anulada después: sale del reporte entera.
    const anulada = await cobrar([{ productoId: c.cafeId, cantidad: 3, opciones: [elegida(c, c.medianoId)] }]);
    // Se anula la venta del café (la Operación padre); lo hace el camino de siempre.
    const operacionDeLaAnulada = (await prisma.cuentaItem.findFirstOrThrow({ where: { cuentaId: anulada }, select: { operacionId: true } })).operacionId!;
    const anulacion = await anularVenta(operacionDeLaAnulada);
    expect(anulacion.ok, anulacion.mensaje).toBe(true);

    const db = dbDe(s.sucursalId);
    const filas = await generarVentasPorOpcion(s.sucursalId, dia, dia, db, ZONA_ARGENTINA);
    const unidadesDe = (grupo: string) => filas.filter((f) => f.grupo === grupo).reduce((t, f) => t + f.unidades, 0);
    const reporte = await obtenerReportePorPeriodo(s.sucursalId, dia, dia, undefined, db, new Date(), ZONA_ARGENTINA);
    const cafe = reporte.margen.porProducto.find((p) => p.productoId === c.cafeId)!;
    expect(unidadesDe("Tamaño")).toBe(cafe.cantidad);
    expect(cafe.cantidad).toBe(3); // grande ×1, chico ×1 (el otro se anuló antes de cobrar) y mediano ×1; la anulada y el shot, no
    expect(filas.map((f) => [f.opcion, f.unidades]).sort()).toEqual([["Almendras", 1], ["Chico", 1], ["De vaca", 1], ["Grande", 1], ["Mediano", 1]]);
    expect(filas.some((f) => f.opcion === "Shot extra")).toBe(false);
  }, 60_000);
});

