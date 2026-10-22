import { beforeEach, describe, expect, it } from "vitest";
import { limpiarBaseDeTest, prisma } from "../setup/test-db";
import { clienteConEmpresaDePrueba, EMPRESA_TESTIGO_ID } from "../setup/empresa-de-prueba";
import { urlDeSembradoDeVitest } from "../setup/rol-de-pruebas";
import { sembrarCafeDelSalon, type CafeDelSalon } from "../setup/opciones";
import { sembrarSalon } from "../pos/salon-fixture";
import { cargarOpcionesParaVender, completarPreciosDeSucursal } from "../../src/server/lecturas/opciones/opciones-para-vender";

/**
 * GO-2b (ADR-030), contra Postgres real: la lectura de las opciones para vender (`server/lecturas/opciones/opciones-para-vender.ts`). Fija: lo de otra empresa no
 * se ve (la RLS: ni el producto ni sus opciones); lo que se apaga en una sucursal no apaga en otra (familia `optout`); con `precio_local` apagada no rige la grilla
 * de la sucursal (rige el precio de la empresa) y con ella prendida sí; la vigente es la versión de número mayor; y es UNA sola operación para todo el pedido.
 */

let s: Awaited<ReturnType<typeof sembrarSalon>>;
let c: CafeDelSalon;

beforeEach(async () => {
  await limpiarBaseDeTest();
  s = await sembrarSalon();
  c = await sembrarCafeDelSalon(s);
});

const enTx = <T>(fn: (tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0]) => Promise<T>) => prisma.$transaction(fn);

describe("cargarOpcionesParaVender (lectura A)", () => {
  it("trae los grupos del café en su orden, con las cantidades efectivas, la versión vigente, los consumos y la fila del producto; el ancla se reconoce", async () => {
    const opciones = await enTx((tx) => cargarOpcionesParaVender(tx, { sucursalId: s.sucursalId, productoIds: [c.cafeId, c.anclaDelShotId, s.milanesa.id] }));
    const cafe = opciones.get(c.cafeId)!;
    expect(cafe.anclaDeOpcionId).toBeNull();
    expect(cafe.grupos.map((g) => [g.nombre, g.tipo, g.cantidadMinima, g.cantidadMaxima, g.modoPrecio])).toEqual([
      ["Tamaño", "MEDIDA", 1, 1, "DIFERENCIA"],
      ["Leche", "VARIANTE", 0, 1, null],
      ["Extras", "ADICIONAL", 0, 3, null],
    ]);
    const almendras = cafe.grupos[1]!.opciones.find((o) => o.opcionId === c.almendrasId)!;
    expect(almendras).toMatchObject({ versionVigenteId: c.versionDe[c.almendrasId], diferenciaDeLaVersion: { tipo: "MONTO", monto: 150 }, admitida: true, apagadaEnSucursal: false });
    expect(almendras.consumos).toEqual([{ efecto: "REEMPLAZA", insumoProductoId: c.almendrasInsumoId, reemplazaAProductoId: c.lecheId, cantidad: 0.2, unidadStockId: s.kg.id, mermaPorcentaje: 0, escalaConLaMedida: false }]);
    expect(cafe.grupos[2]!.opciones[0]).toMatchObject({ opcionId: c.shotId, productoAnclaId: c.anclaDelShotId, cantidadMaxima: 3 });
    expect(opciones.get(c.anclaDelShotId)).toEqual({ grupos: [], anclaDeOpcionId: c.shotId, esBase: false });
    expect(opciones.get(s.milanesa.id)).toEqual({ grupos: [], anclaDeOpcionId: null, esBase: false });
    expect(cafe.esBase).toBe(false);
  });

  it("Fase 4 (ADR-035): `esBase` dice si el producto se vende por opción (lo lee de `Producto.modoDeVenta`)", async () => {
    await prisma.producto.update({ where: { id: c.cafeId }, data: { modoDeVenta: "BASE_CONFIGURABLE" } });
    const opciones = await enTx((tx) => cargarOpcionesParaVender(tx, { sucursalId: s.sucursalId, productoIds: [c.cafeId, s.milanesa.id] }));
    expect(opciones.get(c.cafeId)!.esBase).toBe(true);
    expect(opciones.get(s.milanesa.id)!.esBase).toBe(false);
  });

  it("la vigente es la versión de NÚMERO mayor (no la última creada ni la primera)", async () => {
    const v3 = await prisma.versionDeOpcion.create({ data: { opcionId: c.grandeId, numero: 3, tipoDeDiferencia: "MONTO", diferenciaPrecio: "130.00", factorEscala: "1.5000", creadoPorId: s.admin.id } });
    await prisma.versionDeOpcion.create({ data: { opcionId: c.grandeId, numero: 2, tipoDeDiferencia: "PORCENTAJE", porcentaje: "10.0000", factorEscala: "1.5000", creadoPorId: s.admin.id } });
    const opciones = await enTx((tx) => cargarOpcionesParaVender(tx, { sucursalId: s.sucursalId, productoIds: [c.cafeId] }));
    const grande = opciones.get(c.cafeId)!.grupos[0]!.opciones.find((o) => o.opcionId === c.grandeId)!;
    expect(grande.versionVigenteId).toBe(v3.id);
    expect(grande.diferenciaDeLaVersion).toEqual({ tipo: "MONTO", monto: 130 });
  });

  it("lo que se apaga en una sucursal no se apaga en la otra (sin fila = prendida)", async () => {
    const norte = await prisma.sucursal.create({ data: { nombre: "Norte" } });
    await prisma.opcionApagadaEnSucursal.create({ data: { sucursalId: norte.id, opcionId: c.almendrasId, apagada: true, actualizadoPorId: s.admin.id } });
    const apagadaEn = async (sucursalId: string) =>
      (await enTx((tx) => cargarOpcionesParaVender(tx, { sucursalId, productoIds: [c.cafeId] }))).get(c.cafeId)!.grupos[1]!.opciones.find((o) => o.opcionId === c.almendrasId)!.apagadaEnSucursal;
    expect(await apagadaEn(norte.id)).toBe(true);
    expect(await apagadaEn(s.sucursalId)).toBe(false);
  });

  it("lo de OTRA empresa no se ve: su producto (con sus opciones) no vuelve, igual que uno inexistente", async () => {
    const testigo = clienteConEmpresaDePrueba(urlDeSembradoDeVitest(), EMPRESA_TESTIGO_ID);
    const unidad = await testigo.unidad.create({ data: { nombre: "unidad", magnitud: "CANTIDAD", decimales: 0 } });
    const ajeno = await testigo.producto.create({ data: { codigo: "PV_AJENO", nombre: "Café ajeno", tipo: "PV", unidadStockId: unidad.id, precioVenta: "1.00" } });
    const grupo = await testigo.grupoDeOpciones.create({ data: { nombre: "Tamaño ajeno", tipo: "VARIANTE", cantidadMinima: 0, cantidadMaxima: 1 } });
    const opcion = await testigo.opcionDeGrupo.create({ data: { grupoId: grupo.id, nombre: "Ajena" } });
    await testigo.productoAdmiteGrupo.create({ data: { productoId: ajeno.id, grupoId: grupo.id } });
    await testigo.productoAdmiteOpcion.create({ data: { productoId: ajeno.id, opcionId: opcion.id } });
    const opciones = await enTx((tx) => cargarOpcionesParaVender(tx, { sucursalId: s.sucursalId, productoIds: [ajeno.id, "no-existe"] }));
    expect(opciones.size).toBe(0);
  });
});

