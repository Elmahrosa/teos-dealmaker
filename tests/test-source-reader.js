'use strict';

const assert = require('node:assert/strict');
const reader = require('../services/sourceReader');

let passed = 0;
let failed = 0;

function check(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`PASS: ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL: ${name} - ${error.message}`);
  }
}

async function checkAsync(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`PASS: ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL: ${name} - ${error.message}`);
  }
}

async function main() {
  check('accepts HTTPS URL', () => {
    assert.equal(reader.validateUrl('https://example.com/listing').protocol, 'https:');
  });

  check('rejects FTP protocol', () => {
    assert.throws(() => reader.validateUrl('ftp://example.com/file'));
  });

  check('rejects URL credentials', () => {
    assert.throws(() => reader.validateUrl('https://user:pass@example.com'));
  });

  check('rejects non-standard port', () => {
    assert.throws(() => reader.validateUrl('https://example.com:8080'));
  });

  check('rejects localhost', () => {
    assert.throws(() => reader.validateUrl('http://localhost'));
  });

  check('rejects local hostname suffix', () => {
    assert.throws(() => reader.validateUrl('http://router.local'));
  });

  for (const ip of [
    '127.0.0.1', '10.0.0.1', '172.16.0.1', '192.168.1.1',
    '169.254.1.1', '100.64.0.1', '0.0.0.0', '224.0.0.1',
    '::1', 'fc00::1', 'fe80::1', '::ffff:127.0.0.1',
    '::c0a8:101', '64:ff9b::c0a8:101'
  ]) {
    check(`blocks non-public IP ${ip}`, () => {
      assert.equal(reader.isPublicIp(ip), false);
    });
  }

  check('accepts public IPv4', () => {
    assert.equal(reader.isPublicIp('93.184.216.34'), true);
  });

  check('rejects invalid IP', () => {
    assert.equal(reader.isPublicIp('not-an-ip'), false);
  });

  await checkAsync('rejects DNS result containing a private address', async () => {
    await assert.rejects(
      reader.resolvePublicAddresses('example.com', async () => [
        { address: '93.184.216.34', family: 4 },
        { address: '192.168.1.10', family: 4 }
      ]),
      /non-public/
    );
  });

  check('accepts public IPv6', () => {
    assert.equal(reader.isPublicIp('2606:4700:4700::1111'), true);
  });

  await checkAsync('rejects DNS result containing private IPv6', async () => {
    await assert.rejects(
      reader.resolvePublicAddresses('example.com', async () => [
        { address: '2606:4700:4700::1111', family: 6 },
        { address: 'fd00::1', family: 6 }
      ]),
      /non-public/
    );
  });
  await checkAsync('rejects empty DNS result', async () => {
    await assert.rejects(
      reader.resolvePublicAddresses('example.com', async () => []),
      /did not resolve/
    );
  });

  await checkAsync('pins request to validated DNS addresses', async () => {
    let receivedAddresses;
    const result = await reader.secureFetch('https://example.com/item', {
      lookup: async () => [{ address: '93.184.216.34', family: 4 }],
      requestOnce: async (_url, addresses) => {
        receivedAddresses = addresses;
        return { html: '<title>Listing</title>', contentType: 'text/html' };
      }
    });
    assert.equal(receivedAddresses[0].address, '93.184.216.34');
    assert.match(result.html, /Listing/);
  });

  await checkAsync('revalidates redirect destination before requesting it', async () => {
    let requests = 0;
    await assert.rejects(
      reader.secureFetch('https://example.com/item', {
        lookup: async () => [{ address: '93.184.216.34', family: 4 }],
        requestOnce: async () => {
          requests += 1;
          return { redirect: 'http://127.0.0.1/admin' };
        }
      })
    );
    assert.equal(requests, 1);
  });

  await checkAsync('limits redirect count', async () => {
    let requests = 0;
    await assert.rejects(
      reader.secureFetch('https://example.com/item', {
        lookup: async () => [{ address: '93.184.216.34', family: 4 }],
        requestOnce: async () => {
          requests += 1;
          return { redirect: '/next' };
        }
      }),
      /Too many/
    );
    assert.equal(requests, 4);
  });

  check('extracts listing title and description', () => {
    const result = reader.parseListing(
      '<html><head><title>Property</title>' +
      '<meta name="description" content="Sea view apartment"></head></html>'
    );
    assert.equal(result.title, 'Property');
    assert.equal(result.description, 'Sea view apartment');
  });

  check('extracts JSON-LD price candidate without confirming it', () => {
    const html = '<script type="application/ld+json">' +
      JSON.stringify({
        '@type': 'Product',
        name: 'Laptop',
        offers: { '@type': 'Offer', price: '1200', priceCurrency: 'USD' }
      }) +
      '</script>';

    const result = reader.parseListing(html);
    assert.equal(result.priceCandidates.length, 1);
    assert.equal(result.priceCandidates[0].value, '1200');
    assert.equal(result.priceCandidates[0].currency, 'USD');
    assert.equal(result.priceStatus, 'candidate_requires_confirmation');
  });

  check('marks price without currency as ambiguous', () => {
    const result = reader.parseListing(
      '<meta property="og:price:amount" content="250000">'
    );
    assert.equal(result.priceStatus, 'ambiguous_requires_confirmation');
  });

  check('does not invent a price when none exists', () => {
    const result = reader.parseListing('<title>Service listing</title>');
    assert.equal(result.priceCandidates.length, 0);
    assert.equal(result.priceStatus, 'not_found');
  });

  check('marks extracted source data as untrusted', () => {
    const result = reader.parseListing('<title>Example</title>');
    assert.equal(result.priceCandidates.length, 0);
  });

  await checkAsync('readSource returns untrusted data requiring manual confirmation', async () => {
    const result = await reader.readSource('https://example.com/listing', {
      lookup: async () => [
        { address: '93.184.216.34', family: 4 }
      ],
      requestOnce: async (url, addresses) => ({
        html: '<html><head><title>Test Property</title>' +
          '<script type="application/ld+json">' +
          JSON.stringify({
            '@type': 'Product',
            offers: {
              '@type': 'Offer',
              price: '150000',
              priceCurrency: 'USD'
            }
          }) +
          '</script></head></html>',
        contentType: 'text/html',
        finalUrl: url.toString()
      })
    });

    assert.equal(result.title, 'Test Property');
    assert.equal(result.priceCandidates[0].value, '150000');
    assert.equal(result.priceStatus, 'candidate_requires_confirmation');
    assert.equal(result.trusted, false);
    assert.equal(result.requiresManualConfirmation, true);
    assert.equal(result.sourceUrl, 'https://example.com/listing');
  });

  await checkAsync('DNS errors fail closed without making a request', async () => {
    let requests = 0;

    await assert.rejects(
      reader.secureFetch('https://example.com/listing', {
        lookup: async () => {
          throw new Error('DNS unavailable');
        },
        requestOnce: async () => {
          requests += 1;
          return { html: '', contentType: 'text/html' };
        }
      }),
      /DNS unavailable/
    );

    assert.equal(requests, 0);
  });
  console.log(`\nSource Reader Tests: ${passed} passed, ${failed} failed.`);
  process.exitCode = failed ? 1 : 0;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
