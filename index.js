"use strict";

const xml = require("xml");
const mocha = require("mocha");
const Base = mocha.reporters.Base;
const fs = require("node:fs");
const path = require("node:path");
const debug = require("debug")("mocha-gitlab-reporter");
const crypto = require("node:crypto");
const stripAnsi = require("strip-ansi");

// Save timer references so that times are correct even if Date is stubbed.
// See https://github.com/mochajs/mocha/issues/237
const GlobalDate = globalThis.Date;

let createStatsCollector;
let mocha6plus = false;

try {
  const json = JSON.parse(
    fs.readFileSync(
      path.dirname(require.resolve("mocha")) + "/package.json",
      "utf8"
    )
  );
  const version = json.version;
  const majorVersion = Number.parseInt(version.split(".")[0], 10);
  if (majorVersion >= 6) {
    createStatsCollector = require("mocha/lib/stats-collector");
    mocha6plus = true;
  } else {
    mocha6plus = false;
  }
} catch (error_) {
  // best-effort: if mocha package.json can't be read we continue with defaults
  console.warn("Couldn't determine Mocha version", error_);
}

// A subset of invalid characters as defined in http://www.w3.org/TR/xml/#charsets that can occur in e.g. stacktraces
// regex lifted from https://github.com/MylesBorins/xml-sanitizer/ (licensed MIT)
const INVALID_CHARACTERS_REGEX =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007f-\u0084\u0086-\u009f\uD800-\uDFFF\uFDD0-\uFDFF\uFFFF\uC008]/g; //eslint-disable-line no-control-regex

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
  debug("Mocha options", options);
  const config = options?.reporterOptions ?? {};
  debug("Reporter options", config);
  config.mochaFile = getSetting(
    config.mochaFile,
    "MOCHA_FILE",
    "test-results.xml"
  );
  config.attachments = getSetting(config.attachments, "ATTACHMENTS", false);
  config.toConsole = !!config.toConsole;
  config.consoleReporter = getSetting(
    config.consoleReporter,
    "CONSOLE_REPORTER",
    null
  );

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
    filePathTransforms = filePathTransforms.replaceAll(/(\{|\s)search:/g, '$1"search":');
    filePathTransforms = filePathTransforms.replaceAll(/(\{|\s|,)replace:/g, '$1"replace":');

    // Convert single quotes to double quotes for string values
    // Handle backslashes properly - they need to be escaped for JSON
    filePathTransforms = filePathTransforms.replaceAll(/:\s*'([^']*)'/g, function (match, content) {
      // Escape backslashes for JSON (\ becomes \\)
      const escaped = content.replaceAll('\\', '\\\\');
      return ': "' + escaped + '"';
    });

    transforms = parseFilePathTransforms(filePathTransforms);
  }

  config.filePathTransforms = transforms;

  debug("Config", config);
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
    throw new TypeError("filePathTransforms must be valid JSON. Error: " + e.message);
  }

  if (Array.isArray(parsed)) {
    for (const [index, transform] of parsed.entries()) {
      if (!transform?.search || !transform?.replace) {
        throw new TypeError(`filePathTransforms[${index}] must have both 'search' and 'replace' properties.`);
      }
    }
    return parsed;
  }

  if (typeof parsed === 'object' && parsed !== null) {
    if (!parsed.search || !parsed.replace) {
      throw new TypeError("filePathTransforms must have both 'search' and 'replace' properties.");
    }
    return [parsed];
  }

  throw new TypeError('filePathTransforms has unsupported format');
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
    return typeof transform === "function" ? transform(envVal) : envVal;
  }
  if (value !== undefined) {
    return value;
  }
  return defaultVal;
}

/**
 * Generates the suite title for a given suite
 * @param {string} suite - the suite to generate the title for
 * @returns {string} the suite title
 */
