const http = require("http");
const path = require("path");
const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
require("dotenv").config();

const tripsRouter = require("./routes/trips");

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const MONGODB_URI = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/ahouba";
const clientRoot = path.join(__dirname, "..");
const clientDist = path.join(clientRoot, "dist");

app.use(cors());
app.use(express.json());

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    mongo: mongoose.connection.readyState === 1 ? "connected" : "disconnected",
  });
});

app.use("/api/trips", tripsRouter);

mongoose
  .connect(MONGODB_URI)
  .then(() => console.log("MongoDB connected"))
  .catch((err) =>
    console.warn("MongoDB connection failed — trip API will return 503:", err.message)
  );

async function start() {
  const server = http.createServer(app);
  const isProd = process.env.NODE_ENV === "production";

  if (isProd) {
    app.use(express.static(clientDist));
    app.get("*", (req, res) => {
      if (req.path.startsWith("/api")) {
        return res.status(404).json({ error: "Not found" });
      }
      res.sendFile(path.join(clientDist, "index.html"));
    });
  } else {
    const { createServer: createViteServer } = require("vite");
    const vite = await createViteServer({
      root: clientRoot,
      configFile: path.join(clientRoot, "vite.config.js"),
      server: {
        middlewareMode: true,
        hmr: { server },
      },
      appType: "spa",
    });
    app.use(vite.middlewares);
  }

  return new Promise((resolve, reject) => {
    server.listen(PORT, () => {
      console.log(`Open http://localhost:${PORT} — API and React on the same server`);
      resolve(server);
    });
    server.on("error", (err) => {
      if (err.code === "EADDRINUSE") {
        console.error(
          `Port ${PORT} is already in use. Stop the other process or set PORT, e.g. PORT=3001`
        );
      }
      reject(err);
    });
  });
}

start().catch((err) => {
  console.error(err);
  process.exit(1);
});
