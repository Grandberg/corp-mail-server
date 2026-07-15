# Секреты приложения

## Сервер (Portainer)

Файлы секретов — в `/opt/email/secret/`:

- `database_url` — строка подключения PostgreSQL
- `db_password` — пароль PostgreSQL
- `jwt_secret` — секрет JWT (минимум 32 символа)
- `redis_password` — пароль Redis
- `internal_api_secret` — секрет для Haraka → backend (`/api/internal/inbound`)

**Опционально** (файл **или** переменная стека Portainer; отсутствие не ломает деплой):

| Параметр | Переменная | Файл (любой из путей) |
|----------|------------|------------------------|
| Публичный IP | `SERVER_PUBLIC_IP` | `/opt/email/secret/server_public_ip` или `/opt/email/server_public_ip` |
| Hostname MTA | `MAIL_HOSTNAME` | `/opt/email/secret/mail_hostname` или `/opt/email/mail_hostname` |

Приоритет: переменная окружения → файл в `secret/` → файл в `/opt/email/`.

## MTA (Haraka)

Haraka и `MTA_ENABLED=true` по умолчанию включены в **`docker-compose.yml`** (отдельный `docker-compose.mta.yml` не нужен).

После git pull в Portainer: **Pull and redeploy** стека.

Проверка: `/api/health` → `"mtaEnabled": true`, `"mta": "connected"`, контейнер `email_haraka` — Up.

Отключить MTA (только dev): `MTA_ENABLED=false` в `.env` или env стека.

## Локальная разработка

1. Скопируйте `*.example` файлы без расширения `.example`
2. Заполните значениями
3. Задайте переменную: `EMAIL_SECRETS_DIR=./secrets`

Пример `database_url` для локальной БД:

```
# С Docker Compose (контейнер email_db в сети email_net):
postgresql://mailuser:YOUR_PASSWORD@email_db:5432/corp_mail

# Без Docker (backend на хосте):
postgresql://mailuser:YOUR_PASSWORD@localhost:5432/corp_mail
```
