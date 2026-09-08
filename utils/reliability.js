'use strict';

// Process-level reliability safety net.
//
// Node >=15 crashes by default on uncaught exceptions and unhandled
// rejections; these handlers make that behaviour loud and intentional so a
// supervised entrypoint (scripts/prod.js, Railway) can observe the failure and
// restart a clean process instead of continuing from a half-dead one.
//
// The web server, bot and production supervisor all install this at startup.
// It does NOT swallow errors — it logs the full stack/reason, then exits(1).

function install(name) {
  process.on('uncaughtException', (err) => {
    console.error(`[${name}] uncaughtException:`, err && err.stack ? err.stack : err);
    process.exit(1);
  });

  process.on('unhandledRejection', (reason) => {
    console.error(`[${name}] unhandledRejection:`, reason && reason.stack ? reason.stack : reason);
    process.exit(1);
  });
}

module.exports = { install };
