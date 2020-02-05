import fs from "fs";
import path from "path";
import mkdirp from "mkdirp";
import sanitize from "sanitize-filename";
import Timeout from "await-timeout";
import { Mutex } from "async-mutex";
import { detailedDiff } from "deep-object-diff";
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

export interface DetailedDiffResult {
  added: {
    [key: string]: any;
  };
  deleted: {
    [key: string]: any;
  };
  updated: {
    [key: string]: any;
  };
}

interface DataBucket {
  version: 1;
  outcomes: {
    [hash: string]: RecordedOutcome[];
  };
}

export class Cassette {
  private bucketMutexes: {
    [path: string]: Mutex;
  } = {};

  constructor(readonly root: string) {}

  async match(key: MatchKey): Promise<RecordedOutcome | null> {
    const matches = (await this.readBucket(key)).outcomes[key.keyHash];

    if (matches) {
      return matches[key.keyCount];
    }
    return null;
  }

  async closestMatch(key: MatchKey): Promise<{ outcome: RecordedOutcome; diff: DetailedDiffResult } | null> {
    const outcomes = (await this.readBucket(key)).outcomes;

    let lowestScore = 10000000;
    let closestMatch = null;

    Object.entries(outcomes).forEach(([_hash, outcomes]) => {
      outcomes.forEach((outcome: RecordedOutcome | null) => {
        if (!outcome) return;

        const diff = detailedDiff(outcome.key, key) as DetailedDiffResult;
        const score = Object.keys(diff.added).length + Object.keys(diff.deleted).length + Object.keys(diff.updated).length;
        if (score < lowestScore) {
          closestMatch = { outcome, diff };
          lowestScore = score;
        }
      });
    });

    return closestMatch;
  }

  async save(key: MatchKey, result: RecordingResult) {
    return await this.withExclusiveBucket(key, async (bucketPath: string) => {
      const data = await this.readBucket(key);

      if (!data.outcomes[key.keyHash]) {
        data.outcomes[key.keyHash] = [];
      }

      data.outcomes[key.keyHash][key.keyCount] = await this.blobFromResult(key, result);

      await mkdirp(this.root);
      await fs.promises.writeFile(bucketPath, JSON.stringify(data));
    });
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

  private async readBucket(key: MatchKey): Promise<DataBucket> {
    const path = this.diskPath(key);
    let raw;
    try {
      raw = await fs.promises.readFile(path, "utf-8");
    } catch (e) {
      return { outcomes: {}, version: 1 };
    }

    return JSON.parse(raw) as DataBucket;
  }

  private async withExclusiveBucket<T>(key: MatchKey, callback: (path: string) => Promise<T>): Promise<T> {
    const path = this.diskPath(key);
    if (!this.bucketMutexes[path]) {
      this.bucketMutexes[path] = new Mutex();
    }

    const release = await this.bucketMutexes[path].acquire();
    const returnValue = await callback(path);
    release();
    return returnValue;
  }

  private diskPath(key: MatchKey) {
    return path.join(this.root, sanitize(`${key.method}-${key.url.protocol}_${key.url.hostname}_${key.url.pathname}.json`));
  }

  private filterHeadersForSave(headers: Record<string, string>) {
    return omit(headers, [
      "status", // status is broken out as a top level key on the response
      "date", // probably not going to be the same date that we replay the response
      "set-cookie", // cookies managed by a different flow that updates the max age and expiry and facilitates setting multiple
      "content-encoding", // gzipped content is not served gzipped by puppeteer-vcr, everything is unencoded
      "content-length", // puppeteer recomputes content length for us, let's let it do that and not have to worry about managing this if the body contents change somehow
      "nel", // don't report network issues from test environments
      "report-to"
    ]);
  }
}
