/** Bound in-flight image elements across visible shelves. No credentials or image cache. */
let active = 0;
const waiting: Array<() => void> = [];
function drain() {
  while (active < 3 && waiting.length) waiting.shift()!();
}
export function queueArtwork(start: (finish: () => void) => void): () => void {
  let running = false,
    cancelled = false;
  const finish = () => {
    if (!running) return;
    running = false;
    active--;
    drain();
  };
  const run = () => {
    if (cancelled) return;
    running = true;
    active++;
    start(finish);
  };
  waiting.push(run);
  drain();
  return () => {
    cancelled = true;
    const index = waiting.indexOf(run);
    if (index >= 0) waiting.splice(index, 1);
    finish();
  };
}
