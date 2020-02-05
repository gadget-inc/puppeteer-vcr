import { Request, Response } from "puppeteer";

export function assert<T>(value: T | undefined | null): T {
  if (!value) {
    throw new Error("assertion error");
  }
  return value;
}

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
    referrer: request.headers()["referer"],
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

export const responseHasContent = (response: Response) => {
  const contentLength = parseInt(response.headers()["content-length"], 10);
  return contentLength > 0;
};

export const reportErrors = async <T>(fn: () => Promise<T>, ...args: any[]): Promise<T> => {
  try {
    return await fn();
  } catch (e) {
    console.error("puppeteer-vcr request interception error occurred");
    console.error(...args);
    console.error(e);
    throw e;
  }
};
