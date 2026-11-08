import type express from 'express';
import type { DatabaseSync } from 'node:sqlite';
import { openDatabase } from '../storage/database.js';
import { UploadStore } from '../uploads/upload-store.js';
import { createMediaRouter, createUploadRouter } from '../uploads/upload-router.js';
import { EventStore } from '../events/event-store.js';
import { DestinationStore } from '../events/destinations.js';
import { DeliveryWorker } from '../events/delivery.js';
import { createMetaWebhookRouter } from '../webhooks/meta-webhook-router.js';
import type { InstagramDeps } from '../tools/instagram/index.js';

export type InstagramRuntime = {
  deps: InstagramDeps;
  db: DatabaseSync;
  publicRoutes: express.Router[];
  protectedRoutes: express.Router[];
  start(): void;
  stop(): Promise<void>;
};

const DELIVERY_TICK_MS = 5_000;
const UPLOAD_PURGE_MS = 15 * 60_000;
const EVENT_PURGE_MS = 24 * 3_600_000;
const EVENT_RETENTION_DAYS = 90;

export function createInstagramRuntime(cfg: {
  dataDir: string; publicBaseUrl: string; appSecret?: string; verifyToken?: string;
}): InstagramRuntime {
  const db = openDatabase(cfg.dataDir);
  const uploads = new UploadStore({ db, dataDir: cfg.dataDir, publicBaseUrl: cfg.publicBaseUrl });
  const events = new EventStore(db);
  const destinations = new DestinationStore(db);
  const delivery = new DeliveryWorker({ db, destinations, events, log: (line) => console.error(`[webhooks] ${line}`) });
  const timers: NodeJS.Timeout[] = [];
  let stopped = false;

  const webhook = createMetaWebhookRouter({
    verifyToken: cfg.verifyToken,
    appSecret: cfg.appSecret,
    events,
    onEventStored: (event) => { delivery.enqueue(event); },
  });

  return {
    deps: { uploads, events, destinations, delivery },
    db,
    publicRoutes: [webhook, createMediaRouter(uploads)],
    protectedRoutes: [createUploadRouter(uploads)],
    start() {
      if (stopped || timers.length > 0) return;
      delivery.start(DELIVERY_TICK_MS);
      const run = (fn: () => unknown) => {
        try {
          void Promise.resolve(fn()).catch((error: unknown) => console.error('[instagram] tarefa periódica falhou', error));
        } catch (error) {
          console.error('[instagram] tarefa periódica falhou', error);
        }
      };
      // Roda já na subida (o intervalo de eventos é de 24 h) e depois periodicamente.
      const every = (ms: number, fn: () => unknown) => {
        run(fn);
        const timer = setInterval(() => run(fn), ms);
        timer.unref();
        timers.push(timer);
      };
      every(UPLOAD_PURGE_MS, () => uploads.purgeExpired());
      every(EVENT_PURGE_MS, () => events.purgeSeen(EVENT_RETENTION_DAYS));
    },
    async stop() {
      if (stopped) return;
      stopped = true;
      for (const timer of timers) clearInterval(timer);
      timers.length = 0;
      delivery.stop();
      db.close();
    },
  };
}
