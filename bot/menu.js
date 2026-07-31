const audit = require('../utils/auditLogger');

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
    text: [
      '💳 <b>TEOS DealMaker - Sovereign Tiers</b>',
      '',
      'Deploy the full 12-agent court to automate your negotiation, closing, and contract generation.',
      '',
      '1. <b>Solo Operator</b> — Waitlist / Early Builders',
      '2. <b>Professional</b> — Full Suite ($199/mo, waitlist)',
      '3. <b>Enterprise</b> — White-glove setup ($999/mo, waitlist)',
      '',
      'Checkout is not enabled yet — payments are DRY-only.'
    ].join('\n')
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

function editPanel(bot, query, text) {
  return bot.editMessageText(text, {
    chat_id: query.message.chat.id,
    message_id: query.message.message_id,
    parse_mode: 'HTML',
    reply_markup: backKeyboard()
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
    editPanel(bot, query, panel.text).catch(() => {});
  }

  bot.answerCallbackQuery(query.id, { text: 'OK' }).catch(() => {});
}

module.exports = { WELCOME_TEXT, welcomeKeyboard, backKeyboard, handleCallback };
