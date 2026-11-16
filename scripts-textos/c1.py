# Lote C1: primitiva `entidad` + molde «No se encontró {entidad}.» + 9 casos de uso de auth. Correr en la raíz del repo, sobre la rama del lote A. Uso: python3 c1.py DEC-NNNN
import re,json,sys
DEC=sys.argv[1]
base="src/server/actions/auth/casos-de-uso/"
sitios={
 "actualizar-activo-membresia.ts":[('textoDe("rechazo.MEMBRESIA_NO_ENCONTRADA")',"membresia")],
 "actualizar-notas-membresia.ts":[('textoDe("rechazo.MEMBRESIA_NO_ENCONTRADA")',"membresia")],
 "invitar-a-vincular.ts":[('textoDe("rechazo.MEMBRESIA_NO_ENCONTRADA")',"membresia")],
 "actualizar-activo-sucursal.ts":[('textoDe("rechazo.SUCURSAL_NO_ENCONTRADA")',"sucursal")],
 "renombrar-sucursal.ts":[('textoDe("rechazo.SUCURSAL_NO_ENCONTRADA")',"sucursal")],
 "actualizar-activo-usuario-en-empresa.ts":[('"No se encontró ese usuario."',"usuario")],
 "invitacion-gestionable.ts":[('"No se encontró esa invitación pendiente."',"invitacion_pendiente")],
 "invitaciones-de-usuario-en-tx.ts":[('"No se encontró esa invitación pendiente."',"invitacion_pendiente")],
 "revocar-invitacion.ts":[('"No se encontró esa invitación pendiente."',"invitacion_pendiente")],
}
usos={}
for a,lst in sitios.items():
    p=base+a; s=open(p).read(); n=0
    for buscar,ent in lst:
        nuevo=f'textoDe("rechazo.NO_ENCONTRADO", {{ entidad: ENTIDADES.{ent} }})'
        n+=s.count(buscar); s=s.replace(buscar,nuevo)
    assert n>0,a
    if 'from "@/core/textos/texto-de"' not in s:
        L=s.split("\n"); k=max(i for i,l in enumerate(L) if l.startswith("import ") and l.rstrip().endswith(";")); L.insert(k+1,'import { textoDe } from "@/core/textos/texto-de";'); s="\n".join(L)
    L=s.split("\n"); k=max(i for i,l in enumerate(L) if 'from "@/core/textos/texto-de"' in l); L.insert(k+1,'import { ENTIDADES } from "@/core/textos/entidades";'); s="\n".join(L)
    open(p,"w").write(s)
    ls=s.split("\n"); nombres=set()
    for i,l in enumerate(ls):
        if "rechazo.NO_ENCONTRADO" in l and not l.startswith(" *") and "import" not in l:
            for j in range(i,-1,-1):
                m=re.match(r"export (?:async )?function (\w+)|export const (\w+)",ls[j])
                if m: nombres.add(m.group(1) or m.group(2)); break
    usos[a]=sorted(nombres)
json.dump(usos,open("/tmp/usos-c1.json","w"))
p="src/core/textos/tipos.ts"; s=open(p).read()
s=s.replace(' * Los tipos `numero`, `dinero` y `entidad` del diseño entran con la primera entrada real que los pida (hoy ninguna).',' *  - `entidad`: una cosa del negocio de `entidades.ts` (con su nombre y su género); el hueco `{entidad}` se escribe con su artículo definido («el producto», «la sucursal»).\n * Los tipos `numero` y `dinero` del diseño entran con la primera entrada real que los pida (hoy ninguna); el artículo indefinido («un/una») entra con la primera entrada que lo pida.')
s=s.replace('export type TipoDeMarcador = "texto" | "causa";','export type TipoDeMarcador = "texto" | "causa" | "entidad";')
open(p,"w").write(s)
open("src/core/textos/entidades.ts","w").write('''/**
 * Las cosas del negocio que un texto nombra con artículo («No se encontró {entidad}.» → «No se encontró la sucursal.»): una sola vez cada una, con su género. El oráculo
 * (`test/textos/oraculo-de-entidades.ts`) tiene que declarar la frase esperada de cada una; una entidad nueva sin su fila hace fallar la prueba (diseño `docs/diseno-textos-en-codigo-2026-11-16.md`, §6, eje c).
 */
export type Entidad = { readonly nombre: string; readonly genero: "m" | "f" };

export const ENTIDADES = {
  membresia: { nombre: "membresía", genero: "f" },
  sucursal: { nombre: "sucursal", genero: "f" },
  usuario: { nombre: "usuario", genero: "m" },
  invitacion_pendiente: { nombre: "invitación pendiente", genero: "f" },
} as const satisfies Readonly<Record<string, Entidad>>;
''')
p="src/core/textos/texto-de.ts"; s=open(p).read()
s=s.replace('import type { DefinicionDeTexto, TipoDeMarcador } from "./tipos";','import { ENTIDADES, type Entidad } from "./entidades";\nimport type { DefinicionDeTexto, TipoDeMarcador } from "./tipos";')
s=s.replace('type ValorDe<T extends TipoDeMarcador> = T extends "causa" ? ClaveSinHuecos : string;','type ValorDe<T extends TipoDeMarcador> = T extends "causa" ? ClaveSinHuecos : T extends "entidad" ? (typeof ENTIDADES)[keyof typeof ENTIDADES] : string;')
s=s.replace('function armar(clave: string, valores: Readonly<Record<string, string>>): string | null {','function armar(clave: string, valores: Readonly<Record<string, unknown>>): string | null {')
s=s.replace('''    if (tipo === undefined || typeof valor !== "string") {
      falta = true;
      return "";
    }
    if (tipo === "texto") return valor;''','''    if (tipo === undefined || valor === undefined) {
      falta = true;
      return "";
    }
    if (tipo === "entidad") {
      const e = valor as Partial<Entidad> | null;
      if (typeof e?.nombre !== "string" || e.nombre.trim() === "" || (e.genero !== "m" && e.genero !== "f")) {
        falta = true;
        return "";
      }
      return `${e.genero === "f" ? "la" : "el"} ${e.nombre}`;
    }
    if (typeof valor !== "string") {
      falta = true;
      return "";
    }
    if (tipo === "texto") return valor;''')
