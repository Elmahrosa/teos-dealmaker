'use strict';

const dns = require('node:dns').promises;
const http = require('node:http');
const https = require('node:https');
const net = require('node:net');
const { BlockList } = require('node:net');

const MAX_BYTES = 1024 * 1024;
const TIMEOUT_MS = 10000;
const MAX_REDIRECTS = 3;

const blockedIPv4 = new BlockList();
const blockedIPv6 = new BlockList();

function addBlockedRanges(ranges, family) {
  ranges.forEach((range) => {
    const [network, prefix] = range.split('/');
    const target = family === 'ipv4' ? blockedIPv4 : blockedIPv6;
    target.addSubnet(network, Number(prefix), family);
  });
}

addBlockedRanges([
  '0.0.0.0/8', '10.0.0.0/8', '100.64.0.0/10',
  '127.0.0.0/8', '169.254.0.0/16', '172.16.0.0/12',
  '192.0.0.0/24', '192.0.2.0/24', '192.88.99.0/24',
  '192.168.0.0/16', '198.18.0.0/15', '198.51.100.0/24',
  '203.0.113.0/24', '224.0.0.0/4', '240.0.0.0/4'
], 'ipv4');

addBlockedRanges([
  '::/96', '::ffff:0:0/96', '64:ff9b::/96',
  '64:ff9b:1::/48', '100::/64', '2001:db8::/32',
  '2001::/23', '2002::/16', 'fc00::/7',
  'fe80::/10', 'ff00::/8'
], 'ipv6');

function normalizeHostname(hostname) {
  return String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
}

function isPublicIp(address) {
  const version = net.isIP(address);
  if (!version) return false;
  const list = version === 4 ? blockedIPv4 : blockedIPv6;
  return !list.check(address, version === 4 ? 'ipv4' : 'ipv6');
}

function validateUrl(input) {
  let url;
  try {
    url = new URL(input);
  } catch (err) {
    throw new Error('Invalid source URL', { cause: err });
  }

  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('Only HTTP and HTTPS URLs are allowed');
  }
  if (url.username || url.password) {
    throw new Error('URLs containing credentials are not allowed');
  }
  if (url.port && !['80', '443'].includes(url.port)) {
    throw new Error('Non-standard ports are not allowed');
  }

  const hostname = normalizeHostname(url.hostname);
  if (!hostname || hostname === 'localhost' ||
      /\.(localhost|local|internal|test|invalid|example)$/.test(hostname)) {
    throw new Error('Local or reserved hostnames are not allowed');
  }

  url.hash = '';
  return url;
}

async function resolvePublicAddresses(hostname, lookup = dns.lookup) {
  const host = normalizeHostname(hostname);
  const literalVersion = net.isIP(host);

  let records;
  if (literalVersion) {
    records = [{ address: host, family: literalVersion }];
  } else {
    records = await lookup(host, { all: true, verbatim: true });
  }

  if (!Array.isArray(records) || records.length === 0) {
    throw new Error('Hostname did not resolve');
  }

  for (const record of records) {
    if (!record || !isPublicIp(record.address)) {
      throw new Error('Source host resolves to a non-public IP address');
    }
  }

  return records;
}

function requestOnce(url, addresses) {
  return new Promise((resolve, reject) => {
    const transport = url.protocol === 'https:' ? https : http;
    const hostname = normalizeHostname(url.hostname);
    const pinned = addresses.slice();
    let settled = false;

    const lookup = (_hostname, options, callback) => {
      const all = options && options.all;
      if (all) {
        callback(null, pinned.map((entry) => ({
          address: entry.address,
          family: entry.family
        })));
      } else {
        callback(null, pinned[0].address, pinned[0].family);
      }
    };

    const req = transport.request({
      protocol: url.protocol,
      hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      method: 'GET',
      path: `${url.pathname}${url.search}`,
      headers: {
        'User-Agent': 'TEOS-DealMaker-SourceReader/1.0',
        Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9',
        'Accept-Encoding': 'identity',
        Connection: 'close'
      },
      lookup,
      servername: net.isIP(hostname) ? undefined : hostname,
      timeout: TIMEOUT_MS,
      agent: false
    }, (res) => {
      const status = res.statusCode || 0;
      const location = res.headers.location;

      if ([301, 302, 303, 307, 308].includes(status) && location) {
        res.resume();
        finish(null, { redirect: location });
        return;
      }

      if (status < 200 || status >= 300) {
        res.resume();
        finish(new Error(`Source returned HTTP ${status}`));
        return;
      }

      const type = String(res.headers['content-type'] || '').toLowerCase();
      if (!/(text\/html|application\/xhtml\+xml|text\/plain)/.test(type)) {
        res.resume();
        finish(new Error('Source is not an HTML or text page'));
        return;
      }

      const chunks = [];
      let total = 0;

      res.on('data', (chunk) => {
        total += chunk.length;
        if (total > MAX_BYTES) {
          req.destroy(new Error('Source response exceeds size limit'));
          return;
        }
        chunks.push(chunk);
      });

      res.on('end', () => {
        finish(null, {
          html: Buffer.concat(chunks).toString('utf8'),
          contentType: type,
          finalUrl: url.toString()
        });
      });

      res.on('error', finish);
    });

    function finish(error, value) {
      if (settled) return;
      settled = true;
      if (error) reject(error);
      else resolve(value);
    }

    req.on('timeout', () => req.destroy(new Error('Source request timed out')));
    req.on('error', finish);
    req.end();
  });
}

