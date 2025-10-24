'use strict';

const mocha = require('mocha');
const Base = mocha.reporters.Base;
const fs = require('node:fs');
const path = require('node:path');
const debug = require('debug')('mocha-gitlab-reporter');
const crypto = require('node:crypto');
const stripAnsi = require('strip-ansi');
const { toXml } = require('./lib/xml-builder');
const {
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
} = require('./constants');

// Save timer references so that times are correct even if Date is stubbed.
// See https://github.com/mochajs/mocha/issues/237
const GlobalDate = globalThis.Date;

let createStatsCollector;
let mocha6plus = false;

try {
  const json = JSON.parse(
    fs.readFileSync(path.dirname(require.resolve('mocha')) + FILE_CONSTANTS.PACKAGE_JSON_PATH, FILE_CONSTANTS.ENCODING)
  );
  const version = json.version;
  const majorVersion = Number.parseInt(version.split('.')[MOCHA_VERSION.VERSION_INDEX_MAJOR], MOCHA_VERSION.RADIX);
  if (majorVersion >= MOCHA_VERSION.MIN_FOR_STATS_COLLECTOR) {
    createStatsCollector = require(FILE_CONSTANTS.MOCHA_STATS_COLLECTOR_PATH);
    mocha6plus = true;
  } else {
    mocha6plus = false;
  }
} catch (error_) {
  // best-effort: if mocha package.json can't be read we continue with defaults
  console.warn("Couldn't determine Mocha version", error_);
}

/**
 * Configure default options for the reporter by combining reporter options with environment variables.
 * @param {Object} options - Options passed to the reporter
 * @param {Object} [options.reporterOptions] - Reporter-specific options
 * @param {string} [options.reporterOptions.mochaFile] - Path to output XML file
 * @param {boolean} [options.reporterOptions.attachments] - Whether to include attachments
 * @param {boolean} [options.reporterOptions.toConsole] - Whether to output XML to console
 * @param {string} [options.reporterOptions.consoleReporter] - Name of console reporter to use alongside XML
 * @param {string} [options.reporterOptions.filePathTransforms] - File path transformation rules
 * @returns {Object} The complete configuration object with all options resolved
 * @throws {TypeError} If filePathTransforms has invalid format
 */
function configureDefaults(options) {
  debug('configureDefaults: Received Mocha options:', JSON.stringify(options, null, 2));
  const config = options?.reporterOptions ?? {};
  debug('configureDefaults: Extracted reporter options:', JSON.stringify(config, null, 2));
  config.mochaFile = getSetting(config.mochaFile, ENV_VARS.MOCHA_FILE, DEFAULTS.MOCHA_FILE);
  config.attachments = getSetting(config.attachments, ENV_VARS.ATTACHMENTS, DEFAULTS.ATTACHMENTS);
  config.toConsole = !!config.toConsole;
  config.consoleReporter = getSetting(config.consoleReporter, ENV_VARS.CONSOLE_REPORTER, DEFAULTS.CONSOLE_REPORTER);

  // Normalize to array of pattern pairs
  let transforms = [];

  // Check if filePathTransforms string is provided
  if (config.filePathTransforms) {
    let filePathTransforms = config.filePathTransforms;

    // filePathTransforms must be a string
    if (typeof filePathTransforms !== 'string') {
      throw new TypeError(
        "filePathTransforms must be a string value. Use pipe-delimited format like: \"[{search: '^build/'| replace: 'src/'}]\""
      );
    }

    // Replace pipes with commas to support CLI-friendly format
    // Example: "[{search: '^build/'| replace: 'src/'}|{search: '^src/'| replace: 'src2/'}]"
    // becomes: "[{search: '^build/', replace: 'src/'},{search: '^src/', replace: 'src2/'}]"
    filePathTransforms = filePathTransforms.split(/\|\s*/).join(',');

    // Convert shorthand property names to quoted names for valid JSON
    // Replace 'search:' with '"search":' and 'replace:' with '"replace":'
    filePathTransforms = filePathTransforms.replaceAll(
      new RegExp(`(\\{|\\s)${TRANSFORM_PROPS.SEARCH}:`, 'g'),
      `$1"${TRANSFORM_PROPS.SEARCH}":`
    );
    filePathTransforms = filePathTransforms.replaceAll(
      new RegExp(`(\\{|\\s|,)${TRANSFORM_PROPS.REPLACE}:`, 'g'),
      `$1"${TRANSFORM_PROPS.REPLACE}":`
    );

    // Convert single quotes to double quotes for string values
    // Handle backslashes properly - they need to be escaped for JSON
    filePathTransforms = filePathTransforms.replaceAll(/:\s*'([^']*)'/g, function (match, content) {
      // Escape backslashes for JSON (\ becomes \\)
      const escaped = content.replaceAll('\\', '\\\\');
      return ': "' + escaped + '"';
    });

    transforms = parseFilePathTransforms(filePathTransforms);
  }

  // Pre-compile regex patterns to avoid recompiling on every test case
  config.filePathTransforms = compileFilePathTransforms(transforms);

  debug('configureDefaults: Final configuration:', {
    mochaFile: config.mochaFile,
    attachments: config.attachments,
    toConsole: config.toConsole,
    consoleReporter: config.consoleReporter,
    filePathTransforms: config.filePathTransforms,
  });
  return config;
}

