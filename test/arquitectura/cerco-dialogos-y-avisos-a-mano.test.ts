import ts from "typescript";
import { describe, expect, it } from "vitest";
import { arbolDe, medirPorArchivo, type Cerco } from "./cercos/trinquete";
import { probarCerco } from "./cercos/probar-cerco";

/**
 * Cerco «diálogos y avisos a mano» (ola «precio y carta», Fase 1; inventario de pantallas y primitivas §2: «Aviso está disperso»). Cuenta,
 * con el AST y fuera de `src/ui/` (en `src/` y `plataforma/src/`), cada valor de un atributo `role` de JSX que arma a mano un diálogo o un
 * aviso: `role="dialog"`, `role="alertdialog"`, `role="alert"` y `role="status"` — también dentro de una expresión
 * (`role={ok ? "status" : "alert"}` cuenta un `status` y un `alert`) —, y cada `<dialog>` nativo (`dialog-nativo`).
 * La primitiva (`ui/componentes/superposiciones/dialogo.tsx`) está en `src/ui/`; los componentes compartidos que hoy hacen de primitiva
 * de aviso o de diálogo se exceptúan por ruta y con motivo, hasta que la Fase 6 los lleve a `src/ui/` (Aviso, Diálogo).
 * Meta: bajar a medida que las pantallas usan las primitivas.
 *
 * Mecanismo, regeneración (`BAJAR_CERCOS=1`) y excepciones: `test/arquitectura/cercos/trinquete.ts`.
 */
const ROLES = new Set(["dialog", "alertdialog", "alert", "status"]);

function literalesDe(nodo: ts.Node): string[] {
  if (ts.isStringLiteral(nodo) || ts.isNoSubstitutionTemplateLiteral(nodo)) return [nodo.text];
  const salida: string[] = [];
  ts.forEachChild(nodo, (hijo) => {
    salida.push(...literalesDe(hijo));
  });
  return salida;
}

function contarDialogosYAvisos(fuente: string, ruta: string): Record<string, number> {
  const cuenta: Record<string, number> = { "role-dialog": 0, "role-alertdialog": 0, "role-alert": 0, "role-status": 0, "dialog-nativo": 0 };
  const visitar = (nodo: ts.Node): void => {
    if (ts.isJsxAttribute(nodo) && nodo.name.getText() === "role" && nodo.initializer) {
      for (const valor of literalesDe(nodo.initializer)) if (ROLES.has(valor)) cuenta[`role-${valor}`]++;
    }
    if ((ts.isJsxOpeningElement(nodo) || ts.isJsxSelfClosingElement(nodo)) && ts.isIdentifier(nodo.tagName) && nodo.tagName.text === "dialog") cuenta["dialog-nativo"]++;
    ts.forEachChild(nodo, visitar);
  };
  visitar(arbolDe(fuente, ruta));
  return cuenta;
}

const COMPARTIDO = "Componente compartido que hoy hace de primitiva";

const CERCO_DIALOGOS_Y_AVISOS: Cerco = {
  regla: "dialogos-y-avisos-a-mano",
  meta: "bajar hacia 0 en la Fase 6: diálogos y avisos salen de las primitivas de src/ui (Dialogo, Aviso)",
  medir: medirPorArchivo({ raices: ["src", "plataforma/src"], extensiones: [".tsx", ".jsx"], incluir: (ruta) => !ruta.startsWith("src/ui/"), contar: contarDialogosYAvisos }),
  excepciones: [
    { ruta: "src/components/avisos-de-accion.tsx", motivo: `${COMPARTIDO} de aviso: el aviso del resultado de una acción que reusan las pantallas (pasa a src/ui como Aviso en la Fase 6).` },
    { ruta: "src/components/aviso-con-deshacer.tsx", motivo: `${COMPARTIDO} de aviso: el aviso flotante con «deshacer» que reusan las pantallas (pasa a src/ui como Aviso en la Fase 6).` },
    { ruta: "src/components/menu-celular.tsx", motivo: `${COMPARTIDO} de diálogo: el cajón del menú en celular, sobre el <dialog> nativo con el mismo criterio que ui/…/dialogo.tsx.` },
  ],
};

describe("cerco «diálogos y avisos a mano»: el detector", () => {
  it("cuenta los roles de diálogo y de aviso (también en una expresión) y el <dialog> nativo", () => {
    const fuente = [
      "export const F = ({ ok }: { ok: boolean }) => (",
      "  <>",
      '    <div role="dialog" aria-modal="true" />',
      '    <p role={ok ? "status" : "alert"}>x</p>',
      '    <p role="alert">y</p>',
      "    <dialog open>z</dialog>",
      '    <nav role="navigation" />',
      '    <p role={ok ? "status" : undefined}>w</p>',
      "  </>",
      ");",
    ].join("\n");
    expect(contarDialogosYAvisos(fuente, "x.tsx")).toEqual({ "role-dialog": 1, "role-alertdialog": 0, "role-alert": 2, "role-status": 2, "dialog-nativo": 1 });
  });

  it("no cuenta la primitiva (<Dialogo>), un comentario ni un texto", () => {
    const fuente = 'export const F = () => <><Dialogo abierto />{/* role="alert" */}<p>role="status"</p></>;';
    expect(contarDialogosYAvisos(fuente, "x.tsx")).toEqual({ "role-dialog": 0, "role-alertdialog": 0, "role-alert": 0, "role-status": 0, "dialog-nativo": 0 });
  });
});

probarCerco(CERCO_DIALOGOS_Y_AVISOS);
