import { expect, test } from "bun:test";
import { navigationRulesFor } from "../src/main/navigation.js";

test("navigation follows the selected local view rather than the demo name", () => {
  expect(JSON.parse(navigationRulesFor("views://notes/index.html"))).toEqual(["views://notes/*"]);
  expect(JSON.parse(navigationRulesFor("views://settings/pages/index.html"))).toEqual(["views://settings/*"]);
  for (const url of ["https://example.com", "file:///tmp/index.html", "views://*/index.html", "views://user@notes/index.html"]) {
    expect(() => navigationRulesFor(url)).toThrow();
  }
});
