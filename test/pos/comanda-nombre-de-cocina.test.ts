import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));

import { DATOS_EMPRESA_TESTIGO, EMPRESA_TESTIGO_ID } from "../setup/empresa-de-prueba";
import { limpiarBaseDeTest, prisma, prismaAdmin } from "../setup/test-db";
import { entrarComo, sembrarCuenta, sembrarSalon } from "./salon-fixture";
import { agregarItems, enviarACocina } from "../../src/server/actions/pos/cuenta-pedido";
import { anularItemEnviado } from "../../src/server/actions/pos/cuenta-anulacion";
import { actualizarProducto } from "../../src/server/actions/catalogo/productos";
import { obtenerDetalleDeMesa } from "../../src/server/consultas/pos/detalle-de-mesa";
import { cargarNombresDeCocina } from "../../src/server/lecturas/pos/nombres-de-cocina";
import { armarComandas } from "../../src/core/pos/public";

/**
 * Nombre de cocina en la comanda (2026-11-15; `docs/diseno-nombre-de-cocina-como-pedernal-2026-11-15.md`, etapa (c)): el nombre se CONGELA en la línea al agregarla (`CuentaItem.nombreDeCocina`) y la comanda, su reimpresión y
 * el aviso de anulación lo usan; sin él, el nombre interno como siempre. Oráculo del diseño: O1 a O6 y O14/O15 (con la pantalla del mozo y el ticket intactos); concurrencia, idempotencia, aislamiento y que el mozo
 * no elige el nombre.
 */
const MILANESA_DE_COCINA = "Suprema de pollo";
const ITERACIONES = 8;

