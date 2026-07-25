import { Actor, log } from 'apify';
import { Impit } from 'impit';

const DEFAULT_START_URL = 'https://www.capterra.com/p/190778/QuickBooks-Online/reviews/';
const REVIEWS_PER_PAGE = 25;
const BROWSER_PROFILES = ['chrome142', 'firefox144', 'chrome131', 'okhttp4', 'chrome'];

await Actor.init();

const sleep = (ms) =>
    new Promise((r) => {
        setTimeout(r, ms);
    });

function cleanText(value) {
    return String(value ?? '')
        .replace(/\s+/g, ' ')
        .replace(/[“”]/g, '"')
        .trim();
}

function parseNumber(value) {
    if (value == null || value === '') return undefined;
    const n = Number(value);
    return Number.isFinite(n) ? n : undefined;
}

function removeEmptyValues(value) {
    if (Array.isArray(value)) {
        const c = value.map(removeEmptyValues).filter((i) => i !== undefined);
        return c.length ? c : undefined;
    }
    if (value && typeof value === 'object') {
        const e = Object.entries(value)
            .map(([k, v]) => [k, removeEmptyValues(v)])
            .filter(([, v]) => v !== undefined);
        return e.length ? Object.fromEntries(e) : undefined;
    }
    if (value == null || value === '') return undefined;
    return value;
}

function extractUrl(item) {
    if (!item) return undefined;
    if (typeof item === 'string') return item;
    if (typeof item === 'object') return item.url || item.href;
    return undefined;
}

function normalizeReviewUrl(rawUrl) {
    const url = new URL(rawUrl || DEFAULT_START_URL);
    if (!/\/reviews\/?$/i.test(url.pathname)) {
        url.pathname = url.pathname.replace(/\/?$/, '/reviews/');
    }
    return url;
}

function buildPageUrl(baseUrl, page) {
    const url = new URL(baseUrl.href);
    const startPage = Number(baseUrl.searchParams.get('page')) || 1;
    const p = startPage + page - 1;
    if (p > 1) url.searchParams.set('page', String(p));
    else url.searchParams.delete('page');
    url.searchParams.delete('sort');
    return url.href;
}

function getRscHeaders(url) {
    const u = new URL(url);
    return {
        referer: 'https://www.capterra.com/',
        rsc: '1',
        'next-url': u.pathname + u.search,
    };
}

function createClient(browser, proxyUrl) {
    return new Impit({
        browser,
        ignoreTlsErrors: true,
        ...(proxyUrl && { proxyUrl }),
        timeout: 30000,
    });
}

async function fetchPage(url, session, proxyConf) {
    const maxRetries = 5;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        const browser = BROWSER_PROFILES[(attempt - 1) % BROWSER_PROFILES.length];

        if (attempt === 1 && session.client) {
            // Reuse persisted client across pages (cookies + TLS intact)
        } else {
            // On retry: rotate browser fingerprint and IP
            const proxyUrl = proxyConf ? await proxyConf.newUrl() : undefined;
            /* eslint-disable-next-line no-param-reassign */
            session.client = createClient(browser, proxyUrl);
            /* eslint-disable-next-line no-param-reassign */
            session.proxyUrl = proxyUrl;
        }

        try {
            const response = await session.client.fetch(url, {
                redirect: 'follow',
                headers: getRscHeaders(url),
            });

            const body = await response.text();

            if (response.ok && body.includes('"textReviews"')) {
                return { status: response.status, body };
            }

            const retryable =
                response.status === 403 ||
                response.status === 429 ||
                response.status >= 500 ||
                /Attention Required|captcha|Access Denied|Just a moment/i.test(body);

            if (!retryable || attempt === maxRetries) {
                return { status: response.status, body };
            }

            log.warning(`HTTP ${response.status} with ${browser}, rotating (${attempt}/${maxRetries})`);
        } catch (err) {
            if (attempt === maxRetries) throw err;
            log.warning(`Request error with ${browser}, rotating (${attempt}/${maxRetries}): ${err.message}`);
        }

        await sleep(attempt * 1500 + Math.random() * 1000);
    }

    throw new Error(`Failed to fetch ${url}`);
}

function extractBalancedObject(text, key) {
    const ki = text.indexOf(key);
    if (ki === -1) return undefined;
    const start = text.indexOf('{', ki);
    if (start === -1) return undefined;
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let i = start; i < text.length; i++) {
        const c = text[i];
        if (inStr) {
            if (esc) esc = false;
            else if (c === '\\') esc = true;
            else if (c === '"') inStr = false;
            continue;
        }
        if (c === '"') inStr = true;
        else if (c === '{') depth++;
        else if (c === '}') {
            depth--;
            if (depth === 0) return text.slice(start, i + 1);
        }
    }
    return undefined;
}

function normalizeProductName(baseUrl) {
    const parts = baseUrl.pathname.split('/').filter(Boolean);
    return (parts[2] || '').replace(/-/g, ' ').trim();
}

function extractProductFromRsc(body) {
    const pt = extractBalancedObject(body, '"product":');
    return pt ? JSON.parse(pt) : undefined;
}

