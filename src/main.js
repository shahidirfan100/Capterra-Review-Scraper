import { Actor, log } from 'apify';
import { Impit } from 'impit';
import { CookieJar } from 'tough-cookie';

import {
    buildPageUrl,
    collectReviews,
    isBlockedBody,
    normalizeReview,
    normalizeReviewUrl,
    PAGE_SIZE,
    parseProduct,
    productNameFromUrl,
} from './extract.js';

const DEFAULT_URL = 'https://www.capterra.com/p/190778/QuickBooks-Online/';

await Actor.init();

// Profiles that returned 200 on the RSC endpoint on 2026-11-05. The full list follows as fallback.
const PREFERRED_PROFILES = ['okhttp4', 'okhttp3', 'okhttp', 'okhttp5', 'ios18', 'firefox133', 'firefox128', 'firefox'];
const ALL_PROFILES = [
    ...PREFERRED_PROFILES,
    'chrome',
    'chrome100',
    'chrome101',
    'chrome104',
    'chrome107',
    'chrome110',
    'chrome116',
    'chrome124',
    'chrome125',
    'chrome131',
    'chrome136',
    'chrome142',
    'firefox135',
    'firefox144',
    'firefox158',
];

const HEADER_VARIANTS = [
    (url) => ({ referer: 'https://www.capterra.com/', rsc: '1', 'next-url': url.pathname + url.search }),
    () => ({ rsc: '1' }),
    (url) => ({
        referer: 'https://www.capterra.com/',
        rsc: '1',
        'next-url': url.pathname + url.search,
        accept: 'text/x-component',
    }),
];

const MAX_ATTEMPTS_PER_PAGE = 10;

const sleep = (ms) =>
    new Promise((resolve) => {
        setTimeout(resolve, ms);
    });

function createClient(profile, proxyUrl, cookieJar) {
    return new Impit({
        browser: profile,
        proxyUrl,
        timeout: 30000,
        cookieJar: {
            getCookieString: (url) => cookieJar.getCookieString(url),
            setCookie: (cookie, url) => cookieJar.setCookie(cookie, url),
        },
    });
}

function hasReviewData(product) {
    // Accept an empty known list (real end of pagination) or any array that still looks like reviews after a rename.
    return (
        collectReviews(product).length > 0 ||
        Array.isArray(product.hybridReviewPage) ||
        Array.isArray(product.textReviews)
    );
}

function retryAfterMs(response) {
    const seconds = Number(response.headers.get('retry-after'));
    return Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds * 1000, 10000) : 0;
}

async function fetchProduct(url, state, proxyConf) {
    let lastError;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS_PER_PAGE; attempt += 1) {
        const profile = ALL_PROFILES[(attempt - 1) % ALL_PROFILES.length];
        const proxyUrl = proxyConf ? await proxyConf.newUrl() : undefined;

        // A fresh jar every few attempts drops cookies that are tied to a throttled edge node.
        if (attempt > 1 && attempt % 5 === 0) state.resetSession();

        const headers = HEADER_VARIANTS[(attempt - 1) % HEADER_VARIANTS.length](url);
        let waitMs = 800 + attempt * 400 + Math.random() * 600;

        try {
            const response = await createClient(profile, proxyUrl, state.cookieJar).fetch(url.href, {
                headers,
                redirect: 'follow',
            });
            const body = await response.text();
            const product = parseProduct(body);

            if (response.ok && product && hasReviewData(product)) {
                log.debug(`RSC fetch OK with ${profile}`);
                return product;
            }

            lastError = new Error(`HTTP ${response.status}, no review payload (${body.length} bytes)`);
            if (isBlockedBody(response.status, body)) waitMs = Math.max(waitMs, retryAfterMs(response));
            log.debug(`Attempt ${attempt}/${MAX_ATTEMPTS_PER_PAGE} with ${profile}: ${lastError.message}`);
        } catch (err) {
            lastError = err;
            log.debug(`Attempt ${attempt}/${MAX_ATTEMPTS_PER_PAGE} with ${profile}: ${err.message}`);
        }

        if (attempt < MAX_ATTEMPTS_PER_PAGE) await sleep(waitMs);
    }

    throw new Error(`Capterra did not return reviews for ${url.href}: ${lastError?.message}`);
}

async function run() {
    const input = (await Actor.getInput()) ?? {};
    const resultsWanted = Math.max(1, Number(input.results_wanted) || 20);
    const maxPages = Math.max(1, Number(input.max_pages) || 3);
    const baseUrl = normalizeReviewUrl(input.url || DEFAULT_URL);

    const wantsProxy = Boolean(input.proxyConfiguration?.useApifyProxy || input.proxyConfiguration?.proxyUrls?.length);
    const proxyConf =
        wantsProxy && Actor.isAtHome() ? await Actor.createProxyConfiguration(input.proxyConfiguration) : undefined;
    if (wantsProxy && !proxyConf) log.info('Local run: Apify Proxy is skipped outside the Apify platform.');

    log.info(`Start | target=${resultsWanted} | max_pages=${maxPages} | proxy=${proxyConf ? 'on' : 'off'}`);

    let saved = 0;
    let pagesFetched = 0;
    let pageFailures = 0;
    const seenIds = new Set();
    const state = {
        cookieJar: new CookieJar(),
        resetSession() {
            this.cookieJar = new CookieJar();
        },
    };
    const firstPage = Number(baseUrl.searchParams.get('page')) || 1;

    for (let page = firstPage; page < firstPage + maxPages && saved < resultsWanted; page += 1) {
        const pageUrl = buildPageUrl(baseUrl, page);

        let product;
        try {
            product = await fetchProduct(pageUrl, state, proxyConf);
        } catch (err) {
            pageFailures += 1;
            log.warning(`Page ${page} failed: ${err.message}`);
            break;
        }
        pagesFetched += 1;

        const records = collectReviews(product)
            .map((raw) =>
                normalizeReview(raw, {
                    product,
                    pageUrl: pageUrl.href,
                    page,
                    fallbackName: productNameFromUrl(baseUrl),
                }),
            )
            .filter(Boolean);

        const batch = [];
        let duplicates = 0;
        for (const record of records) {
            if (record.review_id) {
                if (seenIds.has(record.review_id)) {
                    duplicates += 1;
                    continue;
                }
                seenIds.add(record.review_id);
            }
            if (batch.length < resultsWanted - saved) batch.push(record);
        }

        if (!batch.length) {
            log.info(`Page ${page}: no new reviews (${duplicates} duplicates). Stopping.`);
            break;
        }

        await Actor.pushData(batch);
        saved += batch.length;
        log.info(`Saved ${batch.length} | page=${page} | total=${saved}/${resultsWanted}`);

        // Page 1 carries an extra summary entry, so a short full-review count is normal.
        if (records.length < PAGE_SIZE - 1) {
            log.info(`Page ${page} was the last page (${records.length} full reviews).`);
            break;
        }
    }

    log.info(`Done | saved=${saved} | pages=${pagesFetched} | failed_pages=${pageFailures}`);
    if (!saved) throw new Error('No reviews collected. See API_DISCOVERY.md for diagnosis steps.');
}

let exitCode = 0;
try {
    await run();
} catch (err) {
    exitCode = 1;
    log.error(err.message);
} finally {
    await Actor.exit({ exitCode });
}
