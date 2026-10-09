import { test, expect } from "@playwright/test";
import { prismaAdmin } from "../setup/cliente-duenio";
import { activarEmpresaB, crearUsuarioEn, paginaConSesion, suspenderEmpresaB, type EmpresasDeLaPrueba } from "./fixtures/multiempresa";

/**
 * S-26 (plan de endurecimiento de seguridad, tanda T9): una mutación de carta de la empresa A invalida SOLO las cartas de A.
 *
 * El ATAQUE (o, sin atacante, la fuga de una empresa a otra): la página de cada sucursal se cachea 5 minutos (ISR, `revalidate = 300`) y las acciones de carta
 * la invalidaban con `revalidatePath` sobre el patrón `/(carta-publica)/carta-publica/[empresa]/[sucursal]`, que es de TODAS las empresas. Una mutación de A (o
 * un administrador que guarda su tema en un bucle) expulsaba del caché las cartas de todas las demás empresas de la instalación: cada visita anónima a B volvía
 * a pegarle a la base. Un cliente puede así degradar a todos los demás.
 *
 * Se mide en el artefacto REAL (`next build` + `next start`) con DOS empresas activas: las dos cartas se calientan (la segunda visita es `x-nextjs-cache: HIT`),
 * el administrador de A guarda y aplica su tema desde la pantalla, y entonces la carta de A tiene que mostrar el cambio (se invalidó) y la de B seguir siendo HIT.
 */
test.describe.configure({ mode: "serial" });

let e: EmpresasDeLaPrueba;
let sesionA: string;
let slugA: string;
let slugB: string;

test.beforeAll(async () => {
  e = await activarEmpresaB();
  slugA = `cache-a-${e.marca}`;
  slugB = `cache-b-${e.marca}`;
  ({ sessionToken: sesionA } = await crearUsuarioEn(`admin-cache-a-${e.marca}@local.test`, [{ sucursalId: e.a.sucursalId, rolId: e.a.rolAdminId }]));
  await prismaAdmin.sucursalPublica.create({ data: { empresaId: e.a.empresaId, sucursalId: e.a.sucursalId, slug: slugA, publicada: true } });
  await prismaAdmin.sucursalPublica.create({ data: { empresaId: e.b.empresaId, sucursalId: e.b.sucursalId, slug: slugB, publicada: true } });
});

test.afterAll(async () => {
  await prismaAdmin.temaCartaSucursal.deleteMany({ where: { sucursalId: e.a.sucursalId } });
  await prismaAdmin.sucursalPublica.deleteMany({ where: { sucursalId: { in: [e.a.sucursalId, e.b.sucursalId] } } });
  await suspenderEmpresaB(e.b.empresaId);
});

test("guardar y aplicar el tema de A cambia la carta de A al instante y NO saca del caché la carta de B", async ({ request, browser, baseURL }) => {
  const nombre = `Restaurante Cache ${e.marca}`;
  const pedir = async (ruta: string) => {
    const r = await request.get(ruta);
    expect(r.status(), ruta).toBe(200);
    return { cache: r.headers()["x-nextjs-cache"], cuerpo: await r.text() };
  };
  const rutaA = `/carta-publica/${e.a.slug}/${slugA}`;
  const rutaB = `/carta-publica/${e.b.slug}/${slugB}`;

  // Se calientan las dos cartas: la segunda visita de cada una sale del caché.
  await pedir(rutaA);
  await pedir(rutaB);
  expect((await pedir(rutaA)).cache, "la carta de A queda cacheada").toBe("HIT");
  expect((await pedir(rutaB)).cache, "la carta de B queda cacheada").toBe("HIT");
  expect((await pedir(rutaA)).cuerpo).not.toContain(nombre);

  // El administrador de A guarda y aplica su tema.
  const pagina = await paginaConSesion(browser, baseURL, sesionA);
  try {
    await pagina.goto("/carta/tema");
    await pagina.locator('[data-zona-tema="Portada e identidad"]').evaluate((el) => ((el as HTMLDetailsElement).open = true));
    await pagina.locator('[name="restaurante_nombre"]').fill(nombre);
    await pagina.getByRole("button", { name: "Guardar tema" }).click();
    await expect(pagina.getByRole("status").filter({ hasText: "guardado" })).toBeVisible();
    await pagina.getByRole("button", { name: "Aplicar el tema" }).click();
    await expect(pagina.getByRole("status").filter({ hasText: "aplicado" })).toBeVisible();
  } finally {
    await pagina.context().close();
  }

  // La carta de A se invalidó (muestra el cambio) y la de B sigue en el caché.
  expect((await pedir(rutaA)).cuerpo, "la carta de A tiene que mostrar el tema aplicado").toContain(nombre);
  expect((await pedir(rutaB)).cache, "la carta de B no puede salir del caché por una mutación de A").toBe("HIT");
});
