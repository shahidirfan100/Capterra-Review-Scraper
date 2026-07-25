# Capterra Review Scraper

Extract verified Capterra software reviews for product research, competitor tracking, and customer sentiment analysis. Collect review titles, ratings, reviewer profiles, pros, cons, dates, and product-level review counts from Capterra product pages.

## Features

- **Product review collection** - Gather Capterra reviews from product URLs or direct reviews URLs.
- **Automatic URL handling** - Product profile URLs are converted to the matching reviews page.
- **Pagination support** - Collect multiple review pages until your requested result count is reached.
- **Detailed ratings** - Capture overall rating plus ease of use, support, features, value, and recommendation scores when available.
- **Clean datasets** - Empty fields are removed before records are saved.
- **Stable request pattern** - Uses Capterra's accepted review pagination shape for smooth runs.

---

## Use Cases

### Competitor Research

Compare what buyers say about competing software products. Track recurring complaints, praised features, and reviewer industries to understand how products are positioned in the market.

### Sentiment Analysis

Build review datasets for text analysis. Pros and cons fields are separated so you can classify positive and negative themes without manual cleanup.

### Sales Enablement

Use review evidence to prepare battlecards and objection handling. Reviewer role, industry, company size, and time used help sales teams focus on buyer segments that match their pipeline.

### Product Monitoring

Check new reviews regularly to spot changes in customer satisfaction. Sorting by most recent helps teams monitor fresh feedback and respond to emerging issues.

---

## Input Parameters

| Parameter            | Type    | Required | Default           | Description                                |
| -------------------- | ------- | -------- | ----------------- | ------------------------------------------ |
| `url`                | String  | Yes      | -                 | Capterra product or reviews URL to scrape. |
| `results_wanted`     | Integer | No       | `20`              | Maximum number of reviews to collect.      |
| `max_pages`          | Integer | No       | `3`               | Maximum number of review pages to fetch.   |
| `proxyConfiguration` | Object  | No       | Residential proxy | Proxy settings for reliable collection.    |

---

## Output Data

Each dataset item can contain:

| Field                            | Type    | Description                                                |
| -------------------------------- | ------- | ---------------------------------------------------------- |
| `review_id`                      | String  | Capterra review identifier.                                |
| `product_name`                   | String  | Reviewed software product name.                            |
| `review_title`                   | String  | Review headline.                                           |
| `review_date`                    | String  | Published review date.                                     |
| `overall_rating`                 | Number  | Overall star rating.                                       |
| `ease_of_use_rating`             | Number  | Ease of use score.                                         |
| `customer_service_rating`        | Number  | Customer service score.                                    |
| `features_rating`                | Number  | Features score.                                            |
| `value_for_money_rating`         | Number  | Value for money score.                                     |
| `likelihood_to_recommend_rating` | Number  | Recommendation score.                                      |
| `reviewer_name`                  | String  | Reviewer display name.                                     |
| `reviewer_title`                 | String  | Reviewer job title or role.                                |
| `reviewer_industry`              | String  | Reviewer industry.                                         |
| `reviewer_company_size`          | String  | Reviewer company size.                                     |
| `reviewer_time_used`             | String  | How long the reviewer used the product.                    |
| `reviewer_profile_image`         | String  | Reviewer profile image URL.                                |
| `reviewer_validated`             | Boolean | Whether the reviewer has been validated.                   |
| `reviewer_validations`           | Array   | Validation methods (LinkedIn, BusinessEmail, ProofOfLink). |
| `pros`                           | String  | Positive review text.                                      |
| `cons`                           | String  | Negative review text.                                      |
| `general_comments`               | String  | General review comments.                                   |
| `advice_to_others`               | String  | Reviewer advice to other buyers.                           |
| `chosen_reasons`                 | String  | Reasons the reviewer chose the product.                    |
| `switching_reasons`              | String  | Reasons the reviewer switched to the product.              |
| `incentive`                      | String  | Incentive disclosure code (NoIncentive, NominalGift).      |
| `source_site`                    | String  | Source review site.                                        |
| `review_source_code`             | String  | Review source code.                                        |
| `review_source`                  | String  | Review source disclosure text.                             |
| `product_url`                    | String  | Source Capterra reviews URL.                               |
| `page`                           | Integer | Review page number.                                        |
| `total_reviews`                  | Integer | Total review count shown for the product.                  |

