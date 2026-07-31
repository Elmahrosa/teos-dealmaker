const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const PREFS_FILE = path.join(DATA_DIR, 'prefs.json');

let prefs = {};
try {
  prefs = JSON.parse(fs.readFileSync(PREFS_FILE, 'utf8'));
} catch (_) {
  prefs = {};
}

function persist() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(PREFS_FILE, JSON.stringify(prefs, null, 2), 'utf8');
  } catch (err) {
    console.error('[i18n] persist failed:', err.message);
  }
}

function getLang(userId) {
  return (prefs[userId] && prefs[userId].lang) || 'en';
}

function setLang(userId, lang) {
  prefs[userId] = prefs[userId] || {};
  prefs[userId].lang = lang;
  persist();
}

function getPref(userId, key, fallback) {
  const value = prefs[userId] && prefs[userId][key];
  return value === undefined || value === null ? fallback : value;
}

function setPref(userId, key, value) {
  prefs[userId] = prefs[userId] || {};
  prefs[userId][key] = value;
  persist();
}

const EN = {
  wl_title: '👋 Welcome to TEOS Dealmaker',
  wl_sub: 'AI Revenue Workforce',
  wl_lead: 'Grow revenue with coordinated AI specialists.',
  wl_help_intro: 'TEOS Dealmaker helps your organization:',
  wl_b1: 'Discover prospects',
  wl_b2: 'Qualify opportunities',
  wl_b3: 'Automate outreach',
  wl_b4: 'Coordinate sales workflows',
  wl_b5: 'Generate proposals',
  wl_b6: 'Track pipeline activity',
  wl_b7: 'Support customer follow-up',
  wl_b8: 'Monitor revenue performance',
  wl_control: 'Your team stays in control.',
  wl_ai: 'AI handles repetitive work.',
  wl_choose: 'Choose an option',

  nav_home: 'Home',
  nav_plans: 'Plans',
  nav_guide: 'AI Guide',
  nav_commands: 'Commands',
  nav_subscription: 'Subscription',
  nav_settings: 'Settings',
  nav_support: 'Support',
  nav_admin: 'Admin',

  btn_get_started: '🚀 Get Started',
  btn_plans: '💰 Plans',
  btn_guide: '🤖 AI Guide',
  btn_subscription: '📦 Subscription',
  btn_settings: '⚙ Settings',
  btn_revenue: '📈 Revenue',
  btn_back_home: '← Home',

  dash_title: 'TEOS Dealmaker',
  dash_sub: 'Workspace',
  dash_plan: 'Plan',
  dash_mode: 'Mode',
  dash_lang: 'Language',
  dash_ai_ready: 'AI Ready',
  dash_sub_status: 'Subscription',
  val_ready: 'Ready',
  val_active: 'Active',
  val_not_configured: 'Not configured',
  val_dry: 'DRY',
  val_live: 'LIVE',

  plans_title: 'Plans',
  plans_sub: 'Transparent pricing · Dodo checkout',
  choose_monthly: 'Choose Monthly',
  choose_annual: 'Choose Annual',
  save_annual: 'Save $%s annually',
  recommended: '⭐ Recommended',

  sub_title: 'Subscription',
  sub_current: 'Current plan',
  sub_status: 'Status',
  sub_start: 'Start date',
  sub_renewal: 'Renewal',
  sub_cycle: 'Billing cycle',
  sub_refund: 'Refund eligibility',
  sub_invoices: 'Invoices',
  sub_note: 'No entitlement service is configured, so subscription data is unavailable. Refund eligibility can only be confirmed once a real plan is active. View Plans or contact Support.',

  guide_title: 'AI Guide',
  guide_intro: 'I am your advisory Customer Success Manager. I explain features, plans, pricing, billing, and onboarding. I cannot change settings, grant permissions, or activate LIVE mode.',
  guide_fallback: 'I can help you with:',
  guide_t_features: 'How the AI agents work together',
  guide_t_plans: 'Which plan fits your team',
  guide_t_pricing: 'Monthly, annual, and savings',
  guide_t_billing: 'Billing, invoices, and refunds',
  guide_t_agents: 'The 12-agent AI workforce',
  guide_t_setup: 'Onboarding and getting started',
  guide_a_features: 'Orchestrator, Prospecting, Market Intelligence, Qualification, Outreach, Strategist, Marketer, Sales, Negotiator, Treasurer, Gatekeeper, and Closing cooperate across the sales lifecycle. The Treasurer drafts contracts and issues Dodo checkout links.',
  guide_a_plans: 'Solo Operator suits founders, Growth Team suits growing teams, and Corporate is for enterprise scale. Annual billing saves the most. You can review every option under Plans.',
  guide_a_pricing: 'Solo Operator is $99/mo or $950/yr, Growth Team is $249/mo or $2,390/yr, and Corporate is $799/mo or $7,600/yr. Annual plans include built-in savings.',
  guide_a_billing: 'Payments are routed through Dodo checkout. Until a LIVE Dodo key is configured, payments run in DRY mode and no charges occur.',
  guide_a_agents: 'The workforce covers the full funnel: lead scoring, BANT qualification, outreach review, playbooks, positioning, objection handling, negotiation, contracting, checkout, gatekeeping, and closing.',
  guide_a_setup: 'Open Settings to set your language, then explore Plans, Subscription, and the AI Guide. Founder controls live in the Admin console.',
  guide_advisory: 'I am advisory only. I cannot execute privileged commands.',

  settings_title: 'Settings',
  settings_language: 'Language',
  settings_theme: 'Theme',
  settings_timezone: 'Timezone',
  settings_notifications: 'Notifications',
  settings_workspace: 'Workspace',
  settings_profile: 'Profile',
  settings_account: 'Account',
  settings_value: '%s: %s',
  theme_system: 'System',
  theme_dark: 'Dark',
  theme_light: 'Light',
  tz_utc: 'UTC',
  tz_utc2: 'UTC+2',
  tz_utc3: 'UTC+3',
  tz_utc5: 'UTC-5',
  tz_utc8: 'UTC-8',
  notif_on: 'On',
  notif_off: 'Off',
  lang_en: 'English',
  lang_ar: 'العربية',

  support_title: 'Support',
  support_body: 'Contact: info@elmahrosa.com\nTelegram: @TeosEgypt_bot',

  cmd_title: 'Commands',
  cmd_general: 'General',
  cmd_founder: 'Founder',
  cmd_g_list: '/start · /help · /plans · /pricing · /subscription · /settings · /ask',
  cmd_f_list: '/admin · /live · /dry · /addadmin · /removeadmin · /audit · /health · /users · /roles · /revenue',

  rev_title: 'Revenue',
  rev_closed: 'Closed deals (audit):',
  rev_note: 'No live revenue figures. Payments are DRY-only until a LIVE Dodo key is configured.',

  admin_title: 'Founder Console',
  admin_health: 'System Health',
  admin_audit: 'Audit Log',
  admin_webhook: 'Webhook Status',
  admin_payments: 'Payment Status',
  admin_ai: 'AI Provider Status',
  admin_workers: 'Worker Status',
  admin_revenue: 'Revenue',
  admin_users: 'Users',
  admin_roles: 'Roles',
  admin_logs: 'Logs',
  admin_danger: 'Danger Zone',
  st_webhook: 'Webhook: not configured (Planned)',
  st_payments: 'DODO_API_KEY not set — DRY-only mock active',
  st_ai: 'Local rule-based engine — no external AI provider',
  st_workers: 'In-process agents (12)',
  danger_title: 'Danger Zone',
  danger_intro: 'Destructive operations require confirmation.',
  danger_clear: 'Clear audit log',
  danger_reset: 'Reset mode to DRY',
  danger_confirm_clear: 'Erase the entire audit log? This cannot be undone.',
  danger_confirm_reset: 'Reset mode to DRY? Live dispatch will be disabled.',
  confirm_yes: 'Confirm',
  confirm_no: 'Cancel',

  health_title: 'System Health',
  health_entries: 'Audit entries',
  health_last: 'Last activity',
  health_bot: 'Bot',
  health_ts: 'Timestamp',
  val_none: '—',

  audit_title: 'Audit Log',
  audit_sub: 'Immutable activity feed',

  help_unknown: 'I can help you with:',
  help_items: 'Pricing · Plans · Features · AI Workforce · Getting Started · Billing · Revenue Automation',
  help_free_text: 'You can also pick an option below.'
};

