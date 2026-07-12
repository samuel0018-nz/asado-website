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

export const REQUIRED_ENV_NAMES = [
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'GOOGLE_REFRESH_TOKEN',
  'GBP_ACCOUNT_ID',
  'GBP_LOCATION_ID'
];

const OAUTH_ENV_NAMES = [
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'GOOGLE_REFRESH_TOKEN'
];

const displayDateFormatter = new Intl.DateTimeFormat('en-NZ', {
  day: 'numeric',
  month: 'long',
  timeZone: 'Pacific/Auckland',
  year: 'numeric'
});

export function sanitizeForLog(value) {
  return String(value || '')
    .replace(/ya29\.[A-Za-z0-9._-]+/g, '[redacted-token]')
    .replace(/accounts\/[^/\s]+\/locations\/[^/\s]+/g, 'accounts/[redacted]/locations/[redacted]')
    .replace(/(client_id|client_secret|refresh_token)=([^&\s]+)/gi, '$1=[redacted]');
}

export function getMissingEnvNames(names = REQUIRED_ENV_NAMES, env = process.env) {
  return names.filter(name => !String(env[name] || '').trim());
}

export function assertRequiredEnv(names = REQUIRED_ENV_NAMES, env = process.env) {
  const missing = getMissingEnvNames(names, env);
  if (missing.length) {
    throw new Error(`Missing required Google review sync secret(s): ${missing.join(', ')}`);
  }
}

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

function normalizeRating(value) {
  if (value === 'FIVE' || value === 5 || value === '5') return 5;
  if (value === 'FOUR' || value === 4 || value === '4') return 4;
  if (value === 'THREE' || value === 3 || value === '3') return 3;
  if (value === 'TWO' || value === 2 || value === '2') return 2;
  if (value === 'ONE' || value === 1 || value === '1') return 1;
  return null;
}

export function normalizeReview(raw) {
  if (!raw || typeof raw !== 'object') return null;

  const rating = normalizeRating(raw.starRating ?? raw.rating);
  const text = normalizeReviewText(raw.comment || raw.text);
  const reviewedAt = raw.createTime || raw.reviewedAt || raw.updateTime;
  const reviewedDate = new Date(reviewedAt);

  if (rating !== 5 || !text || Number.isNaN(reviewedDate.valueOf())) {
    return null;
  }

  return {
    id: raw.reviewId || String(raw.name || '').split('/').pop() || `${reviewedDate.toISOString()}-${text}`,
    authorName: normalizeReviewText(raw.reviewer?.displayName || raw.authorName) || 'A Google user',
    rating,
    text,
    reviewedAt: reviewedDate.toISOString(),
    displayDate: formatDisplayDate(reviewedDate)
  };
}

