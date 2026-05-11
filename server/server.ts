import "./configs/instrument.mjs"
import "dotenv/config";
import express, { Request, Response } from 'express';
import cors from "cors";
import { clerkMiddleware } from '@clerk/express'
import clerkWebhooks from "./controllers/clerk.js";
import * as Sentry from "@sentry/node";
import userRouter from "./routes/userRoutes.js";
import projectRouter from "./routes/projectRoutes.js";


const app = express();

// Middleware
app.use(cors())

app.post('/api/clerk', express.raw({ type: 'application/json' }), clerkWebhooks)

app.use(express.json());
app.use(clerkMiddleware())        // Reads the Authorization: Bearer <jwt> header on every request and decodes it. After this middleware runs, every request object has an .auth() method. That's why in auth.ts we can call req.auth() to get the userId.
// It doesn't block unauthenticated requests — it just attaches auth info if present. The actual blocking happens in protect middleware.

const PORT = process.env.PORT || 5000;


app.get('/', (req: Request, res: Response) => {
    res.send('Server is Live!');
});

app.get("/debug-sentry", function mainHandler(req, res) {
  throw new Error("My first Sentry error!");
});


app.use('/api/user', userRouter)
app.use('/api/project', projectRouter)

// The error handler must be registered before any other error middleware and after all controllers
Sentry.setupExpressErrorHandler(app);  // This registers a special Express error handler. In Express, error handlers must come after all routes. When any route throws an unhandled error, Express passes it to this handler, which sends it to Sentry's servers.

app.listen(PORT, () => {
    console.log(`Server is running at http://localhost:${PORT}`);
});