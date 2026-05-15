import { router } from './trpc';
import fieldsRouter from './routers/fields';
import operationsRouter from './routers/operations';
import overviewRouter from './routers/overview';
import schemaRouter from './routers/schema';
import securityRouter from './routers/security';

export const appRouter = router({
  fields: fieldsRouter,
  operations: operationsRouter,
  overview: overviewRouter,
  schema: schemaRouter,
  security: securityRouter,
});

export type AppRouter = typeof appRouter;

