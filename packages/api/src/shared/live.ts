/* Live sessions push whole snapshots. Subscribers re-render from the snapshot; nothing is patched in the UI. */

export type Unsubscribe = () => void;


export interface LiveStore<S> {
  getSnapshot(): S;
  subscribe(listener: () => void): Unsubscribe;
}
