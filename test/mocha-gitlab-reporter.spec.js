/* eslint-env mocha */
"use strict";

const Reporter = require("../index");

const mochaVersion = process.env.MOCHA_VERSION || "";
const Mocha = require("mocha" + mochaVersion);
const Runner = Mocha.Runner;
const Suite = Mocha.Suite;
const Test = Mocha.Test;

const fs = require("node:fs");
const path = require("node:path");
const chai = require("chai");
const expect = chai.expect;
const FakeTimer = require("@sinonjs/fake-timers");
const chaiXML = require("chai-xml");
const mockXml = require("./mock-results");
const mockJunitSuites = require("./mock-junit-suites");
const testConsole = require("test-console");

const debug = require("debug")("mocha-junit-reporter:tests");

chai.use(chaiXML);

function createTest(name, options, fn) {
  if (typeof options === "function") {
    fn = options;
    options = null;
  }
  options = options || {};

  // null fn means no callback which mocha treats as pending test.
  // undefined fn means caller wants a default fn.
  if (fn === undefined) {
    fn = function () {};
  }

  const test = new Test(name, fn);

  const duration = options.duration;
  if (duration != null) {
    // mock duration so we have consistent output
    // store on a custom property so the reporter can read a deterministic value
    // without interfering with Mocha's internal duration handling
    test.expectedDuration = duration;
  }

  return test;
}

function assertXmlEquals(actual, expected) {
  expect(actual).xml.to.be.valid();
  expect(actual).xml.to.equal(expected);
}

async function removeTestPath(callback) {
  try {
    await fs.promises.rm(__dirname + "/output", { recursive: true, force: true });
    // tests that exercise defaults will write to $CWD/test-results.xml
    await fs.promises.rm(__dirname + "/../test-results.xml", { force: true });
    callback();
  } catch (err) {
    callback(err);
  }
}

function createRunner() {
  // mocha always has a root suite
  const rootSuite = new Suite("", "root", true);

  // We don't want Mocha to emit timeout errors.
  // If we want to simulate errors, we'll emit them ourselves.
  rootSuite.timeout(0);

  return new Runner(rootSuite);
}

function runRunner(runner, callback) {
  runner.run(function (failureCount) {
    if (runner.dispose) {
      // Ensure uncaught exception handlers are cleared before we execute test assertions.
      // Otherwise, this runner would intercept uncaught exceptions that were already handled by the mocha instance
      // running our tests.
      runner.dispose();
    }

    callback(failureCount);
  });
}

function getFileNameWithHash(path) {
  const filenames = fs.readdirSync(path);
  // Accept either 32-char (md5) or 64-char (sha256) hex hashes
  const expected = /(^results\.)([a-f0-9]{32,64})(\.xml)$/i;

  for (const filename of filenames) {
    if (expected.test(filename)) {
      return filename;
    }
  }
}

function runTests(reporter, options, callback) {
  if (!callback) {
    callback = options;
    options = null;
  }
  options = options || {};
  options.invalidChar = options.invalidChar || "";
  options.title = options.title || "Foo Bar";

  const runner = reporter.runner;
  const rootSuite = runner.suite;

  const suite1 = Suite.create(rootSuite, options.title);
  suite1.addTest(createTest("can weez the juice", { duration: 101 }));

  suite1.addTest(
    createTest("can narfle the garthog", { duration: 2002 }, function (done) {
      const err = new Error(
        options.invalidChar +
          "expected garthog to be dead" +
          options.invalidChar
      );
      err.stack = "this is where the stack would be";
      done(err);
    })
  );

  suite1.addTest(
    createTest(
      "can behave like a flandip",
      { duration: 30003 },
      function (done) {
        const err = new Error(
          "expected baz to be masher, a hustler, an uninvited grasper of cone"
        );
        err.name = "BazError";
        err.stack = "stack";
        done(err);
      }
    )
  );

  const suite2 = Suite.create(rootSuite, "Another suite!");
  suite2.addTest(createTest("works", { duration: 400004 }));

  if (options.includePending) {
    const pendingSuite = Suite.create(rootSuite, "Pending suite!");
    pendingSuite.addTest(createTest("pending", null, null));
  }

  const _onSuiteEnd = reporter._onSuiteEnd.bind(reporter);

  reporter._onSuiteEnd = function (suite) {
    if (suite === rootSuite) {
      // root suite took no time to execute
      reporter._Date.clock.tick(0);
    } else if (suite === suite1) {
      // suite1 took an arbitrary amount of time that includes time to run each test + setup and teardown
      reporter._Date.clock.tick(100001);
    } else if (suite === suite2) {
      reporter._Date.clock.tick(400005);
    }

    return _onSuiteEnd(suite);
  };

  runRunner(runner, callback);
}

function verifyMochaFile(runner, filePath, options) {
  const now = new Date().toISOString();
  debug("verify", now);
  const output = fs.readFileSync(filePath, "utf-8");
  assertXmlEquals(output, mockXml(runner.stats, options));
  debug("done", now);
}

