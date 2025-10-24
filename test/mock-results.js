'use strict';

const xml = require('xml');

module.exports = function(stats) {
  const data = {
    testsuites: [
      {
        _attr: {
          name: "Mocha Tests",
          tests: 4,
          failures: "2",
          time: ((stats.duration || 0) / 1000).toFixed(3)
        }
      },
      {
        testsuite: [
          {
            _attr: {
              name: "Root Suite",
              timestamp: "1970-01-01T00:00:00", // ISO timestamp truncated to the second
              tests: "0",
              failures: "0",
              time: "0.000"
            }
          }
        ]
      },
      {
        testsuite: [
          {
            _attr: {
              name: "Root Suite.Foo Bar",
              timestamp: "1970-01-01T00:00:00",
              tests: "3",
              failures: "2",
              time: "100.001"
            }
          },
          {
            testcase: {
              _attr: {
                name: "can weez the juice",
                classname: "Foo Bar",
                time: "0.101"
              }
            }
          },
          {
            testcase: [
              {
                _attr: {
                  name: "can narfle the garthog",
                  classname: "Foo Bar",
                  time: "2.002"
                }
              },
              {
                failure: {
                  _attr: {
                      message: "expected garthog to be dead",
                      type: "Error"
                  },
                  _cdata: "this is where the stack would be"
                }
              }
            ]
          },
          {
            testcase: [
              {
                _attr: {
                  name: "can behave like a flandip",
                  classname: "Foo Bar",
                  time: "30.003"
                }
              },
              {
                failure: {
                  _attr: {
                      message: "expected baz to be masher, a hustler, an uninvited grasper of cone",
                      type: "BazError"
                  },
                  _cdata: "stack"
                }
              }
            ]
          }
        ]
      },
      {
        testsuite: [
          {
            _attr: {
              name: "Root Suite.Another suite!",
              timestamp: "1970-01-01T00:01:40", // new Date(100001).toISOString().slice(0, -5)
              tests: "1",
              failures: "0",
              time: "400.005"
            }
          },
          {
            testcase: {
              _attr: {
                name: "works",
                classname: "Another suite!",
                time: "400.004"
              }
            }
          }
        ]
      }
    ]
  };

  if (stats.pending) {
    data.testsuites[0]._attr.tests += stats.pending;
    data.testsuites[0]._attr.skipped = stats.pending;
    data.testsuites.push({
      testsuite: [
        {
          _attr: {
            name: "Root Suite.Pending suite!",
            timestamp: "1970-01-01T00:08:20", // new Date(100001 + 400005).toISOString().slice(0, -5)
            tests: "1",
            failures: "0",
            skipped: "1",
            time: "0.000"
          }
        },
        {
          testcase: [
            {
              _attr: {
                name: "pending",
                classname: "Pending suite!",
                time: "0.000"
              }
            },
            {
              skipped: null
            }
          ]
        }
      ]
    });
  }

  return xml(data, {declaration: true});
};
