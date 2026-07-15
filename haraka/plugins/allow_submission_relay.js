/**
 * Разрешает relay с submission-порта 587 ТОЛЬКО для backend-контейнера этого стека.
 *
 * ВАЖНО: раньше здесь доверяли всему приватному диапазону (10.x/192.168.x/172.16-31.x),
 * что на shared Docker-хосте с другими проектами в тех же сетях фактически превращало
 * сервер в открытый relay — любой контейнер на хосте мог слать почту от чужого домена
 * без авторизации. Теперь доверяем только точному IP, разрешённому из имени backend-сервиса.
 */
exports.register = function () {
  this.trusted_ip = null
  this.resolve_trusted_backend()
  this.register_hook('connect', 'maybe_relay')
}

exports.resolve_trusted_backend = function () {
  const dns = require('dns')
  const host = process.env.RELAY_TRUSTED_HOST || 'email_backend'
  const plugin = this

  const lookup = () => {
    dns.lookup(host, (err, address) => {
      if (err) {
        plugin.logerror(`allow_submission_relay: не удалось разрешить ${host}: ${err.message}`)
        setTimeout(lookup, 30000)
        return
      }
      if (plugin.trusted_ip !== address) {
        plugin.loginfo(`allow_submission_relay: доверенный relay-хост ${host} -> ${address}`)
      }
      plugin.trusted_ip = address
    })
  }

  lookup()
  // Docker может пересоздать backend с новым IP при рестарте — периодически обновляем.
  setInterval(lookup, 5 * 60 * 1000)
}

exports.maybe_relay = function (next, connection) {
  const port = connection.local?.port
  const ip = connection.remote?.ip

  if (port === 587 && this.trusted_ip && ip === this.trusted_ip) {
    connection.relaying = true
  } else if (port === 587) {
    connection.loginfo(
      `allow_submission_relay: отклонён relay с ${ip} (ожидался доверенный IP ${this.trusted_ip})`,
    )
  }

  return next()
}
