import type { Job } from "bullmq";
import { getIngestInboundQueue } from "../src/queue/queues";

async function main() {
  const queue = getIngestInboundQueue();

  const failed = await queue.getFailed();
  console.log("Failed jobs:", failed.map((j: Job) => ({ id: j.id, failedReason: j.failedReason })));

  const waiting = await queue.getWaiting();
  console.log("Waiting jobs:", waiting.map((j: Job) => j.id));

  const completed = await queue.getCompleted();
  console.log("Completed jobs count:", completed.length);
  if (completed.length > 0) {
    console.log("Latest completed:", completed[completed.length - 1]?.id);
  }

  const active = await queue.getActive();
  console.log("Active jobs:", active.map((j: Job) => j.id));

  await queue.close();
}

main().catch(console.error);
