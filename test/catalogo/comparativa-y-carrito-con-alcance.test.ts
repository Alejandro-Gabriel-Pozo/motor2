import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));
// Las dos lecturas se dejan REALES (con espía): lo que se mide, además de lo que devuelven, es con qué base —y por lo tanto con qué alcance por sucursal— las llama la acción.
vi.mock("../../src/server/lecturas/catalogo/ofertas-de-proveedor", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../src/server/lecturas/catalogo/ofertas-de-proveedor")>();
  return { ...original, cargarComparativaDePrecios: vi.fn(original.cargarComparativaDePrecios), cargarProductosDeProveedorParaElCarrito: vi.fn(original.cargarProductosDeProveedorParaElCarrito) };
});

import { crearUsuarioConMembresia, limpiarBaseDeTest, prisma, prismaAdmin, sembrarBase, sembrarCatalogoBase, sembrarCompraDeKardex, sembrarProductoDisponible, sembrarSeccion } from "../setup/test-db";
import { crearMembresia } from "../setup/membresia";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { __setCookieDeTestParaSucursal } from "../setup/next-headers-stub";
import { listarProductosDeProveedor, obtenerComparativaPreciosPorInsumo } from "../../src/server/actions/catalogo/proveedor-por-producto";
import { cargarComparativaDePrecios, cargarProductosDeProveedorParaElCarrito } from "../../src/server/lecturas/catalogo/ofertas-de-proveedor";

/** ¿Están puestas las políticas de RLS por sucursal en la base de la corrida? Sin ellas la base entrega TODA la empresa, así que lo que dependa de que no entregue otra sucursal solo se puede medir con ellas. */
const hayPoliticasDeSucursal = Number((await prismaAdmin.$queryRaw<Array<{ n: bigint }>>`SELECT count(*) AS n FROM pg_policies WHERE policyname LIKE 'alcance_sucursal_%'`)[0]!.n) > 0;

/** El alcance con que quedó fijada una base (las variables que ve una consulta suya). */
async function alcanceDe(db: unknown): Promise<{ lectura: string[]; escritura: string[] }> {
  const [fila] = await (db as { $queryRaw: (q: TemplateStringsArray) => Promise<Array<{ lectura: string | null; escritura: string | null }>> }).$queryRaw`SELECT current_setting('app.sucursales_lectura', true) AS lectura, current_setting('app.sucursales_escritura', true) AS escritura`;
  const lista = (v: string | null) => (v ? v.split(",").sort() : []);
  return { lectura: lista(fila!.lectura), escritura: lista(fila!.escritura) };
}

/**
 * ADR-028 (D1): la comparativa de precios y la precarga del carrito del proveedor arman «lo que compró la EMPRESA» con las compras (Kardex) de las sucursales que el usuario PUEDE VER para
 * `proceso_compra`, además de la activa. Con la RLS por sucursal una lectura con la base de la activa no trae las compras de otra sucursal (cero filas, sin error: el «más barato» y el precio de la
 * empresa salen mal en silencio); y la lectura ensanchada nunca llega a una sucursal donde el usuario no tiene membresía o su rol no ve las compras.
 *
 * Escenario: Central (activa), Norte y Sur. El mismo insumo se compró en las tres, y la oferta MÁS BARATA es la de Sur. Tres personas: `dueno` (administrador de Central y de Norte), `mixto`
 * (administrador de Central; en Norte con un rol que no ve las compras) y `solo` (administrador de Central únicamente). Nadie tiene membresía en Sur.
 * Tiene que pasar CON y SIN las políticas por sucursal: lo que se mide del ALCANCE de la base y que las ofertas de Norte entran corre siempre; lo que depende de que la base NO entregue Sur solo se puede
 * medir con las políticas puestas (`it.runIf(hayPoliticasDeSucursal)`): sin ellas la base entrega toda la empresa, como antes.
 */
