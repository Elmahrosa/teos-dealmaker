// services/router/reply.js
// v1.1 natural-language reply builder (English + Arabic, native per language —
// not translation). Always ends with suggested next actions. Founder-internal
// menus are never offered to customers; billing/pricing/upsell is never shown
// to founders.
'use strict';

function fmtPlanStatus(status) {
  return String(status || 'planned');
}

function summaryOf(plan, steps) {
  if (!plan) return null;
  const done = (steps || []).filter((s) => s.status === 'completed').length;
  const total = (steps || []).length || plan.metrics?.total_steps || 0;
  return { status: fmtPlanStatus(plan.status), done, total };
}

function buildHelp(lang, isFounder) {
  const base = lang === 'ar'
    ? 'يمكنني تشغيل المبيعات، البحث عن عملاء، إنشاء مهام، تحديث حالة العملاء، وشرح ما يحدث في حساباتك.'
    : 'I can run sales, find customers, create missions, onboard new customers, and explain what is happening in your workspace.';
  const founderOnly = lang === 'ar'
    ? '\nيمكنني أيضاً إصلاح الأخطاء، وعرض التحليلات الداخلية، وتغيير الإعدادات.'
    : '\nI can also fix errors, show internal analytics, and change settings.';
  return base + (isFounder ? founderOnly : '');
}

