import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));

import { baseDeTest, limpiarBaseDeTest, prisma } from "../setup/test-db";
import { elegida, sembrarCafeDelSalon, type CafeDelSalon } from "../setup/opciones";
import { entrarComo, sembrarCuenta, sembrarSalon } from "./salon-fixture";
import { AHORA_DE_LA_CORRIDA, MINUTO_MS, enElPasado } from "../setup/tiempo";
import { armarTicket, configuracionDeItemLeido } from "../../src/core/pos/ticket";
import { armarComandas } from "../../src/core/pos/comanda";
import { armarDetalleDeMesa } from "../../src/core/pos/cuenta";
import { agregarItems, enviarACocina } from "../../src/server/actions/pos/cuenta-pedido";
import { cerrarCuenta, emitirTicketCorregido } from "../../src/server/actions/pos/cuenta-cierre";
import { anularVenta } from "../../src/server/actions/movimientos/venta";
import { obtenerTicketsRecientes } from "../../src/server/consultas/pos/tickets";
import { obtenerDetalleDeMesa } from "../../src/server/consultas/pos/detalle-de-mesa";
import { listarTicketsEmitidos } from "../../src/server/consultas/reportes/tickets-emitidos";

/**
 * El nombre de la línea con opciones en el ticket, la comanda y la mesa (decisión del dueño 2026-10-29, diseño «nombre de la línea configurada»).
 * Puro: I1 (importes, cantidades y total no dependen del nombre), I2 (sin opciones, la salida es la de siempre) y la trampa del ticket (el nombre es POR LÍNEA NETA: dos cafés del
 * mismo precio con distinta configuración no se pisan). Contra Postgres: la foto manda (renombrar la opción o el grupo y reordenar los grupos no cambia lo ya vendido), número y total
 * no cambian al reimprimir ni al corregir, y la lectura repetida da lo mismo.
 */
const H1 = "a".repeat(64);
const H2 = "b".repeat(64);

