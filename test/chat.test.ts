import { expect, test } from "bun:test";
import express from "express";
import { chatRouter } from "../electron/app/routes/chat";

test("returns no offers before a chat log is configured", async () => {
  const app = express();
  app.use("/chat", chatRouter);

  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));

  try {
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    const response = await fetch(`http://127.0.0.1:${port}/chat/offers`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([]);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
