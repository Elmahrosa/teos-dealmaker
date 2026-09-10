// Validate TELEGRAM_BOT_TOKEN straight from .env — never prints the token.
// Usage: node scripts/bot-token-check.js [path-to-env]
const fs = require('fs');

const envPath = process.argv[2] || '.env';
let line = '';
try {
  line = fs.readFileSync(envPath, 'utf8').split('\n').find((l) => l.startsWith('TELEGRAM_BOT_TOKEN='));
} catch (e) {
  console.error('[bot-token-check] cannot read', envPath, '—', e.message);
  process.exit(1);
}
if (!line) {
  console.error('[bot-token-check] TELEGRAM_BOT_TOKEN not found in', envPath);
  process.exit(1);
}

const token = line.replace(/\r$/, '').split('#')[0].slice('TELEGRAM_BOT_TOKEN='.length).trim();
if (!token) {
  console.error('[bot-token-check] TELEGRAM_BOT_TOKEN is empty in', envPath);
  process.exit(1);
}

(async () => {
  try {
    const me = await (await fetch('https://api.telegram.org/bot' + token + '/getMe')).json();
    if (!me.ok) {
      console.error('[bot-token-check] getMe rejected:', me.description);
      process.exit(1);
    }
    console.log('[bot-token-check] getMe ok:', me.ok, '| username:', me.result.username, '| id:', me.result.id);

    const wh = await (await fetch('https://api.telegram.org/bot' + token + '/getWebhookInfo')).json();
    console.log('[bot-token-check] webhook:', 'pending_update_count=' + (wh.result && wh.result.pending_update_count), '| url=' + JSON.stringify(wh.result && wh.result.url));
  } catch (e) {
    console.error('[bot-token-check] network error —', e.message);
    process.exit(1);
  }
})();