const AR = {
  wl_title: '👋 مرحباً بك في تيوس ديلماكر',
  wl_sub: 'القوى العاملة للذكاء الاصطناعي للمبيعات',
  wl_lead: 'نمِّ إيراداتك مع متخصصين متناسقين في الذكاء الاصطناعي.',
  wl_help_intro: 'يساعد تيوس ديلماكر مؤسستك على:',
  wl_b1: 'اكتشاف العملاء المحتملين',
  wl_b2: 'تأهيل الفرص',
  wl_b3: 'أتمتة التواصل',
  wl_b4: 'تنسيق سير عمل المبيعات',
  wl_b5: 'إنشاء المقترحات',
  wl_b6: 'تتبع نشاط خط الصفقات',
  wl_b7: 'دعم متابعة العملاء',
  wl_b8: 'مراقبة أداء الإيرادات',
  wl_control: 'فريقك يبقى مسيطراً.',
  wl_ai: 'الذكاء الاصطناعي يتكفل بالأعمال المتكررة.',
  wl_choose: 'اختر خياراً',

  nav_home: 'الرئيسية',
  nav_plans: 'الخطط',
  nav_guide: 'دليل الذكاء',
  nav_commands: 'الأوامر',
  nav_subscription: 'الاشتراك',
  nav_settings: 'الإعدادات',
  nav_support: 'الدعم',
  nav_admin: 'الإدارة',

  btn_get_started: '🚀 ابدأ الآن',
  btn_plans: '💰 الخطط',
  btn_guide: '🤖 دليل الذكاء',
  btn_subscription: '📦 الاشتراك',
  btn_settings: '⚙ الإعدادات',
  btn_revenue: '📈 الإيرادات',
  btn_back_home: '← الرئيسية',

  dash_title: 'تيوس ديلماكر',
  dash_sub: 'مساحة العمل',
  dash_plan: 'الخطة',
  dash_mode: 'الوضع',
  dash_lang: 'اللغة',
  dash_ai_ready: 'جاهزية الذكاء',
  dash_sub_status: 'الاشتراك',
  val_ready: 'جاهز',
  val_active: 'نشط',
  val_not_configured: 'غير مكوّن',
  val_dry: 'تجريبي',
  val_live: 'مباشر',

  plans_title: 'الخطط',
  plans_sub: 'أسعار شفافة · دفع عبر دودو',
  choose_monthly: 'اختر شهرياً',
  choose_annual: 'اختر سنوياً',
  save_annual: 'وفّر %s$ سنوياً',
  recommended: '⭐ موصى به',

  sub_title: 'الاشتراك',
  sub_current: 'الخطة الحالية',
  sub_status: 'الحالة',
  sub_start: 'تاريخ البداية',
  sub_renewal: 'التجديد',
  sub_cycle: 'دورة الفوترة',
  sub_refund: 'أهلية الاسترداد',
  sub_invoices: 'الفواتير',
  sub_note: 'لا توجد خدمة أهلية مكوّنة، لذا بيانات الاشتراك غير متوفرة. تتأكد أهلية الاسترداد فقط عند تفعيل خطة حقيقية. راجع الخطط أو تواصل مع الدعم.',

  guide_title: 'دليل الذكاء',
  guide_intro: 'أنا مدير نجاح العملاء الاستشاري. أشرح الميزات والخطط والأسعار والفوترة والإعداد. لا أستطيع تغيير الإعدادات أو منح الصلاحيات أو تفعيل الوضع المباشر.',
  guide_fallback: 'يمكنني مساعدتك في:',
  guide_t_features: 'كيف تعمل وكلاء الذكاء معاً',
  guide_t_plans: 'ما الخطة المناسبة لفريقك',
  guide_t_pricing: 'الأسعار الشهرية والسنوية والوفورات',
  guide_t_billing: 'الفوترة والفواتير والاسترداد',
  guide_t_agents: 'القوى العاملة المكوّنة من 12 وكيلاً',
  guide_t_setup: 'الإعداد وبدء الاستخدام',
  guide_a_features: 'يتعاون المنسّق والاستكشاف والاستخبارات والتأهيل والتواصل والاستراتيجي والتسويق والمبيعات والمفاوض والخزينة والحارس والإغلاق عبر دورة حياة البيع. صياغة العقود وروابط دفع دودو تتولاها الخزينة.',
  guide_a_plans: 'خطة سولو للمؤسسين، وخطة النمو للفرق المتنامية، وخطة الشركات للنطاق المؤسسي. الفوترة السنوية توفر الأكثر. يمكنك مراجعة كل خيار ضمن الخطط.',
  guide_a_pricing: 'خطة سولو 99$ شهرياً أو 950$ سنوياً، وخطة النمو 249$ شهرياً أو 2390$ سنوياً، وخطة الشركات 799$ شهرياً أو 7600$ سنوياً. الخطط السنوية تتضمن وفورات مدمجة.',
  guide_a_billing: 'تمر المدفوعات عبر دفع دودو. حتى ضبط مفتاح دودو المباشر، تعمل المدفوعات في الوضع التجريبي دون أي خصم.',
  guide_a_agents: 'تغطي القوى العاملة كامل مسار البيع: تقييم العملاء، تأهيل BANT، مراجعة التواصل، خطط اللعب، التموضع، معالجة الاعتراضات، التفاوض، العقود، الدفع، الحوكمة، والإغلاق.',
  guide_a_setup: 'افتح الإعدادات لتحديد اللغة، ثم استكشف الخطط والاشتراك ودليل الذكاء. أدوات المؤسس في وحدة الإدارة.',
  guide_advisory: 'أنا استشاري فقط ولا أنفذ أوامر مقيّدة.',

  settings_title: 'الإعدادات',
  settings_language: 'اللغة',
  settings_theme: 'السمة',
  settings_timezone: 'المنطقة الزمنية',
  settings_notifications: 'الإشعارات',
  settings_workspace: 'مساحة العمل',
  settings_profile: 'الملف الشخصي',
  settings_account: 'الحساب',
  settings_value: '%s: %s',
  theme_system: 'تلقائي',
  theme_dark: 'داكن',
  theme_light: 'فاتح',
  tz_utc: 'UTC',
  tz_utc2: 'UTC+2',
  tz_utc3: 'UTC+3',
  tz_utc5: 'UTC-5',
  tz_utc8: 'UTC-8',
  notif_on: 'مفعّل',
  notif_off: 'معطّل',
  lang_en: 'English',
  lang_ar: 'العربية',

  support_title: 'الدعم',
  support_body: 'التواصل: info@elmahrosa.com\nتيليجرام: @TeosEgypt_bot',

  cmd_title: 'الأوامر',
  cmd_general: 'عام',
  cmd_founder: 'المؤسس',
  cmd_g_list: '/start · /help · /plans · /pricing · /subscription · /settings · /ask',
  cmd_f_list: '/admin · /live · /dry · /addadmin · /removeadmin · /audit · /health · /users · /roles · /revenue',

  rev_title: 'الإيرادات',
  rev_closed: 'الصفقات المغلقة (سجل المراجعة):',
  rev_note: 'لا توجد أرقام إيرادات حقيقية. المدفوعات تجريبية فقط حتى ضبط مفتاح دودو المباشر.',

  admin_title: 'وحدة المؤسس',
  admin_health: 'صحة النظام',
  admin_audit: 'سجل المراجعة',
  admin_webhook: 'حالة الويب هوك',
  admin_payments: 'حالة الدفع',
  admin_ai: 'حالة مزود الذكاء',
  admin_workers: 'حالة العمال',
  admin_revenue: 'الإيرادات',
  admin_users: 'المستخدمون',
  admin_roles: 'الأدوار',
  admin_logs: 'السجلات',
  admin_danger: 'منطقة الخطر',
  st_webhook: 'الويب هوك: غير مكوّن (مخطط)',
  st_payments: 'مفتاح دودو غير مضبوط — الوضع التجريبي فعّال',
  st_ai: 'محرك محلي قائم على القواعد — لا مزود ذكاء خارجي',
  st_workers: 'وكلاء ضمن العملية (12)',
  danger_title: 'منطقة الخطر',
  danger_intro: 'تتطلب العمليات المدمرة تأكيداً.',
  danger_clear: 'مسح سجل المراجعة',
  danger_reset: 'إعادة الوضع إلى تجريبي',
  danger_confirm_clear: 'هل تريد مسح سجل المراجعة بالكامل؟ لا يمكن التراجع.',
  danger_confirm_reset: 'إعادة الوضع إلى تجريبي؟ سيُعطَّل الإرسال المباشر.',
  confirm_yes: 'تأكيد',
  confirm_no: 'إلغاء',

  health_title: 'صحة النظام',
  health_entries: 'عدد سجلات المراجعة',
  health_last: 'آخر نشاط',
  health_bot: 'البوت',
  health_ts: 'الطابع الزمني',
  val_none: '—',

  audit_title: 'سجل المراجعة',
  audit_sub: 'خلاصة نشاط غير قابل للتغيير',

  help_unknown: 'يمكنني مساعدتك في:',
  help_items: 'الأسعار · الخطط · الميزات · القوى العاملة · البدء · الفوترة · أتمتة الإيرادات',
  help_free_text: 'يمكنك أيضاً اختيار خيار أدناه.'
};

const LANGS = { en: EN, ar: AR };

function t(userId, key) {
  const lang = getLang(userId);
  const dict = LANGS[lang] || EN;
  return dict[key] !== undefined ? dict[key] : (EN[key] !== undefined ? EN[key] : key);
}

function sprintf(template) {
  const args = Array.prototype.slice.call(arguments, 1);
  return template.replace(/%s/g, () => args.shift());
}

module.exports = {
  t,
  sprintf,
  getLang,
  setLang,
  getPref,
  setPref,
  LANGS
};
