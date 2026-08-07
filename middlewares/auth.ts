import jwt from "jsonwebtoken";
import { Request, Response, NextFunction } from "express";

type AuthRequest = Request & { cookies?: { [key: string]: any }; user?: any };

export const auth = (req: AuthRequest, res: Response, next: NextFunction) => {
    const token = req.cookies?.accessToken;

    if (!token) {
        return res.sendStatus(401);
    }

    try {
        const secret = process.env.ACCESS_SECRET as string;
        const payload = jwt.verify(token, secret);

        req.user = payload;

        next();
    } catch (err) {
        return res.sendStatus(401);
    }
};

