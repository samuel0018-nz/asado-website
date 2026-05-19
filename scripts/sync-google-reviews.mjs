#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GBP_API_ROOT = 'https://mybusiness.googleapis.com/v4';
const DEFAULT_OUTPUT_PATH = 'data/reviews.json';
const REVIEW_LIMIT = 5;
const DEFAULT_PAGE_SIZE = 50;
const DEFAULT_MAX_PAGES = 50;

const displayDateFormatter = new Intl.DateTimeFormat('en-NZ', {
  day: 'numeric',
  month: 'long',
  timeZone: 'Pacific/Auckland',
  year: 'numeric'
});

export function buildReviewParent(accountId, locationId) {
  const location = String(locationId || '').trim().replace(/^\/+|\/+$/g, '');
  const account = String(accountId || '').trim().replace(/^\/+|\/+$/g, '');

  if (location.startsWith('accounts/') && location.includes('/locations/')) {
    return location;
  }

  const cleanAccount = account.replace(/^accounts\//, '');
  const cleanLocation = location.replace(/^locations\//, '');

  if (!cleanAccount || !cleanLocation) {
    throw new Error('GBP_ACCOUNT_ID and GBP_LOCATION_ID are required.');
  }

  return `accounts/${cleanAccount}/locations/${cleanLocation}`;
}

export function formatDisplayDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return '';
  return displayDateFormatter.format(date);
}

export function normalizeReviewText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

export function normalizeReview(raw) {
  const rating = raw.starRating === 'FIVE' || raw.rating === 5 ? 5 : null;
  const text = normalizeReviewText(raw.comment || raw.text);
  const reviewedAt = raw.createTime || raw.reviewedAt;
  const reviewedDate = new Date(reviewedAt);

  if (rating !== 5 || !text || Number.isNaN(reviewedDate.valueOf())) {
    return null;
  }

  return {
    id: raw.reviewId || String(raw.name || '').split('/').pop() || reviewedAt,
    authorName: raw.reviewer?.displayName || raw.authorName || 'A Google user',
    rating,
    text,
    reviewedAt: reviewedDate.toISOString(),
    displayDate: formatDisplayDate(reviewedDate)
  };
}

export function selectLatestFiveStarReviews(rawReviews, limit = REVIEW_LIMIT) {
  return rawReviews
    .map(normalizeReview)
    .filter(Boolean)
    .sort((a, b) => Date.parse(b.reviewedAt) - Date.parse(a.reviewedAt))
    .slice(0, limit);
}

export function buildReviewsPayload(rawReviews, options = {}) {
  return {
    updatedAt: new Date(options.now || Date.now()).toISOString(),
    source: 'google_business_profile',
    reviews: selectLatestFiveStarReviews(rawReviews, options.limit || REVIEW_LIMIT)
  };
}

export function preserveUpdatedAtWhenReviewsUnchanged(existingPayload, nextPayload) {
  if (!existingPayload || !Array.isArray(existingPayload.reviews)) return nextPayload;

  const existingReviews = JSON.stringify(existingPayload.reviews);
  const nextReviews = JSON.stringify(nextPayload.reviews);
  if (existingReviews !== nextReviews) return nextPayload;

  return {
    ...nextPayload,
    updatedAt: Object.prototype.hasOwnProperty.call(existingPayload, 'updatedAt')
      ? existingPayload.updatedAt
      : nextPayload.updatedAt
  };
}

async function fetchAccessToken() {
  const required = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REFRESH_TOKEN'];
  const missing = required.filter(name => !process.env[name]);
  if (missing.length) {
    throw new Error(`Missing required Google OAuth secret(s): ${missing.join(', ')}`);
  }

  const body = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    client_secret: process.env.GOOGLE_CLIENT_SECRET,
    refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
    grant_type: 'refresh_token'
  });

  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body
  });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok || !payload.access_token) {
    throw new Error(`Google OAuth token refresh failed: ${payload.error || response.status}`);
  }

  return payload.access_token;
}

async function fetchGoogleBusinessReviews({ accessToken, parent, maxPages, pageSize }) {
  const reviews = [];
  let pageToken = '';

  for (let page = 0; page < maxPages; page += 1) {
    const url = new URL(`${GBP_API_ROOT}/${parent}/reviews`);
    url.searchParams.set('pageSize', String(pageSize));
    url.searchParams.set('orderBy', 'updateTime desc');
    if (pageToken) url.searchParams.set('pageToken', pageToken);

    const response = await fetch(url, {
      headers: { authorization: `Bearer ${accessToken}` }
    });
    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(`Google Business Profile reviews fetch failed: ${payload.error?.message || response.status}`);
    }

    reviews.push(...(payload.reviews || []));
    pageToken = payload.nextPageToken || '';
    if (!pageToken) return reviews;
  }

  throw new Error(`Stopped after GBP_MAX_PAGES=${maxPages}; increase GBP_MAX_PAGES to scan more reviews.`);
}

function parseArgs(argv) {
  const args = {
    dryRun: false,
    fixture: '',
    output: DEFAULT_OUTPUT_PATH
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--fixture') args.fixture = argv[++i] || '';
    else if (arg === '--output') args.output = argv[++i] || DEFAULT_OUTPUT_PATH;
    else throw new Error(`Unknown argument: ${arg}`);
  }

  return args;
}

async function readFixtureReviews(fixturePath) {
  const raw = await readFile(fixturePath, 'utf8');
  const payload = JSON.parse(raw);
  return Array.isArray(payload) ? payload : payload.reviews || [];
}

async function readExistingPayload(outputPath) {
  try {
    return JSON.parse(await readFile(outputPath, 'utf8'));
  } catch {
    return null;
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const rawReviews = args.fixture
    ? await readFixtureReviews(args.fixture)
    : await fetchGoogleBusinessReviews({
        accessToken: await fetchAccessToken(),
        parent: buildReviewParent(process.env.GBP_ACCOUNT_ID, process.env.GBP_LOCATION_ID),
        maxPages: Number(process.env.GBP_MAX_PAGES || DEFAULT_MAX_PAGES),
        pageSize: Number(process.env.GBP_PAGE_SIZE || DEFAULT_PAGE_SIZE)
      });

  const outputPath = resolve(args.output);
  const nextPayload = buildReviewsPayload(rawReviews);
  const payload = args.dryRun
    ? nextPayload
    : preserveUpdatedAtWhenReviewsUnchanged(await readExistingPayload(outputPath), nextPayload);
  const json = `${JSON.stringify(payload, null, 2)}\n`;

  if (args.dryRun) {
    process.stdout.write(json);
    return;
  }

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, json, 'utf8');
  console.log(`Wrote ${outputPath}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
