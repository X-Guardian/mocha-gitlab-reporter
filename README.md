# mocha-gitlab-reporter

[![npm][npm-badge]][npm-listing]

A GitLab CI compatible JUnit XML reporter for Mocha. Generates test reports that display correctly in GitLab's merge request and pipeline interfaces.

## Why This Reporter?

GitLab CI has specific requirements for JUnit XML format to properly display test results. This reporter is specifically designed to generate XML that GitLab CI expects, ensuring your test results display correctly with:

- Test names and suite hierarchies properly formatted
- Relative file paths for easy navigation
- Proper classname/name structure that GitLab recognizes
- Full support for attachments (screenshots, logs, etc.)

## Installation

```shell
$ npm install mocha-gitlab-reporter --save-dev
```

## Usage

Run mocha with `mocha-gitlab-reporter`:

```shell
$ mocha test --reporter mocha-gitlab-reporter
```

This will output a results file at `./test-results.xml`.

You may optionally declare an alternate location for the results XML file by setting the environment variable `MOCHA_FILE` or specifying `mochaFile` in `reporterOptions`:

```shell
$ MOCHA_FILE=./path_to_your/file.xml mocha test --reporter mocha-gitlab-reporter
```

or

```shell
$ mocha test --reporter mocha-gitlab-reporter --reporter-options mochaFile=./path_to_your/file.xml
```

or

```javascript
var mocha = new Mocha({
    reporter: 'mocha-gitlab-reporter',
    reporterOptions: [
        "mochaFile=./path_to_your/file.xml"
    ]
});
```

## GitLab CI Configuration

Add this to your `.gitlab-ci.yml`:

```yaml
test:
  stage: test
  script:
    - npm install
    - npm test
  artifacts:
    when: always
    reports:
      junit: test-results.xml
```

## Features

### Proper Test Hierarchy

The reporter automatically generates XML with the correct structure for GitLab:
- `testcase classname` = full suite hierarchy (e.g., "API Tests.UserController")
- `testcase name` = individual test name (e.g., "should create user")
- Suite titles are always separated by `.` for clean display in GitLab
- Full suite titles are always included (nested suite hierarchy)
- file paths are automatically included in test cases and converted to be relative to the current working directory

### Console Reporter

By default, this reporter only generates the XML file without console output. If you want to see test results in the console while also generating the GitLab XML report, you can enable a console reporter:

```javascript
var mocha = new Mocha({
    reporter: 'mocha-gitlab-reporter',
    reporterOptions: [
        "consoleReporter=spec"
    ]
});
```

Or via command line:

```shell
$ mocha test --reporter mocha-gitlab-reporter --reporter-options consoleReporter=spec
```

Or via environment variable:

```shell
$ CONSOLE_REPORTER=spec mocha test --reporter mocha-gitlab-reporter
```

You can use any built-in Mocha reporter name (`spec`, `dot`, `nyan`, `tap`, `landing`, `list`, `progress`, `json`, `min`, etc.) or a custom reporter module.

### Console Output Capture

You can capture console output and errors:

```javascript
it('should report output', function() {
  this.test.consoleOutputs = ['line 1 of output', 'line 2 of output'];
});

it('should report error', function() {
  this.test.consoleErrors = ['line 1 of errors', 'line 2 of errors'];
});
```

Enable outputs in your reporter options:

```javascript
var mocha = new Mocha({
    reporter: 'mocha-gitlab-reporter',
    reporterOptions: [
        "outputs=true"
    ]
});
```

### File Path Transformation

If your test files are built/compiled to a different directory, you can use regex to transform the file paths in the report. This is useful when you want the report to reference source files instead of compiled files.

You can apply multiple transformations sequentially using the `filePathTransforms` option. This is useful when you need to perform multiple replacements on file paths.

**Note:** The `filePathTransforms` value must be a **string**. Use the pipe-delimited format for easier CLI usage.

#### Single Transformation

```javascript
var mocha = new Mocha({
    reporter: 'mocha-gitlab-reporter',
    reporterOptions: [
        "filePathTransforms={search: '^build/'| replace: 'src/'}"
    ]
});
```

#### Multiple Transformations

```javascript
var mocha = new Mocha({
    reporter: 'mocha-gitlab-reporter',
    reporterOptions: [
        "filePathTransforms=[{search: '^build/'| replace: 'src/'}|{search: '.js$'| replace: '.ts'}]"
    ]
});
```