/**
 * Parse file path transformation rules from input string.
 * Accepts either JSON format or pipe-delimited CLI-friendly format.
 * @param {string} input - File path transform rules in JSON or pipe-delimited format
 * @returns {Array<{search: string, replace: string}>} Array of transformation rules
 * @throws {TypeError} If input is invalid JSON or missing required properties
 * @example
 * // JSON format
 * parseFilePathTransforms('[{"search": "^build/", "replace": "src/"}]')
 * // Pipe-delimited format
 * parseFilePathTransforms('{search: "^build/"| replace: "src/"}')
 */
function parseFilePathTransforms(input) {
  // Accept a JSON string or the CLI friendly pipe-delimited format already normalized
  let parsed;
  try {
    parsed = JSON.parse(input);
  } catch (e) {
    // Not valid JSON; rethrow a clearer error for the caller
    throw new TypeError('filePathTransforms must be valid JSON. Error: ' + e.message);
  }

  if (Array.isArray(parsed)) {
    for (const [index, transform] of parsed.entries()) {
      if (!transform?.[TRANSFORM_PROPS.SEARCH] || !transform?.[TRANSFORM_PROPS.REPLACE]) {
        throw new TypeError(
          `filePathTransforms[${index}] must have both '${TRANSFORM_PROPS.SEARCH}' and '${TRANSFORM_PROPS.REPLACE}' properties.`
        );
      }
    }
    return parsed;
  }

  if (typeof parsed === 'object' && parsed !== null) {
    if (!parsed[TRANSFORM_PROPS.SEARCH] || !parsed[TRANSFORM_PROPS.REPLACE]) {
      throw new TypeError(
        `filePathTransforms must have both '${TRANSFORM_PROPS.SEARCH}' and '${TRANSFORM_PROPS.REPLACE}' properties.`
      );
    }
    return [parsed];
  }

  throw new TypeError('filePathTransforms has unsupported format');
}

/**
 * Compile file path transformation rules into regex patterns.
 * Pre-compiles regex patterns for performance to avoid recompiling on every test case.
 * @param {Array<{search: string, replace: string}>} transforms - Array of transformation rules
 * @returns {Array<{pattern: RegExp, replace: string, raw: Object}>} Array of compiled transforms
 * @example
 * compileFilePathTransforms([{search: "^build/", replace: "src/"}])
 * // Returns: [{pattern: /^build\//, replace: "src/", raw: {search: "^build/", replace: "src/"}}]
 */