describe("mocha-junit-reporter", function () {
  let filePath;
  let MOCHA_FILE;
  let stdout;

  function mockStdout() {
    stdout = testConsole.stdout.inspect();
    return stdout;
  }

  // runTests moved to module scope

  // helper functions moved to module scope

  // verifyMochaFile moved to module scope

  // helper functions moved to module scope

  // helper functions moved to module scope

  function createReporter(options) {
    options = options || {};
    filePath = path.join(path.dirname(__dirname), options.mochaFile || "");

    const mocha = new Mocha({
      reporter: Reporter,
      allowUncaught: true,
    });

    return new mocha._reporter(createRunner(), {
      reporterOptions: options,
      Date: FakeTimer.createClock(0).Date,
    });
  }

  // helper functions moved to module scope

  // helper functions moved to module scope

  before(function (done) {
    // cache this
    MOCHA_FILE = process.env.MOCHA_FILE;

    removeTestPath(done);
  });

  after(function () {
    // reset this
    process.env.MOCHA_FILE = MOCHA_FILE;
  });

  beforeEach(function () {
    filePath = undefined;
    delete process.env.MOCHA_FILE;
    delete process.env.PROPERTIES;
  });

  afterEach(function (done) {
    debug("after");
    if (stdout) {
      stdout.restore();
    }

    removeTestPath(done);
  });

  it("can produce a JUnit XML report", function (done) {
    const reporter = createReporter({ mochaFile: "test/output/mocha.xml" });
    runTests(reporter, function () {
      verifyMochaFile(reporter.runner, filePath);
      done();
    });
  });

  it("can handle getXml being called twice", function () {
    const reporter = createReporter({ mochaFile: "test/output/mocha.xml" });
    const testsuites = mockJunitSuites.withStringTimes();
    reporter.getXml(testsuites);
  });

  it("respects `process.env.MOCHA_FILE`", function (done) {
    process.env.MOCHA_FILE = "test/output/results.xml";
    const reporter = createReporter();
    runTests(reporter, function () {
      verifyMochaFile(reporter.runner, process.env.MOCHA_FILE);
      done();
    });
  });

  it("respects `--reporter-options mochaFile=`", function (done) {
    const reporter = createReporter({ mochaFile: "test/output/results.xml" });
    runTests(reporter, function () {
      verifyMochaFile(reporter.runner, filePath);
      done();
    });
  });

  it("respects `[hash]` pattern in test results report filename", function (done) {
    const dir = "test/output/";
    const path = dir + "results.[hash].xml";
    const reporter = createReporter({ mochaFile: path });
    runTests(reporter, function () {
      verifyMochaFile(reporter.runner, dir + getFileNameWithHash(dir));
      done();
    });
  });

  it("respects `[suiteFilename]` pattern in test results report filename", function (done) {
    const dir = "test/output/";
    const path = dir + "results.[suiteFilename].xml";
    const reporter = createReporter({ mochaFile: path });
    runTests(reporter, function () {
      verifyMochaFile(
        reporter.runner,
        dir +
          "results." +
          (reporter._testsuites[0]?.testsuite[0]?._attr?.file ??
            "suiteFilename") +
          ".xml"
      );
      done();
    });
  });

  it("respects `[suiteName]` pattern in test results report filename", function (done) {
    const dir = "test/output/";
    const path = dir + "results.[suiteName].xml";
    const reporter = createReporter({ mochaFile: path });
    runTests(reporter, function () {
      verifyMochaFile(
        reporter.runner,
        dir +
          "results." +
          (reporter._testsuites[1]?.testsuite[0]?._attr?.name ?? "suiteName") +
          ".xml"
      );
      done();
    });
  });

  it("will create intermediate directories", function (done) {
    const reporter = createReporter({ mochaFile: "test/output/foo/mocha.xml" });
    runTests(reporter, function () {
      verifyMochaFile(reporter.runner, filePath);
      done();
    });
  });

  it("creates valid XML report for invalid message", function (done) {
    const reporter = createReporter({ mochaFile: "test/output/mocha.xml" });
    runTests(reporter, { invalidChar: "\u001b" }, function () {
      assertXmlEquals(reporter._xml, mockXml(reporter.runner.stats));
      done();
    });
  });

  it("creates valid XML report even if title contains ANSI character sequences", function (done) {
    const reporter = createReporter({ mochaFile: "test/output/mocha.xml" });
    runTests(reporter, { title: "[38;5;104m[1mFoo Bar" }, function () {
      verifyMochaFile(reporter.runner, filePath);
      done();
    });
  });

  it('outputs pending tests if "includePending" is specified', function (done) {
    const reporter = createReporter({
      mochaFile: "test/output/mocha.xml",
      includePending: true,
    });
    runTests(reporter, { includePending: true }, function () {
      verifyMochaFile(reporter.runner, filePath);
      done();
    });
  });

  it("can output to the console", function (done) {
    const reporter = createReporter({
      mochaFile: "test/output/console.xml",
      toConsole: true,
    });

    const stdout = mockStdout();
    runTests(reporter, function () {
      verifyMochaFile(reporter.runner, filePath);

      const xml = stdout.output[0];
      assertXmlEquals(xml, mockXml(reporter.runner.stats));

      done();
    });
  });

  it("properly outputs tests when error in beforeAll", function (done) {
    const reporter = createReporter();
    const rootSuite = reporter.runner.suite;
    const suite1 = Suite.create(rootSuite, "failing beforeAll");
    suite1.beforeAll("failing hook", function () {
      throw new Error("error in before");
    });
    suite1.addTest(createTest("test 1"));

    const suite2 = Suite.create(rootSuite, "good suite");
    suite2.addTest(createTest("test 2"));

    runRunner(reporter.runner, function () {
      if (reporter.runner.dispose) {
        reporter.runner.dispose();
      }

      expect(reporter._testsuites).to.have.lengthOf(3);
      expect(reporter._testsuites[1].testsuite[0]._attr.name).to.equal(
        "Root Suite.failing beforeAll"
      );
      expect(reporter._testsuites[1].testsuite[1].testcase).to.have.lengthOf(2);

      let failureMessage = '"before all" hook: failing hook';
      if (!["2", "3", "4", "5"].includes(mochaVersion)) {
        // newer versions of Mocha include the name of the test in the message
        failureMessage += ' for "test 1"';
      }
      expect(
        reporter._testsuites[1].testsuite[1].testcase[0]._attr.name
      ).to.equal(failureMessage);
      expect(
        reporter._testsuites[1].testsuite[1].testcase[1].failure._attr.message
      ).to.equal("error in before");
      expect(reporter._testsuites[2].testsuite[0]._attr.name).to.equal(
        "Root Suite.good suite"
      );
      expect(reporter._testsuites[2].testsuite[1].testcase).to.have.lengthOf(1);
      expect(
        reporter._testsuites[2].testsuite[1].testcase[0]._attr.name
      ).to.equal("test 2");
      done();
    });
  });

  it("properly diffs errors from Chai", function (done) {
    const reporter = createReporter();
    const rootSuite = reporter.runner.suite;
    const suite1 = Suite.create(rootSuite, "failing with Chai");
    suite1.addTest(
      createTest("test 1", function () {
        expect({}).to.deep.equal({ missingProperty: true });
      })
    );

    runRunner(reporter.runner, function () {
      if (reporter.runner.dispose) {
        reporter.runner.dispose();
      }

      expect(reporter._testsuites).to.have.lengthOf(2);
      expect(reporter._testsuites[1].testsuite[0]._attr.name).to.equal(
        "Root Suite.failing with Chai"
      );
      expect(reporter._testsuites[1].testsuite[1].testcase).to.have.lengthOf(2);
      expect(
        reporter._testsuites[1].testsuite[1].testcase[0]._attr.name
      ).to.equal("test 1");
      expect(
        reporter._testsuites[1].testsuite[1].testcase[1].failure._attr.message
      ).to.equal("expected {} to deeply equal { missingProperty: true }");
      expect(
        reporter._testsuites[1].testsuite[1].testcase[1].failure._cdata
      ).to.match(
        /AssertionError: expected {} to deeply equal {\s*missingProperty:\s*true\s*}\n(?:\s* at .*?\n)*\n\s*\+ expected - actual\n+\s*-{}\n\s*\+{\n\s*\+\s*"missingProperty":\s*true\n\s*\+}[\s\S]*/
      );
      done();
    });
  });

  describe('when "outputs" option is specified', function () {
    it("adds output/error lines to xml report", function (done) {
      const reporter = createReporter({ outputs: true });

      const test = createTest("has outputs");
      test.consoleOutputs = ["hello", "world"];
      test.consoleErrors = ["typical diagnostic info", "all is OK"];

      const suite = Suite.create(
        reporter.runner.suite,
        "with console output and error"
      );
      suite.addTest(test);

      runRunner(reporter.runner, function () {
        expect(reporter._testsuites[1].testsuite[0]._attr.name).to.equal(
          "Root Suite." + suite.title
        );
        expect(reporter._testsuites[1].testsuite[1].testcase).to.have.length(3);
        expect(
          reporter._testsuites[1].testsuite[1].testcase[0]._attr.name
        ).to.equal(test.title);
        expect(
          reporter._testsuites[1].testsuite[1].testcase[1]
        ).to.have.property("system-out", "hello\nworld");
        expect(
          reporter._testsuites[1].testsuite[1].testcase[2]
        ).to.have.property("system-err", "typical diagnostic info\nall is OK");

        expect(reporter._xml).to.include(
          "<system-out>hello\nworld</system-out>"
        );
        expect(reporter._xml).to.include(
          "<system-err>typical diagnostic info\nall is OK</system-err>"
        );

        done();
      });
    });

    it("does not add system-out if no outputs/errors were passed", function (done) {
      const reporter = createReporter({ outputs: true });
      const test = createTest("has outputs");
      const suite = Suite.create(
        reporter.runner.suite,
        "with console output and error"
      );
      suite.addTest(test);

      runRunner(reporter.runner, function () {
        expect(reporter._testsuites[1].testsuite[0]._attr.name).to.equal(
          "Root Suite." + suite.title
        );
        expect(reporter._testsuites[1].testsuite[1].testcase).to.have.length(1);
        expect(
          reporter._testsuites[1].testsuite[1].testcase[0]._attr.name
        ).to.equal(test.title);

        expect(reporter._xml).not.to.include("<system-out>");
        expect(reporter._xml).not.to.include("<system-err>");

        done();
      });
    });

    it("does not add system-out if outputs/errors were empty", function (done) {
      const reporter = createReporter({ outputs: true });
      const test = createTest("has outputs");
      test.consoleOutputs = [];
      test.consoleErrors = [];

      const suite = Suite.create(
        reporter.runner.suite,
        "with console output and error"
      );
      suite.addTest(test);

      runRunner(reporter.runner, function () {
        expect(reporter._testsuites[1].testsuite[0]._attr.name).to.equal(
          "Root Suite." + suite.title
        );
        expect(reporter._testsuites[1].testsuite[1].testcase).to.have.length(1);
        expect(
          reporter._testsuites[1].testsuite[1].testcase[0]._attr.name
        ).to.equal(test.title);

        expect(reporter._xml).not.to.include("<system-out>");
        expect(reporter._xml).not.to.include("<system-err>");

        done();
      });
    });
  });

  describe('when "attachments" option is specified', function () {
    it("adds attachments to xml report", function (done) {
      const filePath = "/path/to/file";
      const reporter = createReporter({ attachments: true });
      const test = createTest("has attachment");
      test.attachments = [filePath];

      const suite = Suite.create(reporter.runner.suite, "with attachments");
      suite.addTest(test);

      runRunner(reporter.runner, function () {
        expect(reporter._testsuites[1].testsuite[0]._attr.name).to.equal(
          "Root Suite." + suite.title
        );
        expect(reporter._testsuites[1].testsuite[1].testcase).to.have.length(2);
        expect(
          reporter._testsuites[1].testsuite[1].testcase[0]._attr.name
        ).to.equal(test.title);
        expect(
          reporter._testsuites[1].testsuite[1].testcase[1]
        ).to.have.property("system-out", "[[ATTACHMENT|" + filePath + "]]");

        expect(reporter._xml).to.include(
          "<system-out>[[ATTACHMENT|" + filePath + "]]</system-out>"
        );

        done();
      });
    });

    it("does not add system-out if no attachments were passed", function (done) {
      const reporter = createReporter({ attachments: true });
      const test = createTest("has attachment");

      const suite = Suite.create(reporter.runner.suite, "with attachments");
      suite.addTest(test);

      runRunner(reporter.runner, function () {
        expect(reporter._testsuites[1].testsuite[0]._attr.name).to.equal(
          "Root Suite." + suite.title
        );
        expect(reporter._testsuites[1].testsuite[1].testcase).to.have.lengthOf(
          1
        );
        expect(
          reporter._testsuites[1].testsuite[1].testcase[0]._attr.name
        ).to.equal(test.title);

        expect(reporter._xml).to.not.include("<system-out>");

        done();
      });
    });

    it("does not add system-out if attachments array is empty", function (done) {
      const reporter = createReporter({ attachments: true });
      const test = createTest("has attachment");
      test.attachments = [];

      const suite = Suite.create(reporter.runner.suite, "with attachments");
      suite.addTest(test);

      runRunner(reporter.runner, function () {
        expect(reporter._testsuites[1].testsuite[0]._attr.name).to.equal(
          "Root Suite." + suite.title
        );
        expect(reporter._testsuites[1].testsuite[1].testcase).to.have.lengthOf(
          1
        );
        expect(
          reporter._testsuites[1].testsuite[1].testcase[0]._attr.name
        ).to.equal(test.title);

        expect(reporter._xml).to.not.include("<system-out>");

        done();
      });
    });

    it("includes both console outputs and attachments in XML", function (done) {
      const reporter = createReporter({ attachments: true, outputs: true });
      const test = createTest("has attachment");
      const filePath = "/path/to/file";
      test.attachments = [filePath];
      test.consoleOutputs = ["first console line", "second console line"];

      const suite = Suite.create(
        reporter.runner.suite,
        "with attachments and outputs"
      );
      suite.addTest(test);

      runRunner(reporter.runner, function () {
        expect(reporter._testsuites[1].testsuite[0]._attr.name).to.equal(
          "Root Suite." + suite.title
        );
        expect(reporter._testsuites[1].testsuite[1].testcase).to.have.length(2);
        expect(
          reporter._testsuites[1].testsuite[1].testcase[0]._attr.name
        ).to.equal(test.title);
        expect(
          reporter._testsuites[1].testsuite[1].testcase[1]
        ).to.have.property(
          "system-out",
          "first console line\nsecond console line\n[[ATTACHMENT|" +
            filePath +
            "]]"
        );

        expect(reporter._xml).to.include(
          "<system-out>first console line\nsecond console line\n[[ATTACHMENT|" +
            filePath +
            "]]</system-out>"
        );

        done();
      });
    });
  });

  describe("Output", function () {
    it("skips suites with empty title", function (done) {
      const reporter = createReporter();
      const suite = Suite.create(reporter.runner.suite, "");
      suite.root = false; // mocha treats suites with empty title as root, so not sure this is possible
      suite.addTest(createTest("test"));

      runRunner(reporter.runner, function () {
        expect(reporter._testsuites).to.have.lengthOf(1);
        expect(reporter._testsuites[0].testsuite[0]._attr.name).to.equal(
          "Root Suite"
        );
        done();
      });
    });

    it("skips suites without testcases and suites", function (done) {
      const reporter = createReporter();
      Suite.create(reporter.runner.suite, "empty suite");

      // mocha won't emit the `suite` event if a suite has no tests in it, so we won't even output the root suite.
      // See https://github.com/mochajs/mocha/blob/c0137eb698add08f29035467ea1dc230904f82ba/lib/runner.js#L723.
      runRunner(reporter.runner, function () {
        expect(reporter._testsuites).to.have.lengthOf(0);
        done();
      });
    });

    it("skips suites without testcases even if they have nested suites", function (done) {
      const reporter = createReporter();
      const suite1 = Suite.create(reporter.runner.suite, "suite");
      Suite.create(suite1, "nested suite");

      runRunner(reporter.runner, function () {
        // even though we have nested suites, there are no tests so mocha won't emit the `suite` event
        expect(reporter._testsuites).to.have.lengthOf(0);
        done();
      });
    });

    it("does not skip suites with nested tests", function (done) {
      const reporter = createReporter();
      const suite = Suite.create(reporter.runner.suite, "nested suite");
      suite.addTest(createTest("test"));

      runRunner(reporter.runner, function () {
        expect(reporter._testsuites).to.have.lengthOf(2);
        expect(reporter._testsuites[0].testsuite[0]._attr.name).to.equal(
          "Root Suite"
        );
        expect(reporter._testsuites[1].testsuite[1].testcase).to.have.lengthOf(
          1
        );
        expect(
          reporter._testsuites[1].testsuite[1].testcase[0]._attr.name
        ).to.equal("test");
        done();
      });
    });

    it("does not skip root suite", function (done) {
      const reporter = createReporter();
      reporter.runner.suite.addTest(createTest("test"));

      runRunner(reporter.runner, function () {
        expect(reporter._testsuites).to.have.lengthOf(1);
        expect(reporter._testsuites[0].testsuite[0]._attr.name).to.equal(
          "Root Suite"
        );
        expect(reporter._testsuites[0].testsuite[1].testcase).to.have.lengthOf(
          1
        );

        let expectedName = "test";
        if (["2", "3"].includes(mochaVersion)) {
          expectedName = " " + expectedName;
        }
        expect(
          reporter._testsuites[0].testsuite[1].testcase[0]._attr.name
        ).to.equal(expectedName);
        done();
      });
    });

    it('uses "Mocha Tests" by default', function (done) {
      const reporter = createReporter();
      reporter.runner.suite.addTest(createTest("test"));

      runRunner(reporter.runner, function () {
        expect(reporter._xml).to.include('testsuites name="Mocha Tests"');
        done();
      });
    });

  });

  describe("GitLab format", function () {
    it("generates GitLab compatible classnames and test names", function (done) {
      const reporter = createReporter();
      const rootSuite = reporter.runner.suite;

      const suite1 = Suite.create(rootSuite, "Authentication Tests");
      const suite2 = Suite.create(suite1, "LoginTest");
      suite2.addTest(createTest("test_invalid_password"));

      const suite3 = Suite.create(suite1, "LogoutTest");
      suite3.addTest(
        createTest("test_session_cleanup", function (done) {
          done(new Error("session cleanup failed"));
        })
      );

      runRunner(reporter.runner, function () {
        // In GitLab mode, classname should be the suite hierarchy
        // and name should be the individual test name
        expect(
          reporter._testsuites[2].testsuite[1].testcase[0]._attr.name
        ).to.equal("test_invalid_password");
        expect(
          reporter._testsuites[2].testsuite[1].testcase[0]._attr.classname
        ).to.equal("Authentication Tests.LoginTest");

        expect(
          reporter._testsuites[3].testsuite[1].testcase[0]._attr.name
        ).to.equal("test_session_cleanup");
        expect(
          reporter._testsuites[3].testsuite[1].testcase[0]._attr.classname
        ).to.equal("Authentication Tests.LogoutTest");

        done();
      });
    });

    it("includes file attribute in testcases", function (done) {
      const reporter = createReporter();
      const rootSuite = reporter.runner.suite;

      const suite1 = Suite.create(rootSuite, "Test Suite");
      const test = createTest("test_with_file");
      // Use a relative path
      test.file = "test/file.js";
      suite1.addTest(test);

      runRunner(reporter.runner, function () {
        const testcase = reporter._testsuites[1].testsuite[1].testcase[0];
        expect(testcase._attr.file).to.equal("test/file.js");

        done();
      });
    });

    it("uses dot separator for suite titles", function (done) {
      const reporter = createReporter();
      const rootSuite = reporter.runner.suite;

      const suite1 = Suite.create(rootSuite, "Level 1");
      const suite2 = Suite.create(suite1, "Level 2");
      const suite3 = Suite.create(suite2, "Level 3");
      suite3.addTest(createTest("nested test"));

      runRunner(reporter.runner, function () {
        expect(reporter._testsuites[3].testsuite[0]._attr.name).to.equal(
          "Root Suite.Level 1.Level 2.Level 3"
        );
        expect(
          reporter._testsuites[3].testsuite[1].testcase[0]._attr.classname
        ).to.equal("Level 1.Level 2.Level 3");

        done();
      });
    });

    it("generates well-formed XML", function (done) {
      const reporter = createReporter();
      const rootSuite = reporter.runner.suite;

      const suite1 = Suite.create(rootSuite, "Authentication Tests");
      const suite2 = Suite.create(suite1, "LoginTest");
      const test = createTest("test_valid_login");
      test.file = "test/auth_test.js";
      suite2.addTest(test);

      const suite3 = Suite.create(rootSuite, "Another Suite");
      suite3.addTest(
        createTest("test_failure", function (done) {
          done(new Error("failed test"));
        })
      );

      runRunner(reporter.runner, function () {
        // Check that XML is well-formed and contains expected elements
        expect(reporter._xml).to.include("<?xml");
        expect(reporter._xml).to.include("<testsuites");
        expect(reporter._xml).to.include("<testsuite");
        expect(reporter._xml).to.include("<testcase");
        expect(reporter._xml).to.include('name="test_valid_login"');
        expect(reporter._xml).to.include(
          'classname="Authentication Tests.LoginTest"'
        );
        expect(reporter._xml).to.include('file="test/auth_test.js"');
        expect(reporter._xml).to.include("<failure");

        done();
      });
    });

    it("includes attachments in system-out", function (done) {
      const filePath = "/path/to/screenshot.png";
      const reporter = createReporter({ attachments: true });
      const rootSuite = reporter.runner.suite;

      const suite1 = Suite.create(rootSuite, "Test Suite");
      const test = createTest("test_with_screenshot");
      test.attachments = [filePath];
      suite1.addTest(test);

      runRunner(reporter.runner, function () {
        expect(reporter._xml).to.include("[[ATTACHMENT|" + filePath + "]]");
        expect(reporter._xml).to.include(
          "<system-out>[[ATTACHMENT|" + filePath + "]]</system-out>"
        );

        done();
      });
    });

    it("correctly handles tests without file attribute", function (done) {
      const reporter = createReporter();
      const rootSuite = reporter.runner.suite;

      const suite1 = Suite.create(rootSuite, "Test Suite");
      const test = createTest("test_without_file");
      // Deliberately not setting test.file
      suite1.addTest(test);

      runRunner(reporter.runner, function () {
        const testcase = reporter._testsuites[1].testsuite[1].testcase[0];
        // File attribute should not be present if test.file is not set
        expect(testcase._attr.file).to.be.undefined;

        done();
      });
    });

    it("converts absolute file paths to relative paths", function (done) {
      const reporter = createReporter();
      const rootSuite = reporter.runner.suite;

      const suite1 = Suite.create(rootSuite, "Test Suite");
      const test = createTest("test_with_absolute_path");
      // Set an absolute path that should be converted to relative
      const absolutePath = path.join(
        process.cwd(),
        "test",
        "example.js"
      );
      test.file = absolutePath;
      suite1.addTest(test);

      runRunner(reporter.runner, function () {
        const testcase = reporter._testsuites[1].testsuite[1].testcase[0];
        // File should be relative to cwd
        expect(testcase._attr.file).to.equal(path.join("test", "example.js"));
        // Should NOT be an absolute path
        expect(testcase._attr.file).not.to.include(process.cwd());

        done();
      });
    });


    it("does not transform file paths when pattern is not configured", function (done) {
      const reporter = createReporter();
      const rootSuite = reporter.runner.suite;

      const suite1 = Suite.create(rootSuite, "Test Suite");
      const test = createTest("test_without_transformation");
      test.file = "build/modules/test.spec.js";
      suite1.addTest(test);

      runRunner(reporter.runner, function () {
        const testcase = reporter._testsuites[1].testsuite[1].testcase[0];
        // File path should remain unchanged
        expect(testcase._attr.file).to.equal("build/modules/test.spec.js");

        done();
      });
    });

    it("uses suite file when test.file doesn't exist", function (done) {
      const reporter = createReporter();
      const rootSuite = reporter.runner.suite;

      const suite1 = Suite.create(rootSuite, "Test Suite");
      suite1.file = "test/suite.spec.js";
      const test = createTest("test_inheriting_suite_file");
      // Deliberately not setting test.file
      suite1.addTest(test);

      runRunner(reporter.runner, function () {
        const testcase = reporter._testsuites[1].testsuite[1].testcase[0];
        // File attribute should be inherited from suite
        expect(testcase._attr.file).to.equal("test/suite.spec.js");

        done();
      });
    });

    it("uses root suite file when test and parent suite don't have file", function (done) {
      const reporter = createReporter();
      const rootSuite = reporter.runner.suite;
      rootSuite.file = "test/root.spec.js";

      const suite1 = Suite.create(rootSuite, "Test Suite");
      const test = createTest("test_inheriting_root_file");
      // Neither test nor suite1 have file property
      suite1.addTest(test);

      runRunner(reporter.runner, function () {
        const testcase = reporter._testsuites[1].testsuite[1].testcase[0];
        // File attribute should be inherited from root suite
        expect(testcase._attr.file).to.equal("test/root.spec.js");

        done();
      });
    });

    it("uses nearest parent suite file in nested structure", function (done) {
      const reporter = createReporter();
      const rootSuite = reporter.runner.suite;
      rootSuite.file = "test/root.spec.js";

      const suite1 = Suite.create(rootSuite, "Level 1");
      const suite2 = Suite.create(suite1, "Level 2");
      suite2.file = "test/level2.spec.js";
      const suite3 = Suite.create(suite2, "Level 3");
      const test = createTest("test_nested_inheritance");
      // test doesn't have file property
      suite3.addTest(test);

      runRunner(reporter.runner, function () {
        const testcase = reporter._testsuites[3].testsuite[1].testcase[0];
        // Should use the nearest parent with file property (suite2)
        expect(testcase._attr.file).to.equal("test/level2.spec.js");

        done();
      });
    });

    it("prefers test.file over suite file", function (done) {
      const reporter = createReporter();
      const rootSuite = reporter.runner.suite;

      const suite1 = Suite.create(rootSuite, "Test Suite");
      suite1.file = "test/suite.spec.js";
      const test = createTest("test_with_own_file");
      test.file = "test/specific-test.js";
      suite1.addTest(test);

      runRunner(reporter.runner, function () {
        const testcase = reporter._testsuites[1].testsuite[1].testcase[0];
        // Should use test's own file, not the suite's
        expect(testcase._attr.file).to.equal("test/specific-test.js");

        done();
      });
    });

    it("caches file across multiple tests in same suite", function (done) {
      const reporter = createReporter();
      const rootSuite = reporter.runner.suite;

      const suite1 = Suite.create(rootSuite, "Test Suite");
      suite1.file = "test/shared.spec.js";

      const test1 = createTest("test_one");
      const test2 = createTest("test_two");
      const test3 = createTest("test_three");
      // None of the tests have their own file property
      suite1.addTest(test1);
      suite1.addTest(test2);
      suite1.addTest(test3);

      runRunner(reporter.runner, function () {
        const testcase1 = reporter._testsuites[1].testsuite[1].testcase[0];
        const testcase2 = reporter._testsuites[1].testsuite[2].testcase[0];
        const testcase3 = reporter._testsuites[1].testsuite[3].testcase[0];

        // All tests should have the same file from the suite
        expect(testcase1._attr.file).to.equal("test/shared.spec.js");
        expect(testcase2._attr.file).to.equal("test/shared.spec.js");
        expect(testcase3._attr.file).to.equal("test/shared.spec.js");

        done();
      });
    });

    it("converts inherited absolute file paths to relative paths", function (done) {
      const reporter = createReporter();
      const rootSuite = reporter.runner.suite;

      const suite1 = Suite.create(rootSuite, "Test Suite");
      const absolutePath = path.join(
        process.cwd(),
        "test",
        "suite.spec.js"
      );
      suite1.file = absolutePath;
      const test = createTest("test_inheriting_absolute_path");
      suite1.addTest(test);

      runRunner(reporter.runner, function () {
        const testcase = reporter._testsuites[1].testsuite[1].testcase[0];
        // Inherited absolute path should be converted to relative
        expect(testcase._attr.file).to.equal(path.join("test", "suite.spec.js"));
        expect(testcase._attr.file).not.to.include(process.cwd());

        done();
      });
    });

    it("applies filePathTransforms to inherited file paths", function (done) {
      const reporter = createReporter({
        filePathTransforms: "[{search: '^build/', replace: 'src/'}]"
      });
      const rootSuite = reporter.runner.suite;

      const suite1 = Suite.create(rootSuite, "Test Suite");
      suite1.file = "build/modules/test.spec.js";
      const test = createTest("test_transformed_inherited_path");
      suite1.addTest(test);

      runRunner(reporter.runner, function () {
        const testcase = reporter._testsuites[1].testsuite[1].testcase[0];
        // Inherited file path should be transformed
        expect(testcase._attr.file).to.equal("src/modules/test.spec.js");

        done();
      });
    });

    it("can enable console reporter", function (done) {
      // This test verifies that the consoleReporter option doesn't break the reporter
      // We can't easily test the console output itself, but we can verify the reporter still works
      const reporter = createReporter({
        consoleReporter: "spec"
      });
      const rootSuite = reporter.runner.suite;

      const suite1 = Suite.create(rootSuite, "Test Suite");
      suite1.addTest(createTest("test_with_console_reporter"));

      runRunner(reporter.runner, function () {
        const testcase = reporter._testsuites[1].testsuite[1].testcase[0];
        expect(testcase._attr.name).to.equal("test_with_console_reporter");

        done();
      });
    });

    it("transforms file paths using multiple pattern pairs", function (done) {
      const reporter = createReporter({
        filePathTransforms: String.raw`[{search: '^build/'| replace: 'src/'}|{search: '\.spec\.js$'| replace: '.js'}]`
      });
      const rootSuite = reporter.runner.suite;

      const suite1 = Suite.create(rootSuite, "Test Suite");
      const test = createTest("test_with_multiple_transforms");
      // Set a file path that will be transformed by both patterns
      test.file = "build/modules/memberData/tasks/transfer.spec.js";
      suite1.addTest(test);

      runRunner(reporter.runner, function () {
        const testcase = reporter._testsuites[1].testsuite[1].testcase[0];
        // File path should have both transformations applied
        expect(testcase._attr.file).to.equal("src/modules/memberData/tasks/transfer.js");

        done();
      });
    });

    it("applies transformations sequentially", function (done) {
      const reporter = createReporter({
        filePathTransforms: "[{search: 'build'| replace: 'src'}|{search: 'src/'| replace: 'source/'}]"
      });
      const rootSuite = reporter.runner.suite;

      const suite1 = Suite.create(rootSuite, "Test Suite");
      const test = createTest("test_sequential_transforms");
      test.file = "build/test.js";
      suite1.addTest(test);

      runRunner(reporter.runner, function () {
        const testcase = reporter._testsuites[1].testsuite[1].testcase[0];
        // First transform: "build" -> "src" = "src/test.js"
        // Second transform: "src/" -> "source/" = "source/test.js"
        expect(testcase._attr.file).to.equal("source/test.js");

        done();
      });
    });

    it("supports single transform pattern", function (done) {
      const reporter = createReporter({
        filePathTransforms: "{search: '^build/'| replace: 'src/'}"
      });
      const rootSuite = reporter.runner.suite;

      const suite1 = Suite.create(rootSuite, "Test Suite");
      const test = createTest("test_with_single_pattern");
      test.file = "build/test.spec.js";
      suite1.addTest(test);

      runRunner(reporter.runner, function () {
        const testcase = reporter._testsuites[1].testsuite[1].testcase[0];
        expect(testcase._attr.file).to.equal("src/test.spec.js");

        done();
      });
    });

    it("throws error when filePathTransforms is not a string", function () {
      expect(function () {
        createReporter({
          filePathTransforms: [
            { search: "^build/", replace: "src/" }
          ]
        });
      }).to.throw("filePathTransforms must be a string value");
    });

    it("throws error when filePathTransforms has incomplete pair", function () {
      expect(function () {
        createReporter({
          filePathTransforms: "[{search: '^build/'| replace: 'src/'}|{search: 'test'}]" // missing replace
        });
      }).to.throw("filePathTransforms[1] must have both 'search' and 'replace' properties.");
    });

    it("throws error when single transform is incomplete", function () {
      expect(function () {
        createReporter({
          filePathTransforms: "{search: '^build/'}" // missing replace
        });
      }).to.throw("filePathTransforms must have both 'search' and 'replace' properties.");
    });

    it("supports JSON string format for filePathTransforms", function (done) {
      const reporter = createReporter({
        filePathTransforms: JSON.stringify([
            { search: "^build/", replace: "src/" },
            { search: String.raw`\.spec\.js$`, replace: ".js" }
          ])
      });
      const rootSuite = reporter.runner.suite;

      const suite1 = Suite.create(rootSuite, "Test Suite");
      const test = createTest("test_json_string");
      test.file = "build/test.spec.js";
      suite1.addTest(test);

      runRunner(reporter.runner, function () {
        const testcase = reporter._testsuites[1].testsuite[1].testcase[0];
        expect(testcase._attr.file).to.equal("src/test.js");

        done();
      });
    });

    it("throws error when JSON string is invalid", function () {
      expect(function () {
        createReporter({
          filePathTransforms: "not valid json"
        });
      }).to.throw(/filePathTransforms must be valid JSON/);
    });

    it("supports pipe-delimited format for CLI usage", function (done) {
      // This format is easier for CLI where commas can be problematic
      const reporter = createReporter({
        filePathTransforms: String.raw`[{search: '^build/'| replace: 'src/'}|{search: '\.spec\.js$'| replace: '.js'}]`
      });
      const rootSuite = reporter.runner.suite;

      const suite1 = Suite.create(rootSuite, "Test Suite");
      const test = createTest("test_pipe_delimited");
      test.file = "build/test.spec.js";
      suite1.addTest(test);

      runRunner(reporter.runner, function () {
        const testcase = reporter._testsuites[1].testsuite[1].testcase[0];
        expect(testcase._attr.file).to.equal("src/test.js");

        done();
      });
    });

    it("supports pipe-delimited format with spaces", function (done) {
      const reporter = createReporter({
        filePathTransforms: "[{search: '^build/' | replace: 'src/'} | {search: '^src/' | replace: 'src2/'}]"
      });
      const rootSuite = reporter.runner.suite;

      const suite1 = Suite.create(rootSuite, "Test Suite");
      const test = createTest("test_pipe_with_spaces");
      test.file = "build/test.js";
      suite1.addTest(test);

      runRunner(reporter.runner, function () {
        const testcase = reporter._testsuites[1].testsuite[1].testcase[0];
        // First: "build/test.js" -> "src/test.js"
        // Second: "src/test.js" -> "src2/test.js"
        expect(testcase._attr.file).to.equal("src2/test.js");

        done();
      });
    });
  });
});
