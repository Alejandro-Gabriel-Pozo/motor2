import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));

import { baseDeTest, limpiarBaseDeTest, prisma } from "../setup/test-db";
import { entrarComo, sembrarCuenta, sembrarSalon } from "./salon-fixture";
import { configuracionDeItemLeido, nombreParaElTicket } from "../../src/core/pos/ticket";
import { agregarItems, enviarACocina } from "../../src/server/actions/pos/cuenta-pedido";
import { cerrarCuenta } from "../../src/server/actions/pos/cuenta-cierre";
import { obtenerTicketsRecientes } from "../../src/server/consultas/pos/tickets";
import { listarTicketsEmitidos } from "../../src/server/consultas/reportes/tickets-emitidos";

/**
 * «Nombre en la carta» en el TICKET del cliente (2026-11-04, confirmado por el dueño): un producto DIRECTO (sin opción que defina el plato) se imprime con `nombreEnCarta ?? nombre`; una base sigue con el
 * rótulo de la opción de la medida. La COMANDA de cocina no cambia (`test/pos/comanda.test.ts`). El ticket de una cuenta cerrada se arma «derivado, sin tabla»: se lee VIGENTE (ver el diseño: qué pasa si el nombre
 * de la carta cambia después de cerrar, y la propuesta de congelarlo, que necesitaría una columna nueva y NO se implementa).
 */
describe("nombreParaElTicket y configuracionDeItemLeido (puro)", () => {
  it("producto directo: el nombre de la carta si lo tiene; si no (null, sin fila, sin la clave), el del producto", () => {
    expect(nombreParaElTicket({ nombre: "Milanesa", modoDeVenta: "DIRECTO", contenidosCarta: [{ nombreEnCarta: "La Napo" }] })).toBe("La Napo");
    expect(nombreParaElTicket({ nombre: "Milanesa", modoDeVenta: "DIRECTO", contenidosCarta: [{ nombreEnCarta: null }] })).toBe("Milanesa");
    expect(nombreParaElTicket({ nombre: "Milanesa", modoDeVenta: "DIRECTO", contenidosCarta: [] })).toBe("Milanesa");
    expect(nombreParaElTicket({ nombre: "Milanesa", modoDeVenta: "DIRECTO" })).toBe("Milanesa");
  });

  it("directo con opciones: el nombre de la carta más las partes («La Napo grande»); base con medida: el rótulo de la opción, nunca el nombre del producto ni el de la carta", () => {
    const foto = (tipoGrupo: string, nombreOpcion: string) => ({ tipoGrupo, nombreOpcion, cantidad: 1, versionDeOpcionId: "v", grupo: { prefijoEnCarta: null }, opcion: { esNinguna: false } });
    const directo = { nombre: "Café", modoDeVenta: "DIRECTO", contenidosCarta: [{ nombreEnCarta: "Cafecito" }] };
    expect(configuracionDeItemLeido(true, { huellaOpciones: "h", producto: directo, opcionesElegidas: [foto("MEDIDA", "Grande")] }).nombreDeLinea).toBe("Cafecito grande");
    const base = { nombre: "BIFE-", modoDeVenta: "BASE_CONFIGURABLE", contenidosCarta: [{ nombreEnCarta: "El Bife" }] };
    const r = configuracionDeItemLeido(true, { huellaOpciones: "h", producto: base, opcionesElegidas: [foto("MEDIDA", "Bife de chorizo a la criolla"), foto("INCLUIDA", "Nalga")] });
    expect(r.nombreDeLinea).toBe("Bife de chorizo a la criolla");
    expect(r.detalleDeLinea).toBe("nalga");
  });
});

describe("el ticket contra Postgres", () => {
  let s: Awaited<ReturnType<typeof sembrarSalon>>;
  let cuentaId: string;
  const db = () => baseDeTest({ lectura: [s.sucursalId], escritura: [s.sucursalId] }).db;
  const ticket = async () => (await obtenerTicketsRecientes(s.sucursalId, s.mesa.id, db(), undefined, new Date()))[0]!;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    s = await sembrarSalon();
    await entrarComo(s.admin);
    cuentaId = (await sembrarCuenta(s.mesa.id, s.admin.id)).id;
    // La Milanesa tiene nombre en la carta de ESTA sucursal; el Flan no.
    await prisma.contenidoCartaProducto.create({ data: { sucursalId: s.sucursalId, productoId: s.milanesa.id, visibleEnCarta: false, orden: 0, nombreEnCarta: "La Napo" } });
    expect((await agregarItems(cuentaId, [{ productoId: s.milanesa.id, cantidad: 2 }, { productoId: s.flan.id, cantidad: 1 }])).ok).toBe(true);
    const items = await prisma.cuentaItem.findMany({ where: { cuentaId } });
    expect((await enviarACocina(cuentaId, items.map((i) => i.id))).ok).toBe(true);
    expect((await cerrarCuenta(cuentaId)).ok).toBe(true);
  });

  it("el ticket nombra a la Milanesa con su nombre de la carta y al Flan con el suyo; los importes y el total no cambian", async () => {
    const t = await ticket();
    expect(t.lineas.map((l) => [l.producto, l.cantidad, l.subtotal])).toEqual([["La Napo", 2, 18000], ["Flan", 1, 3000]]);
    expect(t.total).toBe(21000);
  });

  it("la reimpresión (reporte de tickets emitidos) da lo mismo que el ticket de la mesa mientras el nombre de la carta no cambió", async () => {
    const t = await ticket();
    const emitidos = await listarTicketsEmitidos(s.sucursalId, {}, db());
    expect(emitidos.items[0]!.detalle.lineas.map((l) => l.producto)).toEqual(t.lineas.map((l) => l.producto));
    expect(emitidos.items[0]!.importe).toBe(t.total);
  });

  it("si el nombre de la carta CAMBIA después de cerrar, el ticket y su reimpresión leen el vigente (derivado, sin tabla: hoy NO se congela); el importe y el número no cambian", async () => {
    const antes = await ticket();
    await prisma.contenidoCartaProducto.updateMany({ where: { sucursalId: s.sucursalId, productoId: s.milanesa.id }, data: { nombreEnCarta: "Milanesa de la casa" } });
    const despues = await ticket();
    expect(despues.lineas.map((l) => l.producto)).toEqual(["Milanesa de la casa", "Flan"]);
    expect(despues.total).toBe(antes.total);
    expect(despues.numero).toEqual(antes.numero);
    const emitidos = await listarTicketsEmitidos(s.sucursalId, {}, db());
    expect(emitidos.items[0]!.detalle.lineas.map((l) => l.producto)).toEqual(["Milanesa de la casa", "Flan"]);
  });

  it("el nombre de la carta de OTRA sucursal no entra al ticket", async () => {
    const otra = await prisma.sucursal.create({ data: { nombre: "Otra" } });
    await prisma.contenidoCartaProducto.updateMany({ where: { sucursalId: s.sucursalId, productoId: s.milanesa.id }, data: { nombreEnCarta: null } });
    await prisma.contenidoCartaProducto.create({ data: { sucursalId: otra.id, productoId: s.milanesa.id, visibleEnCarta: false, orden: 0, nombreEnCarta: "Nombre de otra sucursal" } });
    expect((await ticket()).lineas.map((l) => l.producto)).toEqual(["Milanesa", "Flan"]);
  });
});
