import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import path from "path";
import { fileURLToPath } from "url";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

// ── Local mode: serve built frontend from LOCAL_FRONTEND_DIR ─────────────────
// Set LOCAL_FRONTEND_DIR to the path of artifacts/pos-restaurant/dist/public
// when running as a local LAN server on Windows.
const localFrontendDir = process.env.LOCAL_FRONTEND_DIR;
if (localFrontendDir) {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const frontendPath = path.isAbsolute(localFrontendDir)
    ? localFrontendDir
    : path.resolve(__dirname, localFrontendDir);
  app.use(express.static(frontendPath));
  app.get("/{*path}", (_req, res) => {
    res.sendFile(path.join(frontendPath, "index.html"));
  });
  logger.info({ frontendPath }, "Serving local frontend");
}

export default app;
