const mongoose = require("mongoose");

/**
 * Latest location per blind user (upserted on each ping).
 * Shape: personUserId, lat, lng, timestamp, isOnline, createdAt, updatedAt
 */
const personLocationSchema = new mongoose.Schema(
  {
    personUserId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      unique: true,
    },
    lat: { type: Number, required: true },
    lng: { type: Number, required: true },
    /** Client-reported fix time (ISO). */
    timestamp: { type: Date, required: true },
    isOnline: { type: Boolean, default: true },
  },
  { timestamps: true }
);

personLocationSchema.index({ personUserId: 1 }, { unique: true });
personLocationSchema.index({ updatedAt: -1 });

module.exports = mongoose.model("PersonLocation", personLocationSchema, "person_locations");
