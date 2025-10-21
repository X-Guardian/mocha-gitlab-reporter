"use strict";

var xml = require("xml");
var mocha = require("mocha");
var Base = mocha.reporters.Base;
var fs = require("fs");
var path = require("path");
var debug = require("debug")("mocha-gitlab-reporter");
var mkdirp = require("mkdirp");
var md5 = require("md5");
var stripAnsi = require("strip-ansi");

// Save timer references so that times are correct even if Date is stubbed.
// See https://github.com/mochajs/mocha/issues/237
var Date = global.Date;

var createStatsCollector;
var mocha6plus;

try {
  var json = JSON.parse(
    fs.readFileSync(
      path.dirname(require.resolve("mocha")) + "/package.json",
      "utf8"
    )
  );
  var version = json.version;
  var majorVersion = parseInt(version.split(".")[0], 10);
  if (majorVersion >= 6) {
    createStatsCollector = require("mocha/lib/stats-collector");
    mocha6plus = true;
  } else {
    mocha6plus = false;
  }
} catch (e) {
  console.warn("Couldn't determine Mocha version");
}

// A subset of invalid characters as defined in http://www.w3.org/TR/xml/#charsets that can occur in e.g. stacktraces
// regex lifted from https://github.com/MylesBorins/xml-sanitizer/ (licensed MIT)
var INVALID_CHARACTERS_REGEX =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007f-\u0084\u0086-\u009f\uD800-\uDFFF\uFDD0-\uFDFF\uFFFF\uC008]/g; //eslint-disable-line no-control-regex