s=s.replace('const dados = (valores[0] ?? {}) as Readonly<Record<string, string>>;','const dados = (valores[0] ?? {}) as Readonly<Record<string, unknown>>;')
open(p,"w").write(s)
usosTxt=",\n".join(f'      {{ archivo: "src/server/actions/auth/casos-de-uso/{a}", nombre: "{n[0]}" }}' for a,n in usos.items())
p="src/core/textos/catalogo.ts"; s=open(p).read()
for cod in ("MEMBRESIA_NO_ENCONTRADA","SUCURSAL_NO_ENCONTRADA"):
    s=re.sub(r'  "rechazo\.'+cod+r'": \{.*?\n  \},\n','',s,count=1,flags=re.S)
s=s.replace('  "rechazo.CONTEO_NO_ENCONTRADO"',f'''  // Lote C1 ({DEC}): «No se encontró {{entidad}}.», un solo molde con el género de la cosa («ese/esa» pasa a «el/la», aceptado por el dueño). Hoy lo usa `server/actions/auth/`; el resto de los sitios entra en C2.
  "rechazo.NO_ENCONTRADO": {{
    porDefecto: "No se encontró {{entidad}}.",
    marcadores: {{ entidad: "entidad" }},
    usos: [
{usosTxt},
    ],
    fuente: {{ decision: "{DEC}" }},
  }},
  "rechazo.CONTEO_NO_ENCONTRADO"''',1)
open(p,"w").write(s)
g="test/arquitectura/guardas/catalogo-de-textos.ts"; s=open(g).read()
s=s.replace('const TIPOS_DE_MARCADOR = ["texto", "causa"] as const;','const TIPOS_DE_MARCADOR = ["texto", "causa", "entidad"] as const;'); open(g,"w").write(s)
t="test/administracion/sucursal-con-pendientes.test.ts"; s=open(t).read()
s=s.replace("recibe «No se encontró esa sucursal.», no la lista","recibe «No se encontró la sucursal.», no la lista").replace('mensaje: "No se encontró esa sucursal." });','mensaje: "No se encontró la sucursal." });'); open(t,"w").write(s)
t="test/arquitectura/catalogo-de-textos.test.ts"; s=open(t).read()
s=s.replace('''expect(dicen(con("aviso.saludo", { marcadores: { nombre: "dinero" } }))).toContain("tipo que no existe");''','''expect(dicen(con("aviso.saludo", { marcadores: { nombre: "dinero" } }))).toContain("tipo que no existe");
    expect(revisarCatalogo(con("aviso.saludo", { marcadores: { nombre: "entidad" } }), contexto())).toEqual([]);'''); open(t,"w").write(s)
