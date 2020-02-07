import path from "path";
import tmp from "tmp";
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
  if (browser) {
    await browser.close();
  }
});

const fixedCassetteRoot = path.join(__dirname, "vcr");
const tmpCassetteRoot = tmp.dirSync().name;

export const assertRecordReplay = async (options: Partial<VCROptions>, interaction: (page: Page) => Promise<void>) => {
  const namespace = (jasmine as any)["currentTest"].fullName;
  const recordContext = await getBrowserContext();
  const recordPage = await recordContext.newPage();

  const recorder = new VCR({ ...options, cassetteRoot: tmpCassetteRoot, mode: "record-only" });
  await recorder.apply(namespace, recordPage);

  await interaction(recordPage);
  await recorder.drainTasks();
  await recordContext.close();

  const replayContext = await getBrowserContext();
  const replayPage = await replayContext.newPage();

  const replayer = new VCR({ ...options, cassetteRoot: tmpCassetteRoot, mode: "replay-only" });
  await replayer.apply(namespace, replayPage);

  await interaction(replayPage);
  await replayer.drainTasks();
  await replayContext.close();
};

export const assertReplay = async (options: Partial<VCROptions>, interaction: (page: Page) => Promise<void>) => {
  const namespace = (jasmine as any)["currentTest"].fullName;
  const replayer = new VCR({ ...options, cassetteRoot: fixedCassetteRoot, mode: "replay-only" });

  if (!(await replayer.cassetteExists(namespace))) {
    console.log(`Recording cassette for replay test ${namespace} because it doesn't exist yet`);
    const recordContext = await getBrowserContext();
    const recordPage = await recordContext.newPage();

    const recorder = new VCR({ ...options, cassetteRoot: fixedCassetteRoot, mode: "record-only" });
    await recorder.apply(namespace, recordPage);

    await interaction(recordPage);
    await recorder.drainTasks();
    await recordContext.close();
  }

  const replayContext = await getBrowserContext();
  const replayPage = await replayContext.newPage();

  await replayer.apply(namespace, replayPage);

  await interaction(replayPage);
  await replayer.drainTasks();
  await replayContext.close();
};
