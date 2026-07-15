#!/bin/sh
# Копируем секреты в доступную директорию (как в Maps-info)
mkdir -p /tmp/app-secrets
if [ -d /run/secrets ]; then
  cp /run/secrets/* /tmp/app-secrets/ 2>/dev/null || true
  chmod 400 /tmp/app-secrets/* 2>/dev/null || true
fi

# Убеждаемся, что директория для данных доступна пользователю node
if [ -d /var/mail ]; then
  chown -R node:node /var/mail
fi

exec su-exec node "$@"
