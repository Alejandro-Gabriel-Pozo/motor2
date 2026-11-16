# Lote D: «Ya existe {un/una} … llamado «X». Elegí otro nombre.» en clientes (sobre C2). Uso: python3 d.py DEC-NNNN. Después: commit, y en un segundo commit la regeneración del golden (ver d-congeladas.py).
import re,sys
DEC=sys.argv[1]
p="src/core/textos/texto-de.ts"; s=open(p).read()
s=s.replace('const HUECO = /\\{([a-z][a-zA-Z0-9]*)\\}/g;','const HUECO = /\\{([a-z][a-zA-Z0-9]*)(?::(un))?\\}/g;')
s=s.replace("const texto = definicion.porDefecto.replace(HUECO, (_hueco, nombre: string) => {","const texto = definicion.porDefecto.replace(HUECO, (_hueco, nombre: string, articulo: string | undefined) => {")
s=s.replace('''      return `${e.genero === "f" ? "la" : "el"} ${e.nombre}`;''','''      const indefinido = articulo === "un";
      return `${e.genero === "f" ? (indefinido ? "una" : "la") : indefinido ? "un" : "el"} ${e.nombre}`;''')
s=s.replace('''    if (typeof valor !== "string") {
      falta = true;
      return "";
    }''','''    if (typeof valor !== "string" || articulo !== undefined) {
      falta = true;
      return "";
    }''')
open(p,"w").write(s)
p="src/core/textos/tipos.ts"; s=open(p).read()
s=s.replace("el hueco `{entidad}` se escribe con su artículo definido («el producto», «la sucursal»).","el hueco `{entidad}` se escribe con su artículo definido («el producto», «la sucursal») y `{entidad:un}` con el indefinido («un cliente», «una sucursal»).")
s=s.replace("; el artículo indefinido («un/una») entra con la primera entrada que lo pida.",".")
open(p,"w").write(s)
g="test/arquitectura/guardas/catalogo-de-textos.ts"; s=open(g).read()
s=s.replace('e.porDefecto.replace(/\\{[a-z][a-zA-Z0-9]*\\}/g, "")','e.porDefecto.replace(/\\{[a-z][a-zA-Z0-9]*(?::un)?\\}/g, "")'); open(g,"w").write(s)
p="src/core/textos/catalogo.ts"; s=open(p).read()
bloque=f'''  // Lote D ({DEC}): «Ya existe {{un/una}} … llamado «X». Elegí otro nombre.», una sola frase (aceptado por el dueño). Hoy lo usan los casos de uso de `clientes/`; el resto de los NOMBRE_REPETIDO son de carta y catálogo.
  "rechazo.NOMBRE_REPETIDO": {{
    porDefecto: "Ya existe {{entidad:un}} llamado «{{nombre}}». Elegí otro nombre.",
    marcadores: {{ entidad: "entidad", nombre: "texto" }},
    usos: [
      {{ archivo: "src/server/actions/clientes/casos-de-uso/actualizar-cliente.ts", nombre: "actualizarClienteCasoDeUso" }},
      {{ archivo: "src/server/actions/clientes/casos-de-uso/alta-cliente.ts", nombre: "altaClienteCasoDeUso" }},
    ],
    fuente: {{ decision: "{DEC}" }},
  }},
'''
s=s.replace("} as const satisfies",bloque+"} as const satisfies",1); open(p,"w").write(s)
for a in ("actualizar-cliente","alta-cliente"):
    f=f"src/server/actions/clientes/casos-de-uso/{a}.ts"; s=open(f).read()
    s=re.sub(r'fracaso\("NOMBRE_REPETIDO", `Ya existe un cliente llamado "\$\{([^}]+)\}"\.`\)',r'fracaso("NOMBRE_REPETIDO", textoDe("rechazo.NOMBRE_REPETIDO", { entidad: ENTIDADES.cliente, nombre: \1 }))',s)
    if 'core/textos/texto-de' not in s:
        L=s.split("\n"); k=max(i for i,l in enumerate(L) if l.startswith("import ") and l.rstrip().endswith(";")); L.insert(k+1,'import { textoDe } from "@/core/textos/texto-de";'); L.insert(k+2,'import { ENTIDADES } from "@/core/textos/entidades";'); s="\n".join(L)
    open(f,"w").write(s)
