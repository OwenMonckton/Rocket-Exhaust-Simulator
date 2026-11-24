/** How a moment since ignition reads in the log: T+00:07. Before the first ignition there is no clock. */
export function stamp(secondsSinceIgnition: number | null): string {
  if (secondsSinceIgnition === null) return 'STANDBY';
  const s = Math.max(0, Math.floor(secondsSinceIgnition));
  const mm = String(Math.floor(s / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `T+${mm}:${ss}`;
}

export type LogKind = 'note' | 'fire' | 'warn' | 'fail';

export interface TestLog {
  /** Write a line, stamped with the time since ignition */
  add(text: string, kind?: LogKind): void;
  /** Start the clock: the engine has just lit */
  ignite(): void;
  /** Clear the log and stop the clock, for a new engine on the stand */
  reset(): void;
}

const KEEP = 40;

/** The running record of a test: ignition, full power, what the nozzle does, and how it ends. */
export function createTestLog(list: HTMLElement, now: () => number = () => performance.now()): TestLog {
  let t0: number | null = null;
  return {
    add(text, kind = 'note') {
      const li = document.createElement('li');
      li.dataset.kind = kind;
      const time = document.createElement('time');
      time.textContent = stamp(t0 === null ? null : (now() - t0) / 1000);
      const body = document.createElement('span');
      body.textContent = text;
      li.append(time, body);
      list.append(li);
      while (list.children.length > KEEP) list.firstElementChild!.remove();
      list.scrollTop = list.scrollHeight;
    },
    ignite() {
      t0 = now();
    },
    reset() {
      t0 = null;
      list.replaceChildren();
    },
  };
}
