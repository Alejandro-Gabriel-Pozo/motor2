import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { crearUsuarioConMembresia, EMPRESA_POR_DEFECTO_ID, limpiarBaseDeTest, prisma, prismaAdmin, sembrarBase } from "../setup/test-db";
import { fijarModulosActivos } from "../setup/modulos";
import {
  accionesDelMenuQueElUsuarioPuedeVer,
  obtenerMiNivelPermiso,
  obtenerMiNivelPermisoDeEmpresa,
  requierePermiso,
  requierePermisoDeEmpresa,
  requierePermisoVer,
  requierePermisoVerDeEmpresa,
} from "../../src/server/acceso/gate";
import { contextoDeAccion, type AccionClave, type AccionDeEmpresa, type AccionDeSucursal } from "../../src/core/permisos/acciones";
import { accionesDeNavegacion } from "../../src/core/navegacion/estructura";
import { modulosEfectivosDeEmpresa } from "../../src/server/acceso/modulos-de-empresa";
import { denegacionDeModulo } from "../../src/core/permisos/modulo-de-la-accion";

/**
 * P7 (bloque 5A): el guard y el menú miran el registro de módulos de la empresa. Orden: membresía → módulo → capacidad → rol. Administración
 * no lee la tabla. Guard y menú salen de la MISMA función: acá se prueba que coinciden con tres registros distintos.
 */

async function montar() {
  const base = await sembrarBase();
  const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
  return { base, admin, sucursalId: base.sucursal.id };
}

const ver = (usuarioId: string, sucursalId: string, clave: AccionClave) =>
  contextoDeAccion(clave) === "empresa"
    ? requierePermisoVerDeEmpresa(usuarioId, EMPRESA_POR_DEFECTO_ID, clave as AccionDeEmpresa, prisma)
    : requierePermisoVer(usuarioId, sucursalId, clave as AccionDeSucursal, prisma);