function mapReview(review, product, pageUrl, pageNumber, fallbackName) {
    const reviewer = review.reviewer || {};
    const source = review.reviewSource || {};
    const summary = product.reviewSummary || {};

    return removeEmptyValues({
        review_id: review.reviewId || review.globalReviewId,
        product_name: product.name || product.productName || fallbackName,
        product_url: pageUrl,
        page: pageNumber,
        total_reviews: parseNumber(summary.totalReviews),
        review_title: cleanText(review.title),
        review_date: cleanText(review.writtenOn),
        overall_rating: parseNumber(review.overallRating),
        ease_of_use_rating: parseNumber(review.easeOfUseRating),
        customer_service_rating: parseNumber(review.customerSupportRating),
        features_rating: parseNumber(review.functionalityRating),
        value_for_money_rating: parseNumber(review.valueForMoneyRating),
        likelihood_to_recommend_rating: parseNumber(review.recommendationRating),
        reviewer_name: cleanText(reviewer.fullName),
        reviewer_title: cleanText(reviewer.jobTitle),
        reviewer_industry: cleanText(reviewer.industry),
        reviewer_company_size: cleanText(reviewer.companySize),
        reviewer_time_used: cleanText(reviewer.timeUsedProduct),
        reviewer_profile_image: reviewer.profilePicUrl,
        reviewer_validated: reviewer.isValidated,
        reviewer_validations: reviewer.validationsPassed,
        pros: cleanText(review.prosText),
        cons: cleanText(review.consText),
        general_comments: cleanText(review.generalComments),
        advice_to_others: cleanText(review.adviceToOthers),
        chosen_reasons: review.chosenReasons,
        switching_reasons: review.switchingReasons,
        incentive: review.incentivized,
        source_site: review.sourceSite,
        review_source_code: source.code,
        review_source: source.tooltip,
    });
}

function extractReviews(body, pageUrl, pageNumber, baseUrl) {
    const product = extractProductFromRsc(body);
    const reviews = product?.textReviews;
    if (!Array.isArray(reviews)) return [];
    const fallback = normalizeProductName(baseUrl);
    return reviews.map((r) => mapReview(r, product, pageUrl, pageNumber, fallback)).filter(Boolean);
}

async function run() {
    const input = (await Actor.getInput()) || {};
    const { url, startUrl, startUrls, results_wanted = 20, max_pages = 3, proxyConfiguration } = input;

    const rawUrls = [...(Array.isArray(startUrls) ? startUrls : []).map(extractUrl), startUrl, url].filter(Boolean);
    const startReviewUrls = (rawUrls.length ? rawUrls : [DEFAULT_START_URL]).map(normalizeReviewUrl);
    const resultsWanted = Math.max(1, Number(results_wanted) || 20);
    const maxPages = Math.max(1, Number(max_pages) || 1);

    const isCloud = Actor.isAtHome();
    const wantsProxy = proxyConfiguration?.useApifyProxy || proxyConfiguration?.proxyUrls?.length;
    const proxyConf =
        wantsProxy && isCloud ? await Actor.createProxyConfiguration({ ...proxyConfiguration }) : undefined;

    if (wantsProxy && !isCloud) {
        log.info('Local run: Apify Proxy skipped outside Apify.');
    }
    log.info(`Proxy: ${proxyConf ? 'enabled' : 'disabled'}`);

    let saved = 0;
    let pagesFetched = 0;
    const seenIds = new Set();

    log.info(`Start | urls=${startReviewUrls.length} | target=${resultsWanted} | max_pages=${maxPages}`);

    for (const baseUrl of startReviewUrls) {
        if (saved >= resultsWanted) break;

        const session = {
            client: createClient(BROWSER_PROFILES[0], undefined),
            proxyUrl: undefined,
        };

        const startPage = Number(baseUrl.searchParams.get('page')) || 1;

        if (startPage > 1) {
            const b = new URL(baseUrl.href);
            b.searchParams.delete('page');
            await fetchPage(buildPageUrl(b, 1), session, proxyConf);
        }

        for (let page = 1; page <= maxPages && saved < resultsWanted; page++) {
            const pageUrl = buildPageUrl(baseUrl, page);
            log.info(`Fetching page ${page}: ${pageUrl}`);

            const { status, body } = await fetchPage(pageUrl, session, proxyConf);

            if (status < 200 || status >= 300) {
                log.warning(`HTTP ${status} for ${pageUrl}`);
                break;
            }
            pagesFetched++;

            const records = extractReviews(body, pageUrl, page, baseUrl);

            if (!records.length) {
                const blocked = /Attention Required|captcha|Access Denied|Just a moment/i.test(body);
                log.warning(`No reviews on page ${page}${blocked ? ' (blocked)' : ''}`);
                break;
            }

            const deduped = [];
            let dupes = 0;
            for (const r of records) {
                const id = r.review_id;
                if (id) {
                    if (seenIds.has(id)) {
                        dupes++;
                        continue;
                    }
                    seenIds.add(id);
                }
                deduped.push(r);
            }

            if (!deduped.length) {
                log.info(`All ${records.length} reviews on page ${page} are duplicates.`);
                if (records.length < REVIEWS_PER_PAGE) break;
                continue;
            }

            const batch = deduped.slice(0, resultsWanted - saved);
            await Actor.pushData(batch);
            saved += batch.length;
            log.info(
                `Saved ${batch.length} (${dupes} dupes, ${deduped.length - batch.length} over) | ${saved}/${resultsWanted}`,
            );

            if (records.length < REVIEWS_PER_PAGE) break;
        }
    }

    log.info(`Done | saved=${saved} | pages=${pagesFetched}`);
}

try {
    await run();
} finally {
    await Actor.exit();
}
