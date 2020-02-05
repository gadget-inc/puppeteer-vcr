import { defaults } from "lodash";
import path from "path";
import { Page } from "puppeteer";
import sanitize from "sanitize-filename";
import { Cassette } from "./cassette";
import { PageEventHandler } from "./page_event_handler";
import { MatchKey } from "./matcher";

export interface VCROptions {
  cassetteRoot: string;
  passthroughDomains: string[];
  blacklistDomains: string[];
  customizeMatchKey: (key: MatchKey) => MatchKey;
  mode: "replay-only" | "record-only" | "record-additive" | "replay-passthrough" | "passthrough" | "auto";
}

export class UnmatchedRequestError extends Error {}

export class VCR {
  options: VCROptions;

  constructor(options: Partial<VCROptions>) {
    this.options = defaults(options, {
      mode: "auto",
      cassetteRoot: "./__recordings__",
      passthroughDomains: [],
      blacklistDomains: [],
      customizeMatchKey: (key: MatchKey) => key
    });
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
