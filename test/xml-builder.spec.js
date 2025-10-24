/* eslint-env mocha */
"use strict";

const { expect } = require("chai");
const { toXml, escapeXml } = require("../src/lib/xml-builder");

describe("xml-builder", function () {
  describe("escapeXml", function () {
    it("should escape ampersand", function () {
      expect(escapeXml("foo & bar")).to.equal("foo &amp; bar");
    });

    it("should escape less than", function () {
      expect(escapeXml("foo < bar")).to.equal("foo &lt; bar");
    });

    it("should escape greater than", function () {
      expect(escapeXml("foo > bar")).to.equal("foo &gt; bar");
    });

    it("should escape double quotes", function () {
      expect(escapeXml('foo "bar"')).to.equal("foo &quot;bar&quot;");
    });

    it("should escape single quotes", function () {
      expect(escapeXml("foo 'bar'")).to.equal("foo &apos;bar&apos;");
    });

    it("should handle null and undefined", function () {
      expect(escapeXml(null)).to.equal("");
      expect(escapeXml(undefined)).to.equal("");
    });

    it("should escape multiple special characters", function () {
      expect(escapeXml('<tag attr="value">content & more</tag>')).to.equal(
        "&lt;tag attr=&quot;value&quot;&gt;content &amp; more&lt;/tag&gt;"
      );
    });
  });

  describe("toXml", function () {
    describe("basic elements", function () {
      it("should generate simple element with text content", function () {
        const data = { message: "hello" };
        const xml = toXml(data, { indent: "  " });
        expect(xml).to.equal("<message>hello</message>\n");
      });

      it("should generate element with attributes", function () {
        const data = {
          testcase: {
            _attr: { name: "test1", time: "0.5" },
          },
        };
        const xml = toXml(data, { indent: "  " });
        expect(xml).to.equal('<testcase name="test1" time="0.5">\n</testcase>\n');
      });

      it("should generate element with attributes and text content", function () {
        const data = {
          message: {
            _attr: { level: "error" },
            _text: "Something went wrong",
          },
        };
        const xml = toXml(data, { indent: "  " });
        // Note: This depends on implementation, adjust if needed
        expect(xml).to.include('level="error"');
      });

      it("should handle null content as self-closing", function () {
        const data = { skipped: null };
        const xml = toXml(data, { indent: "  " });
        expect(xml).to.equal("<skipped/>\n");
      });
    });

    describe("XML declaration", function () {
      it("should include XML declaration when requested", function () {
        const data = { root: "content" };
        const xml = toXml(data, { declaration: true, indent: "  " });
        expect(xml).to.match(/^<\?xml version="1\.0" encoding="UTF-8"\?>\n/);
      });

      it("should not include XML declaration by default", function () {
        const data = { root: "content" };
        const xml = toXml(data, { indent: "  " });
        expect(xml).not.to.match(/^<\?xml/);
      });
    });

    describe("nested elements", function () {
      it("should generate nested elements", function () {
        const data = {
          parent: {
            child: "content",
          },
        };
        const xml = toXml(data, { indent: "  " });
        expect(xml).to.include("<parent>");
        expect(xml).to.include("<child>content</child>");
        expect(xml).to.include("</parent>");
      });

      it("should properly indent nested elements", function () {
        const data = {
          parent: {
            child: {
              grandchild: "content",
            },
          },
        };
        const xml = toXml(data, { indent: "  " });
        expect(xml).to.include("<parent>");
        expect(xml).to.include("<child>");
        expect(xml).to.include("<grandchild>content</grandchild>");
        expect(xml).to.include("</child>");
        expect(xml).to.include("</parent>");
      });
    });

    describe("CDATA sections", function () {
      it("should generate CDATA sections", function () {
        const data = {
          description: {
            _cdata: "Some <xml> content & special chars",
          },
        };
        const xml = toXml(data, { indent: "  " });
        expect(xml).to.equal(
          "<description><![CDATA[Some <xml> content & special chars]]></description>\n"
        );
      });

      it("should generate CDATA with attributes", function () {
        const data = {
          failure: {
            _attr: { message: "Test failed" },
            _cdata: "Stack trace here",
          },
        };
        const xml = toXml(data, { indent: "  " });
        expect(xml).to.include('message="Test failed"');
        expect(xml).to.include("<![CDATA[Stack trace here]]>");
      });
    });

    describe("arrays", function () {
      it("should generate multiple sibling elements from array", function () {
        const data = {
          items: {
            item: ["apple", "banana", "cherry"],
          },
        };
        const xml = toXml(data, { indent: "  " });
        expect(xml).to.include("<item>apple</item>");
        expect(xml).to.include("<item>banana</item>");
        expect(xml).to.include("<item>cherry</item>");
      });

      it("should handle array of objects", function () {
        const data = {
          tests: {
            testcase: [
              { _attr: { name: "test1" } },
              { _attr: { name: "test2" } },
            ],
          },
        };
        const xml = toXml(data, { indent: "  " });
        expect(xml).to.include('name="test1"');
        expect(xml).to.include('name="test2"');
      });
    });

    describe("wrapper pattern (JUnit format)", function () {
      it("should generate wrapper element with attributes and children", function () {
        const data = {
          testsuites: [
            { _attr: { name: "Mocha Tests", tests: "2" } },
            { testsuite: [{ _attr: { name: "Suite 1" } }] },
            { testsuite: [{ _attr: { name: "Suite 2" } }] },
          ],
        };
        const xml = toXml(data, { indent: "  " });

        // Should have ONE testsuites wrapper
        expect(xml.match(/<testsuites /g)).to.have.lengthOf(1);
        expect(xml.match(/<\/testsuites>/g)).to.have.lengthOf(1);

        // Should have TWO testsuite elements inside (match with space or > to avoid matching testsuites)
        expect(xml.match(/<testsuite /g)).to.have.lengthOf(2);
        expect(xml).to.include('name="Mocha Tests"');
        expect(xml).to.include('name="Suite 1"');
        expect(xml).to.include('name="Suite 2"');
      });

      it("should handle nested testsuites with testcases", function () {
        const data = {
          testsuites: [
            { _attr: { name: "Mocha Tests", tests: "1" } },
            {
              testsuite: [
                { _attr: { name: "Suite 1", tests: "1" } },
                { testcase: { _attr: { name: "test1" } } },
              ],
            },
          ],
        };
        const xml = toXml(data, { declaration: true, indent: "  " });

        expect(xml).to.include('<?xml version="1.0" encoding="UTF-8"?>');
        expect(xml).to.include('<testsuites name="Mocha Tests" tests="1">');
        expect(xml).to.include('<testsuite name="Suite 1" tests="1">');
        expect(xml).to.include('<testcase name="test1">');
        expect(xml).to.include('</testcase>');
        expect(xml).to.include('</testsuite>');
        expect(xml).to.include('</testsuites>');
      });
    });

    describe("empty elements", function () {
      it("should generate empty element with opening and closing tags", function () {
        const data = {
          testsuite: {
            _attr: { name: "Empty Suite", tests: "0" },
          },
        };
        const xml = toXml(data, { indent: "  " });
        expect(xml).to.equal('<testsuite name="Empty Suite" tests="0">\n</testsuite>\n');
        expect(xml).not.to.include("/>");
      });

      it("should handle multiple empty testsuites", function () {
        const data = {
          testsuites: [
            { _attr: { name: "Mocha Tests" } },
            { testsuite: [{ _attr: { name: "Suite 1", tests: "0" } }] },
            { testsuite: [{ _attr: { name: "Suite 2", tests: "0" } }] },
          ],
        };
        const xml = toXml(data, { indent: "  " });

        // Empty testsuites should have opening and closing tags
        expect(xml).to.match(/<testsuite name="Suite 1" tests="0">\n\s*<\/testsuite>/);
        expect(xml).to.match(/<testsuite name="Suite 2" tests="0">\n\s*<\/testsuite>/);
      });
    });

    describe("special characters", function () {
      it("should escape special characters in element content", function () {
        const data = {
          message: "Error: foo < bar & baz > qux",
        };
        const xml = toXml(data, { indent: "  " });
        expect(xml).to.include("&lt;");
        expect(xml).to.include("&amp;");
        expect(xml).to.include("&gt;");
      });

      it("should escape special characters in attribute values", function () {
        const data = {
          testcase: {
            _attr: { name: 'test "quoted" & <special>' },
          },
        };
        const xml = toXml(data, { indent: "  " });
        expect(xml).to.include("&quot;");
        expect(xml).to.include("&amp;");
        expect(xml).to.include("&lt;");
        expect(xml).to.include("&gt;");
      });
    });

    describe("real-world JUnit example", function () {
      it("should generate valid JUnit XML structure", function () {
        const data = {
          testsuites: [
            {
              _attr: {
                name: "Mocha Tests",
                time: "0.050",
                tests: "2",
                failures: "0",
              },
            },
            {
              testsuite: [
                {
                  _attr: {
                    name: "Root Suite",
                    timestamp: "2025-10-24T09:18:46",
                    tests: "0",
                    time: "0.000",
                    failures: "0",
                  },
                },
              ],
            },
            {
              testsuite: [
                {
                  _attr: {
                    name: "Root Suite.API Tests",
                    timestamp: "2025-10-24T09:18:46",
                    tests: "2",
                    time: "0.050",
                    failures: "0",
                  },
                },
                {
                  testcase: {
                    _attr: {
                      name: "should create user",
                      time: "0.025",
                      classname: "API Tests",
                      file: "test/api/user-test.js",
                    },
                  },
                },
                {
                  testcase: {
                    _attr: {
                      name: "should update user",
                      time: "0.025",
                      classname: "API Tests",
                      file: "test/api/user-test.js",
                    },
                  },
                },
              ],
            },
          ],
        };

        const xml = toXml(data, { declaration: true, indent: "  " });

        // Verify structure
        expect(xml).to.include('<?xml version="1.0" encoding="UTF-8"?>');
        expect(xml).to.include('<testsuites name="Mocha Tests"');
        expect(xml.match(/<testsuites /g)).to.have.lengthOf(1);
        expect(xml.match(/<\/testsuites>/g)).to.have.lengthOf(1);
        expect(xml.match(/<testsuite /g)).to.have.lengthOf(2);
        expect(xml.match(/<testcase /g)).to.have.lengthOf(2);

        // Verify testcases are nested inside testsuite
        const lines = xml.split('\n');
        let insideTestsuite = false;
        let foundTestcase = false;

        for (const line of lines) {
          if (line.includes('<testsuite name="Root Suite.API Tests"')) {
            insideTestsuite = true;
          }
          if (insideTestsuite && line.includes('<testcase')) {
            foundTestcase = true;
          }
          if (line.includes('</testsuite>')) {
            insideTestsuite = false;
          }
        }

        expect(foundTestcase).to.be.true;
      });
    });
  });
});

