# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- Refined code to fix linting issues
- Replaced `mkdirp` dependency with `fs.mkdirSync`
- Replaced `md5` dependency with `crypto.createHash`
- Replaced `rimraf` devDependency with `fs.promises.rm`
- Added `engines` field to `package.json` to specify supported Node.js versions

## [1.0.0]

Initial release

[Unreleased]: https://github.com/X-Guardian/mocha-gitlab-reporter/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/X-Guardian/mocha-gitlab-reporter/releases/tag/v1.0.0
