'use strict';

// ============================================================================
// MOCHA GITLAB REPORTER CONSTANTS
// ============================================================================

/**
 * Default configuration values
 */
const DEFAULTS = {
  MOCHA_FILE: 'test-results.xml',
  ROOT_SUITE_NAME: 'Root Suite',
  ROOT_TESTSUITES_NAME: 'Mocha Tests',
  ATTACHMENTS: false,
  CONSOLE_REPORTER: null,
};

/**
 * Environment variable names
 */
const ENV_VARS = {
  MOCHA_FILE: 'MOCHA_FILE',
  ATTACHMENTS: 'ATTACHMENTS',
  CONSOLE_REPORTER: 'CONSOLE_REPORTER',
};

/**
 * File path placeholder patterns used in mochaFile option
 */
const PLACEHOLDERS = {
  HASH: '[hash]',
  SUITE_FILENAME: '[suiteFilename]',
  SUITE_NAME: '[suiteName]',
};

/**
 * File operation constants
 */
const FILE_CONSTANTS = {
  ENCODING: 'utf-8',
  HASH_ALGORITHM: 'sha256',
  HASH_DIGEST: 'hex',
  PACKAGE_JSON_PATH: '/package.json',
  MOCHA_STATS_COLLECTOR_PATH: 'mocha/lib/stats-collector',
};

/**
 * Error codes
 */
const ERROR_CODES = {
  FILE_NOT_FOUND: 'ENOENT',
};

/**
 * Transform property names
 */
const TRANSFORM_PROPS = {
  SEARCH: 'search',
  REPLACE: 'replace',
  PATTERN: 'pattern',
  RAW: 'raw',
  ERROR: 'error',
};

/**
 * Time conversion constants
 */
const TIME_CONVERSION = {
  MS_TO_SECONDS: 1000,
  DECIMAL_PLACES: 3,
};

/**
 * Mocha version requirements
 */
const MOCHA_VERSION = {
  MIN_FOR_STATS_COLLECTOR: 6,
  VERSION_INDEX_MAJOR: 0,
  RADIX: 10,
};

/**
 * XML formatting options
 */
const XML_OPTIONS = {
  INDENT: '  ',
  DECLARATION: true,
};

/**
 * A subset of invalid characters as defined in http://www.w3.org/TR/xml/#charsets
 * that can occur in e.g. stacktraces.
 * Regex lifted from https://github.com/MylesBorins/xml-sanitizer/ (licensed MIT)
 */
const INVALID_CHARACTERS_REGEX =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007f-\u0084\u0086-\u009f\uD800-\uDFFF\uFDD0-\uFDFF\uFFFF\uC008]/g; //eslint-disable-line no-control-regex
module.exports = {
  DEFAULTS,
  ENV_VARS,
  PLACEHOLDERS,
  FILE_CONSTANTS,
  ERROR_CODES,
  TRANSFORM_PROPS,
  TIME_CONVERSION,
  MOCHA_VERSION,
  XML_OPTIONS,
  INVALID_CHARACTERS_REGEX,
};
