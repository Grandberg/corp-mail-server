const { Writable } = require('node:stream');
const { readSecret } = require('../db');

exports.register = function () {
  this.register_hook('queue', 'deliver_to_backend');
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

function rcptAddress(rcpt) {
  if (!rcpt) return '';
  if (typeof rcpt.address === 'function') return rcpt.address().toLowerCase();
  if (rcpt.address) return String(rcpt.address).toLowerCase();
  return String(rcpt).toLowerCase();
}

async function postInbound(backendUrl, secret, recipient, rawBase64) {
  const res = await fetch(`${backendUrl}/api/internal/inbound`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Internal-Secret': secret,
    },
    body: JSON.stringify({ recipient, raw: rawBase64 }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Backend inbound failed for ${recipient}: ${res.status} ${text}`);
  }
}

exports.deliver_to_backend = function (next, connection) {
  if (connection.relaying || connection.local?.port === 587) {
    return next();
  }

  const txn = connection.transaction;
  if (!txn) {
    connection.logerror('deliver_backend: transaction missing');
    return next(DENYSOFT, 'Transaction missing');
  }

  const backendUrl = process.env.BACKEND_URL || 'http://email_backend:4000';
  const secret = readSecret('INTERNAL_API_SECRET', 'INTERNAL_API_SECRET_FILE');

  if (!secret) {
    connection.logerror('INTERNAL_API_SECRET not set');
    return next(DENYSOFT, 'Backend secret missing');
  }

  const recipients = txn.rcpt_to.map((r) => rcptAddress(r));

  readRawMessage(txn)
    .then(async (raw) => {
      const rawBase64 = raw.toString('base64');
      for (const recipient of recipients) {
        await postInbound(backendUrl, secret, recipient, rawBase64);
      }
      connection.loginfo(
        `deliver_backend: delivered to backend (${recipients.join(', ')}, ${raw.length} bytes)`,
      );
      next(OK);
    })
    .catch((err) => {
      connection.logerror(`deliver_backend: ${err.message}`);
      next(DENYSOFT, 'Delivery error');
    });
};
