import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "./fixtures/auth";
import { prisma } from "./fixtures/db";
import { expectObjetivosTactiles, expectSinDesborde } from "./fixtures/movil";
import { sembrarGrupo } from "./fixtures/opciones";
import { ajustarCeldasDelAdmin } from "./fixtures/admin-con-filas";

/**
 * El ESPACIO DEL PRODUCTO (Fase 6, DEC-12), paso 2 «Opciones y precio»: la ventana «+ Nuevo grupo» (6.15c), que crea un grupo de la biblioteca, sus opciones y lo que el producto admite de ellas, todo en
 * una ventana y sin salir del producto (`crearGrupoEnElProducto`, una transacción, todo o nada). A 375 y a 1280 px:
 *  - un grupo de precio final con 3 opciones y uno incluido, desde el paso 2, con la lectura del precio, sin desborde, objetivos táctiles (a 375) y axe con la ventana abierta;
 *  - DOBLE CLIC en «Crear grupo»: un solo envío al servidor y UN grupo en la base;
 *  - quién ve el botón: solo quien además de las opciones del producto puede Editar `opciones_definir`; quien no, ve la frase «Los grupos nuevos los crea quien arma las opciones».
 *
 *
 * El paso 4, «En la carta» (6.17c): publicar el producto en la carta de la sucursal sin salir del espacio; quién lo abre y qué ve (las celdas del rol «admin» se ajustan y se devuelven, como en `carta-solo-ver.spec.ts`).
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

/** Un producto de venta disponible acá, con una sección de carta propia y SIN contenido de carta (para publicarlo). */
async function productoParaLaCarta(m: string, sucursalId: string, conContenido = false) {
  const producto = await productoDirecto(m, sucursalId);
  const seccion = await prisma.seccionCarta.create({ data: { nombre: `E2E Sección espacio ${m}`, orden: 901 } });
  if (conContenido) await prisma.contenidoCartaProducto.create({ data: { sucursalId, productoId: producto.id, visibleEnCarta: true, seccionCartaId: seccion.id, descripcion: `Contenido espacio ${m}`, tags: ["Sin TACC"], orden: 1 } });
  return {
    producto,
    seccion,
    limpiar: async () => {
      await prisma.contenidoCartaProducto.deleteMany({ where: { productoId: producto.id } });
      await prisma.seccionCarta.deleteMany({ where: { id: seccion.id } });
      await prisma.disponibilidadProducto.deleteMany({ where: { productoId: producto.id } });
      await prisma.producto.deleteMany({ where: { id: producto.id } });
    },
  };
}

const NOMBRE_DEL_PASO = /^En la carta/;

for (const { ancho, alto } of [
  { ancho: 375, alto: 800 },
  { ancho: 1280, alto: 800 },
]) {
  test(`paso 4 «En la carta» a ${ancho} px: publicar el producto en la carta sin salir del espacio`, async ({ paginaAutenticada: page, sucursalId }) => {
    await page.setViewportSize({ width: ancho, height: alto });
    const m = marca();
    const carta = await productoParaLaCarta(m, sucursalId);
    try {
      // Desde la portada: el paso «En la carta» está en la tira, con su pendiente («Todavía no está en la carta»).
      await page.goto(`/catalogo/productos/${carta.producto.id}`);
      const pasos = page.getByRole("navigation", { name: "Pasos del producto" });
      await expect(pasos.getByRole("link", { name: NOMBRE_DEL_PASO })).toContainText("Pendiente");
      await pasos.getByRole("link", { name: NOMBRE_DEL_PASO }).click();
      await expect(page).toHaveURL(new RegExp(`/catalogo/productos/${carta.producto.id}/en-la-carta$`));
      await expect(page.getByRole("heading", { level: 1 })).toContainText(carta.producto.nombre);
      await expect(page.getByRole("heading", { level: 2, name: /^En la carta de «/ })).toBeVisible();
      await expect(pasos.getByRole("link", { name: NOMBRE_DEL_PASO })).toHaveAttribute("aria-current", "page");

      // La ficha de carta del producto viene abierta: se elige la sección y se guarda.
      const ficha = page.locator(`[data-contenido-carta="${carta.producto.nombre}"]`);
      await expect(ficha.getByLabel(/^Sección de carta/)).toBeVisible();
      await expectSinDesborde(page, `${ancho} px: el paso «En la carta»`);
      expect((await new AxeBuilder({ page }).analyze()).violations, `${ancho} px: el paso «En la carta»`).toEqual([]);
      await ficha.getByLabel(/^Sección de carta/).selectOption({ label: carta.seccion.nombre });
      await ficha.getByRole("button", { name: `Guardar contenido de «${carta.producto.nombre}»` }).click();
      await expect(ficha.getByRole("status")).toHaveText(`Carta: "${carta.producto.nombre}" se muestra.`);

      const contenido = await prisma.contenidoCartaProducto.findUniqueOrThrow({ where: { sucursalId_productoId: { sucursalId, productoId: carta.producto.id } } });
      expect({ visibleEnCarta: contenido.visibleEnCarta, seccionCartaId: contenido.seccionCartaId }).toEqual({ visibleEnCarta: true, seccionCartaId: carta.seccion.id });
      // Sigue en el paso, y la tira ya no lo marca como pendiente.
      await expect(page).toHaveURL(new RegExp(`/catalogo/productos/${carta.producto.id}/en-la-carta$`));
      await expect(pasos.getByRole("link", { name: NOMBRE_DEL_PASO })).not.toContainText("Pendiente");
    } finally {
      await carta.limpiar();
    }
  });
}

