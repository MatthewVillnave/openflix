import { expect, it } from 'vitest';
import { queueArtwork } from '../apps/web/src/artwork-queue.js';
it('bounds image work and starts queued images after completion, cancelling abandoned entries', () => {
  const finished: (() => void)[] = [];
  const started: number[] = [];
  const cancel = Array.from({ length: 5 }, (_, index) =>
    queueArtwork((done) => {
      started.push(index);
      finished.push(done);
    }),
  );
  expect(started).toEqual([0, 1, 2]);
  cancel[3]!();
  finished[0]!();
  expect(started).toEqual([0, 1, 2, 4]);
  for (const stop of cancel) stop();
  let next = false;
  const stop = queueArtwork((done) => {
    next = true;
    done();
  });
  stop();
  expect(next).toBe(true);
});
