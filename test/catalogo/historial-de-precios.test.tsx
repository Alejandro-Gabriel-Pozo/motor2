import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => undefined, refresh: () => undefined }), redirect: vi.fn(), notFound: vi.fn() }));
vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, sembrarCatalogoBase, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { historialDePreciosDelProducto } from "../../src/server/consultas/catalogo/historial-de-precios";
import { HistorialDePrecios } from "../../src/components/catalogo/historial-de-precios";
import PreciosDelProductoPage from "../../src/app/(app)/catalogo/productos/[id]/precios/page";

/**
 * El historial de precios de la ficha (paso 7; dueño, 2026-11-17: «A»: quien ve el catálogo ve fechas y precios, SIN el nombre de quien cambió el precio; eso sigue siendo de «Ver auditoría»), contra Postgres real:
 * los cambios de lista y de la sucursal activa, nada de otra sucursal ni de otro campo, y el ACTOR no sale por ningún lado, tampoco para un rol sin «Ver auditoría».
 */
const EMAIL_DE_QUIEN_CAMBIO = "quien-cambio-el-precio@test.com";

function elementosDeTipo(arbol: ReactNode, tipo: unknown): ReactElement<Record<string, unknown>>[] {
  const hallados: ReactElement<Record<string, unknown>>[] = [];
  const recorrer = (nodo: ReactNode) => {
    if (Array.isArray(nodo)) return nodo.forEach(recorrer);
    if (!nodo || typeof nodo !== "object" || !("props" in nodo)) return;
    const el = nodo as ReactElement<{ children?: ReactNode }>;
    if (el.type === tipo) hallados.push(el as ReactElement<Record<string, unknown>>);
    recorrer(el.props.children);
  };
  recorrer(arbol);
  return hallados;
}

