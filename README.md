# puppeteer-vcr

Record and replay web interactions with Puppeteer.

### Features

- Record request/responses to disk and replay them for the next test
- Block navigation to the next page while requests finish coming in to be recorded
- Safe to use as the puppeteer page's evaluation context comes and goes (no `ExecutionContext closed` errors during navigation)

### Prior Art

- [Pollyjs](https://netflix.github.io/pollyjs/#/). Similar, but not puppeteer specific, which means the APIs and functionality isn't as puppeteer specific. Has small issues around replaying error responses and continuing to work while page navigation takes place.
