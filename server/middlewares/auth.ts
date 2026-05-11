import { Request, Response, NextFunction } from "express";
import * as Sentry from "@sentry/node";

export const protect = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { userId } = req.auth();

    //clerkMiddleware() in server.ts ran before this? It decoded the JWT and attached an .auth() method to req. So req.auth() returns something like:
    // If logged in:
    // { userId: "user_2abc123xyz", sessionId: "sess_xyz", ... }

    //  If not logged in:
    // {
    //   userId: null;
    // }

    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    next();
    
  } catch (error: any) {
    Sentry.captureException(error);

    // Auth-specific errors → 401
    if (error.code === "ERR_JWT_EXPIRED" || error.status === 401) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    // Everything else → 500 (server error)
    res.status(500).json({ message: "Internal server error" });
  }
};
