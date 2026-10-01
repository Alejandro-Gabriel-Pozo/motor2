import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { nivelMinimoDeAccion, type AccionClave } from "../../src/core/permisos/acciones";
import { ACCION_POR_PROCESO } from "../../src/core/movimientos/transiciones";
import { listarUsuariosDeSucursal } from "../../src/server/actions/auth/usuarios";
import { obtenerComparativaPreciosPorInsumo, listarProductosDeProveedor } from "../../src/server/actions/catalogo/proveedor-por-producto";
import { listarVersionesDeReceta, obtenerRecetaVigente } from "../../src/server/actions/catalogo/recetas";
import { obtenerHistorialConteosFisicos } from "../../src/server/actions/movimientos/lecturas-conteo-fisico";
import { listarPreciosLocales, obtenerPrecioLocalProducto } from "../../src/server/actions/movimientos/precio-local";
import { listarSeccionesParaPanel } from "../../src/server/actions/movimientos/secciones";
import { listarMotivosMermaParaPanel, listarDestinosConsumoParaPanel } from "../../src/server/actions/movimientos/motivos";
import { listarCapacidades } from "../../src/server/actions/permisos/capacidades-sucursal";
import { listarMatrizPermisos } from "../../src/server/actions/permisos/permisos";
import { listarRoles } from "../../src/server/actions/permisos/roles";
import { buscarProductoParaPromocion, obtenerPromocionesHabilitadas } from "../../src/server/actions/reportes/promociones";
import { listarStockMinimo } from "../../src/server/actions/stock/stock-minimo";
import { listarSeccionesHabituales } from "../../src/server/actions/stock/seccion-habitual";
import { listarSucursalesParaSolicitar, listarSucursalesParaEnviar, obtenerBandejaTransferencias } from "../../src/server/actions/traspasos/lecturas";

/**
 * Las lecturas que devuelven los datos PROPIOS de una pantalla piden, además de la sesión, el permiso de «Ver» de esa pantalla
 * (`requerirVer` / `requerirVerEnSucursal`, ver con-sesion.ts). Antes bastaba estar logueado: la página se protegía, pero la
 * lectura es un endpoint que se podía invocar directo y devolvía, por ejemplo, la matriz de permisos o los precios de los
 * proveedores a un rol que no podía abrir esas pantallas.
 *
 * Cada fila: la lectura, la clave que exige y la página (dueña de esos datos) que pide la MISMA clave. Las lecturas de catálogo
 * compartido (secciones activas, unidades, proveedores, buscador de productos…) NO están acá a propósito: son selectores que
 * usan muchas pantallas con claves distintas.
 */
type Fila = {
  nombre: string;
  clave: AccionClave;
  pagina: string;
  archivo: string;
  /** La página no escribe la clave: la toma del proceso (ACCION_POR_PROCESO). */
  viaProceso?: "COMPRA";
  llamar: (sucursalId: string) => Promise<unknown> };

