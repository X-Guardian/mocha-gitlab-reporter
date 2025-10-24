'use strict';

const { SPECIAL_PROPS, XML_ENTITIES, DEFAULTS, FORMAT } = require('./xml-constants');

// ============================================================================
// FUNCTIONS
// ============================================================================

/**
 * Escapes special XML characters in text content.
 * @param {string} str - The string to escape
 * @returns {string} The escaped string
 */
function escapeXml(str) {
  if (str == null) return '';
  let result = String(str);
  for (const [char, entity] of Object.entries(XML_ENTITIES)) {
    result = result.replaceAll(char, entity);
  }
  return result;
}

/**
 * Builds XML string from a JavaScript object structure.
 * Supports special keys: _attr for attributes, _cdata for CDATA sections.
 * @param {Object|Array} obj - The object structure to convert to XML
 * @param {Object} options - Options for XML generation
 * @param {boolean} options.declaration - Whether to include XML declaration
 * @param {string} options.indent - Indentation string (default: "  ")
 * @param {number} depth - Current indentation depth (internal use)
 * @returns {string} The generated XML string
 */
function buildXml(obj, options = {}, depth = FORMAT.INITIAL_DEPTH) {
  if (Array.isArray(obj)) {
    return obj.map((item) => buildXml(item, options, depth)).join('');
  }

  if (typeof obj !== 'object' || obj === null) {
    return escapeXml(obj);
  }

  let xml = '';

  for (const [key, value] of Object.entries(obj)) {
    if (key === SPECIAL_PROPS.ATTR) continue; // Handled by parent

    if (Array.isArray(value)) {
      // Check if this is a wrapper element (first item has _attr, rest are children)
      const hasWrapperPattern =
        value.length > 0 &&
        value[0]?.[SPECIAL_PROPS.ATTR] &&
        value.slice(1).some((item) => typeof item === 'object' && !item[SPECIAL_PROPS.ATTR]);

      if (hasWrapperPattern) {
        // Treat array as single element with attributes and children
        const indent = options.indent || DEFAULTS.INDENT;
        const indentStr = indent.repeat(depth);
        const attributes = Object.entries(value[0][SPECIAL_PROPS.ATTR])
          .map(([k, v]) => ` ${k}="${escapeXml(v)}"`)
          .join('');

        const childrenXml = value
          .slice(1)
          .map((item) => buildXml(item, options, depth + 1))
          .join('');
        xml += `${indentStr}<${key}${attributes}>\n${childrenXml}${indentStr}</${key}>\n`;
      } else {
        // Array of sibling elements with same tag name
        xml += value.map((item) => buildXmlElement(key, item, options, depth)).join('');
      }
    } else {
      xml += buildXmlElement(key, value, options, depth);
    }
  }

  return xml;
}

/**
 * Builds a single XML element.
 * @param {string} tagName - The tag name
 * @param {*} content - The element content
 * @param {Object} options - XML generation options
 * @param {number} depth - Current indentation depth
 * @returns {string} The generated XML element
 */
function buildXmlElement(tagName, content, options, depth) {
  const indent = options.indent || DEFAULTS.INDENT;
  const indentStr = indent.repeat(depth);

  // Handle null or undefined content (self-closing tag)
  if (content === null || content === undefined) {
    return `${indentStr}<${tagName}/>\n`;
  }

  // Handle primitive values
  if (typeof content !== 'object') {
    return `${indentStr}<${tagName}>${escapeXml(content)}</${tagName}>\n`;
  }

  // Handle objects with attributes and content
  let attributes = '';
  if (content[SPECIAL_PROPS.ATTR]) {
    attributes = Object.entries(content[SPECIAL_PROPS.ATTR])
      .map(([key, val]) => ` ${key}="${escapeXml(val)}"`)
      .join('');
  }

  // Handle CDATA content
  if (content[SPECIAL_PROPS.CDATA] !== undefined) {
    return `${indentStr}<${tagName}${attributes}><![CDATA[${content[SPECIAL_PROPS.CDATA]}]]></${tagName}>\n`;
  }

  // Check if there's actual content (excluding _attr)
  const contentKeys = Object.keys(content).filter((k) => k !== SPECIAL_PROPS.ATTR);

  if (contentKeys.length === 0) {
    // Empty element with attributes - use opening and closing tags
    return `${indentStr}<${tagName}${attributes}>\n${indentStr}</${tagName}>\n`;
  }

  // Handle nested content
  const innerXml = buildXml(content, options, depth + 1);

  // Check if inner content is simple (no newlines) for compact format
  const trimmedInner = innerXml.trim();
  if (!trimmedInner.includes('\n') && trimmedInner.length < FORMAT.COMPACT_MAX_LENGTH) {
    return `${indentStr}<${tagName}${attributes}>${trimmedInner}</${tagName}>\n`;
  }

  return `${indentStr}<${tagName}${attributes}>\n${innerXml}${indentStr}</${tagName}>\n`;
}

/**
 * Converts an object structure to XML string with optional declaration.
 * Main entry point for XML generation.
 * @param {Object} obj - The object to convert
 * @param {Object} options - Generation options
 * @param {boolean} options.declaration - Include XML declaration
 * @param {string} options.indent - Indentation string
 * @returns {string} Complete XML document
 */
function toXml(obj, options = {}) {
  let xml = '';

  if (options.declaration) {
    xml += `<?xml version="${DEFAULTS.VERSION}" encoding="${DEFAULTS.ENCODING}"?>\n`;
  }

  xml += buildXml(obj, options, FORMAT.INITIAL_DEPTH);

  return xml;
}

module.exports = {
  escapeXml,
  buildXml,
  buildXmlElement,
  toXml,
};
