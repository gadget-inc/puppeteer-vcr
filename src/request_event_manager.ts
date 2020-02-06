import { EventEmitter } from "events";
import TypedEmitter from "typed-emitter";
import { Page, Request } from "puppeteer";
import { smallRequestOutput, assert, reportErrors } from "./utils";

export type RequestEmitter = TypedEmitter<{
  failed: (request: Request) => void;
  finished: (request: Request) => void;
  failed_or_finished: (request: Request) => void;
}>;

export class RequestEventManager {
  watchedRequests = new WeakMap<Request, RequestEmitter>();

  constructor(readonly page: Page) {}

  register() {
    this.page.on("requestfinished", this.handleRequestFinished);
    this.page.on("requestfailed", this.handleRequestFailed);
    this.page.on("close", () => {
      this.page.off("requestfinished", this.handleRequestFinished);
      this.page.off("requestfailed", this.handleRequestFailed);
    });
  }

  events(request: Request) {
    if (!this.watchedRequests.has(request)) {
      this.watchedRequests.set(request, new EventEmitter() as RequestEmitter);
    }

    return assert(this.watchedRequests.get(request));
  }

  private handleRequestFailed = async (request: Request) => {
    await reportErrors(
      async () => {
        this.events(request).emit("failed", request);
        this.events(request).emit("failed_or_finished", request);
      },
      "requestfailed",
      smallRequestOutput(request)
    );
  };

  private handleRequestFinished = async (request: Request) => {
    await reportErrors(
      async () => {
        this.events(request).emit("finished", request);
        this.events(request).emit("failed_or_finished", request);
      },
      "requestfinished",
      smallRequestOutput(request)
    );
  };
}
