import { Page, Request } from "puppeteer";
import { VCR, UnmatchedRequestError } from "./vcr";
import { Cassette, RecordedOutcome } from "./cassette";
import { Matcher, MatchKey } from "./matcher";
import { assert } from "./utils";

export class PageEventHandler {
  recordUnmatchedRequests: boolean = false;
  replayMatchedRequests: boolean = false;
  raiseOnUnmatchedRequests: boolean = false;
  matcher: Matcher;

  // Puppeteer gives events about individual requests at the page level, so we track which requests
  // we're watching for events in a map on the class. Requests get added when they start if they should
  // be recorded, and removed when they complete (`requestfinished` event) or fail (`requestfailed`)
  recordingRequests = new WeakMap<Request, MatchKey>();

  constructor(
    readonly vcr: VCR,
    readonly page: Page,
    readonly cassette: Cassette
  ) {
    this.matcher = new Matcher();
  }

  async register() {
    this.page.setRequestInterception(true);
    this.page.on("request", this.handleRequest);
    this.page.on("requestfinished", this.handleRequestFinished);
    this.page.on("requestfailed", this.handleRequestFailed);

    let mode = this.vcr.options.mode;

    if (mode == "auto") {
      if (process.env.CI) {
        mode = "replay-only";
      } else {
        // TODO: get to the point where we error upon unrecognized requests
        mode = "record-additive";
      }
    }

    this.recordUnmatchedRequests = ["record-only", "record-additive"].includes(
      mode
    );

    this.replayMatchedRequests = ["replay-only", "record-additive"].includes(
      mode
    );

    this.raiseOnUnmatchedRequests = ["replay-only"].includes(mode);
  }

  handleRequest = async (request: Request) => {
    await this.reportErrors(async () => {
      const key = this.matcher.matchKey(request);
      const recordedOutcome = await this.cassette.match(key);

      if (recordedOutcome) {
        if (this.replayMatchedRequests) {
          process.nextTick(() => {
            this.replayRequest(request, recordedOutcome);
          });
        } else {
          request.continue();
        }
      } else {
        if (this.raiseOnUnmatchedRequests) {
          request.abort("failed");
        } else {
          if (this.recordUnmatchedRequests) {
            this.recordingRequests.set(request, key);
          }

          request.continue();
        }
      }
    });
  };

  handleRequestFailed = async (request: Request) => {
    await this.reportErrors(async () => {
      const key = this.recordingRequests.get(request);
      if (key) {
        this.recordingRequests.delete(request);
        await this.cassette.save(key, { type: "failure", request });
      }
    });
  };

  handleRequestFinished = async (request: Request) => {
    await this.reportErrors(async () => {
      const key = this.recordingRequests.get(request);
      if (key) {
        this.recordingRequests.delete(request);
        await this.cassette.save(key, {
          type: "success",
          response: assert(request.response())
        });
      }
    });
  };

  async replayRequest(request: Request, outcome: RecordedOutcome) {
    if (outcome.type == "response") {
      await request.respond({
        status: outcome.response.status,
        headers: outcome.response.headers,
        body: outcome.response.body
      });
    } else {
      await request.abort("failed");
    }
  }

  async reportErrors<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      console.error("puppeteer-vcr request interception error occurred");
      console.error(e);
      throw e;
    }
  }
}