test("paso 4 «En la carta»: quien solo VE la carta lo abre en solo lectura, sin campos ni botones; con el Editar de vuelta están los formularios", async ({ paginaAutenticada: page, sucursalId }) => {
  const m = marca();
  const carta = await productoParaLaCarta(m, sucursalId, true);
  const admin = await ajustarCeldasDelAdmin({ carta_ver: { puedeVer: true, puedeEditar: false }, carta_contenido_producto: { puedeVer: true, puedeEditar: false }, carta_producto_descuento: { puedeVer: true, puedeEditar: false } });
  try {
    await page.goto(`/catalogo/productos/${carta.producto.id}/en-la-carta`);
    const main = page.locator("main");
    await expect(page.getByRole("heading", { level: 2, name: /^En la carta de «/ })).toBeVisible();
    await expect(main.locator("[data-aviso-solo-lectura]")).toHaveText("Solo lectura: tu rol no tiene permiso para editar la carta.");
    const ficha = main.locator(`[data-contenido-carta="${carta.producto.nombre}"]`);
    await expect(ficha.locator("[data-solo-lectura]").first()).toContainText(`Contenido espacio ${m}`);
    await expect(ficha.locator("[data-solo-lectura]").first()).toContainText("Sin TACC");
    await expect(main.locator("input, textarea, select"), "no tenía que haber ningún campo editable").toHaveCount(0);
    await expect(main.getByRole("button", { name: /Guardar|Quitar/ }), "no tenía que haber botones de edición").toHaveCount(0);
    expect((await new AxeBuilder({ page }).analyze()).violations, "paso 4 en solo lectura").toEqual([]);

    // Contraespejo: con el Editar de las claves de la carta, los formularios están.
    await admin.cambiar({ carta_contenido_producto: { puedeVer: true, puedeEditar: true }, carta_producto_descuento: { puedeVer: true, puedeEditar: true } });
    await page.goto(`/catalogo/productos/${carta.producto.id}/en-la-carta`);
    await expect(ficha.getByRole("button", { name: `Guardar contenido de «${carta.producto.nombre}»` })).toBeVisible();
    await expect(main.locator("[data-aviso-solo-lectura]")).toHaveCount(0);
  } finally {
    await admin.restaurar();
    await carta.limpiar();
  }
});

