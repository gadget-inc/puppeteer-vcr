import { URL } from "url";
import { Request } from "puppeteer";
import farmhash from "farmhash";
import stableJSONStringify from "fast-json-stable-stringify";
import { isUndefined } from "lodash";
import { VCR } from "./vcr";

export interface MatchKey {
  keyCount: number;
  keyHash: string;
  method: string;
  body: string | null;
  isNavigationRequest: boolean;
  resourceType: string;
  url: {
    protocol: string;
    username: string;
    password: string;
    hostname: string;
    pathname: string;
    port: string;
    query: { [key: string]: any };
  };
  extra: {
    [key: string]: any;
  };
}

export class Matcher {
  keyCounts: { [key: string]: number } = {};

  constructor(readonly vcr: VCR) {}

  matchKey(request: Request): MatchKey {
    const url = new URL(request.url());

    const key = this.customizeKey({
      method: request.method(),
      body: this.normalizeBody(request),
      isNavigationRequest: request.isNavigationRequest(),
      resourceType: request.resourceType(),
      url: {
        protocol: url.protocol,
        username: url.username,
        password: url.password,
        hostname: url.hostname,
        port: url.port,
        pathname: url.pathname,
        query: this.normalizeSearch(url)
      },
      // keep the managed values stable before hashing so the hash for two instances of the same request are the same
      keyCount: 0,
      keyHash: "",
      extra: {}
    });

    key.keyHash = String(farmhash.hash32(stableJSONStringify(key)));
    key.keyCount = this.getKeyCount(key);

    return key;
  }

  // keys that occur more than once need to be disambiguated somehow. Count their occurrences in order.
  private getKeyCount(key: MatchKey) {
    const hash = key.keyHash;
    if (isUndefined(this.keyCounts[hash])) {
      this.keyCounts[hash] = 0;
    }
    this.keyCounts[hash] += 1;
    return this.keyCounts[hash];
  }

  private customizeKey(key: MatchKey) {
    return this.vcr.options.customizeMatchKey(key);
  }

  // Parse and sort json if sent json
  private normalizeBody(request: Request) {
    let data = request.postData();
    if (data) {
      const headers = request.headers();
      if (headers["content-type"] == "application/json") {
        try {
          data = stableJSONStringify(JSON.parse(data));
        } catch (e) {
          data = "<INVALID JSON>";
        }
      }
      return data;
    } else {
      return null;
    }
  }

  private normalizeSearch(url: URL) {
    const params = url.searchParams;
    params.sort();
    return Object.fromEntries(params.entries());
  }
}
