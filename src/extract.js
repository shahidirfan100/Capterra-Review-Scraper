const PAGE_SIZE = 25;
const REVIEW_CONTAINER_KEYS = ['hybridReviewPage', 'textReviews', 'reviews', 'reviewList', 'items', 'nodes', 'edges'];
const MAX_SEARCH_DEPTH = 4;

export function cleanText(value) {
    if (value == null) return undefined;
    return String(value).replace(/\s+/g, ' ').replace(/[“”]/g, '"').trim() || undefined;
}

export function toNumber(value) {
    if (value == null || value === '') return undefined;
    const number = Number(value);
    return Number.isFinite(number) ? number : undefined;
}

export function removeEmptyValues(value) {
    if (Array.isArray(value)) {
        const items = value.map(removeEmptyValues).filter((item) => item !== undefined);
        return items.length ? items : undefined;
    }
    if (value && typeof value === 'object') {
        const entries = Object.entries(value)
            .map(([key, item]) => [key, removeEmptyValues(item)])
            .filter(([, item]) => item !== undefined);
        return entries.length ? Object.fromEntries(entries) : undefined;
    }
    if (value == null || value === '') return undefined;
    return value;
}

function balancedObject(text, start) {
    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let index = start; index < text.length; index += 1) {
        const char = text[index];
        if (inString) {
            if (escaped) escaped = false;
            else if (char === '\\') escaped = true;
            else if (char === '"') inString = false;
            continue;
        }
        if (char === '"') inString = true;
        else if (char === '{') depth += 1;
        else if (char === '}') {
            depth -= 1;
            if (depth === 0) return text.slice(start, index + 1);
        }
    }
    return undefined;
}

function productScore(product) {
    let score = 0;
    if (Array.isArray(product.hybridReviewPage) && product.hybridReviewPage.length) score += 100;
    if (Array.isArray(product.textReviews) && product.textReviews.length) score += 50;
    if (product.reviewSummary || Number.isFinite(product.totalCount)) score += 20;
    if (typeof product.name === 'string' || typeof product.productName === 'string') score += 10;
    return score;
}

export function parseProduct(body) {
    if (typeof body !== 'string' || !body) return undefined;

    const trimmed = body.trim();
    if (trimmed.startsWith('{')) {
        try {
            const json = JSON.parse(trimmed);
            const product = json?.product ?? json?.props?.pageProps?.product;
            if (product && typeof product === 'object') return product;
        } catch {
            // Not a single JSON document; continue with the embedded payload.
        }
    }

    const candidates = [];
    let cursor = 0;
    while (cursor < body.length) {
        const keyIndex = body.indexOf('"product"', cursor);
        if (keyIndex === -1) break;
        const start = body.indexOf('{', keyIndex);
        const raw = start === -1 ? undefined : balancedObject(body, start);
        if (raw) {
            try {
                const product = JSON.parse(raw);
                if (product && typeof product === 'object') candidates.push(product);
            } catch {
                // A truncated or escaped chunk is not the product payload.
            }
        }
        cursor = keyIndex + 9;
    }

    return candidates.sort((left, right) => productScore(right) - productScore(left))[0];
}

function reviewValue(raw) {
    if (!raw || typeof raw !== 'object') return undefined;
    return raw.value && typeof raw.value === 'object' ? raw.value : raw;
}

function isReviewLike(raw) {
    const value = reviewValue(raw);
    if (!value) return false;
    const hasIdentity = value.reviewId || value.id || value.globalReviewId || raw.id;
    const hasContent =
        value.title ||
        value.overallRating ||
        value.pros ||
        value.prosText ||
        value.cons ||
        value.consText ||
        value.reviewer;
    return Boolean(hasIdentity && hasContent);
}

function isFullReview(raw) {
    const value = reviewValue(raw);
    return Boolean(value) && isReviewLike(raw) && value.isSummary !== true;
}

