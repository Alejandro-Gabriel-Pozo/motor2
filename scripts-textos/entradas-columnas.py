# Uso: python3 entradas-columnas.py <lote.json> <DEC-NNNN> <orden separado por comas> "<comentario>"
import json,sys
H=json.load(open(sys.argv[1])); DEC=sys.argv[2]; orden=sys.argv[3].split(","); com=sys.argv[4]
assert all(h['uso'] for h in H)
por={};valor={}
for h in sorted(H,key=lambda h:(h['clave'],h['rel'])):
    por.setdefault(h['clave'],[]); t=(h['rel'],h['uso'])
    if t not in por[h['clave']]: por[h['clave']].append(t)
    valor[h['clave']]=h['valor']
bloque=f"  // {com}\n"
for o in orden:
    c="columna."+o
    u=",\n".join(f'      {{ archivo: "{r}", nombre: "{n}" }}' for r,n in por[c])
    bloque+=f'  "{c}": {{\n    porDefecto: "{valor[c]}",\n    usos: [\n{u},\n    ],\n    fuente: {{ decision: "{DEC}" }},\n  }},\n'
p="src/core/textos/catalogo.ts"; s=open(p).read()
s=s.replace("} as const satisfies",bloque+"} as const satisfies",1)
if "`columna.` (encabezado de tabla)" not in s:
    s=s.replace("`rotulo.` / `accion.` / `aviso.` / `ayuda.` / `titulo.`","`rotulo.` / `accion.` / `aviso.` / `ayuda.` / `titulo.` / `columna.` (encabezado de tabla)")
open(p,"w").write(s)
g="test/arquitectura/guardas/catalogo-de-textos.ts"; s=open(g).read()
s=s.replace("(?:rotulo|accion|aviso|ayuda|titulo)\\.","(?:rotulo|accion|aviso|ayuda|titulo|columna)\\.").replace("`rotulo|accion|aviso|ayuda|titulo.<tema>`","`rotulo|accion|aviso|ayuda|titulo|columna.<tema>`")
open(g,"w").write(s)
t="test/arquitectura/catalogo-de-textos.test.ts"; s=open(t).read()
if '"columna.Producto"' not in s:
    s=s.replace('''    expect(dicen({ ...base(), "Aviso.saludo": base()["aviso.saludo"]! })).toContain("C1");''','''    expect(dicen({ ...base(), "Aviso.saludo": base()["aviso.saludo"]! })).toContain("C1");
    expect(dicen({ ...base(), "columna.Producto": { ...base()["aviso.saludo"]!, porDefecto: "Chau {nombre}" } })).toContain("C1");
    expect(revisarCatalogo({ ...base(), "columna.producto": { ...base()["aviso.saludo"]!, porDefecto: "Chau {nombre}" } }, contexto()).filter((p) => p.includes("C1"))).toEqual([]);''')
    open(t,"w").write(s)
