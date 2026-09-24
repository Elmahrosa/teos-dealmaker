function buildPoolConfig(url) {
  const connectionString = url || process.env.DATABASE_URL;
  if (!connectionString) return null;
  // Explicit operator opt-out (local development or an already-encrypted
  // tunnel). Everything else below defaults to TLS — a remote database must
  // never silently connect plaintext (audit: "Postgres TLS may silently be
  // plaintext").
  if (
    process.env.PGSSLMODE === 'disable' ||
    /sslmode=disable/i.test(connectionString)
  ) {
    return { connectionString };
  }
  const isLocal = /(localhost|127\.0\.0\.1|::1|0\.0\.0\.0)/i.test(connectionString);
  const requiresSSL =
    /supabase\.co/i.test(connectionString) ||
    /sslmode=(require|verify-ca|verify-full)/.test(connectionString) ||
    process.env.PGSSLMODE === 'require' ||
    process.env.PGSSLMODE === 'verify-ca' ||
    process.env.PGSSLMODE === 'verify-full' ||
    !isLocal; // remote databases default to TLS
  if (!requiresSSL) return { connectionString };
  // Certificate verification is ON by default. Only disable explicitly via
  // PG_REJECT_UNAUTHORIZED=false (e.g. a trusted private CA without a public
  // chain, or the Supabase pooler). Never silently accept self-signed endpoints.
  const rejectUnauthorized = process.env.PG_REJECT_UNAUTHORIZED !== 'false';
  return {
    connectionString,
    ssl: { rejectUnauthorized }
  };
}

module.exports = { buildPoolConfig };
