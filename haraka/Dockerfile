FROM node:20-alpine
RUN apk add --no-cache python3 make g++ openssl libcap su-exec
WORKDIR /usr/src/haraka
COPY package.json ./
RUN npm install --omit=dev
COPY . .
# Дроп привилегий (см. docker-entrypoint.sh): процесс Haraka разбирает недоверенный
# внешний SMTP-трафик, поэтому не должен работать от root постоянно. setcap позволяет
# non-root node-пользователю биндиться на привилегированные порты 25/587.
RUN chmod +x docker-entrypoint.sh \
  && chown -R node:node /usr/src/haraka \
  && setcap 'cap_net_bind_service=+ep' "$(readlink -f "$(which node)")"
EXPOSE 25 587
ENTRYPOINT ["./docker-entrypoint.sh"]
