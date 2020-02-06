import path from "path";
import { Browser, launch, Page } from "puppeteer";
import { VCR, VCROptions } from "../src";

let browser: Browser | null = null;

export const getBrowser = async () => {
  browser = await launch({ headless: false });
  return browser;
};

export const getBrowserContext = async () => {
  return await (await getBrowser()).createIncognitoBrowserContext();
};

afterEach(async () => {
  if (browser) {
    await Promise.all(
      browser.browserContexts().map(async context => {
        if (context.isIncognito()) {
          await context.close();
        }
      })
    );
  }
});

afterAll(async () => {
  console.log("shutting down browser");
  if (browser) {
    await browser.close();
  }
});

const cassetteRoot = path.join(__dirname, "vcr");

export const assertRecordReplay = async (options: Partial<VCROptions>, interaction: (page: Page) => Promise<void>) => {
  const recordContext = await getBrowserContext();
  const recordPage = await recordContext.newPage();

  const recorder = new VCR({ ...options, cassetteRoot, mode: "record-only" });
  await recorder.apply((jasmine as any)["currentTest"].fullName, recordPage);

  await interaction(recordPage);
  await recorder.drainTasks();
  await recordContext.close();

  const replayContext = await getBrowserContext();
  const replayPage = await replayContext.newPage();

  const replayer = new VCR({ ...options, cassetteRoot, mode: "replay-only" });
  await replayer.apply((jasmine as any)["currentTest"].fullName, replayPage);

  await interaction(replayPage);
  await replayer.drainTasks();
  await replayContext.close();
};
