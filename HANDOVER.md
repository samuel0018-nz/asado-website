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
- Asset loading: `loadSiteAssets()`, `applySiteLogos()`
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

The `Site Assets` tab powers replaceable website assets. Existing keys include:

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