function textFor(result, ctx, session) {
  const lang = result.data?.language || ctx.language || 'en';
  const ar = lang === 'ar';
  const d = result.data || {};
  switch (result.action) {
    case 'greeting':
      return ar
        ? `أهلا بك في TEOS DealMaker${ctx.isFounder ? ' يا مؤسس' : ''}.\nكيف يمكنني مساعدتك اليوم؟`
        : `Welcome to TEOS DealMaker${ctx.isFounder ? ', Founder' : ''}.\nHow can I help today?`;

    case 'help':
      return buildHelp(d.language, d.isFounder);

    case 'status': {
      const s = summaryOf(d.plan, d.steps);
      if (!s) {
        return ar
          ? 'لا توجد مهام بعد. أرسل «أنشئ مهمة: …» لبدء أول مهمة.'
          : 'No missions yet. Send "create mission: …" to start your first one.';
      }
      const title = d.plan?.title || 'Mission';
      if (ar) {
        return `الحالة: المهمة «${title}» ${s.status === 'completed' ? 'اكتملت' : s.status === 'running' ? 'تعمل الآن' : 'مجدولة'} (${s.done}/${s.total} خطوات).`;
      }
      return `Status: "${title}" is ${s.status} (${s.done}/${s.total} steps).`;
    }

    case 'analytics': {
      const open = (d.openDeals || []).length;
      const plans = (d.plans || []).length;
      const pending = (d.pending || []).length;
      const runs = (d.agentRuns || []).length;
      if (ar) {
        return `التحليلات: ${open} عميل مفتوح، ${plans} مهمة، ${runs} تنفيذ عامل، ${pending} موافقة معلقة.`;
      }
      return `Analytics: ${open} open customers, ${plans} missions, ${runs} agent runs, ${pending} pending approvals.`;
    }

    case 'run_sales':
    case 'continue': {
      const s = summaryOf(d.plan, d.steps);
      if (!s) return textFor({ action: 'need_plan', data: d }, ctx, session);
      const pending = (d.pendingApprovals || []).length;
      if (pending > 0) {
        if (ar) {
          return `المبيعات تعمل لكنها توقفت عند نقطة تحتاج موافقتك (${pending} طلب). أرسل «موافقة» للمتابعة.`;
        }
        return `Sales is running but paused at a founder-approval gate (${pending} request). Send "approve" to continue.`;
      }
      if (ar) {
        return `المبيعات ${s.status === 'completed' ? 'اكتملت' : 'تعمل'}: «${d.plan?.title}» (${s.done}/${s.total}).`;
      }
      return `Sales ${s.status === 'completed' ? 'completed' : 'running'}: "${d.plan?.title}" (${s.done}/${s.total}).`;
    }

    case 'create_mission': {
      const s = summaryOf(d.plan, d.steps);
      if (ar) {
        return `تم إنشاء المهمة «${d.plan?.title}» وتشغيلها (${s.done}/${s.total}). ${(d.pendingApprovals || []).length ? 'توقفت عند موافقة المؤسس.' : ''}`;
      }
      return `Mission "${d.plan?.title}" created and running (${s.done}/${s.total}).${(d.pendingApprovals || []).length ? ' Paused at a founder-approval gate.' : ''}`;
    }

    case 'new_customer':
      return ar
        ? `تمت إضافة العميل «${d.deal?.company_name}» إلى قنواتك. سيتولى فريق الاستطلاع تقييمه.`
        : `Customer "${d.deal?.company_name}" added to your pipeline. The prospecting team will qualify it.`;

    case 'find_customers':
    case 'deals': {
      const deals = d.deals || [];
      if (!deals.length) {
        return ar
          ? 'لا توجد عملاء مفتوحون حالياً. أرسل «إضافة عميل: …» أو «بحث عن عملاء».'
          : 'No open customers right now. Send "add customer: …" or "find customers".';
      }
      const names = deals.map((x) => `• ${x.company_name}`).join('\n');
      return ar ? `العملاء المفتوحون:\n${names}` : `Open customers:\n${names}`;
    }

    case 'revenue': {
      const open = (d.openDeals || []).length;
      const latest = d.latest;
      const completed = (latest && latest.metrics && latest.metrics.completed_steps) || 0;
      const total = (latest && latest.metrics && latest.metrics.total_steps) || 0;
      const conf = (latest && latest.metrics && latest.metrics.avg_confidence) || null;
      const pipeline = (d.plans || []).length;
      if (ar) {
        return `الإيرادات: ${open} عميل في القناة، ${pipeline} مهمة. آخر مهمة «${latest ? latest.title : '—'}» اكتمل ${completed}/${total}${conf !== null ? ' (ثقة ' + Math.round(conf * 100) + '٪)' : ''}.`;
      }
      return `Revenue: ${open} customers in pipeline, ${pipeline} missions. Latest mission "${latest ? latest.title : '—'}" at ${completed}/${total} steps${conf !== null ? ` (confidence ${Math.round(conf * 100)}%)` : ''}.`;
    }

    case 'talk_to_agent': {
      const entry = d.entry;
      if (!entry) {
        return ar
          ? 'اختر عاملاً من: باحث، استراتيجي، مبيعات، حارس، مسؤول إيرادات.'
          : 'Pick an agent: researcher, strategist, sales, gatekeeper, revenue manager.';
      }
      const role = ar && entry.roleAr ? entry.roleAr : entry.role;
      return ar
        ? `تحدثت مع «${entry.label}». ${role}\nأرسل طلبك وستتم معالجته بهذا العامل.`
        : `Now talking to ${entry.label}. ${role}\nSend your request and it will be handled by this agent.`;
    }

    case 'approve':
    case 'cancel': {
      const status = d.updated?.status;
      const ok = status === 'approved' ? (ar ? 'تمت الموافقة.' : 'Approved.') : (ar ? 'تم الإلغاء.' : 'Cancelled.');
      if (d.resumed?.plan) {
        const s = summaryOf(d.resumed.plan, d.resumed.steps);
        return ar
          ? `${ok} المهمة «${d.resumed.plan.title}» استؤنفت (${s.done}/${s.total}).`
          : `${ok} Mission "${d.resumed.plan.title}" resumed (${s.done}/${s.total}).`;
      }
      return ok;
    }

    case 'no_pending_approvals':
      return ar ? 'لا توجد طلبات موافقة معلقة حالياً.' : 'No pending approval requests right now.';

    case 'need_approval_choice':
      return ar
        ? `توجد ${(d.pending || []).length} موافقات معلقة. أرسل الرقم لكل واحدة (مثل: موافقة 123456).`
        : `There are ${(d.pending || []).length} pending approvals. Reply with its id, e.g. "approve 123456".`;

    case 'need_goal':
      return ar
        ? 'ما هو هدف المهمة؟ أرسل «أنشئ مهمة: هدفك هنا».'
        : 'What is the mission goal? Send "create mission: your goal here".';

    case 'need_customer_name':
      return ar
        ? 'ما اسم العميل؟ أرسل «إضافة عميل: الاسم».'
        : 'What is the customer name? Send "add customer: the name".';

    case 'need_plan':
      return ar
        ? 'لا توجد مهمة بعد. أرسل «أنشئ مهمة: …» لتبدأ، ثم «شغّل المبيعات».'
        : 'No mission yet. Send "create mission: …" to start, then "run sales".';

    case 'diagnostics': {
      if (ar) {
        return d.repair
          ? `واجهت خطأً: ${result.error || 'غير معروف'}.\nخطة الإصلاح: أعد المحاولة، تحقق من إعدادات المزود، أو أرسل «حالة» لمعرفة موقع التنفيذ.`
          : 'أجريت فحصاً. إن استمرت المشكلة أرسل «إصلاح الخطأ» وسأشخّصها بالتفصيل.';
      }
      return d.repair
        ? `Hit an error: ${result.error || 'unknown'}.\nRepair plan: retry, check provider settings, or send "status" to see where execution stopped.`
        : 'Ran a check. If the issue persists send "fix error" and I will diagnose it in detail.';
    }

    case 'settings':
      return ar ? 'تم تغيير اللغة إلى العربية.' : 'Language set to English.';

    case 'pricing':
      return ar
        ? 'يمكنك اختيار باقة مناسبة أو التواصل معنا للتفاصيل.'
        : 'You can pick a plan that fits you, or message us for details.';

    case 'no_pricing':
      return ar
        ? 'حسابك تحت السيطرة الكاملة — لا توجد خطط مدفوعة هنا.'
        : 'Your account is fully controlled — no paid plans here.';

    case 'blocked':
      return ar
        ? 'هذا الإجراء متاح لحسابك المؤسس فقط.'
        : 'That action is only available to the founder account.';

    case 'unknown':
    default:
      return ar
        ? 'لم أفهم ذلك بعد. جرّب: «شغّل المبيعات»، «بحث عن عملاء»، «الحالة»، أو «مساعدة».'
        : 'I did not get that yet. Try: "run sales", "find customers", "status", or "help".';
  }
}