function compileFilePathTransforms(transforms) {
  return transforms.map((transform, index) => {
    try {
      if (
        typeof transform[TRANSFORM_PROPS.SEARCH] !== 'string' ||
        typeof transform[TRANSFORM_PROPS.REPLACE] !== 'string'
      ) {
        throw new TypeError(
          `Transform entry must have string '${TRANSFORM_PROPS.SEARCH}' and '${TRANSFORM_PROPS.REPLACE}' properties`
        );
      }
      return {
        [TRANSFORM_PROPS.PATTERN]: new RegExp(transform[TRANSFORM_PROPS.SEARCH]),
        [TRANSFORM_PROPS.REPLACE]: transform[TRANSFORM_PROPS.REPLACE],
        [TRANSFORM_PROPS.RAW]: transform, // Keep original for debugging
      };
    } catch (error) {
      debug(`compileFilePathTransforms: Failed to compile transform[${index}]:`, {
        transform,
        error: error.message,
        stack: error.stack,
      });
      // Return a transform that will be skipped (invalid pattern)
      return {
        [TRANSFORM_PROPS.PATTERN]: null,
        [TRANSFORM_PROPS.REPLACE]: transform[TRANSFORM_PROPS.REPLACE],
        [TRANSFORM_PROPS.RAW]: transform,
        [TRANSFORM_PROPS.ERROR]: error.message,
      };
    }
  });
}

/**
 * Check if a reporter name is safe to require dynamically.
 * Only allows alphanumeric characters and limited special characters.
 * @param {string} name - The reporter name to validate
 * @returns {boolean} True if name is safe to require, false otherwise
 * @example
 * isSafeReporterName('spec') // true
 * isSafeReporterName('@scope/reporter') // true
 * isSafeReporterName('../unsafe') // false
 */
function isSafeReporterName(name) {
  if (typeof name !== 'string' || name.length === 0) return false;
  for (let i = 0; i < name.length; i++) {
    const c = name.codePointAt(i);
    // 0-9, A-Z, a-z
    if ((c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122)) continue;
    // allow @ (64), . (46), _ (95), - (45), / (47)
    if (c === 64 || c === 46 || c === 95 || c === 45 || c === 47) continue;
    return false;
  }
  return true;
}

/**
 * Determine an option value.
 * 1. If `key` is present in the environment, then use the environment value
 * 2. If `value` is specified, then use that value
 * 3. Fall back to `defaultVal`
 * @module mocha-gitlab-reporter
 * @param {Object} value - the value from the reporter options
 * @param {String} key - the environment variable to check
 * @param {Object} defaultVal - the fallback value
 * @param {function} transform - a transformation function to be used when loading values from the environment
 */
function getSetting(value, key, defaultVal, transform) {
  if (process.env[key] !== undefined) {
    const envVal = process.env[key];
    return typeof transform === 'function' ? transform(envVal) : envVal;
  }
  if (value !== undefined) {
    return value;
  }
  return defaultVal;
}

/**
 * Checks if a suite is invalid
 * @param {string} suite - the suite to check
 * @returns {boolean} true if the suite is invalid, false otherwise
 */
function isInvalidSuite(suite) {
  return (!suite.root && suite.title === '') || (suite.tests.length === 0 && suite.suites.length === 0);
}

/**
 * Generates the GitLab suite classname for a given test
 * @param {string} test - the test to generate the classname for
 * @returns {string} the GitLab suite classname
 */
function getGitLabSuiteClassname(test) {
  let parent = test.parent;
  const titles = [];
  while (parent) {
    if (parent.title) {
      titles.unshift(parent.title);
    }
    parent = parent.parent;
  }
  return titles.join('.');
}

/**
 * GitLab CI JUnit reporter for mocha.js.
 * @module mocha-gitlab-reporter
 */