function generateSuiteTitle(suite) {
  // If this IS the root suite, return "Root Suite"
  if (suite.root && suite.title === "") {
    return "Root Suite";
  }

  let parent = suite.parent;
  const title = [suite.title];

  while (parent) {
    if (parent.root && parent.title === "") {
      title.unshift("Root Suite");
    } else {
      title.unshift(parent.title);
    }
    parent = parent.parent;
  }

  return stripAnsi(title.join("."));
}

/**
 * Checks if a suite is invalid
 * @param {string} suite - the suite to check
 * @returns {boolean} true if the suite is invalid, false otherwise
 */
function isInvalidSuite(suite) {
  return (
    (!suite.root && suite.title === "") ||
    (suite.tests.length === 0 && suite.suites.length === 0)
  );
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
  return titles.join(".");
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
        } catch (error_) {
          debug("Could not load console reporter: " + reporterName, error_);
        }
      } else {
        debug("Refusing to load unsafe console reporter name: " + reporterName);
      }

      if (ConsoleReporter) {
        // Instantiate the console reporter with the same runner and keep a ref
        this._consoleReporter = new ConsoleReporter(runner, options);
      }
    }

    // remove old results
    this._runner.on(
      "start",
      function () {
        if (fs.existsSync(this._options.mochaFile)) {
          debug("removing report file", this._options.mochaFile);
          fs.unlinkSync(this._options.mochaFile);
        }
      }.bind(this)
    );

    this._onSuiteBegin = function (suite) {
      if (!isInvalidSuite(suite)) {
        testsuites.push(this.getTestsuiteData(suite));
      }
    };

    this._runner.on(
      "suite",
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
      "suite end",
      function (suite) {
        // allow tests to mock _onSuiteEnd
        return this._onSuiteEnd(suite);
      }.bind(this)
    );

    this._runner.on(
      "pass",
      function (test) {
        lastSuite().push(this.getTestcaseData(test));
      }.bind(this)
    );

    this._runner.on(
      "fail",
      function (test, err) {
        lastSuite().push(this.getTestcaseData(test, err));
      }.bind(this)
    );

    if (this._options.includePending) {
      this._runner.on(
        "pending",
        function (test) {
          const testcase = this.getTestcaseData(test);

          testcase.testcase.push({ skipped: null });
          lastSuite().push(testcase);
        }.bind(this)
      );
    }

    this._runner.on(
      "end",
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
    const _attr = {
      name: generateSuiteTitle(suite),
      timestamp: this._Date.now(),
      tests: suite.tests.length,
    };
    const testSuite = { testsuite: [{ _attr: _attr }] };

    // Cache the file from this suite or traverse up to find it from parent suites
    if (!suite._cachedFile) {
      if (suite.file) {
        suite._cachedFile = suite.file;
      } else {
        let parent = suite.parent;
        while (parent) {
          if (parent.file) {
            suite._cachedFile = parent.file;
            break;
          }
          if (parent._cachedFile) {
            suite._cachedFile = parent._cachedFile;
            break;
          }
          parent = parent.parent;
        }
      }
      debug("Cached file for suite", suite.title, suite._cachedFile);
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
            time: durationMs === undefined ? 0 : durationMs / 1000,
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
    let filePath = test.file || (test.parent && test.parent._cachedFile);

    debug("Appending file attribute for test", test.title, filePath);
    if (!filePath) return;
    // Make path relative to cwd (typically the git repo root)
    if (path.isAbsolute(filePath)) {
      filePath = path.relative(process.cwd(), filePath);
    }
    // Apply regex transformations if configured
    if (this._options.filePathTransforms && this._options.filePathTransforms.length > 0) {
      for (const transform of this._options.filePathTransforms) {
        // validate transform pattern to avoid throwing on invalid regex or non-string replace
        try {
          if (typeof transform.search !== 'string' || typeof transform.replace !== 'string') {
            throw new TypeError('Invalid filePathTransforms entry');
          }
          const regex = new RegExp(transform.search);
          filePath = filePath.replace(regex, transform.replace);
        } catch (e) {
          debug('Skipping invalid filePathTransforms entry', transform, e?.message);
        }
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
        "system-out": this.removeInvalidCharacters(stripAnsi(systemOutLines.join("\n")))
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
        "system-err": this.removeInvalidCharacters(stripAnsi(test.consoleErrors.join("\n")))
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
    if (err.message && typeof err.message.toString === "function") {
      message = err.message + "";
    } else if (typeof err.inspect === "function") {
      message = err.inspect() + "";
    } else {
      message = "";
    }
    let failureMessage = err.stack || message;
    if (!Base.hideDiff && err.expected !== undefined) {
      const oldUseColors = Base.useColors;
      Base.useColors = false;
      failureMessage += "\n" + Base.generateDiff(err.actual, err.expected);
      Base.useColors = oldUseColors;
    }
    const failureElement = {
      _attr: {
        message: this.removeInvalidCharacters(message) || "",
        type: err.name || "",
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
    return input.replaceAll(INVALID_CHARACTERS_REGEX, "");
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

    if (reportFilename.includes("[hash]")) {
      const hash = crypto.createHash("sha256").update(xml, "utf8").digest("hex");
      reportFilename = reportFilename.replace("[hash]", hash);
    }

    if (reportFilename.includes("[testsuitesTitle]")) {
      reportFilename = reportFilename.replace(
        "[testsuitesTitle]",
        "Mocha Tests"
      );
    }
    if (reportFilename.includes("[rootSuiteTitle]")) {
      reportFilename = reportFilename.replace("[rootSuiteTitle]", "Root Suite");
    }
    if (reportFilename.includes("[suiteFilename]")) {
      reportFilename = reportFilename.replace(
        "[suiteFilename]",
        testsuites[0]?.testsuite[0]?._attr?.file ?? "suiteFilename"
      );
    }
    if (reportFilename.includes("[suiteName]")) {
      reportFilename = reportFilename.replace(
        "[suiteName]",
        testsuites[1]?.testsuite[0]?._attr?.name ?? "suiteName"
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

      _suiteAttr.time = (suiteTime / 1000 || 0).toFixed(3);
      _suiteAttr.timestamp = new LocalDate(_suiteAttr.timestamp)
        .toISOString()
        .slice(0, -5);
      _suiteAttr.failures = 0;
      _suiteAttr.skipped = 0;

      for (const testcase of _cases) {
        const lastNode = testcase.testcase.at(-1);

        _suiteAttr.skipped += Number("skipped" in lastNode);
        _suiteAttr.failures += Number("failure" in lastNode);
        if (typeof testcase.testcase[0]._attr.time === "number") {
          testcase.testcase[0]._attr.time =
            testcase.testcase[0]._attr.time.toFixed(3);
        }
      }

      if (!_suiteAttr.skipped) {
        delete _suiteAttr.skipped;
      }

      totalTests += _suiteAttr.tests;
    }

    const rootSuite = {
      _attr: {
        name: "Mocha Tests",
        time: (stats.duration / 1000 || 0).toFixed(3),
        tests: totalTests,
        failures: stats.failures,
      },
    };
    if (stats.pending) {
      rootSuite._attr.skipped = stats.pending;
    }
    testsuites = [rootSuite].concat(testsuites);

    return xml({ testsuites: testsuites }, { declaration: true, indent: "  " });
  }

  /**
   * Writes a JUnit test report XML document.
   * @param {string} xml - xml string
   * @param {string} filePath - path to output file
   */
  writeXmlToDisk(xml, filePath) {
    if (filePath) {
      debug("writing file to", filePath);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });

      try {
        fs.writeFileSync(filePath, xml, "utf-8");
      } catch (error) {
        debug("problem writing results: " + error);
      }
      debug("results written successfully");
    }
  }
}

module.exports = MochaGitLabReporter;
