import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  assertRequiredEnv,
  buildReviewParent,
  buildReviewsPayload,
  normalizeReviewText,
  preserveUpdatedAtWhenReviewsUnchanged,
  readGoogleJsonResponse,
  sanitizeForLog,
  selectLatestFiveStarReviews,
  stringifyPayload,
  writeReviewsFile
} from './sync-google-reviews.mjs';

const fixture = [
  {
    reviewId: 'latest-empty',
    starRating: 'FIVE',
    comment: '   ',
    createTime: '2026-05-20T03:00:00Z',
    reviewer: { displayName: 'Empty Comment' }
  },
  {
    reviewId: 'latest-four-star',
    starRating: 'FOUR',
    comment: 'Lovely, but this should not display.',
    createTime: '2026-05-19T03:00:00Z',
    reviewer: { displayName: 'Four Star' }
  },
  {
    reviewId: 'five-1',
    starRating: 'FIVE',
    comment: 'Newest five star with text.',
    createTime: '2026-05-18T03:00:00Z',
    reviewer: { displayName: 'Newest Guest' }
  },
  {
    reviewId: 'old-edited',
    starRating: 'FIVE',
    comment: 'Old review edited recently, but createTime keeps it older.',
    createTime: '2026-04-01T03:00:00Z',
    updateTime: '2026-05-19T03:00:00Z',
    reviewer: { displayName: 'Old Edited' }
  },
  {
    reviewId: 'five-2',
    starRating: 'FIVE',
    comment: 'Second newest.',
    createTime: '2026-05-17T03:00:00Z',
    reviewer: { displayName: 'Second Guest' }
  },
  {
    reviewId: 'five-3',
    starRating: 'FIVE',
    comment: 'Third newest.',
    createTime: '2026-05-16T03:00:00Z',
    reviewer: { displayName: 'Third Guest' }
  },
  {
    reviewId: 'five-4',
    starRating: 'FIVE',
    comment: 'Fourth newest.',
    createTime: '2026-05-15T03:00:00Z',
    reviewer: { displayName: 'Fourth Guest' }
  },
  {
    reviewId: 'five-5',
    starRating: 'FIVE',
    comment: 'Fifth newest.',
    createTime: '2026-05-14T03:00:00Z',
    reviewer: { displayName: 'Fifth Guest' }
  },
  {
    reviewId: 'five-5',
    starRating: 'FIVE',
    comment: 'Duplicate should be removed.',
    createTime: '2026-05-14T04:00:00Z',
    reviewer: { displayName: 'Duplicate Guest' }
  },
  {
    reviewId: 'five-6',
    starRating: 'FIVE',
    comment: 'Sixth newest should be trimmed.',
    createTime: '2026-05-13T03:00:00Z',
    reviewer: { displayName: 'Sixth Guest' }
  },
  {
    reviewId: 'missing-author',
    starRating: 'FIVE',
    comment: 'Missing author still has a safe fallback.',
    createTime: '2026-05-12T03:00:00Z'
  }
];

const expectedParent = ['accounts', '123', 'locations', '456'].join('/');
assert.equal(buildReviewParent('123', '456'), expectedParent);
assert.equal(buildReviewParent(['accounts', '123'].join('/'), ['locations', '456'].join('/')), expectedParent);
assert.equal(buildReviewParent('', expectedParent), expectedParent);
assert.equal(normalizeReviewText('  Great\n\nfood\tand service.  '), 'Great food and service.');

assert.throws(
  () => assertRequiredEnv(['GOOGLE_CLIENT_ID'], { GOOGLE_CLIENT_ID: '' }),
  /GOOGLE_CLIENT_ID/
);

const reviews = selectLatestFiveStarReviews(fixture);
assert.deepEqual(reviews.map(review => review.id), ['five-1', 'five-2', 'five-3', 'five-4', 'five-5']);
assert.equal(reviews[0].authorName, 'Newest Guest');
assert.equal(reviews[0].displayDate, '18 May 2026');
assert.equal(new Set(reviews.map(review => review.id)).size, reviews.length);

const fallbackAuthorReview = selectLatestFiveStarReviews([fixture.at(-1)])[0];
assert.equal(fallbackAuthorReview.authorName, 'A Google user');

const payload = buildReviewsPayload(fixture, { now: '2026-05-19T18:00:00.000Z' });
assert.equal(payload.updatedAt, '2026-05-19T18:00:00.000Z');
assert.equal(payload.source, 'google_business_profile');
assert.equal(payload.reviews.length, 5);

const preserved = preserveUpdatedAtWhenReviewsUnchanged(
  { ...payload, updatedAt: '2026-05-18T18:00:00.000Z' },
  buildReviewsPayload(fixture, { now: '2026-05-19T18:00:00.000Z' })
);
assert.equal(preserved.updatedAt, '2026-05-18T18:00:00.000Z');

assert.throws(() => buildReviewsPayload([]), /returned no reviews/);
assert.throws(() => buildReviewsPayload({ reviews: [] }), /reviews was not an array/);
assert.throws(
  () => buildReviewsPayload([{ reviewId: 'only-four', starRating: 'FOUR', comment: 'Nice.', createTime: '2026-05-18T03:00:00Z' }]),
  /at least one displayable review/
);

const sampleGooglePath = ['accounts', '123', 'locations', '456'].join('/');
const sampleAccessToken = ['ya29', 'sample-token'].join('.');
const apiFailure = new Response(
  JSON.stringify({
    error: {
      message: `Request failed for ${sampleGooglePath} using token ${sampleAccessToken}`
    }
  }),
  { status: 403, headers: { 'content-type': 'application/json' } }
);
await assert.rejects(
  () => readGoogleJsonResponse(apiFailure, 'Google Business Profile reviews fetch'),
  /accounts\/\[redacted\]\/locations\/\[redacted\].*\[redacted-token\]/
);
assert.equal(
  sanitizeForLog(`${['client_secret', 'value'].join('=')}&${['refresh_token', 'value'].join('=')}`),
  'client_secret=[redacted]&refresh_token=[redacted]'
);

const tmpDir = await mkdtemp(join(tmpdir(), 'reviews-sync-'));
try {
  const outputPath = join(tmpDir, 'reviews.json');
  await writeFile(outputPath, stringifyPayload(payload), 'utf8');
  const noChange = await writeReviewsFile(outputPath, buildReviewsPayload(fixture, { now: '2026-05-20T18:00:00.000Z' }));
  assert.equal(noChange.changed, false);
  assert.equal(await readFile(outputPath, 'utf8'), stringifyPayload(payload));

  const changedPayload = buildReviewsPayload([
    {
      reviewId: 'new-review',
      starRating: 'FIVE',
      comment: 'A new review should update the generated data.',
      createTime: '2026-06-01T03:00:00Z',
      reviewer: { displayName: 'New Guest' }
    },
    ...fixture
  ], { now: '2026-06-01T18:00:00.000Z' });
  const changed = await writeReviewsFile(outputPath, changedPayload);
  assert.equal(changed.changed, true);
  const saved = JSON.parse(await readFile(outputPath, 'utf8'));
  assert.equal(saved.reviews[0].id, 'new-review');
} finally {
  await rm(tmpDir, { recursive: true, force: true });
}

console.log('Google review sync tests passed.');
