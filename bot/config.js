const path = require('path');
if (process.env.NODE_ENV !== 'test') require('dotenv').config();

const BOT_CONFIG = {
  token: process.env.TELEGRAM_BOT_TOKEN || '',
  botName: process.env.BOT_NAME || 'TeosEgypt_bot',
  adminIds: (process.env.TELEGRAM_ADMIN_IDS || '')
    .split(',').map(s => s.trim()).filter(Boolean).map(Number).filter(n => !isNaN(n)),
  founderId: process.env.TEOS_FOUNDER_TELEGRAM_ID
    ? Number(process.env.TEOS_FOUNDER_TELEGRAM_ID)
    : null,
  modeFilePath: path.resolve(process.cwd(), 'data', 'mode.json')
};

module.exports = { BOT_CONFIG };
