import { Router, type IRouter } from "express";
import healthRouter from "./health";
import categoriesRouter from "./categories";
import productsRouter from "./products";
import roomsRouter from "./rooms";
import tablesRouter from "./tables";
import departmentsRouter from "./departments";
import printersRouter from "./printers";
import ordersRouter from "./orders";
import paymentsRouter from "./payments";
import dashboardRouter from "./dashboard";
import settingsRouter from "./settings";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/categories", categoriesRouter);
router.use("/products", productsRouter);
router.use("/rooms", roomsRouter);
router.use("/tables", tablesRouter);
router.use("/departments", departmentsRouter);
router.use("/printers", printersRouter);
router.use("/orders", ordersRouter);
router.use("/payments", paymentsRouter);
router.use("/dashboard", dashboardRouter);
router.use("/settings", settingsRouter);

export default router;
