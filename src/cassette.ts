import fs from "fs";
import path from "path";
import mkdirp from "mkdirp";
import sanitize from "sanitize-filename";
import { MatchKey } from "./matcher";
import { Response, Request } from "puppeteer";
import { assert } from "./utils";

export type RecordedOutcome =
  | { type: "abort"; key: MatchKey; errorText: string }
  | {
      type: "response";
      key: MatchKey;
      response: {
        status: number;
        body: string;
        headers: {
          [key: string]: string;
        };
      };
    };

export type RecordingResult =
  | { type: "success"; response: Response }
  | { type: "failure"; request: Request };

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
    let data = await this.readBucket(key);

    data.responses[key.keyCount] = await this.blobFromResult(key, result);

    await mkdirp(this.root);
    await fs.promises.writeFile(bucketPath, JSON.stringify(data));
  }

  private async blobFromResult(
    key: MatchKey,
    result: RecordingResult
  ): Promise<RecordedOutcome> {
    if (result.type == "success") {
      return {
        type: "response",
        key,
        response: {
          status: result.response.status(),
          body: await result.response.text(),
          headers: result.response.headers()
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
      sanitize(
        `${key.method}-${key.url.protocol}${key.url.hostname}${key.url.pathname}-${key.keyCount}-${key.hash}.json`
      )
    );
  }
}
