import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { crearUsuarioConMembresia, limpiarBaseDeTest, prisma, sembrarBase, sembrarCatalogoBase, sembrarProductoDisponible, sembrarSeccion } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { enElPasado, DIA_MS } from "../setup/tiempo";
import { obtenerBandejaTransferencias, listarSucursalesParaEnviar, listarSucursalesParaSolicitar } from "../../src/server/actions/traspasos/lecturas";
import { obtenerHistorialConteosFisicos } from "../../src/server/actions/movimientos/lecturas-conteo-fisico";
import { listarFrecuenciasConteo } from "../../src/server/actions/stock/frecuencia-conteo";
import { listarStockMinimo } from "../../src/server/actions/stock/stock-minimo";
import { listarSeccionesHabituales } from "../../src/server/actions/stock/seccion-habitual";
import { listarPreciosLocales } from "../../src/server/actions/movimientos/precio-local";
import { listarSucursales } from "../../src/server/actions/auth/sucursales";
import { listarProveedores } from "../../src/server/actions/catalogo/proveedores";

/**
 * S-15 (plan de endurecimiento de seguridad, tanda T7; B-A6 y B-A19 del informe B; G2 y G12 de A). Una Server Action exportada de un archivo "use server" es una puerta HTTP:
 * quien tiene la clave de VER la invoca a mano y recibe TODO lo que la función devuelve, no lo que la pantalla dibuja. Estas lecturas devolvían filas enteras: `Producto` completo
 * (con `precioConsignacion` y el proveedor de consignación, que desde S-12/D8 son de `pagar_consignante`), y `User` completo del que creó un traspaso (`image`, `activoGlobal`,
 * `emailVerified`). Método del dueño: el último punto donde se decide es el `select` de la consulta; devuelve solo lo que la pantalla dibuja. Acá se invoca cada acción directo, como
 * lo haría un operario, y se mira lo que vuelve.
 */
const COSTO = 4321.5;
/** Campos que NINGUNA de estas lecturas puede devolver: el costo de consignación, el consignante y las columnas internas del usuario y de las filas. */
const PROHIBIDAS = ["precioConsignacion", "proveedorConsignacionId", "esConsignacion", "activoGlobal", "emailVerified", "image", "claveIdempotencia", "payloadHash", "resultadoMensaje"];

function claves(valor: unknown, salida = new Set<string>()): Set<string> {
  if (Array.isArray(valor)) valor.forEach((v) => claves(v, salida));
  else if (valor && typeof valor === "object" && !(valor instanceof Date)) {
    for (const [k, v] of Object.entries(valor)) {
      salida.add(k);
      claves(v, salida);
    }
  }
  return salida;
}