async function secureFetch(input, options = {}) {
  let url = validateUrl(input);

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const addresses = await resolvePublicAddresses(
      url.hostname,
      options.lookup || dns.lookup
    );

    const result = await (options.requestOnce || requestOnce)(url, addresses);

    if (!result.redirect) return result;
    if (hop === MAX_REDIRECTS) {
      throw new Error('Too many source redirects');
    }

    url = validateUrl(new URL(result.redirect, url).toString());
  }

  throw new Error('Source fetch failed');
}

function cleanText(value) {
  return String(value || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 2000);
}

function parseAttributes(tag) {
  const attrs = {};
  const pattern = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/g;
  let match;
  while ((match = pattern.exec(tag))) {
    attrs[match[1].toLowerCase()] = match[3] || match[4] || match[5] || '';
  }
  return attrs;
}

function parseListing(html) {
  const source = String(html || '');
  const metadata = {};
  const candidates = [];

  for (const match of source.matchAll(/<meta\b[^>]*>/gi)) {
    const attrs = parseAttributes(match[0]);
    const key = (attrs.property || attrs.name || attrs.itemprop || '').toLowerCase();
    const value = cleanText(attrs.content);
    if (key && value) metadata[key] = value;

    if (/^(product:price:amount|og:price:amount|price|priceamount)$/i.test(key)) {
      candidates.push({
        value,
        currency: attrs.currency || attrs['product:price:currency'] ||
          metadata['product:price:currency'] || null,
        source: key
      });
    }
  }

  for (const match of source.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const parsed = JSON.parse(match[1].trim());
      const nodes = Array.isArray(parsed) ? parsed : [parsed];
      const queue = [...nodes];

      while (queue.length) {
        const node = queue.shift();
        if (!node || typeof node !== 'object') continue;
        if (Array.isArray(node)) {
          queue.push(...node);
          continue;
        }
        if (node['@graph']) queue.push(...[].concat(node['@graph']));
        const type = [].concat(node['@type'] || []).join(' ').toLowerCase();

        if (/product|offer|realestate|apartment|house/.test(type)) {
          const offer = node.offers || node;
          const offers = Array.isArray(offer) ? offer : [offer];

          for (const item of offers) {
            if (!item || typeof item !== 'object') continue;
            if (item.price !== undefined) {
              candidates.push({
                value: String(item.price),
                currency: item.priceCurrency || null,
                source: 'json-ld'
              });
            }
          }
        }
      }
    } catch (_) {
      // Malformed page metadata is ignored; it is never executed.
    }
  }

  const titleMatch = source.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  const title = metadata['og:title'] ||
    metadata['twitter:title'] ||
    cleanText(titleMatch && titleMatch[1]) || null;

  const description = metadata.description ||
    metadata['og:description'] ||
    metadata['twitter:description'] || null;

  const uniqueCandidates = [];
  const seen = new Set();

  for (const item of candidates) {
    const key = `${item.value}|${item.currency || ''}|${item.source}`;
    if (!seen.has(key)) {
      seen.add(key);
      uniqueCandidates.push(item);
    }
  }

  return {
    title,
    description,
    priceCandidates: uniqueCandidates,
    priceStatus: uniqueCandidates.length === 0
      ? 'not_found'
      : uniqueCandidates.length === 1 && uniqueCandidates[0].currency
        ? 'candidate_requires_confirmation'
        : 'ambiguous_requires_confirmation'
  };
}

async function readSource(input, options = {}) {
  const result = await secureFetch(input, options);
  return {
    sourceUrl: result.finalUrl,
    contentType: result.contentType,
    ...parseListing(result.html),
    trusted: false,
    requiresManualConfirmation: true
  };
}

module.exports = {
  validateUrl,
  isPublicIp,
  resolvePublicAddresses,
  secureFetch,
  parseListing,
  readSource
};
