import { Pool } from "pg";

const POSTGRES_URI =
  process.env.NODE_ENV === "production"
    ? process.env.POSTGRES_URI
    : "postgres://postgres:postgres@localhost:5432/buymesuya"; // inline dev URI

if (!POSTGRES_URI) {
  throw new Error("❌ POSTGRES_URI is not defined in environment variables.");
}

const pool = new Pool({
  connectionString: POSTGRES_URI,
});

const connectDB = async () => {
  try {
    const client = await pool.connect();
    const result = await client.query("SELECT NOW()");
    client.release();

    console.log(`✅ PostgreSQL Connected: ${result.rows[0].now}`);
  } catch (error: any) {
    console.log(error);
    console.log(`error occured: ${error.message}`);
    process.exit();
  }
};

export { pool };
export default connectDB;