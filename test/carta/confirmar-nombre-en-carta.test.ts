import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));

import { crearUsuarioConMembresia, limpiarBaseDeTest, prisma, sembrarBase, sembrarProductoDisponible } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { baseDeTest } from "../setup/test-db";
import { confirmarNombreEnCarta } from "../../src/server/actions/carta/contenido-producto";
import { listarPlatosSinNombreDeCarta } from "../../src/server/consultas/carta/admin";
import { estadoDelNombreDeCarta } from "../../src/core/carta/public";
import { COLISION, ESTADO_DEL_NOMBRE, TAMANO_DEL_BOTON, resultadoEsperadoDelBoton } from "./nombre-en-carta.oraculo";

/**
 * «Está bien así» (confirmado por el dueño, 2026-11-04; `docs/diseno-nombre-en-carta-2026-11-04.md`, §11 F), contra Postgres real y a través de la acción: un plato VISIBLE con el nombre de carta sin decidir
 * (NULL) se confirma a propósito con el nombre del producto; queda auditado, es idempotente, dos clics a la vez dejan una sola escritura, respeta la regla de no repetir y el permiso, y solo escribe en la sucursal
 * activa. Más el oráculo estado × colisión (escrito aparte, a mano) recorrido entero.
 */
describe("«Está bien así»: confirmar el nombre del producto como nombre de carta", () => {
  let sucursalId: string;
  let otraSucursalId: string;
  let seccionCartaId: string;
  let unidadId: string;
  let adminRolId: string;
  let operadorRolId: string;
  let objetivoId: string;

  const producto = async (codigo: string, nombre: string) => {
    const p = await sembrarProductoDisponible({ codigo, nombre, tipo: "PV", precioVenta: 1000, unidadStockId: unidadId }, sucursalId);
    await prisma.disponibilidadProducto.create({ data: { sucursalId: otraSucursalId, productoId: p.id, disponible: true } });
    return p.id;
  };
  const contenido = (suc: string, productoId: string, extra: { visibleEnCarta: boolean; nombreEnCarta?: string | null }) =>
    prisma.contenidoCartaProducto.create({ data: { sucursalId: suc, productoId, seccionCartaId, orden: 0, visibleEnCarta: extra.visibleEnCarta, nombreEnCarta: extra.nombreEnCarta ?? null } });
  const guardado = async (productoId = objetivoId, suc = sucursalId) => (await prisma.contenidoCartaProducto.findFirst({ where: { sucursalId: suc, productoId } }))?.nombreEnCarta ?? null;
  const auditorias = () => prisma.registroAuditoria.findMany({ where: { entidad: "ContenidoCartaProducto", campo: "nombreEnCarta" }, orderBy: { creadoEn: "asc" } });

  async function sembrar() {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    adminRolId = base.admin.id;
    operadorRolId = base.operador.id;
    otraSucursalId = (await prisma.sucursal.create({ data: { nombre: "Otra" } })).id;
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: adminRolId });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });
    unidadId = (await prisma.unidad.create({ data: { nombre: "u", magnitud: "CANTIDAD", decimales: 0 } })).id;
    seccionCartaId = (await prisma.seccionCarta.create({ data: { nombre: "Platos", orden: 1 } })).id;
    objetivoId = await producto("PV_OBJ", "Milanesa");
  }

  beforeEach(sembrar);

  it("copia el nombre del producto al campo, a propósito, y deja la auditoría (de null al nombre, con la sucursal); repetirlo no cambia nada ni audita de más", async () => {
    await contenido(sucursalId, objetivoId, { visibleEnCarta: true });
    expect(await confirmarNombreEnCarta(objetivoId)).toMatchObject({ ok: true });
    expect(await guardado()).toBe("Milanesa");
    expect(await confirmarNombreEnCarta(objetivoId), "doble clic").toMatchObject({ ok: true });
    const registros = await auditoria();
    expect(registros).toHaveLength(1);
    expect(registros[0]).toMatchObject({ valorAnterior: null, valorNuevo: "Milanesa", sucursalId, entidadId: `${sucursalId}:${objetivoId}` });
    expect(registros[0]!.descripcion).toContain("Está bien así");

    async function auditoria() {
      return auditorias();
    }
  });

  it("dos clics a la vez: uno escribe y el otro ve «ya estaba»; una sola fila y una sola auditoría", async () => {
    await contenido(sucursalId, objetivoId, { visibleEnCarta: true });
    const rs = await Promise.all([confirmarNombreEnCarta(objetivoId), confirmarNombreEnCarta(objetivoId)]);
    expect(rs.map((r) => r.ok)).toEqual([true, true]);
    expect(await prisma.contenidoCartaProducto.count({ where: { productoId: objetivoId } })).toBe(1);
    expect(await auditorias()).toHaveLength(1);
    expect(await guardado()).toBe("Milanesa");
  });

  it("renombrar el producto después NO cambia el nombre de la carta (queda independiente: fue a propósito)", async () => {
    await contenido(sucursalId, objetivoId, { visibleEnCarta: true });
    expect((await confirmarNombreEnCarta(objetivoId)).ok).toBe(true);
    await prisma.producto.update({ where: { id: objetivoId }, data: { nombre: "Milanesa napolitana" } });
    expect(await guardado()).toBe("Milanesa");
    expect(estadoDelNombreDeCarta({ nombre: "Milanesa napolitana" }, { nombreEnCarta: await guardado() })).toBe("propio");
  });

  it("el estado del nombre: NULL = pendiente; igual al interno = confirmado; distinto = propio", () => {
    expect(estadoDelNombreDeCarta({ nombre: "Milanesa" }, { nombreEnCarta: null })).toBe("pendiente");
    expect(estadoDelNombreDeCarta({ nombre: "Milanesa" }, { nombreEnCarta: "Milanesa" })).toBe("confirmado-igual-al-interno");
    expect(estadoDelNombreDeCarta({ nombre: "Milanesa" }, { nombreEnCarta: "La Napo" })).toBe("propio");
  });

  it("no hay nada que confirmar si el plato no está visible en ESTA carta (oculto, sin contenido o solo en otra sucursal); una base no se confirma", async () => {
    expect(await confirmarNombreEnCarta(objetivoId), "sin contenido").toMatchObject({ ok: false });
    await contenido(sucursalId, objetivoId, { visibleEnCarta: false });
    expect(await confirmarNombreEnCarta(objetivoId), "oculto").toMatchObject({ ok: false });
    await prisma.contenidoCartaProducto.deleteMany({ where: { productoId: objetivoId } });
    await contenido(otraSucursalId, objetivoId, { visibleEnCarta: true });
    expect(await confirmarNombreEnCarta(objetivoId), "visible solo en otra sucursal").toMatchObject({ ok: false });
    expect(await guardado(objetivoId, otraSucursalId), "la otra carta no se toca").toBeNull();
    const base = await producto("BIFE-", "BIFE-");
    await prisma.producto.update({ where: { id: base }, data: { modoDeVenta: "BASE_CONFIGURABLE" } });
    await contenido(sucursalId, base, { visibleEnCarta: true });
    expect(await confirmarNombreEnCarta(base), "base").toMatchObject({ ok: false });
    expect(await auditorias()).toEqual([]);
  });

  it("un nombre de producto que no sirve para la carta (más de 80 caracteres) no se copia: hay que escribir uno", async () => {
    const largo = await producto("PV_LARGO", "x".repeat(81));
    await contenido(sucursalId, largo, { visibleEnCarta: true });
    const r = await confirmarNombreEnCarta(largo);
    expect(r).toMatchObject({ ok: false });
    expect(r.mensaje).toContain("escribí uno");
    expect(await guardado(largo)).toBeNull();
  });

  it("sin el permiso `carta_contenido_producto` no escribe ni audita", async () => {
    await contenido(sucursalId, objetivoId, { visibleEnCarta: true });
    const operador = await crearUsuarioConMembresia({ email: "operador@test.com", sucursalId, rolId: operadorRolId });
    await mockearUsuarioActual({ id: operador.id, email: operador.email, nombre: null });
    expect((await confirmarNombreEnCarta(objetivoId)).ok).toBe(false);
    expect(await guardado()).toBeNull();
    expect(await auditorias()).toEqual([]);
  });

  it("la lista «Platos de la carta sin nombre de carta»: solo los VISIBLES de esta sucursal, sin nombre de carta y que no sean base", async () => {
    const [a, b, c, d, e] = [await producto("PV_A", "Alfajor"), await producto("PV_B", "Budín"), await producto("PV_C", "Café"), await producto("PV_D", "Dulce"), await producto("PV_E", "BIFE-")];
    await prisma.producto.update({ where: { id: e }, data: { modoDeVenta: "BASE_CONFIGURABLE" } });
    await contenido(sucursalId, a, { visibleEnCarta: true });
    await contenido(sucursalId, b, { visibleEnCarta: true, nombreEnCarta: "Budín de la casa" });
    await contenido(sucursalId, c, { visibleEnCarta: false });
    await contenido(otraSucursalId, d, { visibleEnCarta: true });
    await contenido(sucursalId, e, { visibleEnCarta: true });
    const { db } = baseDeTest({ lectura: [sucursalId], escritura: [sucursalId] });
    expect(await listarPlatosSinNombreDeCarta(sucursalId, db)).toEqual([{ productoId: a, nombre: "Alfajor" }]);
    // Después de «Está bien así» sale de la lista.
    expect((await confirmarNombreEnCarta(a)).ok).toBe(true);
    expect(await listarPlatosSinNombreDeCarta(sucursalId, db)).toEqual([]);
  });

  it("oráculo: estado del nombre × colisión (30 combinaciones): el botón copia, rechaza o ya estaba, según la tabla escrita aparte", async () => {
    // El nombre que se quiere copiar es el interno del objetivo («Milanesa»): la colisión se arma con ESE nombre (en otra variante de tildes donde el nombre interno es único por empresa).
    const NOMBRE_CHOCANTE = "Milanesa";
    let recorridas = 0;
    for (const colision of COLISION) {
      for (const estado of ESTADO_DEL_NOMBRE) {
        await sembrar();
        const otro = await producto("PV_OTRO", "Pizza especial");
        switch (colision) {
          case "sin-choque":
            break;
          case "nombre-en-carta-de-otro":
            await contenido(sucursalId, otro, { visibleEnCarta: true, nombreEnCarta: "MILANESA" });
            break;
          case "nombre-en-carta-de-otro-oculto":
            await contenido(sucursalId, otro, { visibleEnCarta: false, nombreEnCarta: NOMBRE_CHOCANTE });
            break;
          case "interno-de-otro-visible":
            await prisma.producto.update({ where: { id: otro }, data: { nombre: "Milánesa" } });
            await contenido(sucursalId, otro, { visibleEnCarta: true });
            break;
          case "interno-de-otro-oculto":
            await prisma.producto.update({ where: { id: otro }, data: { nombre: "Milánesa" } });
            await contenido(sucursalId, otro, { visibleEnCarta: false });
            break;
          case "interno-de-otra-base":
            await prisma.producto.update({ where: { id: otro }, data: { nombre: "Milánesa", modoDeVenta: "BASE_CONFIGURABLE" } });
            await contenido(sucursalId, otro, { visibleEnCarta: true });
            break;
          case "agrupado":
            await prisma.itemAgrupadoCarta.create({ data: { sucursalId, nombre: "milanesa", seccionCartaId, orden: 1 } });
            break;
          case "promo":
            await prisma.promoCarta.create({ data: { sucursales: { create: { sucursalId } }, seccionCartaId, titulo: "MILANESA", precio: 1000 } });
            break;
          case "promo-de-otra-sucursal":
            await prisma.promoCarta.create({ data: { sucursales: { create: { sucursalId: otraSucursalId } }, seccionCartaId, titulo: "MILANESA", precio: 1000 } });
            break;
          case "nombre-en-carta-de-otra-sucursal":
            await contenido(otraSucursalId, otro, { visibleEnCarta: true, nombreEnCarta: NOMBRE_CHOCANTE });
            break;
        }
        // Un estado imposible: dos platos visibles con el mismo nombre en la carta (lo impide el único parcial de la base): el estado «confirmado» ya chocaría con el otro plato.
        if (colision === "nombre-en-carta-de-otro" && estado === "confirmado-igual-al-interno") {
          await expect(contenido(sucursalId, objetivoId, { visibleEnCarta: true, nombreEnCarta: "Milanesa" })).rejects.toMatchObject({ code: "P2002" });
          recorridas++;
          continue;
        }
        await contenido(sucursalId, objetivoId, { visibleEnCarta: true, nombreEnCarta: estado === "pendiente" ? null : estado === "propio" ? "La Napo" : "Milanesa" });
        const antes = await guardado();
        const r = await confirmarNombreEnCarta(objetivoId);
        const etiqueta = `${estado} / ${colision}`;
        const esperado = resultadoEsperadoDelBoton(estado, colision);
        if (esperado === "copia") {
          expect(r.ok, etiqueta).toBe(true);
          expect(await guardado(), etiqueta).toBe("Milanesa");
          expect(await auditorias(), etiqueta).toHaveLength(1);
        } else if (esperado === "rechaza") {
          expect(r.ok, etiqueta).toBe(false);
          expect(r.mensaje, etiqueta).toContain("Ponele un nombre de carta distinto a uno de los dos.");
          expect(await guardado(), `sigue pendiente (${etiqueta})`).toBeNull();
          expect(await auditorias(), etiqueta).toEqual([]);
        } else {
          expect(r.ok, etiqueta).toBe(true);
          expect(await guardado(), `no cambia (${etiqueta})`).toBe(antes);
          expect(await auditorias(), etiqueta).toEqual([]);
        }
        recorridas++;
      }
    }
    expect(recorridas).toBe(TAMANO_DEL_BOTON);
  }, 300_000);
});
