#!/bin/sh
set -e

read_file_trim() {
  if [ -r "$1" ]; then
    tr -d '\r\n' < "$1" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//'
  fi
}

resolve_hostname() {
  if [ -n "${HARAKA_HOSTNAME:-}" ]; then
    printf '%s' "$HARAKA_HOSTNAME"
    return
  fi

  for f in \
    /opt/email/secret/mail_hostname \
    /opt/email/mail_hostname \
    /opt/email/secret/Mail_hostname
  do
    val="$(read_file_trim "$f")"
    if [ -n "$val" ]; then
      printf '%s' "$val"
      return
    fi
  done

  printf '%s' 'mail.example.com'
}

HOSTNAME="$(resolve_hostname)"
CERT_DIR="/usr/src/haraka/config/certs"
LE_LIVE="/etc/letsencrypt/live/${HOSTNAME}"

mkdir -p "$CERT_DIR"
echo "$HOSTNAME" > /usr/src/haraka/config/me

if [ -r "$LE_LIVE/privkey.pem" ] && [ -r "$LE_LIVE/fullchain.pem" ]; then
  cp -Lf "$LE_LIVE/privkey.pem" "$CERT_DIR/privkey.pem"
  cp -Lf "$LE_LIVE/fullchain.pem" "$CERT_DIR/fullchain.pem"
  chmod 600 "$CERT_DIR/privkey.pem"
  chmod 644 "$CERT_DIR/fullchain.pem"
else
  echo "[Haraka] TLS certs not found at $LE_LIVE (STARTTLS may be unavailable until certs exist)"
fi

echo "[Haraka] Syncing DKIM keys from database..."
node /usr/src/haraka/scripts/sync-dkim-keys.js || echo "[Haraka] DKIM sync skipped or failed"

# Всё выше выполнялось под root (нужен доступ к root-only /etc/letsencrypt и запись
# конфигов). Сам процесс Haraka, который парсит недоверенный внешний SMTP-трафик,
# запускаем под непривилегированным node — capability cap_net_bind_service (setcap в
# Dockerfile) позволяет ему без root слушать порты 25/587.
chown -R node:node /usr/src/haraka/config
exec su-exec node npx haraka -c /usr/src/haraka
