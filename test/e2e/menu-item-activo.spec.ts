import { test, expect } from "./fixtures/auth";

/**
 * El menú resalta UN solo ítem: el de la pantalla abierta. Antes quedaban dos (el ítem y el que era prefijo de su ruta) en
 * /carta/tema, /traspasos/enviar y /reportes/rendimiento-recetas/por-sucursal, y ninguno llevaba `aria-current`.
 */
const CASOS = [
  { ruta: "/carta/tema", nombre: "Tema de la carta" },
  { ruta: "/traspasos/enviar", nombre: "Enviar directo" },
  { ruta: "/reportes/rendimiento-recetas/por-sucursal", nombre: "Rendimiento por sucursal" },
  // Fase 7: los procesos del selector y Reclasificar no tienen ítem propio; resaltan la entrada «Registrar movimiento».
  { ruta: "/movimientos", nombre: "Registrar movimiento" },
  { ruta: "/movimientos/ajuste", nombre: "Registrar movimiento" },
  { ruta: "/movimientos/devolucion-proveedor", nombre: "Registrar movimiento" },
  { ruta: "/stock/reclasificar", nombre: "Registrar movimiento" },
  // Los directos y las entradas mudadas siguen resaltándose a sí mismas.
  { ruta: "/movimientos/merma", nombre: "Merma" },
  { ruta: "/movimientos/venta", nombre: "Carga de ventas sin ticket" },
  // DEC-27: Stock tiene dos entradas; sus pestañas y editores resaltan la entrada (Depósitos, aunque su URL empiece con /movimientos, resalta Configuración).
  { ruta: "/stock/consolidado", nombre: "Existencias" },
  { ruta: "/stock/alertas", nombre: "Existencias" },
  { ruta: "/stock/configuracion", nombre: "Configuración" },
  { ruta: "/stock/minimo", nombre: "Configuración" },
  { ruta: "/movimientos/secciones", nombre: "Configuración" },
];

for (const { ruta, nombre } of CASOS) {
  test(`menú: en ${ruta} hay un solo ítem activo y es «${nombre}»`, async ({ paginaAutenticada: page }) => {
    await page.goto(ruta);
    // Solo el menú: las filas de pestañas («Qué movimiento registrar», «Qué configurar»: otra `nav`, dentro de la pantalla) también marcan su pestaña actual.
    const activos = page.locator('aside nav a[aria-current="page"]');
    await expect(activos).toHaveCount(1);
    await expect(activos).toHaveText(nombre);
  });
}