describe("armarTicket, armarComandas y armarDetalleDeMesa con el nombre de la línea (puro)", () => {
  const conNombres = [
    { id: "c1", productoId: "cafe", productoNombre: "Café", cantidad: 1, precioUnitario: 1100, huellaOpciones: H1, nombreDeLinea: "Café chico almendras" },
    { id: "c2", productoId: "cafe", productoNombre: "Café", cantidad: 2, precioUnitario: 1100, huellaOpciones: H2, nombreDeLinea: "Café grande de vaca", detalleDeLinea: "papas ×2" },
    { id: "m", productoId: "mila", productoNombre: "Milanesa", cantidad: 1, precioUnitario: 9000 },
  ];
  const sinNombres = conNombres.map((i) => Object.fromEntries(Object.entries(i).filter(([campo]) => campo !== "nombreDeLinea" && campo !== "detalleDeLinea")) as typeof i);

  it("trampa: dos cafés del mismo precio y distinta configuración son dos líneas, cada una con SU nombre (y su detalle)", () => {
    const { lineas } = armarTicket(conNombres);
    expect(lineas.map((l) => [l.producto, l.cantidad, l.detalle ?? null])).toEqual([
      ["Café chico almendras", 1, null],
      ["Café grande de vaca", 2, "papas ×2"],
      ["Milanesa", 1, null],
    ]);
  });

  it("I1: importes, cantidades, subtotales y total son los mismos con y sin nombres, con y sin descuento de cliente", () => {
    for (const descuento of [null, 10]) {
      const con = armarTicket(conNombres, descuento);
      const sin = armarTicket(sinNombres, descuento);
      expect(con.total).toBe(sin.total);
      expect(con.lineas.map(({ cantidad, precioUnitario, precioListaUnitario, subtotal }) => ({ cantidad, precioUnitario, precioListaUnitario, subtotal }))).toEqual(
        sin.lineas.map(({ cantidad, precioUnitario, precioListaUnitario, subtotal }) => ({ cantidad, precioUnitario, precioListaUnitario, subtotal }))
      );
    }
  });

  it("I2: sin opciones el ticket, la comanda y el detalle de la mesa son los de siempre, sin campos nuevos", () => {
    expect(armarTicket([{ id: "m", productoId: "mila", productoNombre: "Milanesa", cantidad: 2, precioUnitario: 9000 }])).toEqual({
      lineas: [{ producto: "Milanesa", cantidad: 2, precioUnitario: 9000, subtotal: 18000 }],
      total: 18000,
    });
    const [comanda] = armarComandas([{ numero: 1, items: [{ id: "m", productoNombre: "Milanesa", restante: 2, creadoPor: "Ana", anulaciones: [] }] }], "Ana");
    expect(comanda!.lineas).toEqual([{ itemId: "m", producto: "Milanesa", cantidad: 2 }]);
    const detalle = armarDetalleDeMesa(
      {
        id: "mesa",
        numero: 4,
        cuentas: [
          {
            id: "cuenta",
            abiertaEn: enElPasado(10 * MINUTO_MS),
            comensales: null,
            clienteId: null,
            cliente: null,
            descuentoPorcentaje: null,
            abiertaPor: { name: "Ana", email: "ana@test.com" },
            items: [
              {
                id: "m",
                productoId: "mila",
                producto: { nombre: "Milanesa", modoDeVenta: "DIRECTO", unidadStock: { decimales: 0 } },
                cantidad: 2,
                precioUnitario: 9000,
                precioCartaUnitario: null,
                numeroEnvio: null,
                anulaAItemId: null,
                motivoAnulacion: null,
                creadoPor: null,
                creadoEn: enElPasado(9 * MINUTO_MS),
                promoCuenta: null,
              },
            ],
          },
        ],
      },
      AHORA_DE_LA_CORRIDA
    );
    const item = detalle!.cuenta!.sinEnviar[0]!;
    expect(item).not.toHaveProperty("nombreDeLinea");
    expect(item).not.toHaveProperty("detalleDeLinea");
  });

  it("configuracionDeItemLeido: una cuenta sin opciones devuelve {}; con opciones, el nombre compuesto sale de la foto (y un adicional solo no lleva nombre)", () => {
    const foto = (tipoGrupo: string, nombreOpcion: string, cantidad = 1) => ({ tipoGrupo, nombreOpcion, cantidad, versionDeOpcionId: "v", grupo: { prefijoEnCarta: null }, opcion: { esNinguna: false } });
    const producto = { nombre: "Café", modoDeVenta: "DIRECTO" };
    expect(configuracionDeItemLeido(false, { producto, opcionesElegidas: [foto("MEDIDA", "Chico")] })).toEqual({});
    expect(configuracionDeItemLeido(true, { id: "c", huellaOpciones: H1, producto, opcionesElegidas: [foto("VARIANTE", "Solo"), foto("MEDIDA", "Chico")] })).toEqual({ id: "c", huellaOpciones: H1, nombreDeLinea: "Café solo chico" });
    expect(configuracionDeItemLeido(true, { id: "s", lineaPadreId: "c", producto: { nombre: "Shot extra", modoDeVenta: "DIRECTO" }, opcionesElegidas: [foto("ADICIONAL", "Shot extra", 2)] })).toEqual({
      id: "s",
      lineaPadreId: "c",
      versionDeAdicional: "v",
    });
  });
});