This will transform paths like:
- `build/modules/example.spec.js`

To:
- `src/modules/example.test.ts`

The transformations are applied in order, so the output of the first transformation becomes the input to the second transformation.

#### Using with `.mocharc.js` configuration file

```javascript
module.exports = {
  reporter: 'mocha-gitlab-reporter',
  reporterOptions: [
    "mochaFile=./test-results.xml",
    "filePathTransforms=[{search: '^build/'| replace: 'src/'}|{search: '.js$'| replace: '.ts'}]"
  ]
};
```

#### Using via command line

```shell
$ mocha test --reporter mocha-gitlab-reporter --reporter-options 'filePathTransforms=[{"search":"^build/","replace":"src/"}]'
```

### Attachments Support

You can attach files and screenshots using the [JUnit Attachments Plugin](https://wiki.jenkins.io/display/JENKINS/JUnit+Attachments+Plugin) format:

```javascript
it('should display login page', function() {
  // Your test code
  this.test.attachments = ['/absolute/path/to/screenshot.png'];
});
```

Enable attachments in your reporter options:

```javascript
var mocha = new Mocha({
    reporter: 'mocha-gitlab-reporter',
    reporterOptions: [
        "attachments=true"
    ]
});
```

## Configuration Options

| Parameter               | Default              | Effect                                                                                           |
| ----------------------- | -------------------- | ------------------------------------------------------------------------------------------------ |
| mochaFile               | `test-results.xml`   | Configures the file to write reports to                                                          |
| includePending          | `false`              | If set to a truthy value pending tests will be included in the report                            |
| toConsole               | `false`              | If set to a truthy value the produced XML will be logged to the console                          |
| consoleReporter         | `null`               | Name of a Mocha reporter to also output to console (e.g., `"spec"`, `"dot"`, `"nyan"`)           |
| outputs                 | `false`              | If set to truthy value will include console output and console error output                      |
| attachments             | `false`              | If set to truthy value will attach files to report in JUnit Attachments Plugin format            |
| filePathTransforms      | `null`               | String with pipe-delimited transformations (e.g., `"[{search: '^build/'| replace: 'src/'}]"`) |

### Results Report Filename Placeholders

Results XML filename can contain placeholders for dynamic values:

| placeholder         | output                                            |
| ------------------- | ------------------------------------------------- |
| `[hash]`            | MD5 hash of test results XML                      |
| `[testsuitesTitle]` | Fixed value: "Mocha Tests"                        |
| `[rootSuiteTitle]`  | Fixed value: "Root Suite"                         |
| `[suiteFilename]`   | Filename of the spec file                         |
| `[suiteName]`       | Name of the first test suite                      |

Example:

```javascript
var mocha = new Mocha({
    reporter: 'mocha-gitlab-reporter',
    reporterOptions: [
        "mochaFile=test-results.[hash].xml"
    ]
});
```

This enables support of parallel execution of multiple `mocha-gitlab-reporter`'s writing test results in separate files.

## Example Output

Here's what the XML output looks like:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<testsuites name="Mocha Tests" time="0.001" tests="1" failures="0">
  <testsuite name="Root Suite.API Tests.UserController" timestamp="2025-10-20T17:09:03" tests="1" time="0.001" failures="0">
    <testcase name="should create user" time="0.000" classname="API Tests.UserController" file="test/api/user-test.js">
    </testcase>
  </testsuite>
</testsuites>
```

Note how:
- `classname="API Tests.UserController"` - This is what GitLab displays as the suite name
- `name="should create user"` - This is the individual test name
- `file="test/api/user-test.js"` - Relative path for navigation

## Differences from mocha-junit-reporter

This package is a simplified, GitLab-focused fork of [mocha-junit-reporter](https://github.com/michaelleeallen/mocha-junit-reporter). Key differences:

- **Simplified configuration** - Removed Jenkins-specific and Ant-specific options
- **Optimized for GitLab CI** - Default settings work out of the box with GitLab

## Resources

- [GitLab CI Unit Test Reports Documentation](https://docs.gitlab.com/ci/testing/unit_test_reports/)
- [JUnit XML Format](http://windyroad.org/dl/Open%20Source/JUnit.xsd)

## License

MIT

[npm-badge]: https://img.shields.io/npm/v/mocha-gitlab-reporter.svg?maxAge=2592000
[npm-listing]: https://www.npmjs.com/package/mocha-gitlab-reporter
