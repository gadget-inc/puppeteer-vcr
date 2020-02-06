import Timeout from "await-timeout";
import cookie from "cookie";
import { Request, Response, Page, SetCookie } from "puppeteer";
import setCookie from "set-cookie-parser";

export function assert<T>(value: T | undefined | null): T {
  if (!value) {
    throw new Error("assertion error");
  }
  return value;
}

export const sleep = (ms: number) => {
  return new Promise(resolve => setTimeout(resolve, ms));
};

// toString() for Puppeteer's Response that doesn't output a huge amount of internal stuff
export const smallResponseOutput = (response: Response) => {
  return {
    status: response.status(),
    headers: response.headers(),
    fromCache: response.fromCache(),
    fromServiceWorker: response.fromServiceWorker()
  };
};

// toString() for Puppeteer's Request that doesn't output a huge amount of internal stuff
export const smallRequestOutput = (request: Request) => {
  const frame = request.frame();
  const response = request.response();
  return {
    url: request.url(),
    id: (request as any)._requestId,
    referrer: request.headers()["referer"],
    resourceType: request.resourceType(),
    isNavigationRequest: request.isNavigationRequest(),
    mainFrame: frame && frame.parentFrame() === null,
    errorText: request.failure()?.errorText,
    response: response && smallResponseOutput(response)
  };
};

export const isRedirectResponse = (response: Response) => {
  const status = response.status();
  return status >= 300 && status <= 399;
};

export const reportErrors = async <T>(fn: () => Promise<T>, ...args: any[]): Promise<T> => {
  try {
    return await fn();
  } catch (e) {
    console.error("puppeteer-vcr internal error occurred");
    console.error(...args);
    console.error(e);
    throw e;
  }
};

export interface AbstractSetCookie extends setCookie.Cookie {
  expiresDelta?: number;
}

export const abstractCookies = (setCookieHeader: string | undefined): AbstractSetCookie[] => {
  if (!setCookieHeader) return [];

  // puppeteer does a weird thing where it concats multiple Set-Cookie headers into one string that is newline separated. Usually multiple Set-Cookie headers are joined with commas, but nope! Because of this we do the split using "\n" and don't use setCookie.splitCookiesString, which expects commas.
  const strings = setCookieHeader.split("\n");
  return strings.map(str => {
    const cookie = setCookie.parse(str)[0];
    const abstractCookie: AbstractSetCookie = { ...cookie };

    if (cookie.expires) {
      abstractCookie.expiresDelta = Number(cookie.expires) - Number(new Date());
      delete abstractCookie.expires;
    }

    return abstractCookie;
  });
};

export const setCookies = async (page: Page, abstractCookies: AbstractSetCookie[]) => {
  const cookies: SetCookie[] = abstractCookies.map(abstractCookie => {
    const setCookie: SetCookie = {
      name: abstractCookie.name,
      value: abstractCookie.value,
      domain: abstractCookie.domain,
      httpOnly: abstractCookie.httpOnly,
      sameSite: abstractCookie.sameSite as any,
      secure: abstractCookie.secure
    };

    if (abstractCookie.expiresDelta) {
      setCookie.expires = Number(new Date()) + abstractCookie.expiresDelta;
    }

    if (!setCookie.domain) {
      setCookie.url = page.url();
    }

    return setCookie;
  });

  // We use this api in order to set multiple cookies at once as puppeteers Record<string, string> api for headers won't let us set multiple Set-Cookie headers on a response.
  page.setCookie(...cookies);
};

export const setCookiesHeader = (abstractCookies: AbstractSetCookie[]) => {
  const strings = abstractCookies.map(abstractCookie => {
    const options: cookie.CookieSerializeOptions = {
      domain: abstractCookie.domain,
      httpOnly: abstractCookie.httpOnly,
      sameSite: abstractCookie.sameSite as any,
      secure: abstractCookie.secure
    };

    if (abstractCookie.expiresDelta) {
      options.expires = new Date(Number(new Date()) + abstractCookie.expiresDelta);
    }

    return cookie.serialize(abstractCookie.name, abstractCookie.value, options);
  });

  // Join with commas like browsers expect, not with \n
  return strings.join(",");
};

export interface AbstractCacheConfig {
  expiresDelta?: number;
  lastModifiedDelta?: number;
  dateDelta?: number;
}

const abstractDate = (str: string) => {
  const delta = Date.parse(str) - Number(new Date());
  if (!isNaN(delta)) {
    return delta;
  } else {
    return;
  }
};

export const abstractCacheConfig = (headers: Record<string, string>): AbstractCacheConfig => {
  const config: AbstractCacheConfig = {};

  if (headers["date"]) {
    config.dateDelta = abstractDate(headers["date"]);
  }

  if (headers["expires"]) {
    config.expiresDelta = abstractDate(headers["expires"]);
  }

  if (headers["last-modified"]) {
    config.lastModifiedDelta = abstractDate(headers["last-modified"]);
  }

  return config;
};

export const applyCacheConfig = (headers: Record<string, string>, cacheConfig: AbstractCacheConfig) => {
  const now = Number(new Date());

  if (cacheConfig.dateDelta) {
    headers["date"] = new Date(now + cacheConfig.dateDelta).toUTCString();
  }
  if (cacheConfig.expiresDelta) {
    headers["expires"] = new Date(now + cacheConfig.expiresDelta).toUTCString();
  }
  if (cacheConfig.lastModifiedDelta) {
    headers["last-modified"] = new Date(now + cacheConfig.lastModifiedDelta).toUTCString();
  }
};

export const truncate = (str: string, length = 1000, ending = "...") => {
  if (str.length > length) {
    return str.substring(0, length - ending.length) + ending;
  } else {
    return str;
  }
};

export const stringSafeResourceTypes = ["document", "stylesheet", "script"];

// JSON serialization safe version of the response body that we save to disk
// We save html and other sort-of-human-readable stuff as utf-8 so it can be examined in the json file, and we save images and other binary content as serialized binary using buffer.toString('binary')
export interface BodyDescriptor {
  encoding: BufferEncoding;
  content: string;
}

export const bufferToDescriptor = (buffer: Buffer, encoding: BufferEncoding) => ({ encoding, content: buffer.toString(encoding) });

export const responseBodyToString = async (response: Response): Promise<BodyDescriptor | null> => {
  // Avoid puppeteer errors trying to access the response.text() of responses that don't have it. Accessing .text() for redirect requests or request with 0 length responses throws deep inside Puppeteer.
  if (!isRedirectResponse(response)) {
    const buffer = await Timeout.wrap(response.buffer(), 1000, `puppeteer-vcr internal error: timed out retrieving request response`);
    const encoding = stringSafeResourceTypes.includes(response.request().resourceType()) ? "utf-8" : "binary";
    return bufferToDescriptor(buffer, encoding);
  } else {
    return null;
  }
};

export const bodyDescriptorToBuffer = (descriptor: BodyDescriptor) => Buffer.from(descriptor.content, descriptor.encoding);
