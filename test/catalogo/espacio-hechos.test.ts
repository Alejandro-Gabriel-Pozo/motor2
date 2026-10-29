import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));
// Los lectores de cada paso se observan (envueltos, no reemplazados): la privacidad del marco es que de un paso que el usuario no puede abrir NO se lee nada.
vi.mock("../../src/server/lecturas/movimientos/receta-para-vender", async (original) => {
  const real = await original<typeof import("../../src/server/lecturas/movimientos/receta-para-vender")>();
  return { ...real, cargarOrigenDeStockParaVender: vi.fn(real.cargarOrigenDeStockParaVender) };
});
vi.mock("../../src/server/lecturas/opciones/opciones-para-vender", async (original) => {
  const real = await original<typeof import("../../src/server/lecturas/opciones/opciones-para-vender")>();
  return { ...real, cargarOpcionesParaVender: vi.fn(real.cargarOpcionesParaVender) };
});
vi.mock("../../src/server/consultas/carta/admin", async (original) => {
  const real = await original<typeof import("../../src/server/consultas/carta/admin")>();
  return { ...real, estadoDelProductoEnLaCarta: vi.fn(real.estadoDelProductoEnLaCarta) };
});
vi.mock("../../src/server/consultas/catalogo/opciones-de-venta", async (original) => {
  const real = await original<typeof import("../../src/server/consultas/catalogo/opciones-de-venta")>();
  return { ...real, cargarOpcionesDelProducto: vi.fn(real.cargarOpcionesDelProducto) };
});

import { crearUsuarioConMembresia, EMPRESA_POR_DEFECTO_ID, limpiarBaseDeTest, prisma, sembrarBase, sembrarProductoDisponible } from "../setup/test-db";
import { darRecetaDeReventa } from "../setup/receta-de-venta";
import { fijarModulosActivos } from "../setup/modulos";
import { hechosDelProducto, leerProductoDelEspacio, type ProductoDelEspacio } from "../../src/server/consultas/catalogo/espacio-del-producto";
import { cargarMarcoDelEspacio } from "../../src/components/catalogo/espacio-del-producto/datos-del-marco";
import { cargarOrigenDeStockParaVender } from "../../src/server/lecturas/movimientos/receta-para-vender";
import { estadoDelProductoEnLaCarta } from "../../src/server/consultas/carta/admin";
import { cargarOpcionesDelProducto } from "../../src/server/consultas/catalogo/opciones-de-venta";
import { cargarOpcionesParaVender } from "../../src/server/lecturas/opciones/opciones-para-vender";

/**
 * Fase 6, paso 6.12: las lecturas del espacio del producto (`hechosDelProducto`) y el marco que arma los pasos (`cargarMarcoDelEspacio`), contra Postgres real. Lo que se afirma:
 *  - los hechos de cada tipo de producto salen de las reglas reales (sin receta no se vende, lo vendible acá, la carta de la sucursal);
 *  - PRIVACIDAD: de un paso que el usuario no puede abrir no se lee nada (la receta, la carta y las opciones tienen sus lectores observados), y el marco no lo dibuja con enlace ni con dato;
 *  - un módulo apagado hace desaparecer su paso (sin enlace y sin que se lea nada).
 */