export function selectLatestFiveStarReviews(rawReviews, limit = REVIEW_LIMIT) {
  if (!Array.isArray(rawReviews)) {
    throw new Error('Google Business Profile response was invalid: reviews was not an array.');
  }

  const seen = new Set();

  return rawReviews
    .map(normalizeReview)
    .filter(Boolean)
    .sort((a, b) => Date.parse(b.reviewedAt) - Date.parse(a.reviewedAt))
    .filter(review => {
      const key = review.id || `${review.authorName}|${review.reviewedAt}|${review.text}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, limit);
}

export function validateReviewsPayload(payload) {
  const errors = [];

  if (!payload || typeof payload !== 'object') {
    throw new Error('Invalid Google reviews payload: payload is not an object.');
  }

  if (payload.source !== 'google_business_profile') {
    errors.push('source must be google_business_profile');
  }

  if (typeof payload.updatedAt !== 'string' || Number.isNaN(new Date(payload.updatedAt).valueOf())) {
    errors.push('updatedAt must be a valid ISO date');
  }

  if (!Array.isArray(payload.reviews)) {
    errors.push('reviews must be an array');
  } else if (payload.reviews.length === 0) {
    errors.push('reviews must contain at least one displayable review');
  } else {
    payload.reviews.forEach((review, index) => {
      if (!review || typeof review !== 'object') {
        errors.push(`reviews[${index}] must be an object`);
        return;
      }
      if (!normalizeReviewText(review.id)) errors.push(`reviews[${index}].id is required`);
      if (Number(review.rating) !== 5) errors.push(`reviews[${index}].rating must be 5`);
      if (!normalizeReviewText(review.text)) errors.push(`reviews[${index}].text is required`);
      if (Number.isNaN(new Date(review.reviewedAt).valueOf())) {
        errors.push(`reviews[${index}].reviewedAt must be a valid ISO date`);
      }
    });
  }

  if (errors.length) {
    throw new Error(`Invalid Google reviews payload: ${errors.join('; ')}.`);
  }
}

export function buildReviewsPayload(rawReviews, options = {}) {
  if (!Array.isArray(rawReviews)) {
    throw new Error('Google Business Profile response was invalid: reviews was not an array.');
  }

  if (rawReviews.length === 0) {
    throw new Error('Google Business Profile response returned no reviews; keeping existing review data unchanged.');
  }

  const payload = {
    updatedAt: new Date(options.now || Date.now()).toISOString(),
    source: 'google_business_profile',
    reviews: selectLatestFiveStarReviews(rawReviews, options.limit || REVIEW_LIMIT)
  };

  validateReviewsPayload(payload);
  return payload;
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

export function stringifyPayload(payload) {
  return `${JSON.stringify(payload, null, 2)}\n`;
}

export async function readGoogleJsonResponse(response, description) {
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    const detail = payload.error?.message || payload.error_description || payload.error || response.statusText || response.status;
    throw new Error(`${description} failed (${response.status}): ${sanitizeForLog(detail)}`);
  }

  return payload;
}

async function fetchAccessToken() {
  assertRequiredEnv(OAUTH_ENV_NAMES);

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
  const payload = await readGoogleJsonResponse(response, 'Google OAuth token refresh');

  if (!payload.access_token) {
    throw new Error('Google OAuth token refresh failed: access token was missing from the response.');
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
    const payload = await readGoogleJsonResponse(response, 'Google Business Profile reviews fetch');

    if (payload.reviews !== undefined && !Array.isArray(payload.reviews)) {
      throw new Error('Google Business Profile response was invalid: reviews was not an array.');
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

export async function readFixtureReviews(fixturePath) {
  const raw = await readFile(fixturePath, 'utf8');
  const payload = JSON.parse(raw);
  const reviews = Array.isArray(payload) ? payload : payload.reviews;

  if (!Array.isArray(reviews)) {
    throw new Error('Fixture was invalid: expected an array or an object with a reviews array.');
  }

  return reviews;
}

async function readExistingPayload(outputPath) {
  try {
    return JSON.parse(await readFile(outputPath, 'utf8'));
  } catch {
    return null;
  }
}

async function readExistingFile(outputPath) {
  try {
    return await readFile(outputPath, 'utf8');
  } catch {
    return null;
  }
}

export async function writeReviewsFile(outputPath, nextPayload) {
  const existingPayload = await readExistingPayload(outputPath);
  const payload = preserveUpdatedAtWhenReviewsUnchanged(existingPayload, nextPayload);
  validateReviewsPayload(payload);

  const json = stringifyPayload(payload);
  const existingFile = await readExistingFile(outputPath);

  if (existingFile === json) {
    console.log(`Review data unchanged; ${outputPath} was not rewritten.`);
    return { changed: false, payload };
  }

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, json, 'utf8');
  console.log(`Wrote ${outputPath} with ${payload.reviews.length} Google reviews.`);
  return { changed: true, payload };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const outputPath = resolve(args.output);

  if (!args.fixture) {
    assertRequiredEnv();
  }

  const rawReviews = args.fixture
    ? await readFixtureReviews(args.fixture)
    : await fetchGoogleBusinessReviews({
        accessToken: await fetchAccessToken(),
        parent: buildReviewParent(process.env.GBP_ACCOUNT_ID, process.env.GBP_LOCATION_ID),
        maxPages: Number(process.env.GBP_MAX_PAGES || DEFAULT_MAX_PAGES),
        pageSize: Number(process.env.GBP_PAGE_SIZE || DEFAULT_PAGE_SIZE)
      });

  const nextPayload = buildReviewsPayload(rawReviews);

  if (args.dryRun) {
    process.stdout.write(stringifyPayload(nextPayload));
    return;
  }

  await writeReviewsFile(outputPath, nextPayload);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch(error => {
    console.error(sanitizeForLog(error.message));
    process.exitCode = 1;
  });
}
