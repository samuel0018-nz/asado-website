# El Quincho Website Handover

This repository contains the static website blocks used for the El Quincho menu and Google reviews work. The current production test site is `https://www.asado.co.nz/`.

The important design principle is that restaurant staff update content in the Google Sheet, while the website code decides how that content is displayed.

## Recommended WordPress Integration

The Creator suggested feeding WordPress from GitHub. That can work, but the cleanest source of truth should remain:

```text
Google Sheet -> website menu renderer or generated JSON -> WordPress page/block
```

Recommended production approach:

1. Keep the Google Sheet as the editing interface for staff.
2. Use GitHub for the code and optional generated JSON files.
3. Have WordPress consume either:
   - the same JavaScript/CSS renderer used here, or
   - generated JSON created by GitHub Actions.

Best long-term option:

```text
Google Sheet -> GitHub Action -> menu JSON -> WordPress block/template
```

This avoids exposing API keys in WordPress browser code, gives WordPress stable JSON to read, and keeps the menu workflow simple for restaurant staff.

Fastest option:

```text
WordPress page -> enqueue this menu JavaScript/CSS -> fetch Google Sheet directly
```

This is simpler to ship but more coupled to Google's public sheet endpoint.

Avoid using an iframe as the final production solution unless speed matters more than SEO, analytics, accessibility, and WordPress styling control.

## Shared Google Sheet

Current sheet ID:

```text
1uOcFbvVAKiBRvTz6iNdWMleoeAW9kT9Bg5Lw-TejPG4
```

Current public fetch pattern:

```js
https://docs.google.com/spreadsheets/d/{SHEET_ID}/gviz/tq?tqx=out:json&sheet={SHEET_NAME}
```

Main tabs used by the website:

- `Food Menu`
- `Drinks Menu`
- `Specials`
- `Category Notes`
- `Site Assets`

The renderer expects spreadsheet values such as `active` and `homepage_feature` to use `Yes`.

## Block 1: Interactive Menu

Primary file:

```text
menu.html
```

Purpose:

The full interactive menu page with Food/Drinks tabs, specials, category sections, item rows, item detail modal, images, and YouTube videos.

Flow:

```text
Google Sheet tabs
-> fetchSheet()
-> food/drink rows grouped by category
-> renderFoodMenu() / renderDrinksMenu()
-> renderFoodCard() / renderDrinkCard()
-> optional showModal() for item detail, image, or YouTube video
```

Important code areas:

- Sheet configuration: `SHEET_ID`, `SHEETS`
- Data fetch: `fetchSheet()`
- Logos: local SVG files in `assets/brand/`; no spreadsheet logo replacement
- Food categories: `FOOD_CAT_ORDER`
- Drink categories: `DRINK_CAT_ORDER`
- Category color system: `CATEGORY_ACCENTS`, `getCategoryAccent()`
- Rendering: `renderFoodMenu()`, `renderFoodCard()`, `renderDrinksMenu()`, `renderDrinkCard()`
- Specials: `renderSpecials()`
- Modal/media: `showModal()`, `getYouTubeId()`

Key fields expected in `Food Menu`:

- `active`
- `category`
- `display_order`
- `item_name`
- `description`
- `price`
- `price_note`
- `includes`
- `vegetarian`
- `allergens`
- `image_url`
- `video_url`
- `homepage_feature`

Key fields expected in `Drinks Menu`:

- `active`
- `category`
- `display_order`
- `item_name`
- `description`
- `price_150ml`
- `price_250ml`
- `price_bottle`
- `price_single`
- `volume`
- `abv`

## Block 2: Homepage Menu Preview

Primary file:

```text
index.html
```

Purpose:

The homepage section headed "What are you hungry for?" shows selected menu items from the same Google Sheet.

Flow:

```text
Food Menu tab
-> active = Yes
-> homepage_feature = Yes
-> render compact homepage menu cards
```

Important code areas:

- Shared sheet loader: `fetchSheet()`
- Shared asset loader: `loadSiteAssets()`, `applySiteAssets()`
- Homepage menu preview: `loadMenuHighlights()`
- Specials preview: `loadHomeSpecials()`

To choose homepage items, set this in the `Food Menu` tab:

```text
active = Yes
homepage_feature = Yes
```

The homepage preview keeps image support through `image_url`, but now uses the image as a small thumbnail so it visually matches the printed menu direction more closely.

## Block 3: Google Reviews

Primary files:

```text
scripts/sync-google-reviews.mjs
.github/workflows/sync-google-reviews.yml
data/reviews.json
index.html
```

Purpose:

The homepage review block is generated from Google Business Profile reviews without exposing Google credentials in browser code.

Flow:

```text
Google Business Profile API
-> GitHub Action daily/manual
-> scripts/sync-google-reviews.mjs
-> data/reviews.json
-> index.html loadLatestReviews()
-> homepage review cards
```

The GitHub Action runs daily at:

```text
0 18 * * * UTC
```