open("test/textos/oraculo-de-entidades.ts","w").write('''/**
 * Oráculo de las entidades del catálogo de textos (diseño `docs/diseno-textos-en-codigo-2026-11-16.md`, §6, eje c: género de la cosa), escrito aparte del código: para cada entidad de
 * `src/core/textos/entidades.ts`, la frase que tiene que salir. Una entidad nueva sin su fila hace fallar `entidades.test.ts`.
 */
export const ORACULO_DE_ENTIDADES: Readonly<Record<string, { genero: "m" | "f"; noSeEncontro: string }>> = {
  membresia: { genero: "f", noSeEncontro: "No se encontró la membresía." },
  sucursal: { genero: "f", noSeEncontro: "No se encontró la sucursal." },
  usuario: { genero: "m", noSeEncontro: "No se encontró el usuario." },
  invitacion_pendiente: { genero: "f", noSeEncontro: "No se encontró la invitación pendiente." },
};
''')
open("test/textos/entidades.test.ts","w").write('''import { describe, expect, it, vi } from "vitest";
import { ENTIDADES } from "@/core/textos/entidades";
import { MENSAJE_GENERICO, textoDe } from "@/core/textos/texto-de";
import { ORACULO_DE_ENTIDADES } from "./oraculo-de-entidades";

/** El molde «No se encontró {entidad}.» (lote C1, %s): recorre TODAS las entidades contra el oráculo y falla si aparece una entidad sin declarar. */
describe("textoDe con entidad: el género de la cosa", () => {
  it("cada entidad dice lo que el oráculo espera (recorrido exhaustivo) y tiene el género declarado", () => {
    for (const [clave, entidad] of Object.entries(ENTIDADES)) {
      const esperado = ORACULO_DE_ENTIDADES[clave];
      expect(esperado, `falta la fila de «${clave}» en el oráculo`).toBeDefined();
      expect(entidad.genero, clave).toBe(esperado!.genero);
      expect(textoDe("rechazo.NO_ENCONTRADO", { entidad }), clave).toBe(esperado!.noSeEncontro);
    }
  });

  it("guardián de dimensiones: el oráculo no tiene entidades que ya no existen y los géneros son m o f", () => {
    expect(Object.keys(ORACULO_DE_ENTIDADES).sort()).toEqual(Object.keys(ENTIDADES).sort());
    for (const e of Object.values(ENTIDADES)) expect(["m", "f"]).toContain(e.genero);
  });

  it("cerrado: una entidad que no está en la tabla no compila; en ejecución (un `any`) cae al mensaje genérico y no rompe", () => {
    // @ts-expect-error una entidad suelta, que no está en ENTIDADES
    void (() => textoDe("rechazo.NO_ENCONTRADO", { entidad: { nombre: "mesa", genero: "f" } }));
    // @ts-expect-error falta la entidad
    void (() => textoDe("rechazo.NO_ENCONTRADO", {}));
    const espia = vi.spyOn(console, "error").mockImplementation(() => {});
    const leer = textoDe as unknown as (clave: string, valores?: Record<string, unknown>) => string;
    expect(leer("rechazo.NO_ENCONTRADO", { entidad: { nombre: "mesa", genero: "x" } })).toBe(MENSAJE_GENERICO);
    expect(leer("rechazo.NO_ENCONTRADO", { entidad: { nombre: " ", genero: "m" } })).toBe(MENSAJE_GENERICO);
    expect(leer("rechazo.NO_ENCONTRADO", { entidad: "sucursal" })).toBe(MENSAJE_GENERICO);
    expect(leer("rechazo.NO_ENCONTRADO", { entidad: null })).toBe(MENSAJE_GENERICO);
    expect(leer("rechazo.NO_ENCONTRADO", {})).toBe(MENSAJE_GENERICO);
    espia.mockRestore();
  });
});
''' % DEC)
r="docs/registro-de-decisiones.md"; s=open(r).read().rstrip("\n")
s+=f'''

### {DEC}
- **Fecha:** 2026-11-16
- **Quién:** la sesión Sonnet de los lotes de reducción del catálogo de textos (lote C1); aceptación directa del dueño.
- **Qué decidió:** el molde único «No se encontró {{entidad}}.» con el género de la cosa (`rechazo.NO_ENCONTRADO`, marcador `entidad`, tabla `ENTIDADES` en `src/core/textos/entidades.ts`), aplicado a los 9 casos de uso de `src/server/actions/auth/` (membresía, sucursal, usuario e invitación pendiente: 11 sitios). Lo que ve distinto el personal: «No se encontró esa membresía / esa sucursal / ese usuario / esa invitación pendiente.» pasa a «No se encontró la membresía / la sucursal / el usuario / la invitación pendiente.». Reemplaza las dos claves de auth del lote A (`rechazo.MEMBRESIA_NO_ENCONTRADA` y `rechazo.SUCURSAL_NO_ENCONTRADA`), que se borran.
- **Por qué:** el dueño eligió un solo molde para «no se encontró» (`docs/diseno-textos-en-datos-2026-11-16.md`, D-6 y D-10); el género hace falta para escribir «el» y «la» bien.
- **Costo de revertir:** bajo: volver a escribir las cuatro frases literales en los 9 archivos y sacar la clave, el tipo `entidad` y la tabla; no hay migración ni datos.
- **Dónde:** `src/core/textos/catalogo.ts`, `src/core/textos/entidades.ts`
- **Estado:** ACEPTADA
- **Cita del dueño:** «Sí, un solo molde (Recomendada)» — 2026-11-16 — chat del dueño con el orquestador (`motor2-docs`, `seguimiento-de-pedernal/decisiones-del-dueno-2026-11-14-mesa-resend-contador.md`, «Textos: cuatro respuestas del dueño sobre la lista única»)
'''
open(r,"w").write(s)
print("C1 listo",len(usos))
