const express = require("express");
const mongoose = require("mongoose");
const LocationLog = require("../models/LocationLog");

const router = express.Router();

function dbReady() {
  return mongoose.connection.readyState === 1;
}

router.post("/", async (req, res) => {
  if (!dbReady()) {
    return res.status(503).json({ error: "Database unavailable" });
  }
  try {
    const { lat, lng, accuracy, source } = req.body;
    if (typeof lat !== "number" || typeof lng !== "number" || Number.isNaN(lat) || Number.isNaN(lng)) {
      return res.status(400).json({ error: "lat and lng must be numbers" });
    }
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      return res.status(400).json({ error: "lat/lng out of range" });
    }

    const doc = await LocationLog.create({
      lat,
      lng,
      accuracyM: typeof accuracy === "number" && !Number.isNaN(accuracy) ? accuracy : undefined,
      source: typeof source === "string" ? source.slice(0, 64) : "web",
    });
    res.status(201).json({ ok: true, id: doc._id, createdAt: doc.createdAt });
  } catch (e) {
    res.status(500).json({ error: "Could not save location" });
  }
});

module.exports = router;
