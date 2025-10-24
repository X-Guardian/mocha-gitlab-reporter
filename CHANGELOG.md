# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Added `engines` field to `package.json` specifying Node.js >= 14.14.0 requirement
- Created separate `lib/xml-builder.js` module for XML generation functions

### Changed

- Refined code to fix linting issues
- Reorganized project structure: moved source code to `src/` directory

### Removed

- Removed `mkdirp` dependency (replaced with native `fs.mkdirSync()`)
- Removed `md5` dependency (replaced with `crypto.createHash()`)
- Removed `rimraf` devDependency (replaced with native `fs.promises.rm()`)
- Removed `xml` dependency (replaced with custom XML builder)
- Removed redundant `[testsuitesTitle]` and `[rootSuiteTitle]` filename placeholders (were constants)

### Fixed

- Fixed issue where file paths were not correctly inherited from parent suites through multiple nesting levels

## [1.0.0]

Initial release

[Unreleased]: https://github.com/X-Guardian/mocha-gitlab-reporter/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/X-Guardian/mocha-gitlab-reporter/releases/tag/v1.0.0
