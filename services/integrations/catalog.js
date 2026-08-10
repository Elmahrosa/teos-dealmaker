const CATEGORIES = {
  crm: { label: 'CRM', capabilities: ['searchContacts', 'searchDeals'] },
  email: { label: 'Email', capabilities: ['sendMessage'] },
  calendar: { label: 'Calendar', capabilities: ['createMeeting'] },
  storage: { label: 'Storage', capabilities: ['storeDocument'] },
  website: { label: 'Website', capabilities: ['crawl', 'fetchKnowledge'] },
  communication: { label: 'Communication', capabilities: ['sendMessage'] }
};

const CONNECTORS = {
  hubspot: {
    id: 'hubspot', category: 'crm', label: 'HubSpot', auth: 'apikey', keyEnv: 'HUBSPOT_API_KEY',
    baseUrl: 'https://api.hubapi.com',
    searchContacts: { method: 'POST', path: '/crm/v3/objects/contacts/search', auth: 'Bearer', body: q => ({ filterGroups: [{ filters: [{ propertyName: 'email', operator: 'CONTAINS_TOKEN', value: q }] }], limit: 10 }) },
    searchDeals: { method: 'POST', path: '/crm/v3/objects/deals/search', auth: 'Bearer', body: q => ({ filterGroups: [{ filters: [{ propertyName: 'dealname', operator: 'CONTAINS_TOKEN', value: q }] }], limit: 10 }) }
  },
  salesforce: {
    id: 'salesforce', category: 'crm', label: 'Salesforce', auth: 'oauth', keyEnv: 'SALESFORCE_TOKEN',
    baseUrl: 'https://yourdomain.salesforce.com/services/data/v62.0',
    searchContacts: { method: 'GET', path: '/query', auth: 'Bearer', query: q => ({ q: `SELECT Id, Name, Company, Email FROM Contact WHERE Name LIKE '%${q}%' LIMIT 10` }) },
    searchDeals: { method: 'GET', path: '/query', auth: 'Bearer', query: q => ({ q: `SELECT Id, Name, Amount, StageName FROM Opportunity WHERE Name LIKE '%${q}%' LIMIT 10` }) }
  },
  zoho: {
    id: 'zoho', category: 'crm', label: 'Zoho CRM', auth: 'oauth', keyEnv: 'ZOHO_ACCESS_TOKEN',
    baseUrl: 'https://www.zohoapis.com/crm/v6',
    searchContacts: { method: 'GET', path: '/Contacts/search', auth: 'Bearer', query: q => ({ word: q, per_page: 10 }) },
    searchDeals: { method: 'GET', path: '/Deals/search', auth: 'Bearer', query: q => ({ word: q, per_page: 10 }) }
  },
  pipedrive: {
    id: 'pipedrive', category: 'crm', label: 'Pipedrive', auth: 'apikey', keyEnv: 'PIPEDRIVE_API_KEY',
    baseUrl: 'https://api.pipedrive.com/v1',
    searchContacts: { method: 'GET', path: '/searchResults', auth: 'Query', query: q => ({ term: q, item_type: 'person', limit: 10 }) },
    searchDeals: { method: 'GET', path: '/searchResults', auth: 'Query', query: q => ({ term: q, item_type: 'deal', limit: 10 }) }
  },
  gmail: {
    id: 'gmail', category: 'email', label: 'Gmail', auth: 'oauth', keyEnv: 'GMAIL_ACCESS_TOKEN',
    baseUrl: 'https://gmail.googleapis.com',
    sendMessage: { method: 'POST', path: '/gmail/v1/users/me/messages/send', auth: 'Bearer', body: ({ to, subject, body }) => ({ raw: Buffer.from(`To: ${to}\r\nSubject: ${subject}\r\n\r\n${body}`).toString('base64url') }) }
  },
  microsoft365: {
    id: 'microsoft365', category: 'email', label: 'Microsoft 365', auth: 'oauth', keyEnv: 'MS_ACCESS_TOKEN',
    baseUrl: 'https://graph.microsoft.com/v1.0',
    sendMessage: { method: 'POST', path: '/me/sendMail', auth: 'Bearer', body: ({ to, subject, body }) => ({ message: { subject, body: { contentType: 'text', content: body }, toRecipients: [{ emailAddress: { address: to } }] }, saveToSentItems: true }) }
  },
  resend: {
    id: 'resend', category: 'email', label: 'Resend', auth: 'apikey', keyEnv: 'RESEND_API_KEY',
    baseUrl: 'https://api.resend.com',
    sendMessage: { method: 'POST', path: '/emails', auth: 'Bearer', body: ({ to, subject, body, from }) => ({ from: from || 'sales@teos.ai', to: [to], subject, text: body }) }
  },
  sendgrid: {
    id: 'sendgrid', category: 'email', label: 'SendGrid', auth: 'apikey', keyEnv: 'SENDGRID_API_KEY',
    baseUrl: 'https://api.sendgrid.com/v3',
    sendMessage: { method: 'POST', path: '/mail/send', auth: 'Bearer', body: ({ to, subject, body, from }) => ({ personalizations: [{ to: [{ email: to }] }], from: { email: from || 'sales@teos.ai' }, subject, content: [{ type: 'text/plain', value: body }] }) }
  },
  google_calendar: {
    id: 'google_calendar', category: 'calendar', label: 'Google Calendar', auth: 'oauth', keyEnv: 'GCAL_ACCESS_TOKEN',
    baseUrl: 'https://www.googleapis.com/calendar/v3',
    createMeeting: { method: 'POST', path: '/calendars/primary/events', auth: 'Bearer', body: ({ title, start, end, attendee }) => ({ summary: title, start: { dateTime: start }, end: { dateTime: end }, attendees: attendee ? [{ email: attendee }] : [] }) }
  },
  outlook_calendar: {
    id: 'outlook_calendar', category: 'calendar', label: 'Outlook Calendar', auth: 'oauth', keyEnv: 'OUTLOOK_ACCESS_TOKEN',
    baseUrl: 'https://graph.microsoft.com/v1.0',
    createMeeting: { method: 'POST', path: '/me/events', auth: 'Bearer', body: ({ title, start, end, attendee }) => ({ subject: title, start: { dateTime: start, timeZone: 'UTC' }, end: { dateTime: end, timeZone: 'UTC' }, attendees: attendee ? [{ emailAddress: { address: attendee } }] : [] }) }
  },
  google_drive: {
    id: 'google_drive', category: 'storage', label: 'Google Drive', auth: 'oauth', keyEnv: 'GDRIVE_ACCESS_TOKEN',
    baseUrl: 'https://www.googleapis.com/upload/drive/v3',
    storeDocument: { method: 'POST', path: '/files?uploadType=media', auth: 'Bearer', body: ({ content }) => content }
  },
  onedrive: {
    id: 'onedrive', category: 'storage', label: 'OneDrive', auth: 'oauth', keyEnv: 'ONEDRIVE_ACCESS_TOKEN',
    baseUrl: 'https://graph.microsoft.com/v1.0',
    storeDocument: { method: 'PUT', path: '/me/drive/items/root:/documents/{name}:/content', auth: 'Bearer', body: ({ content }) => content }
  },
  dropbox: {
    id: 'dropbox', category: 'storage', label: 'Dropbox', auth: 'oauth', keyEnv: 'DROPBOX_ACCESS_TOKEN',
    baseUrl: 'https://content.dropboxapi.com/2',
    storeDocument: { method: 'POST', path: '/files/upload', auth: 'Bearer', headers: ({ name }) => ({ 'Dropbox-API-Arg': JSON.stringify({ path: `/documents/${name}`, mode: 'add' }) }), body: ({ content }) => content }
  },
  website: {
    id: 'website', category: 'website', label: 'Website Crawl', auth: 'none', keyEnv: null,
    baseUrl: 'https://{domain}',
    crawl: { method: 'GET', path: '/', auth: 'none', mode: 'crawl' }
  },
  github: {
    id: 'github', category: 'website', label: 'GitHub', auth: 'none', keyEnv: null,
    baseUrl: 'https://api.github.com',
    crawl: { method: 'GET', path: '/readme', auth: 'none', mode: 'crawl', headers: () => ({ Accept: 'application/vnd.github.raw+json', 'User-Agent': 'teos-dealmaker' }) }
  },
  telegram: {
    id: 'telegram', category: 'communication', label: 'Telegram', auth: 'apikey', keyEnv: 'TELEGRAM_BOT_TOKEN',
    baseUrl: 'https://api.telegram.org/bot{token}',
    sendMessage: { method: 'POST', path: '/sendMessage', auth: 'none', body: ({ to, body }) => ({ chat_id: to, text: body }) }
  },
  slack: {
    id: 'slack', category: 'communication', label: 'Slack', auth: 'oauth', keyEnv: 'SLACK_BOT_TOKEN',
    baseUrl: 'https://slack.com/api',
    sendMessage: { method: 'POST', path: '/chat.postMessage', auth: 'Bearer', body: ({ to, body }) => ({ channel: to, text: body }) }
  },
  teams: {
    id: 'teams', category: 'communication', label: 'Microsoft Teams', auth: 'oauth', keyEnv: 'TEAMS_ACCESS_TOKEN',
    baseUrl: 'https://graph.microsoft.com/v1.0',
    sendMessage: { method: 'POST', path: '/teams/{teamId}/channels/{channelId}/messages', auth: 'Bearer', body: ({ _to, body }) => ({ body: { contentType: 'text', content: body } }) }
  }
};

function isConfigured(connectorId) {
  const c = CONNECTORS[connectorId];
  if (!c) return false;
  if (c.keyEnv === null || c.keyEnv === undefined) return true;
  return Boolean(process.env[c.keyEnv]);
}

function byCategory(category) {
  return Object.values(CONNECTORS).filter(c => c.category === category);
}

module.exports = { CATEGORIES, CONNECTORS, isConfigured, byCategory };
