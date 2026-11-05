# API Discovery

Verified on 2026-11-05 against `https://www.capterra.com/p/190778/QuickBooks-Online/`.

## Selected source

| Item             | Value                                                                        |
| ---------------- | ---------------------------------------------------------------------------- |
| Endpoint         | `GET https://www.capterra.com/p/{numericId}/{productSlug}/reviews/?page={N}` |
| Auth             | None                                                                         |
| Required header  | `rsc: 1`                                                                     |
| Optional headers | `referer: https://www.capterra.com/`, `next-url: {pathname}{search}`         |
| Transport        | `impit` with browser impersonation; HTTP/2 negotiated by impit               |
| Payload          | Next.js RSC stream containing `product.hybridReviewPage`                     |
| Page size        | 25 review entries per page                                                   |
| Pagination       | `page` query parameter, 1-based                                              |

`rsc: 1` is the only mandatory header. `referer` and `next-url` improve consistency. The same request without `rsc` returns the rendered HTML page with no review payload.

## Review data shape

`product.hybridReviewPage` is an array of 25 wrapper objects:

```
{ id, kind, publishedAt, reviewForm, value }
```

`value` contains the review:

```
{ id, kind, sourceSite, reviewForm, isSummary, publishedAtRaw, publishedAt,
  reviewer, overallRating, ratingDetails, title, generalComments, pros, cons, summary }
```

- `ratingDetails` maps to the dataset sub-ratings: `easeOfUse`, `functionality`, `qualityOfSupport`, `valueForMoney`, `recommendation`.
- `reviewer` holds `fullName`, `jobTitle`, `industry`, `timeUsedProduct`, `profilePictureUrl`.
- `kind` is `primary` for normal reviews.
- Page 1 also contains one `kind: "secondary"` entry with `isSummary: true` and a placeholder title (`$undefined`). The actor skips it, so page 1 yields 24 full reviews and later pages yield 25.

`product.textReviews` is still present but now holds only one featured review. The previous actor read only this array, which is why it collected at most one review per page.

Product-level counts: `product.totalCount` and `product.reviewSummary.totalReviews` both reported `8537` for QuickBooks Online. Both are mapped to `total_reviews`.

## Pagination behavior

- `?page=1` and `?page=2` return distinct review batches.
- Out-of-range pages still return review data instead of an empty list, so page length alone is not a valid stop signal.
- The actor stops a URL when a page adds no new `review_id` values, or when `max_pages` / `results_wanted` is reached. This handles repeated out-of-range batches.

## impit profile matrix

All 23 profiles exposed by `impit@0.14.8` were tested against the RSC endpoint.

| Profile                                                                                                                                                 | Status | Result               |
| ------------------------------------------------------------------------------------------------------------------------------------------------------- | :----: | -------------------- |
| `okhttp`, `okhttp3`, `okhttp4`, `okhttp5`                                                                                                               |  200   | Full review payload  |
| `ios18`                                                                                                                                                 |  200   | Full review payload  |
| `firefox`, `firefox128`, `firefox133`                                                                                                                   |  200   | Full review payload  |
| `chrome`, `chrome100`, `chrome101`, `chrome104`, `chrome107`, `chrome110`, `chrome116`, `chrome124`, `chrome125`, `chrome131`, `chrome136`, `chrome142` |  403   | Cloudflare challenge |
| `firefox135`, `firefox144`, `firefox158`                                                                                                                |  403   | Cloudflare challenge |

The actor tries the eight working profiles first and falls through to the rest. This is a point-in-time result: Capterra changes fingerprints, so the fallback list exists to keep old profiles usable when a previously blocked profile starts working again.

## Request variants used for retries

1. `{ referer, rsc: '1', 'next-url' }`
2. `{ rsc: '1' }`
3. `{ referer, rsc: '1', 'next-url', accept: 'text/x-component' }`

Each attempt rotates the browser profile and, when a proxy is configured, gets a fresh proxy session. Cookies persist in a shared jar and are dropped every five attempts.

## Rejected alternatives

| Candidate                                                                             | Result                                                  |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Plain HTML product/reviews page                                                       | Inconsistent Cloudflare 403, no reliable review payload |
| `m.capterra.com`                                                                      | Does not resolve                                        |
| `api.capterra.com`, `mobile-api.capterra.com`, `consumer-api.capterra.com`            | Do not resolve / connection failure                     |
| `https://www.capterra.com/api/`                                                       | 404                                                     |
| `https://www.capterra.com/graphql`                                                    | 404                                                     |
| `reviews.capterra.com`                                                                | Review submission service, not a review list            |
| `?sort=` on the reviews URL                                                           | 403                                                     |
| Analytics/XHR endpoints (`/bx-capterra-api/...`, CDN RUM, Datadog, FullStory, Lytics) | No review records                                       |
| URLScan public results                                                                | No usable request data without login                    |

## Diagnosis when the actor fails

1. Fetch one reviews page with `rsc: 1` and a known-good profile (`okhttp4`).
2. Check the status and the first 30 KB for `Just a moment`, `Attention Required`, `cf-chl`, or `captcha`.
3. Run the body through `parseProduct()` and check for `hybridReviewPage` / `textReviews`.
4. If the body parses but the review list is empty, check whether Capterra renamed the container. Add the new key to `REVIEW_CONTAINER_KEYS` in `src/extract.js` only after confirming the shape.
5. If every profile returns 403, the block is IP-based: use a fresh proxy session, then re-test profiles.
6. If `rsc: 1` stops working, inspect the browser request that loads `/reviews/` and confirm the RSC header name and value before changing the actor.

`src/extract.js` holds the parsing and mapping logic, so a shape change can be fixed there and verified with `npm test` without starting the Actor.
