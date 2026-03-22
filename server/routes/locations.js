const express = require("express");
const mongoose = require("mongoose");
const PersonLocation = require("../models/PersonLocation");

const router = express.Router();

function dbReady() {
  return mongoose.connection.readyState === 1;
}

router.post("/", async (req, res) => {
  if (!dbReady()) {
    return res.status(503).json({ error: "Database unavailable" });
  }
  try {
    const { personUserId, lat, lng, timestamp, isOnline } = req.body;

    if (!personUserId || typeof personUserId !== "string") {
      return res.status(400).json({ error: "personUserId is required (24-char hex ObjectId string)" });
    }
    if (!mongoose.isValidObjectId(personUserId)) {
      return res.status(400).json({ error: "personUserId must be a valid MongoDB ObjectId" });
    }
    if (typeof lat !== "number" || typeof lng !== "number" || Number.isNaN(lat) || Number.isNaN(lng)) {
      return res.status(400).json({ error: "lat and lng must be numbers" });
    }
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      return res.status(400).json({ error: "lat/lng out of range" });
    }

    const ts = timestamp != null ? new Date(timestamp) : new Date();
    if (Number.isNaN(ts.getTime())) {
      return res.status(400).json({ error: "timestamp must be a valid ISO date string" });
    }

    const online = isOnline !== false;
    const oid = new mongoose.Types.ObjectId(personUserId);

    const doc = await PersonLocation.findOneAndUpdate(
      { personUserId: oid },
      {
        $set: {
          lat,
          lng,
          timestamp: ts,
          isOnline: online,
        },
        $setOnInsert: { personUserId: oid },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true, runValidators: true }
    );

    res.status(200).json({
      personUserId: doc.personUserId.toString(),
      lat: doc.lat,
      lng: doc.lng,
      timestamp: doc.timestamp.toISOString(),
      isOnline: doc.isOnline,
      createdAt: doc.createdAt.toISOString(),
      updatedAt: doc.updatedAt.toISOString(),
    });
  } catch (e) {
    res.status(500).json({ error: "Could not save location" });
  }
});

module.exports = router;