const LECTURAS: Fila[] = [
  { nombre: "listarUsuariosDeSucursal", clave: "gestion_usuarios", pagina: "administracion/usuarios/page.tsx", archivo: "auth/usuarios.ts", llamar: (s) => listarUsuariosDeSucursal(s) },
  { nombre: "listarMatrizPermisos", clave: "gestion_permisos", pagina: "administracion/permisos/page.tsx", archivo: "permisos/permisos.ts", llamar: () => listarMatrizPermisos() },
  { nombre: "listarRoles", clave: "gestion_roles", pagina: "administracion/roles/page.tsx", archivo: "permisos/roles.ts", llamar: () => listarRoles() },
  { nombre: "listarCapacidades", clave: "capacidades_sucursal", pagina: "administracion/capacidades-sucursal/page.tsx", archivo: "permisos/capacidades-sucursal.ts", llamar: () => listarCapacidades() },
  { nombre: "listarPreciosLocales", clave: "precio_local", pagina: "movimientos/precio-local/page.tsx", archivo: "movimientos/precio-local.ts", llamar: (s) => listarPreciosLocales(s) },
  { nombre: "obtenerPrecioLocalProducto", clave: "precio_local", pagina: "movimientos/precio-local/page.tsx", archivo: "movimientos/precio-local.ts", llamar: (s) => obtenerPrecioLocalProducto(s, "x") },
  { nombre: "listarSeccionesParaPanel", clave: "secciones", pagina: "movimientos/secciones/page.tsx", archivo: "movimientos/secciones.ts", llamar: (s) => listarSeccionesParaPanel(s) },
  { nombre: "listarMotivosMermaParaPanel", clave: "motivos_merma", pagina: "movimientos/motivos-merma/page.tsx", archivo: "movimientos/motivos.ts", llamar: () => listarMotivosMermaParaPanel() },
  { nombre: "listarDestinosConsumoParaPanel", clave: "motivos_destino_consumo", pagina: "movimientos/destinos-consumo/page.tsx", archivo: "movimientos/motivos.ts", llamar: () => listarDestinosConsumoParaPanel() },
  { nombre: "obtenerHistorialConteosFisicos", clave: "reporte_conteos", pagina: "reportes/conteos/page.tsx", archivo: "movimientos/lecturas-conteo-fisico.ts", llamar: (s) => obtenerHistorialConteosFisicos(s) },
  { nombre: "obtenerPromocionesHabilitadas", clave: "promociones_config", pagina: "reportes/promociones/page.tsx", archivo: "reportes/promociones.ts", llamar: (s) => obtenerPromocionesHabilitadas(s) },
  { nombre: "buscarProductoParaPromocion", clave: "promociones_config", pagina: "reportes/promociones/page.tsx", archivo: "reportes/promociones.ts", llamar: (s) => buscarProductoParaPromocion(s, "") },
  { nombre: "listarStockMinimo", clave: "stock_minimo", pagina: "stock/minimo/page.tsx", archivo: "stock/stock-minimo.ts", llamar: (s) => listarStockMinimo(s) },
  { nombre: "listarSeccionesHabituales", clave: "stock_seccion_habitual", pagina: "stock/seccion-habitual/page.tsx", archivo: "stock/seccion-habitual.ts", llamar: (s) => listarSeccionesHabituales(s) },
  { nombre: "obtenerBandejaTransferencias", clave: "traspaso_ver_bandeja", pagina: "traspasos/page.tsx", archivo: "traspasos/lecturas.ts", llamar: (s) => obtenerBandejaTransferencias(s) },
  { nombre: "listarSucursalesParaSolicitar", clave: "traspaso_solicitar", pagina: "traspasos/solicitar/page.tsx", archivo: "traspasos/lecturas.ts", llamar: (s) => listarSucursalesParaSolicitar(s) },
  { nombre: "listarSucursalesParaEnviar", clave: "traspaso_enviar_directo", pagina: "traspasos/enviar/page.tsx", archivo: "traspasos/lecturas.ts", llamar: (s) => listarSucursalesParaEnviar(s) },
  { nombre: "obtenerComparativaPreciosPorInsumo", clave: "comparar_precios", pagina: "catalogo/proveedores/comparativa/page.tsx", archivo: "catalogo/proveedor-por-producto.ts", llamar: () => obtenerComparativaPreciosPorInsumo() },
  { nombre: "listarProductosDeProveedor", clave: "proceso_compra", pagina: "movimientos/[proceso]/page.tsx", archivo: "catalogo/proveedor-por-producto.ts", viaProceso: "COMPRA", llamar: () => listarProductosDeProveedor("x") },
  { nombre: "obtenerRecetaVigente", clave: "guardar_receta", pagina: "catalogo/recetas/[productoId]/page.tsx", archivo: "catalogo/recetas.ts", llamar: () => obtenerRecetaVigente("x") },
  { nombre: "listarVersionesDeReceta", clave: "guardar_receta", pagina: "catalogo/recetas/[productoId]/historial/page.tsx", archivo: "catalogo/recetas.ts", llamar: () => listarVersionesDeReceta("x") },
];