class MochaGitLabReporter {
  /**
   * @param {EventEmitter} runner - the test runner
   * @param {Object} options - mocha options
   */
  constructor(runner, options) {
    if (mocha6plus) {
      createStatsCollector(runner);
    }
    this._options = configureDefaults(options);
    this._runner = runner;
    this._Date = options?.Date ?? GlobalDate;

    const testsuites = [];
    this._testsuites = testsuites;

    // Use WeakMap to cache file paths without modifying Mocha's suite objects
    this._suiteFileCache = new WeakMap();

    function lastSuite() {
      return testsuites.at(-1).testsuite;
    }

    // get functionality from the Base reporter
    Base.call(this, runner);

    // If consoleReporter option is set, also run that reporter for console output
    if (this._options.consoleReporter) {
      const reporterName = this._options.consoleReporter;
      let ConsoleReporter = null;

      // Handle built-in reporter names
      if (mocha.reporters[reporterName]) {
        ConsoleReporter = mocha.reporters[reporterName];
      } else if (isSafeReporterName(reporterName)) {
        // Try to require as a module, but only for safe module names
        try {
          ConsoleReporter = require(reporterName);
          debug('constructor: Successfully loaded console reporter module:', reporterName);
        } catch (error_) {
          debug('constructor: Could not load console reporter module:', {
            reporterName,
            error: error_.message,
            code: error_.code,
          });
        }
      } else {
        debug('constructor: Refusing to load unsafe console reporter name:', {
          reporterName,
          reason: 'Name contains unsafe characters',
        });
      }

      if (ConsoleReporter) {
        // Instantiate the console reporter with the same runner and keep a ref
        this._consoleReporter = new ConsoleReporter(runner, options);
      }
    }

    // remove old results
    this._runner.on(
      'start',
      function () {
        try {
          fs.unlinkSync(this._options.mochaFile);
          debug('runner.start: Successfully removed existing report file:', this._options.mochaFile);
        } catch (error) {
          // Ignore ENOENT (file doesn't exist) - that's expected on first run
          if (error.code !== ERROR_CODES.FILE_NOT_FOUND) {
            console.warn(`Warning: Could not remove existing report file ${this._options.mochaFile}: ${error.message}`);
            debug('runner.start: Error removing report file:', {
              file: this._options.mochaFile,
              errorCode: error.code,
              errorMessage: error.message,
            });
          } else {
            debug('runner.start: Report file does not exist (expected on first run):', this._options.mochaFile);
          }
        }
      }.bind(this)
    );

    this._onSuiteBegin = function (suite) {
      if (!isInvalidSuite(suite)) {
        testsuites.push(this.getTestsuiteData(suite));
      }
    };

    this._runner.on(
      'suite',
      function (suite) {
        // allow tests to mock _onSuiteBegin
        return this._onSuiteBegin(suite);
      }.bind(this)
    );

    this._onSuiteEnd = function (suite) {
      if (!isInvalidSuite(suite)) {
        const testsuite = lastSuite();
        if (testsuite) {
          const start = testsuite[0]._attr.timestamp;
          testsuite[0]._attr.time = this._Date.now() - start;
        }
      }
    };

    this._runner.on(
      'suite end',
      function (suite) {
        // allow tests to mock _onSuiteEnd
        return this._onSuiteEnd(suite);
      }.bind(this)
    );

    this._runner.on(
      'pass',
      function (test) {
        lastSuite().push(this.getTestcaseData(test));
      }.bind(this)
    );

    this._runner.on(
      'fail',
      function (test, err) {
        lastSuite().push(this.getTestcaseData(test, err));
      }.bind(this)
    );

    if (this._options.includePending) {
      this._runner.on(
        'pending',
        function (test) {
          const testcase = this.getTestcaseData(test);

          testcase.testcase.push({ skipped: null });
          lastSuite().push(testcase);
        }.bind(this)
      );
    }

    this._runner.on(
      'end',
      function () {
        this.flush(testsuites);
      }.bind(this)
    );
  }

  /**
   * Produces an xml node for a test suite
   * @param  {Object} suite - a test suite
   * @return {Object}       - an object representing the xml node
   */
  getTestsuiteData(suite) {
    // GitLab uses testcase classname, not testsuite name, so just use simple suite title
    const suiteName = suite.root && suite.title === '' ? DEFAULTS.ROOT_SUITE_NAME : stripAnsi(suite.title);
    const _attr = {
      name: suiteName,
      timestamp: this._Date.now(),
      tests: suite.tests.length,
    };
    const testSuite = { testsuite: [{ _attr: _attr }] };

    // Cache the file from this suite or traverse up to find it from parent suites
    if (!this._suiteFileCache.has(suite)) {
      let cachedFile;
      if (suite.file) {
        cachedFile = suite.file;
      } else {
        let parent = suite.parent;
        while (parent) {
          if (parent.file) {
            cachedFile = parent.file;
            break;
          }
          if (this._suiteFileCache.has(parent)) {
            cachedFile = this._suiteFileCache.get(parent);
            break;
          }
          parent = parent.parent;
        }
      }
      this._suiteFileCache.set(suite, cachedFile);
      debug('getTestsuiteData: Cached file for suite:', {
        suiteTitle: suite.title,
        cachedFile,
        isRoot: suite.root,
        hasParent: !!suite.parent,
      });
    }

    return testSuite;
  }

