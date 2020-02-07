import fs from "fs";
import { defaults, remove } from "lodash";
import path from "path";
import { Page, Request } from "puppeteer";
import sanitize from "sanitize-filename";
import { Cassette } from "./cassette";
import { PageEventHandler } from "./page_event_handler";
import { MatchKey } from "./matcher";
import { reportErrors } from "./utils";

export interface VCROptions {
  cassetteRoot: string;
  passthroughDomains: string[];
  blacklistDomains: string[];
  onRequestCompleted: null | ((request: Request) => void);
  customizeMatchKey: (key: MatchKey) => MatchKey;
  mode: "replay-only-throw" | "replay-only" | "record-only" | "record-additive" | "replay-passthrough" | "passthrough" | "auto";
}

export class UnmatchedRequestError extends Error {}

export class VCR {
  options: VCROptions;
  tasks: Promise<any>[] = [];

  constructor(options: Partial<VCROptions>) {
    this.options = defaults(options, {
      mode: "auto",
      cassetteRoot: "./__recordings__",
      passthroughDomains: [],
      blacklistDomains: [],
      onRequestCompleted: null,
      customizeMatchKey: (key: MatchKey) => key
    });
  }

  async apply(namespace: string, page: Page) {
    // request interception turns off caching itself, we disable it here to make it obvious and keep caching behaviour the same regardless of the record mode
    await page.setCacheEnabled(false);

    const cassette = new Cassette(this.cassettePath(namespace));
    const handler = new PageEventHandler(this, page, cassette);
    await handler.register();
    return handler;
  }

  async cassetteExists(namespace: string): Promise<boolean> {
    const path = this.cassettePath(namespace);
    try {
      await fs.promises.access(path);
      return true;
    } catch (e) {
      return false;
    }
  }

  // puppeteer-vcr is built using a lot of event handlers that fire at times the library doesn't really control, as those events are coming from the browser. We wrap any async event handlers (that say read or write to disk) in this task helper so that we can await them all before moving on, during test teardown or something like that.
  async task<T>(fn: () => Promise<T>, ...taskContext: any[]): Promise<T> {
    const task = reportErrors(fn, ...taskContext);
    this.tasks.push(task);
    task.finally(() => remove(this.tasks, task)); // eslint-disable-line lodash/prefer-immutable-method
    return task;
  }

  async drainTasks() {
    await Promise.all(this.tasks);
  }

  cassettePath(namespace: string) {
    return path.join(this.options.cassetteRoot, sanitize(namespace.toLowerCase().replace(/\s/g, "_")));
  }
}
