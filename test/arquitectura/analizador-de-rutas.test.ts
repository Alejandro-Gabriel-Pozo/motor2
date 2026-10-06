import { describe, expect, it } from "vitest";
import { analizarCron, analizarLayoutProtegido, analizarPagina } from "./guardas/rutas";

/**
 * Tests del analizador de entradas HTTP (`guardas/rutas.ts`), no del repo real: fuentes en memoria, cada una aislando un caso que tiene
 * que dar un veredicto concreto. Sirven para auditar el analizador sin tocar `src/`.
 */

const IMPORTS_PAGINA = `
  import { obtenerContextoUsuario } from "@/core/auth/contexto";
  import { requierePermisoVer } from "@/core/permisos/gate";
  import { leerCosas } from "@/core/cosas/leer";
`;

const estadoPagina = (fuente: string) => analizarPagina("page.tsx", fuente).estado;

describe("analizarPagina", () => {
  it("la forma estándar (contexto, guarda, corte) es ok", () => {
    const fuente = `${IMPORTS_PAGINA}
      export default async function P() {
        const ctx = await obtenerContextoUsuario();
        if (!ctx) return null;
        const gate = await requierePermisoVer(ctx.usuarioId, ctx.sucursalId, "x", ctx.db);
        if (!gate.ok) return <p>{gate.mensaje}</p>;
        const datos = await leerCosas(ctx.db);
        return <div>{datos}</div>;
      }`;
    expect(estadoPagina(fuente)).toBe("ok");
  });

  it("esperar params/searchParams antes de la guarda no cuenta como lectura", () => {
    const fuente = `${IMPORTS_PAGINA}
      export default async function P({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ a?: string }> }) {
        const { id } = await params;
        const sp = await searchParams;
        const ctx = await obtenerContextoUsuario();
        if (!ctx) return null;
        const gate = await requierePermisoVer(ctx.usuarioId, ctx.sucursalId, "x", ctx.db);
        if (!gate.ok) return null;
        return <div>{id}{sp.a}</div>;
      }`;
    expect(estadoPagina(fuente)).toBe("ok");
  });

  it("una página que lee sin guarda es sin-guarda", () => {
    const fuente = `${IMPORTS_PAGINA}
      export default async function P() {
        const ctx = await obtenerContextoUsuario();
        if (!ctx) return null;
        const datos = await leerCosas(ctx.db);
        return <div>{datos}</div>;
      }`;
    expect(estadoPagina(fuente)).toBe("sin-guarda");
  });

  it("una guarda mencionada solo en un comentario o un string no cuenta", () => {
    const fuente = `${IMPORTS_PAGINA}
      // const gate = await requierePermisoVer(ctx.usuarioId, ctx.sucursalId, "x", ctx.db);
      export default async function P() {
        const ctx = await obtenerContextoUsuario();
        const texto = "await requierePermisoVer(ctx)";
        return <div>{texto}</div>;
      }`;
    expect(estadoPagina(fuente)).toBe("sin-guarda");
  });

  it("una guarda importada de OTRO módulo no cuenta", () => {
    const fuente = `
      import { obtenerContextoUsuario } from "@/core/auth/contexto";
      import { requierePermisoVer } from "@/otro/lugar";
      export default async function P() {
        const ctx = await obtenerContextoUsuario();
        const gate = await requierePermisoVer(ctx.usuarioId, ctx.sucursalId, "x", ctx.db);
        if (!gate.ok) return null;
        return <div />;
      }`;
    expect(estadoPagina(fuente)).toBe("sin-guarda");
  });

  it("leer algo ANTES de la guarda es guarda-tardia", () => {
    const fuente = `${IMPORTS_PAGINA}
      export default async function P() {
        const ctx = await obtenerContextoUsuario();
        if (!ctx) return null;
        const datos = await leerCosas(ctx.db);
        const gate = await requierePermisoVer(ctx.usuarioId, ctx.sucursalId, "x", ctx.db);
        if (!gate.ok) return null;
        return <div>{datos}</div>;
      }`;
    expect(estadoPagina(fuente)).toBe("guarda-tardia");
  });

  it("tocar prisma antes de la guarda (sin await) también es guarda-tardia", () => {
    const fuente = `${IMPORTS_PAGINA}
      import { prisma } from "@/lib/prisma";
      export default async function P() {
        const ctx = await obtenerContextoUsuario();
        const promesa = prisma.cosa.findMany();
        const gate = await requierePermisoVer(ctx.usuarioId, ctx.sucursalId, "x", ctx.db);
        if (!gate.ok) return null;
        return <div>{String(promesa)}</div>;
      }`;
    expect(estadoPagina(fuente)).toBe("guarda-tardia");
  });

  it("una closure declarada antes de la guarda no cuenta como lectura (no corre al renderizar)", () => {
    const fuente = `${IMPORTS_PAGINA}
      export default async function P() {
        const ctx = await obtenerContextoUsuario();
        if (!ctx) return null;
        async function refrescar() { "use server"; await leerCosas(ctx.db); }
        const gate = await requierePermisoVer(ctx.usuarioId, ctx.sucursalId, "x", ctx.db);
        if (!gate.ok) return null;
        return <form action={refrescar} />;
      }`;
    expect(estadoPagina(fuente)).toBe("ok");
  });

  it("una guarda sin await es guarda-descartada", () => {
    const fuente = `${IMPORTS_PAGINA}
      export default async function P() {
        const ctx = await obtenerContextoUsuario();
        const gate = requierePermisoVer(ctx.usuarioId, ctx.sucursalId, "x", ctx.db);
        if (!gate.ok) return null;
        return <div />;
      }`;
    expect(estadoPagina(fuente)).toBe("guarda-descartada");
  });

  it("una guarda cuyo resultado no se guarda es guarda-descartada", () => {
    const fuente = `${IMPORTS_PAGINA}
      export default async function P() {
        const ctx = await obtenerContextoUsuario();
        await requierePermisoVer(ctx.usuarioId, ctx.sucursalId, "x", ctx.db);
        return <div />;
      }`;
    expect(estadoPagina(fuente)).toBe("guarda-descartada");
  });

  it("una guarda sin el corte inmediato (if (!gate.ok) return) es guarda-sin-corte", () => {
    const fuente = `${IMPORTS_PAGINA}
      export default async function P() {
        const ctx = await obtenerContextoUsuario();
        const gate = await requierePermisoVer(ctx.usuarioId, ctx.sucursalId, "x", ctx.db);
        const datos = await leerCosas(ctx.db);
        if (!gate.ok) return null;
        return <div>{datos}</div>;
      }`;
    expect(estadoPagina(fuente)).toBe("guarda-sin-corte");
  });

  it("un corte que no devuelve nada (if (!gate.ok) { log }) es guarda-sin-corte", () => {
    const fuente = `${IMPORTS_PAGINA}
      export default async function P() {
        const ctx = await obtenerContextoUsuario();
        const gate = await requierePermisoVer(ctx.usuarioId, ctx.sucursalId, "x", ctx.db);
        if (!gate.ok) { console.log("sin permiso"); }
        return <div />;
      }`;
    expect(estadoPagina(fuente)).toBe("guarda-sin-corte");
  });

  it("un corte sobre OTRA variable es guarda-sin-corte", () => {
    const fuente = `${IMPORTS_PAGINA}
      export default async function P() {
        const ctx = await obtenerContextoUsuario();
        const gate = await requierePermisoVer(ctx.usuarioId, ctx.sucursalId, "x", ctx.db);
        if (!ctx.ok) return null;
        return <div />;
      }`;
    expect(estadoPagina(fuente)).toBe("guarda-sin-corte");
  });

  it("acepta la guarda de empresa y los nombres de variable propios (gateEditar)", () => {
    const fuente = `
      import { obtenerContextoUsuario } from "@/core/auth/contexto";
      import { requierePermisoDeEmpresa } from "@/core/permisos/gate";
      export default async function P() {
        const ctx = await obtenerContextoUsuario();
        const gateEditar = await requierePermisoDeEmpresa(ctx.usuarioId, "x", ctx.db);
        if (!gateEditar.ok) return null;
        return <div />;
      }`;
    expect(estadoPagina(fuente)).toBe("ok");
  });

  it("resuelve un export default por identificador", () => {
    const fuente = `${IMPORTS_PAGINA}
      async function Pagina() {
        const ctx = await obtenerContextoUsuario();
        const gate = await requierePermisoVer(ctx.usuarioId, ctx.sucursalId, "x", ctx.db);
        if (!gate.ok) return null;
        return <div />;
      }
      export default Pagina;`;
    expect(estadoPagina(fuente)).toBe("ok");
  });

  it("un export default que no se puede resolver (HOC) nunca se saltea: export-no-reconocido", () => {
    const fuente = `${IMPORTS_PAGINA}
      export default envolver(async function P() { return <div />; });`;
    expect(estadoPagina(fuente)).toBe("export-no-reconocido");
  });

  it("una página sin export default se marca", () => {
    expect(estadoPagina(`export const x = 1;`)).toBe("sin-export-por-defecto");
  });
});