  /**
   * Produces an xml config for a given test case.
   * @param {object} test - test case
   * @param {object} err - if test failed, the failure object
   * @returns {object}
   */
  getTestcaseData(test, err) {
    // GitLab format: classname is suite name, name is test title
    const name = stripAnsi(test.title);
    const classname = stripAnsi(getGitLabSuiteClassname(test));

    const durationMs = test.expectedDuration ?? test.duration;
    const testcase = {
      testcase: [
        {
          _attr: {
            name: name,
            time: durationMs === undefined ? 0 : durationMs / TIME_CONVERSION.MS_TO_SECONDS,
            classname: classname,
          },
        },
      ],
    };

    // Always add file attribute if available (GitLab format)
    this.appendFileAttribute(testcase, test);

    // Add any system outputs/errors and attachments
    this.appendSystemOut(testcase, test);
    this.appendSystemErr(testcase, test);

    if (err) {
      this.appendFailure(testcase, err);
    }
    return testcase;
  }

  /**
   * Add file attribute to testcase XML if test has associated file.
   * The file path is made relative to cwd and can be transformed using configured rules.
   * @param {Object} testcase - The testcase object to modify
   * @param {Object} test - The test object containing file information
   * @param {string} [test.file] - Path to the test file
   */
  appendFileAttribute(testcase, test) {
    // Fall back to parent suite's cached file if test.file doesn't exist
    let filePath = test.file || (test.parent && this._suiteFileCache.get(test.parent));

    debug('appendFileAttribute: Processing test:', {
      testTitle: test.title,
      testFile: test.file,
      resolvedPath: filePath,
      hasParent: !!test.parent,
    });
    if (!filePath) {
      debug('appendFileAttribute: No file path found for test, skipping file attribute');
      return;
    }
    // Make path relative to cwd (typically the git repo root)
    if (path.isAbsolute(filePath)) {
      filePath = path.relative(process.cwd(), filePath);
    }
    // Apply regex transformations if configured (using pre-compiled patterns)
    if (this._options.filePathTransforms && this._options.filePathTransforms.length > 0) {
      const originalPath = filePath;
      debug('appendFileAttribute: Applying file path transforms:', {
        originalPath,
        transformCount: this._options.filePathTransforms.length,
      });
      for (const [index, transform] of this._options.filePathTransforms.entries()) {
        // Skip transforms that failed to compile
        if (!transform[TRANSFORM_PROPS.PATTERN]) {
          debug('appendFileAttribute: Skipping invalid transform:', {
            index,
            transform: transform[TRANSFORM_PROPS.RAW],
            error: transform[TRANSFORM_PROPS.ERROR],
          });
          continue;
        }
        try {
          const beforeTransform = filePath;
          filePath = filePath.replace(transform[TRANSFORM_PROPS.PATTERN], transform[TRANSFORM_PROPS.REPLACE]);
          if (beforeTransform !== filePath) {
            debug('appendFileAttribute: Transform applied:', {
              index,
              pattern: transform[TRANSFORM_PROPS.RAW][TRANSFORM_PROPS.SEARCH],
              before: beforeTransform,
              after: filePath,
            });
          }
        } catch (e) {
          debug('appendFileAttribute: Transform failed:', {
            index,
            transform: transform[TRANSFORM_PROPS.RAW],
            error: e?.message,
            currentPath: filePath,
          });
        }
      }
      if (originalPath !== filePath) {
        debug('appendFileAttribute: Path transformation complete:', {
          original: originalPath,
          transformed: filePath,
        });
      }
    }
    testcase.testcase[0]._attr.file = filePath;
  }

  /**
   * Add system-out element to testcase XML for console outputs and attachments.
   * Filters out invalid XML characters and ANSI escape sequences.
   * @param {Object} testcase - The testcase object to modify
   * @param {Object} test - The test object containing outputs and attachments
   * @param {string[]} [test.consoleOutputs] - Array of console output strings
   * @param {string[]} [test.attachments] - Array of attachment file paths
   * @returns {boolean} True if system-out was added, false otherwise
   */
  appendSystemOut(testcase, test) {
    const systemOutLines = [];
    if (this._options.outputs && Array.isArray(test.consoleOutputs) && test.consoleOutputs.length > 0) {
      systemOutLines.push(...test.consoleOutputs);
    }
    if (this._options.attachments && Array.isArray(test.attachments) && test.attachments.length > 0) {
      systemOutLines.push(...test.attachments.map((file) => `[[ATTACHMENT|${file}]]`));
    }
    if (systemOutLines.length > 0) {
      testcase.testcase.push({
        'system-out': this.removeInvalidCharacters(stripAnsi(systemOutLines.join('\n'))),
      });
      return true;
    }
    return false;
  }