describe("lecturas con permiso de Ver: un rol sin el permiso de la pantalla no las puede invocar", () => {
  let sucursalId: string;
  let rolSinPermisosId: string;
  let rolAdminId: string;
  let usuarioId: string;

  /** La lectura de una acción de piso administrador solo la alcanza un rol de ese nivel (el «admin»): se le saca la fila al rol y se la deja en «Solo ver». */
  async function darSoloVer(clave: AccionClave) {
    if (nivelMinimoDeAccion(clave) === "operario") {
      await prisma.permisoRol.create({ data: { rolId: rolSinPermisosId, accionClave: clave, puedeVer: true, puedeEditar: false } });
      return;
    }
    await prisma.usuarioSucursal.updateMany({ where: { usuarioId }, data: { rolId: rolAdminId } });
    await prisma.permisoRol.update({ where: { rolId_accionClave: { rolId: rolAdminId, accionClave: clave } }, data: { puedeVer: true, puedeEditar: false } });
  }

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    rolAdminId = base.admin.id;
    // Un rol que existe y está activo pero no tiene ningún permiso.
    rolSinPermisosId = (await prisma.rol.create({ data: { nombre: "sin-permisos" } })).id;
    const usuario = await crearUsuarioConMembresia({ email: "lector@test.com", sucursalId, rolId: rolSinPermisosId });
    usuarioId = usuario.id;
    await mockearUsuarioActual({ id: usuario.id, email: usuario.email, nombre: null });
  });

  it.each(LECTURAS)("$nombre sin «Ver» de $clave se rechaza con el mensaje de permiso", async ({ llamar }) => {
    await expect(llamar(sucursalId)).rejects.toThrow(/No tenés permiso/);
  });

  it.each(LECTURAS)("$nombre con «Ver» de $clave (sin poder Editar) responde", async ({ llamar, clave }) => {
    await darSoloVer(clave);
    await expect(llamar(sucursalId)).resolves.not.toThrow();
  });

  it.each(LECTURAS.filter((l) => nivelMinimoDeAccion(l.clave) !== "operario"))(
    "$nombre: un rol de nivel operario con la fila de $clave (acción de administrador) NO la puede leer: el piso manda",
    async ({ llamar, clave }) => {
      await prisma.permisoRol.create({ data: { rolId: rolSinPermisosId, accionClave: clave, puedeVer: true, puedeEditar: false } });
      await expect(llamar(sucursalId)).rejects.toThrow(/No tenés permiso/);
    },
  );

  it("el permiso de una acción no habilita las lecturas de otra", async () => {
    await darSoloVer("reporte_conteos");
    await expect(obtenerHistorialConteosFisicos(sucursalId)).resolves.toBeDefined();
    await expect(listarMatrizPermisos()).rejects.toThrow(/No tenés permiso/);
    await expect(listarPreciosLocales(sucursalId)).rejects.toThrow(/No tenés permiso/);
  });
});

describe("cada lectura pide la MISMA clave que la página dueña de esos datos", () => {
  const app = join(__dirname, "../../src/app/(app)");
  const acciones = join(__dirname, "../../src/server/actions");

  it.each(LECTURAS)("$nombre exige $clave, igual que $pagina", ({ nombre, clave, pagina, archivo, viaProceso }) => {
    const fuentePagina = readFileSync(join(app, pagina), "utf8");
    if (viaProceso) {
      expect(fuentePagina, `${pagina} no toma la clave de ACCION_POR_PROCESO`).toContain("ACCION_POR_PROCESO[config.proceso]");
      expect(ACCION_POR_PROCESO[viaProceso], `la clave del proceso ${viaProceso}`).toBe(clave);
    } else {
      expect(fuentePagina, `${pagina} no pide «${clave}»`).toMatch(new RegExp(`requierePermisoVer(?:DeEmpresa)?\\([^)]*"${clave}"`));
    }

    const fuente = readFileSync(join(acciones, archivo), "utf8").replace(/\r\n/g, "\n");
    const inicio = fuente.indexOf(`export async function ${nombre}(`);
    expect(inicio, `${nombre} no está en ${archivo}`).toBeGreaterThan(-1);
    const cuerpo = fuente.slice(inicio, inicio + 400);
    expect(cuerpo, `${nombre} no abre con requerirVer…("${clave}")`).toMatch(new RegExp(`requerirVer(EnSucursal|DeEmpresa)?\\([^)]*"${clave}"`));
  });
});
