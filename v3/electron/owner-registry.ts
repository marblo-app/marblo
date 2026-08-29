/**
 * Multi-owner registry: key → the set of windows (webContents ids) that hold it.
 *
 * Both PTY sessions and orchestrator instances used to be tracked as
 * `Map<key, number>` — a SINGLE owner. That made every registration an
 * implicit STEAL: opening the same project in a second window silently
 * reassigned ownership, and the first window's terminal went dead with no
 * error. Worse, ownership also drove stop()/status routing, so the
 * dispossessed window's recovery calls resolved to nothing and became no-ops.
 *
 * Ownership here is ADDITIVE and windows are removed individually, so a
 * resource outlives any one window that shows it. Extracted from main.ts so
 * the "close one window, the other keeps receiving output" rule is unit
 * testable — main.ts itself cannot be imported outside Electron.
 */
export class OwnerRegistry<K> {
  private readonly owners = new Map<K, Set<number>>();

  /** Register `senderId` as an owner. Never displaces existing owners. */
  add(key: K, senderId: number): void {
    const existing = this.owners.get(key);
    if (existing) existing.add(senderId);
    else this.owners.set(key, new Set([senderId]));
  }

  /** Owners of `key`, or undefined when untracked. */
  ownersOf(key: K): ReadonlySet<number> | undefined {
    return this.owners.get(key);
  }

  /** True when `senderId` is one of `key`'s owners. */
  has(key: K, senderId: number): boolean {
    return this.owners.get(key)?.has(senderId) ?? false;
  }

  /** True when `key` is tracked and still has at least one owner. */
  isOwned(key: K): boolean {
    const owners = this.owners.get(key);
    return owners !== undefined && owners.size > 0;
  }

  /** Drop the key entirely (the underlying resource died, or was stopped). */
  delete(key: K): void {
    this.owners.delete(key);
  }

  /** Drop every owner mapping at once. Used by account-scope teardown. */
  clear(): void {
    this.owners.clear();
  }

  /** Keys `senderId` currently owns. */
  keysOwnedBy(senderId: number): K[] {
    const owned: K[] = [];
    for (const [key, owners] of this.owners) {
      if (owners.has(senderId)) owned.push(key);
    }
    return owned;
  }

  /**
   * Remove one window from every key it owns — the window-closed path.
   *
   * Returns ONLY the keys that lost their last owner. Keys still held by
   * another window are absent from the result, which is the whole point: the
   * caller must not tear those resources down. The orphaned keys are NOT
   * deleted here; the caller decides whether an ownerless resource should be
   * dropped, kept for reattach, or reclaimed on a timer.
   */
  removeWindow(senderId: number): K[] {
    const orphaned: K[] = [];
    for (const [key, owners] of this.owners) {
      if (!owners.delete(senderId)) continue;
      if (owners.size === 0) orphaned.push(key);
    }
    return orphaned;
  }

  entries(): IterableIterator<[K, Set<number>]> {
    return this.owners.entries();
  }
}
