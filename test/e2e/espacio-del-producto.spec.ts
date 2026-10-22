import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "./fixtures/auth";
import { prisma } from "./fixtures/db";
import { expectObjetivosTactiles, expectSinDesborde } from "./fixtures/movil";
import { sembrarGrupo } from "./fixtures/opciones";

/**
 * El ESPACIO DEL PRODUCTO (Fase 6, DEC-12), paso 2 «Opciones y precio»: la ventana «+ Nuevo grupo» (6.15c), que crea un grupo de la biblioteca, sus opciones y lo que el producto admite de ellas, todo en
 * una ventana y sin salir del producto (`crearGrupoEnElProducto`, una transacción, todo o nada). A 375 y a 1280 px:
 *  - un grupo de precio final con 3 opciones y uno incluido, desde el paso 2, con la lectura del precio, sin desborde, objetivos táctiles (a 375) y axe con la ventana abierta;
 *  - DOBLE CLIC en «Crear grupo»: un solo envío al servidor y UN grupo en la base;
 *  - quién ve el botón: solo quien además de las opciones del producto puede Editar `opciones_definir`; quien no, ve la frase «Los grupos nuevos los crea quien arma las opciones».
 * Lo sembrado de opciones no se borra (ver `fixtures/opciones.ts`): nombres con marca propia.
 */

const marca = () => `${Date.now()}-${Math.floor(Math.random() * 1e4)}`;

async function productoDirecto(m: string, sucursalId: string) {
  const unidad = await prisma.unidad.findFirstOrThrow({ where: { nombre: "unidad" } });
  const p = await prisma.producto.create({ data: { codigo: `E2E-EP-${m}`, nombre: `E2E Espacio Milanesa ${m}`, tipo: "PV", unidadStockId: unidad.id, precioVenta: 18000 } });
  await prisma.disponibilidadProducto.create({ data: { sucursalId, productoId: p.id, disponible: true } });
  return p;
}

