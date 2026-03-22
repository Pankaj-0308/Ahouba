const fs = require("fs");
const http = require("http");
const path = require("path");
const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
require("dotenv").config({ path: path.join(__dirname, ".env") });

const tripsRouter = require("./routes/trips");
const locationsRouter = require("./routes/locations");

const app = express();
const PORT = Number(process.env.PORT) || 3000;
/** Render and most PaaS require binding to all interfaces, not only localhost. */
const HOST = process.env.HOST || "0.0.0.0";
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
app.use("/api/locations", locationsRouter);

/** Avoid confusing 404 from the SPA catch-all when someone opens GET /api in the browser. */
app.get("/api", (req, res) => {
  res.json({
    ok: true,
    endpoints: ["/api/health", "GET /api/trips", "POST /api/trips", "POST /api/locations"],
  });
});

mongoose
  .connect(MONGODB_URI)
  .then(() => console.log("MongoDB connected"))
  .catch((err) =>
    console.warn("MongoDB connection failed — trip API will return 503:", err.message)
  );

async function start() {
  const server = http.createServer(app);
  // On Render, NODE_ENV is not always "production" at runtime. If we pick the Vite branch,
  // require("vite") often fails (not installed in prod) and we never reach listen() — port scan fails.
  const isProd =
    process.env.NODE_ENV === "production" ||
    process.env.RENDER === "true" ||
    Boolean(process.env.RENDER_EXTERNAL_URL);

  console.log(
    `[ahouba] NODE_ENV=${process.env.NODE_ENV ?? ""} RENDER=${process.env.RENDER ?? ""} isProd=${isProd} PORT=${PORT} HOST=${HOST}`
  );

  if (isProd) {
    const indexHtml = path.join(clientDist, "index.html");
    if (!fs.existsSync(indexHtml)) {
      console.error(
        `[ahouba] Missing ${indexHtml}. Build the client from the repo root: npm install && npm run build`
      );
    }
    app.use(express.static(clientDist));
    app.get("*", (req, res) => {
      if (req.path.startsWith("/api")) {
        return res.status(404).json({
          error: "Not found",
          path: req.path,
          hint: "Known routes: /api, /api/health, /api/trips, /api/locations",
        });
      }
      res.sendFile(indexHtml, (err) => {
        if (err) {
          console.error("[ahouba] sendFile index.html failed:", err.message);
          res
            .status(500)
            .type("text")
            .send(
              "Client build missing or unreadable. On the host, run from repo root: npm install && npm run build"
            );
        }
      });
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
    server.listen(PORT, HOST, () => {
      console.log(
        `Listening on http://${HOST}:${PORT} — API and React on the same server`
      );
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
