import express, { Request, Response } from "express";
import morgan from "morgan";
import dotenv from "dotenv";
import connectDB from "./config/db";
import rateLimit from "express-rate-limit";
import cors from "cors";
import waitlistRoutes from "./routes/waitlistRoutes";

dotenv.config();

console.log("Mongo URI loaded:", process.env.MONGO_URI ? "yes" : "MISSING");

// Allow localhost in dev, only your frontend URL in prod
const allowedOrigins =
  process.env.NODE_ENV === "production"
    ? ["https://buy-me-suya.vercel.app",] // ✅ production domain
    : ["http://localhost:3000", "http://localhost:3001"]; // ✅ dev frontend

const app = express();
const PORT = 3000;

// Trust the first proxy hop so express-rate-limit sees the real client IP
// (X-Forwarded-For) instead of the proxy's internal IP — without this, all
// users share one IP and one spammer can block everyone.
app.set("trust proxy", 1);

(async () => {
  try {
    // Connect to the database
    await connectDB();

    // Start the server
    app.listen(PORT, () => {
        console.log(`Server is running on http://localhost:${PORT}`);
    });

  } catch (error) {
    console.error('Error starting the server:', error);
    process.exit(1);
  }
})();

// Use Morgan middleware (predefined format 'dev')
app.use(morgan("dev"));

// CORS must run before the rate limiter so that 429 responses still carry
// Access-Control-Allow-Origin — otherwise the browser misreads a rate-limit
// block as a CORS error.
app.use(cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true); // allow non-browser tools like Postman
      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
}))

// Enable JSON parsing for incoming requests
app.use(express.json());


// Apply rate limiting to ALL requests (per real client IP — requires trust proxy above).
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200,
  message: { error: "Too many requests, please try again later." },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use(globalLimiter);

// Define a simple GET route
app.get('/', (req, res) => {
    res.send('Hello World!');
});

app.use("/api/waitlist", waitlistRoutes)

app.get('/healthz', async (req, res) => {
  return res.sendStatus(200);
});