p="test/textos/oraculo-de-entidades.ts"; s=open(p).read()
s=s.replace('Record<string, { genero: "m" | "f"; noSeEncontro: string }>','Record<string, { genero: "m" | "f"; noSeEncontro: string; /** Solo las entidades que hoy se repiten por nombre. */ yaExiste?: string }>')
s=s.replace('cliente: { genero: "m", noSeEncontro: "No se encontró el cliente." }','cliente: { genero: "m", noSeEncontro: "No se encontró el cliente.", yaExiste: "Ya existe un cliente llamado «Fulano». Elegí otro nombre." }'); open(p,"w").write(s)
p="test/textos/entidades.test.ts"; s=open(p).read()
s=s.replace('''      expect(textoDe("rechazo.NO_ENCONTRADO", { entidad }), clave).toBe(esperado!.noSeEncontro);
    }
  });''','''      expect(textoDe("rechazo.NO_ENCONTRADO", { entidad }), clave).toBe(esperado!.noSeEncontro);
      if (esperado!.yaExiste !== undefined) expect(textoDe("rechazo.NOMBRE_REPETIDO", { entidad, nombre: "Fulano" }), clave).toBe(esperado!.yaExiste);
    }
  });

  it("el artículo indefinido concuerda con el género (hoy solo el cliente se repite por nombre: «llamado» queda fijo, como lo eligió el dueño)", () => {
    expect(textoDe("rechazo.NOMBRE_REPETIDO", { entidad: ENTIDADES.cliente, nombre: "A" })).toBe("Ya existe un cliente llamado «A». Elegí otro nombre.");
  });''',1); open(p,"w").write(s)
t="test/clientes/cliente.test.ts"; s=open(t).read(); s=s.replace('Ya existe un cliente llamado "Fulano".','Ya existe un cliente llamado «Fulano». Elegí otro nombre.'); open(t,"w").write(s)
t="test/clientes/cliente-mensajes.test.ts"; s=open(t).read(); s=s.replace('''mensaje: 'Ya existe un cliente llamado "Dos".' }''','''mensaje: 'Ya existe un cliente llamado «Dos». Elegí otro nombre.' }'''); open(t,"w").write(s)
g="test/catalogo/caracterizacion/dinero-tramo-c.golden.txt"; s=open(g,newline="").read()
s=s.replace('Ya existe un cliente llamado \\"Fulano\\".','Ya existe un cliente llamado «Fulano». Elegí otro nombre.'); open(g,"w",newline="").write(s)
r="docs/registro-de-decisiones.md"; s=open(r).read().rstrip("\n")
s+=f'''

### {DEC}
- **Fecha:** 2026-11-16
- **Quién:** la sesión Sonnet de los lotes de reducción del catálogo de textos (lote D); aceptación directa del dueño.
- **Qué decidió:** el rechazo por nombre repetido de los casos de uso de clientes (alta y edición: 4 sitios en 2 archivos) pasa a la frase única `rechazo.NOMBRE_REPETIDO`: «Ya existe {{un/una}} {{entidad}} llamado «{{nombre}}». Elegí otro nombre.» (marcador `entidad` con artículo indefinido, `{{entidad:un}}`). Lo que ve distinto el personal: antes «Ya existe un cliente llamado "X".», ahora «Ya existe un cliente llamado «X». Elegí otro nombre.» (comillas «» y la cola «Elegí otro nombre.»). «llamado» queda fijo, como lo escribió el dueño; hoy solo se repite por nombre un cliente (masculino). Los otros 12 sitios de `NOMBRE_REPETIDO` (carta y catálogo) quedan literales hasta que cierren esos frentes. Regenera el golden `dinero-tramo-c.golden.txt` (una línea: el mensaje de «cliente: alta repetida»), declarado en `caracterizaciones-congeladas.test.ts`.
- **Por qué:** el dueño eligió una sola frase para «ya existe» (`docs/diseno-textos-en-datos-2026-11-16.md`, D-10); hoy hay 16 versiones con comillas y colas distintas.
- **Costo de revertir:** bajo: volver a escribir la frase literal en los 4 sitios, la prueba y el golden y sacar la clave; no hay migración ni datos.
- **Dónde:** `src/core/textos/catalogo.ts`, `src/server/actions/clientes/casos-de-uso/alta-cliente.ts`
- **Estado:** ACEPTADA
- **Cita del dueño:** «Sí, una sola frase (Recomendada)» — 2026-11-16 — chat del dueño con el orquestador (`motor2-docs`, `seguimiento-de-pedernal/decisiones-del-dueno-2026-11-14-mesa-resend-contador.md`, «Textos: cuatro respuestas del dueño sobre la lista única»)
'''
open(r,"w").write(s)
print("D listo")
