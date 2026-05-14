import { router } from './trpc';
import fieldsRouter from './routers/fields';
import operationsRouter from './routers/operations';
import overviewRouter from './routers/overview';

export const appRouter = router({
  fields: fieldsRouter,
  operations: operationsRouter,
  overview: overviewRouter,
});

export type AppRouter = typeof appRouter;

