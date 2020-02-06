import fs from "fs";
import path from "path";
import mkdirp from "mkdirp";
import sanitize from "sanitize-filename";
import { Mutex } from "async-mutex";
import { find } from "lodash";
import { detailedDiff } from "deep-object-diff";
import { MatchKey } from "./matcher";
import { Response, Request } from "puppeteer";
import {
  assert,
  AbstractSetCookie,
  abstractCookies,
  abstractCacheConfig,
  AbstractCacheConfig,
  responseBodyToString,
  BodyDescriptor
} from "./utils";
import { omit } from "lodash";

export type RecordedAbortOutcome = { type: "abort"; key: MatchKey; errorText: string };
export type RecordedResponseOutcome = {
  type: "response";
  key: MatchKey;
  response: {
    setCookies: AbstractSetCookie[];
    cacheConfig: AbstractCacheConfig;
    status: number;
    body: BodyDescriptor | null;
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
    const bucket = await this.readBucket(key);
    const matches = bucket.outcomes[key.keyHash];

    if (matches) {
      const orderedMatch = matches[key.keyCount];
      if (orderedMatch) {
        return orderedMatch;
      } else if (key.method == "GET") {
        // Replay GET requests regardless of order. This is a lame hack, but its because Chrome has some caching that we can't control going on. For example, if an image is included three times on a page, Chrome only makes one request for the image when in record mode, but makes three in replay mode. Not sure why, but, this fixes the majority of the problem. For non-idempotent requests, we shouldn't ever do this behaviour because request ordering is super important for them.
        const firstResponse = find(matches, match => !!match);
        if (firstResponse) {
          return firstResponse;
        }
      }
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
      await fs.promises.writeFile(bucketPath, JSON.stringify(data, null, 2));
    });
  }

  private async blobFromResult(key: MatchKey, result: RecordingResult): Promise<RecordedOutcome> {
    if (result.type == "success") {
      return {
        type: "response",
        key,
        response: {
          setCookies: abstractCookies(result.response.headers()["set-cookie"]),
          cacheConfig: abstractCacheConfig(result.response.headers()),
          status: result.response.status(),
          body: await responseBodyToString(result.response),
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
      "date", // probably not going to be the same date that we replay the response
      "expires", // caching headers managed by a different flow to update them relative to the replay time
      "last-modified",
      "set-cookie", // cookies managed by a different flow that updates the max age and expiry and facilitates setting multiple
      "content-encoding", // gzipped content is not served gzipped by puppeteer-vcr, everything is unencoded
      "content-length", // puppeteer recomputes content length for us, let's let it do that and not have to worry about managing this if the body contents change somehow
      "nel", // don't report network issues from test environments
      "report-to"
    ]);
  }
}