describe("el espacio del producto: hechos y marco", () => {
  let sucursalId: string;
  let ctxDe: (usuarioId: string) => { usuarioId: string; empresaId: string; sucursalId: string; db: typeof prisma };
  let usuarios: { admin: string };
  let rolAdminId: string;
  const ids: Record<string, string> = {};
  let sinReceta: ProductoDelEspacio;
  let conReceta: ProductoDelEspacio;
  let masaSinReceta: ProductoDelEspacio;
  let harina: ProductoDelEspacio;
  let respaldo: ProductoDelEspacio;

  const leer = async (id: string) => (await leerProductoDelEspacio(prisma, id))!;

  beforeEach(async () => {
    vi.clearAllMocks();
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    const u = await prisma.unidad.create({ data: { nombre: "u", magnitud: "CANTIDAD", decimales: 0 } });
    const pv = async (codigo: string, nombre: string, precioVenta: number) => (await sembrarProductoDisponible({ codigo, nombre, tipo: "PV", precioVenta, unidadStockId: u.id }, sucursalId));
    const milanesas = await pv("PV_MILA", "Milanesas", 20000);
    const cafe = await pv("PV_CAFE", "Café", 3000);
    await darRecetaDeReventa(prisma, { id: cafe.id, nombre: cafe.nombre, codigo: cafe.codigo, unidadStockId: u.id }, { sucursalIds: [sucursalId] });
    const masa = await sembrarProductoDisponible({ codigo: "MP_MASA", nombre: "Masa madre", tipo: "MP", unidadStockId: u.id, seProduce: true }, sucursalId);
    const harinaMp = await sembrarProductoDisponible({ codigo: "MP_HARINA", nombre: "Harina", tipo: "MP", unidadStockId: u.id }, sucursalId);
    // El producto de respaldo de un adicional: el producto de la opción de un grupo ADICIONAL.
    const ancla = await pv("PV_SHOT", "Shot extra (ancla)", 0);
    const grupo = await prisma.grupoDeOpciones.create({ data: { nombre: "Extras", tipo: "ADICIONAL", cantidadMinima: 0, cantidadMaxima: 3 } });
    await prisma.opcionDeGrupo.create({ data: { grupoId: grupo.id, nombre: "Shot extra", orden: 1, productoId: ancla.id } });
    Object.assign(ids, { milanesas: milanesas.id, cafe: cafe.id, masa: masa.id, harina: harinaMp.id, ancla: ancla.id });
    [sinReceta, conReceta, masaSinReceta, harina, respaldo] = await Promise.all([leer(milanesas.id), leer(cafe.id), leer(masa.id), leer(harinaMp.id), leer(ancla.id)]);

    rolAdminId = base.admin.id;
    usuarios = { admin: (await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id })).id };
    ctxDe = (usuarioId) => ({ usuarioId, empresaId: EMPRESA_POR_DEFECTO_ID, sucursalId, db: prisma });
  });

  const TODO = { opciones: true, receta: true, carta: true };
  const NADA = { opciones: false, receta: false, carta: false };

  describe("hechosDelProducto", () => {
    it("un producto de venta sin receta: «sin receta no se vende» con el mensaje de la regla; con receta, nada", async () => {
      const h = await hechosDelProducto(prisma, sinReceta, sucursalId, TODO);
      expect(h.receta).toEqual({ rechazo: "«Milanesas» no tiene receta: armala en Catálogo → Recetas para poder venderla." });
      expect((await hechosDelProducto(prisma, conReceta, sucursalId, TODO)).receta).toEqual({ rechazo: null });
    });

    it("ventas con opciones (2026-10-29): un producto sin receta cuyas opciones ofrecidas suman un insumo no tiene el pendiente de receta; con opciones que no descuentan, el mensaje de catálogo; sin opciones, el de siempre", async () => {
      const botella = await sembrarProductoDisponible({ codigo: "MP_COCA", nombre: "Coca botella", tipo: "MP", unidadStockId: (await prisma.producto.findUniqueOrThrow({ where: { id: ids.harina } })).unidadStockId }, sucursalId);
      const grupo = await prisma.grupoDeOpciones.create({ data: { nombre: "Marca", tipo: "VARIANTE", cantidadMinima: 1, cantidadMaxima: 1 } });
      const unidadId = botella.unidadStockId;
      const opcion = async (nombre: string, orden: number, conConsumo: boolean) => {
        const o = await prisma.opcionDeGrupo.create({ data: { grupoId: grupo.id, nombre, orden } });
        const v = await prisma.versionDeOpcion.create({ data: { opcionId: o.id, numero: 1, tipoDeDiferencia: "MONTO", diferenciaPrecio: "0.00", creadoPorId: usuarios.admin } });
        if (conConsumo) await prisma.consumoDeOpcion.create({ data: { versionDeOpcionId: v.id, efecto: "SUMA", insumoProductoId: botella.id, cantidad: "1.0000", unidadId } });
        await prisma.productoAdmiteOpcion.create({ data: { productoId: ids.milanesas, opcionId: o.id } });
        return o.id;
      };
      // Sin opciones: el mensaje de siempre (y no se leen las opciones: el producto no las ofrece).
      expect((await hechosDelProducto(prisma, sinReceta, sucursalId, TODO)).receta?.rechazo).toContain("no tiene receta: armala en Catálogo → Recetas");
      await prisma.productoAdmiteGrupo.create({ data: { productoId: ids.milanesas, grupoId: grupo.id, orden: 0 } });
      const fanta = await opcion("Fanta", 1, false);
      expect((await hechosDelProducto(prisma, sinReceta, sucursalId, TODO)).receta).toEqual({ rechazo: "“Milanesas” no tiene receta ni opciones que descuenten insumos: armá la receta o cargale el consumo a sus opciones." });
      await opcion("Coca", 2, true);
      expect((await hechosDelProducto(prisma, sinReceta, sucursalId, TODO)).receta).toEqual({ rechazo: null });
      // Una opción apagada para toda la empresa no cuenta; una apagada solo un rato en la sucursal, sí.
      await prisma.opcionDeGrupo.updateMany({ where: { nombre: "Coca" }, data: { activa: false } });
      expect((await hechosDelProducto(prisma, sinReceta, sucursalId, TODO)).receta?.rechazo).toContain("no tiene receta ni opciones");
      await prisma.opcionDeGrupo.updateMany({ where: { nombre: "Coca" }, data: { activa: true } });
      await prisma.opcionApagadaEnSucursal.create({ data: { sucursalId, opcionId: fanta, apagada: true, actualizadoPorId: usuarios.admin } });
      expect((await hechosDelProducto(prisma, sinReceta, sucursalId, TODO)).receta).toEqual({ rechazo: null });
    });

    it("PRIVACIDAD de las opciones: sin permiso para el paso de la receta no se lee ni la receta ni las opciones que la reemplazan; con el permiso, sí", async () => {
      await hechosDelProducto(prisma, sinReceta, sucursalId, { opciones: true, receta: false, carta: true });
      expect(cargarOrigenDeStockParaVender).not.toHaveBeenCalled();
      expect(cargarOpcionesParaVender).not.toHaveBeenCalled();
      await hechosDelProducto(prisma, sinReceta, sucursalId, { opciones: false, receta: true, carta: false });
      expect(cargarOrigenDeStockParaVender).toHaveBeenCalledTimes(1);
      expect(cargarOpcionesParaVender).toHaveBeenCalledTimes(1);
      // Un producto con receta no necesita mirar sus opciones.
      vi.clearAllMocks();
      await hechosDelProducto(prisma, conReceta, sucursalId, { opciones: false, receta: true, carta: false });
      expect(cargarOpcionesParaVender).not.toHaveBeenCalled();
    });

    it("un directo con opciones al día es vendible acá, y la carta dice «fuera» mientras no tenga contenido", async () => {
      const h = await hechosDelProducto(prisma, sinReceta, sucursalId, TODO);
      expect(h).toMatchObject({ tipo: "PV", modoDeVenta: "DIRECTO", precioDeVenta: 20000, esAnclaDeAdicional: false, opciones: { vendibleAca: true }, carta: { estado: "fuera" } });
    });

    it("una materia prima que se produce y no tiene receta queda pendiente; una que no se produce no tiene paso de receta, ni de opciones, ni de carta", async () => {
      const masa = await hechosDelProducto(prisma, masaSinReceta, sucursalId, TODO);
      expect(masa.receta?.rechazo).toContain("se produce y todavía no tiene receta");
      expect(masa.opciones).toBeNull();
      expect(masa.carta).toBeNull();
      const h = await hechosDelProducto(prisma, harina, sucursalId, TODO);
      expect([h.opciones, h.receta, h.carta]).toEqual([null, null, null]);
    });

    it("el producto de respaldo de un adicional no tiene pasos de venta ni receta: nada se lee", async () => {
      expect(respaldo.esAnclaDeAdicional).toBe(true);
      const h = await hechosDelProducto(prisma, respaldo, sucursalId, TODO);
      expect([h.opciones, h.receta, h.carta]).toEqual([null, null, null]);
      expect(cargarOrigenDeStockParaVender).not.toHaveBeenCalled();
      expect(estadoDelProductoEnLaCarta).not.toHaveBeenCalled();
      expect(cargarOpcionesDelProducto).not.toHaveBeenCalled();
    });

    it("PRIVACIDAD: sin permiso para un paso, la consulta de ese paso NO se hace y el hecho queda sin dato", async () => {
      const h = await hechosDelProducto(prisma, sinReceta, sucursalId, NADA);
      expect([h.opciones, h.receta, h.carta]).toEqual([null, null, null]);
      expect(cargarOrigenDeStockParaVender).not.toHaveBeenCalled();
      expect(estadoDelProductoEnLaCarta).not.toHaveBeenCalled();
      expect(cargarOpcionesDelProducto).not.toHaveBeenCalled();
    });

    it("PRIVACIDAD, paso por paso: solo se lee lo permitido (y con el permiso, sí se lee: contraespejo)", async () => {
      await hechosDelProducto(prisma, sinReceta, sucursalId, { opciones: false, receta: true, carta: false });
      expect(cargarOrigenDeStockParaVender).toHaveBeenCalledTimes(1);
      expect(estadoDelProductoEnLaCarta).not.toHaveBeenCalled();
      expect(cargarOpcionesDelProducto).not.toHaveBeenCalled();
      vi.clearAllMocks();
      await hechosDelProducto(prisma, sinReceta, sucursalId, { opciones: false, receta: false, carta: true });
      expect(estadoDelProductoEnLaCarta).toHaveBeenCalledTimes(1);
      expect(cargarOrigenDeStockParaVender).not.toHaveBeenCalled();
      vi.clearAllMocks();
      await hechosDelProducto(prisma, sinReceta, sucursalId, { opciones: true, receta: false, carta: false });
      expect(cargarOpcionesDelProducto).toHaveBeenCalledTimes(1);
      expect(cargarOrigenDeStockParaVender).not.toHaveBeenCalled();
    });

    it("las opciones ya leídas por la pantalla no se vuelven a leer", async () => {
      const leidas = await cargarOpcionesDelProducto(prisma, ids.milanesas, sucursalId);
      vi.mocked(cargarOpcionesDelProducto).mockClear();
      const h = await hechosDelProducto(prisma, sinReceta, sucursalId, TODO, { opciones: leidas });
      expect(h.opciones).toEqual({ vendibleAca: true });
      expect(cargarOpcionesDelProducto).not.toHaveBeenCalled();
    });
  });

  describe("cargarMarcoDelEspacio", () => {
    const pasosDe = async (usuarioId: string, producto: ProductoDelEspacio) => (await cargarMarcoDelEspacio(ctxDe(usuarioId), producto)).pasos;
    const resumen = (pasos: Awaited<ReturnType<typeof pasosDe>>) => pasos.map((p) => `${p.titulo}${p.href === null ? " (sin enlace)" : ""}`);

    it("el administrador abre los cuatro pasos de un producto de venta, con los pendientes de cada uno", async () => {
      const pasos = await pasosDe(usuarios.admin, sinReceta);
      expect(resumen(pasos)).toEqual(["Qué se vende", "Opciones y precio", "Receta", "En la carta"]);
      expect(pasos.map((p) => p.href)).toEqual([`/catalogo/productos/${ids.milanesas}/datos`, `/catalogo/productos/${ids.milanesas}/opciones`, `/catalogo/recetas/${ids.milanesas}`, `/catalogo/productos/${ids.milanesas}/en-la-carta`]);
      expect(pasos.map((p) => p.estado.tipo)).toEqual(["listo", "listo", "pendiente", "pendiente"]);
    });

    it("quien ve la receta y la carta pero NO edita el producto: los pasos 1 y 2 (piden Editar) salen como texto sin enlace y sin dato; la receta y la carta (piden Ver) sí tienen enlace y dato", async () => {
      // La receta y la carta son de piso administrador: el caso se arma con el rol administrador al que se le quita el Editar de los pasos 1 y 2.
      await prisma.permisoRol.updateMany({ where: { rolId: rolAdminId, accionClave: { in: ["producto_editar", "producto_opciones_admitidas"] } }, data: { puedeEditar: false } });
      const pasos = await pasosDe(usuarios.admin, sinReceta);
      expect(resumen(pasos)).toEqual(["Qué se vende (sin enlace)", "Opciones y precio (sin enlace)", "Receta", "En la carta"]);
      expect(pasos[0].estado).toEqual({ tipo: "sin-dato" });
      expect(pasos[1].estado).toEqual({ tipo: "sin-dato" });
      expect(pasos[2].estado.tipo).toBe("pendiente");
      expect(pasos[3].estado.tipo).toBe("pendiente");
      // El paso 2 no se calculó (no se leyeron las opciones): la privacidad no es solo de dibujo. Contraespejo: la receta y la carta sí.
      expect(cargarOpcionesDelProducto).not.toHaveBeenCalled();
      expect(cargarOrigenDeStockParaVender).toHaveBeenCalledTimes(1);
      expect(estadoDelProductoEnLaCarta).toHaveBeenCalledTimes(1);
    });

    it("quien no ve ni la receta ni la carta: ni enlace ni dato, y esas consultas no se hacen", async () => {
      const rol = await prisma.rol.create({ data: { nombre: "Solo catálogo" } });
      for (const accionClave of ["alta_producto", "producto_ver_catalogo"]) await prisma.permisoRol.create({ data: { rolId: rol.id, accionClave, puedeVer: true, puedeEditar: false } });
      const usuario = await crearUsuarioConMembresia({ email: "catalogo@test.com", sucursalId, rolId: rol.id });
      const pasos = await pasosDe(usuario.id, sinReceta);
      expect(resumen(pasos)).toEqual(["Qué se vende (sin enlace)", "Opciones y precio (sin enlace)", "Receta (sin enlace)", "En la carta (sin enlace)"]);
      expect(pasos.every((p) => p.estado.tipo === "sin-dato")).toBe(true);
      expect(cargarOrigenDeStockParaVender).not.toHaveBeenCalled();
      expect(estadoDelProductoEnLaCarta).not.toHaveBeenCalled();
      expect(cargarOpcionesDelProducto).not.toHaveBeenCalled();
    });

    it("sin el módulo Recetas el paso no aparece (ni se lee); sin el módulo Carta, tampoco el suyo", async () => {
      await fijarModulosActivos(EMPRESA_POR_DEFECTO_ID, ["stock", "carta"]);
      expect(resumen(await pasosDe(usuarios.admin, sinReceta))).toEqual(["Qué se vende", "Opciones y precio", "En la carta"]);
      expect(cargarOrigenDeStockParaVender).not.toHaveBeenCalled();
      await fijarModulosActivos(EMPRESA_POR_DEFECTO_ID, ["stock", "recetas"]);
      vi.clearAllMocks();
      expect(resumen(await pasosDe(usuarios.admin, sinReceta))).toEqual(["Qué se vende", "Opciones y precio", "Receta"]);
      expect(estadoDelProductoEnLaCarta).not.toHaveBeenCalled();
    });

    it("una materia prima tiene Datos y, solo si se produce, Receta; el producto de respaldo, solo el paso 1", async () => {
      expect(resumen(await pasosDe(usuarios.admin, harina))).toEqual(["Datos"]);
      const masa = await pasosDe(usuarios.admin, masaSinReceta);
      expect(resumen(masa)).toEqual(["Datos", "Receta"]);
      expect(masa[1]).toMatchObject({ href: `/catalogo/recetas/${ids.masa}`, estado: { tipo: "pendiente" } });
      expect(resumen(await pasosDe(usuarios.admin, respaldo))).toEqual(["Qué se vende"]);
    });

    it("la disponibilidad acá se lee una vez, o se toma de lo que la pantalla ya leyó", async () => {
      expect((await cargarMarcoDelEspacio(ctxDe(usuarios.admin), sinReceta)).disponibleAca).toBe(true);
      expect((await cargarMarcoDelEspacio(ctxDe(usuarios.admin), sinReceta, { disponibleAca: false })).disponibleAca).toBe(false);
      await prisma.disponibilidadProducto.updateMany({ where: { productoId: ids.milanesas, sucursalId }, data: { disponible: false } });
      expect((await cargarMarcoDelEspacio(ctxDe(usuarios.admin), sinReceta)).disponibleAca).toBe(false);
    });
  });
});