describe("el nombre de la línea contra Postgres: la foto manda", () => {
  let s: Awaited<ReturnType<typeof sembrarSalon>>;
  let c: CafeDelSalon;
  let cuentaId: string;
  const db = () => baseDeTest({ lectura: [s.sucursalId], escritura: [s.sucursalId] }).db;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    s = await sembrarSalon();
    c = await sembrarCafeDelSalon(s);
    await entrarComo(s.admin);
    cuentaId = (await sembrarCuenta(s.mesa.id, s.admin.id)).id;
    // Chico (-50) + Almendras (+150) y Grande (+100) + De vaca (0) valen lo mismo, 1.100: dos líneas del mismo producto al mismo precio, con distinta configuración.
    expect(
      (
        await agregarItems(cuentaId, [
          { productoId: c.cafeId, cantidad: 1, opciones: [elegida(c, c.chicoId), elegida(c, c.almendrasId)] },
          { productoId: c.cafeId, cantidad: 1, opciones: [elegida(c, c.grandeId), elegida(c, c.vacaId)] },
        ])
      ).ok
    ).toBe(true);
    const items = await prisma.cuentaItem.findMany({ where: { cuentaId } });
    expect((await enviarACocina(cuentaId, items.map((i) => i.id))).ok).toBe(true);
  });

  const NOMBRES = ["Café chico almendras", "Café grande de vaca"];

  it("la mesa abierta y su comanda nombran cada línea, y el nombre del producto (lo que la identifica) sigue siendo «Café»", async () => {
    const detalle = await obtenerDetalleDeMesa(s.sucursalId, s.mesa.id, db(), new Date());
    const items = detalle!.cuenta!.envios[0]!.items;
    expect(items.map((i) => [i.productoNombre, i.nombreDeLinea])).toEqual([["Café", NOMBRES[0]], ["Café", NOMBRES[1]]]);
    const [comanda] = armarComandas(detalle!.cuenta!.envios, detalle!.cuenta!.mesero);
    expect(comanda!.lineas.map((l) => l.producto)).toEqual(NOMBRES);
  });

  it("al cerrar, reimprimir y corregir: renombrar la opción y el grupo y reordenar los grupos no cambia el nombre de lo vendido; el número y el total, tampoco", async () => {
    expect((await cerrarCuenta(cuentaId)).ok).toBe(true);
    const [antes] = await obtenerTicketsRecientes(s.sucursalId, s.mesa.id, db(), undefined, new Date());
    expect(antes!.lineas.map((l) => [l.producto, l.precioUnitario])).toEqual([[NOMBRES[0], 1100], [NOMBRES[1], 1100]]);
    expect(antes!.total).toBe(2200);

    // El dueño renombra una opción y un grupo, y pone la leche antes que el tamaño: lo vendido no se toca.
    await prisma.opcionDeGrupo.update({ where: { id: c.chicoId }, data: { nombre: "Pequeño" } });
    await prisma.grupoDeOpciones.update({ where: { id: c.grupoLecheId }, data: { nombre: "Tipo de leche" } });
    await prisma.productoAdmiteGrupo.updateMany({ where: { productoId: c.cafeId, grupoId: c.grupoMedidaId }, data: { orden: 10 } });
    await prisma.productoAdmiteGrupo.updateMany({ where: { productoId: c.cafeId, grupoId: c.grupoLecheId }, data: { orden: 0 } });

    const [despues] = await obtenerTicketsRecientes(s.sucursalId, s.mesa.id, db(), undefined, new Date());
    expect(despues).toEqual(antes);
    const emitidos = await listarTicketsEmitidos(s.sucursalId, {}, db());
    expect(emitidos.items[0]!.detalle.lineas.map((l) => l.producto)).toEqual(NOMBRES);
    expect(emitidos.items[0]!.importe).toBe(2200);
    expect(emitidos.items[0]!.numero).toEqual(antes!.numero);

    // Se anula una línea de la venta y se corrige el ticket: el ejemplar nuevo sale con el mismo formato, el mismo número y lo que sigue vendido.
    const grande = await prisma.cuentaItem.findFirstOrThrow({ where: { cuentaId, huellaOpciones: { not: null }, opcionesElegidas: { some: { opcionId: c.grandeId } } } });
    expect((await anularVenta(grande.operacionId!)).ok).toBe(true);
    expect((await emitirTicketCorregido(cuentaId, "Se equivocó de mesa")).ok).toBe(true);
    const [corregido] = await obtenerTicketsRecientes(s.sucursalId, s.mesa.id, db(), undefined, new Date());
    expect(corregido!.lineas.map((l) => [l.producto, l.subtotal])).toEqual([[NOMBRES[0], 1100]]);
    expect(corregido!.total).toBe(1100);
    expect(corregido!.numero).toEqual({ numero: antes!.numero!.numero, ejemplar: 2 });
  });
});