const IMPORTS_CRON = `
  import { autorizacionCronValida } from "@/core/auth/secreto-cron";
  import { baseDelContexto } from "@/core/auth/base";
  import { reportarErrorUnaVez } from "@/lib/reportar-error";
  import { sincronizar } from "@/core/algo";
`;

describe("analizarCron", () => {
  it("rechazar sin secreto antes de usar la base es ok (incluso con el aviso de mala configuración antes)", () => {
    const fuente = `${IMPORTS_CRON}
      export async function GET(request: Request): Promise<Response> {
        const auth = request.headers.get("authorization");
        if (!process.env.CRON_SECRET) await reportarErrorUnaVez("x", new Error("sin secreto"), "cron");
        if (!autorizacionCronValida(auth, process.env.CRON_SECRET)) {
          return Response.json({ error: "No autorizado" }, { status: 401 });
        }
        return Response.json(await sincronizar(baseDelContexto().db));
      }`;
    expect(analizarCron("route.ts", fuente).estado).toBe("ok");
  });

  it("un cron sin la validación es sin-guarda", () => {
    const fuente = `${IMPORTS_CRON}
      export async function GET(): Promise<Response> {
        return Response.json(await sincronizar(baseDelContexto().db));
      }`;
    expect(analizarCron("route.ts", fuente).estado).toBe("sin-guarda");
  });

  it("validar el secreto pero sin cortar es sin-guarda", () => {
    const fuente = `${IMPORTS_CRON}
      export async function GET(request: Request): Promise<Response> {
        if (!autorizacionCronValida(request.headers.get("authorization"), process.env.CRON_SECRET)) {
          console.log("no autorizado");
        }
        return Response.json(await sincronizar(baseDelContexto().db));
      }`;
    expect(analizarCron("route.ts", fuente).estado).toBe("sin-guarda");
  });

  it("usar la base antes de validar el secreto es guarda-tardia", () => {
    const fuente = `${IMPORTS_CRON}
      export async function GET(request: Request): Promise<Response> {
        const base = baseDelContexto().db;
        if (!autorizacionCronValida(request.headers.get("authorization"), process.env.CRON_SECRET)) {
          return Response.json({ error: "No autorizado" }, { status: 401 });
        }
        return Response.json(await sincronizar(base));
      }`;
    expect(analizarCron("route.ts", fuente).estado).toBe("guarda-tardia");
  });

  it("cualquier otro await antes del secreto es guarda-tardia", () => {
    const fuente = `${IMPORTS_CRON}
      export async function GET(request: Request): Promise<Response> {
        const cuerpo = await request.text();
        if (!autorizacionCronValida(request.headers.get("authorization"), process.env.CRON_SECRET)) return new Response(cuerpo, { status: 401 });
        return Response.json({});
      }`;
    expect(analizarCron("route.ts", fuente).estado).toBe("guarda-tardia");
  });

  it("revisa TODOS los métodos HTTP: un POST sin guarda al lado de un GET con guarda es sin-guarda", () => {
    const fuente = `${IMPORTS_CRON}
      export async function GET(request: Request): Promise<Response> {
        if (!autorizacionCronValida(request.headers.get("authorization"), process.env.CRON_SECRET)) return new Response("no", { status: 401 });
        return Response.json({});
      }
      export async function POST(): Promise<Response> {
        return Response.json(await sincronizar(baseDelContexto().db));
      }`;
    const r = analizarCron("route.ts", fuente);
    expect(r.estado).toBe("sin-guarda");
    expect(r.metodos.map((m) => `${m.nombre}:${m.estado}`)).toEqual(["GET:ok", "POST:sin-guarda"]);
  });

  it("un método exportado como arrow function también se analiza", () => {
    const fuente = `${IMPORTS_CRON}
      export const GET = async (request: Request): Promise<Response> => {
        if (!autorizacionCronValida(request.headers.get("authorization"), process.env.CRON_SECRET)) return new Response("no", { status: 401 });
        return Response.json({});
      };`;
    expect(analizarCron("route.ts", fuente).estado).toBe("ok");
  });

  it("un método que no se puede resolver (reexport, handler envuelto) nunca se saltea: export-no-reconocido", () => {
    expect(analizarCron("route.ts", `export { GET } from "./otro";`).estado).toBe("export-no-reconocido");
    expect(analizarCron("route.ts", `export const GET = envolver(async () => Response.json({}));`).estado).toBe("export-no-reconocido");
    expect(analizarCron("route.ts", `export const { GET, POST } = handlers;`).estado).toBe("export-no-reconocido");
  });

  it("un route.ts sin métodos HTTP se marca sin-metodos; las constantes de configuración se ignoran", () => {
    expect(analizarCron("route.ts", `export const dynamic = "force-dynamic";`).estado).toBe("sin-metodos");
  });

  it("la validación importada de otro módulo no cuenta", () => {
    const fuente = `
      import { autorizacionCronValida } from "@/otro/lugar";
      export async function GET(request: Request): Promise<Response> {
        if (!autorizacionCronValida(request.headers.get("authorization"), process.env.CRON_SECRET)) return new Response("no", { status: 401 });
        return Response.json({});
      }`;
    expect(analizarCron("route.ts", fuente).estado).toBe("sin-guarda");
  });
});

