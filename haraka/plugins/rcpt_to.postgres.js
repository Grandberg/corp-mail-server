const { getPool } = require('./db');

exports.register = function () {
  this.register_hook('rcpt', 'validate_rcpt');
};

function rcptAddress(rcpt) {
  if (!rcpt) return ''
  if (typeof rcpt.address === 'function') return rcpt.address().toLowerCase()
  if (rcpt.address) return String(rcpt.address).toLowerCase()
  return String(rcpt).toLowerCase()
}

exports.validate_rcpt = async function (next, connection, params) {
  if (connection.relaying) return next(OK)

  const address = rcptAddress(params[0]);

  try {
    const db = getPool();

    const userRes = await db.query(
      'SELECT id FROM users WHERE LOWER(email) = $1 AND is_active = true LIMIT 1',
      [address],
    );
    if (userRes.rows.length > 0) return next(OK);

    const aliasRes = await db.query(
      `SELECT u.email
       FROM aliases a
       JOIN users u ON u.id = a.destination_user_id
       WHERE LOWER(a.source_address) = $1 AND a.is_active = true AND u.is_active = true
       LIMIT 1`,
      [address],
    );
    if (aliasRes.rows.length > 0) return next(OK);

    return next(DENY, 'Recipient not found');
  } catch (err) {
    connection.logerror(`rcpt_to.postgres: ${err.message}`);
    return next(DENYSOFT, 'Temporary database error');
  }
};
