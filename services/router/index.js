// services/router/index.js
// v1.1 AI Revenue Operating System router facade.
'use strict';

const intent = require('./intent');
const memory = require('./memory');
const context = require('./context');
const executor = require('./executor');
const reply = require('./reply');
const router = require('./router');

module.exports = {
  handleText: router.handleText,
  detect: intent.detect,
  memory,
  context,
  executor,
  reply,
  router
};
