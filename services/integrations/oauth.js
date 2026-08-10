const { CONNECTORS } = require('./catalog');
const { hash } = require('../providers');

const REDIRECT_URI = process.env.OAUTH_REDIRECT_URI || 'https://dealmaker.elmahrosa.org/integrations/oauth/callback';

function oauthProvider(connectorId) {
  const oauthBase = {
    hubspot: 'https://app.hubspot.com/oauth/authorize',
    salesforce: 'https://login.salesforce.com/services/oauth2/authorize',
    zoho: 'https://accounts.zoho.com/oauth/v2/auth',
    gmail: 'https://accounts.google.com/o/oauth2/auth',
    google_calendar: 'https://accounts.google.com/o/oauth2/auth',
    google_drive: 'https://accounts.google.com/o/oauth2/auth',
    microsoft365: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    outlook_calendar: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    onedrive: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    teams: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    slack: 'https://slack.com/oauth/v2/authorize',
    dropbox: 'https://www.dropbox.com/oauth2/authorize',
    pipedrive: 'https://oauth.pipedrive.com/oauth/authorize'
  };
  return oauthBase[connectorId] || null;
}

function beginAuth(connectorId, userId) {
  const c = CONNECTORS[connectorId];
  if (!c || c.auth !== 'oauth') return { url: null, state: null, connector: connectorId, oauth: false };
  const provider = oauthProvider(connectorId);
  if (!provider) return { url: null, state: null, connector: connectorId, oauth: false };
  const state = `teos_${hash(`${connectorId}|${userId}|${Date.now()}`).toString(16)}`;
  const params = new URLSearchParams({
    client_id: process.env[`${connectorId.toUpperCase()}_CLIENT_ID`] || `client_id_${connectorId}`,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    state,
    scope: oauthScope(connectorId)
  });
  return { url: `${provider}?${params.toString()}`, state, connector: connectorId, oauth: true };
}

function oauthScope(connectorId) {
  const scopes = {
    hubspot: 'crm.objects.contacts.read crm.objects.deals.read',
    salesforce: 'api',
    zoho: 'ZohoCRM.modules.ALL',
    gmail: 'https://www.googleapis.com/auth/gmail.send',
    google_calendar: 'https://www.googleapis.com/auth/calendar.events',
    google_drive: 'https://www.googleapis.com/auth/drive.file',
    microsoft365: 'Mail.Send offline_access',
    outlook_calendar: 'Calendars.ReadWrite offline_access',
    onedrive: 'Files.ReadWrite offline_access',
    teams: 'ChannelMessage.Send offline_access',
    slack: 'chat:write',
    dropbox: 'files.content.write',
    pipedrive: 'contacts:read deals:read'
  };
  return scopes[connectorId] || '';
}

function exchange(connectorId, code) {
  const c = CONNECTORS[connectorId];
  if (!c || c.auth !== 'oauth') return { ok: false, connector: connectorId, reason: 'not_oauth' };
  if (!code) return { ok: false, connector: connectorId, reason: 'missing_code' };
  const token = `mock_${hash(`${connectorId}|${code}`).toString(36)}`;
  return { ok: true, connector: connectorId, access_token: token, expires_in: 3600, simulated: true };
}

async function tokenFor(adapter, workspaceId, connectorId) {
  const repos = require('../../db/repos').createRepos(adapter);
  const conn = await repos.integrations.get(workspaceId, connectorId);
  if (conn && conn.config && conn.config.access_token) return conn.config.access_token;
  return null;
}

async function storeToken(adapter, workspaceId, connectorId, token) {
  const repos = require('../../db/repos').createRepos(adapter);
  const conn = await repos.integrations.get(workspaceId, connectorId);
  const config = (conn && conn.config) || {};
  return repos.integrations.upsert(workspaceId, connectorId, { config: { ...config, access_token: token } });
}

module.exports = { beginAuth, exchange, tokenFor, storeToken, oauthProvider };
