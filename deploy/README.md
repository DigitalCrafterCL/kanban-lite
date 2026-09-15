# Despliegue por git + ssh

El servidor de tableros compartidos se despliega empujando la rama a un
repositorio *bare* en la máquina destino. Un hook `pre-receive` compila y
ejecuta las pruebas antes de aceptar el push; si pasan, `post-receive` vuelca el
árbol, compila el frontend y reinicia el servicio.

Destino: **`USUARIO@SERVIDOR:/srv/kanban`**. El destino real de esta copia de
trabajo está en el remoto de git, no en este documento: consúltalo con
`git remote -v`.

## Disposición en el servidor

```
/srv/kanban/
+-- repo.git/     <- repositorio bare que recibe los push
+-- app/          <- árbol de trabajo (se sobreescribe en cada despliegue)
\-- data/
    \-- kanban.db <- base de datos; vive FUERA del árbol, ningún despliegue la toca
```

El servicio corre como el usuario de sistema `kanban`, no como root, y sólo
tiene permiso de escritura sobre `data/`.

## Preparar un servidor nuevo

Requisitos: Debian/Ubuntu con systemd, git y **Node 22 o superior**
(`node:sqlite` no existe antes de la 22).

```bash
scp deploy/setup-remote.sh deploy/pre-receive deploy/post-receive \
    deploy/kanban-admin deploy/kanban.service USUARIO@SERVIDOR:/tmp/
ssh USUARIO@SERVIDOR 'cd /tmp && sudo bash setup-remote.sh USUARIO'
```

El script es idempotente: se puede reejecutar sin romper nada ni tocar la base
de datos.

## Desplegar

```bash
git remote add produccion USUARIO@SERVIDOR:/srv/kanban/repo.git
git push produccion main
```

Sólo se despliega la rama `main`. Empujar cualquier otra rama la almacena pero
no toca el servicio. Para desplegar la rama actual sin renombrarla:

```bash
git push produccion HEAD:main
```

Hay dos hooks:

- **`pre-receive`** extrae el árbol entrante a un directorio temporal, lo
  compila y ejecuta las pruebas del servidor. Si algo falla **rechaza el push**:
  la referencia del remoto no se mueve y el repositorio nunca queda adelantado
  respecto a lo desplegado.
- **`post-receive`** sólo se ejecuta si lo anterior pasó: vuelca el árbol,
  compila y reinicia el servicio.

## Usuarios de la aplicación

Se crean en el servidor, no desde la app. `setup-remote.sh` instala el atajo
`kanban-admin`, que ya apunta a la base correcta:

```bash
ssh USUARIO@SERVIDOR 'kanban-admin --create-user carlos'
ssh USUARIO@SERVIDOR 'kanban-admin --list-users'
ssh USUARIO@SERVIDOR 'kanban-admin --set-password carlos'
```

**No hace falta reiniciar el servicio.** El servidor consulta SQLite en cada
login, así que un usuario nuevo funciona al instante.

Evita invocar `server/index.js` a mano: si olvidas `--db`, se usa
`./kanban.db` relativo al directorio actual y el usuario acaba en una base que
el servicio no lee. El comando ahora se niega a crear una base nueva sin
`--init`, pero el atajo es más seguro.

## Operación

```bash
systemctl status kanban          # estado
journalctl -u kanban -f          # registro en vivo
systemctl restart kanban         # reinicio manual
```

Copia de seguridad: basta con guardar `/srv/kanban/data/`. Con el servicio
parado, o usando `sqlite3 kanban.db ".backup copia.db"` en caliente.

## Aviso de seguridad

El servicio escucha en HTTP plano en el puerto 8090, pensado para LAN o VPN.
Las contraseñas y los tokens viajan legibles por la red. Si esto se expone
fuera de la red interna, hay que poner delante un proxy con TLS (Caddy, nginx)
y dejar el servicio escuchando sólo en `127.0.0.1`.
