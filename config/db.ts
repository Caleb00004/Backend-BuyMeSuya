import mongoose from "mongoose"

const connectDB = async () => {
    // console.log(process.env)
   const MONGO_URI =
    process.env.NODE_ENV === "production"
      ? process.env.MONGO_URI
      : "mongodb://0.0.0.0:27017"; // inline dev URI

    if (!MONGO_URI) {
        throw new Error("❌ MONGO_URI is not defined in environment variables.");
    }

    try {
        const conn = await mongoose.connect(MONGO_URI);

       console.log(`✅ MongoDB Connected: ${conn.connection.host}`);
    } catch (error: any) {
        console.log(error)
        console.log(`erro occured: ${error.message}`)
        process.exit()
    } 
}

export default connectDB;