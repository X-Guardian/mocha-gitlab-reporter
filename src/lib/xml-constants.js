'use strict';

// ============================================================================
// XML BUILDER CONSTANTS
// ============================================================================

/**
 * Special property names used in XML object structure
 */
const SPECIAL_PROPS = {
  ATTR: '_attr',
  CDATA: '_cdata',
};

/**
 * XML entity replacements for escaping special characters
 */
const XML_ENTITIES = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&apos;',
};

/**
 * Default XML formatting options
 */
const DEFAULTS = {
  INDENT: '  ',
  VERSION: '1.0',
  ENCODING: 'UTF-8',
};

/**
 * Formatting thresholds
 */
const FORMAT = {
  COMPACT_MAX_LENGTH: 80, // Maximum length for single-line compact format
  INITIAL_DEPTH: 0,
};

module.exports = {
  SPECIAL_PROPS,
  XML_ENTITIES,
  DEFAULTS,
  FORMAT,
};

