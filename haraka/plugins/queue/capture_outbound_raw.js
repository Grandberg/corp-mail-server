const { Writable } = require('node:stream');
const { getPool } = require('../db');

/**
 * Для исходящей почты (relaying-соединение backend → Haraka на 587) перехватывает
 * итоговое сырое письмо ПОСЛЕ подписи DKIM (haraka-plugin-dkim уже отработал на
 * фазе data_post) и сохраняет его в emails.raw_source — чтобы «Оригинал письма» в
 * приложении показывал реальные заголовки Haraka/DKIM, а не синтетическую копию.
 * Никогда не блокирует и не меняет исход доставки — всегда вызывает next() без кода.
 */
exports.register = function () {
  this.register_hook('queue', 'capture_outbound_raw');
};

function readRawMessage(txn) {
  const cached = txn.notes?.get('raw_message');
  if (cached) {
    const buf = Buffer.isBuffer(cached) ? cached : Buffer.from(cached);
    return Promise.resolve(buf);
  }

  return new Promise((resolve, reject) => {
    const stream = txn.message_stream;
    if (!stream) {
      reject(new Error('message_stream missing'));
      return;
    }

    const chunks = [];
    const collector = new Writable({
      write(chunk, _enc, cb) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        cb();
      },
    });

    const onError = (err) => {
      stream.removeListener('error', onError);
      collector.removeListener('error', onError);
      reject(err);
    };

    stream.once('error', onError);
    collector.once('error', onError);
    collector.once('finish', () => {
      stream.removeListener('error', onError);
      const raw = Buffer.concat(chunks);
      if (!raw.length) {
        reject(new Error('empty message body'));
        return;
      }
      txn.notes.set('raw_message', raw);
      resolve(raw);
    });

    // Haraka message_stream must be consumed via pipe (not .on('data')).
    stream.pipe(collector, { line_endings: '\n', dot_stuffed: false });
  });
}

function extractMessageId(raw) {
  const head = raw.toString('utf8', 0, Math.min(raw.length, 16384));
  const match = /^Message-ID:[ \t]*(.+)$/im.exec(head);
  return match ? match[1].trim() : null;
}

exports.capture_outbound_raw = function (next, connection) {
  if (!connection.relaying) return next();

  const txn = connection.transaction;
  if (!txn) return next();

  readRawMessage(txn)
    .then(async (raw) => {
      const messageId = extractMessageId(raw);
      if (!messageId) {
        connection.logdebug('capture_outbound_raw: Message-ID not found, skipping');
        return;
      }

      const pool = getPool();
      const { rowCount } = await pool.query(
        'UPDATE emails SET raw_source = $2 WHERE message_id = $1',
        [messageId, raw.toString('utf8')],
      );
      connection.loginfo(
        `capture_outbound_raw: stored real raw source for ${messageId} (${rowCount} row(s))`,
      );
    })
    .catch((err) => {
      connection.logerror(`capture_outbound_raw: ${err.message}`);
    })
    .finally(() => next());
};