  /**
   * Add system-err element to testcase XML for console errors.
   * Filters out invalid XML characters and ANSI escape sequences.
   * @param {Object} testcase - The testcase object to modify
   * @param {Object} test - The test object containing error outputs
   * @param {string[]} [test.consoleErrors] - Array of console error strings
   * @returns {boolean} True if system-err was added, false otherwise
   */
  appendSystemErr(testcase, test) {
    if (this._options.outputs && Array.isArray(test.consoleErrors) && test.consoleErrors.length > 0) {
      testcase.testcase.push({
        'system-err': this.removeInvalidCharacters(stripAnsi(test.consoleErrors.join('\n'))),
      });
      return true;
    }
    return false;
  }

  /**
   * Add failure element to testcase XML for test failures.
   * Includes error message, stack trace, and diff if available.
   * Filters out invalid XML characters.
   * @param {Object} testcase - The testcase object to modify
   * @param {Error} err - The error object from the failed test
   * @param {string} [err.message] - Error message
   * @param {string} [err.stack] - Error stack trace
   * @param {string} [err.name] - Error type name
   * @param {*} [err.expected] - Expected value for assertion errors
   * @param {*} [err.actual] - Actual value for assertion errors
   */
  appendFailure(testcase, err) {
    let message;
    if (err.message && typeof err.message.toString === 'function') {
      message = err.message.toString();
    } else if (typeof err.inspect === 'function') {
      message = err.inspect() + '';
    } else {
      message = '';
    }
    let failureMessage = err.stack || message;
    if (!Base.hideDiff && err.expected !== undefined) {
      const oldUseColors = Base.useColors;
      Base.useColors = false;
      failureMessage += '\n' + Base.generateDiff(err.actual, err.expected);
      Base.useColors = oldUseColors;
    }
    const failureElement = {
      _attr: {
        message: this.removeInvalidCharacters(message) || '',
        type: err.name || '',
      },
      _cdata: this.removeInvalidCharacters(failureMessage),
    };

    testcase.testcase.push({ failure: failureElement });
  }

  /**
   * @param {string} input
   * @returns {string} without invalid characters
   */
  /**
   * Removes invalid XML characters from a string using a predefined regex pattern.
   * @param {string} input - The string to clean
   * @returns {string} The input string with invalid XML characters removed
   */
  removeInvalidCharacters(input) {
    if (!input) {
      return input;
    }
    return input.replaceAll(INVALID_CHARACTERS_REGEX, '');
  }

  /**
   * Writes xml to disk and ouputs content if "toConsole" is set to true.
   * @param {Array.<Object>} testsuites - a list of xml configs
   */
  flush(testsuites) {
    this._xml = this.getXml(testsuites);

    const reportFilename = this.formatReportFilename(this._xml, testsuites);

    this.writeXmlToDisk(this._xml, reportFilename);

    if (this._options.toConsole === true) {
      console.log(this._xml);
    }
  }

  /**
   * Formats the report filename by replacing placeholders
   * @param {string} xml - xml string
   * @param {Array.<Object>} testsuites - a list of xml configs
   */
  formatReportFilename(xml, testsuites) {
    let reportFilename = this._options.mochaFile;

    if (reportFilename.includes(PLACEHOLDERS.HASH)) {
      const hash = crypto
        .createHash(FILE_CONSTANTS.HASH_ALGORITHM)
        .update(xml, FILE_CONSTANTS.ENCODING)
        .digest(FILE_CONSTANTS.HASH_DIGEST);
      reportFilename = reportFilename.replace(PLACEHOLDERS.HASH, hash);
    }

    if (reportFilename.includes(PLACEHOLDERS.SUITE_FILENAME)) {
      reportFilename = reportFilename.replace(
        PLACEHOLDERS.SUITE_FILENAME,
        testsuites[0]?.testsuite[0]?._attr?.file ?? 'suiteFilename'
      );
    }
    if (reportFilename.includes(PLACEHOLDERS.SUITE_NAME)) {
      reportFilename = reportFilename.replace(
        PLACEHOLDERS.SUITE_NAME,
        testsuites[1]?.testsuite[0]?._attr?.name ?? 'suiteName'
      );
    }

    return reportFilename;
  }

