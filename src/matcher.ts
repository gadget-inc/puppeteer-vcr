import { URL } from "url";
import { Request } from "puppeteer";
import farmhash from "farmhash";
import stableJSONStringify from "fast-json-stable-stringify";
import { isUndefined } from "lodash";

export interface MatchKey {
  keyCount: number;
  method: string;
  body: string | undefined;
  isNavigationRequest: boolean;
  resourceType: string;
  url: {
    protocol: string;
    username: string;
    password: string;
    hostname: string;
    pathname: string;
    port: string;
    query: string;
  };
  hash: "";
  extra: {
    [key: string]: any;
  };
}

export class Matcher {
  keyCounts: { [key: string]: number } = {};

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
      hash: "",
      extra: {}
    });

    key.hash = farmhash.hash32(stableJSONStringify(key));
    key.keyCount = this.getKeyCount(key);

    return key;
  }

  // keys that occur more than once need to be disambiguated somehow. Count their occurrences in order.
  private getKeyCount(key: MatchKey) {
    const hash = key.hash;
    if (isUndefined(this.keyCounts[hash])) {
      this.keyCounts[hash] = 0;
    }
    this.keyCounts[hash] += 1;
    return this.keyCounts[hash];
  }

  private customizeKey(key: MatchKey) {
    // todo implement customization
    return key;
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
    }

    return data;
  }

  private normalizeSearch(url: URL) {
    const params = url.searchParams;
    params.sort();
    return params.toString();
  }
}
