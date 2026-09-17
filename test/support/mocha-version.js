'use strict';

/**
 * Redirects `require('mocha')` to the aliased devDependency named by MOCHA_VERSION (mocha10, mocha11, mocha12), so the
 * CI matrix can test the reporter against each version. Loaded via `mocha --require` so it applies before the reporter
 * is imported. Does nothing when MOCHA_VERSION is unset.
 */

const Module = require('node:module');

const alias = process.env.MOCHA_VERSION ? 'mocha' + process.env.MOCHA_VERSION : '';

if (alias && alias !== 'mocha') {
  require.resolve(alias + '/package.json');

  const originalResolveFilename = Module._resolveFilename;

  Module._resolveFilename = function (request, ...rest) {
    const redirected =
      request === 'mocha' || request.startsWith('mocha/') ? alias + request.slice('mocha'.length) : request;

    return originalResolveFilename.call(this, redirected, ...rest);
  };
}

/**
 * Loads mocha's main export as a constructor. Node 22 returns a module namespace object for ESM mocha, where Node 24+
 * returns the constructor directly.
 * @returns {Function} The Mocha constructor
 */
function requireMocha() {
  const loaded = require('mocha');

  return typeof loaded === 'function' ? loaded : loaded.default;
}

module.exports = { requireMocha };
