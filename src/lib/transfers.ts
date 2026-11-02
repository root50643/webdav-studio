import type { Progress, TransferTask } from '../types';

type Runner = (signal: AbortSignal, progress: (p: Progress) => void) => Promise<void>;
interface Job {
  task: TransferTask;
  run: Runner;
  controller?: AbortController;
}

export class TransferQueue {
  private jobs: Job[] = [];
  private epoch = 0;
  constructor(
    private changed: (tasks: TransferTask[]) => void,
    private concurrency = 2,
  ) {}

  add(name: string, direction: TransferTask['direction'], run: Runner, total?: number): string {
    const task: TransferTask = {
      id: crypto.randomUUID(),
      name,
      direction,
      state: 'queued',
      loaded: 0,
      total,
    };
    this.jobs.push({ task, run });
    this.emit();
    this.pump();
    return task.id;
  }

  cancel(id: string): void {
    const job = this.jobs.find((j) => j.task.id === id);
    if (!job || !['queued', 'running'].includes(job.task.state)) return;
    job.task = { ...job.task, state: 'cancelled', message: '已取消' };
    job.controller?.abort();
    this.emit();
    this.pump();
  }

  retry(id: string): void {
    const job = this.jobs.find((j) => j.task.id === id);
    if (!job || !['error', 'cancelled'].includes(job.task.state) || job.controller) return;
    job.task = { ...job.task, state: 'queued', loaded: 0, message: undefined };
    this.emit();
    this.pump();
  }

  clearFinished(): void {
    this.jobs = this.jobs.filter(
      (j) => ['queued', 'running'].includes(j.task.state) || j.controller,
    );
    this.emit();
  }

  reset(): void {
    this.epoch++;
    this.jobs.forEach((j) => j.controller?.abort());
    this.jobs = [];
    this.emit();
  }

  private emit(): void {
    this.changed(this.jobs.map((j) => ({ ...j.task })));
  }

  private pump(): void {
    const running = this.jobs.filter((j) => j.controller).length;
    const available = Math.max(0, this.concurrency - running);
    this.jobs
      .filter((j) => j.task.state === 'queued')
      .slice(0, available)
      .forEach((job) => {
        void this.start(job);
      });
  }

  private async start(job: Job): Promise<void> {
    const epoch = this.epoch;
    const controller = new AbortController();
    job.controller = controller;
    job.task.state = 'running';
    this.emit();
    try {
      await job.run(controller.signal, (progress) => {
        if (epoch !== this.epoch || controller.signal.aborted) return;
        job.task = { ...job.task, ...progress };
        this.emit();
      });
      if (!controller.signal.aborted) job.task = { ...job.task, state: 'done' };
    } catch (error) {
      job.task = {
        ...job.task,
        state: controller.signal.aborted ? 'cancelled' : 'error',
        message: controller.signal.aborted
          ? '已取消'
          : error instanceof Error
            ? error.message
            : '傳輸失敗',
      };
    } finally {
      job.controller = undefined;
      if (epoch === this.epoch) {
        this.emit();
        this.pump();
      }
    }
  }
}