---

## Usage Examples

### Basic Extraction

Collect 20 reviews from a product page:

```json
{
    "url": "https://www.capterra.com/p/190778/QuickBooks-Online/",
    "results_wanted": 20
}
```

### More Reviews

Collect reviews across more pages:

```json
{
    "url": "https://www.capterra.com/p/190778/QuickBooks-Online/reviews/",
    "results_wanted": 50,
    "max_pages": 4
}
```

### Start From a Later Page

Begin from a specific Capterra reviews page:

```json
{
    "url": "https://www.capterra.com/p/190778/QuickBooks-Online/reviews/?page=2",
    "results_wanted": 25,
    "proxyConfiguration": {
        "useApifyProxy": true,
        "apifyProxyGroups": ["RESIDENTIAL"]
    }
}
```

---

## Sample Output

```json
{
    "review_id": "Capterra___7174523",
    "product_name": "QuickBooks Online",
    "review_title": "Reliable Accounting Software That Saves Time and Simplifies Financial Management",
    "review_date": "June 24, 2026",
    "overall_rating": 4,
    "ease_of_use_rating": 5,
    "customer_service_rating": 2,
    "features_rating": 3,
    "value_for_money_rating": 4,
    "likelihood_to_recommend_rating": 7,
    "reviewer_name": "Jeff H.",
    "reviewer_title": "Front office manager",
    "reviewer_industry": "Medical Practice",
    "reviewer_company_size": "11 - 50 employees",
    "reviewer_time_used": "More than 2 years",
    "reviewer_validated": true,
    "reviewer_validations": ["ProofOfLink"],
    "pros": "I feel like QuickBooks provides good value for what you pay...",
    "cons": "Customer support has been helpful whenever I've needed assistance...",
    "general_comments": "Overall, my experience with QuickBooks has been very positive...",
    "incentive": "NoIncentive",
    "source_site": "Capterra",
    "review_source_code": "NO",
    "review_source": "No Incentive Offered: This review was submitted organically.",
    "product_url": "https://www.capterra.com/p/190778/QuickBooks-Online/reviews/",
    "page": 1,
    "total_reviews": 8483
}
```

---

## Tips for Best Results

### Use Product or Reviews URLs

- Product URLs such as `/p/190778/QuickBooks-Online/` work.
- Reviews URLs such as `/p/190778/QuickBooks-Online/reviews/` also work.

### Start Small

- Use `results_wanted` of `20` for test runs.
- Increase `max_pages` when collecting larger datasets.

### Work With Pagination

- Use `max_pages` to control how far the actor paginates.
- Add `?page=2` to the input URL if you want to start from a later page.

---

## Integrations

Connect your data with:

- **Google Sheets** - Review and filter records.
- **Airtable** - Build a searchable review database.
- **Webhooks** - Send new reviews to your own systems.
- **Make** - Run scheduled review workflows.
- **Zapier** - Trigger alerts and updates.

### Export Formats

- **JSON** - For developers and analysis tools.
- **CSV** - For spreadsheets.
- **Excel** - For reporting.
- **XML** - For system imports.

---

## Frequently Asked Questions

### Can I use either a product URL or a reviews URL?

Yes. The actor accepts both Capterra product URLs and Capterra reviews URLs.

### How many reviews are collected per page?

Capterra review pages usually show up to 25 reviews per page.

### Why are some fields missing?

Some reviews do not include every rating, profile detail, or source field. Empty values are removed from the dataset.

### Can I start from page 2 or later?

Yes. Add a `page` query parameter to the Capterra reviews URL, such as `?page=2`.

### Should I use a proxy?

Yes. Residential proxies are recommended for consistent production runs.

---

## Support

For issues or feature requests, contact support through the Apify Console.

### Resources

- [Apify Documentation](https://docs.apify.com/)
- [API Reference](https://docs.apify.com/api/v2)
- [Scheduling Runs](https://docs.apify.com/schedules)

---

## Legal Notice

This actor is designed for legitimate data collection purposes. Users are responsible for ensuring compliance with website terms of service and applicable laws. Use data responsibly and respect rate limits.