for (const { ancho, alto } of [
  { ancho: 375, alto: 800 },
  { ancho: 1280, alto: 800 },
]) {
  test.describe(`paso 2 «Opciones y precio» a ${ancho} px`, () => {
    test.beforeEach(async ({ paginaAutenticada: page }) => {
      await page.setViewportSize({ width: ancho, height: alto });
    });

    test("«+ Nuevo grupo»: un grupo de precio final con 3 opciones y uno incluido, sin salir del producto", async ({ paginaAutenticada: page, sucursalId }) => {
      const m = marca();
      const producto = await productoDirecto(m, sucursalId);
      const tamano = `E2E Tamaño espacio ${m}`;
      const incluida = `E2E Incluida espacio ${m}`;
      const precios: [string, string][] = [
        ["Simple", "18000"],
        ["Napolitana", "22000"],
        ["Especial", "25000"],
      ];

      await page.goto(`/catalogo/productos/${producto.id}/opciones`);
      await expect(page.getByRole("heading", { level: 2, name: "Opciones y precio" })).toBeVisible();

      // 1) El grupo de precio final: nombre, «Cada opción define el precio final», tres opciones con su precio.
      await page.getByRole("button", { name: "+ Nuevo grupo", exact: true }).click();
      const ventana = page.getByRole("dialog", { name: `Nuevo grupo para «${producto.nombre}»` });
      await expect(ventana.getByLabel(/^Nombre del grupo/)).toBeFocused();
      await ventana.getByLabel(/^Nombre del grupo/).fill(tamano);
      // Las opciones son tarjetas: la etiqueta cubre toda la tarjeta, así que se toca el texto (un `check()` sobre el radio choca con esa cobertura).
      await ventana.getByText("Cada opción define el precio final", { exact: true }).click();
      await expect(ventana.getByRole("radio", { name: "Cada opción define el precio final" })).toBeChecked();
      for (const [i, [nombre, precio]] of precios.entries()) {
        await ventana.getByLabel(`Nombre de la opción ${i + 1}`).fill(nombre);
        await ventana.getByLabel(`Precio final de la opción ${i + 1}`).fill(precio);
      }
      await expect(ventana).toContainText(/Napolitana = \$\s*22\.000/);
      await expectSinDesborde(page, `${ancho} px: la ventana «+ Nuevo grupo» llena`);
      if (ancho < 768) {
        await expectObjetivosTactiles(ventana.getByRole("button"), `${ancho} px: los botones de la ventana`);
        await expectObjetivosTactiles(ventana.getByRole("textbox"), `${ancho} px: los campos de la ventana`);
      }
      expect((await new AxeBuilder({ page }).analyze()).violations, `${ancho} px: la ventana «+ Nuevo grupo» abierta`).toEqual([]);
      await ventana.getByRole("button", { name: "Crear grupo", exact: true }).click();
      await expect(ventana).toBeHidden();
      await expect(page.getByRole("status").filter({ hasText: `«${tamano}» se agregó` })).toBeVisible();
      await expect(page.locator(`[data-admision-grupo='${tamano}']`)).toBeVisible();
      await expect(page.locator("[data-resumen-de-opciones]")).toContainText("Simple $ 18.000 · Napolitana $ 22.000 · Especial $ 25.000");

      const grupo = await prisma.grupoDeOpciones.findFirstOrThrow({ where: { nombre: tamano }, include: { opciones: true } });
      expect(grupo.tipo).toBe("MEDIDA");
      expect(grupo.opciones.map((o) => o.nombre).sort()).toEqual(["Especial", "Napolitana", "Simple"]);
      const admision = await prisma.productoAdmiteGrupo.findFirstOrThrow({ where: { productoId: producto.id, grupoId: grupo.id } });
      expect({ modoPrecio: admision.modoPrecio, activo: admision.activo }).toEqual({ modoPrecio: "ABSOLUTO", activo: true });
      const admitidas = await prisma.productoAdmiteOpcion.findMany({ where: { productoId: producto.id, opcion: { grupoId: grupo.id } }, select: { precioAbsoluto: true, opcion: { select: { nombre: true } } } });
      expect(admitidas.map((a) => [a.opcion.nombre, Number(a.precioAbsoluto)]).sort()).toEqual(precios.map(([n, p]) => [n, Number(p)]).sort());

      // 2) El grupo incluido: una opción, sin importe.
      await page.getByRole("button", { name: "+ Nuevo grupo", exact: true }).click();
      await ventana.getByLabel(/^Nombre del grupo/).fill(incluida);
      await ventana.getByText("No, va incluido", { exact: true }).click();
      await ventana.getByLabel("Nombre de la opción 1").fill("Con papas fritas");
      await expect(ventana.getByLabel(/^Precio final de la opción/)).toHaveCount(0);
      expect((await new AxeBuilder({ page }).analyze()).violations, `${ancho} px: la ventana con un grupo incluido`).toEqual([]);
      await ventana.getByRole("button", { name: "Crear grupo", exact: true }).click();
      await expect(ventana).toBeHidden();
      await expect(page.locator(`[data-admision-grupo='${incluida}']`)).toBeVisible();
      const grupoIncluido = await prisma.grupoDeOpciones.findFirstOrThrow({ where: { nombre: incluida }, include: { opciones: true } });
      expect({ tipo: grupoIncluido.tipo, opciones: grupoIncluido.opciones.map((o) => o.nombre) }).toEqual({ tipo: "INCLUIDA", opciones: ["Con papas fritas"] });
      expect(await prisma.productoAdmiteGrupo.count({ where: { productoId: producto.id, activo: true } })).toBe(2);
      await expectSinDesborde(page, `${ancho} px: el paso 2 con los dos grupos`);
    });

    test("doble clic en «Crear grupo»: un solo envío al servidor y UN grupo en la base", async ({ paginaAutenticada: page, sucursalId }) => {
      const m = marca();
      const producto = await productoDirecto(m, sucursalId);
      const nombre = `E2E Doble clic espacio ${m}`;
      await page.goto(`/catalogo/productos/${producto.id}/opciones`);
      await page.getByRole("button", { name: "+ Nuevo grupo", exact: true }).click();
      const ventana = page.getByRole("dialog", { name: `Nuevo grupo para «${producto.nombre}»` });
      await ventana.getByLabel(/^Nombre del grupo/).fill(nombre);
      await ventana.getByText("No, va incluido", { exact: true }).click();
      await ventana.getByLabel("Nombre de la opción 1").fill("Con huevo");

      const envios: string[] = [];
      page.on("request", (r) => {
        if (r.method() === "POST") envios.push(r.url());
      });
      await ventana.getByRole("button", { name: "Crear grupo", exact: true }).dblclick();
      await expect(page.locator(`[data-admision-grupo='${nombre}']`)).toBeVisible();
      expect(envios, "el segundo clic no manda otro envío").toHaveLength(1);
      expect(await prisma.grupoDeOpciones.count({ where: { nombre } }), "en la base queda UN grupo").toBe(1);
      expect(await prisma.productoAdmiteGrupo.count({ where: { productoId: producto.id } })).toBe(1);
    });
  });
}