test("paso 4 «En la carta»: sin el Ver de la carta no se abre por URL y la tira lo muestra sin enlace", async ({ paginaAutenticada: page, sucursalId }) => {
  const m = marca();
  const carta = await productoParaLaCarta(m, sucursalId);
  const admin = await ajustarCeldasDelAdmin({ carta_ver: { puedeVer: false, puedeEditar: false } });
  try {
    await page.goto(`/catalogo/productos/${carta.producto.id}/en-la-carta`);
    await expect(page.getByText(/No tenés permiso/).first()).toBeVisible();
    await expect(page.locator(`[data-contenido-carta]`), "no tenía que llegar a dibujarse la ficha de carta").toHaveCount(0);
    // En la portada el paso se ve, SIN enlace (ni un camino a «No tenés permiso»), y sin su pendiente (no se leyó la carta).
    await page.goto(`/catalogo/productos/${carta.producto.id}`);
    const pasos = page.getByRole("navigation", { name: "Pasos del producto" });
    const paso = pasos.locator("li", { hasText: "En la carta" });
    await expect(paso).toBeVisible();
    await expect(paso.getByRole("link")).toHaveCount(0);
    await expect(paso, "sin el Ver de la carta no se lee la carta: sin su pendiente").not.toContainText("Pendiente");
  } finally {
    await admin.restaurar();
    await carta.limpiar();
  }
});

test("paso 4 «En la carta»: quien ve la carta pero NO el catálogo lo abre sin el código, el tipo ni cómo se vende, y sin enlaces al Resumen ni a Productos", async ({ paginaAutenticada: page, sucursalId }) => {
  const m = marca();
  const carta = await productoParaLaCarta(m, sucursalId);
  const admin = await ajustarCeldasDelAdmin({ producto_ver_catalogo: { puedeVer: false, puedeEditar: false } });
  try {
    await page.goto(`/catalogo/productos/${carta.producto.id}/en-la-carta`);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(carta.producto.nombre);
    await expect(page.getByRole("heading", { level: 2, name: /^En la carta de «/ })).toBeVisible();
    const main = page.locator("main");
    await expect(main).not.toContainText(`E2E-EP-${m}`);
    await expect(main).not.toContainText("Producto de venta (PV)");
    await expect(main).not.toContainText("Directo");
    await expect(main.getByRole("link", { name: "← Productos" })).toHaveCount(0);
    await expect(page.getByRole("navigation", { name: "Pasos del producto" }).getByRole("link", { name: "Resumen" })).toHaveCount(0);
    // Y la pantalla de la ficha (que no puede ver) sigue negada por su propia guarda.
    await page.goto(`/catalogo/productos/${carta.producto.id}`);
    await expect(page.getByText(/No tenés permiso/).first()).toBeVisible();
  } finally {
    await admin.restaurar();
    await carta.limpiar();
  }
});

test("paso 4 «En la carta»: un id que no existe da 404; una materia prima y un producto que no se vende acá dicen por qué no tienen ficha de carta", async ({ paginaAutenticada: page }) => {
  const m = marca();
  const unidad = await prisma.unidad.findFirstOrThrow({ where: { nombre: "kg" } });
  const mp = await prisma.producto.create({ data: { codigo: `E2E-EP-MP-${m}`, nombre: `E2E Espacio Harina ${m}`, tipo: "MP", unidadStockId: unidad.id } });
  const pvSinDisponibilidad = await prisma.producto.create({ data: { codigo: `E2E-EP-ND-${m}`, nombre: `E2E Espacio No disponible ${m}`, tipo: "PV", unidadStockId: unidad.id, precioVenta: 1500 } });
  try {
    const respuesta = await page.goto("/catalogo/productos/no-existe-este-id/en-la-carta");
    expect(respuesta?.status()).toBe(404);
    await page.goto(`/catalogo/productos/${mp.id}/en-la-carta`);
    await expect(page.getByText(`«${mp.nombre}» no es un producto de venta: solo un producto de venta sale en la carta.`)).toBeVisible();
    await expect(page.locator("[data-contenido-carta]")).toHaveCount(0);
    await page.goto(`/catalogo/productos/${pvSinDisponibilidad.id}/en-la-carta`);
    await expect(page.getByText(/no está disponible en «/)).toBeVisible();
    await expect(page.locator("[data-contenido-carta]")).toHaveCount(0);
  } finally {
    await prisma.producto.deleteMany({ where: { id: { in: [mp.id, pvSinDisponibilidad.id] } } });
  }
});
