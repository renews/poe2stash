export interface Progress<T> {
  total: number;
  current: number;
  data: T;
}

export type JobStatus = "idle" | "running" | "done" | "failed" | "cancelled";

export abstract class Job<T> {
  private requestAbortController = new AbortController();
  result: Promise<T> | null = null;
  cancelling = false;
  currentProgress: Progress<T> | null = null;
  status = "idle" as JobStatus;
  error = "";

  constructor(
    public id: string,
    public name: string,
    public description: string,
  ) {}

  abstract _task(): AsyncGenerator<Progress<T>>;

  protected get signal() {
    return this.requestAbortController.signal;
  }

  cancel() {
    this.status = "cancelled";
    this.cancelling = true;
    this.requestAbortController.abort();
    void this.onCancel().catch((error) =>
      console.error("Job cancellation handler failed", error),
    );
  }

  async start(): Promise<T> {
    this.result = this.run();
    return this.result;
  }

  private async run(): Promise<T> {
    console.log("Starting job", this.id);
    this.status = "running";
    this.cancelling = false;
    this.requestAbortController = new AbortController();

    try {
      const task = this._task();

      for await (const value of task) {
        this.currentProgress = value;
        await this.onStep(value);

        if (this.cancelling) {
          throw { message: "Job was cancelled", progress: value };
        }
      }

      if (!this.currentProgress) {
        throw new Error(this.error || "No progress was made");
      }

      this.status = "done";
      const progress = this.currentProgress;
      void this.onDone(progress).catch((error) =>
        console.error("Job completion handler failed", error),
      );
      return progress.data;
    } catch (error: unknown) {
      this.status = this.cancelling ? "cancelled" : "failed";
      this.error = this.error || getJobErrorMessage(error);
      void this.onFail(error).catch((handlerError) =>
        console.error("Job failure handler failed", handlerError),
      );
      throw error;
    }
  }

  async onStep(progress: Progress<T>) {
    void progress;
  }

  async onDone(progress: Progress<T>) {
    void progress;
  }

  async onFail(error: unknown) {
    void error;
  }

  async onCancel() {}
}

function getJobErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  if (
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message;
  }

  return "Job failed";
}
