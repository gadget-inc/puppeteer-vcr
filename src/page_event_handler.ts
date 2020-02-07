import { Page, Request, RespondOptions } from "puppeteer";
import { VCR, UnmatchedRequestError } from "./vcr";
import { Cassette, RecordedOutcome, RecordingResult } from "./cassette";
import { Matcher, MatchKey } from "./matcher";
import { assert, smallRequestOutput, setCookiesHeader, applyCacheConfig, truncate, bodyDescriptorToBuffer, sleep } from "./utils";
import { RequestEventManager } from "./request_event_manager";

export type ConcreteMode = "replay-only-throw" | "replay-only" | "record-only" | "record-additive" | "replay-passthrough" | "passthrough";
export class PageEventHandler {
  recordUnmatchedRequests = false;
  replayMatchedRequests = false;
  abortUnmatchedRequests = false;
  throwOnUnmatchedRequests = false;
  matcher: Matcher;
  requestEvents: RequestEventManager;

  constructor(readonly vcr: VCR, readonly mode: ConcreteMode, readonly page: Page, readonly cassette: Cassette) {
    this.matcher = new Matcher(this.vcr);
    this.requestEvents = new RequestEventManager(this.page);

    this.recordUnmatchedRequests = ["record-only", "record-additive"].includes(this.mode);
    this.replayMatchedRequests = ["replay-only", "replay-only-throw", "record-additive", "replay-passthrough"].includes(this.mode);
    this.abortUnmatchedRequests = ["reply-only", "replay-only-throw"].includes(this.mode);
    this.throwOnUnmatchedRequests = ["replay-only-throw"].includes(this.mode);
  }

  async register() {
    await this.page.setRequestInterception(true);
    this.requestEvents.register();
    this.page.on("request", this.handleRequest);
    this.page.on("close", () => {
      this.page.off("request", this.handleRequest);
    });
  }

  handleRequest = async (request: Request) => {
    this.vcr.task(
      async () => {
        const key = this.matcher.matchKey(request);

        if (this.vcr.options.onRequestCompleted) {
          this.installRequestCallbacks(request);
        }

        if (this.shouldIgnoreRequest(request, key)) {
          return request.continue();
        }

        if (this.shouldFastFailRequest(request, key)) {
          return request.abort("failed");
        }

        if (this.replayMatchedRequests) {
          // Important: we only try to match the request if we are replaying. This is important for successive GET requests that should be recorded as independent
          const recordedOutcome = await this.cassette.match(key);

          if (recordedOutcome) {
            sleep(recordedOutcome.duration);
            await this.vcr.task(async () => {
              await this.replayRequest(request, recordedOutcome);
            });
          } else {
            if (this.abortUnmatchedRequests) {
              await this.logAbort(request, key);
              request.abort("failed");

              if (this.throwOnUnmatchedRequests) {
                throw new UnmatchedRequestError(
                  `Unmatched request: count=${key.keyCount} method=${key.method} url=${truncate(request.url())}`
                );
              }
            } else {
              request.continue();
            }
          }
        } else {
          if (this.recordUnmatchedRequests) {
            this.watchAndRecordRequest(key, request);
          } else {
            request.continue();
          }
        }
      },
      "request",
      smallRequestOutput(request)
    );
  };

  watchAndRecordRequest(key: MatchKey, request: Request) {
    const requestEvents = this.requestEvents.events(request);
    const startTime = Date.now();

    requestEvents.on("failed_or_finished", () =>
      this.vcr.task(
        async () => {
          const duration = Date.now() - startTime;
          await this.saveRequest(key, request, duration);
        },
        "requestfailed/finished",
        smallRequestOutput(request)
      )
    );

    request.continue();
  }

  async saveRequest(key: MatchKey, request: Request, duration: number) {
    let data: RecordingResult;

    if (request.failure()) {
      data = { type: "failure", duration, request };
    } else {
      data = { type: "success", duration, response: assert(request.response()) };
    }

    try {
      await this.cassette.save(key, data);
    } catch (e) {
      if (e.message.match(/timed out retrieving request response/) || e.message.match(/No resource with given identifier found/)) {
        // Don't try to save requests that are no longer available. During navigation, the currently loaded page might fire off requests that don't complete by the time the navigation is complete. When the navigation completes, the ExecutionContext will roll over, and Chrome will dispose of the outstanding requests' bodies. If we try to access those bodies, we either time out or get Resource Not Found errors from the devtools protocol. In this instance, we can ignore the request and not save it, as we know it wasn't necessary for the first page to render, and a real browser would discard it too. Whatever the unit under test is was able to make progress and trigger a navigation, so we just discard these two error messages if they result from saving a response.
        // console.debug("passing on request that timed out / wasn't found being retrieved from puppeteer", smallRequestOutput(request));
      } else {
        throw e;
      }
    }
  }

  async replayRequest(request: Request, outcome: RecordedOutcome) {
    if (this.recordUnmatchedRequests) {
      throw new Error(
        "puppeteer-vcr internal error: should never be replaying requests while also recording them because replays get recorded"
      );
    }
    if (outcome.type == "response") {
      const headers = { ...outcome.response.headers };

      if (outcome.response.setCookies.length > 0) {
        headers["set-cookie"] = setCookiesHeader(outcome.response.setCookies);
      }

      applyCacheConfig(headers, outcome.response.cacheConfig);

      const respondOptions: RespondOptions = {
        status: outcome.response.status,
        headers: headers
      };

      if (outcome.response.body) {
        respondOptions.body = bodyDescriptorToBuffer(outcome.response.body);
      }

      request.respond(respondOptions);
    } else {
      request.abort("failed");
    }
  }

  async logAbort(request: Request, key: MatchKey) {
    const closestMatch = await this.cassette.closestMatch(key);
    if (closestMatch) {
      console.debug("Aborting unmatched request", smallRequestOutput(request), "\n Closest Match", closestMatch.diff, "\n Raw keys", {
        stored: closestMatch.outcome.key,
        searchingFor: key
      });
    } else {
      console.debug("Aborting unmatched request", smallRequestOutput(request), "\n No close match found");
    }
  }

  shouldIgnoreRequest(request: Request, key: MatchKey) {
    // Don't record data urls. They have the response in them and don't fire the normal events we need to record them.
    if (key.url.protocol.startsWith("data") || key.url.protocol.startsWith("blob")) {
      return true;
    }

    return this.vcr.options.passthroughDomains.includes(key.url.hostname);
  }

  shouldFastFailRequest(request: Request, key: MatchKey) {
    // Don't record or replay requests for frames other than the main one. There's no hard limitation here, we just don't in the interest of not making things super complicated to do so.
    // In my observations so far, this is almost entirely ad tracking.
    if (request.frame() != this.page.mainFrame()) {
      return true;
    }

    return this.vcr.options.blacklistDomains.includes(key.url.hostname);
  }

  installRequestCallbacks(request: Request) {
    this.requestEvents.events(request).on("failed_or_finished", assert(this.vcr.options.onRequestCompleted));
  }
}
