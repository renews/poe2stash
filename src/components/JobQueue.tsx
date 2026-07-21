import React from "react";
import { Job } from "../jobs/Job";
import { Jobs } from "../services/JobQueue";
import { wait } from "../utils/wait";

interface JobQueueProps {
  jobs: Job<unknown>[];
  setJobs: (jobs: Job<unknown>[]) => void;
  setErrorMessage: (message: string) => void;
}

export async function handleJob<T>(
  job: Job<T>,
  setJobs: (jobs: Job<unknown>[]) => void,
  setErrorMessage: (message: string) => void,
) {
  try {
    setErrorMessage("");
    const origDone = job.onDone;
    const origFail = job.onFail;

    job.onDone = async (progress) => {
      await origDone(progress);
      await wait(10000);
      setJobs(Jobs.getRunningJobs());
    };

    job.onFail = async (progress) => {
      await origFail(progress);
      await wait(10000);
      setJobs(Jobs.getRunningJobs());
    };

    const task = Jobs.start(job);
    setJobs(Jobs.getRunningJobs());
    await task;
  } catch (error: unknown) {
    console.error("Error price checking items:", error);
    if (job.status === "cancelled") {
      setErrorMessage("");
      return;
    }

    if (
      error &&
      typeof error === "object" &&
      "message" in error &&
      typeof error.message === "string"
    ) {
      setErrorMessage(error.message);
    } else {
      setErrorMessage(job.name + " failed. Sorry about that");
    }
  }
}

export const JobQueue: React.FC<JobQueueProps> = ({
  jobs,
  setJobs,
  setErrorMessage,
}) => {
  const handleCancel = (jobId: string) => {
    Jobs.cancelJob(jobId);
    setErrorMessage("");
    setJobs(Jobs.getRunningJobs());
  };

  return (
    <section className="job-queue surface-card" aria-labelledby="job-queue-title">
      <header className="job-queue__header">
        <div>
          <p className="page-eyebrow">Background activity</p>
          <h2 id="job-queue-title">Job queue</h2>
        </div>
        <span className="job-queue__count">
          {jobs.length} {jobs.length === 1 ? "active task" : "active tasks"}
        </span>
      </header>
      {jobs.length === 0 ? (
        <p className="text-gray-300">No active jobs</p>
      ) : (
        <div className="job-queue__list">
          {jobs.map((job) => (
            <article key={job.id} className="job-card">
              <div className="job-card__heading">
                <div>
                  <h3>{job.name}</h3>
                  <span className="job-card__status">{job.status}</span>
                </div>
                <button
                  type="button"
                  onClick={() => handleCancel(job.id)}
                  aria-label={`Cancel ${job.name}`}
                  className="app-button app-button--danger compact-action"
                >
                  Cancel
                </button>
              </div>
              <p className="job-card__description">{job.description}</p>
              {job.error && (
                <p role="alert" className="job-card__error">
                  {job.error}
                </p>
              )}
              <div className="job-card__meta">
                <span>Status: {job.status}</span>
                {job.currentProgress && (
                  <span>
                    Progress: {job.currentProgress.current} /{" "}
                    {job.currentProgress.total}
                  </span>
                )}
              </div>
              {job.currentProgress && (
                <div
                  className="job-progress"
                  role="progressbar"
                  aria-label={`${job.name} progress`}
                  aria-valuemin={0}
                  aria-valuemax={job.currentProgress.total}
                  aria-valuenow={job.currentProgress.current}
                >
                  <span
                    style={{
                      width: `${(job.currentProgress.current / job.currentProgress.total) * 100}%`,
                    }}
                  />
                </div>
              )}
            </article>
          ))}
        </div>
      )}
    </section>
  );
};
