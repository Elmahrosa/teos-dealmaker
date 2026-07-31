const audit = require('../utils/auditLogger');
const { formatPricingText, pricingButtons } = require('../config/pricing.config');

const WELCOME_TEXT = [
  '🏛️ <b>ELMAHROSA SOVEREIGN ECOSYSTEM</b>',
  '',
  'Welcome to TEOS DealMaker Command Center.',
  '',
  'The 12-agent autonomous workforce and BVAP vault are online. Select a directive:'
].join('\n');

function welcomeKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: '✨ Features', callback_data: 'btn_features' },
        { text: '💳 Pricing & Tiers', callback_data: 'btn_pricing' }
      ],
      [
        { text: '⚡ Live Demo', callback_data: 'btn_demo' },
        { text: '🤝 Affiliate', callback_data: 'btn_affiliate' }
      ],
      [
        { text: '📞 Contact', callback_data: 'btn_contact' },
        { text: '📚 Docs', callback_data: 'btn_docs' }
      ]
    ]
  };
}

function backKeyboard() {
  return { inline_keyboard: [[{ text: '⬅️ Back to Menu', callback_data: 'btn_back' }]] };
}

const PANELS = {
  btn_features: {
    text: [
      '✨ <b>Core Features</b>',
      '',
      '- 12 Autonomous Agents (Orchestrator, Sales, Gatekeeper, Treasurer, etc.)',
      '- BVAP Audit Vault (JSON log to data/vault/audit.log)',
      '- BANT Qualification Engine',
      '- Dodo Payments stub (DRY-only until a LIVE key is configured)'
    ].join('\n')
  },
  btn_pricing: {
    text: formatPricingText(),
    keyboard: () => ({
      inline_keyboard: [
        ...pricingButtons().inline_keyboard,
        [{ text: '⬅️ Back to Menu', callback_data: 'btn_back' }]
      ]
    })
  },
  btn_demo: {
    text: [
      '⚡ <b>Live Demo</b>',
      '',
      'Test the Sales and Gatekeeper pipeline right now.',
      '',
      'Type a command like:',
      '<code>/sales The price is too high for my budget.</code>'
    ].join('\n')
  },
  btn_affiliate: {
    text: '🤝 <b>Affiliate</b>\n\nModule is currently restricted or in development.'
  },
  btn_contact: {
    text: '📞 <b>Contact</b>\n\nElmahrosa International — info@elmahrosa.com\n\nModule is currently restricted or in development.'
  },
  btn_docs: {
    text: '📚 <b>Docs</b>\n\nSee the README in the teos-dealmaker repository. Module UI is in development.'
  }
};

function editPanel(bot, query, text, keyboard) {
  return bot.editMessageText(text, {
    chat_id: query.message.chat.id,
    message_id: query.message.message_id,
    parse_mode: 'HTML',
    reply_markup: keyboard || backKeyboard()
  });
}

function handleCallback(query, bot) {
  const action = query.data || '';
  const userId = query.from ? query.from.id : null;

  audit.writeEntry('BOT_CALLBACK', action, 'success', { userId });

  if (action === 'btn_back') {
    bot.editMessageText(WELCOME_TEXT, {
      chat_id: query.message.chat.id,
      message_id: query.message.message_id,
      parse_mode: 'HTML',
      reply_markup: welcomeKeyboard()
    }).catch(() => {});
  } else {
    const panel = PANELS[action];
    if (!panel) {
      bot.answerCallbackQuery(query.id, { text: 'Unknown action' }).catch(() => {});
      return;
    }
    editPanel(bot, query, panel.text, panel.keyboard ? panel.keyboard() : null).catch(() => {});
  }

  bot.answerCallbackQuery(query.id, { text: 'OK' }).catch(() => {});
}

module.exports = { WELCOME_TEXT, welcomeKeyboard, backKeyboard, handleCallback };
