import { describe, expect, it } from "vitest";
import { GRUPOS_NAV, RUTAS_FUERA_DEL_MENU, accionDeRuta, accionesDeNavegacion, hrefsDelMenu, itemDeRuta } from "../../src/core/navegacion/estructura";
import { leerPantallaGuardada, pantallaDeRegreso, pantallaTrasCambiarSucursal } from "../../src/core/navegacion/pantalla-tras-cambio";
import type { AccionClave } from "../../src/core/permisos/acciones";

const TODO: ReadonlySet<AccionClave> = new Set(accionesDeNavegacion());
const sin = (...claves: AccionClave[]): ReadonlySet<AccionClave> => new Set([...TODO].filter((c) => !claves.includes(c)));
const solo = (...claves: AccionClave[]): ReadonlySet<AccionClave> => new Set(claves);

const MALICIOSAS = [
  "//sitio-falso.example.com/reportes",
  "https://sitio-falso.example.com",
  "/\\sitio-falso.example.com",
  "javascript:alert(1)",
  "/login",
  "/api/auth/signout",
  "/р",
  "/x😀",
  "/reportes\r\nSet-Cookie: a=b",
  "/reportes/costos\\..\\otra",
];

describe("itemDeRuta / accionDeRuta", () => {
  it("itemDeRuta es el ítem de la ruta más larga que es prefijo; accionDeRuta devuelve su acción", () => {
    expect(itemDeRuta("/reportes/rendimiento-recetas/por-sucursal?x=1")?.href).toBe("/reportes/rendimiento-recetas/por-sucursal");
    expect(itemDeRuta("/mesas/abc")?.href).toBe("/mesas");
    expect(itemDeRuta("/otra-cosa")).toBeNull();
    expect(accionDeRuta("/mesas/abc")).toBe("pos_mesas");
  });
});

describe("pantallaTrasCambiarSucursal: la misma pantalla, solo si existe y el rol la ve en la sucursal nueva", () => {
  it.each([
    ["una pantalla del menú", "/reportes/costos", "/reportes/costos"],
    ["descarta la consulta (puede traer ids de la sucursal anterior)", "/reportes/costos?desde=2026-09-01", "/reportes/costos"],
    ["descarta el ancla", "/reportes/consolidado#fila-3", "/reportes/consolidado"],
    ["una consulta con el id de una mesa", "/reportes/boletas?mesaId=cmu123", "/reportes/boletas"],
    ["recorta el id de la mesa", "/mesas/cmu123", "/mesas"],
    ["recorta una ruta hija de una ficha de empresa", "/catalogo/recetas/cmu123/historial", "/catalogo/recetas"],
    ["la ruta más larga gana", "/reportes/rendimiento-recetas/por-sucursal", "/reportes/rendimiento-recetas/por-sucursal"],
    ["una pantalla fuera del menú", "/catalogo/productos/nuevo", "/catalogo/productos/nuevo"],
    ["barra final", "/reportes/costos/", "/reportes/costos"],
  ])("%s", (_nombre, actual, esperado) => {
    expect(pantallaTrasCambiarSucursal(actual, TODO)).toBe(esperado);
  });

  it("sin permiso para esa pantalla en la sucursal nueva, o con su capacidad apagada (la acción deja de estar), da null", () => {
    expect(pantallaTrasCambiarSucursal("/reportes/costos", sin("reporte_costos"))).toBeNull();
    expect(pantallaTrasCambiarSucursal("/mesas/abc", sin("pos_mesas"))).toBeNull();
    expect(pantallaTrasCambiarSucursal("/reportes/costos", solo())).toBeNull();
  });

  it("no cae a un ítem más corto que el rol sí ve: si gana uno que no ve, da null", () => {
    expect(pantallaTrasCambiarSucursal("/reportes/rendimiento-recetas/por-sucursal", solo("reporte_rendimiento_recetas"))).toBeNull();
  });

  it.each([null, undefined, "", "/", "/inicio", "/otra-cosa", "/login", "reportes/costos"])("%s no es una pantalla a la que volver: null", (actual) => {
    expect(pantallaTrasCambiarSucursal(actual, TODO)).toBeNull();
  });

  it.each(MALICIOSAS)("la ruta maliciosa %j da null", (actual) => {
    expect(pantallaTrasCambiarSucursal(actual, TODO)).toBeNull();
  });

  it("propiedad: el resultado siempre es el href de un ítem conocido del menú (o fuera del menú) o null, sea cual sea la entrada", () => {
    const conocidos = new Set([...hrefsDelMenu(), ...RUTAS_FUERA_DEL_MENU.map((i) => i.href)]);
    const sufijos = ["", "/", "/abc", "/abc/historial", "?x=1", "#a", "/abc?mesaId=1#f", "/../login", "//x", "/%2F%2Fsitio", "?volver=//sitio"];
    const entradas = [...conocidos, "/", "/inicio", "/zzz", ...MALICIOSAS].flatMap((base) => sufijos.map((s) => base + s));
    expect(entradas.length).toBeGreaterThan(500);
    for (const entrada of entradas) {
      const r = pantallaTrasCambiarSucursal(entrada, TODO);
      if (r !== null) expect(conocidos.has(r), `${entrada} → ${r}`).toBe(true);
    }
  });

  it("cada ítem del menú con acción vuelve a sí mismo cuando el rol lo ve", () => {
    for (const item of GRUPOS_NAV.flatMap((g) => g.items).filter((i) => i.accion)) {
      expect(pantallaTrasCambiarSucursal(item.href, TODO)).toBe(item.href);
    }
  });
});