describe("nombre de cocina en la comanda", () => {
  let s: Awaited<ReturnType<typeof sembrarSalon>>;
  let cuentaId: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    s = await sembrarSalon();
    await entrarComo(s.admin);
    cuentaId = (await sembrarCuenta(s.mesa.id, s.admin.id)).id;
    await prisma.producto.update({ where: { id: s.milanesa.id }, data: { nombreDeCocina: MILANESA_DE_COCINA } });
  });

  const lineas = () => prisma.cuentaItem.findMany({ where: { cuentaId, anulaAItemId: null }, orderBy: { creadoEn: "asc" } });
  const detalle = async () => (await obtenerDetalleDeMesa(s.sucursalId, s.mesa.id, prisma, new Date()))!.cuenta!;
  const comandas = async () => {
    const c = await detalle();
    return armarComandas(c.envios, c.mesero);
  };
  const agregarYEnviar = async (items: { productoId: string; cantidad: number }[]) => {
    expect((await agregarItems(cuentaId, items)).ok).toBe(true);
    const ids = (await lineas()).filter((i) => i.numeroEnvio === null).map((i) => i.id);
    expect((await enviarACocina(cuentaId, ids)).ok).toBe(true);
  };

  it("O1/O2: al agregar se congela el nombre de cocina del producto (nulo si no lo tiene); la comanda dice el de cocina o, sin él, el interno; el mozo y el ticket siguen con el nombre de siempre", async () => {
    await agregarYEnviar([{ productoId: s.milanesa.id, cantidad: 2 }, { productoId: s.flan.id, cantidad: 1 }]);
    expect((await lineas()).map((i) => [i.productoId === s.milanesa.id ? "milanesa" : "flan", i.nombreDeCocina])).toEqual([["milanesa", MILANESA_DE_COCINA], ["flan", null]]);
    const [comanda] = await comandas();
    expect(comanda!.lineas.map((l) => [l.producto, l.cantidad])).toEqual([[MILANESA_DE_COCINA, 2], ["Flan", 1]]);
    // La pantalla del mozo (y con ella el ticket y los reportes, que leen `productoNombre`) sigue con el nombre interno.
    expect((await detalle()).envios[0]!.items.map((i) => i.productoNombre)).toEqual(["Milanesa", "Flan"]);
  });

  it("O3/O4/O15: renombrar el producto, cambiarle el nombre de cocina o borrárselo NO cambia lo ya enviado; reimprimir da lo mismo; una línea nueva sí lleva el valor del momento", async () => {
    await agregarYEnviar([{ productoId: s.milanesa.id, cantidad: 1 }]);
    const original = await comandas();
    await prisma.producto.update({ where: { id: s.milanesa.id }, data: { nombre: "Milanesa napolitana", nombreDeCocina: "Otro nombre de cocina" } });
    expect(await comandas(), "después de renombrar y cambiar el nombre de cocina").toEqual(original);
    await prisma.producto.update({ where: { id: s.milanesa.id }, data: { nombreDeCocina: null } });
    expect(await comandas(), "después de borrarle el nombre de cocina").toEqual(original);
    expect(await comandas(), "reimprimir dos veces: salidas idénticas").toEqual(await comandas());
    await prisma.producto.update({ where: { id: s.milanesa.id }, data: { nombreDeCocina: "Nombre nuevo" } });
    await agregarYEnviar([{ productoId: s.milanesa.id, cantidad: 1 }]);
    const despues = await comandas();
    expect(despues.map((c) => c.lineas.map((l) => l.producto))).toEqual([[MILANESA_DE_COCINA], ["Nombre nuevo"]]);
  });

  it("O5: una línea anterior a esta función (sin nombre congelado) sale con el nombre interno actual del producto, aunque el producto ya tenga nombre de cocina", async () => {
    const vieja = await prisma.cuentaItem.create({ data: { cuentaId, productoId: s.milanesa.id, cantidad: 1, precioUnitario: 9000, numeroEnvio: 1, creadoPorId: s.admin.id } });
    expect(vieja.nombreDeCocina).toBeNull();
    const [comanda] = await comandas();
    expect(comanda!.lineas.map((l) => l.producto)).toEqual(["Milanesa"]);
  });

  it("O6: anular parte de un ítem enviado: el espejo repite el nombre congelado y el aviso de anulación y el resto vigente dicen el mismo nombre con el que salió", async () => {
    await agregarYEnviar([{ productoId: s.milanesa.id, cantidad: 3 }]);
    const [item] = await lineas();
    expect((await anularItemEnviado(item!.id, 1, "Pidió una menos", 3)).ok).toBe(true);
    const espejo = await prisma.cuentaItem.findFirstOrThrow({ where: { anulaAItemId: item!.id } });
    expect(espejo.nombreDeCocina).toBe(MILANESA_DE_COCINA);
    // Aunque después se renombre todo, el aviso sigue diciendo con qué nombre salió.
    await prisma.producto.update({ where: { id: s.milanesa.id }, data: { nombre: "Milanesa napolitana", nombreDeCocina: null } });
    const [comanda] = await comandas();
    expect(comanda!.lineas.map((l) => [l.producto, l.cantidad])).toEqual([[MILANESA_DE_COCINA, 2]]);
    expect(comanda!.anulaciones.map((a) => [a.producto, a.cantidad, a.quedan])).toEqual([[MILANESA_DE_COCINA, 1, 2]]);
  });

  it("el mozo NO elige el nombre: un `nombreDeCocina` mandado en el pedido se ignora y se congela el del producto", async () => {
    const intruso = { productoId: s.flan.id, cantidad: 1, nombreDeCocina: "Inventado por el cliente" } as unknown as { productoId: string; cantidad: number };
    expect((await agregarItems(cuentaId, [intruso])).ok).toBe(true);
    expect((await lineas()).map((i) => i.nombreDeCocina)).toEqual([null]);
  });

  it("idempotencia: el MISMO pedido dos veces con la misma clave deja una sola línea, con el nombre congelado una sola vez", async () => {
    const clave = "33333333-3333-4333-8333-333333333333";
    expect((await agregarItems(cuentaId, [{ productoId: s.milanesa.id, cantidad: 1 }], [], clave)).ok).toBe(true);
    expect((await agregarItems(cuentaId, [{ productoId: s.milanesa.id, cantidad: 1 }], [], clave)).ok).toBe(true);
    expect((await lineas()).map((i) => i.nombreDeCocina)).toEqual([MILANESA_DE_COCINA]);
  });

  it(`CARRERA (${ITERACIONES} vueltas): cambiar el nombre de cocina mientras otra persona agrega la línea → la línea queda con UNO de los dos valores, completo (nunca mezclado ni vacío por la carrera)`, async () => {
    for (let i = 0; i < ITERACIONES; i++) {
      const antes = `Nombre ${i} a`;
      const despues = `Nombre ${i} b`;
      await prisma.producto.update({ where: { id: s.milanesa.id }, data: { nombreDeCocina: antes } });
      await prisma.cuentaItem.deleteMany({ where: { cuentaId } });
      const res = await Promise.allSettled([agregarItems(cuentaId, [{ productoId: s.milanesa.id, cantidad: 1 }]), actualizarProducto(s.milanesa.id, { nombreDeCocina: despues })]);
      expect(res.map((r) => r.status === "fulfilled" && r.value.ok), `vuelta ${i}`).toEqual([true, true]);
      const [linea] = await lineas();
      expect([antes, despues], `vuelta ${i}`).toContain(linea!.nombreDeCocina);
      expect((await prisma.producto.findUniqueOrThrow({ where: { id: s.milanesa.id } })).nombreDeCocina, `vuelta ${i}`).toBe(despues);
    }
  });

  it("aislamiento: la lectura del nombre de cocina no ve productos de OTRA empresa (aunque se le pase su id)", async () => {
    await prismaAdmin.empresa.upsert({ where: { id: EMPRESA_TESTIGO_ID }, update: { estado: "ACTIVE" }, create: DATOS_EMPRESA_TESTIGO });
    try {
      const unidadAjena = await prismaAdmin.unidad.create({ data: { empresaId: EMPRESA_TESTIGO_ID, nombre: "u", magnitud: "CANTIDAD", decimales: 0 } });
      const ajeno = await prismaAdmin.producto.create({
        data: { empresaId: EMPRESA_TESTIGO_ID, codigo: "PV_AJENO", nombre: "Bife ajeno", tipo: "PV", unidadStockId: unidadAjena.id, precioVenta: 1000, nombreDeCocina: "Del testigo" },
      });
      expect([...(await cargarNombresDeCocina(prisma, [ajeno.id, s.milanesa.id, s.flan.id]))]).toEqual([[s.milanesa.id, MILANESA_DE_COCINA]]);
      expect((await agregarItems(cuentaId, [{ productoId: ajeno.id, cantidad: 1 }])).ok, "agregarlo a la cuenta tampoco se puede").toBe(false);
      expect(await lineas()).toEqual([]);
    } finally {
      await prismaAdmin.producto.deleteMany({ where: { empresaId: EMPRESA_TESTIGO_ID } });
      await prismaAdmin.unidad.deleteMany({ where: { empresaId: EMPRESA_TESTIGO_ID } });
      await prismaAdmin.empresa.deleteMany({ where: { id: EMPRESA_TESTIGO_ID } });
    }
  });
});