Required GitHub secrets:

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REFRESH_TOKEN`
- `GBP_ACCOUNT_ID`
- `GBP_LOCATION_ID`

Current review behavior:

- fetches Google Business Profile reviews
- keeps only 5-star reviews
- skips star-only reviews because the homepage needs review text
- sorts by original review date
- outputs the latest five text reviews

Current public JSON shape:

```json
{
  "updatedAt": "2026-05-19T18:00:00.000Z",
  "source": "google_business_profile",
  "reviews": [
    {
      "id": "reviewId",
      "authorName": "Reviewer Name",
      "rating": 5,
      "text": "Review text",
      "reviewedAt": "2026-05-10T03:14:00.000Z",
      "displayDate": "10 May 2026"
    }
  ]
}
```

Review photos:

Google's Review resource can include media in `reviewMediaItems`, with fields such as thumbnail and video URLs. The current script does not preserve or display review media. If review photos are required, extend `normalizeReview()` in `scripts/sync-google-reviews.mjs` to include `reviewMediaItems`, then update `renderReviewCard()` in `index.html`.

## Site Assets

The `Site Assets` tab powers replaceable homepage photos and map artwork. Existing keys include:

- `logo_white`
- `logo_black`
- `logo_orange`
- `story_main_image`
- `story_small_image`
- `map_background`

Current behavior:

```text
Site Assets tab
-> loadSiteAssets()
-> applyImageAsset() or applyBackgroundAsset()
```

Google Drive file links are normalized to thumbnail URLs for images.

The three `logo_*` keys are retained in the spreadsheet for reference, but are no longer read by the website. Header and footer logos use the supplied vector artwork in `assets/brand/`, cropped to the artwork bounds so its visible size is consistent. The footer logo links home. Keeping these SVGs local avoids delayed Google Drive logo swaps and extra whitespace around the artwork.

## Brand styling — November 2026

All three pages load `assets/brand/brand.css` after their base styles. This shared stylesheet applies the El Quincho manual's Knockout HTF49 Liteweight headings and controls, Cormorant Garamond body and prices, and brand palette. The local WOFF2 files preserve the source fonts' character sets, including Spanish accents. The Cormorant licence is included alongside the fonts.

The homepage keeps the compact food cards and their spreadsheet images. The short “A little piece of Argentina” story uses a teal background with dark text. The existing Asado hero video is retained; its section fits the content instead of forcing a full-screen height. Header and footer logos use white and orange variants respectively.

Menu, drinks, specials, reviews and booking connections remain in place. The NowBookIt embed retains the same account and venue; its theme colours match the brand palette. These changes apply only to Asado. They do not update the WordPress site at elquincho.co.nz.

Navigation has one Visit destination. Group enquiries remain inside that section; the legacy `events` anchor is retained for existing links. Email links open the visitor's configured email handler in a separate browsing context; Instagram, Facebook and the interim newsletter link also preserve the Asado page. The header updates its position on resize as well as scroll so the top strip cannot cover the logo when changing viewport sizes.

## WordPress transfer and customer signup — decisions to preserve

Samuel confirmed on 6 November that the final design will first be tested on WordPress staging, then published on the existing elquincho.co.nz domain. The Asado static site remains the design reference until that separately approved release.

- The Shop link currently points to the existing live WooCommerce store at `https://elquincho.co.nz/shop/`. When building WordPress staging, deliberately route test shop/cart/checkout links to the isolated staging store. Verify no staging action sends a test customer into live payment or live order email flows. Restore the production routes for the approved live release; preserve existing product URLs, order data, shipping rules, Stripe account/webhooks and the Thursday paid-delivery email.
- Newsletter signup currently opens the existing WordPress form at `https://elquincho.co.nz/#form-field-email` in a new tab. This is an interim route, not a completed CRM connection. The marketing plan still lists the destination as an open decision. Replace this route with a direct signup form connected to the agreed customer/email manager once its destination, consent handling and unsubscribe sync are tested.
- The planned customer view combines newsletter signups, WordPress subscribers, WooCommerce customers and NowBookIt marketing-permitted contacts while retaining source and consent status. An order or booking alone must not silently become a marketing subscription. Preserve old Mailchimp unsubscribe and cleaned records as suppression data when preparing any combined list; the verified export contains 395 subscribed, 13 unsubscribed and 6 cleaned contacts. Do not re-subscribe suppressed contacts through an import.
- Before the design swap, test booking, gift cards, shop, signup, order emails, analytics events, tracking tags, canonicals, redirects and sitemap on staging, then check the approved production release. No staging database should replace production orders or subscribers.

## Style Direction Applied Before Handover

The menu styling has been adjusted toward the supplied printed menu reference:

- shared site header, then the Food/Drinks tabs without an extra menu masthead
- compact category sections
- colored category markers
- tighter item rows with price-led layout
- beige highlight panels for specials
- smaller homepage preview cards that feel related to the full menu

The spreadsheet flow and tab names were kept intact.

## Local Checks

Useful checks before handing off:

```powershell
node scripts/test-sync-google-reviews.mjs
node --check scripts/sync-google-reviews.mjs
node --check scripts/test-sync-google-reviews.mjs
```

For visual review, serve the folder locally and open:

```text
index.html
menu.html
book-a-table/index.html
```

## Notes For The Creator

- Do not place Google OAuth secrets in browser JavaScript.
- Keep the Google Sheet as the staff-facing editor.
- If moving into WordPress, prefer a WordPress block/template that consumes JSON or a narrowly scoped JS/CSS bundle.
- Keep fallback static review cards in `index.html` so the page still looks complete if `data/reviews.json` fails.
- If changing spreadsheet column names, update both `index.html` and `menu.html`.