describe("comparativa de precios y carrito del proveedor: solo las sucursales que el usuario ve", () => {
  let central: string;
  let norte: string;
  let sur: string;
  let duenoId: string;
  let mixtoId: string;
  let soloId: string;
  let proveedorCentral: string;
  let proveedorNorte: string;
  let proveedorSur: string;
  let harinaId: string;
  let salId: string;
  let azucarId: string;
  let pimientaId: string;
  const como = (id: string, email: string) => mockearUsuarioActual({ id, email, nombre: null });

  beforeEach(async () => {
    vi.clearAllMocks();
    await limpiarBaseDeTest();
    __setCookieDeTestParaSucursal(undefined);
    const base = await sembrarBase();
    central = base.sucursal.id;
    norte = (await prisma.sucursal.create({ data: { nombre: "Norte" } })).id;
    sur = (await prisma.sucursal.create({ data: { nombre: "Sur" } })).id;

    // El operador de la semilla ve `proceso_compra`: para el «mixto» se le quita en el rol (en Norte no ve las compras).
    const sinCompras = await prisma.rol.create({ data: { nombre: "sin compras", clave: "sin_compras" } });
    const dueno = await crearUsuarioConMembresia({ email: "dueno@test.com", sucursalId: central, rolId: base.admin.id });
    await crearMembresia({ usuarioId: dueno.id, sucursalId: norte, rolId: base.admin.id });
    const mixto = await crearUsuarioConMembresia({ email: "mixto@test.com", sucursalId: central, rolId: base.admin.id });
    await crearMembresia({ usuarioId: mixto.id, sucursalId: norte, rolId: sinCompras.id });
    const solo = await crearUsuarioConMembresia({ email: "solo@test.com", sucursalId: central, rolId: base.admin.id });
    duenoId = dueno.id;
    mixtoId = mixto.id;
    soloId = solo.id;

    const catalogo = await sembrarCatalogoBase();
    const producto = (codigo: string, nombre: string, conInsumo: boolean) =>
      sembrarProductoDisponible({ codigo, nombre, tipo: "MP", unidadStockId: catalogo.kg.id, ...(conInsumo ? { insumoId: catalogo.insumo.id } : {}) }, central).then((p) => p.id);
    harinaId = await producto("MP_HARINA", "Harina", true);
    salId = await producto("MP_SAL", "Sal", false);
    azucarId = await producto("MP_AZUCAR", "Azúcar", false);
    pimientaId = await producto("MP_PIMIENTA", "Pimienta", false);

    [proveedorCentral, proveedorNorte, proveedorSur] = await Promise.all(
      ["Proveedor Central", "Proveedor Norte", "Proveedor Sur"].map(async (nombre, i) => (await prisma.proveedor.create({ data: { codigo: `PRV_${i}`, nombre } })).id),
    );
    const seccion = { [central]: (await sembrarSeccion(central)).id, [norte]: (await sembrarSeccion(norte, "Depósito Norte")).id, [sur]: (await sembrarSeccion(sur, "Depósito Sur")).id };
    const compra = (sucursalId: string, productoId: string, proveedorId: string, fecha: string, precio: number) =>
      sembrarCompraDeKardex({ sucursalId, seccionId: seccion[sucursalId]!, usuarioId: duenoId, productoId, proveedorId, fecha, precioPorUnidadStock: precio });
    // Comparativa: el mismo insumo (Harina), un proveedor por sucursal; el más barato es el de Sur.
    await compra(central, harinaId, proveedorCentral, "2026-09-10", 500);
    await compra(norte, harinaId, proveedorNorte, "2026-09-12", 400);
    await compra(sur, harinaId, proveedorSur, "2026-09-14", 100);
    // Carrito: al proveedor de Central se le compró Sal en Central, Azúcar en Norte y Pimienta en Sur (los productos están disponibles en Central; la Harina de Central también es suya).
    await compra(central, salId, proveedorCentral, "2026-09-15", 70);
    await compra(norte, azucarId, proveedorCentral, "2026-09-16", 40);
    await compra(sur, pimientaId, proveedorCentral, "2026-09-17", 30);
  });

  const proveedoresDeHarina = async () => {
    const fila = (await obtenerComparativaPreciosPorInsumo()).find((f) => f.insumo === "Harina");
    return fila ? { masBarato: fila.masBarato?.proveedorNombre, todas: fila.todas.map((o) => o.proveedorNombre).sort() } : null;
  };

  it("el escenario es real: las compras de las tres sucursales existen en la base (las ve el dueño de la base)", async () => {
    expect(await prisma.operacion.count({ where: { proceso: "COMPRA" } })).toBe(6);
    expect(await prisma.operacion.count({ where: { sucursalId: sur } })).toBe(2);
  });

  describe("el alcance con que lee (se mide con y sin políticas)", () => {
    const ultimaDeLaComparativa = () => vi.mocked(cargarComparativaDePrecios).mock.calls.at(-1)![0];
    const ultimaDelCarrito = () => vi.mocked(cargarProductosDeProveedorParaElCarrito).mock.calls.at(-1)![0];

    it("quien ve las compras en Central y en Norte lee la comparativa y el carrito con la LECTURA en las dos y la escritura solo en la activa; Sur no entra", async () => {
      await como(duenoId, "dueno@test.com");
      const fila = (await obtenerComparativaPreciosPorInsumo()).find((f) => f.insumo === "Harina");
      expect(fila?.todas.map((o) => o.proveedorNombre)).toEqual(expect.arrayContaining(["Proveedor Central", "Proveedor Norte"]));
      expect(await alcanceDe(ultimaDeLaComparativa())).toEqual({ lectura: [central, norte].sort(), escritura: [central] });
      await listarProductosDeProveedor(proveedorCentral);
      expect(await alcanceDe(ultimaDelCarrito())).toEqual({ lectura: [central, norte].sort(), escritura: [central] });
    });

    it("donde el rol no ve las compras (Norte como «sin compras») o con una sola membresía, las dos lecturas usan solo la sucursal activa", async () => {
      for (const [email, id] of [["mixto@test.com", mixtoId], ["solo@test.com", soloId]] as const) {
        await como(id, email);
        await obtenerComparativaPreciosPorInsumo();
        await listarProductosDeProveedor(proveedorCentral);
        expect(await alcanceDe(ultimaDeLaComparativa())).toEqual({ lectura: [central], escritura: [central] });
        expect(await alcanceDe(ultimaDelCarrito())).toEqual({ lectura: [central], escritura: [central] });
      }
    });

    it("la sucursal activa que elige la cookie no agranda el alcance: con Sur de cookie (sin membresía) la lectura sigue siendo Central y Norte", async () => {
      await como(duenoId, "dueno@test.com");
      __setCookieDeTestParaSucursal(sur);
      await obtenerComparativaPreciosPorInsumo();
      const alcance = await alcanceDe(ultimaDeLaComparativa());
      expect(alcance.lectura).not.toContain(sur);
      expect(alcance.escritura).not.toContain(sur);
    });
  });

  describe.runIf(hayPoliticasDeSucursal)("la comparativa de precios (la base no entrega Sur: solo con las políticas puestas)", () => {
    it("quien ve las compras en Central y en Norte compara las dos; la oferta de Sur, donde no tiene membresía, no entra (aunque sea la más barata)", async () => {
      await como(duenoId, "dueno@test.com");
      expect(await proveedoresDeHarina()).toEqual({ masBarato: "Proveedor Norte", todas: ["Proveedor Central", "Proveedor Norte"] });
    });

    it("donde el rol no ve las compras (Norte como «sin compras») la comparativa es la de la sucursal activa", async () => {
      await como(mixtoId, "mixto@test.com");
      expect(await proveedoresDeHarina()).toEqual({ masBarato: "Proveedor Central", todas: ["Proveedor Central"] });
    });

    it("con una sola membresía es la de la sucursal activa", async () => {
      await como(soloId, "solo@test.com");
      expect(await proveedoresDeHarina()).toEqual({ masBarato: "Proveedor Central", todas: ["Proveedor Central"] });
    });

    it("la sucursal activa que elige la cookie no agranda lo que se ve: con Sur de cookie (sin membresía) sigue siendo Central", async () => {
      await como(duenoId, "dueno@test.com");
      __setCookieDeTestParaSucursal(sur);
      expect(await proveedoresDeHarina()).toEqual({ masBarato: "Proveedor Norte", todas: ["Proveedor Central", "Proveedor Norte"] });
    });
  });

  describe.runIf(hayPoliticasDeSucursal)("la precarga del carrito del proveedor (la base no entrega Sur: solo con las políticas puestas)", () => {
    const carrito = async () => Object.fromEntries((await listarProductosDeProveedor(proveedorCentral)).map((p) => [p.productoNombre, [p.ultimoPrecioPorUnidadStock, p.origenDelPrecio]]));

    it("quien ve las compras en Central y en Norte recibe el precio de la empresa de Norte (rotulado), y nada de lo que solo compró Sur (la Pimienta)", async () => {
      await como(duenoId, "dueno@test.com");
      expect(await carrito()).toEqual({ Harina: [500, "SUCURSAL"], Sal: [70, "SUCURSAL"], Azúcar: [40, "EMPRESA"] });
    });

    it("donde el rol no ve las compras (Norte como «sin compras») o con una sola membresía, solo lo de la sucursal activa", async () => {
      await como(mixtoId, "mixto@test.com");
      expect(await carrito()).toEqual({ Harina: [500, "SUCURSAL"], Sal: [70, "SUCURSAL"] });
      await como(soloId, "solo@test.com");
      expect(await carrito()).toEqual({ Harina: [500, "SUCURSAL"], Sal: [70, "SUCURSAL"] });
    });
  });
});
