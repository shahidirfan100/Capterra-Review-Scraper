import { describe, expect, it } from 'vitest';

import {
    buildPageUrl,
    collectReviews,
    isBlockedBody,
    normalizeReview,
    normalizeReviewUrl,
    parseProduct,
    productNameFromUrl,
} from '../src/extract.js';

const hybridReview = (id, overrides = {}) => ({
    id: `wrapper-${id}`,
    kind: 'primary',
    value: {
        id,
        title: `Title ${id}`,
        overallRating: 4,
        publishedAt: 'June 4, 2026',
        ratingDetails: { easeOfUse: 5, qualityOfSupport: 3, functionality: 4, valueForMoney: 2, recommendation: 8 },
        reviewer: { fullName: 'Jane D.', jobTitle: 'Founder', industry: 'Retail', timeUsedProduct: '1-3 years' },
        pros: 'Fast',
        cons: 'Pricey',
        sourceSite: 'CAPTERRA',
        ...overrides,
    },
});

const product = {
    name: 'QuickBooks Online',
    totalCount: 8537,
    hybridReviewPage: [hybridReview('a'), hybridReview('summary', { isSummary: true }), hybridReview('b')],
};

describe('parseProduct', () => {
    it('reads a plain JSON body', () => {
        expect(parseProduct(JSON.stringify({ product }))).toEqual(product);
    });

    it('finds the product inside an RSC stream and prefers the fullest payload', () => {
        const body = `0:{"stale":true}\n1:{"product":{"name":"Stale"}}\n2:{"product":${JSON.stringify(product)}}\n`;
        expect(parseProduct(body).name).toBe('QuickBooks Online');
    });

    it('ignores truncated payloads', () => {
        expect(parseProduct('2:{"product":{"name":"Broken"')).toBeUndefined();
    });
});

describe('collectReviews', () => {
    it('uses hybridReviewPage and skips the summary entry', () => {
        expect(collectReviews(product).map((review) => review.value.id)).toEqual(['a', 'b']);
    });

    it('falls back to textReviews when the hybrid list is empty', () => {
        const textReviews = [{ reviewId: 't1', title: 'Fallback', overallRating: 3 }];
        const reviews = collectReviews({ name: 'X', hybridReviewPage: [], textReviews });
        expect(reviews).toHaveLength(1);
        expect(reviews[0].reviewId).toBe('t1');
    });

    it('returns an empty list when there are no reviews', () => {
        expect(collectReviews({ name: 'X', hybridReviewPage: [] })).toEqual([]);
        expect(collectReviews(null)).toEqual([]);
    });

    it('finds reviews under a renamed container', () => {
        const renamed = { name: 'X', pageData: { list: [{ reviewId: 'r1', title: 'Still here' }] } };
        expect(collectReviews(renamed)).toHaveLength(1);
    });
});

describe('normalizeReview', () => {
    it('maps the hybrid review shape to the dataset fields', () => {
        const [raw] = collectReviews(product);
        const record = normalizeReview(raw, {
            product,
            pageUrl: 'https://www.capterra.com/p/190778/QuickBooks-Online/reviews/',
            page: 1,
            fallbackName: 'Fallback Name',
        });

        expect(record).toMatchObject({
            review_id: 'a',
            product_name: 'QuickBooks Online',
            page: 1,
            total_reviews: 8537,
            review_title: 'Title a',
            review_date: 'June 4, 2026',
            overall_rating: 4,
            ease_of_use_rating: 5,
            customer_service_rating: 3,
            features_rating: 4,
            value_for_money_rating: 2,
            likelihood_to_recommend_rating: 8,
            reviewer_name: 'Jane D.',
            reviewer_title: 'Founder',
            reviewer_industry: 'Retail',
            reviewer_time_used: '1-3 years',
            pros: 'Fast',
            cons: 'Pricey',
            source_site: 'CAPTERRA',
        });
    });

    it('maps the richer textReviews shape', () => {
        const raw = {
            reviewId: 'text-1',
            title: 'Solid',
            writtenOn: 'May 1, 2026',
            overallRating: 5,
            easeOfUseRating: 4,
            customerSupportRating: 3,
            functionalityRating: 2,
            valueForMoneyRating: 1,
            recommendationRating: 9,
            prosText: 'Good',
            consText: 'Bad',
            reviewSource: { code: 'NO', tooltip: 'No Incentive Offered' },
        };

        const record = normalizeReview(raw, { product: { name: 'X' }, pageUrl: 'u', page: 2 });
        expect(record).toMatchObject({
            review_id: 'text-1',
            review_date: 'May 1, 2026',
            ease_of_use_rating: 4,
            customer_service_rating: 3,
            features_rating: 2,
            value_for_money_rating: 1,
            likelihood_to_recommend_rating: 9,
            review_source_code: 'NO',
        });
    });
});

describe('URL handling', () => {
    it('converts a product URL to the reviews URL', () => {
        expect(normalizeReviewUrl('https://www.capterra.com/p/190778/QuickBooks-Online/').pathname).toBe(
            '/p/190778/QuickBooks-Online/reviews/',
        );
    });

    it('keeps existing query parameters and rejects non-Capterra hosts', () => {
        const url = normalizeReviewUrl('https://www.capterra.com/p/190778/QuickBooks-Online/reviews/?page=2');
        expect(url.searchParams.get('page')).toBe('2');
        expect(() => normalizeReviewUrl('https://example.com/p/1/x/')).toThrow();
    });

    it('derives a fallback product name from the URL', () => {
        const url = normalizeReviewUrl('https://www.capterra.com/p/190778/QuickBooks-Online/');
        expect(productNameFromUrl(url)).toBe('QuickBooks Online');
    });

    it('builds page URLs', () => {
        const base = normalizeReviewUrl('https://www.capterra.com/p/190778/QuickBooks-Online/');
        expect(buildPageUrl(base, 1).searchParams.has('page')).toBe(false);
        expect(buildPageUrl(base, 3).searchParams.get('page')).toBe('3');
    });
});

describe('isBlockedBody', () => {
    it('flags challenge pages and non-retryable statuses', () => {
        expect(isBlockedBody(200, '<title>Just a moment...</title>')).toBe(true);
        expect(isBlockedBody(403, '')).toBe(true);
        expect(isBlockedBody(429, '')).toBe(true);
        expect(isBlockedBody(200, '1:{"product":{}}')).toBe(false);
        expect(isBlockedBody(404, '')).toBe(false);
    });
});
