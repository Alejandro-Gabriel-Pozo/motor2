import { beforeEach, describe, expect, it } from "vitest";
import { limpiarBaseDeTest, prisma } from "../setup/test-db";
import { elegida, sembrarCafeDelSalon, type CafeDelSalon } from "../setup/opciones";
import { sembrarCuenta, sembrarSalon } from "./salon-fixture";
import { armarLineaConfigurada } from "../../src/core/pos/linea-configurada";
import { cargarOpcionesParaVender } from "../../src/server/lecturas/opciones/opciones-para-vender";
import { escribirLineaConfigurada } from "../../src/server/persistencia/pos/pedido";

/**
 * GO-2b (ADR-030), contra Postgres real con el rol de la app (RLS y los tres disparadores de GO-1d): lo que arma `armarLineaConfigurada` (paso 2) con lo que lee
 * `cargarOpcionesParaVender` (paso 3) lo aceptan los disparadores y los CHECK tal cual; y si algo falla al final (una foto que el disparador rechaza), la
 * transacción se deshace entera: no queda ni la línea ni el adicional.
 */
let s: Awaited<ReturnType<typeof sembrarSalon>>;
let c: CafeDelSalon;
let cuentaId: string;

beforeEach(async () => {
  await limpiarBaseDeTest();
  s = await sembrarSalon();
  c = await sembrarCafeDelSalon(s);
  cuentaId = (await sembrarCuenta(s.mesa.id, s.admin.id)).id;
});

async function armarGrandeConAlmendrasYShots(shots: number) {
  return prisma.$transaction(async (tx) => {
    const opciones = await cargarOpcionesParaVender(tx, { sucursalId: s.sucursalId, productoIds: [c.cafeId] });
    const r = armarLineaConfigurada({ grupos: opciones.get(c.cafeId)!.grupos, elegidas: [elegida(c, c.grandeId), elegida(c, c.almendrasId), elegida(c, c.shotId, shots)], precioBase: 1000, descuentoDeProducto: null, cantidad: 2 });
    if (!r.ok || !r.linea) throw new Error(`debería armarse: ${JSON.stringify(r)}`);
    return r.linea;
  });
}

describe("escribirLineaConfigurada (GO-2b)", () => {
  it("la línea, el adicional y las fotos que arma el núcleo pasan los disparadores y quedan enlazados", async () => {
    const linea = await armarGrandeConAlmendrasYShots(2);
    const ids = await prisma.$transaction((tx) =>
      escribirLineaConfigurada(tx, { cuentaId, creadoPorId: s.admin.id, linea: { productoId: c.cafeId, cantidad: 2, ...linea }, adicionales: linea.adicionales.map((a) => ({ productoId: a.productoId, cantidad: a.cantidad, precioUnitario: a.precioUnitario, foto: a.foto })) })
    );
    const items = await prisma.cuentaItem.findMany({ where: { cuentaId }, include: { opcionesElegidas: { orderBy: { orden: "asc" } } }, orderBy: [{ creadoEn: "asc" }, { id: "asc" }] });
    const padre = items.find((i) => i.id === ids.lineaId)!;
    const shot = items.find((i) => i.id === ids.adicionalIds[0])!;
    expect(items).toHaveLength(2);
    expect({ cantidad: Number(padre.cantidad), precio: Number(padre.precioUnitario), huella: padre.huellaOpciones, padre: padre.lineaPadreId }).toEqual({ cantidad: 2, precio: 1250, huella: linea.huellaOpciones, padre: null });
    expect(padre.opcionesElegidas.map((f) => [f.nombreOpcion, f.tipoGrupo, Number(f.importeUnitario), f.modoPrecio, f.factorEscala === null ? null : Number(f.factorEscala)])).toEqual([
      ["Grande", "MEDIDA", 100, "DIFERENCIA", 1.5],
      ["Almendras", "VARIANTE", 150, null, null],
    ]);
    expect({ producto: shot.productoId, cantidad: Number(shot.cantidad), precio: Number(shot.precioUnitario), padre: shot.lineaPadreId, huella: shot.huellaOpciones }).toEqual({
      producto: c.anclaDelShotId,
      cantidad: 4,
      precio: 200,
      padre: padre.id,
      huella: null,
    });
    expect(shot.opcionesElegidas.map((f) => [f.nombreOpcion, f.cantidad, Number(f.importeUnitario), f.tipoDeDiferencia])).toEqual([["Shot extra", 2, 200, "MONTO"]]);
  });

  it("si la foto del adicional no es coherente (no va en la línea de su ancla), el disparador la rechaza y NO queda nada: ni la línea ni el adicional", async () => {
    const linea = await armarGrandeConAlmendrasYShots(1);
    await expect(
      prisma.$transaction((tx) =>
        escribirLineaConfigurada(tx, {
          cuentaId,
          creadoPorId: s.admin.id,
          linea: { productoId: c.cafeId, cantidad: 2, ...linea },
          adicionales: linea.adicionales.map((a) => ({ productoId: s.flan.id, cantidad: a.cantidad, precioUnitario: a.precioUnitario, foto: a.foto })),
        })
      )
    ).rejects.toThrow(/OpcionElegidaEnLinea_adicional_en_su_linea_chk|adicional va en una línea/);
    expect(await prisma.cuentaItem.count({ where: { cuentaId } })).toBe(0);
    expect(await prisma.opcionElegidaEnLinea.count()).toBe(0);
  });
});
