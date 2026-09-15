# Tipografias incluidas

Los archivos `.woff2` de este directorio NO estan cubiertos por la licencia MIT
del resto del repositorio. Se redistribuyen bajo la SIL Open Font License 1.1,
que lo permite expresamente siempre que la licencia acompane a los archivos.

| Familia       | Archivos              | Copyright                  | Licencia         |
|---------------|-----------------------|----------------------------|------------------|
| IBM Plex Sans | `ibm-plex-sans-*`     | Copyright 2017 IBM Corp.   | SIL OFL 1.1      |
| IBM Plex Mono | `ibm-plex-mono-*`     | Copyright 2017 IBM Corp.   | SIL OFL 1.1      |
| Chakra Petch  | `chakra-petch-*`      | Copyright 2018 Cadson Demak | SIL OFL 1.1     |

Texto completo de la licencia: `OFL.txt` en este mismo directorio.

Origen de las familias:

- IBM Plex: https://github.com/IBM/plex
- Chakra Petch: https://github.com/cadsondemak/chakra-petch

Nota: el build embebe estas tipografias como `data:` URI dentro de
`dist/index.html`, asi que el archivo distribuible tambien las contiene. La OFL
lo permite (no se venden por separado y no se usan sus nombres reservados para
versiones modificadas), pero el aviso de arriba debe viajar con cualquier
redistribucion.
