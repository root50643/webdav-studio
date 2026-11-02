import { describe, expect, it, vi } from 'vitest';
import { TransferQueue } from './transfers';
import type { TransferTask } from '../types';

describe('transfer lifecycle', () => {
  it('cancels queued work without executing it and starts the next job after cancellation', async () => {
    let tasks: TransferTask[] = [];
    const queue = new TransferQueue((next) => {
      tasks = next;
    }, 1);
    const first = queue.add(
      'first',
      'upload',
      (signal) =>
        new Promise((_, reject) =>
          signal.addEventListener('abort', () => reject(new Error('aborted'))),
        ),
    );
    const skipped = vi.fn(async () => {});
    const second = queue.add('second', 'upload', skipped);
    const third = vi.fn(async () => {});
    queue.add('third', 'upload', third);
    queue.cancel(second);
    queue.cancel(first);
    await vi.waitFor(() => expect(third).toHaveBeenCalledOnce());
    expect(skipped).not.toHaveBeenCalled();
    expect(tasks.find((task) => task.id === first)?.state).toBe('cancelled');
    expect(tasks.find((task) => task.id === second)?.state).toBe('cancelled');
  });
  it('ignores old-host progress and completion after reset', async () => {
    let tasks: TransferTask[] = [];
    let finish!: () => void;
    let progress!: (p: { loaded: number }) => void;
    const queue = new TransferQueue((next) => {
      tasks = next;
    });
    queue.add('old-host', 'download', async (_signal, update) => {
      progress = update;
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
    });
    queue.reset();
    queue.add('new-host', 'download', async () => {});
    progress({ loaded: 999 });
    finish();
    await vi.waitFor(() => expect(tasks[0].state).toBe('done'));
    expect(tasks).toHaveLength(1);
    expect(tasks[0].name).toBe('new-host');
    expect(tasks[0].loaded).toBe(0);
  });
  it('supports manual retry after failure', async () => {
    let tasks: TransferTask[] = [];
    const run = vi.fn().mockRejectedValueOnce(new Error('network')).mockResolvedValue(undefined);
    const queue = new TransferQueue((next) => {
      tasks = next;
    });
    const id = queue.add('retry', 'upload', run);
    await vi.waitFor(() => expect(tasks[0].state).toBe('error'));
    queue.retry(id);
    await vi.waitFor(() => expect(tasks[0].state).toBe('done'));
    expect(run).toHaveBeenCalledTimes(2);
  });
});
