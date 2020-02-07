import { assertReplay } from "./test_helper";
import { MatchKey } from "../src";
import { sleep } from "../src/utils";

describe("puppeteer-vcr integration against homesick.com", () => {
  it("should replay a recorded visit", async () => {
    jest.setTimeout(30 * 1000);
    await assertReplay(
      {
        blacklistDomains: [
          "v.shopify.com",
          "godog.shopifycloud.com",
          "a.klaviyo.com",
          "dev.visualwebsiteoptimizer.com",
          "googleads.g.doubleclick.net",
          "stats.g.doubleclick.net",
          "dx.steelhousemedia.com",
          "cdn-bacon.getcarro.com",
          "p.yotpo.com",
          "bat.bing.com",
          "www.google-analytics.com",
          "ct.pinterest.com",
          "monorail-edge.shopifysvc.com"
        ],
        customizeMatchKey: (key: MatchKey) => {
          if (key.body) {
            key.body = "<NORMALIZED>";
          } else {
            key.body = null;
          }

          if (key.url.hostname == "cdn.shopify.com") {
            delete key.url.query.v;
          }

          if (["storefront.personalizer.io"].includes(key.url.hostname)) {
            delete key.url.query.t;
          }

          if (["sdk.vyrl.co", "media.vyrl.co", "staticw2.yotpo.com", "consent.linksynergy.com"].includes(key.url.hostname)) {
            key.url.query = {};
          }

          if (key.url.hostname == "www.facebook.com" && key.url.pathname.startsWith("/tr")) {
            key.url.query = {};
          }

          return key;
        }
      },
      async page => {
        await page.goto("https://homesick.com", { waitUntil: ["load", "networkidle2"] });
      }
    );
  });
});
