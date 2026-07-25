# API Discovery

## Target

- URL: `https://www.capterra.com/p/190778/QuickBooks-Online/`
- Normalized reviews URL: `https://www.capterra.com/p/190778/QuickBooks-Online/reviews/`
- Goal: collect verified Capterra review records with pagination and rating fields.

## Existing Actor Audit

- Previous implementation targeted Remote.co jobs, not Capterra.
- Previous fields: `title`, `company`, `category`, `location`, `date_posted`, `description_html`, `description_text`, `url`.
- Previous method: CheerioCrawler page parsing with `got-scraping`.
- Useful Capterra fields added: review ID, product name, review title, review date, overall rating, category ratings, reviewer name, reviewer role, industry, company size, time used, pros, cons, source, page, total review count.

## Candidate Matrix

| Candidate                               | Header profile                                                            |                                                                      Status/body marker |  Fields | Pagination             | Decision                |
| --------------------------------------- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------: | ------: | ---------------------- | ----------------------- |
| URLScan public result search            | `page.domain:www.capterra.com`                                            | Recent Capterra product scans found, but full result data was unavailable without login | Unknown | Unknown                | Rejected                |
| Desktop direct product page             | Browser-like desktop headers                                              |                                                                     403 Cloudflare page |       0 | No                     | Rejected                |
| iOS Safari direct product page          | iOS Safari headers                                                        |                                                                     403 Cloudflare page |       0 | No                     | Rejected                |
| Android app-style direct product page   | `okhttp` JSON headers                                                     |                                                                     403 Cloudflare page |       0 | No                     | Rejected                |
| Playwright network inspection           | Browser used only for endpoint discovery                                  |                                     200 page load, no separate review JSON/XHR endpoint |     20+ | URL page param         | Used for discovery only |
| Capterra reviews page RSC response      | `GET /p/{id}/{slug}/reviews/?page=N` with `rsc: 1` and `next-url` headers |      Contains `product.textReviews`, ratings, reviewer objects, review IDs, total count |     20+ | `page` query parameter | Selected                |
| Capterra reviews page with `sort` query | RSC headers plus `sort`                                                   |                                                                     403 Cloudflare page |       0 | No                     | Rejected                |

## Selected API

- Endpoint: `https://www.capterra.com/p/{numericId}/{productSlug}/reviews/?page={page}`
- Method: `GET`
- Auth: None
- Pagination: `page` query parameter, 25 reviews per page observed.
- Fields available: review ID, product name, review title, review date, total reviews, overall rating, ease of use, customer service, features, value for money, likelihood to recommend, reviewer name, reviewer title, reviewer industry, reviewer company size, reviewer time used, reviewer profile image, reviewer validated, reviewer validations, pros, cons, general comments, advice to others, chosen reasons, switching reasons, incentive, source site, review source.
- Field count: 30 fields currently extracted vs 8 unrelated fields in the original actor.
- Works with plain desktop HTTP from this machine: No, direct `Invoke-WebRequest` returned Cloudflare 403.
- Actor replay method: `impit` with Chrome TLS/browser impersonation, optional Apify Residential proxy, and URL-based pagination.
- Headers required: `referer`, `rsc: 1`, and `next-url` matching the request path. Browser fingerprint headers are left to `impit`.
- Cookies/tokens: No hardcoded cookies, tokens, authorization headers, or CSRF values.
- HTTP/2: Left to `impit` protocol negotiation.
- Browser use: Playwright was used only to inspect network traffic and confirm endpoint/page data shape. The actor runtime is HTTP-only (impit).
- Browser profiles: Multiple fallback profiles (chrome142, firefox144, chrome131, ios18, chrome) are rotated on retry to bypass Cloudflare challenges.
- Deduplication: `review_id` tracked in a Set to skip duplicate records across pages and URLs.

## Impit Browser Profile Analysis

All 20 available impit browser profiles were tested against Capterra RSC endpoint:

| Profile                                                          |    TLS    | Status | Result                                           |
| ---------------------------------------------------------------- | :-------: | :----: | ------------------------------------------------ |
| chrome100, chrome101, chrome104, chrome107, chrome110, chrome116 | TLS Error |   -    | Server rejects old Chrome TLS fingerprints       |
| chrome124, chrome125, chrome131, chrome136, chrome142            |    OK     |  200   | Full review data returned                        |
| firefox128, firefox133, firefox135, firefox144                   |    OK     |  200   | Full review data returned                        |
| firefox, chrome (generic aliases)                                |    OK     |  200   | Full review data returned                        |
| okhttp, okhttp3, okhttp4                                         |    OK     |  200   | Full review data returned                        |
| okhttp5                                                          |    OK     |  403   | Cloudflare challenge                             |
| ios18                                                            | TLS Error |   -    | Apple TLS library not supported by Capterra edge |

**Selected profile rotation**: `['chrome142', 'firefox144', 'chrome131', 'okhttp4', 'chrome']`

- Chrome 142 (latest) tried first for best fingerprint
- Fall through Firefox 144, Chrome 131, okhttp4 (Android app style)
- Generic `chrome` as final fallback
- Rotated on each retry attempt with exponential backoff
- okhttp4 (Android app) was the most reliable fallback on blocked connections

## Why Weaker Candidates Were Rejected

- URLScan public search returned recent Capterra product scans, but full scan request data was not usable without login.
- Direct desktop, iOS Safari, and Android app-style HTTP requests returned Cloudflare challenge HTML without review data.
- Analytics endpoints such as `/bx-capterra-api/activity/events/`, `/cdn-cgi/rum`, Datadog, Google, FullStory, and Lytics did not contain product reviews.
- The `sort` query parameter caused 403 responses in direct RSC replay, so it was removed from runtime inputs to avoid an inconsistent request pattern.
- No separate GraphQL review-list endpoint was observed in the browser network log; the selected review list is delivered in the Capterra reviews page RSC response as structured JSON.
