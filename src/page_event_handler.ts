import waitUntil from "async-wait-until";
import { Page, Request, RespondOptions } from "puppeteer";
import { VCR } from "./vcr";
import { Cassette, RecordedOutcome, RecordingResult } from "./cassette";
import { Matcher, MatchKey } from "./matcher";
import { assert, smallRequestOutput, reportErrors, setCookiesHeader } from "./utils";
import { RequestEventManager } from "./request_event_manager";

export class PageEventHandler {
  recordUnmatchedRequests = false;
  replayMatchedRequests = false;
  raiseOnUnmatchedRequests = false;
  matcher: Matcher;
  requestEvents: RequestEventManager;
  mode: "replay-only" | "record-only" | "record-additive" | "replay-passthrough" | "passthrough";

  // Puppeteer gives events about individual requests at the page level, so we track which requests
  // we're watching for events in a map on the class. Requests get added when they start if they should
  // be recorded, and removed when they complete (`requestfinished` event) or fail (`requestfailed`)
  incompleteRequestsToRecord = new Map<Request, MatchKey>();
  completeRequestsBeingRecorded = new Map<Request, MatchKey>();

  constructor(readonly vcr: VCR, readonly page: Page, readonly cassette: Cassette) {
    this.matcher = new Matcher(this.vcr);
    this.requestEvents = new RequestEventManager(this.page);

    if (this.vcr.options.mode == "auto") {
      if (process.env.CI) {
        this.mode = "replay-only";
      } else {
        // TODO: get to the point where we error upon unrecognized requests
        this.mode = "record-additive";
      }
    } else {
      this.mode = this.vcr.options.mode;
    }

    this.recordUnmatchedRequests = ["record-only", "record-additive"].includes(this.mode);
    this.replayMatchedRequests = ["replay-only", "record-additive", "replay-passthrough"].includes(this.mode);
    this.raiseOnUnmatchedRequests = ["replay-only"].includes(this.mode);
  }

  async register() {
    await this.page.setRequestInterception(true);
    this.page.on("request", this.handleRequest);
  }

  handleRequest = async (request: Request) => {
    await reportErrors(
      async () => {
        const key = this.matcher.matchKey(request);

        if (this.shouldIgnoreRequest(request, key)) {
          return request.continue();
        }

        if (this.shouldFastFailRequest(request, key)) {
          return request.abort("failed");
        }

        const recordedOutcome = await this.cassette.match(key);

        if (recordedOutcome) {
          if (this.replayMatchedRequests) {
            process.nextTick(async () => {
              await reportErrors(async () => {
                await this.replayRequest(request, recordedOutcome);
              });
            });
          } else {
            request.continue();
          }
        } else {
          if (this.raiseOnUnmatchedRequests) {
            console.debug("Aborting unmatched request", smallRequestOutput(request));
            this.logClosestMatch(request, key);
            request.abort("failed");
          } else {
            if (this.recordUnmatchedRequests) {
              // Navigation requests of the main frame will cause all the execution contexts to get torn down. If we're still waiting to record requests, then they might not return by the time the execution context goes away. This would A) prevent us from recording them, and B) sometimes throw errors within Puppeteer when we go to access something about the request at some point and the object is gone inside Chrome.
              if (request.isNavigationRequest() && request.frame() == this.page.mainFrame()) {
                console.debug("navigation request", request.url());
                await this.waitUntilPendingRequestsAreCompleted();
              }

              this.watchAndRecordRequest(key, request);
            }

            request.continue();
          }
        }
      },
      "request",
      smallRequestOutput(request)
    );
  };

  async watchAndRecordRequest(key: MatchKey, request: Request) {
    // Track that we're watching this request so we can wait for it to finish before navigating away and losing the ability to retrieve it's body
    this.incompleteRequestsToRecord.set(request, key);

    const events = this.requestEvents.events(request);

    events.on("failed_or_finished", () =>
      reportErrors(
        async () => {
          this.incompleteRequestsToRecord.delete(request);
          await this.saveRequest(key, request);
        },
        "requestfailed/finished",
        smallRequestOutput(request)
      )
    );
  }

  async saveRequest(key: MatchKey, request: Request) {
    // Track that we're saving this request so we can wait for the save to finish before navigating away and losing the ability to retrieve it's body
    this.completeRequestsBeingRecorded.set(request, key);

    let data: RecordingResult;

    if (request.failure()) {
      data = { type: "failure", request };
    } else {
      data = { type: "success", response: assert(request.response()) };
    }

    try {
      await this.cassette.save(key, data);
    } catch (e) {
      if (e.message.match(/timed out retrieving request response/)) {
        // Don't try to save requests that are no longer available. During navigation, the currently loaded page might fire off requests that don't complete by the time the navigation is complete. When the navigation completes, the ExecutionContext will roll over, and Chrome will dispose of the outstanding requests' bodies. If we try to access those bodies, we either time out or get Resource Not Found errors from the devtools protocol. In this instance, we can ignore the request and not save it, as we know it wasn't necessary for the first page to render, and a real browser would discard it too.
        // console.debug("passing on request that timed out being retrieved from puppeteer", smallRequestOutput(request));
      } else {
        console.debug("request that failed to save: ", smallRequestOutput(request));
        throw e;
      }
    }

    this.completeRequestsBeingRecorded.delete(request);
  }

  async replayRequest(request: Request, outcome: RecordedOutcome) {
    if (outcome.type == "response") {
      // console.debug("Replaying request", smallRequestOutput(request));
      const respondOptions: RespondOptions = {
        status: outcome.response.status,
        headers: outcome.response.headers
      };

      if (outcome.setCookies.length > 0) {
        assert(respondOptions.headers)["set-cookie"] = setCookiesHeader(outcome.setCookies);
      }

      if (outcome.response.body) {
        respondOptions.body = outcome.response.body;
      }

      request.respond(respondOptions);
    } else {
      // console.debug("Replay aborting request", smallRequestOutput(request));
      request.abort("failed");
    }
  }

  async waitUntilPendingRequestsAreCompleted() {
    // Wait for all the other recording requests to finish before continuing the mainframe navigation request
    // Avoids Protocol error (Network.getResponseBody): No resource with given identifier found
    // See https://github.com/puppeteer/puppeteer/issues/2258 for some more information
    try {
      await waitUntil(
        () => {
          console.debug(`checking navigation pause ${new Date()}`, {
            incompleteRequestCount: this.incompleteRequestsToRecord.size,
            completedMidSaveRequestCount: this.completeRequestsBeingRecorded.size
          });

          if (this.incompleteRequestsToRecord.size > 0) {
            console.debug(
              Array.from(this.incompleteRequestsToRecord.values()).map(key => ({
                keyCount: key.keyCount,
                url: key.url
              }))
            );
          }

          if (this.completeRequestsBeingRecorded.size > 0) {
            Array.from(this.incompleteRequestsToRecord.values()).map(key => ({
              keyCount: key.keyCount,
              url: key.url
            })).length;
          }

          return this.incompleteRequestsToRecord.size == 0 && this.completeRequestsBeingRecorded.size == 0;
        },
        10000,
        1000
      );
    } catch (e) {
      console.debug("Navigation timeout expired, suppressing and resetting");
      this.incompleteRequestsToRecord.clear();
      this.completeRequestsBeingRecorded.clear();
    }
  }

  async logClosestMatch(request: Request, key: MatchKey) {
    const closestMatch = await this.cassette.closestMatch(key);
    if (closestMatch) {
      console.debug("Found close match for unmatched request:");
      console.debug(closestMatch.diff);
      console.debug(key);
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
}