function configureDefaults(options) {
  debug("Mocha options", options);
  var config = options.reporterOptions || {};
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
  config.filePathSearchPattern = getSetting(
    config.filePathSearchPattern,
    "FILE_PATH_SEARCH_PATTERN",
    null
  );
  config.filePathReplacePattern = getSetting(
    config.filePathReplacePattern,
    "FILE_PATH_REPLACE_PATTERN",
    null
  );

  // Validate that both filePathSearchPattern and filePathReplacePattern are specified together
  if (config.filePathSearchPattern && !config.filePathReplacePattern) {
    throw new Error(
      "filePathSearchPattern is specified but filePathReplacePattern is missing. Both must be provided together."
    );
  }
  if (config.filePathReplacePattern && !config.filePathSearchPattern) {
    throw new Error(
      "filePathReplacePattern is specified but filePathSearchPattern is missing. Both must be provided together."
    );
  }

  debug("Config", config);
  return config;
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
    var envVal = process.env[key];
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

  var parent = suite.parent;
  var title = [suite.title];

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
  // debug("Building GitLab suite classname for", test);
  var parent = test.parent;
  var titles = [];
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
    this._Date = (options || {}).Date || Date;

    var testsuites = [];
    this._testsuites = testsuites;

    function lastSuite() {
      return testsuites[testsuites.length - 1].testsuite;
    }

    // get functionality from the Base reporter
    Base.call(this, runner);

    // If consoleReporter option is set, also run that reporter for console output
    if (this._options.consoleReporter) {
      var reporterName = this._options.consoleReporter;
      var ConsoleReporter;

      // Handle built-in reporter names
      if (mocha.reporters[reporterName]) {
        ConsoleReporter = mocha.reporters[reporterName];
      } else {
        // Try to require as a module
        try {
          ConsoleReporter = require(reporterName);
        } catch (e) {
          console.warn("Could not load console reporter: " + reporterName);
        }
      }

      if (ConsoleReporter) {
        // Instantiate the console reporter with the same runner
        new ConsoleReporter(runner, options);
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
        var testsuite = lastSuite();
        if (testsuite) {
          var start = testsuite[0]._attr.timestamp;
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
          var testcase = this.getTestcaseData(test);

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
    var _attr = {
      name: generateSuiteTitle(suite),
      timestamp: this._Date.now(),
      tests: suite.tests.length,
    };
    var testSuite = { testsuite: [{ _attr: _attr }] };

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
    var name = stripAnsi(test.title);
    var classname = stripAnsi(getGitLabSuiteClassname(test));

    var testcase = {
      testcase: [
        {
          _attr: {
            name: name,
            time:
              typeof test.duration === "undefined" ? 0 : test.duration / 1000,
            classname: classname,
          },
        },
      ],
    };

    // Always add file attribute if available (GitLab format)
    if (test.file) {
      var filePath = test.file;
      // Make path relative to cwd (typically the git repo root)
      if (path.isAbsolute(filePath)) {
        filePath = path.relative(process.cwd(), filePath);
      }
      // Apply regex transformation if configured
      if (this._options.filePathSearchPattern && this._options.filePathReplacePattern) {
        var regex = new RegExp(this._options.filePathSearchPattern);
        filePath = filePath.replace(regex, this._options.filePathReplacePattern);
      }
      testcase.testcase[0]._attr.file = filePath;
    }

    // We need to merge console.logs and attachments into one <system-out> -
    //  see JUnit schema (only accepts 1 <system-out> per test).
    var systemOutLines = [];
    if (
      this._options.outputs &&
      test.consoleOutputs &&
      test.consoleOutputs.length > 0
    ) {
      systemOutLines = systemOutLines.concat(test.consoleOutputs);
    }
    if (
      this._options.attachments &&
      test.attachments &&
      test.attachments.length > 0
    ) {
      systemOutLines = systemOutLines.concat(
        test.attachments.map(function (file) {
          return "[[ATTACHMENT|" + file + "]]";
        })
      );
    }
    if (systemOutLines.length > 0) {
      testcase.testcase.push({
        "system-out": this.removeInvalidCharacters(
          stripAnsi(systemOutLines.join("\n"))
        ),
      });
    }

    if (
      this._options.outputs &&
      test.consoleErrors &&
      test.consoleErrors.length > 0
    ) {
      testcase.testcase.push({
        "system-err": this.removeInvalidCharacters(
          stripAnsi(test.consoleErrors.join("\n"))
        ),
      });
    }

    if (err) {
      var message;
      if (err.message && typeof err.message.toString === "function") {
        message = err.message + "";
      } else if (typeof err.inspect === "function") {
        message = err.inspect() + "";
      } else {
        message = "";
      }
      var failureMessage = err.stack || message;
      if (!Base.hideDiff && err.expected !== undefined) {
        var oldUseColors = Base.useColors;
        Base.useColors = false;
        failureMessage += "\n" + Base.generateDiff(err.actual, err.expected);
        Base.useColors = oldUseColors;
      }
      var failureElement = {
        _attr: {
          message: this.removeInvalidCharacters(message) || "",
          type: err.name || "",
        },
        _cdata: this.removeInvalidCharacters(failureMessage),
      };

      testcase.testcase.push({ failure: failureElement });
    }
    return testcase;
  }

  /**
   * @param {string} input
   * @returns {string} without invalid characters
   */
  removeInvalidCharacters(input) {
    if (!input) {
      return input;
    }
    return input.replace(INVALID_CHARACTERS_REGEX, "");
  }

  /**
   * Writes xml to disk and ouputs content if "toConsole" is set to true.
   * @param {Array.<Object>} testsuites - a list of xml configs
   */
  flush(testsuites) {
    this._xml = this.getXml(testsuites);

    var reportFilename = this.formatReportFilename(this._xml, testsuites);

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
    var reportFilename = this._options.mochaFile;

    if (reportFilename.indexOf("[hash]") !== -1) {
      reportFilename = reportFilename.replace("[hash]", md5(xml));
    }

    if (reportFilename.indexOf("[testsuitesTitle]") !== -1) {
      reportFilename = reportFilename.replace(
        "[testsuitesTitle]",
        "Mocha Tests"
      );
    }
    if (reportFilename.indexOf("[rootSuiteTitle]") !== -1) {
      reportFilename = reportFilename.replace("[rootSuiteTitle]", "Root Suite");
    }
    if (reportFilename.indexOf("[suiteFilename]") !== -1) {
      reportFilename = reportFilename.replace(
        "[suiteFilename]",
        testsuites[0]?.testsuite[0]?._attr?.file ?? "suiteFilename"
      );
    }
    if (reportFilename.indexOf("[suiteName]") !== -1) {
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
    var totalTests = 0;
    var stats = this._runner.stats;
    var Date = this._Date;

    testsuites.forEach(function (suite) {
      var _suiteAttr = suite.testsuite[0]._attr;
      // testsuite is an array: [attrs, testcase, testcase, …]
      // grab test cases starting from index 1
      var _cases = suite.testsuite.slice(1);

      // suiteTime has unrounded time as a Number of milliseconds
      var suiteTime = _suiteAttr.time;

      _suiteAttr.time = (suiteTime / 1000 || 0).toFixed(3);
      _suiteAttr.timestamp = new Date(_suiteAttr.timestamp)
        .toISOString()
        .slice(0, -5);
      _suiteAttr.failures = 0;
      _suiteAttr.skipped = 0;

      _cases.forEach(function (testcase) {
        var lastNode = testcase.testcase[testcase.testcase.length - 1];

        _suiteAttr.skipped += Number("skipped" in lastNode);
        _suiteAttr.failures += Number("failure" in lastNode);
        if (typeof testcase.testcase[0]._attr.time === "number") {
          testcase.testcase[0]._attr.time =
            testcase.testcase[0]._attr.time.toFixed(3);
        }
      });

      if (!_suiteAttr.skipped) {
        delete _suiteAttr.skipped;
      }

      totalTests += _suiteAttr.tests;
    });

    var rootSuite = {
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
      mkdirp.sync(path.dirname(filePath));

      try {
        fs.writeFileSync(filePath, xml, "utf-8");
      } catch (exc) {
        debug("problem writing results: " + exc);
      }
      debug("results written successfully");
    }
  }
}

module.exports = MochaGitLabReporter;
