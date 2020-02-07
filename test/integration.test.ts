import { assertRecordReplay } from "./test_helper";

describe("puppeteer-vcr integration", () => {
  it("should record a visit to a page and then replay it", async () => {
    jest.setTimeout(15 * 1000);
    await assertRecordReplay({}, async page => {
      await page.goto("https://example.com", { waitUntil: ["load", "networkidle2"] });
      await page.goto("https://gadget.dev", { waitUntil: ["load", "networkidle2"] });
      await page.goto("https://example.com", { waitUntil: ["load", "networkidle2"] });
    });
  });
});
