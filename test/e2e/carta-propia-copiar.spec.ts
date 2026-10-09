import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "./fixtures/auth";
import { prisma } from "./fixtures/db";
import { crearMembresia } from "../setup/membresia";

/**
 * Carta PROPIA de cada sucursal (ADR-009, C3/C4), en un navegador real: la sucursal activa sin carta propia ve «Tu sucursal no tiene carta propia
 * todavía» con «Armar carta» y «Copiar de otra sucursal»; el estado (cerrado y con la confirmación abierta) no tiene violaciones de axe; copiar
 * exige confirmar y deja la carta de la otra sucursal intacta.
 */
test("carta propia: el estado vacío ofrece armar o copiar, es accesible y la copia pide confirmación", async ({ paginaAutenticada: page, sucursalId }) => {
  const marca = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const unidad = await prisma.unidad.findFirstOrThrow({ where: { nombre: "unidad" } });
  const propias = await Promise.all([
    prisma.contenidoCartaProducto.count({ where: { sucursalId } }),
    prisma.generoCarta.count({ where: { sucursalId } }),
    prisma.itemAgrupadoCarta.count({ where: { sucursalId } }),
  ]);
  expect(propias, "la sucursal del e2e arranca sin carta propia (cada spec limpia lo suyo)").toEqual([0, 0, 0]);

  const origen = await prisma.sucursal.create({ data: { nombre: `E2E Carta Origen ${marca}` } });
  // S-07 (O.56): copiar y ofrecer un origen exigen membresía y «Ver» de la carta ALLÁ. El administrador del e2e también lo es de la sucursal de origen
  // (la activa sigue siendo Central, su membresía más antigua).
  const admin = await prisma.user.findUniqueOrThrow({ where: { email: "e2e-admin@local.test" } });
  const rolAdmin = await prisma.rol.findFirstOrThrow({ where: { clave: "admin" } });
  await crearMembresia({ usuarioId: admin.id, sucursalId: origen.id, rolId: rolAdmin.id });
  const seccion = await prisma.seccionCarta.create({ data: { nombre: `E2E Copia Sección ${marca}`, orden: 60 } });
  const producto = await prisma.producto.create({ data: { codigo: `E2E_COPIA_${marca}`, nombre: `E2E Copia Plato ${marca}`, tipo: "PV", precioVenta: 1000, unidadStockId: unidad.id } });
  await prisma.disponibilidadProducto.createMany({
    data: [sucursalId, origen.id].map((id) => ({ sucursalId: id, productoId: producto.id, disponible: true })),
  });
  const genero = await prisma.generoCarta.create({ data: { sucursalId: origen.id, nombre: `E2E Copia Género ${marca}`, orden: 0 } });
  await prisma.contenidoCartaProducto.create({
    data: { sucursalId: origen.id, productoId: producto.id, visibleEnCarta: true, seccionCartaId: seccion.id, orden: 4, generoCartaId: genero.id },
  });

  try {
    await page.goto("/carta");
    const aviso = page.locator("[data-carta-vacia]");
    await expect(aviso.getByRole("heading", { name: "Tu sucursal no tiene carta propia todavía" })).toBeVisible();
    await expect(aviso.getByRole("link", { name: "Armar carta" })).toBeVisible();
    await expect(aviso.getByLabel("Copiar de otra sucursal")).toHaveValue(origen.id);
    expect((await new AxeBuilder({ page }).analyze()).violations, "estado vacío").toEqual([]);

    // Pide confirmación: abrirla no copia nada.
    await aviso.getByRole("button", { name: "Copiar la carta" }).click();
    await expect(aviso.getByRole("alert")).toContainText(`¿Copiar la carta de «${origen.nombre}» a esta sucursal?`);
    await expect(aviso.getByRole("button", { name: "Volver" })).toBeFocused();
    expect((await new AxeBuilder({ page }).analyze()).violations, "confirmación abierta").toEqual([]);
    expect(await prisma.contenidoCartaProducto.count({ where: { sucursalId } })).toBe(0);

    // Volver cancela; confirmar copia.
    await aviso.getByRole("button", { name: "Volver" }).click();
    await expect(aviso.getByRole("button", { name: "Copiar la carta" })).toBeVisible();
    expect(await prisma.contenidoCartaProducto.count({ where: { sucursalId } })).toBe(0);
    await aviso.getByRole("button", { name: "Copiar la carta" }).click();
    await aviso.getByRole("button", { name: "Sí, copiar la carta" }).click();

    await expect(page.getByRole("heading", { name: "Tu sucursal no tiene carta propia todavía" })).toBeHidden();
    const copiado = await prisma.contenidoCartaProducto.findFirstOrThrow({ where: { sucursalId, productoId: producto.id } });
    expect(copiado).toMatchObject({ visibleEnCarta: true, seccionCartaId: seccion.id, orden: 4 });
    const generoCopiado = await prisma.generoCarta.findFirstOrThrow({ where: { sucursalId, nombre: genero.nombre } });
    expect(generoCopiado.id).not.toBe(genero.id);
    expect(copiado.generoCartaId).toBe(generoCopiado.id);
    // La carta de la sucursal de origen queda igual.
    expect(await prisma.contenidoCartaProducto.count({ where: { sucursalId: origen.id } })).toBe(1);
    expect(await prisma.generoCarta.count({ where: { sucursalId: origen.id } })).toBe(1);
  } finally {
    await prisma.contenidoCartaProducto.deleteMany({ where: { productoId: producto.id } });
    await prisma.generoCarta.deleteMany({ where: { sucursalId: { in: [sucursalId, origen.id] }, nombre: genero.nombre } });
    await prisma.seccionCarta.deleteMany({ where: { id: seccion.id } });
    await prisma.disponibilidadProducto.deleteMany({ where: { productoId: producto.id } });
    await prisma.producto.deleteMany({ where: { id: producto.id } });
    await prisma.usuarioSucursal.deleteMany({ where: { sucursalId: origen.id } });
    await prisma.sucursal.deleteMany({ where: { id: origen.id } });
  }
});