describe("el guard con el registro de módulos de la empresa", () => {
  beforeEach(async () => {
    await limpiarBaseDeTest();
  });

  it("con solo Consignación: Proveedores básico entra (lo trae por `requiere`), Comparar precios (Compras) no", async () => {
    const { admin, sucursalId } = await montar();
    await fijarModulosActivos(EMPRESA_POR_DEFECTO_ID, ["consignacion"]);

    expect((await requierePermisoDeEmpresa(admin.id, EMPRESA_POR_DEFECTO_ID, "proveedores", prisma)).ok).toBe(true);
    const compras = await requierePermisoVerDeEmpresa(admin.id, EMPRESA_POR_DEFECTO_ID, "comparar_precios", prisma);
    expect(compras).toMatchObject({ ok: false, motivo: "MODULO_NO_ACTIVO", modulo: "compras" });
    expect(compras.ok === false && compras.mensaje).toContain("Compras");
    expect(await obtenerMiNivelPermisoDeEmpresa(admin.id, EMPRESA_POR_DEFECTO_ID, "comparar_precios", prisma)).toEqual({ ver: false, editar: false });
    expect(sucursalId).toBeTruthy();
  });

  it("con solo Salón: Clientes básico entra", async () => {
    const { admin } = await montar();
    await fijarModulosActivos(EMPRESA_POR_DEFECTO_ID, ["salon"]);
    expect((await requierePermisoVerDeEmpresa(admin.id, EMPRESA_POR_DEFECTO_ID, "clientes", prisma)).ok).toBe(true);
  });

  it("una acción de sucursal de un módulo apagado se niega en los tres gates (editar, ver y nivel)", async () => {
    const { admin, sucursalId } = await montar();
    await fijarModulosActivos(EMPRESA_POR_DEFECTO_ID, ["consignacion"]);

    expect(contextoDeAccion("carta_ver")).toBe("sucursal");
    expect(await requierePermiso(admin.id, sucursalId, "carta_ver", prisma)).toMatchObject({ ok: false, motivo: "MODULO_NO_ACTIVO", modulo: "carta" });
    expect(await requierePermisoVer(admin.id, sucursalId, "carta_ver", prisma)).toMatchObject({ ok: false, motivo: "MODULO_NO_ACTIVO", modulo: "carta" });
    expect(await obtenerMiNivelPermiso(admin.id, sucursalId, "carta_ver", prisma)).toEqual({ ver: false, editar: false });

    await fijarModulosActivos(EMPRESA_POR_DEFECTO_ID, ["carta"]);
    expect((await requierePermisoVer(admin.id, sucursalId, "carta_ver", prisma)).ok).toBe(true);
  });

  it("con el registro VACÍO toda acción de Administración pasa y el resto se niega", async () => {
    const { admin, sucursalId } = await montar();
    await fijarModulosActivos(EMPRESA_POR_DEFECTO_ID, []);

    expect((await requierePermisoVer(admin.id, sucursalId, "gestion_usuarios", prisma)).ok).toBe(true);
    expect((await requierePermiso(admin.id, sucursalId, "gestion_usuarios", prisma)).ok).toBe(true);
    expect((await requierePermisoVerDeEmpresa(admin.id, EMPRESA_POR_DEFECTO_ID, "gestion_permisos", prisma)).ok).toBe(true);
    expect((await requierePermisoVerDeEmpresa(admin.id, EMPRESA_POR_DEFECTO_ID, "capacidades_sucursal", prisma)).ok).toBe(true);
    expect(await requierePermisoVer(admin.id, sucursalId, "reporte_resumen", prisma)).toMatchObject({ motivo: "MODULO_NO_ACTIVO", modulo: "stock" });
    expect(await requierePermisoVerDeEmpresa(admin.id, EMPRESA_POR_DEFECTO_ID, "proveedores", prisma)).toMatchObject({ motivo: "MODULO_NO_ACTIVO", modulo: "proveedores_basico" });
  });

  it("una fila INACTIVO no cuenta: el módulo está apagado", async () => {
    const { admin } = await montar();
    await fijarModulosActivos(EMPRESA_POR_DEFECTO_ID, ["salon"]);
    await prismaAdmin.moduloEmpresa.update({ where: { empresaId_modulo: { empresaId: EMPRESA_POR_DEFECTO_ID, modulo: "salon" } }, data: { estado: "INACTIVO" } });
    expect(await requierePermisoVerDeEmpresa(admin.id, EMPRESA_POR_DEFECTO_ID, "clientes", prisma)).toMatchObject({ ok: false, motivo: "MODULO_NO_ACTIVO" });
  });

  describe("orden de evaluación: membresía → módulo → capacidad → rol", () => {
    it("módulo apagado + capacidad apagada + rol sin permiso: el motivo es el MÓDULO", async () => {
      const { base, sucursalId } = await montar();
      const operador = await crearUsuarioConMembresia({ email: "operador@test.com", sucursalId, rolId: base.operador.id });
      await fijarModulosActivos(EMPRESA_POR_DEFECTO_ID, ["consignacion"]);
      await prisma.capacidadSucursal.create({ data: { accionClave: "carta_ver", sucursalId, habilitado: false } });

      expect(await requierePermisoVer(operador.id, sucursalId, "carta_ver", prisma)).toMatchObject({ ok: false, motivo: "MODULO_NO_ACTIVO" });
    });

    it("con el módulo activo, la capacidad apagada gana al rol", async () => {
      const { base, sucursalId } = await montar();
      const operador = await crearUsuarioConMembresia({ email: "operador@test.com", sucursalId, rolId: base.operador.id });
      await prisma.capacidadSucursal.create({ data: { accionClave: "carta_ver", sucursalId, habilitado: false } });
      expect(await requierePermisoVer(operador.id, sucursalId, "carta_ver", prisma)).toMatchObject({ ok: false, motivo: "SIN_CAPACIDAD" });
    });

    it("sin membresía, el motivo es el acceso aunque el módulo esté apagado (el módulo no se revela a quien no es de la empresa)", async () => {
      const { sucursalId } = await montar();
      const ajeno = await prisma.user.create({ data: { email: "ajeno@test.com", name: "Ajeno" } });
      await fijarModulosActivos(EMPRESA_POR_DEFECTO_ID, []);
      expect(await requierePermisoVer(ajeno.id, sucursalId, "carta_ver", prisma)).toMatchObject({ ok: false, motivo: "SIN_PERMISO", caso: "SIN_ACCESO_A_SUCURSAL" });
      expect(await requierePermisoVerDeEmpresa(ajeno.id, EMPRESA_POR_DEFECTO_ID, "proveedores", prisma)).toMatchObject({ ok: false, motivo: "SIN_PERMISO", caso: "SIN_ACCESO_A_EMPRESA" });
    });
  });

  describe("el menú es la misma función que el guard", () => {
    const REGISTROS: Record<string, string[]> = { "solo Consignación": ["consignacion"], "solo Salón": ["salon"], vacío: [], completo: ["stock", "compras", "traspasos", "consignacion", "recetas", "produccion", "carta", "promociones", "salon"] };

    for (const [nombre, registro] of Object.entries(REGISTROS)) {
      it(`para cada acción de la navegación, aparece en el menú si y solo si el gate de ver la deja pasar (${nombre})`, async () => {
        const { admin, sucursalId } = await montar();
        await fijarModulosActivos(EMPRESA_POR_DEFECTO_ID, registro);
        const acciones = accionesDeNavegacion();
        const menu = await accionesDelMenuQueElUsuarioPuedeVer(admin.id, EMPRESA_POR_DEFECTO_ID, sucursalId, acciones, prisma);

        const discrepancias: string[] = [];
        for (const accion of acciones) {
          const gate = (await ver(admin.id, sucursalId, accion)).ok;
          if (menu.has(accion) !== gate) discrepancias.push(`${accion}: menú=${menu.has(accion)} gate=${gate}`);
        }
        expect(discrepancias).toEqual([]);
        if (nombre === "completo") expect(menu.size).toBeGreaterThan(10);
        if (nombre === "vacío") expect(menu.has("gestion_permisos")).toBe(true);
        if (nombre === "solo Consignación") expect(menu.has("proveedores")).toBe(true);
        if (nombre === "solo Consignación") expect(menu.has("comparar_precios")).toBe(false);
      });
    }
  });

  describe("el registro se lee solo cuando hace falta, y su ausencia es un error", () => {
    function contandoLecturas() {
      const lecturas = { n: 0 };
      const db = new Proxy(prisma, {
        get(objetivo, propiedad, receptor) {
          if (propiedad === "moduloEmpresa") return { findMany: async () => (lecturas.n++, []) };
          return Reflect.get(objetivo, propiedad, receptor);
        },
      });
      return { db, lecturas };
    }

    it("una acción de Administración se resuelve sin tocar la tabla (ni en el gate de sucursal, ni en el de empresa, ni en el menú)", async () => {
      const { admin, sucursalId } = await montar();
      const { db, lecturas } = contandoLecturas();
      expect((await requierePermisoVer(admin.id, sucursalId, "gestion_usuarios", db)).ok).toBe(true);
      expect((await requierePermisoDeEmpresa(admin.id, EMPRESA_POR_DEFECTO_ID, "gestion_permisos", db)).ok).toBe(true);
      expect((await accionesDelMenuQueElUsuarioPuedeVer(admin.id, EMPRESA_POR_DEFECTO_ID, sucursalId, ["gestion_usuarios", "gestion_permisos"], db)).size).toBe(2);
      expect(lecturas.n).toBe(0);
    });

    it("una acción de un módulo vendible sí la lee", async () => {
      const { admin, sucursalId } = await montar();
      const { db, lecturas } = contandoLecturas();
      await requierePermisoVer(admin.id, sucursalId, "carta_ver", db);
      expect(lecturas.n).toBe(1);
    });

    it("si la tabla no existe, el error se propaga: nunca se lee como «sin módulos»", async () => {
      const { admin, sucursalId } = await montar();
      const sinTabla = new Proxy(prisma, {
        get(objetivo, propiedad, receptor) {
          if (propiedad === "moduloEmpresa") return { findMany: async () => Promise.reject(Object.assign(new Error('The table `public.ModuloEmpresa` does not exist'), { code: "P2021" })) };
          return Reflect.get(objetivo, propiedad, receptor);
        },
      });
      await expect(modulosEfectivosDeEmpresa(EMPRESA_POR_DEFECTO_ID, sinTabla)).rejects.toThrow(/ModuloEmpresa/);
      await expect(requierePermisoVer(admin.id, sucursalId, "carta_ver", sinTabla)).rejects.toThrow(/ModuloEmpresa/);
      await expect(accionesDelMenuQueElUsuarioPuedeVer(admin.id, EMPRESA_POR_DEFECTO_ID, sucursalId, ["carta_ver", "proveedores"], sinTabla)).rejects.toThrow(/ModuloEmpresa/);
    });
  });

  it("denegacionDeModulo distingue un módulo apagado de uno en desarrollo", () => {
    expect(denegacionDeModulo("stock", new Set(["administracion"]))).toEqual({ motivo: "MODULO_NO_ACTIVO", modulo: "stock" });
    expect(denegacionDeModulo("stock", new Set(["stock"]))).toBeNull();
  });
});

describe("`ModuloEmpresa` solo se consulta desde modulos-de-empresa.ts", () => {
  function archivos(dir: string): string[] {
    return readdirSync(dir).flatMap((nombre) => {
      const ruta = join(dir, nombre);
      return statSync(ruta).isDirectory() ? archivos(ruta) : /\.(ts|tsx)$/.test(nombre) ? [ruta] : [];
    });
  }

  it("ningún otro archivo de src/ lee el registro para decidir acceso: guard y menú no pueden discrepar", () => {
    const raiz = join(__dirname, "../../src");
    const lectores = archivos(raiz)
      .filter((f) => /moduloEmpresa/.test(readFileSync(f, "utf8")))
      .map((f) => f.slice(raiz.length + 1).replace(/\\/g, "/"));
    // Además del guard, SOLO el escritor de la plataforma (`cambiarModulosDeEmpresa`, P9) toca la tabla: lee las filas de la empresa para diffear y las escribe. No decide acceso.
    expect(lectores).toEqual(["server/acceso/modulos-de-empresa.ts", "server/operaciones-de-plataforma/cambiar-modulos-de-empresa.ts"]);
  });
});