  /**
   * Produces an XML string from the given test data.
   * @param {Array.<Object>} testsuites - a list of xml configs
   * @returns {string}
   */
  getXml(testsuites) {
    let totalTests = 0;
    const stats = this._runner.stats;
    const LocalDate = this._Date;

    for (const suite of testsuites) {
      const _suiteAttr = suite.testsuite[0]._attr;
      // testsuite is an array: [attrs, testcase, testcase, …]
      // grab test cases starting from index 1
      const _cases = suite.testsuite.slice(1);

      // suiteTime has unrounded time as a Number of milliseconds
      const suiteTime = _suiteAttr.time;

      _suiteAttr.time = (suiteTime / TIME_CONVERSION.MS_TO_SECONDS || 0).toFixed(TIME_CONVERSION.DECIMAL_PLACES);
      _suiteAttr.timestamp = new LocalDate(_suiteAttr.timestamp).toISOString().slice(0, -5);
      _suiteAttr.failures = 0;
      _suiteAttr.skipped = 0;

      for (const testcase of _cases) {
        const lastNode = testcase.testcase.at(-1);

        _suiteAttr.skipped += Number('skipped' in lastNode);
        _suiteAttr.failures += Number('failure' in lastNode);
        if (typeof testcase.testcase[0]._attr.time === 'number') {
          testcase.testcase[0]._attr.time = testcase.testcase[0]._attr.time.toFixed(TIME_CONVERSION.DECIMAL_PLACES);
        }
      }

      if (!_suiteAttr.skipped) {
        delete _suiteAttr.skipped;
      }

      totalTests += _suiteAttr.tests;
    }

    const rootSuite = {
      _attr: {
        name: DEFAULTS.ROOT_TESTSUITES_NAME,
        time: (stats.duration / TIME_CONVERSION.MS_TO_SECONDS || 0).toFixed(TIME_CONVERSION.DECIMAL_PLACES),
        tests: totalTests,
        failures: stats.failures,
      },
    };
    if (stats.pending) {
      rootSuite._attr.skipped = stats.pending;
    }
    testsuites = [rootSuite].concat(testsuites);

    return toXml({ testsuites: testsuites }, { declaration: XML_OPTIONS.DECLARATION, indent: XML_OPTIONS.INDENT });
  }

  /**
   * Writes a JUnit test report XML document.
   * @param {string} xml - xml string
   * @param {string} filePath - path to output file
   * @throws {Error} If the file cannot be written
   */
  writeXmlToDisk(xml, filePath) {
    if (!filePath) {
      debug('writeXmlToDisk: No file path provided, skipping write');
      return;
    }

    debug('writeXmlToDisk: Writing XML report:', {
      filePath,
      xmlSize: xml.length,
      encoding: FILE_CONSTANTS.ENCODING,
    });

    try {
      // Create directory if it doesn't exist
      const directory = path.dirname(filePath);
      fs.mkdirSync(directory, { recursive: true });
      debug('writeXmlToDisk: Created/verified directory:', directory);

      // Write the XML file
      fs.writeFileSync(filePath, xml, FILE_CONSTANTS.ENCODING);
      debug('writeXmlToDisk: Successfully wrote XML report:', {
        filePath,
        xmlSize: xml.length,
        directory,
      });
    } catch (error) {
      const errorMessage = `Failed to write test results to ${filePath}: ${error.message}`;
      console.error(errorMessage);
      debug('writeXmlToDisk: Error writing file:', {
        filePath,
        errorCode: error.code,
        errorMessage: error.message,
        stack: error.stack,
      });
      // Re-throw the error so users know the operation failed
      throw new Error(errorMessage);
    }
  }
}

module.exports = MochaGitLabReporter;

// Re-export XML builder for testing
module.exports.toXml = require('./lib/xml-builder').toXml;
