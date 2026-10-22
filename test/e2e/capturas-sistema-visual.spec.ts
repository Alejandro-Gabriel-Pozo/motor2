import { test, expect } from "./fixtures/auth";
import { capturar } from "./fixtures/movil";
import { limpiarLineaDeBasePrecioYCarta, restosDeLaLineaDeBase, sembrarLineaDeBasePrecioYCarta } from "./fixtures/siembra-precio-y-carta";

/**
 * RED DE CAPTURAS del sistema visual (Fase 6, «Interfaz del producto», 6.0.3): antes de cambiar el sistema visual (colores, escala de letra, espaciados, componentes base) hace falta
 * poder MIRAR «antes» y «después» de las pantallas de administración, a 375 y a 1280 px. La Fase 0 solo dejó capturas de la carta pública y de tres pantallas de administración
 * (`linea-de-base-precio-y-carta.spec.ts`); esta spec cubre el resto de las pantallas que el cambio puede tocar, y dos de ellas (`/inicio` y `/carta`) también con el sistema en OSCURO
 * (`prefers-color-scheme: dark`, sin tocar nada de la aplicación).
 *
 * NO afirma nada visual (eso lo cubren `maquetacion-general`, `movil-sin-desborde`, `accesibilidad`…): solo que la pantalla CARGÓ (se quedó en su ruta, sin mandar al login, y su `h1` se ve), para
 * que una ruta que falle no deje una captura vacía o de la pantalla de error como si fuera buena. Sin `MOTOR2_CAPTURAS_MOVIL` (carpeta, fuera del repo) no se escribe ningún archivo: la spec
 * solo recorre las pantallas.
 *
 * Datos: el catálogo de referencia de `fixtures/siembra-precio-y-carta.ts` (nombres y precios estables, así el «antes» y el «después» se comparan con los mismos datos) en su sucursal dedicada,
 * con su usuario propio (rol admin); el producto de la ficha es «Pizzas». Se limpia todo al terminar, también si falla.
 *
 * Nombres de los archivos: `<ruta-con-guiones>-<ancho>.png` (y `-sistema-oscuro` para el oscuro): `catalogo-productos-ficha-375`, `inicio-1280-sistema-oscuro`…
 * `/movimientos/merma` es la pantalla del proceso «merma» de la ruta dinámica `movimientos/[proceso]`; `/mesas` es el mapa de mesas del POS (grupo de rutas `(pos)`).
 */

const ANCHOS = [
  { ancho: 375, alto: 812 },
  { ancho: 1280, alto: 900 },
] as const;

interface Pantalla {
  /** El nombre de la captura (la ruta con guiones). */
  nombre: string;
  /** La ruta, o una función de los datos sembrados (la ficha necesita el id del producto). */
  ruta: string | ((d: { productoId: Record<string, string> }) => string);
  /** También con el sistema en oscuro. */
  oscuro?: true;
}

const PANTALLAS_CON_SESION: readonly Pantalla[] = [
  { nombre: "inicio", ruta: "/inicio", oscuro: true },
  { nombre: "catalogo-productos", ruta: "/catalogo/productos" },
  { nombre: "catalogo-productos-ficha", ruta: (d) => `/catalogo/productos/${d.productoId.pizzas}` },
  { nombre: "catalogo-opciones", ruta: "/catalogo/opciones" },
  { nombre: "catalogo-unidades", ruta: "/catalogo/unidades" },
  { nombre: "movimientos-merma", ruta: "/movimientos/merma" },
  { nombre: "reportes-costos", ruta: "/reportes/costos" },
  { nombre: "administracion-usuarios", ruta: "/administracion/usuarios" },
  { nombre: "carta", ruta: "/carta", oscuro: true },
  { nombre: "carta-parametrizacion", ruta: "/carta/parametrizacion" },
  { nombre: "carta-parametrizacion-secciones", ruta: "/carta/parametrizacion/secciones" },
  { nombre: "carta-parametrizacion-generos", ruta: "/carta/parametrizacion/generos" },
  { nombre: "mesas", ruta: "/mesas" },
];

test("red de capturas del sistema visual: las pantallas de administración y el login, a 375 y 1280 px, y el sistema en oscuro", async ({ browser, baseURL, sucursalId }) => {
  test.setTimeout(900_000); // con el servidor de desarrollo la primera visita de cada pantalla compila
  // `sucursalId` asegura la base de los fixtures (unidades, rol admin, el usuario de las pruebas) antes de sembrar.
  expect(sucursalId).toBeTruthy();
  const conSesion = await browser.newContext();
  const sinSesion = await browser.newContext();
  let llegoAlFinal = false;
  try {
    const d = await sembrarLineaDeBasePrecioYCarta();
    const host = new URL(baseURL ?? "http://localhost:3000").hostname;
    await conSesion.addCookies([{ name: "authjs.session-token", value: d.sessionToken, domain: host, path: "/", httpOnly: true, sameSite: "Lax" }]);
    const admin = await conSesion.newPage();
    const visitante = await sinSesion.newPage();

    /** Abre la ruta y espera a que la pantalla esté: en su ruta (sin redirigir) y con el título visible; recién entonces captura. */
    const abrirYCapturar = async (page: typeof admin, ruta: string, nombre: string, ancho: number, sufijo = ""): Promise<void> => {
      const respuesta = await page.goto(ruta);
      expect(respuesta?.status(), `${ruta} a ${ancho} px: respondió`).toBe(200);
      expect(new URL(page.url()).pathname, `${ruta} a ${ancho} px: se quedó en su ruta`).toBe(ruta);
      await expect(page.locator("h1").first(), `${ruta} a ${ancho} px: el título se ve`).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      // Con `next dev` el portal de Next (la «N» de abajo y el aviso «1 Issue») se dibuja sobre la pantalla y ensucia la captura: se oculta (en producción ese elemento no existe).
      await page.evaluate(() => document.querySelectorAll("nextjs-portal").forEach((el) => ((el as HTMLElement).style.display = "none")));
      await capturar(page, `${nombre}-${ancho}${sufijo}`);
    };

    for (const { ancho, alto } of ANCHOS) {
      await admin.setViewportSize({ width: ancho, height: alto });
      await visitante.setViewportSize({ width: ancho, height: alto });
      await admin.emulateMedia({ colorScheme: "light" });

      for (const p of PANTALLAS_CON_SESION) {
        await abrirYCapturar(admin, typeof p.ruta === "function" ? p.ruta(d) : p.ruta, p.nombre, ancho);
      }
      await abrirYCapturar(visitante, "/login", "login", ancho);

      // El sistema en oscuro (`prefers-color-scheme: dark`): las dos pantallas que más colores usan.
      await admin.emulateMedia({ colorScheme: "dark" });
      for (const p of PANTALLAS_CON_SESION.filter((x) => x.oscuro)) {
        await abrirYCapturar(admin, p.ruta as string, p.nombre, ancho, "-sistema-oscuro");
      }
    }
    llegoAlFinal = true;
  } finally {
    await conSesion.close();
    await sinSesion.close();
    await limpiarLineaDeBasePrecioYCarta();
  }
  // No contamina a los specs que siguen (comparten la base): la limpieza no dejó nada. Solo si llegó al final, para no tapar el error de verdad.
  if (llegoAlFinal) expect(await restosDeLaLineaDeBase(), "restos de la siembra después de limpiar").toEqual([]);
});