function suggestionsFor(result, ctx) {
  const lang = ctx.language || 'en';
  const founder = ctx.isFounder;
  const S = {};
  if (lang === 'ar') {
    S.base = ['شغّل المبيعات', 'الحالة', 'مساعدة'];
    S.sales = ['الحالة', 'التحليلات', 'متابعة'];
    S.customer = ['بحث عن عملاء', 'شغّل المبيعات'];
    S.pending = ['موافقة', 'إلغاء', 'الحالة'];
    S.founder = ['إصلاح الخطأ', 'التحليلات', 'تحدث مع الباحث'];
  } else {
    S.base = ['Run sales', 'Status', 'Help'];
    S.sales = ['Status', 'Analytics', 'Continue'];
    S.customer = ['Find customers', 'Run sales'];
    S.pending = ['Approve', 'Cancel', 'Status'];
    S.founder = ['Fix error', 'Analytics', 'Talk to researcher'];
  }
  let list;
  switch (result.action) {
    case 'approve':
    case 'cancel':
    case 'continue':
    case 'no_pending_approvals':
    case 'run_sales':
      list = S.pending;
      break;
    case 'new_customer':
    case 'find_customers':
      list = S.customer;
      break;
    case 'status':
    case 'analytics':
      list = S.sales;
      break;
    default:
      list = S.base;
  }
  if (founder) list = [...new Set([...list, ...S.founder])];
  return list.slice(0, 6);
}

function build(result, ctx, session) {
  return {
    text: textFor(result, ctx, session),
    suggestions: suggestionsFor(result, ctx),
    action: result.action
  };
}

module.exports = { build, textFor, suggestionsFor };
