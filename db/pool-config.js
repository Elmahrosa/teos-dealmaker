function buildPoolConfig(url) {
  const connectionString = url || process.env.DATABASE_URL;
  if (!connectionString) return null;
  const requiresSSL =
    /supabase\.co/i.test(connectionString) ||
    /sslmode=require/.test(connectionString) ||
    process.env.PGSSLMODE === 'require';
  if (!requiresSSL) return { connectionString };
  // Certificate verification is ON by default. Only disable explicitly via
  // PG_REJECT_UNAUTHORIZED=false (e.g. a trusted private CA without a public
  // chain). Never silently accept self-signed endpoints.
  const rejectUnauthorized = process.env.PG_REJECT_UNAUTHORIZED !== 'false';
  return {
    connectionString,
    ssl: { rejectUnauthorized }
  };
}

module.exports = { buildPoolConfig };