describe("completarPreciosDeSucursal (lectura B: la grilla de la MEDIDA en ABSOLUTO)", () => {
  it("con precio_local prendida rige la grilla de la sucursal; apagada, rige el precio de la empresa; sin MEDIDA en ABSOLUTO no lee nada", async () => {
    await prisma.productoAdmiteGrupo.updateMany({ where: { productoId: c.cafeId, grupoId: c.grupoMedidaId }, data: { modoPrecio: "ABSOLUTO" } });
    await prisma.productoAdmiteOpcion.updateMany({ where: { productoId: c.cafeId, opcionId: c.grandeId }, data: { precioAbsoluto: "1400.00" } });
    await prisma.precioLocalDeOpcion.create({ data: { sucursalId: s.sucursalId, productoId: c.cafeId, opcionId: c.grandeId, precio: "1500.00" } });
    const precioDeSucursal = async () =>
      enTx(async (tx) => {
        const a = await cargarOpcionesParaVender(tx, { sucursalId: s.sucursalId, productoIds: [c.cafeId] });
        const b = await completarPreciosDeSucursal(tx, s.sucursalId, a, [{ productoId: c.cafeId, opcionIds: [c.grandeId] }]);
        return b.get(c.cafeId)!.grupos[0]!.opciones.find((o) => o.opcionId === c.grandeId)!.precioDeSucursal;
      });
    expect(await precioDeSucursal()).toBe(1500);
    await prisma.capacidadSucursal.create({ data: { accionClave: "precio_local", sucursalId: s.sucursalId, habilitado: false } });
    expect(await precioDeSucursal()).toBeNull();
    // Si el producto deja de admitir la opción, la grilla no rige aunque la fila exista.
    await prisma.capacidadSucursal.deleteMany({ where: { accionClave: "precio_local", sucursalId: s.sucursalId } });
    await prisma.productoAdmiteOpcion.updateMany({ where: { productoId: c.cafeId, opcionId: c.grandeId }, data: { activo: false } });
    expect(await precioDeSucursal()).toBeNull();
  });
});
