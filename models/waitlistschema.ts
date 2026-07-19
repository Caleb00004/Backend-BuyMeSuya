import mongoose, { Schema, Document } from "mongoose";

export interface IWaitlist extends Document {
  email: string;
  createdAt: Date;
}

const waitlistSchema = new Schema<IWaitlist>({
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  createdAt: { type: Date, default: Date.now },
});

waitlistSchema.index({ createdAt: -1 });

const Waitlist = mongoose.model<IWaitlist>("Waitlist", waitlistSchema);

export default Waitlist;
