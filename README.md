# puppeteer-vcr

Record and replay web interactions with Puppeteer a la [vcr](https://github.com/vcr/vcr)

## Features

- Record request/responses to disk, and replay them for the next invocation
- Safe to use as the puppeteer page's evaluation context comes and goes (no `ExecutionContext closed` errors during navigation)
- Automatic timeshifting for caching and cookie headers (so a real browser still respects them)
- Rich configure-ability for custom request matching

## Other People's Websites

As `puppeteer` itself is often used for consuming web content from sites outside the developer's control, `puppeteer-vcr` is built to be used for the same use case. If you are building and testing a scraper or a testing tool for content outside of your control, `puppeteer-vcr` has facilities for a "best effort" replay of a recorded web property. It's not always possible to perfectly emulate the same environment that a page was first recorded in because of the giant swath of browser features that might affect how a site behaves, but, it's still useful to try emulate the broad strokes of the site to verify that some puppeteer client works properly.

Things like:

- the current time
- the JavaScript context's random seed
- `Expires`, and `Date` HTTP headers that govern content cacheability
- `Set-Cookie` headers that have time based expiry
- network races
- the flap of a butterfly's wings in Brazil

can all can make one page load different than the next. `puppeteer-vcr` does it's best to capture and abstract information about these things at recording time so it can reconstruct a similar, but not quite the same, environment at replay time.

### Time

`puppeteer-vcr` does not mess with the global notion of time inside the JavaScript contexts of the pages it is attached to, because it's hard to mock and error prone. The time during a recording or a replay will be the real time that action is invoked.

### Caching & Set-Cookie Headers

At record time, `puppeteer-vcr` records how far into the future a cached response or cookie expires, and then at replay time sets a expiry time that far into the future from the current time. This has the effect of setting the expiry to the same amount relative to the current time as the recorded expiry.

## Prior Art

- [Pollyjs](https://netflix.github.io/pollyjs/#/). Similar, but not puppeteer specific, which means the APIs and functionality isn't as puppeteer specific. Has small issues around replaying error responses and continuing to work while page navigation takes place, and doesn't do the same "best-effort" style live replay
