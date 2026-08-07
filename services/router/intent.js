// services/router/intent.js
// v1.1 natural-language intent detection (English + Arabic, native per language).
// Maps every founder/customer message to an intent + platform capability so the
// Sentinel/Policy gate can rule on it before anything executes.
'use strict';

const AR_SCRIPT = /[\u0600-\u06FF]/;

const PATTERNS = [
  {
    intent: 'greeting',
    capability: 'greeting',
    en: [/^(hi|hello|hey|salam|assalamu[ -]alaikum|good\s+(morning|evening|day)|yo)\b/i],
    ar: [/^(السلام عليكم|وعليكم السلام|سلام|أهلين|أهلا|مرحبا|صباح الخير|مساء الخير)/]
  },
  {
    intent: 'create_mission',
    capability: 'mission.create',
    en: [/^(create|start|new|launch|open)\b.{0,20}\b(mission|plan)\b/i, /^(mission|plan)\b.{0,20}(to\b|for\b)?/i],
    ar: [/(إنشاء|أطلق|ابدأ|بدء|مهمة جديدة).{0,12}(مهمة)?/, /^مهمة/]
  },
  {
    intent: 'new_customer',
    capability: 'customer.create',
    en: [/^(add|create|new|capture|register|onboard)\b.{0,15}\b(customer|client|lead|company|prospect)\b/i, /^new customer\b/i],
    ar: [/(إضافة|إنشاء|تسجيل|أضف|ضيف|عميل جديد).{0,12}(عميل|زبون|شركة)?/, /^عميل جديد/]
  },
  {
    intent: 'find_customers',
    capability: 'research.prospects',
    en: [/^(find|search|get|target|research|discover|show)\b.{0,15}\b(customers|clients|leads|prospects|companies|accounts)\b/i, /^find customers/i, /^(my\s+)?customers$/i],
    ar: [/(ابحث|بحث|إيجاد|استهدف|اكتشف).{0,12}(عن\s)?(عملاء|زبائن|شركات|leads)/, /^العملاء/]
  },
  {
    intent: 'run_sales',
    capability: 'mission.run',
    en: [/^(run|start|go|launch|execute|begin|activate)\b.{0,15}\b(sales|the\s+sales)\b/i, /^run sales/i],
    ar: [/(تشغيل|شغّل|شغل|ابدأ|أطلق|فعّل).{0,12}(المبيعات|البيع|مبيعات)/, /^بيع/]
  },
  {
    intent: 'campaign',
    capability: 'mission.run',
    en: [/^(run|start|launch|build|create)\b.{0,10}\bcampaign\b/i, /^campaign\b/i],
    ar: [/(أطلق|ابدأ|شغّل|أنشئ).{0,10}(حملة|حملة تسويقية)/, /^حملة/]
  },
  {
    intent: 'deals',
    capability: 'deals.view',
    en: [/^(my\s+)?(deals|pipeline|opportunities|open deals)\b/i, /^my deals/i],
    ar: [/(صفقاتي|عروضي|قنواتي|الفرص)/, /^الصفقات/]
  },
  {
    intent: 'revenue',
    capability: 'analytics.view',
    en: [/^(show|view|see|what is|my|get)\b.{0,10}\brevenue\b/i, /\brevenue forecast\b/i, /^revenue\b/i],
    ar: [/(أظهر|اعرض|أرني|ما).{0,8}(الإيرادات|الإيراد|العائدات)/, /^الإيرادات/]
  },
  {
    intent: 'create_mission',
    capability: 'mission.create',
    en: [/^(research|generate|sell|contact|build)\b.{2,60}$/i]
  },
  {
    intent: 'talk_to_agent',
    capability: 'agent.talk',
    en: [/^(talk|speak|chat|ask|consult|contact)\b.{0,12}(to\s)?(the\s)?(researcher|strategist|sales|gatekeeper|sentinel|revenue\s*manager|closer|prospector|qualifier|treasurer)\b/i, /^(researcher|strategist|sales agent|gatekeeper|sentinel|closer|prospector)\b/i],
    ar: [/(تحدث|كلم|اسأل|استشر).{0,12}(مع\s)?(باحث|استراتيجي|مبيعات|حارس|sentinel|مدير إيرادات|مصفف|مغلق)/, /^(باحث|استراتيجي|حارس)/]
  },
  {
    intent: 'status',
    capability: 'mission.status',
    en: [/^(status|what('| i)?s going on|what happened|how (is|are) (things|missions|deals|it going))\b/i, /^show me (the )?(status|dashboard|missions|progress)/i, /^status\b/i],
    ar: [/(ماذا حدث|ما الجديد|ما الأخبار|الحالة|أظهر|أرني|لوحة)/, /^الحالة/]
  },
  {
    intent: 'analytics',
    capability: 'analytics.view',
    en: [/^(show|give|view|see)\b.{0,12}\b(analytics|metrics|reports|numbers|kpis?)\b/i, /^analytics\b/i, /^reports?\b/i],
    ar: [/(أظهر|اعرض|أرني).{0,10}(تحليلات|تقارير|مؤشرات|أرقام)/, /^(ال)?تحليلات/]
  },
  {
    intent: 'error_report',
    capability: 'diagnostics.run',
    en: [/^(why|how come|y)\b.{0,20}\b(isn't|is not|doesn't|does not|won't|will not|not)\b.{0,15}\b(work|working|running|start)\b/i, /^(fix|debug|check)\b.{0,12}\b(error|bug|issue|problem)\b/i, /\b(error|broken|failed|not working)\b/i],
    ar: [/(لماذا|ليش).{0,15}(لا يعمل|لا تشتغل|معطل)/, /(إصلاح|خطأ|عطل|مشكلة|لا يعمل)/]
  },
  {
    intent: 'approve',
    capability: 'approval.decide',
    en: [/^(approve|accept|confirm|yes|ok|okay|go ahead)\b/i],
    ar: [/(موافقة|موافق|أوافق|تأكيد|نعم|تمام)/, /^وافق/]
  },
  {
    intent: 'cancel',
    capability: 'mission.cancel',
    en: [/^(cancel|stop|abort|reject|no|dismiss)\b/i],
    ar: [/(إلغاء|إلغي|أوقف|ارفض|لا)/, /^إلغاء/]
  },
  {
    intent: 'continue',
    capability: 'mission.resume',
    en: [/^(continue|resume|proceed|next|go on|keep going)\b/i],
    ar: [/(متابعة|استمر|أكمل|التالي|واصل)/, /^متابعة/]
  },
  {
    intent: 'settings',
    capability: 'settings.update',
    en: [/^(settings|language|lang|change language)\b/i, /^(arabic|english|عربي|انجليزي|إنجليزي)\b/i],
    ar: [/(إعدادات|لغة|تغيير اللغة|عربي|انجليزي)/]
  },
  {
    intent: 'pricing',
    capability: 'billing.view',
    en: [/^(show|see|what (is|are)|get)\b.{0,10}\b(pricing|plans|upgrade|subscription|billing|payment|trial|purchase)\b/i, /^(pricing|plans|upgrade|subscribe|purchase|buy|trial|payment|billing)\b/i],
    ar: [/(الأسعار|باقات|اشتراك|ترقية|دفع|تجربة)/]
  },
  {
    intent: 'help',
    capability: 'help.show',
    en: [/^(help|commands|what can you do|menu|options)\b/i],
    ar: [/(مساعدة|الأوامر|ماذا يمكنك أن تفعل|القائمة|خيارات)/, /^مساعدة/]
  }
];

function detectLanguage(text) {
  return AR_SCRIPT.test(text) ? 'ar' : 'en';
}

function extractParams(intent, text) {
  const params = {};
  const t = String(text || '').trim();
  if (intent === 'new_customer') {
    const en = t.match(/(?:customer|client|company|prospect|lead)\s*:?\s+([\w\s.-]+)/i);
    if (en && en[1]) params.name = en[1].trim().replace(/[.?!]+$/, '');
    const ar = t.match(/(?:عميل|زبون|شركة)\s*:?\s+([\u0600-\u06FF\w\s.-]+)/);
    if (ar && ar[1]) params.name = ar[1].trim().replace(/[.?!]+$/, '');
  }
  if (intent === 'create_mission') {
    const en = t.match(/(?:mission|campaign|plan)\s*:?\s+(?:to\s+|for\s+)?([\w\s.,-]{4,})/i);
    if (en && en[1]) params.goal = en[1].trim().replace(/[.?!]+$/, '');
    const ar = t.match(/(?:مهمة|حملة)\s*:?\s+([\u0600-\u06FF\w\s.,-]{4,})/);
    if (ar && ar[1]) params.goal = ar[1].trim().replace(/[.?!]+$/, '');
    if (!params.goal && /^(research|generate|sell|contact|build)\b/i.test(t)) params.goal = t;
  }
  if (intent === 'approve' || intent === 'cancel') {
    const id = t.match(/\b(\d{6,})\b/);
    if (id) params.requestId = Number(id[1]);
  }
  if (intent === 'talk_to_agent') {
    const agents = ['researcher', 'strategist', 'sales', 'gatekeeper', 'sentinel', 'closer', 'prospector', 'qualifier', 'treasurer', 'revenue'];
    const hit = agents.find((a) => new RegExp(`\\b${a}`, 'i').test(t));
    if (hit) params.agent = hit;
  }
  if (intent === 'settings') {
    if (/\b(english|arabic)\b/i.test(t)) params.language = /\barabic\b/i.test(t) ? 'ar' : 'en';
    if (/(عربي)/.test(t)) params.language = 'ar';
    if (/(انجليزي|إنجليزي|english)/i.test(t)) params.language = 'en';
  }
  return params;
}

function detect(rawText) {
  const text = String(rawText || '').trim();
  const language = detectLanguage(text);
  if (!text) return { intent: 'unknown', capability: null, language, confidence: 0.1, params: {} };
  for (const p of PATTERNS) {
    const rex = language === 'ar' ? p.ar : p.en;
    if (rex && rex.some((re) => re.test(text))) {
      const params = extractParams(p.intent, text);
      return { intent: p.intent, capability: p.capability, language, confidence: 0.9, params };
    }
  }
  return { intent: 'unknown', capability: null, language, confidence: 0.2, params: {} };
}

module.exports = { detect, detectLanguage, PATTERNS };
