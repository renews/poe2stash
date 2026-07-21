import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { JobQueue } from "../src/components/JobQueue";
import { Job, Progress } from "../src/jobs/Job";

class TestJob extends Job<number> {
  async *_task(): AsyncGenerator<Progress<number>> {
    yield { current: 2, total: 4, data: 2 };
  }
}

test("presents each queued job as an accessible progress task", () => {
  const job = new TestJob(
    "sync-public-stash",
    "Sync public stash",
    "Scanning public listings",
  );
  job.status = "running";
  job.currentProgress = { current: 2, total: 4, data: 2 };

  const markup = renderToStaticMarkup(
    createElement(JobQueue, {
      jobs: [job],
      setJobs: () => {},
      setErrorMessage: () => {},
    }),
  );

  expect(markup).toContain('aria-labelledby="job-queue-title"');
  expect(markup).toContain("1 active task");
  expect(markup).toContain("Status: running");
  expect(markup).toContain("Progress: 2 / 4");
  expect(markup).toContain('role="progressbar"');
  expect(markup).toContain('aria-label="Sync public stash progress"');
  expect(markup).toContain('aria-valuemin="0"');
  expect(markup).toContain('aria-valuemax="4"');
  expect(markup).toContain('aria-valuenow="2"');
  expect(markup).toContain('aria-label="Cancel Sync public stash"');
});