const IMPORTS_LAYOUT = `
  import { obtenerContextoUsuario } from "@/core/auth/contexto";
  import { irAlLogin } from "@/core/auth/ir-al-login";
`;

describe("analizarLayoutProtegido", () => {
  it("contexto + irAlLogin sin contexto es ok", () => {
    const fuente = `${IMPORTS_LAYOUT}
      export default async function L({ children }: { children: React.ReactNode }) {
        const ctx = await obtenerContextoUsuario();
        if (!ctx) return irAlLogin();
        return <Shell ctx={ctx}>{children}</Shell>;
      }`;
    expect(analizarLayoutProtegido("layout.tsx", fuente)).toBe("ok");
  });

  it("un layout que no pide el contexto es sin-contexto", () => {
    expect(analizarLayoutProtegido("layout.tsx", `export default function L({ children }: { children: React.ReactNode }) { return <div>{children}</div>; }`)).toBe("sin-contexto");
  });

  it("pedir el contexto y no cortar cuando falta es sin-corte", () => {
    const fuente = `${IMPORTS_LAYOUT}
      export default async function L({ children }: { children: React.ReactNode }) {
        const ctx = await obtenerContextoUsuario();
        return <Shell ctx={ctx}>{children}</Shell>;
      }`;
    expect(analizarLayoutProtegido("layout.tsx", fuente)).toBe("sin-corte");
  });

  it("cortar con algo que no redirige al login es sin-corte", () => {
    const fuente = `${IMPORTS_LAYOUT}
      export default async function L({ children }: { children: React.ReactNode }) {
        const ctx = await obtenerContextoUsuario();
        if (!ctx) return null;
        return <Shell ctx={ctx}>{children}</Shell>;
      }`;
    expect(analizarLayoutProtegido("layout.tsx", fuente)).toBe("sin-corte");
  });
});