export function collectReviews(product) {
    if (!product || typeof product !== 'object') return [];

    for (const key of REVIEW_CONTAINER_KEYS) {
        const container = product[key];
        if (Array.isArray(container) && container.some(isFullReview)) return container.filter(isFullReview);
    }

    const queue = [{ value: product, depth: 0 }];
    const seen = new Set();

    while (queue.length) {
        const { value, depth } = queue.shift();
        if (!value || typeof value !== 'object' || seen.has(value) || depth > MAX_SEARCH_DEPTH) continue;
        seen.add(value);

        for (const child of Object.values(value)) {
            if (Array.isArray(child) && child.some(isFullReview)) return child.filter(isFullReview);
            if (child && typeof child === 'object' && !Array.isArray(child)) {
                queue.push({ value: child, depth: depth + 1 });
            }
        }
    }

    return [];
}

export function normalizeReview(raw, context) {
    const value = reviewValue(raw);
    if (!value) return undefined;

    const product = context.product || {};
    const reviewer = value.reviewer || {};
    const ratings = value.ratingDetails || {};
    const summary = product.reviewSummary || {};

    return removeEmptyValues({
        review_id: cleanText(value.reviewId || value.id || raw.id || value.globalReviewId),
        product_name: cleanText(product.name || product.productName || context.fallbackName),
        product_url: context.pageUrl,
        page: context.page,
        total_reviews: toNumber(product.totalCount ?? summary.totalReviews),
        review_title: cleanText(value.title),
        review_date: cleanText(value.publishedAt || value.writtenOn),
        overall_rating: toNumber(value.overallRating),
        ease_of_use_rating: toNumber(ratings.easeOfUse ?? value.easeOfUseRating),
        customer_service_rating: toNumber(ratings.qualityOfSupport ?? value.customerSupportRating),
        features_rating: toNumber(ratings.functionality ?? value.functionalityRating),
        value_for_money_rating: toNumber(ratings.valueForMoney ?? value.valueForMoneyRating),
        likelihood_to_recommend_rating: toNumber(ratings.recommendation ?? value.recommendationRating),
        reviewer_name: cleanText(reviewer.fullName),
        reviewer_title: cleanText(reviewer.jobTitle),
        reviewer_industry: cleanText(reviewer.industry),
        reviewer_company_size: cleanText(reviewer.companySize),
        reviewer_time_used: cleanText(reviewer.timeUsedProduct),
        reviewer_profile_image: reviewer.profilePictureUrl || reviewer.profilePicUrl,
        reviewer_validated: reviewer.isValidated,
        reviewer_validations: reviewer.validationsPassed,
        pros: cleanText(value.pros ?? value.prosText),
        cons: cleanText(value.cons ?? value.consText),
        general_comments: cleanText(value.generalComments),
        advice_to_others: cleanText(value.adviceToOthers),
        chosen_reasons: value.chosenReasons,
        switching_reasons: value.switchingReasons,
        incentive: value.incentivized,
        source_site: value.sourceSite,
        review_source_code: value.reviewSource?.code,
        review_source: cleanText(value.reviewSource?.tooltip),
    });
}

export function normalizeReviewUrl(rawUrl) {
    const url = new URL(String(rawUrl).trim());
    if (!/(^|\.)capterra\./i.test(url.hostname)) {
        throw new Error(`Not a Capterra URL: ${url.hostname}`);
    }

    const parts = url.pathname.split('/').filter(Boolean);
    if (parts[0] !== 'p' || !/^\d+$/.test(parts[1]) || !parts[2]) {
        throw new Error('Capterra product URL must look like /p/{id}/{product-slug}/');
    }

    url.pathname = `/p/${parts[1]}/${parts[2]}/reviews/`;
    return url;
}

export function productNameFromUrl(url) {
    return decodeURIComponent(url.pathname.split('/').filter(Boolean)[2] || '')
        .replace(/-/g, ' ')
        .trim();
}

export function buildPageUrl(baseUrl, page) {
    const url = new URL(baseUrl.href);
    if (page > 1) url.searchParams.set('page', String(page));
    else url.searchParams.delete('page');
    return url;
}

export function isBlockedBody(status, body) {
    if (status === 401 || status === 403 || status === 429 || status >= 500) return true;
    const sample = String(body || '').slice(0, 30000);
    return /Just a moment|Attention Required|Access Denied|cf-chl|challenge-platform|captcha/i.test(sample);
}

export { PAGE_SIZE };
