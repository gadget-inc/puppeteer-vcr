import { defaults } from "lodash";
import path from "path";
import { Page } from "puppeteer";
import sanitize from "sanitize-filename";
import { Cassette } from "./cassette";
import { PageEventHandler } from "./page_event_handler";

export interface VCROptions {
  cassetteRoot: string;
  mode: "replay-only" | "record-only" | "record-additive" | "replay-passthrough" | "passthrough" | "auto";
}

export class UnmatchedRequestError extends Error {}

export class VCR {
  options: VCROptions;

  constructor(options: VCROptions) {
    this.options = defaults(options, { recordMode: "auto" });
  }

  async apply(namespace: string, page: Page) {
    const cassette = new Cassette(this.cassettePath(namespace));
    const handler = new PageEventHandler(this, page, cassette);
    await handler.register();
    return handler;
  }

  cassettePath(namespace: string) {
    return path.join(this.options.cassetteRoot, sanitize(namespace.toLowerCase().replace(/\s/g, "_")));
  }
}
