const mongoose = require("mongoose");

/** Periodic client-reported GPS fixes (e.g. every 30 minutes while the app is open). */
const locationLogSchema = new mongoose.Schema(
  {
    lat: { type: Number, required: true },
    lng: { type: Number, required: true },
    accuracyM: { type: Number },
    /** Optional label from client, e.g. "web" */
    source: { type: String, default: "web" },
  },
  { timestamps: true }
);

locationLogSchema.index({ createdAt: -1 });

module.exports = mongoose.model("LocationLog", locationLogSchema);
