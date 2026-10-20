import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));

import { crearUsuarioConMembresia, limpiarBaseDeTest, prisma, sembrarBase } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { guardarPrecioLocalPromoCarta } from "../../src/server/actions/carta/promos";
import type { ResultadoAccion } from "../../src/server/actions/tipos";

/**
 * Precio de una promo en la sucursal activa con control del VALOR VISTO (ola «precio y carta», Fase 2, paso A6), por la Server Action pública y contra Postgres real: el precio que mostraba el
 * formulario se compara con el de la base DENTRO de la transacción SERIALIZABLE; si otra persona lo cambió, no se pisa. El mismo pedido repetido es un solo cambio.
 */
const ITERACIONES = 8;

describe("precio local de una promo: control del valor visto (A6)", () => {
  let sucursalId: string;
  let otraSucursalId: string;
  let seccionCartaId: string;
  let n = 0;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    otraSucursalId = (await prisma.sucursal.create({ data: { nombre: "Norte" } })).id;
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });
    seccionCartaId = (await prisma.seccionCarta.create({ data: { nombre: "Promos" } })).id;
  });

  /** Una promo de $1000 prendida en la sucursal activa, con su precio local (`null` = el de la empresa). */
  const promo = async (precioLocal: number | null = null) =>
    (await prisma.promoCarta.create({ data: { sucursales: { create: { sucursalId, precioLocal } }, seccionCartaId, titulo: `Promo ${n++}`, precio: 1000 } })).id;
  const local = async (id: string) => {
    const f = await prisma.promoCartaSucursal.findUnique({ where: { promoCartaId_sucursalId: { promoCartaId: id, sucursalId } } });
    return f ? (f.precioLocal === null ? null : Number(f.precioLocal)) : "sin fila";
  };
  const auditorias = (id: string) => prisma.registroAuditoria.count({ where: { entidad: "PromoCartaSucursal", entidadId: `${id}:${sucursalId}` } });
  const codigo = (r: PromiseSettledResult<ResultadoAccion>) =>
    r.status === "rejected" ? `error:${String(r.reason)}` : r.value.ok ? "ok" : r.value.mensaje.includes("cambió mientras lo editabas") ? "PRECIO_DESACTUALIZADO" : r.value.mensaje;

  it(`concurrencia (${ITERACIONES} vueltas): dos precios DISTINTOS con el mismo valor visto → uno gana, el otro PRECIO_DESACTUALIZADO, UNA auditoría`, async () => {
    for (let i = 0; i < ITERACIONES; i++) {
      const id = await promo(900);
      const res = await Promise.allSettled([guardarPrecioLocalPromoCarta(id, 950, 900), guardarPrecioLocalPromoCarta(id, "980", 900)]);
      expect(res.map(codigo).sort(), `vuelta ${i}`).toEqual(["PRECIO_DESACTUALIZADO", "ok"]);
      const gano = res.findIndex((r) => r.status === "fulfilled" && r.value.ok);
      expect([await local(id), await auditorias(id)], `vuelta ${i}`).toEqual([gano === 0 ? 950 : 980, 1]);
    }
  });

  it(`concurrencia (${ITERACIONES} vueltas): el MISMO pedido dos veces a la vez → dos ok, un solo cambio y una auditoría`, async () => {
    for (let i = 0; i < ITERACIONES; i++) {
      const id = await promo(null);
      const pedido = () => guardarPrecioLocalPromoCarta(id, "1100", null);
      expect((await Promise.allSettled([pedido(), pedido()])).map(codigo), `vuelta ${i}`).toEqual(["ok", "ok"]);
      expect([await local(id), await auditorias(id)], `vuelta ${i}`).toEqual([1100, 1]);
    }
  });

  it("IDEMPOTENTE: repetir el pedido con el valor visto de antes → el mismo éxito, sin escribir ni auditar de nuevo (también la vuelta al de la empresa)", async () => {
    const id = await promo(900);
    expect(await guardarPrecioLocalPromoCarta(id, "1100", 900)).toEqual({ ok: true, mensaje: `Precio de "Promo ${n - 1}" en esta sucursal: $1100.` });
    expect(await guardarPrecioLocalPromoCarta(id, "1100", 900)).toEqual({ ok: true, mensaje: `Precio de "Promo ${n - 1}" en esta sucursal: $1100.` });
    expect(await guardarPrecioLocalPromoCarta(id, null, 1100)).toMatchObject({ ok: true });
    expect(await guardarPrecioLocalPromoCarta(id, null, 1100)).toMatchObject({ ok: true });
    expect([await local(id), await auditorias(id)]).toEqual([null, 2]);
  });

  it("un valor visto viejo (otro lo cambió) → PRECIO_DESACTUALIZADO con el precio de ahora, sin escribir ni auditar; sin visto también (falla cerrado)", async () => {
    const id = await promo(1200);
    expect(await guardarPrecioLocalPromoCarta(id, "1300", 900)).toEqual({
      ok: false,
      mensaje: `El precio de "Promo ${n - 1}" en esta sucursal cambió mientras lo editabas (ahora es $1.200). Recargá la pantalla y volvé a hacer el cambio.`,
    });
    expect(await guardarPrecioLocalPromoCarta(id, "1300")).toMatchObject({ ok: false, mensaje: expect.stringContaining("(ahora es $1.200)") });
    expect(await guardarPrecioLocalPromoCarta(id, null)).toMatchObject({ ok: false });
    const otra = await promo(null);
    expect(await guardarPrecioLocalPromoCarta(otra, "1300", 900)).toMatchObject({ ok: false, mensaje: expect.stringContaining("(ahora rige el de la empresa)") });
    expect([await local(id), await local(otra), await auditorias(id), await auditorias(otra)]).toEqual([1200, null, 0, 0]);
  });

  it("sin fila en la sucursal (todavía no la ofrece), el atajo no aplica: se crea APAGADA como siempre, también con el precio nulo", async () => {
    const id = (await prisma.promoCarta.create({ data: { sucursales: { create: { sucursalId: otraSucursalId } }, seccionCartaId, titulo: "Aún no", precio: 1000 } })).id;
    expect(await guardarPrecioLocalPromoCarta(id, null)).toMatchObject({ ok: true });
    expect(await prisma.promoCartaSucursal.findUniqueOrThrow({ where: { promoCartaId_sucursalId: { promoCartaId: id, sucursalId } } })).toMatchObject({ activa: false, precioLocal: null });
    expect(await auditorias(id)).toBe(0);
  });

  it("un valor visto con mal formato se rechaza sin escribir", async () => {
    const id = await promo(900);
    expect(await guardarPrecioLocalPromoCarta(id, "1000", "abc" as never)).toEqual({ ok: false, mensaje: "El precio que mostraba la pantalla no es válido: recargala." });
    expect(await guardarPrecioLocalPromoCarta(id, "1000", -5)).toMatchObject({ ok: false });
    expect(await local(id)).toBe(900);
  });
});
