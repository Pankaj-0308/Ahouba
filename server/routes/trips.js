const express = require("express");
const mongoose = require("mongoose");
const Trip = require("../models/Trip");

const router = express.Router();

function dbReady() {
  return mongoose.connection.readyState === 1;
}

router.post("/", async (req, res) => {
  if (!dbReady()) {
    return res.status(503).json({ error: "Database unavailable" });
  }
  try {
    const {
      originLat,
      originLng,
      destinationText,
      destinationLat,
      destinationLng,
      profile,
      distanceM,
      durationS,
    } = req.body;

    if (
      typeof originLat !== "number" ||
      typeof originLng !== "number" ||
      typeof destinationText !== "string" ||
      typeof destinationLat !== "number" ||
      typeof destinationLng !== "number" ||
      typeof profile !== "string" ||
      typeof distanceM !== "number" ||
      typeof durationS !== "number"
    ) {
      return res.status(400).json({ error: "Invalid trip payload" });
    }

    const trip = await Trip.create({
      originLat,
      originLng,
      destinationText: destinationText.slice(0, 500),
      destinationLat,
      destinationLng,
      profile,
      distanceM,
      durationS,
    });
    res.status(201).json(trip);
  } catch (e) {
    res.status(500).json({ error: "Could not save trip" });
  }
});

router.get("/", async (req, res) => {
  if (!dbReady()) {
    return res.status(503).json({ error: "Database unavailable", trips: [] });
  }
  try {
    const trips = await Trip.find().sort({ createdAt: -1 }).limit(20).lean();
    res.json({ trips });
  } catch (e) {
    res.status(500).json({ error: "Could not list trips" });
  }
});

module.exports = router;
