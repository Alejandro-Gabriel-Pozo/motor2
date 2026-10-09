import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, sembrarCatalogoBase, sembrarSeccion, sembrarProductoDisponible, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { registrarMovimiento } from "../../src/server/actions/movimientos/movimientos";
import { registrarConteoFisico } from "../../src/server/actions/movimientos/conteo-fisico";
import { listarStockParaConteo } from "../../src/server/consultas/movimientos/stock-para-conteo";

/**
 * La grilla del conteo físico ofrece UNA fila por (producto, lote), y la fila «sin lote» (la «—») muestra el saldo del grupo sin lote. Guardar esa fila tiene que comparar contra
 * ESE mismo saldo, no contra el total de todos los lotes del producto: lo que el operario ve es lo que se compara. Caso mixto: 10 kg con lote y 4 kg sin lote en la misma sección.
 */
describe("conteo: la fila «sin lote» se compara contra el saldo sin lote que la grilla mostró", () => {
  let sucursalId: string;
  let seccionId: string;
  let mpId: string;
  const lote = new Date(Date.now() + 30 * 24 * 3_600_000);

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    const catalogo = await sembrarCatalogoBase();
    seccionId = (await sembrarSeccion(sucursalId)).id;
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });
    mpId = (await sembrarProductoDisponible({ codigo: "MP_1", nombre: "Harina", tipo: "MP", unidadStockId: catalogo.kg.id, insumoId: catalogo.insumo.id }, sucursalId)).id;
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId, items: [{ productoId: mpId, cantidad: 10, loteVencimiento: lote }] });
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId, items: [{ productoId: mpId, cantidad: 4 }] });
  });

  it("la grilla ofrece dos filas del producto: el lote con 10 y «sin lote» con 4", async () => {
    const filas = (await listarStockParaConteo(seccionId, sucursalId, prisma)).filter((f) => f.productoId === mpId);
    expect(filas.map((f) => [f.loteVencimiento ? "con lote" : "sin lote", f.saldoSistema]).sort()).toEqual([
      ["con lote", 10],
      ["sin lote", 4],
    ]);
  });

  // DEFECTO ABIERTO (hallado al verificar la regla de cancelar por lote; a decidir por el dueño, ver «Pendientes con destino»): `registrarConteoFisico` compara un conteo SIN lote contra el TOTAL de
  // todos los lotes (`calcularSaldoTotal`), pero la grilla ofrece esa fila con el saldo del grupo sin lote. Con 10 con lote + 4 sin lote, contar la fila «—» con 4 compara contra 14 y ajusta −10 en el
  // grupo sin lote (queda −6; el total del sistema pasa de 14 a 4 con 14 físicos). `it.fails` deja el gate verde y se pone ROJO cuando se corrija: ahí se cambia a `it`.
  it.fails("contar la fila «sin lote» con los 4 que mostraba: el stock ya coincide (diferencia 0) y no se escribe ningún ajuste", async () => {
    const movimientosAntes = await prisma.movimientoStock.count();

    const r = await registrarConteoFisico({ productoId: mpId, seccionId, conteoReal: 4, fechaConteo: new Date(), accion: "AJUSTAR" });

    expect(r.ok, r.mensaje).toBe(true);
    const conteo = await prisma.conteoFisico.findFirstOrThrow({ where: { productoId: mpId } });
    expect(Number(conteo.saldoSistema), "se comparó contra el saldo sin lote de la fila (4), no contra el total de los lotes (14)").toBe(4);
    expect(Number(conteo.diferencia)).toBe(0);
    expect(await prisma.movimientoStock.count()).toBe(movimientosAntes);
  });
});