describe("pantallaDeRegreso: «Administración» desde el salón", () => {
  const INICIO = "/inicio";
  const guardada = (ruta: string, sucursalId = "suc-1") => ({ sucursalId, ruta });

  it("sin nada guardado, a inicio (y respeta el inicio que le pasan)", () => {
    expect(pantallaDeRegreso(null, "suc-1", TODO, INICIO)).toBe(INICIO);
    expect(pantallaDeRegreso(null, "suc-1", TODO, "/mesas")).toBe("/mesas");
  });

  it("la misma sucursal: vuelve a la pantalla guardada, CON su consulta", () => {
    expect(pantallaDeRegreso(guardada("/reportes/costos?desde=2026-09-01"), "suc-1", TODO, INICIO)).toBe("/reportes/costos?desde=2026-09-01");
    expect(pantallaDeRegreso(guardada("/catalogo/recetas/cmu1/historial"), "suc-1", TODO, INICIO)).toBe("/catalogo/recetas/cmu1/historial");
  });

  it("la misma sucursal pero ya sin permiso, o una ruta que no es del menú: a inicio", () => {
    expect(pantallaDeRegreso(guardada("/reportes/costos"), "suc-1", sin("reporte_costos"), INICIO)).toBe(INICIO);
    expect(pantallaDeRegreso(guardada("/otra-cosa"), "suc-1", TODO, INICIO)).toBe(INICIO);
    expect(pantallaDeRegreso(guardada("/inicio"), "suc-1", TODO, INICIO)).toBe(INICIO);
  });

  it("nunca vuelve a una pantalla del salón (sería un enlace a donde ya se está)", () => {
    for (const ruta of ["/mesas", "/mesas/abc", "/mesas?x=1", "/mesas/"]) {
      expect(pantallaDeRegreso(guardada(ruta), "suc-1", TODO, INICIO), ruta).toBe(INICIO);
      expect(pantallaDeRegreso(guardada(ruta, "suc-2"), "suc-1", TODO, INICIO), ruta).toBe(INICIO);
    }
  });

  it("si lo guardado era de OTRA sucursal, se aplica la regla del cambio de sucursal: la pantalla sin consulta, o inicio", () => {
    expect(pantallaDeRegreso(guardada("/reportes/costos?desde=2026-09-01", "suc-2"), "suc-1", TODO, INICIO)).toBe("/reportes/costos");
    expect(pantallaDeRegreso(guardada("/catalogo/recetas/cmu1", "suc-2"), "suc-1", TODO, INICIO)).toBe("/catalogo/recetas");
    expect(pantallaDeRegreso(guardada("/reportes/costos", "suc-2"), "suc-1", sin("reporte_costos"), INICIO)).toBe(INICIO);
  });

  it.each(MALICIOSAS)("lo guardado %j (el navegador pudo tocarlo) lleva a inicio, en la misma sucursal y en otra", (ruta) => {
    expect(pantallaDeRegreso(guardada(ruta), "suc-1", TODO, INICIO)).toBe(INICIO);
    expect(pantallaDeRegreso(guardada(ruta, "suc-2"), "suc-1", TODO, INICIO)).toBe(INICIO);
  });
});

describe("leerPantallaGuardada", () => {
  it("devuelve la pantalla guardada cuando tiene la forma esperada", () => {
    expect(leerPantallaGuardada(JSON.stringify({ sucursalId: "suc-1", ruta: "/reportes/costos?desde=2026-09-01" }))).toEqual({ sucursalId: "suc-1", ruta: "/reportes/costos?desde=2026-09-01" });
  });

  it.each([null, "", "no es json", "null", "[]", "42", "\"texto\"", "{}", '{"sucursalId":"s"}', '{"ruta":"/x"}', '{"sucursalId":1,"ruta":"/x"}', '{"sucursalId":"s","ruta":null}'])(
    "lo que no es una PantallaGuardada (%j) da null, sin tirar",
    (crudo) => {
      expect(leerPantallaGuardada(crudo)).toBeNull();
    },
  );
});
