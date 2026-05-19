import assert from 'node:assert/strict';

import {
  buildReviewParent,
  buildReviewsPayload,
  normalizeReviewText,
  preserveUpdatedAtWhenReviewsUnchanged,
  selectLatestFiveStarReviews
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
    reviewId: 'five-6',
    starRating: 'FIVE',
    comment: 'Sixth newest should be trimmed.',
    createTime: '2026-05-13T03:00:00Z',
    reviewer: { displayName: 'Sixth Guest' }
  }
];

assert.equal(buildReviewParent('123', '456'), 'accounts/123/locations/456');
assert.equal(buildReviewParent('accounts/123', 'locations/456'), 'accounts/123/locations/456');
assert.equal(buildReviewParent('', 'accounts/123/locations/456'), 'accounts/123/locations/456');
assert.equal(normalizeReviewText('  Great\n\nfood\tand service.  '), 'Great food and service.');

const reviews = selectLatestFiveStarReviews(fixture);
assert.deepEqual(reviews.map(review => review.id), ['five-1', 'five-2', 'five-3', 'five-4', 'five-5']);
assert.equal(reviews[0].authorName, 'Newest Guest');
assert.equal(reviews[0].displayDate, '18 May 2026');

const payload = buildReviewsPayload(fixture, { now: '2026-05-19T18:00:00.000Z' });
assert.equal(payload.updatedAt, '2026-05-19T18:00:00.000Z');
assert.equal(payload.source, 'google_business_profile');
assert.equal(payload.reviews.length, 5);

const preserved = preserveUpdatedAtWhenReviewsUnchanged(
  { ...payload, updatedAt: '2026-05-18T18:00:00.000Z' },
  buildReviewsPayload(fixture, { now: '2026-05-19T18:00:00.000Z' })
);
assert.equal(preserved.updatedAt, '2026-05-18T18:00:00.000Z');

const preservedNull = preserveUpdatedAtWhenReviewsUnchanged(
  { ...payload, updatedAt: null },
  buildReviewsPayload(fixture, { now: '2026-05-19T18:00:00.000Z' })
);
assert.equal(preservedNull.updatedAt, null);

console.log('Google review sync tests passed.');