describe("historial de precios de la ficha", () => {
  let sucursalId: string;
  let otraSucursalId: string;
  let operadorId: string;
  let productoId: string;
  let actorId: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    otraSucursalId = (await prisma.sucursal.create({ data: { nombre: "Otra" } })).id;
    const { kg } = await sembrarCatalogoBase();
    actorId = (await prisma.user.create({ data: { email: EMAIL_DE_QUIEN_CAMBIO, name: "Quien Cambió" } })).id;
    const operador = await crearUsuarioConMembresia({ email: "operador@test.com", sucursalId, rolId: base.operador.id });
    operadorId = operador.id;
    const p = await prisma.producto.create({ data: { codigo: "PV_HIST", nombre: "Bife", tipo: "PV", unidadStockId: kg.id, precioVenta: 12000 } });
    productoId = p.id;
    await prisma.disponibilidadProducto.create({ data: { sucursalId, productoId, disponible: true } });
    const propio = await prisma.precioLocalProducto.create({ data: { sucursalId, productoId, precio: 13000, habilitado: true } });
    const ajeno = await prisma.precioLocalProducto.create({ data: { sucursalId: otraSucursalId, productoId, precio: 9999, habilitado: true } });
    const aud = (data: { entidad: string; entidadId: string; campo: string; valorAnterior: string | null; valorNuevo: string | null; creadoEn: Date; sucursalId?: string }) =>
      prisma.registroAuditoria.create({ data: { descripcion: `Bife: ${data.campo}`, actorId, ...data } });
    await aud({ entidad: "Producto", entidadId: productoId, campo: "precioVenta", valorAnterior: "10000", valorNuevo: "12000", creadoEn: new Date("2026-11-10T15:00:00Z") });
    await aud({ entidad: "Producto", entidadId: productoId, campo: "precioVenta", valorAnterior: "12000", valorNuevo: "12000", creadoEn: new Date("2026-11-11T15:00:00Z") });
    await aud({ entidad: "Producto", entidadId: productoId, campo: "precioConsignacion", valorAnterior: "1", valorNuevo: "2", creadoEn: new Date("2026-11-11T16:00:00Z") });
    await aud({ entidad: "PrecioLocalProducto", entidadId: propio.id, campo: "precio", valorAnterior: null, valorNuevo: "12500", creadoEn: new Date("2026-11-12T15:00:00Z"), sucursalId });
    await aud({ entidad: "PrecioLocalProducto", entidadId: propio.id, campo: "precio", valorAnterior: "12500", valorNuevo: "13000", creadoEn: new Date("2026-11-13T15:00:00Z"), sucursalId });
    await aud({ entidad: "PrecioLocalProducto", entidadId: propio.id, campo: "habilitado", valorAnterior: "false", valorNuevo: "true", creadoEn: new Date("2026-11-13T15:00:01Z"), sucursalId });
    await aud({ entidad: "PrecioLocalProducto", entidadId: ajeno.id, campo: "precio", valorAnterior: "1", valorNuevo: "9999", creadoEn: new Date("2026-11-13T16:00:00Z"), sucursalId: otraSucursalId });
  });

  it("los cambios de lista y de ESTA sucursal, el más reciente primero; sin el precio sin cambio, sin otro campo, sin otra sucursal", async () => {
    const r = await historialDePreciosDelProducto(prisma, productoId, sucursalId);
    expect(r.map((l) => [l.alcance, l.anterior, l.nuevo])).toEqual([
      ["sucursal", 12500, 13000],
      ["sucursal", null, 12500],
      ["lista", 10000, 12000],
    ]);
  });

  it("las líneas no traen al actor ni nada que lo nombre", async () => {
    const r = await historialDePreciosDelProducto(prisma, productoId, sucursalId);
    expect(Object.keys(r[0]!).sort()).toEqual(["alcance", "anterior", "creadoEn", "nuevo"]);
    expect(JSON.stringify(r)).not.toMatch(/quien|actor|@/i);
  });

  it("la consulta SELECCIONA solo fecha, tipo y valores: nunca el actor, la descripción ni un `include`", async () => {
    const llamadas: Record<string, unknown>[] = [];
    const espia = new Proxy(prisma, {
      get(objetivo, clave) {
        const valor = Reflect.get(objetivo, clave);
        if (clave !== "registroAuditoria") return valor;
        return new Proxy(valor as object, {
          get(delegado, metodo) {
            const f = Reflect.get(delegado, metodo);
            return typeof f === "function" ? (args: Record<string, unknown>) => (llamadas.push(args), (f as (a: unknown) => unknown).call(delegado, args)) : f;
          },
        });
      },
    });
    await historialDePreciosDelProducto(espia as typeof prisma, productoId, sucursalId);
    expect(llamadas).toHaveLength(1);
    expect(Object.keys(llamadas[0]!.select as object).sort()).toEqual(["creadoEn", "entidad", "valorAnterior", "valorNuevo"]);
    expect(llamadas[0]).not.toHaveProperty("include");
  });

  it("sin precio propio en la sucursal, solo los cambios de lista", async () => {
    await prisma.precioLocalProducto.deleteMany({ where: { sucursalId, productoId } });
    const r = await historialDePreciosDelProducto(prisma, productoId, sucursalId);
    expect(r.map((l) => [l.alcance, l.nuevo])).toEqual([["lista", 12000]]);
  });

  it("la pestaña «Precios» para un rol que ve el catálogo y NO tiene «Ver auditoría»: ve las fechas y los precios, sin el nombre de quien los cambió", async () => {
    const ver = await prisma.permisoRol.findMany({ where: { rol: { clave: "operador" }, accionClave: { in: ["producto_ver_catalogo", "ver_auditoria", "ver_auditoria_empresa"] } }, select: { accionClave: true, puedeVer: true } });
    const puede = (clave: string) => ver.some((f) => f.accionClave === clave && f.puedeVer);
    if (!puede("producto_ver_catalogo")) await prisma.permisoRol.updateMany({ where: { rol: { clave: "operador" }, accionClave: "producto_ver_catalogo" }, data: { puedeVer: true } });
    await prisma.permisoRol.updateMany({ where: { rol: { clave: "operador" }, accionClave: { in: ["ver_auditoria", "ver_auditoria_empresa"] } }, data: { puedeVer: false, puedeEditar: false } });
    expect(puede("ver_auditoria"), "control: el rol de la prueba no tiene «Ver auditoría»").toBe(false);
    await mockearUsuarioActual({ id: operadorId, email: "operador@test.com", nombre: null });

    const arbol = await PreciosDelProductoPage({ params: Promise.resolve({ id: productoId }) });
    const secciones = elementosDeTipo(arbol, HistorialDePrecios);
    expect(secciones).toHaveLength(1);
    const cambios = secciones[0]!.props.cambios as { alcance: string; anterior: number | null; nuevo: number }[];
    expect(cambios.map((c) => [c.alcance, c.anterior, c.nuevo])).toEqual([
      ["sucursal", 12500, 13000],
      ["sucursal", null, 12500],
      ["lista", 10000, 12000],
    ]);
    expect(JSON.stringify(secciones[0]!.props)).not.toMatch(/quien|actor|@/i);
  });
});