describe("S-15: las Server Actions de lectura devuelven solo lo que la pantalla dibuja", () => {
  let sucursalAId: string;
  let sucursalBId: string;
  let adminId: string;
  let operadorId: string;
  let quesoId: string;

  const como = (id: string, email: string) => mockearUsuarioActual({ id, email, nombre: null });
  const comoOperador = () => como(operadorId, "operador@test.com");
  const comoAdmin = () => como(adminId, "admin@test.com");

  function sinCamposProhibidos(resultado: unknown) {
    const halladas = claves(resultado);
    for (const campo of PROHIBIDAS) expect(halladas.has(campo), `la lectura devuelve «${campo}»`).toBe(false);
    expect(JSON.stringify(resultado)).not.toContain(String(COSTO));
  }

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalAId = base.sucursal.id;
    sucursalBId = (await prisma.sucursal.create({ data: { nombre: "Sucursal B" } })).id;
    const catalogo = await sembrarCatalogoBase();
    const seccionAId = (await sembrarSeccion(sucursalAId, "Depósito A")).id;
    const seccionBId = (await sembrarSeccion(sucursalBId, "Depósito B")).id;
    adminId = (await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: sucursalAId, rolId: base.admin.id })).id;
    operadorId = (await crearUsuarioConMembresia({ email: "operador@test.com", sucursalId: sucursalAId, rolId: base.operador.id })).id;
    const creador = await prisma.user.create({ data: { email: "creador@test.com", name: "Creador", image: "https://fotos.test/creador.png", emailVerified: enElPasado(30 * DIA_MS) } });
    const proveedorId = (
      await prisma.proveedor.create({
        data: { codigo: "PROV_Q", nombre: "Lácteos Reservados SA", cuit: "30-70000000-1", email: "ventas@lacteos.test", telefono: "Tel 11-5555-0000", condicionesPago: "30 dias", contacto: "Ana" },
      })
    ).id;
    quesoId = (
      await sembrarProductoDisponible(
        { codigo: "MP_QUESO", nombre: "Queso", tipo: "MP", unidadStockId: catalogo.kg.id, esConsignacion: true, proveedorConsignacionId: proveedorId, precioConsignacion: COSTO, precioVenta: 99 },
        sucursalAId,
      )
    ).id;
    // Un traspaso que B le manda a A (ENVIADA: A tiene que aceptar), creado por un usuario con foto y cuenta verificada.
    await prisma.traspasoSucursal.create({
      data: { origenSucursalId: sucursalBId, destinoSucursalId: sucursalAId, productoId: quesoId, cantidad: 3, seccionOrigenId: seccionBId, seccionDestinoId: seccionAId, iniciadoPor: "ORIGEN", estado: "ENVIADA", creadoPorId: creador.id, detalle: "va" },
    });
    await prisma.conteoFisico.create({
      data: {
        sucursalId: sucursalAId,
        fecha: enElPasado(DIA_MS),
        productoId: quesoId,
        seccionId: seccionAId,
        saldoSistema: 5,
        conteoReal: 4,
        diferencia: -1,
        accion: "AJUSTAR",
        estado: "RESUELTO",
        usuarioId: creador.id,
        claveIdempotencia: "11111111-1111-4111-8111-111111111111",
        payloadHash: "hash-de-prueba",
        resultadoMensaje: "mensaje interno",
      },
    });
    await prisma.frecuenciaConteoProducto.create({ data: { sucursalId: sucursalAId, productoId: quesoId, frecuenciaDias: 7 } });
    await prisma.stockMinimoProducto.create({ data: { sucursalId: sucursalAId, productoId: quesoId, seccionId: seccionAId, minimo: 2 } });
    await prisma.seccionHabitualProducto.create({ data: { sucursalId: sucursalAId, productoId: quesoId, seccionId: seccionAId } });
    await prisma.precioLocalProducto.create({ data: { sucursalId: sucursalAId, productoId: quesoId, precio: 120, habilitado: true } });
  });

  describe("con las claves de un operario (traspaso_ver_bandeja, reporte_conteos, conteo_frecuencia)", () => {
    beforeEach(async () => {
      await comoOperador();
    });

    it("EL ATAQUE: la Bandeja de traspasos, invocada directo, no devuelve el Producto ni el User enteros (antes: precioConsignacion, activoGlobal, image…)", async () => {
      const bandeja = await obtenerBandejaTransferencias(sucursalAId);
      expect(bandeja.paraAceptar).toHaveLength(1);
      sinCamposProhibidos(bandeja);
    });

    it("la Bandeja sigue trayendo lo que la pantalla dibuja: producto, unidad, sucursales, secciones, motivos y el email de quien la creó", async () => {
      const [t] = (await obtenerBandejaTransferencias(sucursalAId)).paraAceptar;
      expect(t).toMatchObject({
        origenSucursalId: sucursalBId,
        destinoSucursalId: sucursalAId,
        estado: "ENVIADA",
        detalle: "va",
        producto: { nombre: "Queso", codigo: "MP_QUESO", unidadStock: { nombre: "kg" } },
        origenSucursal: { nombre: "Sucursal B" },
        destinoSucursal: { nombre: "Central" },
        seccionOrigen: { nombre: "Depósito B" },
        seccionDestino: { nombre: "Depósito A" },
        creadoPor: { email: "creador@test.com" },
      });
      expect(Number(t!.cantidad)).toBe(3);
      expect(Object.keys(t!.creadoPor)).toEqual(["email"]);
    });

    it("los selectores de sucursal de Solicitar y Enviar devuelven solo id y nombre", async () => {
      for (const lista of [await listarSucursalesParaSolicitar(sucursalAId), await listarSucursalesParaEnviar(sucursalAId)]) {
        expect(lista.map((s) => Object.keys(s).sort())).toEqual([["id", "nombre"]]);
        expect(lista[0]!.nombre).toBe("Sucursal B");
      }
    });

    it("EL ATAQUE: el historial de conteos no devuelve el Producto entero ni las columnas internas del conteo", async () => {
      const { items } = await obtenerHistorialConteosFisicos(sucursalAId);
      expect(items).toHaveLength(1);
      sinCamposProhibidos(items);
      expect(items[0]).toMatchObject({ productoId: quesoId, accion: "AJUSTAR", estado: "RESUELTO", producto: { codigo: "MP_QUESO", nombre: "Queso" }, seccion: { nombre: "Depósito A" } });
      expect(Number(items[0]!.diferencia)).toBe(-1);
    });

    it("EL ATAQUE: la agenda de Frecuencia de conteo no devuelve el Producto entero", async () => {
      const filas = await listarFrecuenciasConteo(sucursalAId);
      expect(filas).toHaveLength(1);
      sinCamposProhibidos(filas);
      expect(filas[0]).toMatchObject({ productoId: quesoId, frecuenciaDias: 7, producto: { codigo: "MP_QUESO", nombre: "Queso" } });
    });
  });

  describe("con las claves de un administrador (stock_minimo, stock_seccion_habitual, precio_local, gestion_usuarios)", () => {
    beforeEach(async () => {
      await comoAdmin();
    });

    it("EL ATAQUE: Stock mínimo no devuelve el Producto entero", async () => {
      const filas = await listarStockMinimo(sucursalAId);
      expect(filas).toHaveLength(1);
      sinCamposProhibidos(filas);
      expect(filas[0]).toMatchObject({ productoId: quesoId, producto: { nombre: "Queso" }, seccion: { nombre: "Depósito A" } });
      expect(Number(filas[0]!.minimo)).toBe(2);
    });

    it("EL ATAQUE: Sección habitual no devuelve el Producto entero", async () => {
      const filas = await listarSeccionesHabituales(sucursalAId);
      expect(filas).toHaveLength(1);
      sinCamposProhibidos(filas);
      expect(filas[0]).toMatchObject({ productoId: quesoId, producto: { nombre: "Queso" }, seccion: { nombre: "Depósito A" } });
    });

    it("EL ATAQUE: Precio local devuelve el nombre y el precio global del producto, nada más (el costo de consignación no)", async () => {
      const filas = await listarPreciosLocales(sucursalAId);
      expect(filas).toHaveLength(1);
      sinCamposProhibidos(filas);
      expect(Object.keys(filas[0]!.producto).sort()).toEqual(["nombre", "precioVenta"]);
      expect(Number(filas[0]!.producto.precioVenta)).toBe(99);
      expect(filas[0]).toMatchObject({ productoId: quesoId, habilitado: true });
    });

    it("EL ATAQUE: el listado de Proveedores no devuelve el CUIT, el correo, el teléfono ni las condiciones de pago (son de la ficha)", async () => {
      const filas = await listarProveedores();
      expect(filas).toHaveLength(1);
      expect(Object.keys(filas[0]!).sort()).toEqual(["activo", "codigo", "contacto", "id", "nombre"]);
      expect(JSON.stringify(filas)).not.toMatch(/30-70000000-1|ventas@lacteos|30 dias|Tel/);
    });

    it("la lista de sucursales de Administración devuelve id, nombre y si está activa (antes: la fila entera)", async () => {
      const filas = await listarSucursales();
      expect(filas.map((s) => Object.keys(s).sort())).toEqual([
        ["activo", "id", "nombre"],
        ["activo", "id", "nombre"],
      ]);
      expect(filas.map((s) => s.nombre)).toEqual(["Central", "Sucursal B"]);
    });
  });
});
