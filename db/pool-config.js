function buildPoolConfig(url) {
  const connectionString = url || process.env.DATABASE_URL;
  if (!connectionString) return null;
  const requiresSSL =
    /supabase\.co/i.test(connectionString) ||
    /sslmode=require/.test(connectionString) ||
    process.env.PGSSLMODE === 'require';
  return {
    connectionString,
    ...(requiresSSL ? { ssl: { rejectUnauthorized: false } } : {})
  };
}

module.exports = { buildPoolConfig };
