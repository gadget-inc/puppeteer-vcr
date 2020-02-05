import fs from "fs";
import path from "path";
import mkdirp from "mkdirp";
import sanitize from "sanitize-filename";
import Timeout from "await-timeout";
import { MatchKey } from "./matcher";
import { Response, Request } from "puppeteer";
import { assert, isRedirectResponse, AbstractSetCookie, abstractCookies } from "./utils";
import { omit } from "lodash";

export type RecordedAbortOutcome = { type: "abort"; key: MatchKey; errorText: string };
export type RecordedResponseOutcome = {
  type: "response";
  key: MatchKey;
  setCookies: AbstractSetCookie[];
  response: {
    status: number;
    body: string | null;
    headers: {
      [key: string]: string;
    };
  };
};

export type RecordedOutcome = RecordedAbortOutcome | RecordedResponseOutcome;

export type RecordingResult = { type: "success"; response: Response } | { type: "failure"; request: Request };

interface DataBucket {
  responses: RecordedOutcome[];
}

export class Cassette {
  constructor(readonly root: string) {}

  async match(key: MatchKey): Promise<RecordedOutcome | null> {
    return (await this.readBucket(key)).responses[key.keyCount];
  }

  async save(key: MatchKey, result: RecordingResult) {
    const bucketPath = this.diskPath(key);
    const data = await this.readBucket(key);

    data.responses[key.keyCount] = await this.blobFromResult(key, result);

    await mkdirp(this.root);
    await fs.promises.writeFile(bucketPath, JSON.stringify(data));
  }

  private async blobFromResult(key: MatchKey, result: RecordingResult): Promise<RecordedOutcome> {
    if (result.type == "success") {
      let body: string | null = null;

      // Avoid puppeteer errors trying to access the response.text() of responses that don't have it. Accessing .text() for redirect requests or request with 0 length responses throws deep inside Puppeteer.
      if (!isRedirectResponse(result.response)) {
        body = await Timeout.wrap(result.response.text(), 1000, `puppeteer-vcr internal error: timed out retrieving request response`);
      } else {
        // console.debug("skipping body content access", key);
      }

      return {
        type: "response",
        key,
        setCookies: abstractCookies(result.response.headers()["set-cookie"]),
        response: {
          status: result.response.status(),
          body: body,
          headers: this.filterHeadersForSave(result.response.headers())
        }
      };
    } else {
      return {
        type: "abort",
        key,
        errorText: assert(result.request.failure()).errorText
      };
    }
  }

  private async readBucket(key: MatchKey) {
    let raw;
    try {
      raw = await fs.promises.readFile(this.diskPath(key), "utf-8");
    } catch (e) {
      return { responses: [] };
    }

    return JSON.parse(raw) as DataBucket;
  }

  private diskPath(key: MatchKey) {
    return path.join(
      this.root,
      sanitize(`${key.method}-${key.url.protocol}${key.url.hostname}${key.url.pathname}-${key.keyCount}-${key.hash}.json`)
    );
  }

  private filterHeadersForSave(headers: Record<string, string>) {
    return omit(headers, [
      "status", // status is broken out as a top level key on the response
      "date", // probably not gonna be the same date that we replay the response
      "set-cookie", // cookies managed by a different flow that updates the max age and expiry and facilitates setting multiple
      "content-encoding", // gzipped content is not served gzipped by puppeteer-vcr, everything is unencoded
      "content-length", // puppeteer recomputes content length for us, let's let it do that and not have to worry about managing this if the body contents change somehow
      "nel", // don't report network issues from test environments
      "report-to"
    ]);
  }
}