/**
 * `opciones_definir` y `producto_opciones_admitidas` tienen piso administrador: solo el rol «admin» llega a las dos (un rol armado a mano es operario y no pasa de la primera pantalla). Para tener a alguien que
 * puede Editar las opciones del producto y NO puede definir grupos, se le saca el «Editar» de `opciones_definir` a ESE rol durante el test y se le devuelve al final (los specs corren de a uno, `workers: 1`;
 * y la sesión del admin de cada test lo vuelve a dejar en verdadero, `fixtures/auth.ts`). Mismo recurso que `opciones-factor-lectura.spec.ts`.
 */
test("«+ Nuevo grupo» es de quien además puede Editar `opciones_definir`: sin esa clave no se dibuja y se dice quién crea los grupos", async ({ paginaAutenticada: page, sucursalId }) => {
  const m = marca();
  const producto = await productoDirecto(m, sucursalId);
  await sembrarGrupo({ nombre: `E2E Grupo ya hecho ${m}`, tipo: "VARIANTE", cantidadMinima: 0, cantidadMaxima: 1, marca: m, opciones: [{ nombre: "Con queso", monto: 500 }] });
  const admin = await prisma.rol.findFirstOrThrow({ where: { clave: "admin" }, select: { id: true } });
  const clave = { rolId_accionClave: { rolId: admin.id, accionClave: "opciones_definir" } };
  const antes = await prisma.permisoRol.findUniqueOrThrow({ where: clave, select: { puedeVer: true, puedeEditar: true } });
  const nuevoGrupo = page.getByRole("button", { name: "+ Nuevo grupo", exact: true });
  const frase = page.getByText("Los grupos nuevos los crea quien arma las opciones.");
  try {
    // Sin el «Editar» de `opciones_definir`: ve el paso 2 y puede sumar un grupo que ya existe, pero no crear uno.
    await prisma.permisoRol.update({ where: clave, data: { puedeVer: true, puedeEditar: false } });
    await page.goto(`/catalogo/productos/${producto.id}/opciones`);
    await expect(page.getByRole("heading", { level: 2, name: "Opciones y precio" })).toBeVisible();
    await expect(nuevoGrupo).toHaveCount(0);
    await expect(frase).toBeVisible();
    await expect(page.getByRole("button", { name: "Agregar un grupo existente", exact: true })).toBeVisible();

    // Contraespejo: con el «Editar» de vuelta, el botón está y la frase no.
    await prisma.permisoRol.update({ where: clave, data: antes });
    await page.goto(`/catalogo/productos/${producto.id}/opciones`);
    await expect(page.getByRole("heading", { level: 2, name: "Opciones y precio" })).toBeVisible();
    await expect(nuevoGrupo).toBeVisible();
    await expect(frase).toHaveCount(0);
  } finally {
    await prisma.permisoRol.update({ where: clave, data: antes });
  }
});
