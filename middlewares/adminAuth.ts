import { Request, Response, NextFunction } from "express";

export function adminAuth(req: Request, res: Response, next: NextFunction): void {
    const key = req.headers['x-admin-key'];
    if (!key || key !== process.env.ADMIN_API_KEY) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
    }
    next();
}