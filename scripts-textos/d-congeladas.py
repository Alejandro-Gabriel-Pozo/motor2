# Segundo commit del lote D: declara la regeneración del golden en caracterizaciones-congeladas.test.ts. Uso: python3 d-congeladas.py <sha-corto-del-commit-de-codigo> <blob-nuevo>
import sys
c,blob=sys.argv[1],sys.argv[2]
p="test/arquitectura/caracterizaciones-congeladas.test.ts"; s=open(p).read()
i=s.index('"test/catalogo/caracterizacion/dinero-tramo-c.golden.txt": {'); j=s.index("regeneraciones: [",i); k=s.index("    ],\n  },",j)
nueva=f'''      {{
        blob: "{blob}",
        // Un commit no puede llevar su propio hash: es el commit de este mismo cambio (lote D del catálogo de textos), que cambia la línea y declara su regeneración en el commit hijo.
        commit: "{c}",
        motivo:
          "Lote D del catálogo de textos (aceptado por el dueño el 2026-11-16: «Sí, una sola frase (Recomendada)»): el rechazo por nombre repetido del alta de un cliente pasa de «Ya existe un cliente llamado» con el nombre entre comillas rectas a «Ya existe un cliente llamado «Fulano». Elegí otro nombre.». Cambia SOLO esa línea del paso «cliente: alta repetida»; ningún dato ni efecto.",
      }},
'''
s=s[:k]+nueva+s[k:]; open(p,"w").write(s)
