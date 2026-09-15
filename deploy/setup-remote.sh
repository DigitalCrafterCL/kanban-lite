#!/usr/bin/env bash
# Prepara un servidor para recibir despliegues por git+ssh.
#
# Idempotente: se puede volver a ejecutar sin romper nada. No toca la base de
# datos ni sobreescribe usuarios ya creados.
#
# Se ejecuta EN EL SERVIDOR, con sudo:
#   sudo bash setup-remote.sh <usuario-de-despliegue>
set -euo pipefail

DEPLOY_USER="${1:-}"
if [ -z "$DEPLOY_USER" ]; then
  echo "Uso: sudo bash setup-remote.sh <usuario-de-despliegue>" >&2
  exit 1
fi
if ! id "$DEPLOY_USER" >/dev/null 2>&1; then
  echo "El usuario '$DEPLOY_USER' no existe en este servidor." >&2
  exit 1
fi

BASE=/srv/kanban
SERVICE=kanban

echo "-- Comprobando Node --"
if ! command -v node >/dev/null 2>&1; then
  echo "[error] Node no está instalado. El servidor necesita Node 22 o superior" >&2
  echo "  (usa node:sqlite, que no existe en versiones anteriores)." >&2
  exit 1
fi
NODE_MAJOR=$(node -p "process.versions.node.split('.')[0]")
if [ "$NODE_MAJOR" -lt 22 ]; then
  echo "[error] Node $(node -v) es demasiado antiguo. Hace falta 22 o superior." >&2
  exit 1
fi
echo "[ok] $(node -v)"

echo "-- Usuario de servicio --"
if ! id kanban >/dev/null 2>&1; then
  useradd --system --home-dir "$BASE" --shell /usr/sbin/nologin kanban
  echo "[ok] usuario de sistema 'kanban' creado"
else
  echo "· usuario 'kanban' ya existe"
fi

echo "-- Directorios --"
mkdir -p "$BASE/repo.git" "$BASE/app" "$BASE/data"
if [ ! -d "$BASE/repo.git/objects" ]; then
  git init --bare --initial-branch=main "$BASE/repo.git" >/dev/null
  echo "[ok] repositorio bare creado en $BASE/repo.git"
else
  echo "· repositorio bare ya existe"
fi

# El usuario que empuja necesita escribir en el repo y en el árbol de trabajo;
# el servicio sólo necesita leer la app y escribir en data/.
chown -R "$DEPLOY_USER":"$DEPLOY_USER" "$BASE/repo.git" "$BASE/app"
chown -R kanban:kanban "$BASE/data"
chmod 750 "$BASE/data"
echo "[ok] permisos aplicados"

echo "-- Hooks de despliegue --"
for hook in pre-receive post-receive; do
  install -o "$DEPLOY_USER" -g "$DEPLOY_USER" -m 0755 \
    "$(dirname "$0")/$hook" "$BASE/repo.git/hooks/$hook"
done
echo "[ok] pre-receive (verifica y puede rechazar) y post-receive (despliega) instalados"

echo "-- Atajo de administración --"
install -m 0755 "$(dirname "$0")/kanban-admin" /usr/local/bin/kanban-admin
echo "[ok] /usr/local/bin/kanban-admin instalado"

echo "-- Servicio systemd --"
install -m 0644 "$(dirname "$0")/kanban.service" /etc/systemd/system/kanban.service
systemctl daemon-reload
systemctl enable "$SERVICE" >/dev/null
echo "[ok] $SERVICE habilitado"

if [ "$DEPLOY_USER" = "root" ]; then
  echo "-- Permiso de reinicio --"
  echo "· se despliega como root: no hace falta regla de sudo"
else
  echo "-- Permiso de reinicio sin contraseña --"
  # Acotado a un único comando: el usuario de despliegue no gana nada más.
  cat > /etc/sudoers.d/kanban-deploy <<SUDOERS
$DEPLOY_USER ALL=(root) NOPASSWD: /usr/bin/systemctl restart $SERVICE
SUDOERS
  chmod 0440 /etc/sudoers.d/kanban-deploy
  visudo -cf /etc/sudoers.d/kanban-deploy >/dev/null
  echo "[ok] regla de sudo instalada y validada"
fi

echo
echo "Listo. Desde tu máquina:"
echo "  git remote add produccion $DEPLOY_USER@SERVIDOR:$BASE/repo.git"
echo "  git push produccion main"
echo
echo "Después del primer despliegue, crea los usuarios de la aplicación:"
echo "  kanban-admin --init --create-user carlos   # la primera vez, crea la base"
echo "  kanban-admin --create-user jose            # las siguientes"
