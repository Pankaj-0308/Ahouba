const mongoose = require("mongoose");

const tripSchema = new mongoose.Schema(
  {
    originLat: { type: Number, required: true },
    originLng: { type: Number, required: true },
    destinationText: { type: String, required: true },
    destinationLat: { type: Number, required: true },
    destinationLng: { type: Number, required: true },
    profile: { type: String, required: true },
    distanceM: { type: Number, required: true },
    durationS: { type: Number, required: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Trip", tripSchema);
