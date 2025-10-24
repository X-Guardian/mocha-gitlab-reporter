'use strict';

module.exports = {
  "env": {
    "node": true,
    "es2020": true,
  },
  "extends": "eslint:recommended",
  "rules": {
    "no-var": "error",
    "prefer-const": "error",
    "no-extra-semi": "warn",
    "semi": ["error", "always"],
    "space-in-parens": ["error", "never"],
    "space-infix-ops": "error",
    "strict": "error"
  }
};
